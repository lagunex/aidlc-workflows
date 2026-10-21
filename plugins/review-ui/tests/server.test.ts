// The HTTP surface in process, against real projects on disk: every route's
// answer; every refusal (400, 403, 404, 405, 413, 415) with its fixed sentence;
// the security headers and caching on every status; the request checks in
// order (peer, then Host, then method); the /ws origin check; hostile
// Markdown, and heading ids that never clash with the app's own; confinement
// (lexical, the engine's names at a record's top level in any case, Windows
// names, symlinks and junctions out of the record, a codekb/ that is itself a
// link); open confirmations counted as answers to give; an archived intent's
// words; and that nothing the server opens is outside aidlc/spaces/ or changes
// a file on disk.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deterministicCaseTimeoutMs } from "../../../tests/harness/test-budget.ts";
import { renderMarkdown } from "../tools/review-ui/render.ts";
import { createHandler, isAllowedHost, isLoopback, type ServerLike } from "../tools/review-ui/server.ts";
import type {
  DecisionsPayload,
  QuestionsPayload,
  RenderPayload,
  TreePayload,
  WorkflowPayload,
  WorkspacePayload,
} from "../tools/review-ui/types.ts";

setDefaultTimeout(deterministicCaseTimeoutMs());

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "aidlc-ui");
const RECORD = "261020-sample";
const LINKED = "261021-linked";
const OTHER = "261019-other";
const BASE = `aidlc/spaces/default/intents/${RECORD}`;
const WINDOWS = process.platform === "win32";

let root = "";
let outside = "";
let publicDir = "";
// A project whose unit and codekb store are named "audit", with an archived intent.
let unitsRoot = "";
// A project whose codekb/ is a link to a folder outside it.
let linkedKbRoot = "";
let kbOutside = "";
let symlinks = false;
let fileSymlinks = false;
let kbLinked = false;
const before = new Map<string, number>();

const UNITS = "261022-units";
const ARCHIVED = "261023-archived";
const UNITS_BASE = `aidlc/spaces/default/intents/${UNITS}`;
const KB_RECORD = "261024-kb";

function put(base: string, path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(join(base, path)), { recursive: true });
  writeFileSync(join(base, path), content);
}

const STATE = `# AI-DLC State Tracking

## Project Information
- **Project**: Sample served project
- **Scope**: feature

## Stage Progress
### INCEPTION PHASE
- [x] requirements-analysis — EXECUTE
- [?] user-stories — EXECUTE
- [ ] reverse-engineering — SKIP

### CONSTRUCTION PHASE
- [ ] code-generation — EXECUTE

## Current Status
- **Lifecycle Phase**: INCEPTION
- **Current Stage**: user-stories
- **Next Stage**: code-generation
- **Status**: Running
- **Last Updated**: 2026-10-20T10:00:00Z
`;

const AUDIT = [
  "## Stage Start\n**Timestamp**: 2026-10-20T08:00:00Z\n**Event**: STAGE_STARTED\n**Stage**: requirements-analysis",
  "## Gate Approved\n**Timestamp**: 2026-10-20T09:00:00Z\n**Event**: GATE_APPROVED\n**Stage**: requirements-analysis\n**User Input**: Approve",
  "## Stage Start\n**Timestamp**: 2026-10-20T09:10:00Z\n**Event**: STAGE_STARTED\n**Stage**: user-stories",
  "## Stage Awaiting Approval\n**Timestamp**: 2026-10-20T09:30:00Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: user-stories",
].join("\n\n---\n\n");

const HOSTILE = `# Search

## Header

## Main

## Main

<script>alert(1)</script>

<!-- a hidden comment -->

Inline <img src=x onerror="alert(1)"> and <b>bold</b> and a <br> break.

[js](javascript:alert(1)) [web](https://example.com/a?b=1&c=2) [mail](mailto:a@b.c)

[sibling](stories.md) [up](../requirements-analysis/requirements.md) [state](../../aidlc-state.md)
[escape](../../../../../../secret.md) [dir](../requirements-analysis/) [anchor](#main)

![diagram](https://example.com/x.png) ![local](stories.md)

\`\`\`mermaid
graph TD; A-->B
\`\`\`

\`<!-- kept in code -->\`

Owner: <jane@example.com> and [Jane](jane@example.com)

[![linked](diagram.png)](stories.md) [![badge](https://example.com/b.svg)](https://example.com/ci)

Owner: Jane${"  "}
Team: Payments\\
Room: 4
`;

const QUESTIONS = `# User Stories — Questions

## Q1. [Product owner] Who reads it?

- A. Me
- B. My team

[Answer]: B

## Q2. How often?

[Answer]:

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct
`;

function stateOf(rows: string, current: string, status = "Running"): string {
  return [
    "# AI-DLC State Tracking",
    "",
    "## Project Information",
    "- **Project**: A served project",
    "- **Scope**: feature",
    "",
    "## Stage Progress",
    rows,
    "",
    "## Current Status",
    `- **Current Stage**: ${current}`,
    `- **Status**: ${status}`,
    "- **Last Updated**: 2026-10-22T10:00:00Z",
    "",
  ].join("\n");
}

