# aidlc-viz: a read-only browser view of a workspace

`aidlc-viz` is a small loopback web server that shows what AI-DLC has recorded in a
project: every intent and its progress, each intent's stages laid out by phase,
the decisions in its audit trail, and the artifacts each stage wrote. It reads
the files described in [State Tracking and Audit Trail](../../docs/guide/10-state-and-audit.md)
and never writes, moves, or deletes anything.

It is a development aid that lives in this repository. It is not installed with
AI-DLC and is not part of any harness.

## Run it

You need [Bun](https://bun.sh) and a clone of this repository. From the project
you want to look at (the directory that holds `aidlc/`):

```bash
bun /path/to/aidlc-workflows/scripts/aidlc-viz/aidlc-viz.ts
```

Then open <http://127.0.0.1:4178/>. Reload the page to see the latest state; it
does not refresh on its own.

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `4178` | Port to listen on. The server binds to `127.0.0.1` only. |
| `AIDLC_WORKSPACE_ROOT` | the current directory | The project to show: the directory that holds `aidlc/`. A relative path resolves against the current directory. |

```bash
AIDLC_WORKSPACE_ROOT=~/src/my-project PORT=5000 bun scripts/aidlc-viz/aidlc-viz.ts
```

## What it shows

- **Overview.** Every intent under `aidlc/spaces/<space>/intents/`, active work
  first and finished work collapsed below it. Progress counts only the stages the
  plan executes (`EXECUTE`). `SKIP` stages, and stage lines with no label, are left
  out of both counts, so a finished plan reads 100%. An `EXECUTE` stage skipped by
  a jump (`[S]`) counts as done.
- **Stage graph.** The intent's stages from `aidlc-state.md`, one column per
  phase in lifecycle order. Each card shows its checkbox state. A stage waiting at
  an approval gate (`[?]`) is highlighted, and stages outside the plan are greyed
  and marked "Not part of this flow".
- **Decisions.** `GATE_APPROVED`, `GATE_REJECTED`, `DECISION_RECORDED`, and
  `QUESTION_ANSWERED` events from every shard under `audit/`, merged by
  timestamp. An answer is shown with the question it answers.
- **Artifacts.** Click a stage to browse the files under its directory in the
  record. Markdown renders as formatted text; other files show as plain text.

## Safety

The server holds a project's design documents, so it is built for one person on
their own machine:

- It listens on `127.0.0.1` only, and refuses any request whose `Host` is not a
  loopback name, so a web page cannot reach it through DNS rebinding.
- It answers `GET` and `HEAD` only and has no code path that writes to the
  workspace.
- An intent's space and record must each be a single plain path segment, and
  every file read stays inside that record. A path that is absolute, uses `..`,
  or reaches outside through a symlink is refused with `400`. The artifact list
  does not follow symlinks or show dot-directories such as `.aidlc-engine/`.
- Artifact Markdown is untrusted text. It is rendered by `Bun.markdown` with raw
  HTML treated as text, every text node escaped, links limited to `http`,
  `https`, `mailto`, and relative URLs, and images shown as links. The page's
  Content Security Policy allows only its own script and stylesheet.

## HTTP API

Every route is read-only and returns JSON.

| Route | Returns |
|-------|---------|
| `GET /api/intents` | Every intent with its phase, current stage, status, scope, and progress. |
| `GET /api/intents/:space/:record/graph` | The intent's phases, each with its stages and their states. |
| `GET /api/intents/:space/:record/decisions` | The intent's decision events. |
| `GET /api/intents/:space/:record/artifacts` | The record's files and directories. |
| `GET /api/intents/:space/:record/artifacts/file?path=` | One file's `content`, plus `html` for Markdown. |
| `GET /api/health` | `{ ok: true, workspaceRoot }`. |

An unknown intent is `404`, a path outside the record is `400`, and a missing
file is `404`.

## Layout and tests

| File | Role |
|------|------|
| `aidlc-viz.ts` | Entry point: reads `PORT` and `AIDLC_WORKSPACE_ROOT` and starts `Bun.serve`. |
| `server.ts` | Routes, host check, security headers, static files. |
| `workspace.ts` | Every disk read: discovery, state, audit shards, the artifact list, confined file reads. |
| `state.ts` | Parses `aidlc-state.md`: stages, progress, phase columns. |
| `audit.ts` | Picks the decision events out of the audit shards. |
| `markdown.ts` | Renders artifact Markdown to safe HTML. |
| `public/` | The browser view: `index.html`, `styles.css`, `app.js` (no build step). |

The tests are `tests/unit/t-aidlc-viz-parsers.test.ts` (the pure parsers and the
renderer) and `tests/unit/t-aidlc-viz-server.test.ts` (a real workspace in a temp
directory, every route, and path confinement):

```bash
bun test tests/unit/t-aidlc-viz-parsers.test.ts tests/unit/t-aidlc-viz-server.test.ts
```

The full suite (`bun tests/run-tests.ts`) runs them with the other unit tests.
