// Read-only access to an AI-DLC workspace on disk. Nothing in this module
// writes, moves, or deletes; every file the server returns passes through
// readArtifactFile, which confines it to one intent record.
import { type Dirent, promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface DiscoveredIntent {
  space: string;
  record: string;
  dir: string;
}

export interface ArtifactEntry {
  /** Record-relative, forward slashes. */
  relPath: string;
  name: string;
  type: "file" | "dir";
  size?: number;
}

export class PathOutsideRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathOutsideRecordError";
  }
}

// A space or record name is one path segment: no separators, and no leading
// dot, which also rules out "." and "..".
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeSegment(name: string): boolean {
  return SEGMENT.test(name);
}

export function spacesRoot(workspaceRoot: string): string {
  return join(workspaceRoot, "aidlc", "spaces");
}

/** The record dir for (space, record), or null when either name is not a single safe segment. */
export function recordDir(workspaceRoot: string, space: string, record: string): string | null {
  if (!isSafeSegment(space) || !isSafeSegment(record)) return null;
  return join(spacesRoot(workspaceRoot), space, "intents", record);
}

// Spaces and intents may be symlinked in (a shared space, a record checked out
// elsewhere), so a link that resolves to a directory counts as one. A broken
// link or a link to a file is not an error, just not a directory.
async function isDirOrLinkToDir(parent: string, entry: Dirent): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return (await fs.stat(join(parent, entry.name))).isDirectory();
  } catch {
    return false;
  }
}

async function readDirents(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Every intent record under `aidlc/spaces/<space>/intents/`, sorted by space
 * then record. A record is a directory holding `aidlc-state.md`; cursors such
 * as `active-intent` and dot-prefixed scratch entries are not records.
 */
export async function discoverIntents(workspaceRoot: string): Promise<DiscoveredIntent[]> {
  const root = spacesRoot(workspaceRoot);
  const found: DiscoveredIntent[] = [];
  for (const spaceEntry of await readDirents(root)) {
    if (!isSafeSegment(spaceEntry.name) || !(await isDirOrLinkToDir(root, spaceEntry))) continue;
    const intentsRoot = join(root, spaceEntry.name, "intents");
    for (const entry of await readDirents(intentsRoot)) {
      if (!isSafeSegment(entry.name) || !(await isDirOrLinkToDir(intentsRoot, entry))) continue;
      const dir = join(intentsRoot, entry.name);
      if (await isFile(join(dir, "aidlc-state.md"))) {
        found.push({ space: spaceEntry.name, record: entry.name, dir });
      }
    }
  }
  return found.sort((a, b) => a.space.localeCompare(b.space) || a.record.localeCompare(b.record));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The record's `aidlc-state.md`, or "" when it is missing or unreadable. */
export async function readStateFile(dir: string): Promise<string> {
  try {
    return await fs.readFile(join(dir, "aidlc-state.md"), "utf8");
  } catch {
    return "";
  }
}

/**
 * The text of every shard under `<record>/audit/`. Each clone writes its own
 * shard, so a reader has to merge them; an unreadable shard is left out
 * rather than failing the whole view.
 */
export async function readAuditShards(dir: string): Promise<string[]> {
  const auditDir = join(dir, "audit");
  const names = (await readDirents(auditDir))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const texts: string[] = [];
  for (const name of names) {
    try {
      texts.push(await fs.readFile(join(auditDir, name), "utf8"));
    } catch {
      // Skipped: one bad shard should not hide the others.
    }
  }
  return texts;
}

/**
 * The record's files and directories as a flat list sorted by path. Dot
 * entries (`.aidlc-engine/` and other engine state) are left out, and
 * symlinks inside a record are not followed, so the walk cannot loop or leave
 * the record.
 */
export async function listArtifacts(dir: string): Promise<ArtifactEntry[]> {
  const out: ArtifactEntry[] = [];
  async function walk(absDir: string, rel: string): Promise<void> {
    for (const entry of await readDirents(absDir)) {
      if (entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        out.push({ relPath: childRel, name: entry.name, type: "dir" });
        await walk(childAbs, childRel);
      } else if (entry.isFile()) {
        let size: number | undefined;
        try {
          size = (await fs.stat(childAbs)).size;
        } catch {
          size = undefined;
        }
        out.push({ relPath: childRel, name: entry.name, type: "file", size });
      }
    }
  }
  await walk(dir, "");
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function isInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Reads one file inside a record. The path is checked twice: lexically, so
 * an absolute path or `..` is refused before touching the disk, and again
 * after resolving symlinks, so a link inside the record cannot point out of
 * it. Throws PathOutsideRecordError for either; fs errors such as ENOENT
 * propagate for the caller to map.
 */
export async function readArtifactFile(recordAbsDir: string, relPath: string): Promise<string> {
  if (relPath.length === 0) throw new PathOutsideRecordError("empty path");
  if (isAbsolute(relPath) || relPath.startsWith("/") || relPath.startsWith("\\")) {
    throw new PathOutsideRecordError("absolute paths are not allowed");
  }
  const base = resolve(recordAbsDir);
  const target = resolve(base, relPath);
  if (!isInside(base, target)) throw new PathOutsideRecordError("path escapes the record directory");

  const realBase = await fs.realpath(base);
  const realTarget = await fs.realpath(target);
  if (!isInside(realBase, realTarget)) throw new PathOutsideRecordError("path resolves outside the record directory");
  if (!(await fs.stat(realTarget)).isFile()) {
    throw Object.assign(new Error("not a regular file"), { code: "ENOENT" });
  }
  return fs.readFile(realTarget, "utf8");
}