beforeAll(() => {
  // macOS temp roots may be reached through /var -> /private/var.
  root = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-review-ui-")));
  outside = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-review-ui-")));
  publicDir = join(root, "public");
  put(root, "aidlc/active-space", "default\n");
  put(root, "aidlc/spaces/default/intents/active-intent", `${RECORD}\n`);
  put(root, "aidlc/spaces/default/intents/intents.json", JSON.stringify([{ uuid: "u1", slug: "sample", dirName: RECORD, scope: "feature", status: "in-flight" }]));
  put(root, `${BASE}/aidlc-state.md`, STATE);
  put(root, `${BASE}/audit/clone-a.md`, AUDIT);
  put(root, `${BASE}/runtime-graph.json`, "{}");
  put(root, `${BASE}/.aidlc-engine/secret.json`, "TOP SECRET");
  put(root, `${BASE}/inception/requirements-analysis/requirements.md`, "# Requirements\n\nFR1.\n");
  put(root, `${BASE}/inception/user-stories/stories.md`, HOSTILE);
  put(root, `${BASE}/inception/user-stories/user-stories-questions.md`, QUESTIONS);
  put(root, `${BASE}/inception/user-stories/memory.md`, "# Diary\n");
  put(root, `${BASE}/inception/user-stories/reviews/review-01.md`, "## Review\n\n**Verdict:** READY\n**Date:** 2026-10-20T09:20:00Z\n");
  put(root, `${BASE}/inception/user-stories/notes.json`, '{"a":1}\n');
  put(root, `${BASE}/inception/user-stories/big.md`, new Uint8Array(4 * 1024 * 1024 + 1).fill(97));
  put(root, `${BASE}/inception/user-stories/binary.md`, new Uint8Array([35, 32, 104, 0, 105]));
  put(root, `${BASE}/inception/user-stories/latin1.md`, new Uint8Array([35, 32, 0xe9, 0xe8]));
  // Windows cannot create a file with a device name; elsewhere it is an ordinary file.
  if (!WINDOWS) put(root, `${BASE}/inception/user-stories/con.md`, "a Windows device name");
  put(root, `${BASE}/inception/user-stories/.hidden.md`, "hidden");
  put(root, `aidlc/spaces/default/intents/${OTHER}/aidlc-state.md`, STATE.replace("[?] user-stories", "[x] user-stories"));
  put(root, `aidlc/spaces/default/intents/${OTHER}/notes.md`, "other record");
  put(root, "aidlc/spaces/default/intents/not-a-record/readme.md", "no state file");
  put(root, "aidlc/spaces/default/codekb/repo/architecture.md", "# Architecture\n\n[component](component-inventory.md)\n");
  put(root, "aidlc/spaces/default/codekb/repo/component-inventory.md", "# Components\n");
  put(root, "secret.txt", "TOP SECRET");
  put(outside, "record/aidlc-state.md", STATE.replace("[?] user-stories", "[-] user-stories"));
  put(outside, "record/inception/user-stories/stories.md", "# Linked stories\n");
  put(outside, "leak.md", "TOP SECRET");
  put(outside, "leakdir/secret.md", "TOP SECRET");

  put(publicDir, "index.html", "<!doctype html><title>AI-DLC Workflows · read-only</title>");
  put(publicDir, "app.js", "export {};\n");
  put(publicDir, "styles.css", "body{}\n");
  put(publicDir, "LICENSE.txt", "MIT\n");
  put(publicDir, ".hidden.js", "secret\n");
  put(publicDir, "notes.md", "not an asset type\n");

  try {
    // Junctions need no privilege on Windows, so directory links work there too.
    symlinkSync(join(outside, "record"), join(root, `aidlc/spaces/default/intents/${LINKED}`), "junction");
    symlinkSync(join(outside, "leakdir"), join(root, `${BASE}/inception/user-stories/leakdir`), "junction");
    symlinkSync(join(root, `${BASE}/inception/requirements-analysis`), join(root, `${BASE}/inception/user-stories/inner`), "junction");
    symlinks = true;
  } catch {
    symlinks = false;
  }
  try {
    symlinkSync(join(outside, "leak.md"), join(root, `${BASE}/inception/user-stories/leak.md`), "file");
    symlinkSync(join(outside, "leak.md"), join(publicDir, "linked.js"), "file");
    fileSymlinks = true;
  } catch {
    fileSymlinks = false;
  }

  unitsRoot = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-review-ui-")));
  put(unitsRoot, `${UNITS_BASE}/aidlc-state.md`, stateOf("### CONSTRUCTION PHASE\n- [x] functional-design — EXECUTE\n- [-] code-generation — EXECUTE", "code-generation"));
  put(unitsRoot, `${UNITS_BASE}/audit/clone-a.md`, "## Stage Start\n**Timestamp**: 2026-10-22T08:00:00Z\n**Event**: STAGE_STARTED\n**Stage**: code-generation");
  put(unitsRoot, `${UNITS_BASE}/construction/audit/functional-design/business-logic.md`, "# Business logic\n");
  put(unitsRoot, `${UNITS_BASE}/construction/audit/code-generation/code-generation-questions.md`, "## Plan Approval\n\n- A. Approve Plan\n- B. Request Changes\n\n[Answer]:\n");
  put(unitsRoot, `${UNITS_BASE}/construction/billing/functional-design/rules.md`, "# Rules\n\n[the audit unit's logic](../../audit/functional-design/business-logic.md)\n");
  put(
    unitsRoot,
    `${UNITS_BASE}/construction/billing/code-generation/code-generation-questions.md`,
    "## Q1. One\n\n- A. x\n\n[Answer]: A\n\n## Consolidated Summary Confirmation\n\n[Answer]:\n",
  );
  put(unitsRoot, "aidlc/spaces/default/codekb/audit/architecture.md", "# Architecture\n");
  put(unitsRoot, `aidlc/spaces/default/intents/${ARCHIVED}/aidlc-state.md`, stateOf("### INCEPTION PHASE\n- [x] requirements-analysis — EXECUTE\n- [?] user-stories — EXECUTE", "user-stories", "Archived"));
  put(unitsRoot, `aidlc/spaces/default/intents/${ARCHIVED}/inception/user-stories/user-stories-questions.md`, "## Q1. Still open\n\n[Answer]:\n");

  linkedKbRoot = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-review-ui-")));
  kbOutside = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-review-ui-")));
  put(linkedKbRoot, `aidlc/spaces/default/intents/${KB_RECORD}/aidlc-state.md`, stateOf("### INCEPTION PHASE\n- [x] reverse-engineering — EXECUTE\n- [-] requirements-analysis — EXECUTE", "requirements-analysis"));
  put(kbOutside, "kb/secret.md", "TOP SECRET");
  try {
    symlinkSync(join(kbOutside, "kb"), join(linkedKbRoot, "aidlc/spaces/default/codekb"), "junction");
    kbLinked = true;
  } catch {
    kbLinked = false;
  }
  for (const base of [root, outside, FIXTURE, unitsRoot, linkedKbRoot, kbOutside]) snapshot(base, before);
});

