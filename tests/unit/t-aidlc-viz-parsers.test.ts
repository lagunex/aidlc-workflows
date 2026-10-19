// covers: file:scripts/aidlc-viz/state.ts, file:scripts/aidlc-viz/audit.ts, file:scripts/aidlc-viz/markdown.ts
//
// The visualizer's pure readers: aidlc-state.md into stages, progress and
// phase columns; audit shards into the decision list; artifact Markdown into
// HTML that carries no markup or script from the artifact itself.
import { describe, expect, test } from "bun:test";
import { DECISION_EVENTS, parseDecisions } from "../../scripts/aidlc-viz/audit.ts";
import { renderMarkdown, safeHref } from "../../scripts/aidlc-viz/markdown.ts";
import {
  buildGraph,
  computeProgress,
  markerToState,
  NOT_IN_FLOW_LABEL,
  PHASE_ORDER,
  parseState,
  type StageEntry,
} from "../../scripts/aidlc-viz/state.ts";

const STATE = `# AI-DLC State Tracking

## Project Information
- **Project**: Sample visualization server
- **Project Type**: Greenfield
- **Scope**: poc
- **Worktree Path**:
- **Bolt Refs**:

## Stage Progress
<!-- Checkbox states: [ ] pending, [-] in-progress, [?] awaiting approval, [R] revising, [x] completed, [S] skipped -->

### CONSTRUCTION PHASE
- [-] code-generation — EXECUTE
- [ ] build-and-test - EXECUTE

### INITIALIZATION PHASE
- [x] workspace-scaffold — EXECUTE

### IDEATION PHASE
- [x] intent-capture — EXECUTE
- [ ] market-research — SKIP: scope poc excludes it
- [?] feasibility – EXECUTE

### INCEPTION PHASE
- [S] user-stories — EXECUTE
- [R] requirements-analysis — EXECUTE
- [ ] contract-design

## Current Status
- **Lifecycle Phase**: CONSTRUCTION
- **Current Stage**: code-generation
- **Next Stage**: build-and-test
- **Status**: Running
`;

function stage(state: StageEntry["state"], scope: StageEntry["scope"] = "EXECUTE"): StageEntry {
  return { slug: "s", state, phase: "p", scope };
}

describe("parseState", () => {
  test("reads the status fields and every stage under its phase heading", () => {
    const parsed = parseState(STATE);
    expect(parsed).toMatchObject({
      title: "Sample visualization server",
      scope: "poc",
      phase: "CONSTRUCTION",
      currentStage: "code-generation",
      status: "Running",
    });
    expect(parsed.stages.map((s) => [s.phase, s.slug, s.state, s.scope])).toEqual([
      ["construction", "code-generation", "in-progress", "EXECUTE"],
      ["construction", "build-and-test", "pending", "EXECUTE"],
      ["initialization", "workspace-scaffold", "completed", "EXECUTE"],
      ["ideation", "intent-capture", "completed", "EXECUTE"],
      ["ideation", "market-research", "pending", "SKIP"],
      ["ideation", "feasibility", "awaiting-approval", "EXECUTE"],
      ["inception", "user-stories", "skipped", "EXECUTE"],
      ["inception", "requirements-analysis", "revising", "EXECUTE"],
      ["inception", "contract-design", "pending", "unknown"],
    ]);
  });

  test("an empty field does not borrow the next line's value", () => {
    const parsed = parseState("- **Project**:\n- **Scope**: poc\n");
    expect(parsed.title).toBe("");
    expect(parsed.scope).toBe("poc");
  });

  test("an empty or partial file reads unknown rather than throwing", () => {
    expect(parseState("")).toEqual({
      title: "",
      scope: "unknown",
      phase: "unknown",
      currentStage: "unknown",
      status: "unknown",
      stages: [],
    });
    expect(parseState("## Current Status\n- **Status**: Running\n").stages).toEqual([]);
  });

  test("a line with an unknown checkbox marker is skipped", () => {
    expect(parseState("### IDEATION PHASE\n- [Z] intent-capture — EXECUTE\n").stages).toEqual([]);
    expect(markerToState("Z")).toBeNull();
    expect(markerToState("")).toBe("pending");
  });
});

