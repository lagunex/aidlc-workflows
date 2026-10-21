// The plugin reads only formats AI-DLC documents, so this checks it against
// those documents on every change: (a) every state-file label it reads is in
// its section of the state template, whose checkbox legend is exactly the six
// markers; (b) the fenced examples in the guide's chapters 09, 10 and 16
// parse; (c) every audit event and field it reads is in the audit format's
// registry tables; (d) a record made by the packaged engine reads cleanly
// through the workspace, workflow, decisions and tree routes; (e) the fixture records (three real 2.10.0 records with
// names and paths replaced, and one synthetic record of the same shape) read
// cleanly too; (f) the reviewers' template still writes the review copy's
// Verdict and Date lines the way the plugin reads them.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NATIVE_FIXTURE_SETUP_TIMEOUT_MS,
  NATIVE_STARTUP_TIMEOUT_MS,
  remainingOperationTimeoutMs,
} from "../../../tests/harness/test-budget.ts";
import { AUDIT_READS, auditTimeline, orderEvents, parseShard } from "../tools/review-ui/audit.ts";
import { reviewHeader } from "../tools/review-ui/model.ts";
import { parseQuestions } from "../tools/review-ui/questions.ts";
import { createHandler } from "../tools/review-ui/server.ts";
import { MARKERS, parseState, STATE_FIELDS, STATE_SECTIONS, UNIT_PROGRESS_COLUMNS } from "../tools/review-ui/state.ts";
import type { DecisionsPayload, WorkflowPayload, WorkspacePayload } from "../tools/review-ui/types.ts";