afterAll(() => {
  for (const dir of [root, outside, unitsRoot, linkedKbRoot, kbOutside]) if (dir) rmSync(dir, { recursive: true, force: true });
});

function snapshot(base: string, into: Map<string, number>): void {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const path = join(base, entry.name);
    if (entry.isSymbolicLink()) continue;
    into.set(path, statSync(path).mtimeMs);
    if (entry.isDirectory()) snapshot(path, into);
  }
}

function fakeServer(address: string | null = "127.0.0.1", upgraded = true): ServerLike & { upgrades: number } {
  const server = {
    upgrades: 0,
    port: 4790,
    requestIP: () => (address === null ? null : { address }),
    upgrade: () => {
      server.upgrades += 1;
      return upgraded;
    },
  };
  return server;
}

const handler = (platform?: NodeJS.Platform, projectDir = root) => createHandler({ projectDir, version: "9.9.9", publicDir, platform });

interface Answer {
  status: number;
  headers: Headers;
  text: string;
  json: () => unknown;
}

async function call(
  path: string,
  options: {
    method?: string;
    host?: string;
    peer?: string | null;
    headers?: Record<string, string>;
    platform?: NodeJS.Platform;
    server?: ServerLike;
    projectDir?: string;
  } = {},
): Promise<Answer> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.host !== "") headers.host = options.host ?? "127.0.0.1:4790";
  const request = new Request(`http://127.0.0.1:4790${path}`, { method: options.method ?? "GET", headers });
  const response = handler(options.platform, options.projectDir).fetch(request, options.server ?? fakeServer(options.peer === undefined ? "127.0.0.1" : options.peer));
  if (!response) return { status: 101, headers: new Headers(), text: "", json: () => null };
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, json: () => JSON.parse(text) };
}

const q = (params: Record<string, string>) => `?${new URLSearchParams(params)}`;
const sel = { space: "default", intent: RECORD };
const file = (path: string, extra: Record<string, string> = {}) => q({ ...sel, path, ...extra });

