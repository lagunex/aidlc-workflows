// The one module that touches the disk: finding the project, its spaces and
// intent records, keeping every read inside them, capping reads, caching
// parsed files, and the file watching behind live updates. It hands back plain
// data; every other module is pure and takes text and paths in.
//
// Confinement: a read starts from a root (an intent record, or a space's
// codekb/) and walks down one segment at a time with lstat, so no symlink below
// the root is ever followed. A record or space that is itself a symlink is
// followed, since discovery accepts linked ones; a codekb/ that is a symlink
// is not a root at all.
import {
  closeSync,
  constants,
  type Dirent,
  type FSWatcher,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  type Stats,
  statSync,
  watch,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

/** The engine's own entries at a record's top level, never listed or served there; isHiddenAt is the whole rule. */
export const HIDDEN_NAMES: readonly string[] = ["aidlc-state.md", "audit", "runtime-graph.json"];

/** No read goes past this: a served file over it is refused, a state or audit file over it is left out. */
export const READ_CAP_BYTES = 4 * 1024 * 1024;
const SNIFF_BYTES = 8 * 1024;
const TREE_ENTRY_LIMIT = 10_000;
// Parsed files kept at most; past it the cache starts over, so files that
// were deleted or renamed do not pile up in a long-running server.
const CACHE_LIMIT = 4_000;
const STATE_FILE = "aidlc-state.md";
const AUDIT_DIR = "audit";
const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
const CONTROL = /[\u0000-\u001f\u007f]/;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/** A space or record name: one segment, no separator, no leading dot, no control character. */
export function isSafeSegment(name: string): boolean {
  return name.length > 0 && !name.startsWith(".") && !/[/\\]/.test(name) && !CONTROL.test(name);
}

/**
 * Whether a path segment is never listed or served: a name that starts with a
 * dot, at any depth; one of HIDDEN_NAMES, in any letter case, only as the
 * first segment below a record (`depth` 0 of a record root), where the engine
 * keeps them (guide 14), so a unit folder or a codekb store named "audit" shows.
 */
export function isHiddenAt(name: string, depth: number, recordRoot: boolean): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(".") || (recordRoot && depth === 0 && HIDDEN_NAMES.includes(lower));
}

/** Windows opens "a.md." or "a.md " as "a.md", reads streams after ":", and maps device names anywhere. */
export function isRefusedOnPlatform(name: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && (/[. ]$/.test(name) || name.includes(":") || DEVICE_NAME.test(name));
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function statOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function entriesOf(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

function inside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** The nearest folder, from `start` upward, that holds `aidlc/spaces/`. */
export function findProjectDir(start: string): string | null {
  let dir = start;
  for (;;) {
    if (statOrNull(join(dir, "aidlc", "spaces"))?.isDirectory()) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export type ReadProblem = "missing" | "not-a-file" | "too-large" | "binary" | "unreadable";

export interface TextRead {
  text: string | null;
  size: number;
  mtimeMs: number;
  problem: ReadProblem | null;
}

function failed(problem: ReadProblem, size = 0, mtimeMs = 0): TextRead {
  return { text: null, size, mtimeMs, problem };
}

// Opened without following a final symlink where the platform allows it,
// then checked through the descriptor, so a file swapped after the walk is
// still judged by what was opened.
function readCapped(abs: string): TextRead {
  let fd: number;
  try {
    fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return failed(code === "ENOENT" || code === "ENOTDIR" ? "missing" : code === "ELOOP" ? "not-a-file" : "unreadable");
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) return failed("not-a-file", 0, stats.mtimeMs);
    if (stats.size > READ_CAP_BYTES) return failed("too-large", stats.size, stats.mtimeMs);
    const buffer = new Uint8Array(Math.min(stats.size, READ_CAP_BYTES) + 1);
    let total = 0;
    while (total < buffer.length) {
      const read = readSync(fd, buffer, total, buffer.length - total, null);
      if (read === 0) break;
      total += read;
    }
    if (total > READ_CAP_BYTES) return failed("too-large", total, stats.mtimeMs);
    const bytes = buffer.subarray(0, total);
    if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return failed("binary", total, stats.mtimeMs);
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), size: total, mtimeMs: stats.mtimeMs, problem: null };
    } catch {
      return failed("binary", total, stats.mtimeMs);
    }
  } catch {
    return failed("unreadable");
  } finally {
    closeSync(fd);
  }
}

/** A confined read root: a record, or a space's codekb/. */
export interface Root {
  /** Project-relative POSIX path, no trailing slash. */
  rel: string;
  /** The root's real path on disk. */
  real: string;
  /** A record's top level holds the engine's own entries; a codekb's does not. */
  kind: "record" | "codekb";
}

export interface SpaceRef {
  name: string;
  /** The space folder, a symlink when linked. */
  dir: string;
  real: string;
  linked: boolean;
}

