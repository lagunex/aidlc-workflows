// The HTTP surface: read-only JSON routes over one project, the page's own
// files, and the /ws socket that tells an open page to read again. Every
// request passes the same checks, in this order: the peer is this machine,
// the Host names this machine, the method only reads. Every response, errors
// included, carries the same security headers; an error body is one fixed
// sentence that names no path and repeats no message.
import { basename, join } from "node:path";
import { auditTimeline, type OrderedEvent, orderEvents, parseShard } from "./audit.ts";
import {
  CODEKB_STAGE,
  chooseSpace,
  currentRow,
  decisionsPayload,
  fileKind,
  fileNotes,
  fileRef,
  intentStatus,
  intentSummary,
  parseRegistry,
  type QuestionsInput,
  questionsSentence,
  type RegistryRow,
  type ReviewInput,
  registryRowFor,
  reviewFiles,
  type StageFiles,
  type StageInputs,
  spaceSummary,
  stageFileRoles,
  titleCase,
  unitFolders,
  workflowPayload,
  workspacePayload,
} from "./model.ts";
import { openAnswers, parseQuestions, questionsStage } from "./questions.ts";
import { renderMarkdown, renderText } from "./render.ts";
import { type ParsedState, parseState } from "./state.ts";
import type { FileRef, Health, IntentSummary, LiveMessage, QuestionsPayload, RenderPayload, TreePayload } from "./types.ts";
import { listAssets, pathBelow, type ReadProblem, type RecordRef, type Root, readAsset, Workspace } from "./workspace.ts";

export const SENTENCES = {
  unknownSelection: "That space or intent was not found.",
  notAFile: "That path is not a file of this intent.",
  unknownStage: "That stage or unit was not found.",
  hidden: "That file is not shown in the Review UI.",
  notFound: "Not found.",
  readOnly: "The Review UI only reads; it does not accept changes.",
  tooLarge: "This file is over 4 MiB; open it in your editor.",
  notText: "This file is not text; open it in your editor.",
  failed: "Something went wrong reading the workspace.",
  otherMachine: "The Review UI only answers this computer.",
  socketOnly: "Live updates need a WebSocket connection.",
  otherPage: "Live updates only connect from the Review UI page.",
} as const;

const PATH_ERRORS: Record<400 | 403 | 404 | 413 | 415 | 500, string> = {
  400: SENTENCES.notAFile,
  403: SENTENCES.hidden,
  404: SENTENCES.notFound,
  413: SENTENCES.tooLarge,
  415: SENTENCES.notText,
  500: SENTENCES.failed,
};

/** What the handler needs of the running server; Bun's Server has all of it. */
export interface ServerLike {
  requestIP(request: Request): { address: string } | null;
  upgrade(request: Request, options?: { headers?: HeadersInit }): boolean;
  readonly port: number | undefined;
}

export interface HandlerOptions {
  projectDir: string;
  version: string;
  /** The page's folder; public/ beside this file unless a test points elsewhere. */
  publicDir?: string;
  /** Whose file-name rules apply; this machine's unless a test asks for another. */
  platform?: NodeJS.Platform;
}

export interface ReviewUiHandler {
  fetch(request: Request, server: ServerLike): Response | undefined;
  websocket: Bun.WebSocketHandler<undefined>;
  /** Tells every open page that something changed: {"type":"state"}. */
  publish(): void;
  /** How many pages are connected. */
  readonly clients: number;
}

/** 127.0.0.0/8, ::1, and IPv4-mapped 127.x. */
export function isLoopback(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  const v4 = lower.startsWith("::ffff:") ? lower.slice("::ffff:".length) : lower;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

// A page on any site can point its own hostname at 127.0.0.1 (DNS
// rebinding); its requests then carry that hostname, so only loopback names
// are answered.
export function isAllowedHost(host: string): boolean {
  const match = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::(\d{1,5}))?$/i.exec(host);
  return match !== null && (match[1] === undefined || Number(match[1]) <= 65_535);
}