function expectSecurityHeaders(answer: Answer, cache: "no-store" | "no-cache", host = "127.0.0.1:4790"): void {
  expect(answer.headers.get("content-security-policy")).toBe(
    `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' ws://${host}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
  expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
  expect(answer.headers.get("referrer-policy")).toBe("no-referrer");
  expect(answer.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  expect(answer.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(answer.headers.get("cache-control")).toBe(cache);
}

describe("request checks, in order", () => {
  test("only this machine's addresses are answered", async () => {
    for (const address of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"]) expect(isLoopback(address), address).toBe(true);
    for (const address of ["10.0.0.1", "192.168.1.5", "::ffff:10.0.0.1", "fe80::1", "", "1270.0.0.1"]) expect(isLoopback(address), address).toBe(false);
    for (const peer of ["192.168.1.5", null]) {
      const answer = await call("/api/health", { peer });
      expect(answer.status).toBe(403);
      expect(answer.json()).toEqual({ error: "The Review UI only answers this computer." });
      expectSecurityHeaders(answer, "no-store");
    }
  });

  test("a Host that is not a loopback name gets a page naming the right address", async () => {
    for (const host of ["127.0.0.1:4790", "localhost:4790", "[::1]:4790", "localhost", "LOCALHOST:4790"]) expect(isAllowedHost(host), host).toBe(true);
    for (const host of ["evil.example:4790", "127.0.0.1.evil.example", "", "localhost:99999", "127.0.0.2:4790"]) expect(isAllowedHost(host), host).toBe(false);
    for (const host of ["evil.example:4790", "127.0.0.1.evil.example"]) {
      const answer = await call("/api/workspace", { host });
      expect(answer.status).toBe(403);
      expect(answer.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(answer.text).toContain("<title>Open the Review UI at its own address</title>");
      expect(answer.text).toContain("This page only answers at http://127.0.0.1:4790/. Open that address instead.");
      expect(answer.text).not.toContain("evil");
      expectSecurityHeaders(answer, "no-store");
    }
    // The peer is judged before the Host.
    expect((await call("/api/health", { host: "evil.example", peer: "10.0.0.1" })).headers.get("content-type")).toContain("json");
  });

  test("only GET and HEAD are answered", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const answer = await call("/api/workspace", { method });
      expect(answer.status, method).toBe(405);
      expect(answer.headers.get("allow")).toBe("GET, HEAD");
      expect(answer.json()).toEqual({ error: "The Review UI only reads; it does not accept changes." });
      expectSecurityHeaders(answer, "no-store");
    }
    const head = await call("/api/health", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.text).toBe("");
    expectSecurityHeaders(head, "no-store");
  });

  test("every answer carries the headers, with the validated Host in connect-src", async () => {
    for (const [path, cache] of [
      ["/", "no-cache"],
      ["/assets/app.js", "no-cache"],
      ["/api/health", "no-store"],
      ["/api/workspace", "no-store"],
      ["/nope", "no-store"],
      [`/api/render${file(`${BASE}/inception/user-stories/big.md`)}`, "no-store"],
    ] as const) {
      expectSecurityHeaders(await call(path, { host: "localhost:4790" }), cache, "localhost:4790");
    }
  });
});

describe("the page and its files", () => {
  test("the shell and the allow-listed assets, typed", async () => {
    for (const path of ["/", "/index.html"]) {
      const page = await call(path);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(page.text).toContain("AI-DLC Workflows");
    }
    expect((await call("/assets/app.js")).headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect((await call("/assets/styles.css")).headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect((await call("/assets/LICENSE.txt")).headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  test("nothing else is served from the folder", async () => {
    for (const path of ["/assets/.hidden.js", "/assets/notes.md", "/assets/index.html", "/assets/../server.ts", "/assets/%2e%2e%2fserver.ts", "/assets/", "/server.ts", "/assets/%E0%A4%A"]) {
      const answer = await call(path);
      expect(answer.status, path).toBe(404);
      expect(answer.json()).toEqual({ error: "Not found." });
    }
    if (fileSymlinks) expect((await call("/assets/linked.js")).status).toBe(404);
  });
});

describe("the routes", () => {
  test("health names the version", async () => {
    expect((await call("/api/health")).json()).toEqual({ ok: true, version: "9.9.9" });
  });

  test("workspace lists the space's intents, linked ones too, and the cursor's", async () => {
    const answer = await call("/api/workspace");
    expect(answer.status).toBe(200);
    const body = answer.json() as WorkspacePayload;
    expect(body.project).toBe(basename(root));
    expect(body.space).toBe("default");
    expect(body.spaces).toEqual([{ name: "default", intents: symlinks ? 3 : 2, needs_you: 1 }]);
    // All three were updated at the same moment, so the newer folder name comes first.
    expect(body.intents.map((intent) => intent.record)).toEqual(symlinks ? [LINKED, RECORD, OTHER] : [RECORD, OTHER]);
    expect(body.intents.find((intent) => intent.record === RECORD)).toMatchObject({
      label: "sample",
      group: "needs-you",
      needs: { kind: "gate", label: "Review approval gate" },
      current_stage: "user-stories",
      current_stage_name: "User Stories",
    });
    expect(body.selected_intent).toBe(RECORD);
    expect(body.sentence).toEqual({ text: "1 item needs you", tone: "needs" });
    expect((await call("/api/workspace?space=nope")).json()).toEqual({ error: "That space or intent was not found." });
  });

  test("workflow describes the intent; a bad selection is 400", async () => {
    const answer = await call(`/api/workflow${q(sel)}`);
    expect(answer.status).toBe(200);
    const body = answer.json() as WorkflowPayload;
    expect(body).toMatchObject({ intent: RECORD, current_stage: "user-stories", next_stage: "code-generation", stages_total: 3, stages_done: 1 });
    const stories = body.phases[0].stages.find((stage) => stage.slug === "user-stories");
    expect(stories).toMatchObject({
      word: "in-review",
      label: "in review · r1",
      is_current: true,
      questions: { total: 2, open: 1, open_answers: 1, sections: ["summary confirmed"] },
    });
    expect(stories?.diary?.path).toBe(`${BASE}/inception/user-stories/memory.md`);
    expect(stories?.reviews.map((review) => review.name)).toEqual(["review-01.md"]);
    expect(stories?.artifacts.map((artifact) => artifact.name)).toEqual(expect.arrayContaining(["stories.md", "notes.json"]));
    expect(stories?.artifacts.some((artifact) => artifact.name.startsWith(".") || artifact.name === "leak.md")).toBe(false);
    const refusedSelections: Array<Record<string, string>> = [
      {},
      { space: "default" },
      { space: "nope", intent: RECORD },
      { space: "default", intent: "nope" },
      { space: "default", intent: "not-a-record" },
      { space: "..", intent: RECORD },
      { space: "default", intent: `../${RECORD}` },
    ];
    for (const query of refusedSelections) {
      const refused = await call(`/api/workflow${q(query)}`);
      expect(refused.status, JSON.stringify(query)).toBe(400);
      expect(refused.json()).toEqual({ error: "That space or intent was not found." });
    }
  });

  test("a linked record reads like any other", async () => {
    if (!symlinks) return;
    const body = (await call(`/api/workflow${q({ space: "default", intent: LINKED })}`)).json() as WorkflowPayload;
    expect(body.current_stage).toBe("user-stories");
    const rendered = await call(`/api/render${q({ space: "default", intent: LINKED, path: `aidlc/spaces/default/intents/${LINKED}/inception/user-stories/stories.md` })}`);
    expect(rendered.status).toBe(200);
    expect((rendered.json() as RenderPayload).html).toContain("Linked stories");
  });

  test("tree lists the record without hidden names or links, each file with its kind; codekb is a second root", async () => {
    const body = (await call(`/api/tree${q(sel)}`)).json() as TreePayload;
    const paths = body.entries.map((entry) => entry.path);
    expect(body.root).toBe("record");
    expect(paths).toContain(`${BASE}/inception/user-stories/stories.md`);
    const depth = BASE.split("/").length;
    for (const hidden of ["aidlc-state.md", "audit", "runtime-graph.json"]) {
      expect(paths.some((path) => path.split("/")[depth] === hidden), hidden).toBe(false);
    }
    for (const hidden of [".aidlc-engine", ".hidden.md", "leak.md", "leakdir", "inner"]) {
      expect(paths.some((path) => path.split("/").includes(hidden)), hidden).toBe(false);
    }
    expect(body.entries.find((entry) => entry.type === "dir")?.size).toBeUndefined();
    expect(body.entries.find((entry) => entry.type === "dir")?.kind).toBeUndefined();
    const kinds = new Map(body.entries.map((entry) => [entry.name, entry.kind]));
    expect([kinds.get("stories.md"), kinds.get("notes.json")]).toEqual(["markdown", "text"]);
    const codekb = (await call(`/api/tree${q({ ...sel, root: "codekb" })}`)).json() as TreePayload;
    expect(codekb.entries.map((entry) => entry.path)).toEqual([
      "aidlc/spaces/default/codekb/repo",
      "aidlc/spaces/default/codekb/repo/architecture.md",
      "aidlc/spaces/default/codekb/repo/component-inventory.md",
    ]);
    expect((await call(`/api/tree${q({ ...sel, root: "elsewhere" })}`)).status).toBe(400);
  });

  test("render turns Markdown into safe HTML with md- heading ids and an outline", async () => {
    const answer = await call(`/api/render${file(`${BASE}/inception/user-stories/stories.md`)}`);
    expect(answer.status).toBe(200);
    const body = answer.json() as RenderPayload;
    expect(body.kind).toBe("markdown");
    expect(body.outline).toEqual([
      { level: 1, text: "Search", id: "md-search" },
      { level: 2, text: "Header", id: "md-header" },
      { level: 2, text: "Main", id: "md-main" },
      { level: 2, text: "Main", id: "md-main-1" },
    ]);
    const html = body.html;
    expect(html).toContain('<h1 id="md-search">Search</h1>');
    expect(html).not.toMatch(/<(script|img|b|iframe)[\s>]/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("a hidden comment");
    expect(html).toContain("a <br> break");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer nofollow" target="_blank">web</a>');
    expect(html).toContain(`<a href="#" data-open-path="${BASE}/inception/user-stories/stories.md">sibling</a>`);
    expect(html).toContain(`<a href="#" data-open-path="${BASE}/inception/requirements-analysis/requirements.md">up</a>`);
    expect(html).toContain('<span class="md-link" title="../../aidlc-state.md">state</span>');
    expect(html).toContain('<span class="md-link" title="../../../../../../secret.md">escape</span>');
    expect(html).toContain('<span class="md-link" title="../requirements-analysis/">dir</span>');
    expect(html).toContain('<a href="#md-main">anchor</a>');
    expect(html).toContain('<a href="https://example.com/x.png" rel="noopener noreferrer nofollow" target="_blank">diagram</a>');
    expect(html).toContain(`<a href="#" data-open-path="${BASE}/inception/user-stories/stories.md">local</a>`);
    expect(html).toContain('<pre class="mermaid"><code>graph TD; A--&gt;B\n</code></pre>');
    expect(html).toContain("<code>&lt;!-- kept in code --&gt;</code>");
    // An email autolink mails; a written link to the same address is a relative link, as CommonMark reads it.
    expect(html).toContain('<a href="mailto:jane@example.com" rel="noopener noreferrer nofollow" target="_blank">jane@example.com</a>');
    expect(html).toContain(`<a href="#" data-open-path="${BASE}/inception/user-stories/jane@example.com">Jane</a>`);
    // A linked image is one link, to the link's target, with the image's text.
    expect(html).toContain(`<p><a href="#" data-open-path="${BASE}/inception/user-stories/stories.md">linked</a> <a href="https://example.com/ci" rel="noopener noreferrer nofollow" target="_blank">badge</a></p>`);
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<a /s);
    expect(html).toContain("<p>Owner: Jane<br>Team: Payments<br>Room: 4</p>");
    expect(body.path).toBe(`${BASE}/inception/user-stories/stories.md`);
    expect(body.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("render shows other text as one block, and codekb documents link to their siblings", async () => {
    const text = (await call(`/api/render${file(`${BASE}/inception/user-stories/notes.json`)}`)).json() as RenderPayload;
    expect(text).toMatchObject({ kind: "text", html: '<pre><code>{&quot;a&quot;:1}\n</code></pre>', outline: [] });
    const codekb = (await call(`/api/render${file("aidlc/spaces/default/codekb/repo/architecture.md")}`)).json() as RenderPayload;
    expect(codekb.html).toContain('<a href="#" data-open-path="aidlc/spaces/default/codekb/repo/component-inventory.md">component</a>');
    expect((await call(`/api/render${file("aidlc/spaces/default/codekb/repo/architecture.md", { root: "codekb" })}`)).status).toBe(200);
    expect((await call(`/api/render${file("aidlc/spaces/default/codekb/repo/architecture.md", { root: "record" })}`)).status).toBe(400);
  });

  test("questions parses a questions file, and nothing else", async () => {
    const answer = await call(`/api/questions${file(`${BASE}/inception/user-stories/user-stories-questions.md`)}`);
    expect(answer.status).toBe(200);
    const body = answer.json() as QuestionsPayload;
    expect(body).toMatchObject({
      stage: "user-stories",
      stage_name: "User Stories",
      total: 2,
      answered: 1,
      open: 1,
      open_answers: 1,
      sentence: { text: "1 question for you", tone: "needs" },
    });
    expect(body.questions[0]).toMatchObject({ number: 1, role: "Product owner", chosen: "B" });
    expect(body.sections).toEqual([{ title: "Consolidated Summary Confirmation", state: "answered", answer: "Looks correct", note: "summary confirmed" }]);
    const refused = await call(`/api/questions${file(`${BASE}/inception/user-stories/stories.md`)}`);
    expect(refused.status).toBe(400);
    expect(refused.json()).toEqual({ error: "That path is not a file of this intent." });
  });

  test("decisions come newest first, for the intent or one stage", async () => {
    const body = (await call(`/api/decisions${q(sel)}`)).json() as DecisionsPayload;
    expect(body.entries.map((entry) => [entry.kind, entry.stage, entry.stage_name, entry.title])).toEqual([
      ["gate-opened", "user-stories", "User Stories", "Approval gate opened · r1"],
      ["review", "user-stories", "User Stories", "Review 1 · READY"],
      ["approved", "requirements-analysis", "Requirements Analysis", "Approved · r1"],
    ]);
    const one = (await call(`/api/decisions${q({ ...sel, stage: "requirements-analysis" })}`)).json() as DecisionsPayload;
    expect(one.entries.map((entry) => entry.kind)).toEqual(["approved"]);
    expect((await call(`/api/decisions${q({ ...sel, stage: "../x" })}`)).json()).toEqual({ error: "That stage or unit was not found." });
  });

  test("an unknown route is 404 JSON", async () => {
    for (const path of ["/api", "/api/nope", "/api/workspace/extra", "/favicon.ico", "/.git/config"]) {
      const answer = await call(path);
      expect(answer.status, path).toBe(404);
      expect(answer.json()).toEqual({ error: "Not found." });
    }
  });
});

describe("confinement", () => {
  const status = async (path: string, extra: Record<string, string> = {}, platform?: NodeJS.Platform) => {
    const answer = await call(`/api/render${file(path, extra)}`, { platform });
    return { status: answer.status, error: (answer.json() as { error?: string }).error };
  };

  test("a path that is not a plain path under the record is 400", async () => {
    for (const path of [
      "",
      `${BASE}`,
      `${BASE}/`,
      `${BASE}/inception/../aidlc-state.md`,
      `${BASE}/./inception/user-stories/stories.md`,
      `${BASE}//inception/user-stories/stories.md`,
      `${BASE}\\inception\\user-stories\\stories.md`,
      `${BASE}/inception/user-stories/stories.md\u0000.png`,
      `/${BASE}/inception/user-stories/stories.md`,
      "C:/Windows/win.ini",
      "/etc/passwd",
      "secret.txt",
      `aidlc/spaces/default/intents/${OTHER}/notes.md`,
      `aidlc/spaces/default/intents/${RECORD}-x/notes.md`,
      `${BASE}/inception/user-stories`,
    ]) {
      expect(await status(path), JSON.stringify(path)).toEqual({ status: 400, error: "That path is not a file of this intent." });
    }
  });

  test("hidden names are 403 in any letter case", async () => {
    for (const path of [
      `${BASE}/aidlc-state.md`,
      `${BASE}/AIDLC-STATE.MD`,
      `${BASE}/Aidlc-State.md`,
      `${BASE}/audit/clone-a.md`,
      `${BASE}/AUDIT/clone-a.md`,
      `${BASE}/runtime-graph.json`,
      `${BASE}/Runtime-Graph.JSON`,
      `${BASE}/.aidlc-engine/secret.json`,
      `${BASE}/inception/user-stories/.hidden.md`,
    ]) {
      expect(await status(path), path).toEqual({ status: 403, error: "That file is not shown in the Review UI." });
    }
  });

  test("Windows names are 403 where Windows would open another file", async () => {
    for (const path of [`${BASE}/aidlc-state.md.`, `${BASE}/aidlc-state.md `, `${BASE}/inception/user-stories/con.md`, `${BASE}/inception/user-stories/stories.md:secret`, `${BASE}/inception/LPT1/x.md`]) {
      expect(await status(path, {}, "win32"), path).toEqual({ status: 403, error: "That file is not shown in the Review UI." });
    }
    if (!WINDOWS) expect((await status(`${BASE}/inception/user-stories/con.md`, {}, "linux")).status).toBe(200);
  });

  test("a link inside the record is never followed, wherever it points", async () => {
    if (symlinks) {
      for (const path of [`${BASE}/inception/user-stories/leakdir/secret.md`, `${BASE}/inception/user-stories/inner/requirements.md`]) {
        expect(await status(path), path).toEqual({ status: 403, error: "That file is not shown in the Review UI." });
      }
    }
    if (fileSymlinks) expect(await status(`${BASE}/inception/user-stories/leak.md`)).toEqual({ status: 403, error: "That file is not shown in the Review UI." });
  });

  test("missing is 404, over 4 MiB is 413, not text is 415, all in fixed sentences", async () => {
    expect(await status(`${BASE}/inception/user-stories/missing.md`)).toEqual({ status: 404, error: "Not found." });
    expect(await status(`${BASE}/inception/nowhere/x.md`)).toEqual({ status: 404, error: "Not found." });
    expect(await status(`${BASE}/inception/user-stories/big.md`)).toEqual({ status: 413, error: "This file is over 4 MiB; open it in your editor." });
    expect(await status(`${BASE}/inception/user-stories/binary.md`)).toEqual({ status: 415, error: "This file is not text; open it in your editor." });
    expect(await status(`${BASE}/inception/user-stories/latin1.md`)).toEqual({ status: 415, error: "This file is not text; open it in your editor." });
  });

  test("no answer names a path outside aidlc/spaces/ or leaks a secret", async () => {
    const answers = [
      await call("/api/workspace"),
      await call(`/api/workflow${q(sel)}`),
      await call(`/api/tree${q(sel)}`),
      await call(`/api/tree${q({ ...sel, root: "codekb" })}`),
      await call(`/api/decisions${q(sel)}`),
      await call(`/api/render${file(`${BASE}/inception/user-stories/stories.md`)}`),
    ];
    for (const answer of answers) {
      expect(answer.text).not.toContain("TOP SECRET");
      expect(answer.text).not.toContain(root);
      expect(answer.text).not.toContain(outside);
      for (const path of answer.text.match(/"path":"[^"]*"/g) ?? []) expect(path).toMatch(/^"path":"aidlc\/spaces\//);
    }
  });
});