export interface RecordRef extends Root {
  space: string;
  record: string;
  linked: boolean;
}

export interface FileEntry {
  name: string;
  /** Project-relative POSIX path. */
  rel: string;
  size: number;
  mtimeMs: number;
}

export interface DirListing {
  files: FileEntry[];
  dirs: string[];
}

export interface TreeItem {
  rel: string;
  name: string;
  type: "file" | "dir";
  size: number;
  mtimeMs: number;
}

type Walked = { abs: string; stats: Stats } | { problem: "missing" | "symlink" };

/** Down from the root's real path, one lstat per segment, never through a symlink. */
function walkDown(root: Root, segments: string[]): Walked {
  let abs = root.real;
  let stats = lstatOrNull(abs);
  if (!stats) return { problem: "missing" };
  for (const segment of segments) {
    if (!stats.isDirectory()) return { problem: "missing" };
    abs = join(abs, segment);
    stats = lstatOrNull(abs);
    if (!stats) return { problem: "missing" };
    if (stats.isSymbolicLink()) return { problem: "symlink" };
  }
  return { abs, stats };
}

export type ServedFile =
  | { ok: true; rel: string; text: string; mtimeMs: number }
  | { ok: false; status: 400 | 403 | 404 | 413 | 415 | 500 };

/**
 * The segments of `path` below `rootRel`, or the status that refuses it:
 * 400 when it is not a plain project-relative path under the root, 403 when
 * a segment is hidden (isHiddenAt; `recordRoot` when the root is a record) or
 * a name Windows would read as another file.
 */
export function pathBelow(
  path: string,
  rootRel: string,
  platform: NodeJS.Platform,
  recordRoot: boolean,
): { rest: string[] } | { status: 400 | 403 } {
  if (path.length === 0 || path.length > 4096 || path.includes("\0") || path.includes("\\")) return { status: 400 };
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return { status: 400 };
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return { status: 400 };
  const prefix = rootRel.split("/");
  if (segments.length <= prefix.length || prefix.some((segment, index) => segments[index] !== segment)) return { status: 400 };
  const rest = segments.slice(prefix.length);
  if (rest.some((segment) => CONTROL.test(segment))) return { status: 400 };
  if (rest.some((segment, depth) => isHiddenAt(segment, depth, recordRoot) || isRefusedOnPlatform(segment, platform))) return { status: 403 };
  return { rest };
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  value: unknown;
}

export class Workspace {
  readonly projectDir: string;
  readonly platform: NodeJS.Platform;
  // Parsed files by (path, kind), kept while their size and mtime hold.
  private readonly cache = new Map<string, CacheEntry>();

  constructor(projectDir: string, platform: NodeJS.Platform = process.platform) {
    this.projectDir = projectDir;
    this.platform = platform;
  }

  spacesDir(): string {
    return join(this.projectDir, "aidlc", "spaces");
  }