setDefaultTimeout(NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const FIXTURE = join(HERE, "fixtures", "aidlc-ui");
const CLAUDE_DIST = join(REPO, "dist", "claude", ".claude");
const MEMORY_DIST = join(REPO, "dist", "claude", "aidlc");

const read = (path: string): string => readFileSync(join(REPO, path), "utf8");

/** A Markdown document's `## ` sections by title. */
function sections(text: string): Map<string, string> {
  const found = new Map<string, string>();
  const parts = text.split(/^## /m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    found.set(part.slice(0, newline).trim(), part.slice(newline + 1));
  }
  return found;
}

function fences(text: string): string[] {
  return [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((match) => match[1]);
}

const PEER = { requestIP: () => ({ address: "127.0.0.1" }), upgrade: () => false, port: 4790 };

async function get<T>(projectDir: string, path: string): Promise<{ status: number; body: T }> {
  const handler = createHandler({ projectDir, version: "test" });
  const response = handler.fetch(new Request(`http://127.0.0.1:4790${path}`, { headers: { host: "127.0.0.1:4790" } }), PEER);
  if (!response) throw new Error(`no response for ${path}`);
  return { status: response.status, body: (await response.json()) as T };
}

describe("(a) the state template", () => {
  const template = read("core/knowledge/aidlc-shared/state-template.md");
  const bySection = sections(template);

  test("every label read is in its section", () => {
    for (const [section, labels] of Object.entries(STATE_FIELDS)) {
      const body = bySection.get(section);
      expect(body, `section ${section}`).toBeDefined();
      for (const label of labels) expect(body, `${section} > ${label}`).toContain(`- **${label}**:`);
    }
    for (const section of STATE_SECTIONS) expect(bySection.has(section), section).toBe(true);
  });

  test("the checkbox legend is exactly the six markers", () => {
    const legend = /<!-- Checkbox states: (.*?) -->/.exec(bySection.get("Stage Progress") ?? "")?.[1] ?? "";
    const markers = [...legend.matchAll(/\[(.)\]/g)].map((match) => match[1]);
    expect(markers).toEqual([...MARKERS]);
  });

  test("the template's phase heading, row and Unit Progress table read", () => {
    const stageProgress = bySection.get("Stage Progress") ?? "";
    expect(stageProgress).toContain("### [PHASE] PHASE");
    const row = /^- \[ \] stage-slug — \[EXECUTE\/SKIP: reason\]$/m.exec(stageProgress)?.[0];
    expect(row).toBeDefined();
    const filled = (row ?? "").replace("[EXECUTE/SKIP: reason]", "SKIP: reason");
    expect(parseState(`### CONSTRUCTION PHASE\n${filled}\n`).rows).toEqual([{ slug: "stage-slug", marker: " ", scope: "SKIP", phase: "construction" }]);
    const header = (bySection.get("Unit Progress") ?? "").split("\n").find((line) => line.startsWith("| unit"));
    for (const column of UNIT_PROGRESS_COLUMNS) expect(header, column).toContain(` ${column} `);
    expect(bySection.get("Phase Progress")).toContain("- **[Phase]**: [Pending/Active/Verified/Skipped]");
  });
});

describe("(b) the guide's examples", () => {
  const guides = ["docs/guide/09-rules-and-the-learning-loop.md", "docs/guide/10-state-and-audit.md", "docs/guide/16-worked-examples.md"];
  const blocks = guides.flatMap((guide) => fences(read(guide)).map((text) => ({ guide, text })));

  test("audit examples parse into events with a time", () => {
    const audit = blocks.filter((block) => block.text.includes("**Event**:"));
    expect(audit.map((block) => block.guide)).toEqual(expect.arrayContaining(guides.slice(0, 2)));
    for (const { guide, text } of audit) {
      const events = parseShard(text, 0);
      expect(events.length, guide).toBe(text.split("**Event**:").length - 1);
      for (const event of events) {
        expect(event.time, `${guide} ${event.event}`).not.toBeNull();
        expect(event.event).toMatch(/^[A-Z][A-Z_]+$/);
      }
      expect(() => auditTimeline(orderEvents(events))).not.toThrow();
    }
  });

  test("the state example parses into its fields, phases and rows", () => {
    const state = blocks.find((block) => block.text.includes("## Stage Progress"));
    expect(state?.guide).toBe("docs/guide/10-state-and-audit.md");
    const parsed = parseState(state?.text ?? "");
    expect(parsed).toMatchObject({ recognized: true, currentStage: "feasibility", nextStage: "scope-definition", status: "Running", depth: "Standard" });
    expect(parsed.rows.map((row) => [row.slug, row.marker, row.scope])).toEqual([
      ["intent-capture", "x", "EXECUTE"],
      ["market-research", " ", "SKIP"],
      ["feasibility", "-", "EXECUTE"],
      ["scope-definition", " ", "EXECUTE"],
    ]);
    expect(parsed.phaseProgress).toMatchObject({ ideation: "Active", operation: "Skipped" });
  });

  test("questions examples parse into questions with options and answers", () => {
    const questions = blocks.filter((block) => /^## Q\d+\./m.test(block.text));
    expect(questions.length).toBeGreaterThanOrEqual(2);
    const parsed = questions.map((block) => parseQuestions(block.text));
    for (const each of parsed) expect(each.total).toBeGreaterThan(0);
    const severity = parsed.find((each) => each.questions[0]?.title === "Bug Severity Classification");
    expect(severity?.questions[0]).toMatchObject({ number: 1, role: "Product owner", open: true });
    expect(severity?.questions[0].options.map((option) => option.letter)).toEqual(["A", "B", "C", "D", "X"]);
    const channels = parsed.find((each) => each.questions[0]?.title === "Which notification channels are in scope?");
    expect(channels?.questions[0]).toMatchObject({ chosen: "B", open: false, answer: "B. In-app + email" });
  });
});

describe("(c) the audit format's registry", () => {
  const format = read("core/knowledge/aidlc-shared/audit-format.md");
  const rows = new Map<string, string>();
  for (const line of format.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const name = /`([A-Z][A-Z0-9_]+)`/.exec(cells[1] ?? "")?.[1];
    if (name && cells.length >= 5) rows.set(name, cells[3]);
  }

  test("every event read has a row, and every field read is in it", () => {
    for (const [event, fields] of Object.entries(AUDIT_READS)) {
      const required = rows.get(event);
      expect(required, event).toBeDefined();
      for (const field of fields) {
        expect(new RegExp(`(?<![A-Za-z])${field}(?![A-Za-z])`).test(required ?? ""), `${event} > ${field}`).toBe(true);
      }
    }
  });

  test("whole-file readers still split on --- and take a block's first timestamp", () => {
    expect(format).toContain("readers that parse\nwhole files must split on `---` and use the first timestamp in each block");
  });
});

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const distMissing = existsSync(join(CLAUDE_DIST, "tools", "aidlc-utility.ts")) ? null : "dist/claude is not built; bun scripts/package.ts builds it";

describe("(d) a record made by the packaged engine", () => {
  test.skipIf(distMissing !== null)(`reads cleanly through the workspace, workflow, decisions and tree routes${distMissing ? ` (skipped: ${distMissing})` : ""}`, async () => {
    const project = mkdtempSync(join(tmpdir(), "aidlc-review-ui-"));
    tempDirs.push(project);
    cpSync(CLAUDE_DIST, join(project, ".claude"), { recursive: true });
    if (existsSync(MEMORY_DIST)) cpSync(MEMORY_DIST, join(project, "aidlc"), { recursive: true });
    const env: Record<string, string | undefined> = {
      ...process.env,
      AIDLC_SESSION_OVERRIDE: "01995000-7a11-7000-8000-000000002400",
      AIDLC_SESSION_OVERRIDE_SOURCE: "payload",
    };
    for (const key of ["AIDLC_SCOPE_MAPPING", "CLAUDE_CODE_SESSION_ID", "CLAUDE_PID", "CODEX_THREAD_ID", "KIRO_SESSION_ID"]) delete env[key];
    const created = spawnSync(
      process.execPath,
      [join(project, ".claude", "tools", "aidlc-utility.ts"), "intent-create", "--scope", "express", "--project-type", "brownfield", "--project-dir", project],
      { cwd: project, env, encoding: "utf-8", timeout: remainingOperationTimeoutMs(NATIVE_STARTUP_TIMEOUT_MS) },
    );
    expect(created.status, `${created.stdout}${created.stderr}`).toBe(0);

    const workspace = await get<WorkspacePayload>(project, "/api/workspace");
    expect(workspace.status).toBe(200);
    expect(workspace.body.intents).toHaveLength(1);
    const [intent] = workspace.body.intents;
    expect(intent).toMatchObject({ scope: "express", status: "running", group: "in-progress" });
    expect(workspace.body.selected_intent).toBe(intent.record);

    const query = `space=default&intent=${intent.record}`;
    const workflow = await get<WorkflowPayload>(project, `/api/workflow?${query}`);
    expect(workflow.status).toBe(200);
    const stages = workflow.body.phases.flatMap((phase) => phase.stages);
    expect(workflow.body.phases.map((phase) => phase.name)).toEqual(["Initialization", "Ideation", "Inception", "Construction", "Operation"]);
    expect(stages.length).toBeGreaterThan(20);
    expect(workflow.body.current_stage).not.toBeNull();
    expect(stages.find((stage) => stage.is_current)?.word).toBe("current");
    expect(stages.filter((stage) => stage.word === "done").map((stage) => stage.slug)).toEqual(["workspace-scaffold", "workspace-detection", "state-init"]);
    expect(workflow.body.stages_total).toBe(stages.filter((stage) => stage.scope === "EXECUTE").length);
    expect(stages.every((stage) => stage.scope !== "unknown")).toBe(true);
    expect(workflow.body.notes).toEqual([]);

    const decisions = await get<DecisionsPayload>(project, `/api/decisions?${query}`);
    expect(decisions.status).toBe(200);
    expect((await get(project, `/api/tree?${query}`)).status).toBe(200);
  });
});

describe("(e) the fixture records", () => {
  test("the workspace lists them, the checkout's cursor first", async () => {
    const { status, body } = await get<WorkspacePayload>(FIXTURE, "/api/workspace");
    expect(status).toBe(200);
    expect(body.intents.map((intent) => [intent.record, intent.label, intent.status, intent.group, intent.stages_done, intent.stages_total])).toEqual([
      ["261016-csv-export", "csv-export", "completed", "done", 7, 7],
      ["261016-viz-graph-view", "viz-graph-view", "completed", "done", 8, 8],
      ["261016-symlink-intent-discovery", "symlink-intent-discovery", "completed", "done", 7, 9],
      ["261014-aidlc-viz-server", "aidlc-viz-server", "completed", "done", 7, 7],
    ]);
    expect(body.selected_intent).toBe("261016-viz-graph-view");
    expect(body.sentence).toEqual({ text: "Nothing waiting", tone: "ok" });
  });

  test("each workflow reads, and the 9/7 record counts its two jump-skipped stages apart", async () => {
    for (const record of ["261014-aidlc-viz-server", "261016-csv-export", "261016-symlink-intent-discovery", "261016-viz-graph-view"]) {
      const { status, body } = await get<WorkflowPayload>(FIXTURE, `/api/workflow?space=default&intent=${record}`);
      expect(status, record).toBe(200);
      expect(body.sentence, record).toEqual({ text: "Workflow complete", tone: "ok" });
      expect(body.notes, record).toEqual([]);
      const stages = body.phases.flatMap((phase) => phase.stages);
      expect(stages.some((stage) => stage.is_current), record).toBe(false);
      expect(stages.filter((stage) => stage.word === "done").length, record).toBe(body.stages_done);
    }
    const { body } = await get<WorkflowPayload>(FIXTURE, "/api/workflow?space=default&intent=261016-symlink-intent-discovery");
    expect({ total: body.stages_total, done: body.stages_done, skipped: body.stages_skipped }).toEqual({ total: 9, done: 7, skipped: 2 });
    const skipped = body.phases.flatMap((phase) => phase.stages).filter((stage) => stage.word === "skipped");
    expect(skipped.map((stage) => stage.slug)).toEqual(["deployment-pipeline", "deployment-execution"]);
    expect(skipped.every((stage) => stage.label.startsWith("skipped · ") && stage.reason)).toBe(true);
    expect(body.phases.find((phase) => phase.name === "Ideation")).toMatchObject({ skipped_reason: "scope bugfix excludes ideation", not_in_plan: 7 });
  });

  test("the decisions read, with the summary and plan answers paired to their questions", async () => {
    const { status, body } = await get<DecisionsPayload>(FIXTURE, "/api/decisions?space=default&intent=261014-aidlc-viz-server");
    expect(status).toBe(200);
    const kinds = new Set(body.entries.map((entry) => entry.kind));
    for (const kind of ["asked", "answered", "approved", "changes-requested", "gate-opened", "revising", "review"]) expect(kinds.has(kind as never), kind).toBe(true);
    const times = body.entries.map((entry) => entry.at ?? "");
    expect([...times].sort().reverse()).toEqual(times);
    const plan = body.entries.find((entry) => entry.event === "PLAN_APPROVAL_RECORDED");
    expect(plan).toMatchObject({ title: "Plan approved", question: "Approve this exact Code Generation plan?" });
    // The review copy's own Verdict and Date lines give the entry its words and its time.
    const review = body.entries.find((entry) => entry.kind === "review" && entry.stage === "code-generation");
    expect(review).toMatchObject({ title: "Review 1 · READY", at: "2026-10-16T10:38:22.000Z", stage_name: "Code Generation" });
    const intentCapture = await get<DecisionsPayload>(FIXTURE, "/api/decisions?space=default&intent=261014-aidlc-viz-server&stage=intent-capture");
    expect(intentCapture.body.entries.every((entry) => entry.stage === "intent-capture")).toBe(true);
    expect(intentCapture.body.entries.filter((entry) => entry.kind === "approved").map((entry) => entry.title)).toEqual(["Approved · r4"]);
  });

  test("the questions files read with their sections", async () => {
    const path = "aidlc/spaces/default/intents/261014-aidlc-viz-server/ideation/intent-capture/intent-capture-questions.md";
    const { status, body } = await get<{ total: number; open: number; sections: Array<{ note: string }> }>(
      FIXTURE,
      `/api/questions?space=default&intent=261014-aidlc-viz-server&path=${encodeURIComponent(path)}`,
    );
    expect(status).toBe(200);
    expect({ total: body.total, open: body.open }).toEqual({ total: 8, open: 0 });
    expect(body.sections.map((section) => section.note)).toEqual(["summary confirmed", "assumptions accepted"]);
    // This record's questions sit under "### Q<n>." headings.
    const deeper = "aidlc/spaces/default/intents/261016-csv-export/inception/requirements-analysis/requirements-analysis-questions.md";
    const third = await get<{ total: number; open: number }>(
      FIXTURE,
      `/api/questions?space=default&intent=261016-csv-export&path=${encodeURIComponent(deeper)}`,
    );
    expect({ total: third.body.total, open: third.body.open }).toEqual({ total: 8, open: 0 });
  });
});

// The review copy (reviews/review-NN.md) is the reviewer's own file, written to
// the reviewers' template in the agents' knowledge; the user guide only names it.
describe("(f) the review copy's header", () => {
  const templates = ["core/knowledge/aidlc-architecture-reviewer-agent/reviewing.md", "core/knowledge/aidlc-product-lead-agent/reviewing.md"];

  test("the reviewers' template writes the Verdict and Date lines the plugin reads", () => {
    for (const template of templates) {
      const format = /Use this exact format:\s*```markdown\n([\s\S]*?)^```/m.exec(read(template))?.[1] ?? "";
      expect(format, template).toContain("**Verdict:**");
      // The template's Date line holds a placeholder for the time the brief names.
      const filled = format.replace(/^(\*\*Date:\*\*)[ \t]*\[[^\]\n]*\][ \t]*$/m, "$1 2026-10-21T09:10:00Z");
      expect(filled, template).toContain("**Date:** 2026-10-21T09:10:00Z");
      expect(reviewHeader(filled), template).toEqual({ verdict: "READY | NOT-READY", date: "2026-10-21T09:10:00Z" });
    }
  });

  test("the reviewer protocol asks for the same two lines", () => {
    const protocol = read("core/aidlc-common/protocols/stage-protocol-reviewer.md");
    expect(protocol).toContain("`**Verdict:** READY|NOT-READY`");
    expect(protocol).toContain("`**Date:**`");
  });
});
