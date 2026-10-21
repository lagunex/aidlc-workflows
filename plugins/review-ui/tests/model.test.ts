// The Review UI's words and rules, from parsed text to payload: every stage
// word, label and header line, and that none depends on the server's time
// zone; Needs you and the intent groups; an archived or completed intent's
// open stages; the counts and the folded not-in-plan line; the registry and
// the state file disagreeing either way; per-unit folders and the team Unit
// Progress table, each unit worded from its own cell; what a questions file
// shows (and what code, comments and HTML hide); the Decisions timeline's
// pairing and ordering; and that CRLF, malformed input and lines built to
// make a pattern retry read cleanly instead of throwing or stalling.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { deterministicCaseTimeoutMs } from "../../../tests/harness/test-budget.ts";
import { auditTimeline, orderEvents, parseShard, stageFacts } from "../tools/review-ui/audit.ts";
import {
  decisionsPayload,
  fileNotes,
  inboxSentence,
  intentStatus,
  intentSummary,
  parseRegistry,
  questionsSentence,
  type RegistryRow,
  reviewEntry,
  selectIntent,
  type StageInputs,
  stageFileRoles,
  titleCase,
  unitFolders,
  workflowPayload,
} from "../tools/review-ui/model.ts";
import { openAnswers, parseQuestions, summarizeQuestions, TAG_MARK, visibleBlocks } from "../tools/review-ui/questions.ts";
import { parseState } from "../tools/review-ui/state.ts";
import type { IntentSummary, WorkflowPayload, WorkflowStage } from "../tools/review-ui/types.ts";

setDefaultTimeout(deterministicCaseTimeoutMs());

interface StateOptions {
  rows: string;
  current?: string;
  next?: string;
  status?: string;
  scope?: string;
  extra?: string;
}

function stateText({ rows, current = "", next = "none", status = "Running", scope = "poc", extra = "" }: StateOptions): string {
  return [
    "# AI-DLC State Tracking",
    "",
    "## Project Information",
    "- **Project**: A sample piece of work",
    `- **Scope**: ${scope}`,
    "",
    "## Scope Configuration",
    "- **Depth**: Standard",
    "",
    "## Execution Plan Summary",
    "- **Total Stages**: 99",
    "- **Completed**: 98",
    "",
    "## Phase Progress",
    "- **Inception**: Active",
    "- **Operation**: Skipped",
    "",
    "## Stage Progress",
    "<!-- Checkbox states: [ ] pending, [-] in-progress, [?] awaiting approval, [R] revising, [x] completed, [S] skipped -->",
    "",
    rows,
    "",
    extra,
    "## Current Status",
    "- **Lifecycle Phase**: INCEPTION",
    `- **Current Stage**: ${current}`,
    `- **Next Stage**: ${next}`,
    `- **Status**: ${status}`,
    "- **Last Updated**: 2026-10-20T10:00:00Z",
    "",
  ].join("\n");
}

function block(event: string, timestamp: string, fields: Record<string, string> = {}): string {
  return [`## ${event}`, `**Timestamp**: ${timestamp}`, `**Event**: ${event}`, ...Object.entries(fields).map(([k, v]) => `**${k}**: ${v}`)].join("\n");
}

function shard(...blocks: string[]): string {
  return `# AI-DLC Audit Log\n\n${blocks.join("\n\n---\n\n")}\n`;
}

function events(...shards: string[]) {
  return orderEvents(shards.flatMap((text, index) => parseShard(text, index)));
}

function questionsInput(slug: string, text: string): StageInputs {
  return {
    questions: { path: `aidlc/spaces/default/intents/261020-sample/inception/${slug}/${slug}-questions.md`, parsed: parseQuestions(text) },
    artifacts: [],
    diary: null,
    reviews: [],
    units: [],
  };
}

function workflow(
  state: string,
  options: { shards?: string[]; stages?: Map<string, StageInputs>; registry?: RegistryRow | null } = {},
): WorkflowPayload {
  return workflowPayload({
    space: "default",
    record: "261020-sample",
    registry: options.registry ?? null,
    state: parseState(state),
    stateMtimeMs: null,
    events: events(...(options.shards ?? [])),
    stages: options.stages ?? new Map(),
    codekb: [],
    notes: [],
  });
}

function stage(payload: WorkflowPayload, slug: string): WorkflowStage {
  const found = payload.phases.flatMap((phase) => phase.stages).find((each) => each.slug === slug);
  if (!found) throw new Error(`no stage ${slug}`);
  return found;
}

const OPEN_QUESTIONS = `# Questions

## Q1. [Product owner] Which channels?

- A. In-app
- B. Email

[Answer]:

## Q2. Who reads it?

- A. Me
- B. My team

[Answer]: ____
`;

const ROWS = [
  "### INCEPTION PHASE",
  "- [x] requirements-analysis — EXECUTE",
  "- [-] user-stories — EXECUTE",
  "- [?] domain-design – EXECUTE",
  "- [R] units-generation - EXECUTE",
  "- [ ] contract-design — EXECUTE",
  "- [ ] delivery-planning — EXECUTE",
  "- [S] refined-mockups — EXECUTE",
  "- [ ] practices-discovery — SKIP: not in poc",
  "",
  "### OPERATION PHASE",
  "- [ ] deployment-pipeline — SKIP",
  "- [ ] observability-setup — SKIP",
].join("\n");

const SHARD = shard(
  block("PHASE_SKIPPED", "2026-10-20T08:00:00Z", { Phase: "operation", Scope: "poc", Reason: "scope poc excludes operation" }),
  block("STAGE_STARTED", "2026-10-20T08:01:00Z", { Stage: "requirements-analysis", Agent: "aidlc-product-agent" }),
  block("GATE_APPROVED", "2026-10-20T09:55:40Z", { Stage: "requirements-analysis", "User Input": "Approve" }),
  block("STAGE_COMPLETED", "2026-10-20T09:55:40Z", { Stage: "requirements-analysis", Details: "approved" }),
  block("STAGE_STARTED", "2026-10-20T09:56:00Z", { Stage: "user-stories", Agent: "aidlc-product-agent" }),
  block("STAGE_STARTED", "2026-10-20T09:57:00Z", { Stage: "domain-design", Agent: "aidlc-architect-agent" }),
  block("STAGE_REVISING", "2026-10-20T09:58:00Z", { Stage: "domain-design", "Revision count": "7", Feedback: "more detail" }),
  block("STAGE_STARTED", "2026-10-20T09:59:00Z", { Stage: "units-generation", Agent: "aidlc-architect-agent" }),
  block("STAGE_REVISING", "2026-10-20T09:59:30Z", { Stage: "units-generation", "Revision count": "8", Feedback: "split it" }),
  block("STAGE_SKIPPED", "2026-10-20T09:59:40Z", { Stage: "refined-mockups", Reason: "no screens in this work" }),
);