  /** Every space: a safe-named folder, or a symlink to one, under aidlc/spaces/. */
  spaces(): SpaceRef[] {
    const root = this.spacesDir();
    const found: SpaceRef[] = [];
    for (const entry of entriesOf(root)) {
      if (!isSafeSegment(entry.name)) continue;
      const dir = join(root, entry.name);
      if (!(entry.isDirectory() || (entry.isSymbolicLink() && statOrNull(dir)?.isDirectory()))) continue;
      const real = realOrNull(dir);
      if (real) found.push({ name: entry.name, dir, real, linked: entry.isSymbolicLink() });
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every record of a space: a folder (or a symlink to one) under intents/ that holds aidlc-state.md. */
  records(space: string): RecordRef[] {
    const spaceRef = this.spaces().find((candidate) => candidate.name === space);
    if (!spaceRef) return [];
    const intents = join(spaceRef.dir, "intents");
    const found: RecordRef[] = [];
    for (const entry of entriesOf(intents)) {
      if (!isSafeSegment(entry.name)) continue;
      const dir = join(intents, entry.name);
      if (!(entry.isDirectory() || (entry.isSymbolicLink() && statOrNull(dir)?.isDirectory()))) continue;
      const real = realOrNull(dir);
      if (!real || !lstatOrNull(join(real, STATE_FILE))?.isFile()) continue;
      found.push({
        space,
        record: entry.name,
        rel: `aidlc/spaces/${space}/intents/${entry.name}`,
        real,
        kind: "record",
        linked: entry.isSymbolicLink(),
      });
    }
    return found.sort((a, b) => a.record.localeCompare(b.record));
  }

  /** A space's codekb/ as a read root, when it is a folder of the space itself. */
  codekb(space: string): Root | null {
    const spaceRef = this.spaces().find((candidate) => candidate.name === space);
    if (!spaceRef) return null;
    const dir = join(spaceRef.dir, "codekb");
    // A codekb/ that is a symlink or a junction would carry every read below
    // it to wherever it points, outside the project too; lstat sees a link as
    // not a folder.
    if (!lstatOrNull(dir)?.isDirectory()) return null;
    const real = realOrNull(dir);
    return real && inside(spaceRef.real, real) ? { rel: `aidlc/spaces/${space}/codekb`, real, kind: "codekb" } : null;
  }

  /** A cursor file's trimmed content (aidlc/active-space, intents/active-intent); never written here. */
  cursor(segments: string[]): string | null {
    const abs = join(this.projectDir, "aidlc", ...segments);
    if (!lstatOrNull(abs)?.isFile()) return null;
    const read = readCapped(abs);
    const value = read.text?.trim() ?? "";
    return value || null;
  }

  /** A space's intents/intents.json. */
  registryText(space: string): TextRead {
    const spaceRef = this.spaces().find((candidate) => candidate.name === space);
    if (!spaceRef) return failed("missing");
    const abs = join(spaceRef.dir, "intents", "intents.json");
    return lstatOrNull(abs)?.isFile() ? readCapped(abs) : failed("missing");
  }

  readFile(root: Root, segments: string[]): TextRead {
    const walked = walkDown(root, segments);
    if ("problem" in walked) return failed(walked.problem === "symlink" ? "not-a-file" : "missing");
    if (!walked.stats.isFile()) return failed("not-a-file");
    return readCapped(walked.abs);
  }

  /**
   * A file parsed once per (size, mtime): `parse` runs again only after the file
   * changes. A file that cannot be read gives its problem and no value.
   */
  parsed<T>(root: Root, segments: string[], kind: string, parse: (text: string) => T): { value: T | null; read: TextRead } {
    const walked = walkDown(root, segments);
    if ("problem" in walked || !walked.stats.isFile()) {
      return { value: null, read: failed("problem" in walked && walked.problem === "missing" ? "missing" : "not-a-file") };
    }
    const key = `${kind}\u0000${walked.abs}`;
    const hit = this.cache.get(key);
    const meta = { text: null, size: walked.stats.size, mtimeMs: walked.stats.mtimeMs, problem: null };
    if (hit && hit.size === walked.stats.size && hit.mtimeMs === walked.stats.mtimeMs) return { value: hit.value as T, read: meta };
    const read = readCapped(walked.abs);
    if (read.text === null) {
      this.cache.delete(key);
      return { value: null, read };
    }
    const value = parse(read.text);
    if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    this.cache.set(key, { size: read.size, mtimeMs: read.mtimeMs, value });
    return { value, read: { ...read, text: null } };
  }

  /** A record's aidlc-state.md, parsed. */
  state<T>(record: RecordRef, parse: (text: string) => T): { value: T | null; read: TextRead } {
    return this.parsed(record, [STATE_FILE], "state", parse);
  }

  /** A record's audit shards in name order, each parsed. */
  auditShards<T>(record: RecordRef, parse: (text: string) => T): Array<{ name: string; value: T | null; read: TextRead }> {
    const listing = this.listDir(record, [AUDIT_DIR]);
    if (!listing) return [];
    return listing.files
      .filter((file) => file.name.toLowerCase().endsWith(".md"))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({ name: file.name, ...this.parsed(record, [AUDIT_DIR, file.name], "audit", parse) }));
  }

  /** The files and folders directly inside a folder below the root, without hidden names or symlinks. */
  listDir(root: Root, segments: string[]): DirListing | null {
    const walked = walkDown(root, segments);
    if ("problem" in walked || !walked.stats.isDirectory()) return null;
    const relDir = [root.rel, ...segments].join("/");
    const listing: DirListing = { files: [], dirs: [] };
    for (const entry of entriesOf(walked.abs)) {
      if (CONTROL.test(entry.name) || entry.isSymbolicLink() || isHiddenAt(entry.name, segments.length, root.kind === "record")) continue;
      if (entry.isDirectory()) listing.dirs.push(entry.name);
      else if (entry.isFile()) {
        const stats = lstatOrNull(join(walked.abs, entry.name));
        if (stats?.isFile()) listing.files.push({ name: entry.name, rel: `${relDir}/${entry.name}`, size: stats.size, mtimeMs: stats.mtimeMs });
      }
    }
    listing.dirs.sort();
    listing.files.sort((a, b) => a.name.localeCompare(b.name));
    return listing;
  }

  /** Everything below the root, sorted by path; hidden names and symlinks are left out. */
  tree(root: Root): TreeItem[] {
    const items: TreeItem[] = [];
    const visit = (segments: string[]): void => {
      const listing = this.listDir(root, segments);
      if (!listing) return;
      for (const dir of listing.dirs) {
        if (items.length >= TREE_ENTRY_LIMIT) return;
        const stats = lstatOrNull(join(root.real, ...segments, dir));
        items.push({ rel: [root.rel, ...segments, dir].join("/"), name: dir, type: "dir", size: 0, mtimeMs: stats?.mtimeMs ?? 0 });
        visit([...segments, dir]);
      }
      for (const file of listing.files) {
        if (items.length >= TREE_ENTRY_LIMIT) return;
        items.push({ rel: file.rel, name: file.name, type: "file", size: file.size, mtimeMs: file.mtimeMs });
      }
    };
    visit([]);
    return items.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  }

  /**
   * A file the browser asked for, confined to the root: every segment walked
   * without following a symlink, the real path inside the root's real path,
   * and the hidden rule checked again on the real path's segments.
   */
  serveFile(root: Root, rest: string[]): ServedFile {
    const walked = walkDown(root, rest);
    if ("problem" in walked) return { ok: false, status: walked.problem === "symlink" ? 403 : 404 };
    if (!walked.stats.isFile()) return { ok: false, status: 400 };
    const real = realOrNull(walked.abs);
    if (!real || !inside(root.real, real)) return { ok: false, status: 403 };
    const realSegments = relative(root.real, real).split(sep);
    const recordRoot = root.kind === "record";
    if (realSegments.some((segment, depth) => isHiddenAt(segment, depth, recordRoot) || isRefusedOnPlatform(segment, this.platform))) {
      return { ok: false, status: 403 };
    }
    const read = readCapped(walked.abs);
    if (read.problem === "too-large") return { ok: false, status: 413 };
    if (read.problem === "binary") return { ok: false, status: 415 };
    if (read.text === null) return { ok: false, status: read.problem === "missing" ? 404 : read.problem === "not-a-file" ? 403 : 500 };
    return { ok: true, rel: [root.rel, ...rest].join("/"), text: read.text, mtimeMs: read.mtimeMs };
  }

  /**
   * What the live watcher watches: aidlc/spaces/ itself, plus the real folders
   * of linked spaces and records, which a recursive watch does not enter.
   */
  watchTargets(): string[] {
    const spacesReal = realOrNull(this.spacesDir());
    if (!spacesReal) return [];
    const targets = new Set<string>([spacesReal]);
    const add = (real: string): void => {
      if (real !== spacesReal && !inside(spacesReal, real)) targets.add(real);
    };
    for (const space of this.spaces()) {
      if (space.linked) add(space.real);
      for (const record of this.records(space.name)) if (record.linked) add(record.real);
    }
    return [...targets];
  }

  /**
   * Sizes and mtimes of what the poll fallback compares: each space's
   * intents.json, each record's aidlc-state.md and audit shards.
   */
  pollSignature(): string {
    const parts: string[] = [];
    const note = (abs: string): void => {
      const stats = lstatOrNull(abs);
      parts.push(stats ? `${abs}\u0000${stats.size}\u0000${stats.mtimeMs}` : `${abs}\u0000-`);
    };
    for (const space of this.spaces()) {
      note(join(space.real, "intents", "intents.json"));
      for (const record of this.records(space.name)) {
        note(join(record.real, STATE_FILE));
        for (const entry of entriesOf(join(record.real, AUDIT_DIR))) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) note(join(record.real, AUDIT_DIR, entry.name));
        }
      }
    }
    return parts.join("\n");
  }
}

