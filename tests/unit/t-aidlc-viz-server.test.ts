// covers: file:scripts/aidlc-viz/workspace.ts, file:scripts/aidlc-viz/server.ts, file:scripts/aidlc-viz/aidlc-viz.ts
//
// The visualizer against a real workspace on disk: which records it
// discovers, what each API route returns, and that no request reads outside
// the record it names, whether by `..`, an absolute path, an encoded intent
// name, or a symlink inside the record. Requests come from a page on
// loopback only; any other Host is refused.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_PORT, resolveConfig } from "../../scripts/aidlc-viz/aidlc-viz.ts";
import { createHandler } from "../../scripts/aidlc-viz/server.ts";
import {
  discoverIntents,
  isSafeSegment,
  listArtifacts,
  PathOutsideRecordError,
  readArtifactFile,
  readAuditShards,
  recordDir,
} from "../../scripts/aidlc-viz/workspace.ts";

const STATE = `# AI-DLC State Tracking
- **Project**: Sample visualization server
- **Scope**: poc

### IDEATION PHASE
- [x] intent-capture — EXECUTE
- [ ] market-research — SKIP

### CONSTRUCTION PHASE
- [?] code-generation — EXECUTE

## Current Status
- **Lifecycle Phase**: CONSTRUCTION
- **Current Stage**: code-generation
- **Status**: Running
`;

const AUDIT = `## Gate Approved
**Timestamp**: 2026-10-16T09:55:00Z
**Event**: GATE_APPROVED
**Stage**: intent-capture
**User Input**: Approve
`;

const SPACE = "default";
const RECORD = "261014-sample";
const SECOND = "261015-second";
const LINKED = "261015-linked";

let root: string;
let symlinks = false;

