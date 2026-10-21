# Requirements Analysis Questions — viz-graph-view

Context (from the code knowledge base, for grounding — not questions):
- The app reads each intent's `aidlc-state.md` as the sole source of truth for stages, progress, and EXECUTE/SKIP scope.
- Progress today = (stage rows that are `[x]` or `[S]`) / (all stage rows present). SKIP counts as done; there is no distinct "never in scope" state.
- Artifacts are already served through a path-confined reader and displayed as plain `<pre>` text (XSS-safe, no markdown rendering).
- The frontend is dependency-free vanilla JS; `public/app.js` hand-mirrors `src/frontend-state.ts`.

## Q1. For the progress fix, what should the denominator be?

The reported bug: a completed intent shows ~21% because out-of-flow stages are counted as pending. The state file carries an EXECUTE/SKIP scope label per stage. What should "100%" mean?

- A. Progress = completed EXECUTE stages / total EXECUTE (in-scope) stages. SKIP/out-of-scope stages are excluded from both numerator and denominator entirely.
- B. Progress = (completed + skipped) / (all stages that were ever part of the flow), where "part of the flow" = EXECUTE stages only; purely-never-in-scope rows are excluded.
- C. Not yet defined — needs a closer look at how the state file marks a stage as never-in-scope vs skipped.
- X. Other (please specify)

[Answer]: A. Progress = completed EXECUTE stages / total EXECUTE (in-scope) stages. SKIP/out-of-scope stages are excluded from both numerator and denominator entirely.

## Q2. How should out-of-scope / never-in-flow stages appear in the stage view?

Your intent-capture answer was "not shown as pending (hidden, or a distinct 'not in this flow' state)". Which do you want for the POC?

- A. Hide them entirely — the graph shows only stages that are part of this intent's flow.
- B. Show them visibly but clearly marked as "not part of this flow" (greyed/distinct state), not pending and not counted.
- C. Either is acceptable — you (the builder) pick whichever is cleaner given the data.
- X. Other (please specify)

[Answer]: B. Show them visibly but clearly marked as "not part of this flow" (greyed/distinct state), not pending and not counted.

## Q3. Graph view — are phase-to-phase and stage-to-stage connections required, or is the columnar layout enough?

You said the connected-graph structure is the priority and the exact arrangement is up to the builder. For the POC minimum:

- A. Columns are enough — each phase is a column of its stages, phases left-to-right; no drawn connector lines required (the left-to-right reading order conveys the path).
- B. Draw connectors — show lines/arrows linking stages into a visible path, not just columns.
- C. Builder's choice — prioritize "reads as a connected path, not disconnected boxes"; connectors optional if the layout already reads as a path.
- X. Other (please specify)

[Answer]: B. Draw connectors — show lines/arrows linking stages into a visible path, not just columns.

## Q4. Markdown viewer — which artifacts should be openable, and is rendered formatting required?

Artifacts are already listed and readable as plain text via the existing path-confined reader.

- A. Any `.md` artifact in the intent's tree should render as formatted HTML when opened; non-markdown files keep the current plain-text display.
- B. Same as A, and the renderer must preserve the current XSS safety (no raw HTML injection from file content).
- C. Not yet defined.
- X. Other (please specify)

[Answer]: B. Any `.md` artifact renders as formatted HTML; non-markdown keeps plain-text display; the renderer must preserve the current XSS safety (no raw HTML injection from file content).

## Q5. Any constraints to honor for this POC?

The current app is dependency-free vanilla JS on the frontend, strictly read-only, localhost-only.

- A. Keep it dependency-light and read-only; a small well-known markdown library is acceptable if needed, but no heavy frameworks and no change to the read-only/localhost posture.
- B. Zero new runtime dependencies — implement markdown rendering without adding a library.
- C. No specific constraints beyond "make it work" for the POC.
- X. Other (please specify)

[Answer]: A. Keep it dependency-light and read-only; a small well-known markdown library is acceptable if needed, but no heavy frameworks and no change to the read-only/localhost posture.

## Consolidated Summary Confirmation

Summary of answers:

- Progress fix: percentage = completed EXECUTE stages / total EXECUTE (in-scope) stages; SKIP and out-of-scope stages are excluded from both numerator and denominator, so a completed in-scope workflow reads 100%.
- Out-of-scope stages in the view: shown visibly but clearly marked "not part of this flow" (greyed/distinct), not pending and not counted.
- Graph view: draw connectors (lines/arrows) linking stages into a visible left-to-right path, phases ordered sequentially; not just columns.
- Markdown viewer: any `.md` artifact renders as formatted HTML when opened; non-markdown files keep plain-text display; the renderer preserves the current XSS safety (no raw HTML injected from file content).
- Constraints: keep it dependency-light and read-only; a small well-known markdown library is acceptable, no heavy frameworks, and no change to the read-only/localhost posture.

- Looks correct
- Request changes

[Answer]: Looks correct