/**
 * Watches a folder tree. `onChange` gets the changed path relative to the
 * folder, with "/" separators (null when the platform does not say);
 * `onError` gets any later failure, such as running out of inotify watches.
 * Throws when the platform cannot watch the folder at all.
 */
export function watchTree(dir: string, onChange: (relPath: string | null) => void, onError: (error: Error) => void): () => void {
  const watcher: FSWatcher = watch(dir, { recursive: true, persistent: true }, (_type, name) => {
    onChange(name ? String(name).split(sep).join("/") : null);
  });
  watcher.on("error", onError);
  return () => watcher.close();
}

/** The page's files: regular, non-hidden files of an allowed type directly in `dir`, by name. */
export function listAssets(dir: string): Map<string, { abs: string; type: string }> {
  const assets = new Map<string, { abs: string; type: string }>();
  for (const entry of entriesOf(dir)) {
    if (!entry.isFile() || entry.isSymbolicLink() || isHiddenAt(entry.name, 0, false) || CONTROL.test(entry.name)) continue;
    const dot = entry.name.lastIndexOf(".");
    const type = dot > 0 ? ASSET_TYPES[entry.name.slice(dot).toLowerCase()] : undefined;
    if (type) assets.set(entry.name, { abs: join(dir, entry.name), type });
  }
  return assets;
}

/** One page file's text, or null when it is gone or unreadable. */
export function readAsset(abs: string): string | null {
  return readCapped(abs).text;
}