describe("an engine name below a record's top level", () => {
  const units = { space: "default", intent: UNITS };
  const at = (path: string, extra: Record<string, string> = {}) => q({ ...units, path, ...extra });
  const get = (path: string) => call(path, { projectDir: unitsRoot });

  test("a unit named audit is a unit: listed, counted and served", async () => {
    const workspace = (await get("/api/workspace")).json() as WorkspacePayload;
    expect(workspace.intents.find((intent) => intent.record === UNITS)).toMatchObject({ group: "needs-you", needs: { kind: "questions", label: "2 questions" } });
    const workflow = (await get(`/api/workflow${q(units)}`)).json() as WorkflowPayload;
    const stages = workflow.phases.flatMap((phase) => phase.stages);
    const codeGeneration = stages.find((stage) => stage.slug === "code-generation");
    expect(codeGeneration?.word).toBe("questions");
    // An open confirmation or plan approval is an answer still to give, as an open question is.
    expect(codeGeneration?.units.map((unit) => [unit.unit, unit.questions])).toEqual([
      [
        "audit",
        {
          path: `${UNITS_BASE}/construction/audit/code-generation/code-generation-questions.md`,
          total: 0,
          answered: 0,
          open: 0,
          open_answers: 1,
          sections: ["waiting for your approval of the plan"],
        },
      ],
      [
        "billing",
        {
          path: `${UNITS_BASE}/construction/billing/code-generation/code-generation-questions.md`,
          total: 1,
          answered: 1,
          open: 0,
          open_answers: 1,
          sections: ["waiting for you to confirm the summary"],
        },
      ],
    ]);
    expect(stages.find((stage) => stage.slug === "functional-design")?.units.map((unit) => [unit.unit, unit.artifacts.map((file) => file.name)])).toEqual([
      ["audit", ["business-logic.md"]],
      ["billing", ["rules.md"]],
    ]);
    const tree = ((await get(`/api/tree${q(units)}`)).json() as TreePayload).entries.map((entry) => entry.path);
    expect(tree).toContain(`${UNITS_BASE}/construction/audit/functional-design/business-logic.md`);
    expect(tree.some((path) => path.startsWith(`${UNITS_BASE}/audit`))).toBe(false);
    expect((await get(`/api/render${at(`${UNITS_BASE}/construction/audit/functional-design/business-logic.md`)}`)).status).toBe(200);
    const linking = (await get(`/api/render${at(`${UNITS_BASE}/construction/billing/functional-design/rules.md`)}`)).json() as RenderPayload;
    expect(linking.html).toContain(`data-open-path="${UNITS_BASE}/construction/audit/functional-design/business-logic.md"`);
    const questions = await get(`/api/questions${at(`${UNITS_BASE}/construction/audit/code-generation/code-generation-questions.md`)}`);
    expect(questions.status).toBe(200);
    expect(questions.json()).toMatchObject({
      stage: "code-generation",
      stage_name: "Code Generation",
      total: 0,
      open: 0,
      open_answers: 1,
      sentence: { text: "1 question for you", tone: "needs" },
    });
  });

  test("the record's own audit folder and state file are still refused, in any letter case", async () => {
    for (const path of [`${UNITS_BASE}/audit/clone-a.md`, `${UNITS_BASE}/AUDIT/clone-a.md`, `${UNITS_BASE}/Aidlc-State.md`]) {
      const answer = await get(`/api/render${at(path)}`);
      expect(answer.status, path).toBe(403);
      expect(answer.json()).toEqual({ error: "That file is not shown in the Review UI." });
    }
  });

  test("a codekb store named audit is listed and served", async () => {
    const tree = (await get(`/api/tree${q({ ...units, root: "codekb" })}`)).json() as TreePayload;
    expect(tree.entries.map((entry) => entry.path)).toEqual(["aidlc/spaces/default/codekb/audit", "aidlc/spaces/default/codekb/audit/architecture.md"]);
    expect((await get(`/api/render${at("aidlc/spaces/default/codekb/audit/architecture.md")}`)).status).toBe(200);
  });
});