describe("stage words, labels and header lines", () => {
  const payload = workflow(stateText({ rows: ROWS, current: "user-stories", next: "contract-design" }), {
    shards: [SHARD],
    stages: new Map([["user-stories", questionsInput("user-stories", OPEN_QUESTIONS)]]),
  });

  test("each marker reads as its word, label and line", () => {
    const seen = (slug: string) => {
      const { word, label, sentence } = stage(payload, slug);
      return { word, label, sentence };
    };
    expect(seen("requirements-analysis")).toEqual({ word: "done", label: "done", sentence: { text: "Done", tone: "ok", at: "2026-10-20T09:55:40.000Z" } });
    expect(seen("user-stories")).toEqual({ word: "questions", label: "questions", sentence: { text: "In progress", tone: "quiet" } });
    expect(seen("domain-design")).toEqual({
      word: "in-review",
      label: "in review · r2",
      sentence: { text: "Awaiting your review · r2", tone: "needs" },
    });
    expect(seen("units-generation")).toEqual({ word: "revising", label: "revising", sentence: { text: "Revising · r2", tone: "quiet" } });
    expect(seen("contract-design")).toEqual({ word: "next", label: "next", sentence: { text: "Next", tone: "quiet" } });
    expect(seen("delivery-planning")).toEqual({ word: "later", label: "later", sentence: { text: "Later", tone: "quiet" } });
    expect(seen("refined-mockups")).toEqual({
      word: "skipped",
      label: "skipped · no screens in this work",
      sentence: { text: "Skipped", tone: "quiet" },
    });
    expect(seen("practices-discovery")).toEqual({ word: "not-in-plan", label: "not in this plan", sentence: { text: "Skipped", tone: "quiet" } });
  });

  test("[-] without open answers is current, and a done stage with no decision time reads Done", () => {
    const quiet = workflow(stateText({ rows: "### INCEPTION PHASE\n- [x] requirements-analysis — EXECUTE\n- [-] user-stories — EXECUTE", current: "user-stories" }));
    expect(stage(quiet, "user-stories")).toMatchObject({ word: "current", label: "current", sentence: { text: "In progress", tone: "quiet" } });
    expect(stage(quiet, "requirements-analysis").sentence).toEqual({ text: "Done", tone: "ok", at: null });
  });

  test("no word depends on the server's time zone; a done stage's time travels for the browser to show", () => {
    const build = (): string =>
      JSON.stringify(
        workflow(stateText({ rows: ROWS, current: "user-stories", next: "contract-design" }), {
          shards: [SHARD],
          stages: new Map([["user-stories", questionsInput("user-stories", OPEN_QUESTIONS)]]),
        }),
      );
    const saved = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const pacific = build();
      process.env.TZ = "Asia/Tokyo";
      expect(build()).toBe(pacific);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  test("stages not in the plan fold per phase, with the phase's skip reason", () => {
    const [inception, operation] = payload.phases;
    expect(inception).toMatchObject({ name: "Inception", status: "Active", not_in_plan: 1, not_in_plan_label: "1 more · not in this plan", skipped_reason: null });
    expect(operation).toMatchObject({
      name: "Operation",
      status: "Skipped",
      not_in_plan: 2,
      not_in_plan_label: "2 stages · not in this plan",
      skipped_reason: "scope poc excludes operation",
    });
    expect(stage(payload, "deployment-pipeline")).toMatchObject({ reason: "scope poc excludes operation", hint: "Scope poc excludes operation — nothing produced." });
    expect(stage(payload, "delivery-planning").hint).toBe("Not started yet; nothing produced.");
    expect(stage(payload, "refined-mockups").hint).toBe("No screens in this work — nothing produced.");
    expect(stage(payload, "user-stories").hint).toBeNull();
  });

  test("the folded line never names the scope, and a skip reason the plan has changed since is dropped", () => {
    const rows = "### INCEPTION PHASE\n- [x] requirements-analysis — EXECUTE\n- [ ] user-stories — SKIP\n\n### OPERATION PHASE\n- [ ] deployment-pipeline — SKIP\n- [ ] observability-setup — SKIP";
    const made = block("PHASE_SKIPPED", "2026-10-20T08:00:00Z", { Phase: "operation", Scope: "poc", Reason: "scope poc excludes operation" });
    // The feature scope runs User Stories; this plan skips it anyway.
    const kept = workflow(stateText({ rows, scope: "feature" }), { shards: [shard(made)] });
    expect(kept.phases.map((phase) => [phase.name, phase.not_in_plan_label, phase.skipped_reason])).toEqual([
      ["Inception", "1 more · not in this plan", null],
      ["Operation", "2 stages · not in this plan", "scope poc excludes operation"],
    ]);
    for (const change of [
      block("SCOPE_CHANGED", "2026-10-20T09:00:00Z", { "Old scope": "poc", "New scope": "mvp" }),
      block("RECOMPOSED", "2026-10-20T09:00:00Z", { Scope: "feature", "Stages skipped": "user-stories" }),
    ]) {
      const changed = workflow(stateText({ rows, scope: "mvp" }), { shards: [shard(made, change)] });
      expect(changed.phases[1]).toMatchObject({ not_in_plan_label: "2 stages · not in this plan", skipped_reason: null });
      expect(stage(changed, "deployment-pipeline")).toMatchObject({ reason: null, hint: "Not in this plan — nothing produced." });
    }
  });

  test("the intent's own line follows its current stage, or how it ended", () => {
    expect(payload.sentence).toEqual({ text: "In progress", tone: "quiet" });
    const reviewing = workflow(stateText({ rows: ROWS, current: "domain-design" }), { shards: [SHARD] });
    expect(reviewing.sentence).toEqual({ text: "Awaiting your review · r2", tone: "needs" });
    const done = workflow(stateText({ rows: ROWS, current: "requirements-analysis", status: "Completed" }), { shards: [SHARD] });
    expect(done.sentence).toEqual({ text: "Workflow complete", tone: "ok" });
    expect(done.current_stage).toBeNull();
    expect(done.phases.flatMap((phase) => phase.stages).some((each) => each.is_current)).toBe(false);
    const lost = workflow(stateText({ rows: ROWS, current: "Workflow complete" }));
    expect(lost.sentence).toEqual({ text: "Workflow unavailable", tone: "quiet" });
    expect(lost.current_stage).toBeNull();
    expect(workflow("").sentence).toEqual({ text: "Workflow unavailable", tone: "quiet" });
    expect(workflow(stateText({ rows: ROWS, current: "user-stories", status: "Archived" })).sentence).toEqual({ text: "Archived", tone: "quiet" });
  });

  test("the Inbox and questions lines", () => {
    expect(inboxSentence(2)).toEqual({ text: "2 items need you", tone: "needs" });
    expect(inboxSentence(1)).toEqual({ text: "1 item needs you", tone: "needs" });
    expect(inboxSentence(0)).toEqual({ text: "Nothing waiting", tone: "ok" });
    expect(questionsSentence(parseQuestions(OPEN_QUESTIONS), "running")).toEqual({ text: "2 questions for you", tone: "needs" });
    expect(questionsSentence(parseQuestions("## Q1. One\n\n[Answer]:\n"), "running")).toEqual({ text: "1 question for you", tone: "needs" });
    expect(questionsSentence(parseQuestions("## Q1. One\n\n- A. x\n\n[Answer]: A\n"), "running")).toEqual({ text: "Answered", tone: "ok" });
  });

  test("names read in title case, with small words and acronyms as written, and the server sends every one", () => {
    expect(titleCase("build-and-test")).toBe("Build and Test");
    expect(titleCase("nfr-requirements")).toBe("NFR Requirements");
    expect(titleCase("ci-pipeline")).toBe("CI Pipeline");
    expect(titleCase("construction")).toBe("Construction");
    const rows = "### CONSTRUCTION PHASE\n- [x] nfr-requirements — EXECUTE\n- [-] build-and-test — EXECUTE\n- [ ] ci-pipeline — EXECUTE";
    const state = stateText({ rows, current: "build-and-test" });
    const summary = intentSummary({ space: "default", record: "261020-sample", registry: null, state: parseState(state), stateMtimeMs: null }, 0);
    expect(summary.current_stage_name).toBe(stage(workflow(state), "build-and-test").name);
    expect(summary.current_stage_name).toBe("Build and Test");
    const decisions = decisionsPayload({
      space: "default",
      intent: "261020-sample",
      timeline: auditTimeline(events(shard(block("GATE_APPROVED", "2026-10-20T10:00:00Z", { Stage: "nfr-requirements", "User Input": "Approve" })))),
      reviews: [],
      notes: [],
    });
    expect(decisions.entries.map((entry) => [entry.stage, entry.stage_name])).toEqual([["nfr-requirements", "NFR Requirements"]]);
  });
});

describe("an archived or completed intent", () => {
  const OPEN_ROWS = [
    "### INCEPTION PHASE",
    "- [x] requirements-analysis — EXECUTE",
    "- [?] user-stories — EXECUTE",
    "- [-] domain-design — EXECUTE",
    "- [R] units-generation — EXECUTE",
    "- [ ] contract-design — EXECUTE",
    "",
    "### CONSTRUCTION PHASE",
    "- [-] code-generation — EXECUTE",
  ].join("\n");
  const TEAM = [
    "## Unit Progress",
    "| unit | owner | code-generation | gate |",
    "| --- | --- | --- | --- |",
    "| core | alice | [?] | [?] |",
    "| web | - | [-] | [ ] |",
    "",
  ].join("\n");

  for (const status of ["Archived", "Completed"]) {
    test(`${status}: a stage or unit left open is stopped, and nothing reads as waiting on the person`, () => {
      const payload = workflow(stateText({ rows: OPEN_ROWS, current: "domain-design", status, extra: TEAM }), {
        shards: [SHARD],
        stages: new Map([["domain-design", questionsInput("domain-design", OPEN_QUESTIONS)]]),
      });
      const stages = payload.phases.flatMap((phase) => phase.stages);
      const words = [...stages.map((each) => each.word), ...stages.flatMap((each) => each.units.map((unit) => unit.word))];
      for (const word of ["in-review", "questions", "current", "revising"]) expect(words, word).not.toContain(word);
      expect(JSON.stringify(payload)).not.toContain('"tone":"needs"');
      expect(payload.needs).toBeNull();
      const seen = (slug: string) => {
        const { word, label, sentence } = stage(payload, slug);
        return { word, label, sentence };
      };
      expect(seen("user-stories")).toEqual({ word: "stopped", label: "stopped at review · r1", sentence: { text: "Stopped at review · r1", tone: "quiet" } });
      expect(seen("domain-design")).toEqual({ word: "stopped", label: "stopped in progress", sentence: { text: "Stopped in progress", tone: "quiet" } });
      expect(seen("units-generation")).toEqual({
        word: "stopped",
        label: "stopped while revising · r2",
        sentence: { text: "Stopped while revising · r2", tone: "quiet" },
      });
      expect(stage(payload, "code-generation").units.map(({ unit, word, label }) => [unit, word, label])).toEqual([
        ["core", "stopped", "stopped at review · r1"],
        ["web", "stopped", "stopped in progress"],
      ]);
      expect(payload.unit_progress.map((row) => row.needs_you)).toEqual([false, false]);
    });
  }

  test("its open questions are left open, for nobody", () => {
    expect(questionsSentence(parseQuestions(OPEN_QUESTIONS), "archived")).toEqual({ text: "2 questions left open", tone: "quiet" });
    expect(questionsSentence(parseQuestions("## Plan Approval\n\n[Answer]:\n"), "completed")).toEqual({ text: "1 question left open", tone: "quiet" });
  });
});

describe("needs you, groups and counts", () => {
  const summary = (state: string, open = 0, registry: RegistryRow | null = null): IntentSummary =>
    intentSummary({ space: "default", record: "261020-sample", registry, state: parseState(state), stateMtimeMs: null }, open);

  test("a stage awaiting review needs you, and so do open answers at the current stage", () => {
    expect(summary(stateText({ rows: ROWS, current: "domain-design" }))).toMatchObject({
      needs: { kind: "gate", label: "Review approval gate" },
      group: "needs-you",
    });
    expect(summary(stateText({ rows: ROWS, current: "user-stories" }), 3)).toMatchObject({
      needs: { kind: "questions", label: "3 questions" },
      group: "needs-you",
    });
    expect(summary(stateText({ rows: ROWS, current: "user-stories" }), 1).needs).toEqual({ kind: "questions", label: "1 question" });
  });

  test("revising is the agent's turn, and a finished or archived intent needs nobody", () => {
    expect(summary(stateText({ rows: ROWS, current: "units-generation" }))).toMatchObject({ needs: null, group: "in-progress" });
    expect(summary(stateText({ rows: ROWS, current: "user-stories" }))).toMatchObject({ needs: null, group: "in-progress" });
    expect(summary(stateText({ rows: ROWS, current: "domain-design", status: "Completed" }))).toMatchObject({ needs: null, group: "done" });
    expect(summary(stateText({ rows: ROWS, current: "domain-design", status: "Archived" }))).toMatchObject({ needs: null, group: "archived" });
  });

  test("the counts are the rows in the plan, [x] done among them, [S] apart", () => {
    const payload = workflow(stateText({ rows: ROWS, current: "user-stories" }));
    expect({ total: payload.stages_total, done: payload.stages_done, skipped: payload.stages_skipped }).toEqual({ total: 7, done: 1, skipped: 1 });
    // A state file with no rows falls back to its plan summary fields.
    expect(summary(stateText({ rows: "" }))).toMatchObject({ stages_total: 99, stages_done: 98 });
  });

  test("the registry and the state file disagreeing, either way", () => {
    const row = (status: string): RegistryRow => ({ uuid: "u-1", slug: "sample", dirName: "261020-sample", scope: "feature", repos: [], status });
    const running = parseState(stateText({ rows: ROWS, status: "Running" }));
    const completed = parseState(stateText({ rows: ROWS, status: "Completed" }));
    expect(intentStatus(completed, row("in-flight"))).toBe("completed");
    expect(intentStatus(running, row("complete"))).toBe("running");
    expect(intentStatus(running, row("archived"))).toBe("archived");
    expect(intentStatus(parseState(stateText({ rows: ROWS, status: "Archived" })), row("in-flight"))).toBe("archived");
    // Only an unreadable state file leaves the answer to the registry.
    expect(intentStatus(parseState(""), row("in-flight"))).toBe("running");
    expect(intentStatus(parseState("\u0000\u0001binary"), row("complete"))).toBe("completed");
    expect(intentStatus(parseState(""), null)).toBe("unknown");
    expect(summary("", 0, row("in-flight"))).toMatchObject({ label: "sample", scope: "feature", status: "running", group: "in-progress" });
  });

  test("the label is the registry slug, else the folder name without its date", () => {
    expect(summary(stateText({ rows: ROWS })).label).toBe("sample");
    const conflicted = `<<<<<<< HEAD\n[{"uuid":"a","slug":"x","dirName":"261020-sample","status":"in-flight"}]\n=======\n[]\n>>>>>>> other\n`;
    expect(parseRegistry(conflicted)).toBeNull();
    expect(parseRegistry("not json")).toBeNull();
    expect(parseRegistry('{"intents": []}')).toBeNull();
    expect(parseRegistry('[{"uuid":"a","slug":"x","dirName":"d","scope":"poc","repos":["r", 3],"status":"in-flight"}, 7]')).toEqual([
      { uuid: "a", slug: "x", dirName: "d", scope: "poc", repos: ["r"], status: "in-flight" },
    ]);
  });

  test("the intent opened first: the cursor, else the only live one, else the running one updated last", () => {
    const intent = (record: string, status: IntentSummary["status"], updated: string | null): IntentSummary => ({
      space: "default",
      record,
      label: record,
      scope: "poc",
      depth: "Standard",
      phase: "INCEPTION",
      current_stage: null,
      current_stage_name: null,
      status,
      group: status === "archived" ? "archived" : status === "completed" ? "done" : "in-progress",
      needs: null,
      stages_done: 0,
      stages_total: 0,
      updated_at: updated,
      description: "",
    });
    const intents = [
      intent("261001-old", "running", "2026-10-01T00:00:00.000Z"),
      intent("261002-new", "running", "2026-10-02T00:00:00.000Z"),
      intent("261003-gone", "archived", "2026-10-03T00:00:00.000Z"),
      intent("261004-done", "completed", "2026-10-04T00:00:00.000Z"),
    ];
    const registry: RegistryRow[] = [{ uuid: "0193-u", slug: "old", dirName: "261001-old", scope: "poc", repos: [], status: "in-flight" }];
    expect(selectIntent(intents, "261003-gone", registry)).toBe("261003-gone");
    expect(selectIntent(intents, "old", registry)).toBe("261001-old");
    expect(selectIntent(intents, "0193-u", registry)).toBe("261001-old");
    expect(selectIntent(intents, "no-such", registry)).toBe("261002-new");
    expect(selectIntent([intents[0], intents[2]], null, registry)).toBe("261001-old");
    expect(selectIntent([intents[2], intents[3], intent("261005-x", "completed", null)], null, registry)).toBeNull();
  });
});

describe("per-unit stages and the team table", () => {
  test("a unit folder is a phase folder that is not one of its stages", () => {
    expect(unitFolders(["build-and-test", "notification-core", "notification-email"], new Set(["code-generation", "build-and-test"]))).toEqual([
      "notification-core",
      "notification-email",
    ]);
  });

  test("a stage folder's files sort into questions, diary and artifacts", () => {
    const file = (name: string) => ({ name, rel: `r/${name}`, size: 1, mtimeMs: 0 });
    const roles = stageFileRoles("code-generation", [file("code-generation-questions.md"), file("memory.md"), file("code-summary.md")]);
    expect(roles.questions?.name).toBe("code-generation-questions.md");
    expect(roles.diary?.name).toBe("memory.md");
    expect(roles.artifacts.map((each) => each.name)).toEqual(["code-summary.md"]);
  });

  const TEAM = stateText({
    rows: "### CONSTRUCTION PHASE\nPer unit: ignored-name\n- [-] functional-design — EXECUTE\n- [ ] code-generation — EXECUTE\n- [ ] build-and-test — EXECUTE",
    current: "functional-design",
    extra: [
      "## Unit Progress",
      "<!-- Derived, engine-owned projection; routing ignores hand edits. -->",
      "| unit | owner | functional-design | code-generation | gate |",
      "| --- | --- | --- | --- | --- |",
      "| notification-core | alice | [x] | [?] | [ ] |",
      "| notification-email | - | [-] | [ ] | [ ] |",
      "",
    ].join("\n"),
  });

  test("the Unit Progress table gives each unit its cells, and a unit awaiting review needs you", () => {
    const payload = workflow(TEAM, {
      stages: new Map([
        [
          "functional-design",
          {
            questions: null,
            artifacts: [],
            diary: null,
            reviews: [],
            units: [{ unit: "notification-extra", questions: null, artifacts: [], diary: null }],
          },
        ],
      ]),
    });
    expect(payload.unit_progress).toEqual([
      {
        unit: "notification-core",
        owner: "alice",
        cells: [
          { stage: "functional-design", marker: "x" },
          { stage: "code-generation", marker: "?" },
        ],
        gate: " ",
        needs_you: true,
      },
      {
        unit: "notification-email",
        owner: null,
        cells: [
          { stage: "functional-design", marker: "-" },
          { stage: "code-generation", marker: " " },
        ],
        gate: " ",
        needs_you: false,
      },
    ]);
    expect(payload.needs).toEqual({ kind: "gate", label: "Review approval gate" });
    expect(stage(payload, "functional-design").units.map(({ unit, marker, word, label, sentence }) => ({ unit, marker, word, label, sentence }))).toEqual([
      { unit: "notification-core", marker: "x", word: "done", label: "done", sentence: { text: "Done", tone: "ok", at: null } },
      { unit: "notification-email", marker: "-", word: "current", label: "current", sentence: { text: "In progress", tone: "quiet" } },
      { unit: "notification-extra", marker: null, word: null, label: null, sentence: null },
    ]);
    expect(stage(payload, "code-generation").units.map((unit) => unit.word)).toEqual(["in-review", "later"]);
    expect(stage(payload, "build-and-test").units).toEqual([]);
    expect(summaryNeeds(TEAM)).toEqual({ kind: "gate", label: "Review approval gate" });
    // The review waits at Code Generation, not at Current Stage; the intent's line says so.
    expect(stage(payload, "functional-design").sentence).toEqual({ text: "In progress", tone: "quiet" });
    expect(payload.sentence).toEqual({ text: "Awaiting your review · r1", tone: "needs" });
  });

  test("each unit's word, revision and header line come from its own cell and its own audit rows", () => {
    const state = stateText({
      rows: "### CONSTRUCTION PHASE\n- [x] functional-design — EXECUTE\n- [-] code-generation — EXECUTE",
      current: "code-generation",
      extra: [
        "## Unit Progress",
        "| unit | owner | functional-design | code-generation | gate |",
        "| --- | --- | --- | --- | --- |",
        "| auth | alice | [x] | [?] | [?] |",
        "| web | bob | [x] | [-] | [ ] |",
        "| ops | - | [x] | [R] | [ ] |",
        "",
      ].join("\n"),
    });
    const audit = shard(
      block("STAGE_STARTED", "2026-10-20T07:00:00Z", { Stage: "functional-design" }),
      block("UNIT_STARTED", "2026-10-20T07:01:00Z", { Stage: "functional-design", Unit: "auth" }),
      block("GATE_APPROVED", "2026-10-20T07:30:00Z", { Stage: "functional-design", Unit: "auth", "User Input": "Approve" }),
      block("STAGE_STARTED", "2026-10-20T08:00:00Z", { Stage: "code-generation" }),
      block("UNIT_STARTED", "2026-10-20T08:01:00Z", { Stage: "code-generation", Unit: "auth" }),
      block("UNIT_STARTED", "2026-10-20T08:02:00Z", { Stage: "code-generation", Unit: "web" }),
      block("UNIT_STARTED", "2026-10-20T08:03:00Z", { Stage: "code-generation", Unit: "ops" }),
      block("GATE_REJECTED", "2026-10-20T08:30:00Z", { Stage: "code-generation", Unit: "ops", Feedback: "split it" }),
      block("STAGE_REVISING", "2026-10-20T08:30:00Z", { Stage: "code-generation", Unit: "ops" }),
      block("GATE_REJECTED", "2026-10-20T08:40:00Z", { Stage: "code-generation", Unit: "ops", Feedback: "again" }),
      block("STAGE_REVISING", "2026-10-20T08:40:00Z", { Stage: "code-generation", Unit: "ops" }),
    );
    const payload = workflow(state, { shards: [audit] });
    const codeGeneration = stage(payload, "code-generation");
    expect(codeGeneration.units.map(({ unit, word, label, sentence }) => ({ unit, word, label, sentence }))).toEqual([
      { unit: "auth", word: "in-review", label: "in review · r1", sentence: { text: "Awaiting your review · r1", tone: "needs" } },
      { unit: "web", word: "current", label: "current", sentence: { text: "In progress", tone: "quiet" } },
      { unit: "ops", word: "revising", label: "revising", sentence: { text: "Revising · r3", tone: "quiet" } },
    ]);
    // The stage has been sent back twice (for ops), but the review waiting is auth's first.
    expect(codeGeneration.revision).toBe(3);
    expect(codeGeneration.sentence).toEqual({ text: "Awaiting your review · r1", tone: "needs" });
    expect(payload.sentence).toEqual({ text: "Awaiting your review · r1", tone: "needs" });
    expect(stage(payload, "functional-design").units.map((unit) => unit.sentence)).toEqual([
      { text: "Done", tone: "ok", at: "2026-10-20T07:30:00.000Z" },
      { text: "Done", tone: "ok", at: null },
      { text: "Done", tone: "ok", at: null },
    ]);
  });

  test("a unit-end gate waits at the last per-unit stage, on a unit whose cells are all done", () => {
    const state = stateText({
      rows: "### CONSTRUCTION PHASE\n- [-] functional-design — EXECUTE\n- [-] code-generation — EXECUTE",
      current: "functional-design",
      extra: [
        "## Unit Progress",
        "| unit | owner | functional-design | code-generation | gate |",
        "| --- | --- | --- | --- | --- |",
        "| alpha | - | [x] | [x] | [?] |",
        "| beta | - | [ ] | [ ] | [ ] |",
        "",
      ].join("\n"),
    });
    const payload = workflow(state);
    expect(payload.needs).toEqual({ kind: "gate", label: "Review approval gate" });
    const alphaAt = (slug: string) => stage(payload, slug).units.find((unit) => unit.unit === "alpha");
    expect(alphaAt("code-generation")).toMatchObject({
      marker: "x",
      word: "in-review",
      label: "in review · r1",
      sentence: { text: "Awaiting your review · r1", tone: "needs" },
    });
    expect(alphaAt("functional-design")?.word).toBe("done");
    expect(stage(payload, "code-generation").sentence).toEqual({ text: "Awaiting your review · r1", tone: "needs" });
    expect(stage(payload, "functional-design").sentence).toEqual({ text: "In progress", tone: "quiet" });
    expect(payload.sentence).toEqual({ text: "Awaiting your review · r1", tone: "needs" });
    expect(payload.unit_progress.map((row) => row.needs_you)).toEqual([true, false]);
  });

  function summaryNeeds(state: string) {
    return intentSummary({ space: "default", record: "261020-sample", registry: null, state: parseState(state), stateMtimeMs: null }, 0).needs;
  }
});

describe("questions files", () => {
  test("code, comments and HTML never hold a question, an option or an answer", () => {
    const parsed = parseQuestions(
      [
        "## Q1. Visible",
        "",
        "```",
        "## Q9. In a fence",
        "[Answer]: fenced",
        "```",
        "",
        "<!--",
        "## Q8. In a comment",
        "[Answer]: commented",
        "-->",
        "",
        "<div>",
        "[Answer]: in html",
        "</div>",
        "",
        "`[Answer]:` in a code span is not an answer.",
        "",
        "    [Answer]: indented code",
        "",
        "<span>[Answer]: inline html</span>",
        "",
        "[Answer]:",
        "",
      ].join("\n"),
    );
    expect(parsed.questions.map((q) => [q.number, q.open, q.answer])).toEqual([[1, true, null]]);
    expect(parsed.questions[0].prompt).toBe("`[Answer]:` in a code span is not an answer.\n\n[Answer]: inline html");
  });

  test("an answer of underscores or nothing is open; a letter names its option", () => {
    const parsed = parseQuestions(
      [
        "## Q1. [Developer] Pick one",
        "Which one?",
        "A. First",
        "B. Second",
        "",
        "[Answer]: B",
        "",
        "## 🎯 Q2. Pick several (select all that apply)",
        "",
        "- A. One",
        "- B. Two",
        "- C. Three",
        "",
        "[Answer]: A, C",
        "",
        "## Q3: No options",
        "",
        "[Answer]: _____",
        "",
        "## Q4. A bare letter that names no option",
        "",
        "- A. Only",
        "",
        "[Answer]: A great idea",
        "",
      ].join("\n"),
    );
    expect(parsed.questions.map(({ number, title, role, prompt, chosen, chosen_all, open }) => ({ number, title, role, prompt, chosen, chosen_all, open }))).toEqual([
      { number: 1, title: "Pick one", role: "Developer", prompt: "Which one?", chosen: "B", chosen_all: ["B"], open: false },
      { number: 2, title: "Pick several (select all that apply)", role: null, prompt: "", chosen: "A", chosen_all: ["A", "C"], open: false },
      { number: 3, title: "No options", role: null, prompt: "", chosen: null, chosen_all: [], open: true },
      { number: 4, title: "A bare letter that names no option", role: null, prompt: "", chosen: null, chosen_all: [], open: false },
    ]);
    expect(parsed.questions[0].options).toEqual([
      { letter: "A", text: "First" },
      { letter: "B", text: "Second" },
    ]);
    expect({ total: parsed.total, answered: parsed.answered, open: parsed.open }).toEqual({ total: 4, answered: 3, open: 1 });
  });

  test("confirmation, approval and change-request sections are reported apart, in plain words", () => {
    const parsed = parseQuestions(
      [
        "## Sources",
        "- [desc] Initial description: something",
        "",
        "## Q1. Only question",
        "[Answer]: done",
        "",
        "## Consolidated Summary Confirmation",
        "- Looks correct",
        "- Request changes",
        "",
        "[Answer]: Looks correct",
        "",
        "## Assumption Confirmation",
        "- A. Accept assumptions",
        "- B. Convert to follow-up questions",
        "",
        "[Answer]: B. Convert to follow-up questions",
        "",
        "## Requested Changes Feedback",
        "",
        "[Answer]:",
        "",
        "## Q5. Code Generation Plan Approval",
        "",
        "[Approval Fingerprint]: sha256:v3:abc",
        "[Planned Source]: 1234",
        "",
        "- Approve Plan",
        "- Request Changes",
        "",
        "[Answer]:",
        "",
      ].join("\n"),
    );
    expect(parsed.total).toBe(1);
    expect(parsed.sections).toEqual([
      { title: "Consolidated Summary Confirmation", state: "answered", answer: "Looks correct", note: "summary confirmed" },
      { title: "Assumption Confirmation", state: "answered", answer: "B. Convert to follow-up questions", note: "assumptions turned into follow-up questions" },
      { title: "Requested Changes Feedback", state: "open", answer: null, note: "waiting for you to say what should change" },
      { title: "Code Generation Plan Approval", state: "open", answer: null, note: "waiting for your approval of the plan" },
    ]);
    expect(openAnswers(parsed)).toBe(2);
    const approved = parseQuestions("## Plan Approval\n\n[Approval Fingerprint]: x\n\n[Answer]: Approve Plan\n");
    expect(approved.sections.map((section) => section.note)).toEqual(["plan approved"]);
    const off = parseQuestions("## Plan Approval\n\n[Answer]: Plan approval off\n");
    expect(off.sections.map((section) => section.note)).toEqual(["plan approval was off"]);
  });

  test("a plan answer with its option letter, as the engine writes it, reads as the choice it names", () => {
    const note = (answer: string) =>
      parseQuestions(`## Plan Approval\n\n- A. Approve Plan\n- B. Request Changes\n- C. I'll edit the files\n\n[Answer]: ${answer}\n`).sections.map(
        (section) => section.note,
      );
    expect(note("B. Request Changes")).toEqual(["changes to the plan requested"]);
    expect(note("A. Approve Plan")).toEqual(["plan approved"]);
    expect(note("Request Changes")).toEqual(["changes to the plan requested"]);
    expect(note("B")).toEqual(["plan answered"]);
  });

  test("an option's text wrapped onto the next line stays that option's", () => {
    const tight = parseQuestions("## Q1. Pick\n\nWhich one?\n\n- A. a long option that\n  wraps onto a second line\n- B. second\n\n[Answer]: A\n");
    expect(tight.questions[0]).toMatchObject({
      prompt: "Which one?",
      options: [
        { letter: "A", text: "a long option that wraps onto a second line" },
        { letter: "B", text: "second" },
      ],
      chosen: "A",
    });
    const loose = parseQuestions("## Q1. Pick\n\n- A. first part\nlazy rest\n\n- B. second\n\nA note after the options.\n\n[Answer]: B\n");
    expect(loose.questions[0].options).toEqual([
      { letter: "A", text: "first part lazy rest" },
      { letter: "B", text: "second" },
    ]);
    expect(loose.questions[0].prompt).toBe("A note after the options.");
  });

  test("the summary counts an open confirmation with the open questions, as Needs you does", () => {
    const parsed = parseQuestions("## Q1. One\n\n- A. x\n\n[Answer]: A\n\n## Consolidated Summary Confirmation\n\n[Answer]:\n");
    expect(summarizeQuestions("p", parsed)).toEqual({
      path: "p",
      total: 1,
      answered: 1,
      open: 0,
      open_answers: 1,
      sections: ["waiting for you to confirm the summary"],
    });
    const payload = workflow(stateText({ rows: "### INCEPTION PHASE\n- [-] requirements-analysis — EXECUTE", current: "requirements-analysis" }), {
      stages: new Map([["requirements-analysis", questionsInput("requirements-analysis", "## Q1. One\n\n[Answer]: A\n\n## Consolidated Summary Confirmation\n\n[Answer]:\n")]]),
    });
    expect(payload.needs).toEqual({ kind: "questions", label: "1 question" });
    expect(stage(payload, "requirements-analysis")).toMatchObject({ word: "questions", questions: { open: 0, open_answers: 1 } });
  });

  test("a one-word answer is not lost to Markdown's link definitions", () => {
    expect(parseQuestions("## Q1. One\n\n- A. x\n- B. y\n\n[Answer]: B\n").questions[0]).toMatchObject({ answer: "B", chosen: "B", open: false });
    expect(visibleBlocks("[Answer]: B\n")).toEqual([{ heading: null, lines: [`${TAG_MARK}[Answer]: B`] }]);
  });

  test("a question under an H3 heading counts too; other deeper headings are its text", () => {
    const parsed = parseQuestions(
      [
        "# Questions",
        "",
        "### Q1. First",
        "",
        "#### Background",
        "",
        "Some context.",
        "",
        "- A. x",
        "",
        "[Answer]: A",
        "",
        "### Q2. Second",
        "",
        "[Answer]:",
        "",
        "## Consolidated Summary Confirmation",
        "",
        "[Answer]: Looks correct",
        "",
      ].join("\n"),
    );
    expect(parsed.questions.map(({ number, title, prompt, chosen, open }) => ({ number, title, prompt, chosen, open }))).toEqual([
      { number: 1, title: "First", prompt: "Background\n\nSome context.", chosen: "A", open: false },
      { number: 2, title: "Second", prompt: "", chosen: null, open: true },
    ]);
    expect(parsed.sections.map((section) => section.note)).toEqual(["summary confirmed"]);
  });

  test("an answer counts only where it starts a line, as the engine reads it", () => {
    for (const line of ["- [Answer]: B", "> [Answer]: B", "   [Answer]: B", "  [Answer]: two words", "[answer]: B"]) {
      expect(parseQuestions(`## Q1. One\n\n- A. x\n- B. y\n\n${line}\n`).questions[0], line).toMatchObject({ answer: null, open: true });
    }
    // A line right under a list item is still a line of its own in the source.
    expect(parseQuestions("## Q1. One\n\n- A. x\n- B. y\n[Answer]: B\n").questions[0]).toMatchObject({ answer: "B", chosen: "B" });
  });

  test("CRLF and malformed files read without throwing", () => {
    const crlf = parseQuestions("## Q1. One\r\n\r\n- A. x\r\n\r\n[Answer]: A\r\n");
    expect(crlf.questions[0]).toMatchObject({ number: 1, chosen: "A" });
    for (const text of ["", "\u0000\u0001", "## Q0. zero\n[Answer]: x", "## Q1.\n", "[Answer]: orphan\n", "## Q1. x\n[Answer]: a\n[Answer]: b\n"]) {
      expect(() => parseQuestions(text)).not.toThrow();
    }
    expect(parseQuestions("## Q1. x\n[Answer]: a\n[Answer]: b\n").questions[0].answer).toBe("a");
    expect(parseQuestions("## Q0. zero\n[Answer]: x").total).toBe(0);
  });
});

describe("the state file", () => {
  test("fields are anchored at the line start, the first one wins, and an empty one stays empty", () => {
    const parsed = parseState(
      "- **Project**: reads **Status**: Completed in the middle\n- **Scope**:\n- **Depth**: Minimal\n- **Status**: Running\n- **Status**: Completed\n",
    );
    expect(parsed).toMatchObject({ project: "reads **Status**: Completed in the middle", scope: "", depth: "Minimal", status: "Running" });
  });

  test("rows take any of the three separators, a leading emoji on the phase, and ignore a reason tail", () => {
    const parsed = parseState(
      "## Stage Progress\n### 🏗️ CONSTRUCTION PHASE\n- [x] code-generation—EXECUTE\n- [ ] ci-pipeline – SKIP: not needed here\n- [X] build-and-test - EXECUTE\n- [Z] odd-marker — EXECUTE\n- [ ] no-label\n",
    );
    expect(parsed.rows).toEqual([
      { slug: "code-generation", marker: "x", scope: "EXECUTE", phase: "construction" },
      { slug: "ci-pipeline", marker: " ", scope: "SKIP", phase: "construction" },
      { slug: "build-and-test", marker: "x", scope: "EXECUTE", phase: "construction" },
      { slug: "no-label", marker: " ", scope: "unknown", phase: "construction" },
    ]);
  });

  test("CRLF reads like LF, and garbage reads as not a state file", () => {
    const lf = stateText({ rows: ROWS, current: "user-stories" });
    expect(parseState(lf.replaceAll("\n", "\r\n"))).toEqual(parseState(lf));
    expect(parseState("").recognized).toBe(false);
    expect(parseState("\u0000\u0001\u0002 binary").recognized).toBe(false);
    expect(() => parseState("<<<<<<< HEAD\n- **Status**: Running\n=======\n- **Status**: Completed\n>>>>>>> x\n")).not.toThrow();
  });
});

describe("the decisions timeline", () => {
  test("an answer closes every question asked since the answer before it, per stage and unit", () => {
    const timeline = auditTimeline(
      events(
        shard(
          block("DECISION_RECORDED", "2026-10-20T10:00:00Z", { Stage: "intent-capture", Decision: "How would you like to answer?", Options: "Guide me,Chat" }),
          block("QUESTION_ANSWERED", "2026-10-20T10:01:00Z", { Stage: "intent-capture", Details: "Guide me" }),
          block("QUESTION_ANSWERED", "2026-10-20T10:02:00Z", { Stage: "intent-capture", Details: "Q1: B" }),
          block("DECISION_RECORDED", "2026-10-20T10:03:00Z", { Stage: "intent-capture", Decision: "Q7: what next?", Options: "Free-text follow-up" }),
          block("DECISION_RECORDED", "2026-10-20T10:04:00Z", {
            Stage: "intent-capture",
            Decision: "Does this all look correct before I generate the artifact?",
            Options: "Looks correct,Request changes",
            Checkpoint: "Consolidated Summary Confirmation",
          }),
          block("DECISION_RECORDED", "2026-10-20T10:04:30Z", { Stage: "code-generation", Unit: "core", Decision: "Approve this exact Code Generation plan?" }),
          block("SUMMARY_CONFIRMATION_RECORDED", "2026-10-20T10:05:00Z", { Stage: "intent-capture", Details: "Looks correct", Checkpoint: "x" }),
          block("PLAN_APPROVAL_RECORDED", "2026-10-20T10:06:00Z", { Stage: "code-generation", Details: "Approve Plan" }),
          block("PLAN_APPROVAL_RECORDED", "2026-10-20T10:07:00Z", { Stage: "code-generation", Unit: "core", Details: "Approve Plan" }),
        ),
      ),
    );
    const answers = timeline.filter((entry) => entry.kind === "answered").map((entry) => [entry.title, entry.question]);
    expect(answers).toEqual([
      ["Guide me", "How would you like to answer?"],
      ["Q1: B", null],
      ["Summary confirmed", "Q7: what next? · Does this all look correct before I generate the artifact?"],
      ["Plan approved", null],
      ["Plan approved", "Approve this exact Code Generation plan?"],
    ]);
    expect(timeline[0]).toMatchObject({ kind: "asked", title: "How would you like to answer?", summary: "Guide me · Chat" });
  });

  test("gates, revisions, skips and replies carry their own words", () => {
    const timeline = auditTimeline(
      events(
        shard(
          block("STAGE_STARTED", "2026-10-20T09:00:00Z", { Stage: "requirements-analysis" }),
          block("STAGE_AWAITING_APPROVAL", "2026-10-20T09:10:00Z", { Stage: "requirements-analysis" }),
          block("GATE_REJECTED", "2026-10-20T09:20:00Z", { Stage: "requirements-analysis", Feedback: "Name the **Stage**: field properly" }),
          block("STAGE_REVISING", "2026-10-20T09:20:00Z", { Stage: "requirements-analysis", "Revision count": "5", Feedback: "same" }),
          block("STAGE_AWAITING_APPROVAL", "2026-10-20T09:30:00Z", { Stage: "requirements-analysis" }),
          block("QUESTION_REPLIED", "2026-10-20T09:35:00Z", { Question: "Approve?", Reply: "Yes, approve it" }),
          block("GATE_APPROVED", "2026-10-20T09:40:00Z", { Stage: "requirements-analysis", "User Input": "Approve" }),
          block("STAGE_SKIPPED", "2026-10-20T09:50:00Z", { Stage: "user-stories", Reason: "no users" }),
          block("PLAN_APPROVAL_SKIPPED", "2026-10-20T09:55:00Z", { Stage: "code-generation", Details: "Plan approval off", Source: "scope poc" }),
          block("VERIFICATION_COMMAND_RECORDED", "2026-10-20T09:56:00Z", { Stage: "delivery-planning", "Command Label": "bun test" }),
          block("CONSTRUCTION_POLICY_RECORDED", "2026-10-20T09:57:00Z", { Stage: "delivery-planning", Field: "Construction Iteration", Value: "unit-major" }),
        ),
      ),
    );
    expect(timeline.map(({ kind, title, summary, question, stage }) => [kind, title, summary, question, stage])).toEqual([
      ["gate-opened", "Approval gate opened · r1", null, null, "requirements-analysis"],
      ["changes-requested", "Changes requested · r1", "Name the **Stage**: field properly", null, "requirements-analysis"],
      ["revising", "Revising · r2", null, null, "requirements-analysis"],
      ["gate-opened", "Approval gate opened · r2", null, null, "requirements-analysis"],
      ["reply", "Yes, approve it", null, "Approve?", "requirements-analysis"],
      ["approved", "Approved · r2", null, null, "requirements-analysis"],
      ["skipped", "Skipped", "no users", null, "user-stories"],
      ["plan-approval-skipped", "Plan approval was off", "scope poc", null, "code-generation"],
      ["answered", "Verification command approved", "bun test", null, "delivery-planning"],
      ["answered", "Construction Iteration set to unit-major", null, null, "delivery-planning"],
    ]);
  });

  test("equal times in different shards say the order is not known; ties keep shard order", () => {
    const a = shard(block("GATE_APPROVED", "2026-10-20T10:00:00Z", { Stage: "x" }), block("STAGE_SKIPPED", "2026-10-20T10:05:00Z", { Stage: "y" }));
    const b = shard(block("GATE_REJECTED", "2026-10-20T10:00:00Z", { Stage: "z", Feedback: "f" }));
    const timeline = auditTimeline(events(a, b));
    expect(timeline.map((entry) => [entry.event, entry.order_unknown])).toEqual([
      ["GATE_APPROVED", true],
      ["GATE_REJECTED", true],
      ["STAGE_SKIPPED", false],
    ]);
  });

  test("events sort by time across shards, and an undated block keeps its neighbours' place", () => {
    const a = shard(block("STAGE_STARTED", "2026-10-20T10:00:00Z", { Stage: "a" }), "## Note\n**Event**: STAGE_SKIPPED\n**Stage**: undated", block("GATE_APPROVED", "2026-10-20T12:00:00Z", { Stage: "a" }));
    const b = shard(block("STAGE_STARTED", "2026-10-20T11:00:00Z", { Stage: "b" }));
    expect(events(a, b).map((event) => event.fields.get("stage"))).toEqual(["a", "undated", "b", "a"]);
  });

  test("a stage's revision counts its revisions since it last started, never the intent's count", () => {
    const facts = stageFacts(
      events(
        shard(
          block("STAGE_STARTED", "2026-10-20T08:00:00Z", { Stage: "s" }),
          block("STAGE_REVISING", "2026-10-20T08:10:00Z", { Stage: "s", "Revision count": "9" }),
          block("STAGE_REVISING", "2026-10-20T08:20:00Z", { Stage: "s", "Revision count": "10" }),
          block("GATE_REJECTED", "2026-10-20T08:30:00Z", { Stage: "s", Feedback: "x" }),
          block("STAGE_STARTED", "2026-10-20T09:00:00Z", { Stage: "s" }),
          block("STAGE_REVISING", "2026-10-20T09:10:00Z", { Stage: "s" }),
          block("STAGE_COMPLETED", "2026-10-20T09:20:00Z", { Stage: "s" }),
          block("STAGE_SKIPPED", "2026-10-20T09:30:00Z", { Stage: "t", Reason: "nothing to do" }),
        ),
      ),
    );
    expect(facts.get("s")).toEqual({ started: true, revision: 2, revisingTotal: 3, decidedAt: "2026-10-20T08:30:00.000Z", skipReason: null });
    expect(facts.get("t")).toEqual({ started: false, revision: 0, revisingTotal: 0, decidedAt: "2026-10-20T09:30:00.000Z", skipReason: "nothing to do" });
  });

  test("a field written inside another field's value is not that field", () => {
    const [event] = parseShard(block("GATE_REJECTED", "2026-10-20T10:00:00Z", { Stage: "real-stage", Feedback: "see **Stage**: fake-stage" }), 0);
    expect(event.fields.get("stage")).toBe("real-stage");
    const crlf = parseShard(block("GATE_APPROVED", "2026-10-20T10:00:00Z", { Stage: "s" }).replaceAll("\n", "\r\n"), 0);
    expect(crlf.map((each) => [each.event, each.fields.get("stage"), each.time])).toEqual([["GATE_APPROVED", "s", Date.parse("2026-10-20T10:00:00Z")]]);
    const twice = parseShard("**Timestamp**: 2026-10-20T10:00:00Z\n**Timestamp**: 2026-10-20T11:00:00Z\n**Event**: GATE_APPROVED\n", 0);
    expect(twice[0].timestamp).toBe("2026-10-20T10:00:00Z");
  });

  test("malformed shards degrade without throwing", () => {
    for (const text of ["", "---\n---\n", "\u0000\u0001", "**Event**: lower_case\n", "**Event**:\n**Timestamp**: never\n"]) {
      expect(() => auditTimeline(events(text))).not.toThrow();
    }
    expect(parseShard("**Event**: GATE_APPROVED\n**Timestamp**: not a time\n", 0)[0]).toMatchObject({ time: null, timestamp: "not a time" });
  });

  test("a review file is a timeline entry with its number and verdict", () => {
    const entry = reviewEntry({
      stage: "requirements-analysis",
      unit: null,
      file: { name: "review-02.md", rel: "aidlc/x/reviews/review-02.md", size: 10, mtimeMs: 0 },
      text: "## Review\n\n**Verdict:** READY\n**Date:** 2026-10-16T12:00:39Z\n",
    });
    expect(entry).toMatchObject({ kind: "review", event: "REVIEW", title: "Review 2 · READY", at: "2026-10-16T12:00:39.000Z", path: "aidlc/x/reviews/review-02.md" });
  });

  test("files left out are said in plain words", () => {
    expect(fileNotes("too-large", ["too-large", "binary", "unreadable", "unreadable"])).toEqual([
      "The state file is over 4 MiB, so this view shows only what the registry says.",
      "1 audit file over 4 MiB was left out.",
      "1 audit file that is not text was left out.",
      "2 audit files could not be read and were left out.",
    ]);
    expect(fileNotes(null, [])).toEqual([]);
  });
});

// Each line below is built so that a pattern able to match it more than one
// way retries every way before it fails: at these sizes that took from minutes
// to days, while reading each line in one pass takes milliseconds. So each case
// only checks what was read; the case timeout is the backstop.
describe("input built to make a pattern retry", () => {
  const LINE_SEPARATOR = String.fromCodePoint(0x2028);
  const FAMILY = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466);

  test("a state file's headings, emoji, phase titles, fields and rows", () => {
    const parsed = parseState(
      [
        `## Notes${" ".repeat(20_000)}x`,
        `#${" ".repeat(20_000)}${LINE_SEPARATOR}`,
        `### ${FAMILY.repeat(40)}x`,
        `### A${" ".repeat(3_000_000)}x`,
        `- **Project**:${" ".repeat(1_500_000)}${LINE_SEPARATOR}`,
        "### INCEPTION PHASE",
        `- [x] ${"a".repeat(1_500_000)}!${LINE_SEPARATOR}`,
        `- [x] a${":".repeat(1_500_000)}a — EXECUTE`,
        "- [x] requirements-analysis — EXECUTE",
      ].join("\n"),
    );
    expect(parsed).toMatchObject({ recognized: true, project: "", phases: ["inception"] });
    expect(parsed.rows).toEqual([{ slug: "requirements-analysis", marker: "x", scope: "EXECUTE", phase: "inception" }]);
  });

  test("a questions file's titles, options and answers", () => {
    const parsed = parseQuestions(
      [
        `## Q1. a${".".repeat(1_500_000)}x`,
        "",
        `A.${" ".repeat(1_500_000)}x${LINE_SEPARATOR}y`,
        "",
        `[Answer]:${" ".repeat(1_500_000)}A${LINE_SEPARATOR}`,
        "",
        `## Summary Confirmation${".".repeat(1_500_000)}x`,
        "",
      ].join("\n"),
    );
    expect(parsed.total).toBe(1);
    expect(parsed.questions[0]).toMatchObject({ number: 1, options: [{ letter: "A", text: `x${LINE_SEPARATOR}y` }], answer: "A", chosen: "A", open: false });
    expect(parsed.questions[0].title).toHaveLength(1_500_002);
    expect(parsed.sections).toEqual([]);
  });

  test("an audit shard as large as the read cap allows, and many questions left unanswered", () => {
    const count = 135_000;
    const text = Array.from({ length: count }, () => "**Event**: STAGE_REVISING").join("\n---\n");
    expect(text.length).toBeLessThan(4 * 1024 * 1024);
    const ordered = orderEvents(parseShard(text, 0));
    expect(ordered).toHaveLength(count);
    expect(ordered.every((event, index) => event.index === index)).toBe(true);
    const asked = Array.from({ length: 60_000 }, (_, index) => block("DECISION_RECORDED", "2026-10-20T10:00:00Z", { Stage: "s", Decision: `q${index}` }));
    const timeline = auditTimeline(events(shard(...asked, block("QUESTION_ANSWERED", "2026-10-20T11:00:00Z", { Stage: "s", Details: "done" }))));
    expect(timeline).toHaveLength(60_001);
    expect(timeline.at(-1)?.question?.split(" · ")).toHaveLength(60_000);
  });
});
