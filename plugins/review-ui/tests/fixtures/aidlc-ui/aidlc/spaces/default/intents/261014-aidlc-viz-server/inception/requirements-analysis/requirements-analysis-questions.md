# Requirements Analysis — Questions

## Q1. Technology stack for the local server?

The intent is a localhost webserver that reads AI-DLC workspace files and renders a browser visualization. What should it be built with? (A poc favors whatever gets a working local server + a graph UI fastest.)

- A. Python (e.g. FastAPI/Flask backend) + a lightweight HTML/JS frontend
- B. Node.js/TypeScript (e.g. Express) + a JS frontend
- C. A single-stack JS/TS app (e.g. Vite + a small server, or Next.js)
- D. No preference — recommend the simplest stack for a read-only file-reading poc
- X. Other (please specify)

[Answer]: B. Node.js/TypeScript (e.g. Express) + a JS frontend — chosen so the stack matches the AI-DLC framework's own TypeScript tooling.

## Q2. How should the stage graph (phases → stages, dependencies, order) be sourced?

The visualization shows all stages available per phase with their state. AI-DLC compiles a stage graph to `.kiro/tools/data/stage-graph.json`, and each intent's `aidlc-state.md` tracks per-stage checkbox state ([ ] / [-] / [x] / [S]).

- A. Read the compiled `stage-graph.json` for the full phase/stage structure, and each intent's `aidlc-state.md` for that intent's per-stage state
- B. Read only each intent's `aidlc-state.md` (the stages it lists) — simpler, but may not show stages not yet reached
- C. Not sure — recommend what gives the fullest graph for the poc
- X. Other (please specify)

[Answer]: A. Read the compiled `stage-graph.json` for the full phase/stage structure, and each intent's `aidlc-state.md` for that intent's per-stage state.

## Q3. What drives the per-intent progress bar and the "decisions" list?

- A. Progress = fraction of in-scope stages completed (from `aidlc-state.md` checkboxes); Decisions = entries read from the intent's audit shards under `<record>/audit/`
- B. Progress and decisions both derived only from `aidlc-state.md`
- C. Not sure — recommend the simplest sources that are already on disk
- X. Other (please specify)

[Answer]: A. Progress = fraction of in-scope stages completed (from `aidlc-state.md` checkboxes); Decisions = entries read from the intent's audit shards under `<record>/audit/`.

## Q4. How are intents and teams (spaces) discovered for the overview?

The overview lists intents across teams/spaces. AI-DLC stores these under `aidlc/spaces/<space>/intents/<record>/`.

- A. Scan the `aidlc/spaces/` directory tree on disk to discover spaces and their intents automatically
- B. Point the server at a single configured space/intents directory
- C. Not sure — recommend the simplest discovery for a poc
- X. Other (please specify)

[Answer]: A. Scan the `aidlc/spaces/` directory tree on disk to discover spaces and their intents automatically.

## Consolidated Summary Confirmation

- Tech stack: Node.js/TypeScript server (Express) + a JS frontend, chosen to match the AI-DLC framework's TypeScript tooling.
- Stage graph source: read compiled `.kiro/tools/data/stage-graph.json` for the full phase/stage structure; read each intent's `aidlc-state.md` for its per-stage state.
- Progress bar: fraction of in-scope stages completed, from `aidlc-state.md` checkboxes.
- Decisions list: read from the intent's audit shards under `<record>/audit/`.
- Discovery: scan the `aidlc/spaces/` directory tree to find spaces (teams) and their intents automatically.
- Read-only: the poc only reads these files; manual F5 refresh re-reads them.

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