describe("an archived intent", () => {
  test("its open stage reads stopped, and nothing on its screens asks the person to act", async () => {
    const archived = { space: "default", intent: ARCHIVED };
    const workflow = await call(`/api/workflow${q(archived)}`, { projectDir: unitsRoot });
    expect(workflow.text).not.toContain('"tone":"needs"');
    const body = workflow.json() as WorkflowPayload;
    expect(body).toMatchObject({ status: "archived", needs: null, sentence: { text: "Archived", tone: "quiet" } });
    expect(body.phases[0].stages.find((stage) => stage.slug === "user-stories")).toMatchObject({ word: "stopped", label: "stopped at review · r1" });
    const path = `aidlc/spaces/default/intents/${ARCHIVED}/inception/user-stories/user-stories-questions.md`;
    const questions = (await call(`/api/questions${q({ ...archived, path })}`, { projectDir: unitsRoot })).json() as QuestionsPayload;
    expect(questions.sentence).toEqual({ text: "1 question left open", tone: "quiet" });
  });
});

describe("a codekb/ that is itself a link", () => {
  test("is no root at all: nothing below it is listed, shown or counted", async () => {
    if (!kbLinked) return;
    const kb = { space: "default", intent: KB_RECORD };
    const get = (path: string) => call(path, { projectDir: linkedKbRoot });
    expect(((await get(`/api/tree${q({ ...kb, root: "codekb" })}`)).json() as TreePayload).entries).toEqual([]);
    const roots: Array<Record<string, string>> = [{}, { root: "codekb" }];
    for (const extra of roots) {
      const answer = await get(`/api/render${q({ ...kb, path: "aidlc/spaces/default/codekb/secret.md", ...extra })}`);
      expect(answer.status).toBe(404);
      expect(answer.json()).toEqual({ error: "Not found." });
    }
    const workflow = (await get(`/api/workflow${q(kb)}`)).json() as WorkflowPayload;
    expect(workflow.phases.flatMap((phase) => phase.stages).find((stage) => stage.slug === "reverse-engineering")?.artifacts).toEqual([]);
    for (const path of ["/api/workspace", `/api/workflow${q(kb)}`, `/api/tree${q({ ...kb, root: "codekb" })}`]) {
      const answer = await get(path);
      expect(answer.text).not.toContain("TOP SECRET");
      expect(answer.text).not.toContain(kbOutside);
    }
  });
});

