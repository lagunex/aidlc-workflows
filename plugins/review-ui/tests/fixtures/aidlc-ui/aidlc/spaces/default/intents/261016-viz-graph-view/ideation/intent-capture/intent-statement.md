# Intent Statement — aidlc visualizer: graph view, markdown viewer & progress fix

## Problem Statement

The aidlc visualizer does not faithfully represent a workflow's real state, and
offers no way to read the artifacts a workflow produces. Three concrete gaps
drive this initiative [Q1]:

- There is no markdown viewer, so the documents a workflow produces cannot be
  read from the UI [desc][Q3].
- The stage view renders disconnected boxes rather than a readable path through
  the workflow's phases and stages [desc][Q4].
- Progress and stage status are misleading for a completed workflow: stages that
  were never part of the flow are shown as pending and counted against progress,
  so a 100%-complete intent reads as partially done [desc][Q5].

## Target Customer

The people who read the visualizer and what they gain [Q2]:

- The developer running AI-DLC workflows, monitoring and reviewing their own
  in-progress and completed intents locally [Q2].
- A team reviewing shared workflow records, where viewers may not be the author
  of the record [Q2].

Both benefit from a view that reads as a path rather than scattered boxes, a way
to open and read each artifact, and progress numbers that match reality [Q1][Q2].

## Success Metrics

Measurable outcomes for this POC [Q1][Q6]:

- A completed workflow whose in-scope stages are all done displays 100% progress,
  not a fraction [Q5].
- Stages that were never part of a workflow's flow are not shown as pending and
  are not counted in the progress total [Q5].
- A user can open any stage's markdown artifact and read it rendered as formatted
  HTML in the UI [Q3].
- The stage view shows a connected path through the workflow rather than
  disconnected boxes [Q4].

## Initiative Trigger

The trigger is observed misrepresentation in the current tool: intent
`261014-aidlc-viz-server` is complete, yet the progress bar shows roughly 21%
because only 7 stages are marked done while the remaining stages — never part of
that flow — appear pending. The same intent's stage view shows many boxes as
pending that are not and never will be part of the flow [desc][Q1][Q5].

## Initial Scope Signal

- **Workflow-selected scope:** `poc` (Minimal depth) [scope].
- **User-confirmed product boundary:** keep this a proof of concept — the
  smallest changes to the existing `aidlc-viz` application that make the markdown
  viewer, the connected stage/graph view, and the in-scope-only progress fix
  work [Q6].

## Assumptions & Open Questions

- The exact visual arrangement of the connected graph is left to implementation;
  the phase-as-vertical-line, left-to-right phase ordering described in the
  request is a starting point rather than a fixed specification [assumption][Q4].
- How the visualizer's data distinguishes in-scope stages from stages that were
  never part of a flow is not yet established. The answer is unknown now and will
  be determined by investigation in a later stage — reading the relevant
  `aidlc-viz` data files and/or the AI-DLC source to understand how a workflow's
  actual in-scope stage set is derived [assumption][Q5].
