## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-16T16:22:47Z
**Iteration:** 1

This is a single ADVISORY pass. Findings below are decision support for the human at the approval gate, ranked by severity. The verdict informs; it does not gate. No fix-and-re-review loop follows — a Request Changes at the gate is how any finding becomes a revision.

I verified all four of the developer's flagged risk areas against the implemented source, ran the full test suite, ran the typechecker, and probed the markdown renderer with hostile inputs directly. The plan was realized faithfully and the security-critical surface holds. No Critical or Major findings. Three Minor findings follow, none blocking.

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Minor | aidlc-viz/src/frontend-state.ts `isInFlow` + aidlc-viz/public/app.js markdown/scope mirror | The code-summary's C2 claim ("`isInFlow`/`NOT_IN_FLOW_LABEL` ... mirrored in `public/app.js`") is only partly accurate: `app.js` mirrors `NOT_IN_FLOW_LABEL` and the full `renderMarkdown` block verbatim, but it does NOT port `isInFlow` — it decides in-flow inline via `s.inFlow !== false` using the server-computed `GraphStage.inFlow`. This is benign (the server owns the scope rule in aggregation.ts, so there is no second source of truth to drift), but the mirror claim overstates what was duplicated. The two independent `renderMarkdown` copies ARE a real future-drift risk the comments acknowledge but nothing enforces. | None required for correctness. Optionally note in README/code-summary that `isInFlow` is server-sourced (not mirrored) and consider a parity test or shared-source strategy for the two `renderMarkdown` copies in a later iteration. | New |
| R-02 | Minor | aidlc-viz/src/lib/markdown.ts `renderInline` link regex `\[([^\]]+)\]\(([^)\s]+)\)` | A link whose URL contains whitespace (e.g. `[x](  javascript:alert(1))` or `http://a.com" onmouseover=...`) does not match the link rule at all, so it renders as inert escaped paragraph text — safe, but it also silently drops legitimately-spaced or percent-unencoded URLs rather than rendering them. For a read-only AI-DLC artifact viewer this is acceptable (artifact links are typically well-formed), and it fails closed (toward plain text), consistent with NFR3. Flagging only so the human knows link coverage is deliberately narrow. | None required. Document the "URLs may not contain spaces" limitation if link fidelity matters later. | New |
| R-03 | Minor | aidlc-viz/src/lib/markdown.ts `safeHref` + aidlc-viz/public/app.js mirror | Protocol-relative URLs (`//evil.com`) and relative/anchor URLs pass `safeHref` (no scheme detected → allowed). In the strictly localhost, read-only, offline-posture viewer (NFR1) this is low risk — there is no credential or session to leak and the page is not served to third parties — but a protocol-relative link in a hostile artifact would resolve against the viewer's `http://127.0.0.1` origin. Not a defect against FR4.3 (no script execution; `rel="noopener noreferrer nofollow"` is applied), noted for completeness. | None required. If future hardening is wanted, treat `//` as an absolute-scheme candidate and require explicit http(s). | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| `npx vitest run` (full suite) | PASS: 68 passed / 7 files | Confirms NFR4 (existing suite green) and the code-summary's claimed 68-pass count exactly. markdown.test.ts (15) and state-parser.test.ts (21) cover the two highest-risk modules. |
| `npm run typecheck` (`tsc --noEmit`) | PASS: clean | No type errors across the changed modules; `GraphStage.inFlow`, `Progress`, and `StageScope` additions type-check. |
| Direct XSS probes (tsx, renderMarkdown) | PASS: no leak | `<script>`, `<img onerror=>`, `javascript:`/`data:`/`vbscript:` links, entity-decode-then-reescape href path, and attribute-breakout attempts (`http://a.com/"onmouseover=...`) all render as escaped inert text or drop the href. The escape-first design + `escapeHtml(href)` on the attribute genuinely neutralizes hostile content (FR4.3). |

### Verification Of Flagged Risk Areas

**XSS surface (FR4.3) — sound.** Source is HTML-escaped before any tag is emitted; only renderer-emitted tags are live markup. The link path decodes the entities it introduced, scheme-checks, then re-escapes the href with `escapeHtml` before inserting it into the `href="..."` attribute, so an embedded `"` becomes `&quot;` and cannot break out. `safeHref` strips control/whitespace chars before the scheme test (`java\tscript:` is caught) and allowlists only http/https/mailto when a scheme is present. Fenced code, headings, and bold all route through `escapeHtml` first. The `app.js` mirror is logically byte-identical to `markdown.ts`.

**In-scope progress (FR1) — correct.** `computeProgress` filters to `scope === "EXECUTE"` for BOTH numerator and denominator; `isDone` counts `completed`+`skipped`; empty in-scope set yields `fraction: 0` with no divide-by-zero. The `scope: "unknown"` = out-of-scope decision is sound and well-reasoned: the state template always emits the `— EXECUTE`/`— SKIP` label, so an unlabelled row is malformed/partial, and excluding it (rather than counting it) prevents a partial write from inflating or deflating the percentage. The rule is single-sourced into `inFlow` via `isInScope`, so progress and graph display agree. Tests cover FR1.1–FR1.3 including the SKIP+unknown exclusion case reaching 100%.

**Connected graph + out-of-flow display (FR2/FR3) — realized as planned.** `renderGraph` builds `.phase-flow` → `.phase-col` columns in canonical phase order (`PHASE_ORDER`), stacks stages vertically, draws `.phase-connector` arrows between columns and `.stage-stack .stage::after` vertical lines between stages (FR3.1/FR3.2); each stage keeps state marker, scope label, and click-through (FR3.3). Out-of-flow stages (`inFlow === false`) get `.stage--not-in-flow` (dashed/greyed) and the `NOT_IN_FLOW_LABEL`, explicitly never the pending style (FR2.1/FR2.2).

**Posture (NFR1/NFR2/NFR4) — preserved.** Server still binds `127.0.0.1` only (NFR1); no new write paths added. `package.json` adds zero dependencies — the markdown renderer is hand-rolled; `express@4.19.2` is pre-existing, so the "zero new dependencies" claim is accurate (NFR2). Full suite green at 68 tests (NFR4).

### Summary

The implementation faithfully realizes the approved plan across FR1–FR4 and NFR1–NFR4. The security-critical markdown renderer is genuinely XSS-safe (verified by direct hostile-input probing, not just by the shipped tests), the in-scope progress math and the `unknown`=out-of-scope decision are correct and well-justified, and the graph/out-of-flow display matches the plan. The three Minor findings are documentation-accuracy and defense-in-depth notes, none blocking. READY as decision support for the gate.
