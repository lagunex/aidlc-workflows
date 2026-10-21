# Intent Capture Questions — viz-graph-view

## Sources

- [desc] Initial description: "feature for the aidlc visualizer , add the following features: - markdown viewer - state graph doesn't give a graph view. Make each phase a vertical line next to each other (because they are sequential), besides it is the list of all stages for that phase, lines should read from left to right the full path of the intent. At the moment I just have disconnected boxes - intent 261014-aidlc-viz-server is complete but progress bar only shows 21% because 7 stages are done. However, the other stages were never part of the flow. This is 100% - intent 261014-aidlc-viz-server shows that stage graph with a lot of boxes pending when they are not pending. They were not part of the flow in the first place and never will be. keep in mind that this is still in poc scope"
- [scope] Workflow-selected scope: `poc`.

## Q1. What business problem are we solving?

This feature set targets the aidlc visualizer. The stated pains are: (a) no way to read the markdown artifacts a workflow produces, (b) the stage view shows disconnected boxes instead of a readable path through the workflow, and (c) progress and stage status are misleading for a completed intent because stages that were never part of the flow are shown as pending and counted against progress. Is the core problem "the visualizer misrepresents a completed workflow's real progress and gives no readable view of its stages or artifacts"?

- A. Yes — the problem is that the visualizer misrepresents real progress and lacks a readable stage/artifact view.
- B. Mostly, but the primary pain is the misleading progress/pending status, and the views are secondary.
- C. Mostly, but the primary pain is readability (graph view + markdown), and the progress fix is secondary.
- D. Not applicable / no single core problem — treat all three as independent asks of equal weight.
- X. Other (please specify)

[Answer]: A. Yes — the problem is that the visualizer misrepresents real progress and lacks a readable stage/artifact view.

## Q2. Who is the user, and what are they trying to do?

Who looks at this visualizer, and for what?

- A. The developer running AI-DLC workflows (you), to monitor and review their own in-progress and completed intents locally.
- B. A team reviewing shared workflow records (multiple viewers, possibly non-authors).
- C. Both A and B.
- D. Not yet defined.
- X. Other (please specify)

[Answer]: C. Both A and B.

## Q3. The markdown viewer — what should it let the user do?

What is the minimum useful behavior for the markdown viewer in this POC?

- A. Click a stage/artifact and render its markdown file (e.g. intent-statement.md, questions files) as formatted HTML in the UI.
- B. Just render raw markdown text (no formatting) — a plain file viewer is enough for the POC.
- C. Render formatted markdown AND support navigating between a record's artifacts (a list/tree of files).
- D. Not yet defined.
- X. Other (please specify)

[Answer]: A. Click a stage/artifact and render its markdown file as formatted HTML in the UI.

## Q4. The graph view — how literally should the layout match your description?

You described: each phase is a vertical line; the phases sit next to each other left-to-right (sequential); within a phase, its stages are listed on that vertical line; reading left-to-right traces the full path of the intent. Is that the intended layout?

- A. Yes — vertical line per phase, phases ordered left-to-right, stages stacked within each phase's column, forming a readable left-to-right path.
- B. Yes to the structure, but connections (lines/arrows) between stages/phases matter too — show the path as connected, not just columns.
- C. The layout is a starting point — prioritize "a connected graph instead of disconnected boxes" and you choose the exact arrangement.
- D. Not yet defined.
- X. Other (please specify)

[Answer]: C. The layout is a starting point — prioritize "a connected graph instead of disconnected boxes" and you choose the exact arrangement.

## Q5. The progress & stage-status fix — what is the correct source of truth?

For intent 261014-aidlc-viz-server, stages that were never part of the flow are shown pending and drag progress to ~21% when it should read 100%. How should the visualizer decide what counts?

- A. Only in-scope stages count: a completed workflow whose in-scope stages are all done is 100%, and out-of-scope stages are not shown as pending (hidden, or shown as a distinct "not in this flow" state).
- B. Same as A for the math, but still display out-of-scope stages visibly marked as "not part of this flow" (not pending, not counted).
- C. Not yet defined — needs investigation of how the data distinguishes in-scope from out-of-scope stages.
- X. Other (please specify)

[Answer]: A. Only in-scope stages count: a completed workflow whose in-scope stages are all done is 100%, and out-of-scope stages are not shown as pending (hidden, or shown as a distinct "not in this flow" state).

## Q6. Does the `poc` scope match your intended boundary for this work?

The workflow was started as `poc` (Minimal depth: lightweight artifacts, fewest stages, build on the existing aidlc-viz project rather than a production rework). Does that match what you want here?

- A. Yes — keep it a POC: smallest changes to the existing aidlc-viz app that make these three things work.
- B. Confirm POC, but note a specific must-have constraint (specify in Other).
- C. No — I want a different product boundary (specify in Other).
- X. Other (please specify)

[Answer]: A. Yes — keep it a POC: smallest changes to the existing aidlc-viz app that make these three things work.

## Consolidated Summary Confirmation

Summary of answers:

- Core problem: the visualizer misrepresents a completed workflow's real progress and lacks a readable stage/artifact view.
- Users: both the solo developer running workflows locally and a team reviewing shared records.
- Markdown viewer: click a stage/artifact and render its markdown file as formatted HTML in the UI.
- Graph view: a connected graph instead of disconnected boxes is the priority; phase-column left-to-right layout is a starting point, exact arrangement left to implementation.
- Progress/status fix: only in-scope stages count; a completed workflow with all in-scope stages done reads 100%, and out-of-scope stages are not shown as pending.
- Scope: confirmed `poc` — smallest changes to the existing aidlc-viz app that make these three things work.

- Looks correct
- Request changes

[Answer]: Looks correct

## Assumption Confirmation

The intent statement records these assumptions:

1. The exact visual arrangement of the connected graph is left to implementation; the phase-as-vertical-line, left-to-right phase ordering is a starting point rather than a fixed spec. [assumption]
2. How the visualizer's data distinguishes in-scope stages from stages that were never part of a flow is not yet established and will be determined from the existing aidlc-viz data model in a later stage. [assumption]

- A. Accept assumptions
- B. Convert to follow-up questions

[Answer]: A. Accept assumptions