function policy(host: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    `connect-src 'self' ws://${host}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(host: string, cache: "no-store" | "no-cache"): Record<string, string> {
  return {
    "Content-Security-Policy": policy(host),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": cache,
  };
}

function respond(body: string, status: number, host: string, type: string, cache: "no-store" | "no-cache", extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...securityHeaders(host, cache), "Content-Type": type, ...extra } });
}

function json(value: unknown, host: string, status = 200): Response {
  return respond(JSON.stringify(value), status, host, "application/json; charset=utf-8", "no-store");
}

function failure(status: number, sentence: string, host: string, extra: Record<string, string> = {}): Response {
  return respond(JSON.stringify({ error: sentence }), status, host, "application/json; charset=utf-8", "no-store", extra);
}

/** The answer for a failure outside any route, in place of the runtime's own error page. */
export function internalError(port: number | undefined): Response {
  return failure(500, SENTENCES.failed, `127.0.0.1:${port ?? 0}`);
}

function foreignHostPage(port: number | undefined, ownHost: string): Response {
  const address = `http://127.0.0.1:${port ?? 0}/`;
  const page = [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>Open the Review UI at its own address</title></head>',
    `<body><h1>Open the Review UI at its own address</h1><p>This page only answers at ${address}. Open that address instead.</p></body></html>`,
  ].join("\n");
  return respond(page, 403, ownHost, "text/html; charset=utf-8", "no-store");
}

type Selected = { space: string; record: RecordRef };