describe("documents rendered directly", () => {
  const context = { path: `${BASE}/inception/user-stories/doc.md`, root: BASE, rootKind: "record" as const };

  test("a deeply quoted line leaves every later answer and note shown", () => {
    const { html } = renderMarkdown(`${"> ".repeat(40)}deep\n\n> [Answer]: B\n\n[Answer]: C\n\n- [Answer]: D\n\n> [Note]: kept\n`, context);
    for (const shown of ["<blockquote><p>[Answer]: B</p></blockquote>", "<p>[Answer]: C</p>", "<li>[Answer]: D</li>", "<blockquote><p>[Note]: kept</p></blockquote>"]) {
      expect(html).toContain(shown);
    }
    const many = renderMarkdown(Array.from({ length: 100 }, (_, index) => `${"> ".repeat(24)}q${index}\n\n[Answer]: a${index}\n`).join("\n"), context).html;
    for (let index = 0; index < 100; index++) expect(many).toContain(`<p>[Answer]: a${index}</p>`);
  });

  test("a hard line break shows as one wherever it is, and nothing else changes", () => {
    const html = (source: string) => renderMarkdown(source, context).html;
    expect(html("one  \r\ntwo\\\nthree\n")).toBe("<p>one<br>two<br>three</p>");
    expect(html("- item  \n  more\n")).toBe("<ul><li>item<br>more</li></ul>");
    expect(html("> quote  \n> more\n")).toBe("<blockquote><p>quote<br>more</p></blockquote>");
    expect(html("soft\nwrap\n")).toBe("<p>soft\nwrap</p>");
    expect(html("```sh\nserve \\\n  --flag  \n```  \n\nafter\n")).toBe("<pre><code>serve \\\n  --flag  \n</code></pre><p>after</p>");
    expect(html("Title\n---  \n\n| a |\n| --- |  \n| 1 |\n\n# Heading  \n\nC:\\\\\nnext\n")).toBe(
      '<h2 id="md-title">Title</h2><table class="md-table"><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><h1 id="md-heading">Heading</h1><p>C:\\\nnext</p>',
    );
  });

  test("a document nested thousands of levels deep still opens, its deep part as text", () => {
    for (const source of [`${"- ".repeat(6_000)}deep <b>x</b>\n`, `${"> ".repeat(12_000)}deep\n`, `${"> - ".repeat(5_000)}deep\n`]) {
      const { html } = renderMarkdown(source, context);
      expect(html).toContain("deep");
      expect(html).not.toContain("<b>");
    }
  });

  test("many headings of one name each take the next number", () => {
    const { outline } = renderMarkdown("# Same\n".repeat(50_000), context);
    expect(outline.at(-1)?.id).toBe("md-same-49999");
    expect(new Set(outline.map((item) => item.id)).size).toBe(50_000);
  });
});

