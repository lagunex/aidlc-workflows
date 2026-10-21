# Intent Statement — AI-DLC Visualization Server

## Problem Statement

AI-DLC is a graph-shaped methodology: phases contain stages, stages connect through dependencies, and approval gates punctuate the flow. The terminal CLI presents this inherently visual, graph-structured process as linear text, which makes several things hard to grasp at a glance [desc][Q1]. The visualization makes the graph legible, and the following views — all of which the CLI makes hard given AI-DLC's graph nature — are intentionally part of the committed poc scope [Q1][Q6][Q7]:

- **Workflow progress** for a piece of work: which stages are done, in progress, or pending, and the approval gates.
- **Stage-graph / phase structure** of AI-DLC as a reference.
- **Decision / audit trail**: the history of what was decided at each gate.
- **Multiple workflows at once**: a high-level view of everything open.

These views are organised into a progressive drill-down, each level diving deeper from the previous [Q6][Q7][Q8]:

- **Overview** — a list of intents (across teams/spaces), each with a per-intent progress bar; the high-level view of everything open and the surface for seeing multiple workflows at once.
- **Intent graph view** — clicking an intent opens the full stage graph: all stages available per phase, each showing its state (completed, in progress, pending, or skipped). This is the stage-graph / phase-structure view and the per-intent progress view.
- **Stage artifacts** — clicking a single stage in the graph opens a read-only file-browser of that stage's artifacts; files can be opened and read (no editing in the poc).
- **Decisions tab** — available at any point within the intent graph view, showing all decisions made on this intent. This is the decision / audit-trail view.

## Target Customer

The intended user is a team lead or stakeholder who wants to review AI-DLC progress without using the CLI [Q2]. They benefit by seeing workflow state and structure in a browser rather than reading terminal output [Q2].

## Success Metrics

For this proof-of-concept, success means: the server can be started locally, a browser page renders an AI-DLC workflow visualization, and the visualization reflects real workflow state read from disk [Q4]. Refresh is manual — the user presses F5, which triggers a fresh read of the workspace files and therefore an updated view; automatic refresh is out of scope for the poc [Q4]. The data for the visualization is read from the real AI-DLC workspace files on disk (for example `aidlc-state.md`, the audit shards, and the compiled stage graph) [Q3].

## Initiative Trigger

The trigger is the gap between AI-DLC's graph nature and the linear terminal presentation of the CLI: the visual benefit of the graph is not accessible through the CLI, which motivates a browser-based visualization [desc][Q1].

## Initial Scope Signal

- **Workflow-selected scope (workflow-selected):** `poc` [scope].
- **User-confirmed product boundary:** The user confirmed the `poc` boundary — a minimal, single, local prototype rather than a production-hardened tool [Q5]. Within that boundary the prototype is a progressive drill-down [Q6][Q7][Q8]: an overview listing intents with progress bars; an intent graph view (click an intent) showing all stages per phase with completed/in-progress/pending/skipped state; a stage artifacts view (click a stage) that opens a read-only file-browser of that stage's artifacts; and a Decisions tab available within the intent graph view showing all decisions made on the intent. Editing is out of scope — the poc is read-only [Q7].

## Assumptions & Open Questions

- The AI-DLC workspace on-disk file formats (`aidlc-state.md`, audit shards, compiled stage graph) are stable enough to read for the poc. [assumption]
- Refresh is manual for the poc: the user presses F5 to trigger a fresh read of the workspace files; no automatic refresh. [Q4]
- The poc is read-only: it reads AI-DLC workspace files but never writes to them. [Q7]
