// The HTTP surface: a read-only JSON API over one workspace plus the three
// static files of the browser view. Every handler reads the workspace afresh,
// so reloading the page shows the current state on disk.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDecisions } from "./audit.ts";
import { renderMarkdown } from "./markdown.ts";
import { buildGraph, computeProgress, parseState } from "./state.ts";
import {
  discoverIntents,
  listArtifacts,
  PathOutsideRecordError,
  readArtifactFile,
  readAuditShards,
  readStateFile,
  recordDir,
} from "./workspace.ts";

const PUBLIC_DIR = join(import.meta.dir, "public");

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
};

// The server binds to loopback, but a page on any site can still reach it by
// pointing its own hostname at 127.0.0.1 (DNS rebinding). Such a request
// carries that site's hostname in Host, so only loopback names are served.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export interface ServerOptions {
  /** The directory holding `aidlc/` (a project that runs AI-DLC). */
  workspaceRoot: string;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: SECURITY_HEADERS });
}

function hostname(request: Request): string {
  const host = request.headers.get("host") ?? "";
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

const INTENT_ROUTE = /^\/api\/intents\/([^/]+)\/([^/]+)\/(graph|decisions|artifacts|artifacts\/file)$/;

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function createHandler(options: ServerOptions): (request: Request) => Promise<Response> {
  const { workspaceRoot } = options;

  async function overview(): Promise<Response> {
    const intents = [];
    for (const { space, record, dir } of await discoverIntents(workspaceRoot)) {
      const state = parseState(await readStateFile(dir));
      intents.push({
        space,
        record,
        title: state.title || record,
        phase: state.phase,
        currentStage: state.currentStage,
        status: state.status,
        scope: state.scope,
        progress: computeProgress(state.stages),
      });
    }
    return json(200, { intents });
  }

  async function intentRoute(space: string, record: string, view: string, url: URL): Promise<Response> {
    const dir = recordDir(workspaceRoot, space, record);
    const stateText = dir ? await readStateFile(dir) : "";
    if (!dir || !stateText) return json(404, { error: "intent not found" });

    switch (view) {
      case "graph":
        return json(200, { space, record, phases: buildGraph(parseState(stateText).stages) });
      case "decisions":
        return json(200, { space, record, decisions: parseDecisions(await readAuditShards(dir)) });
      case "artifacts":
        return json(200, { space, record, artifacts: await listArtifacts(dir) });
      default:
        return artifactFile(space, record, dir, url.searchParams.get("path") ?? "");
    }
  }

  async function artifactFile(space: string, record: string, dir: string, path: string): Promise<Response> {
    if (!path) return json(400, { error: "missing 'path' query parameter" });
    let content: string;
    try {
      content = await readArtifactFile(dir, path);
    } catch (err) {
      if (err instanceof PathOutsideRecordError) return json(400, { error: "invalid path" });
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return json(404, { error: "file not found" });
      throw err;
    }
    let html: string | undefined;
    if (/\.md$/i.test(path)) {
      try {
        html = renderMarkdown(content);
      } catch {
        html = undefined; // The view falls back to plain text.
      }
    }
    return json(200, { space, record, path, content, html });
  }

  async function staticFile(pathname: string): Promise<Response | null> {
    const entry = STATIC_FILES[pathname];
    if (!entry) return null;
    const body = await readFile(join(PUBLIC_DIR, entry.file));
    return new Response(body, { headers: { ...SECURITY_HEADERS, "Content-Type": entry.type } });
  }

  return async (request) => {
    if (!LOOPBACK_HOSTS.has(hostname(request))) return json(403, { error: "forbidden host" });
    if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "method not allowed" });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return json(200, { ok: true, workspaceRoot });
      if (url.pathname === "/api/intents") return await overview();
      const match = url.pathname.match(INTENT_ROUTE);
      if (match) {
        const space = decodeSegment(match[1]);
        const record = decodeSegment(match[2]);
        if (space === null || record === null) return json(400, { error: "invalid intent name" });
        return await intentRoute(space, record, match[3], url);
      }
      return (await staticFile(url.pathname)) ?? json(404, { error: "not found" });
    } catch {
      return json(500, { error: "internal error" });
    }
  };
}