function put(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

beforeAll(() => {
  // macOS temp roots may be reached through /var -> /private/var.
  root = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-viz-")));
  const intents = `aidlc/spaces/${SPACE}/intents`;
  put(`${intents}/${RECORD}/aidlc-state.md`, STATE);
  put(`${intents}/${RECORD}/audit/host-clone.md`, AUDIT);
  put(`${intents}/${RECORD}/audit/notes.txt`, "not a shard");
  put(`${intents}/${RECORD}/construction/code-generation/notes.md`, "# Notes\n\n<script>alert(1)</script>\n");
  put(`${intents}/${RECORD}/construction/code-generation/plan.json`, '{"a":1}\n');
  put(`${intents}/${RECORD}/.aidlc-engine/internal.json`, "{}");
  put(`${intents}/${SECOND}/aidlc-state.md`, STATE.replace("[?] code-generation", "[x] code-generation"));
  put(`${intents}/not-a-record/readme.md`, "no state file");
  put(`${intents}/active-intent`, RECORD);
  put(`${intents}/.aidlc-scratch/aidlc-state.md`, STATE);
  put("secret.txt", "TOP SECRET");
  // An intent dir outside spaces/ that a crafted space/record could aim at.
  put("elsewhere/aidlc-state.md", STATE);
  put("elsewhere/secret.md", "TOP SECRET");

  try {
    const at = (path: string) => join(root, intents, path);
    symlinkSync(at(SECOND), at(LINKED), "dir");
    symlinkSync(at("does-not-exist"), at("261015-broken"), "dir");
    symlinkSync(at(`${SECOND}/aidlc-state.md`), at("261015-file-link"), "file");
    symlinkSync(join(root, "secret.txt"), at(`${RECORD}/construction/leak.md`), "file");
    symlinkSync(join(root, "elsewhere"), at(`${RECORD}/construction/leak-dir`), "dir");
    symlinkSync(at(RECORD), at(`${RECORD}/construction/loop`), "dir");
    symlinks = true;
  } catch {
    symlinks = false; // Windows without symlink privilege: those cases skip.
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const record = () => recordDir(root, SPACE, RECORD)!;

describe("workspace: discovery", () => {
  test("finds records by their state file, following symlinked records", async () => {
    const found = (await discoverIntents(root)).map((i) => i.record);
    expect(found).toEqual(symlinks ? [RECORD, LINKED, SECOND] : [RECORD, SECOND]);
  });

  test("a workspace with no aidlc/ tree has no intents", async () => {
    expect(await discoverIntents(join(root, "nope"))).toEqual([]);
  });

  test("a space or record name is one plain path segment", () => {
    for (const name of ["default", "261014-sample", "a.b_c-1"]) expect(isSafeSegment(name)).toBe(true);
    for (const name of ["", ".", "..", ".hidden", "a/b", "a\\b", "../x", "x y"]) expect(isSafeSegment(name)).toBe(false);
    expect(recordDir(root, "..", RECORD)).toBeNull();
    expect(recordDir(root, SPACE, "../../..")).toBeNull();
  });
});

describe("workspace: reads", () => {
  test("reads only .md audit shards", async () => {
    expect(await readAuditShards(record())).toEqual([AUDIT]);
    expect(await readAuditShards(join(root, "nope"))).toEqual([]);
  });

  test("lists artifacts without engine state and without following symlinks", async () => {
    const paths = (await listArtifacts(record())).map((a) => a.relPath);
    expect(paths).toEqual([
      "aidlc-state.md",
      "audit",
      "audit/host-clone.md",
      "audit/notes.txt",
      "construction",
      "construction/code-generation",
      "construction/code-generation/notes.md",
      "construction/code-generation/plan.json",
    ]);
  });

  test("reads a file inside the record", async () => {
    expect(await readArtifactFile(record(), "construction/code-generation/plan.json")).toBe('{"a":1}\n');
  });

  test("refuses paths that leave the record lexically", async () => {
    for (const path of ["", "../../../../secret.txt", "construction/../../x", "/etc/passwd", "\\windows", join(root, "secret.txt")]) {
      await expect(readArtifactFile(record(), path)).rejects.toBeInstanceOf(PathOutsideRecordError);
    }
  });

  test("refuses a symlink that points out of the record", async () => {
    if (!symlinks) return;
    await expect(readArtifactFile(record(), "construction/leak.md")).rejects.toBeInstanceOf(PathOutsideRecordError);
    await expect(readArtifactFile(record(), "construction/leak-dir/secret.md")).rejects.toBeInstanceOf(PathOutsideRecordError);
  });

  test("a missing file or a directory is ENOENT", async () => {
    await expect(readArtifactFile(record(), "construction/missing.md")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readArtifactFile(record(), "construction")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("server", () => {
  const handler = () => createHandler({ workspaceRoot: root });
  const get = async (path: string, host = "127.0.0.1:4178") => {
    const response = await handler()(new Request(`http://127.0.0.1:4178${path}`, { headers: { host } }));
    const type = response.headers.get("content-type") ?? "";
    return { status: response.status, headers: response.headers, body: type.includes("json") ? await response.json() : await response.text() };
  };
  const intent = `/api/intents/${SPACE}/${RECORD}`;
  const file = (path: string) => `${intent}/artifacts/file?path=${encodeURIComponent(path)}`;

  test("the overview lists every intent with its progress", async () => {
    const { status, body } = await get("/api/intents");
    expect(status).toBe(200);
    const sample = body.intents.find((i: { record: string }) => i.record === RECORD);
    expect(sample).toEqual({
      space: SPACE,
      record: RECORD,
      title: "Sample visualization server",
      phase: "CONSTRUCTION",
      currentStage: "code-generation",
      status: "Running",
      scope: "poc",
      progress: { done: 1, total: 2, fraction: 0.5 },
    });
  });

  test("the graph route returns phase columns with each stage's label", async () => {
    const { status, body } = await get(`${intent}/graph`);
    expect(status).toBe(200);
    expect(body.phases.map((p: { phase: string }) => p.phase)).toEqual(["ideation", "construction"]);
    expect(body.phases[1].stages[0]).toMatchObject({ slug: "code-generation", state: "awaiting-approval", label: "[?] Awaiting approval" });
  });

  test("the decisions route returns the record's decisions", async () => {
    const { body } = await get(`${intent}/decisions`);
    expect(body.decisions).toEqual([
      { timestamp: "2026-10-16T09:55:00Z", event: "GATE_APPROVED", stage: "intent-capture", summary: "Gate approved: Approve" },
    ]);
  });

  test("the artifacts route lists the record's files", async () => {
    const { body } = await get(`${intent}/artifacts`);
    expect(body.artifacts).toContainEqual({ relPath: "construction/code-generation/notes.md", name: "notes.md", type: "file", size: 35 });
  });

  test("a Markdown artifact comes with safe HTML; other files with text only", async () => {
    const md = await get(file("construction/code-generation/notes.md"));
    expect(md.status).toBe(200);
    expect(md.body.html).toBe("<h1>Notes</h1><p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    const json = await get(file("construction/code-generation/plan.json"));
    expect(json.body.content).toBe('{"a":1}\n');
    expect(json.body.html).toBeUndefined();
  });

  test("an unknown intent is 404, and so is a name that is not a plain segment", async () => {
    expect((await get(`/api/intents/${SPACE}/no-such-record/graph`)).status).toBe(404);
    expect((await get("/api/intents/default/not-a-record/graph")).status).toBe(404);
    // %2E%2E%2F decodes to "../": it must not reach elsewhere/.
    const encoded = `/api/intents/${encodeURIComponent("../../..")}/elsewhere/artifacts/file?path=secret.md`;
    const response = await get(encoded);
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain("TOP SECRET");
    expect((await get("/api/intents/%E0%A4%A/x/graph")).status).toBe(400);
  });

  test("file reads outside the record are 400; a missing path is 400; a missing file is 404", async () => {
    expect((await get(file("../../../../secret.txt"))).body).toEqual({ error: "invalid path" });
    expect((await get(file("/etc/passwd"))).status).toBe(400);
    expect((await get(`${intent}/artifacts/file`)).status).toBe(400);
    expect((await get(file("construction/missing.md"))).status).toBe(404);
    if (symlinks) expect((await get(file("construction/leak.md"))).status).toBe(400);
  });

  test("serves the browser view with a CSP, and nothing else from disk", async () => {
    const page = await get("/");
    expect(page.status).toBe(200);
    expect(page.body).toContain('<script src="app.js"></script>');
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect((await get("/app.js")).headers.get("content-type")).toContain("javascript");
    expect((await get("/styles.css")).status).toBe(200);
    expect((await get("/server.ts")).status).toBe(404);
    expect((await get("/../workspace.ts")).status).toBe(404);
  });

  test("refuses a Host that is not loopback and any method but GET or HEAD", async () => {
    for (const host of ["127.0.0.1:4178", "localhost:4178", "[::1]:4178", "localhost"]) {
      expect((await get("/api/health", host)).status).toBe(200);
    }
    for (const host of ["evil.example:4178", "127.0.0.1.evil.example", ""]) {
      expect((await get("/api/intents", host)).status).toBe(403);
    }
    const post = await handler()(new Request("http://127.0.0.1:4178/api/intents", { method: "POST", headers: { host: "127.0.0.1" } }));
    expect(post.status).toBe(405);
  });

  test("answers over a real loopback socket", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler() });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
      expect(await response.json()).toEqual({ ok: true, workspaceRoot: root });
    } finally {
      await server.stop(true);
    }
  });
});

describe("resolveConfig", () => {
  test("defaults to port 4178 and the current directory", () => {
    expect(resolveConfig({}, "/work/project")).toEqual({ port: DEFAULT_PORT, workspaceRoot: resolve("/work/project") });
  });

  test("takes PORT and AIDLC_WORKSPACE_ROOT, resolving a relative root against the current directory", () => {
    expect(resolveConfig({ PORT: "5000", AIDLC_WORKSPACE_ROOT: " ../other " }, "/work/project")).toEqual({
      port: 5000,
      workspaceRoot: resolve("/work/other"),
    });
  });

  test("an invalid PORT falls back to the default", () => {
    for (const PORT of ["", "abc", "0", "70000", "1.5"]) expect(resolveConfig({ PORT }, "/w").port).toBe(DEFAULT_PORT);
  });
});