describe("computeProgress", () => {
  test("counts completed and jump-skipped stages as done, over EXECUTE stages only", () => {
    expect(computeProgress([stage("completed"), stage("skipped"), stage("pending"), stage("in-progress")])).toEqual({
      done: 2,
      total: 4,
      fraction: 0.5,
    });
  });

  test("SKIP and unlabelled stages are out of both counts, so a finished plan reads 100%", () => {
    const stages = [stage("completed"), stage("completed"), stage("pending", "SKIP"), stage("pending", "unknown")];
    expect(computeProgress(stages)).toEqual({ done: 2, total: 2, fraction: 1 });
  });

  test("no EXECUTE stages reads 0 of 0 rather than dividing by zero", () => {
    expect(computeProgress([])).toEqual({ done: 0, total: 0, fraction: 0 });
    expect(computeProgress([stage("completed", "SKIP")])).toEqual({ done: 0, total: 0, fraction: 0 });
  });
});

describe("buildGraph", () => {
  test("lays phases out in lifecycle order whatever order the file uses", () => {
    expect(buildGraph(parseState(STATE).stages).map((p) => p.phase)).toEqual(PHASE_ORDER.slice(0, 4));
  });

  test("a phase the lifecycle does not name follows the known ones", () => {
    const stages: StageEntry[] = [
      { slug: "a", state: "pending", phase: "verification", scope: "EXECUTE" },
      { slug: "b", state: "pending", phase: "ideation", scope: "EXECUTE" },
    ];
    expect(buildGraph(stages).map((p) => p.phase)).toEqual(["ideation", "verification"]);
  });

  test("labels in-plan stages by marker and state, and every other stage as outside the flow", () => {
    const ideation = buildGraph(parseState(STATE).stages).find((p) => p.phase === "ideation")!;
    expect(ideation.stages).toEqual([
      { slug: "intent-capture", name: "Intent Capture", scope: "EXECUTE", state: "completed", inFlow: true, label: "[x] Completed" },
      { slug: "market-research", name: "Market Research", scope: "SKIP", state: "pending", inFlow: false, label: NOT_IN_FLOW_LABEL },
      { slug: "feasibility", name: "Feasibility", scope: "EXECUTE", state: "awaiting-approval", inFlow: true, label: "[?] Awaiting approval" },
    ]);
  });
});

const AUDIT_A = `# AI-DLC Audit Log

## Decision
**Timestamp**: 2026-10-14T17:30:00Z
**Event**: DECISION_RECORDED
**Stage**: intent-capture
**Decision**: How would you like to answer?
**Options**: Guide me,Edit,Chat

---

## Human Turn
**Timestamp**: 2026-10-14T17:32:00Z
**Event**: HUMAN_TURN

---

## Gate Approved
**Timestamp**: 2026-10-16T09:55:00Z
**Timestamp**: 2026-10-16T10:55:00Z
**Event**: GATE_APPROVED
**Stage**: intent-capture
**User Input**: Approve

---

A free-form note with no event line.
`;

const AUDIT_B = `## Answer
**Timestamp**: 2026-10-14T17:31:00Z
**Event**: QUESTION_ANSWERED
**Stage**: intent-capture
**Details**: Guide me

---

## Gate Rejected
**Timestamp**: 2026-10-16T09:38:00Z
**Event**: GATE_REJECTED
**Stage**: intent-capture
**Feedback**: Please reframe the problem statement.
`;