export function createHandler(options: HandlerOptions): ReviewUiHandler {
  const { projectDir, version } = options;
  const platform = options.platform ?? process.platform;
  const workspace = new Workspace(projectDir, platform);
  const publicDir = options.publicDir ?? join(import.meta.dir, "public");
  const assets = listAssets(publicDir);
  const sockets = new Set<Bun.ServerWebSocket<undefined>>();

  const registryOf = (space: string): RegistryRow[] | null => {
    const read = workspace.registryText(space);
    return read.text === null ? null : parseRegistry(read.text);
  };

  const stateOf = (record: RecordRef): { state: ParsedState | null; mtimeMs: number | null; problem: ReadProblem | "unrecognized" | null } => {
    const { value, read } = workspace.state(record, parseState);
    const problem = read.problem ?? (value && !value.recognized ? "unrecognized" : null);
    return { state: value, mtimeMs: read.mtimeMs > 0 ? read.mtimeMs : null, problem };
  };

  const auditOf = (record: RecordRef): { ordered: OrderedEvent[]; problems: ReadProblem[] } => {
    const shards = workspace.auditShards(record, (text) => parseShard(text, 0));
    const events = shards.flatMap((shard, index) => (shard.value ?? []).map((event) => ({ ...event, shard: index })));
    const problems = shards.filter((shard) => shard.value === null).map((shard) => shard.read.problem ?? "unreadable");
    return { ordered: orderEvents(events), problems };
  };

  const questionsAt = (root: Root, segments: string[], rel: string): QuestionsInput | null => {
    const { value } = workspace.parsed(root, segments, "questions", parseQuestions);
    return value ? { path: rel, parsed: value } : null;
  };

  const folderFiles = (root: Root, segments: string[], slug: string): StageFiles | null => {
    const listing = workspace.listDir(root, segments);
    if (!listing) return null;
    const roles = stageFileRoles(slug, listing.files);
    return {
      questions: roles.questions ? questionsAt(root, [...segments, roles.questions.name], roles.questions.rel) : null,
      artifacts: roles.artifacts.map(fileRef),
      diary: roles.diary ? fileRef(roles.diary) : null,
    };
  };

  /** The per-unit folders of one phase. */
  const unitsOf = (record: RecordRef, state: ParsedState, phase: string): string[] => {
    const listing = workspace.listDir(record, [phase]);
    const slugs = new Set(state.rows.filter((row) => row.phase === phase).map((row) => row.slug));
    return listing ? unitFolders(listing.dirs, slugs) : [];
  };

  const stageInputsOf = (record: RecordRef, state: ParsedState): Map<string, StageInputs> => {
    const inputs = new Map<string, StageInputs>();
    const units = new Map<string, string[]>();
    for (const row of state.rows) {
      if (!row.phase) continue;
      if (!units.has(row.phase)) units.set(row.phase, unitsOf(record, state, row.phase));
      const own = folderFiles(record, [row.phase, row.slug], row.slug);
      const reviews = workspace.listDir(record, [row.phase, row.slug, "reviews"]);
      inputs.set(row.slug, {
        questions: own?.questions ?? null,
        artifacts: own?.artifacts ?? [],
        diary: own?.diary ?? null,
        reviews: reviews ? reviewFiles(reviews.files).map(fileRef) : [],
        units: (units.get(row.phase) ?? []).flatMap((unit) => {
          const files = folderFiles(record, [row.phase, unit, row.slug], row.slug);
          return files ? [{ unit, ...files }] : [];
        }),
      });
    }
    return inputs;
  };

  const reviewInputsOf = (record: RecordRef, state: ParsedState | null): ReviewInput[] => {
    const reviews: ReviewInput[] = [];
    const units = new Map<string, string[]>();
    for (const row of state?.rows ?? []) {
      if (!row.phase || !state) continue;
      if (!units.has(row.phase)) units.set(row.phase, unitsOf(record, state, row.phase));
      const folders: Array<{ unit: string | null; segments: string[] }> = [
        { unit: null, segments: [row.phase, row.slug, "reviews"] },
        ...(units.get(row.phase) ?? []).map((unit) => ({ unit, segments: [row.phase, unit, row.slug, "reviews"] })),
      ];
      for (const folder of folders) {
        const listing = workspace.listDir(record, folder.segments);
        for (const file of listing ? reviewFiles(listing.files) : []) {
          const { value } = workspace.parsed(record, [...folder.segments, file.name], "review", (text) => text);
          reviews.push({ stage: row.slug, unit: folder.unit, file, text: value });
        }
      }
    }
    return reviews;
  };

  /** Answers still open in the current stage's questions files, when it runs with questions ([-]). */
  const currentOpenOf = (record: RecordRef, state: ParsedState | null, status: ReturnType<typeof intentStatus>): number => {
    const row = currentRow(state, status);
    if (!state || !row || row.marker !== "-" || !row.phase) return 0;
    const files = [
      folderFiles(record, [row.phase, row.slug], row.slug),
      ...unitsOf(record, state, row.phase).map((unit) => folderFiles(record, [row.phase, unit, row.slug], row.slug)),
    ];
    return files.reduce((sum, each) => sum + (each?.questions ? openAnswers(each.questions.parsed) : 0), 0);
  };

  const summariesOf = (space: string, registry: RegistryRow[] | null): IntentSummary[] =>
    workspace.records(space).map((record) => {
      const row = registryRowFor(registry, record.record);
      const { state, mtimeMs } = stateOf(record);
      const status = intentStatus(state, row);
      return intentSummary(
        { space, record: record.record, registry: row, state, stateMtimeMs: mtimeMs },
        currentOpenOf(record, state, status),
      );
    });

  const codekbFiles = (space: string): FileRef[] => {
    const root = workspace.codekb(space);
    if (!root) return [];
    return workspace
      .tree(root)
      .filter((item) => item.type === "file")
      .map((item) => fileRef({ name: item.name, rel: item.rel, size: item.size, mtimeMs: item.mtimeMs }));
  };

  const select = (url: URL, host: string): Selected | Response => {
    const space = url.searchParams.get("space");
    const intent = url.searchParams.get("intent");
    if (!space || !intent || !workspace.spaces().some((each) => each.name === space)) return failure(400, SENTENCES.unknownSelection, host);
    const record = workspace.records(space).find((each) => each.record === intent);
    return record ? { space, record } : failure(400, SENTENCES.unknownSelection, host);
  };

  /** The confined file a `path=` names: its root and the segments below it, or the refusal. */
  const served = (url: URL, selected: Selected, host: string): { root: Root; text: string; rel: string; mtimeMs: number } | Response => {
    const path = url.searchParams.get("path") ?? "";
    const rootParam = url.searchParams.get("root");
    const codekbRel = `aidlc/spaces/${selected.space}/codekb`;
    if (rootParam !== null && rootParam !== "record" && rootParam !== "codekb") return failure(400, SENTENCES.notAFile, host);
    const codekb = rootParam === "codekb" || (rootParam === null && path.startsWith(`${codekbRel}/`));
    const below = pathBelow(path, codekb ? codekbRel : selected.record.rel, platform, !codekb);
    if ("status" in below) return failure(below.status, PATH_ERRORS[below.status], host);
    const root = codekb ? workspace.codekb(selected.space) : selected.record;
    if (!root) return failure(404, SENTENCES.notFound, host);
    const file = workspace.serveFile(root, below.rest);
    if (!file.ok) return failure(file.status, PATH_ERRORS[file.status], host);
    return { root, text: file.text, rel: file.rel, mtimeMs: file.mtimeMs };
  };

  const routes: Record<string, (url: URL, host: string) => Response> = {
    "/api/health": (_url, host) => json({ ok: true, version } satisfies Health, host),

    "/api/workspace": (url, host) => {
      const names = workspace.spaces().map((space) => space.name);
      const requested = url.searchParams.get("space");
      if (requested !== null && !names.includes(requested)) return failure(400, SENTENCES.unknownSelection, host);
      const space = requested ?? chooseSpace(names, workspace.cursor(["active-space"]));
      const registries = new Map(names.map((name) => [name, registryOf(name)]));
      const bySpace = new Map(names.map((name) => [name, summariesOf(name, registries.get(name) ?? null)]));
      return json(
        workspacePayload({
          project: basename(projectDir),
          space,
          spaces: names.map((name) => spaceSummary(name, bySpace.get(name) ?? [])),
          intents: bySpace.get(space) ?? [],
          cursor: space ? workspace.cursor(["spaces", space, "intents", "active-intent"]) : null,
          registry: registries.get(space) ?? null,
        }),
        host,
      );
    },

    "/api/workflow": (url, host) => {
      const selected = select(url, host);
      if (selected instanceof Response) return selected;
      const { space, record } = selected;
      const registry = registryRowFor(registryOf(space), record.record);
      const { state, mtimeMs, problem } = stateOf(record);
      const audit = auditOf(record);
      const readable = state?.recognized ? state : null;
      const ranCodekb = readable?.rows.some((row) => row.slug === CODEKB_STAGE && row.marker !== " " && row.marker !== "S");
      return json(
        workflowPayload({
          space,
          record: record.record,
          registry,
          state,
          stateMtimeMs: mtimeMs,
          events: audit.ordered,
          stages: readable ? stageInputsOf(record, readable) : new Map(),
          codekb: ranCodekb ? codekbFiles(space) : [],
          notes: fileNotes(problem, audit.problems),
        }),
        host,
      );
    },

    "/api/tree": (url, host) => {
      const selected = select(url, host);
      if (selected instanceof Response) return selected;
      const rootParam = url.searchParams.get("root");
      if (rootParam !== null && rootParam !== "record" && rootParam !== "codekb") return failure(400, SENTENCES.notAFile, host);
      const root = rootParam === "codekb" ? workspace.codekb(selected.space) : selected.record;
      const payload: TreePayload = {
        space: selected.space,
        intent: selected.record.record,
        root: rootParam === "codekb" ? "codekb" : "record",
        entries: (root ? workspace.tree(root) : []).map((item) => ({
          path: item.rel,
          name: item.name,
          type: item.type,
          ...(item.type === "file" ? { kind: fileKind(item.name), size: item.size } : {}),
          mtime: new Date(item.mtimeMs).toISOString(),
        })),
      };
      return json(payload, host);
    },

    "/api/render": (url, host) => {
      const selected = select(url, host);
      if (selected instanceof Response) return selected;
      const file = served(url, selected, host);
      if (file instanceof Response) return file;
      const markdown = fileKind(file.rel) === "markdown";
      const rendered = markdown
        ? renderMarkdown(file.text, { path: file.rel, root: file.root.rel, rootKind: file.root.kind })
        : { html: renderText(file.text), outline: [] };
      const payload: RenderPayload = {
        path: file.rel,
        kind: markdown ? "markdown" : "text",
        html: rendered.html,
        outline: rendered.outline,
        mtime: new Date(file.mtimeMs).toISOString(),
      };
      return json(payload, host);
    },

    "/api/questions": (url, host) => {
      const selected = select(url, host);
      if (selected instanceof Response) return selected;
      if (!/-questions\.md$/i.test(url.searchParams.get("path") ?? "")) return failure(400, SENTENCES.notAFile, host);
      const file = served(url, selected, host);
      if (file instanceof Response) return file;
      const parsed = parseQuestions(file.text);
      const stage = questionsStage(file.rel);
      const status = intentStatus(stateOf(selected.record).state, registryRowFor(registryOf(selected.space), selected.record.record));
      const payload: QuestionsPayload = {
        path: file.rel,
        stage,
        stage_name: titleCase(stage),
        ...parsed,
        open_answers: openAnswers(parsed),
        sentence: questionsSentence(parsed, status),
      };
      return json(payload, host);
    },

    "/api/decisions": (url, host) => {
      const selected = select(url, host);
      if (selected instanceof Response) return selected;
      const stage = url.searchParams.get("stage") ?? undefined;
      const unit = url.searchParams.get("unit") ?? undefined;
      const plain = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
      if ((stage !== undefined && !plain.test(stage)) || (unit !== undefined && !plain.test(unit))) {
        return failure(400, SENTENCES.unknownStage, host);
      }
      const { state } = stateOf(selected.record);
      const audit = auditOf(selected.record);
      return json(
        decisionsPayload({
          space: selected.space,
          intent: selected.record.record,
          timeline: auditTimeline(audit.ordered),
          reviews: reviewInputsOf(selected.record, state?.recognized ? state : null),
          stage,
          unit,
          notes: fileNotes(null, audit.problems),
        }),
        host,
      );
    },
  };

  const page = (host: string): Response => {
    const html = readAsset(join(publicDir, "index.html"));
    return html === null ? failure(404, SENTENCES.notFound, host) : respond(html, 200, host, "text/html; charset=utf-8", "no-cache");
  };

  const asset = (pathname: string, host: string): Response => {
    let name: string;
    try {
      name = decodeURIComponent(pathname.slice("/assets/".length));
    } catch {
      return failure(404, SENTENCES.notFound, host);
    }
    const entry = assets.get(name);
    const body = entry ? readAsset(entry.abs) : null;
    return entry && body !== null ? respond(body, 200, host, entry.type, "no-cache") : failure(404, SENTENCES.notFound, host);
  };

  const socket = (request: Request, server: ServerLike, host: string): Response | undefined => {
    if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") return failure(400, SENTENCES.socketOnly, host);
    if (request.headers.get("origin") !== `http://${host}`) return failure(403, SENTENCES.otherPage, host);
    if (server.upgrade(request, { headers: securityHeaders(host, "no-store") })) return undefined;
    return failure(400, SENTENCES.socketOnly, host);
  };

  const answer = (request: Request, server: ServerLike, host: string): Response | undefined => {
    const url = new URL(request.url);
    if (url.pathname === "/ws") return socket(request, server, host);
    if (url.pathname === "/" || url.pathname === "/index.html") return page(host);
    if (url.pathname.startsWith("/assets/")) return asset(url.pathname, host);
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined;
    return route ? route(url, host) : failure(404, SENTENCES.notFound, host);
  };

  return {
    fetch(request, server) {
      const ownHost = `127.0.0.1:${server.port ?? 0}`;
      if (!isLoopback(server.requestIP(request)?.address ?? "")) return failure(403, SENTENCES.otherMachine, ownHost);
      const host = request.headers.get("host") ?? "";
      if (!isAllowedHost(host)) return foreignHostPage(server.port, ownHost);
      if (request.method !== "GET" && request.method !== "HEAD") {
        return failure(405, SENTENCES.readOnly, host, { Allow: "GET, HEAD" });
      }
      let response: Response | undefined;
      try {
        response = answer(request, server, host);
      } catch (error) {
        console.error(`Review UI could not answer a request: ${(error as Error).message}`);
        response = failure(500, SENTENCES.failed, host);
      }
      if (request.method === "HEAD" && response) {
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    },
    websocket: {
      maxPayloadLength: 1024,
      open(ws) {
        sockets.add(ws);
      },
      // The socket only pushes; a page that sends anything is not this app's page.
      message(ws) {
        ws.close(1008, "This connection only receives updates.");
      },
      close(ws) {
        sockets.delete(ws);
      },
    },
    publish() {
      const message: LiveMessage = { type: "state" };
      for (const ws of sockets) ws.send(JSON.stringify(message));
    },
    get clients() {
      return sockets.size;
    },
  };
}
