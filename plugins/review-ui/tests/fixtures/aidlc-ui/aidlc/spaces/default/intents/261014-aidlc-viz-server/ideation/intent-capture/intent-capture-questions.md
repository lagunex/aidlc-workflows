# Intent Capture & Framing — Questions

## Sources

- [desc] Initial description: "create a localhost webserver that offers a visualization for aidlc"
- [scope] Workflow-selected scope: `poc`.

## Q1. What is the core problem this visualization solves?

What do you want to be able to *see* that you can't easily see today? For a proof-of-concept, naming the single most valuable view keeps the build focused.

- A. See the AI-DLC workflow progress for a piece of work — which of the stages are done, in progress, or pending, and the approval gates
- B. See the stage graph / phase structure of AI-DLC itself (the 7 phases and their stages) as a reference diagram
- C. See the decision/audit trail — the history of what was decided at each gate
- D. See live state across multiple intents/workflows at once (a dashboard)
- E. Not yet defined — help me decide
- X. Other (please specify)

[Answer]: E. Not yet defined — all four views (A workflow progress, B stage graph, C audit trail, D multi-workflow dashboard) are valuable use cases, because the terminal CLI makes them hard to accomplish given the graph nature of AI-DLC and its inherent visual benefit.

## Q2. Who is the intended user of this visualization, and what do they do with it?

- A. Me, a developer running AI-DLC, wanting a browser view of my current workflow instead of the terminal
- B. A team lead / stakeholder reviewing progress without using the CLI
- C. A demo audience — showing people what AI-DLC is and how it flows
- D. Not identified yet
- X. Other (please specify)

[Answer]: B. A team lead / stakeholder reviewing progress without using the CLI

## Q3. Where does the data for the visualization come from?

The AI-DLC workspace stores state and audit data on disk under `aidlc/spaces/<space>/intents/<record>/` (e.g. `aidlc-state.md`, audit shards, the compiled stage graph). Should the poc read from these existing files?

- A. Yes — read the real AI-DLC workspace files on disk and visualize actual state
- B. No — use static/sample data for the poc; wiring to real files comes later
- C. Not sure — recommend what's simplest for a poc
- X. Other (please specify)

[Answer]: A. Yes — read the real AI-DLC workspace files on disk and visualize actual state

## Q4. What does success look like for this proof-of-concept?

What would make you consider this poc a success? (A measurable or concrete signal — e.g. "I can open localhost and see my current workflow's stages render correctly.")

- A. I can start the server locally and open a browser page that renders an AI-DLC workflow visualization
- B. The above, plus it reflects my real workflow state from disk
- C. The above, plus it auto-refreshes as the workflow advances
- D. Not yet defined
- X. Other (please specify)

[Answer]: C. The above (start the server, render the visualization, reflect real workflow state from disk). For the poc, refresh is manual: the user presses F5, which triggers a fresh read of the workspace files and therefore an updated view. Automatic refresh is out of scope for the poc.

## Q5. Does the workflow-selected scope (`poc`) match your intended product boundary?

This workflow was started as a `poc` (proof-of-concept): a minimal, throwaway-friendly build to prove the idea works, not a production-hardened tool. Does that match what you want here?

- A. Yes — confirm `poc`; keep it minimal, a single local prototype
- B. No — I actually want a fuller product boundary (please describe the broader intent)
- C. Not sure — explain the trade-off
- X. Other (please specify)

[Answer]: A. Yes — confirm `poc`; keep it minimal, a single local prototype

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct

## Assumption Confirmation

The intent statement and stakeholder map carry these remaining assumptions (each labelled `[assumption]`), after folding in Q6 and Q7:

1. The AI-DLC workspace on-disk file formats (`aidlc-state.md`, audit shards, compiled stage graph) are stable enough to read for the poc.
2. "Auto-refresh" is a lightweight mechanism (e.g. polling) appropriate to a poc; the exact mechanism is decided in later design.
3. No reporting cadence beyond the on-demand browser view.
4. No additional stakeholders identified for this poc.

- A. Accept assumptions
- B. Convert to follow-up questions

[Answer]: A. Accept assumptions

## Q6. How should the visualization handle one vs. many intents?

Follow-up to assumption #3 (single active workflow vs. several at once).

[Answer]: The detail view follows one intent at a time. There is also an overview/landing section that lists teams (spaces) and intents, each with a progress bar, giving a high-level view of everything open; from the overview the user can zoom into a single intent to track its particular progress and switch between teams/intents. [Q6]

## Q7. What happens when the user drills into a specific stage of an intent?

Follow-up refining the detail view.

[Answer]: Clicking a particular stage for a particular intent opens a file-browser view of the artifacts for that stage. For the poc the user can open and read those files; editing is explicitly out of scope (the poc is read-only). [Q7]

## Q8. Where do the four committed views live in the navigation?

Follow-up resolving the scope-vs-navigation gap (R-04): giving the stage-graph/phase-structure view and the decision/audit-trail view a navigation home.

[Answer]: The navigation is a progressive drill-down, each level diving deeper from the previous: (1) Overview — a list of intents, each with a progress bar. (2) Clicking an intent opens the intent graph view — the full stage graph showing all stages available per phase with their state: completed, in progress, pending, and skipped. (3) Clicking a single stage in the graph opens that stage's artifacts (read-only file browser). (4) A Decisions tab is available at any point in the intent graph view, showing all decisions made on this intent. This gives all four committed views a home: workflow progress (overview progress bars + graph states), stage-graph/phase structure (the graph view), decision/audit trail (the Decisions tab), and multiple workflows at once (the overview). [Q8]