describe("the live socket", () => {
  test("upgrades only a WebSocket request from the page's own origin", async () => {
    const plain = await call("/ws");
    expect(plain.status).toBe(400);
    expect(plain.json()).toEqual({ error: "Live updates need a WebSocket connection." });
    for (const origin of ["http://evil.example", "http://localhost:4790", "https://127.0.0.1:4790", "null"]) {
      const refused = await call("/ws", { headers: { upgrade: "websocket", origin } });
      expect(refused.status, origin).toBe(403);
      expect(refused.json()).toEqual({ error: "Live updates only connect from the Review UI page." });
    }
    const server = fakeServer();
    const accepted = await call("/ws", { headers: { upgrade: "websocket", origin: "http://127.0.0.1:4790" }, server });
    expect(accepted.status).toBe(101);
    expect(server.upgrades).toBe(1);
  });

  test("the socket handler takes 1 KiB at most and closes on any message", () => {
    const socket = handler().websocket;
    expect(socket.maxPayloadLength).toBe(1024);
    let closed = 0;
    socket.message({ close: () => closed++ } as unknown as Bun.ServerWebSocket<undefined>, "hello");
    expect(closed).toBe(1);
  });
});

test("no file on disk changed while the server read it", () => {
  const after = new Map<string, number>();
  for (const base of [root, outside, FIXTURE, unitsRoot, linkedKbRoot, kbOutside]) snapshot(base, after);
  expect([...after].filter(([path, mtime]) => before.get(path) !== mtime)).toEqual([]);
  expect([...before.keys()].filter((path) => !after.has(path))).toEqual([]);
});