describe("parseDecisions", () => {
  test("merges shards by timestamp and keeps only the decision events", () => {
    const decisions = parseDecisions([AUDIT_A, AUDIT_B]);
    expect(decisions.map((d) => [d.timestamp, d.event, d.summary])).toEqual([
      ["2026-10-14T17:30:00Z", "DECISION_RECORDED", "How would you like to answer? (options: Guide me,Edit,Chat)"],
      ["2026-10-14T17:31:00Z", "QUESTION_ANSWERED", "Answered: Guide me"],
      ["2026-10-16T09:38:00Z", "GATE_REJECTED", "Gate rejected: Please reframe the problem statement."],
      ["2026-10-16T09:55:00Z", "GATE_APPROVED", "Gate approved: Approve"],
    ]);
    expect(new Set(decisions.map((d) => d.event))).toEqual(new Set(DECISION_EVENTS));
  });

  test("an answer carries the question it answers, and each question is answered once", () => {
    const second = `## Answer\n**Timestamp**: 2026-10-14T17:33:00Z\n**Event**: QUESTION_ANSWERED\n**Stage**: intent-capture\n**Details**: Edit\n`;
    const answers = parseDecisions([AUDIT_A, AUDIT_B, second]).filter((d) => d.event === "QUESTION_ANSWERED");
    expect(answers.map((d) => d.question)).toEqual(["How would you like to answer? (options: Guide me,Edit,Chat)", undefined]);
  });

  test("an answer in another stage is not paired with the question", () => {
    const other = AUDIT_B.replace("**Stage**: intent-capture", "**Stage**: requirements-analysis");
    const answer = parseDecisions([AUDIT_A, other]).find((d) => d.event === "QUESTION_ANSWERED")!;
    expect(answer.question).toBeUndefined();
  });

  test("events without their optional fields still get a summary", () => {
    const bare = DECISION_EVENTS.map((event) => `**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: ${event}\n`).join("---\n");
    expect(parseDecisions([bare]).map((d) => [d.summary, d.stage])).toEqual([
      ["Gate approved", "unknown"],
      ["Gate rejected", "unknown"],
      ["Decision recorded", "unknown"],
      ["Question answered", "unknown"],
    ]);
  });

  test("empty and eventless shards yield no decisions", () => {
    expect(parseDecisions([])).toEqual([]);
    expect(parseDecisions(["", "# AI-DLC Audit Log\n\nnothing here\n"])).toEqual([]);
  });
});

describe("renderMarkdown", () => {
  test("renders the structure artifacts use", () => {
    const html = renderMarkdown(
      "# Title\n\nSome **bold**, *em*, `code` and [a link](https://example.com/a?b=1&c=2).\n\n- one\n- two\n\n1. first\n\n> quoted\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n",
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer nofollow">a link</a>');
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li></ol>");
    expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(html).toContain("<pre><code>const x = 1;\n</code></pre>");
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain('<th class="align-center">a</th>');
    expect(html).toContain('<td class="align-right">2</td>');
  });

  test("raw HTML in an artifact arrives as text", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nhi <img src=x onerror="alert(1)"> and <b>bold</b>\n\n| a |\n|---|\n| <i>x</i> |\n');
    expect(html).not.toMatch(/<(script|img|b|i)[\s>]/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("code keeps its characters escaped", () => {
    expect(renderMarkdown('```\n<x> & "q"\n```\n\n`<y>`')).toBe(
      "<pre><code>&lt;x&gt; &amp; &quot;q&quot;\n</code></pre><p><code>&lt;y&gt;</code></p>",
    );
  });

  test("a link with an unsafe scheme keeps only its text", () => {
    for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd"]) {
      const html = renderMarkdown(`[click](${url})`);
      expect(html).toBe("<p>click</p>");
    }
  });

  test("images render as links, never as fetches, and unsafe ones as text", () => {
    expect(renderMarkdown("![diagram](images/flow.png)")).toBe(
      '<p><a href="images/flow.png" rel="noopener noreferrer nofollow">diagram</a></p>',
    );
    expect(renderMarkdown("![x](javascript:alert(1))")).toBe("<p>x</p>");
  });

  test("an attribute-breaking URL stays inside its attribute", () => {
    const html = renderMarkdown('[x](https://e.com/"onmouseover="alert(1))');
    expect(html).not.toContain('" onmouseover');
    expect(html).not.toMatch(/href="[^"]*"onmouseover/);
  });
});

describe("safeHref", () => {
  test("allows http, https, mailto, relative and anchor links", () => {
    for (const url of ["https://e.com", "http://e.com", "mailto:a@b.c", "../x.md", "#section", "//cdn.example.com/x"]) {
      expect(safeHref(url)).toBe(url);
    }
  });

  test("judges a scheme with control characters or spaces hidden in it", () => {
    expect(safeHref("java\tscript:alert(1)")).toBeNull();
    expect(safeHref(" javascript:alert(1)")).toBeNull();
    expect(safeHref("java\u0000script:alert(1)")).toBeNull();
    expect(safeHref("ftp://e.com")).toBeNull();
  });
});
