# review-ui: your AI-DLC work in the browser, read-only

> An AI-DLC plugin. It shows a project's intents, stages, documents and
> decisions in a browser on your own machine. It reads the files AI-DLC writes
> and never changes them.

## What it is

The Review UI shows what AI-DLC has recorded in a project: the intents in a
space, each intent's stages by phase, the documents each stage wrote, the
questions and your answers, and the decisions in the audit trail. It listens
on `127.0.0.1` only, updates the page as the files change, and writes nothing.
You still approve, answer and ask for changes where you run AI-DLC; the browser
is for reading and finding your way.

It stands on its own. It imports nothing from AI-DLC's engine and reads only
files whose format AI-DLC documents ([What it reads](#what-it-reads)), so a
change to the engine's own files cannot break it. When a documented format
changes, tests in this repository catch it before a release.

### Design credit

The look and the way the screens are organised follow the Review UI design on
the [`feature/review-ui-html-artifacts`](https://github.com/awslabs/aidlc-workflows/tree/feature/review-ui-html-artifacts)
branch, discussed in [issue #2803](https://github.com/awslabs/aidlc-workflows/issues/2803).
This plugin is a separate, read-only build of that design for the plugin
mechanism; none of that branch's code is copied. The icons are a subset of
Microsoft's Fluent UI System Icons, MIT licensed; the licence is
`tools/review-ui/public/FLUENT-ICONS-LICENSE.txt`.

## Before you start

You need [Bun](https://bun.sh) 1.3.8 or newer; `bun --version` tells you which
you have. A native AI-DLC install does not put Bun on your PATH, so install it
from the Bun site if you don't have it. With an older Bun the Review UI stops
with `Review UI needs Bun 1.3.8 or newer: https://bun.sh`.

## Run it

### From a clone of this repository

Nothing but Bun needs installing. From a clone of
[aidlc-workflows](https://github.com/awslabs/aidlc-workflows), point it at your
project (the folder that holds `aidlc/`):

```bash
git clone https://github.com/awslabs/aidlc-workflows.git
cd aidlc-workflows
bun plugins/review-ui/tools/review-ui.ts serve --project-dir ~/src/my-project
```

Without `--project-dir` it uses the nearest folder, from where you are upward,
that holds `aidlc/spaces/`. So from inside your project,
`bun <clone>/plugins/review-ui/tools/review-ui.ts serve` is enough. When no
folder above holds one, it stops with
`No AI-DLC workspace found above <folder>; pass --project-dir <path>`.

It says the folder it reads, in full, and where to open it:

```text
Reading /path/to/my-project
Review UI (read-only) for my-project: http://127.0.0.1:4790/ (Ctrl+C stops it)
```

Open that address in your browser. Ctrl+C stops the server; an open page then
shows
`Review UI stopped. Start it again with bun <harness-dir>/tools/review-ui.ts serve; this page reconnects.`
and picks up again by itself once the server is back.

`--help` lists the options. An unknown command or option stops it with a line
naming it, such as `Unknown option: --port.`, followed by the same list.

### From your project, once added to your install

Once the plugin is part of your AI-DLC install
([Add it to your install](#add-it-to-your-install)), its files sit in your
harness folder, and from the project you run:

```bash
bun <harness-dir>/tools/review-ui.ts serve
```

`<harness-dir>` is `.claude` (Claude Code), `.codex` (Codex CLI), `.cursor`
(Cursor), `.kiro` (Kiro CLI and Kiro IDE) or `.aidlc` (GitHub Copilot and
opencode).

### Choose the port

It takes the first free port from 4790 to 4799, or any free port when all ten
are taken. `REVIEW_UI_PORT` picks one; `REVIEW_UI_PORT=0` asks for any free
port. These examples run from your clone, as above; from inside your project,
`bun <clone>/plugins/review-ui/tools/review-ui.ts serve` or
`bun <harness-dir>/tools/review-ui.ts serve` reads the same setting. In bash or
zsh:

```bash
REVIEW_UI_PORT=5000 bun plugins/review-ui/tools/review-ui.ts serve --project-dir ~/src/my-project
```

In PowerShell (the setting stays for that window):

```powershell
$env:REVIEW_UI_PORT = "5000"
bun plugins/review-ui/tools/review-ui.ts serve --project-dir $HOME\src\my-project
```

In CMD (the setting stays for that window):

```bat
set REVIEW_UI_PORT=5000
bun plugins/review-ui/tools/review-ui.ts serve --project-dir %USERPROFILE%\src\my-project
```

A setting it cannot use stops it with a line that says how to get a free port:

- `REVIEW_UI_PORT must be a port number from 0 to 65535; use REVIEW_UI_PORT=0 for any free port`
- `Port 5000 is already in use; set REVIEW_UI_PORT=0 to pick a free one`
- `Port 5000 cannot be opened here; set REVIEW_UI_PORT=0 to pick a free one`

The `AIDLC_REVIEW_*` settings of the Review UI branch do not apply to this
plugin.

### On a remote machine

Run it on the remote machine (a development server or a VM), then forward its
port from your own machine and open the same address there:

```bash
ssh -N -L 127.0.0.1:<port>:127.0.0.1:<port> <host>
```

`<port>` is the port the remote server printed. The server still listens only
on the remote machine's loopback; the tunnel carries your browser's requests to
it. Times on the page are in your browser's time zone, not the remote
machine's.

## Add it to your install

This step is optional: the clone is enough to run it. Adding the plugin to your
AI-DLC install copies its files into your harness folder, so anyone working in
the project can run `bun <harness-dir>/tools/review-ui.ts serve` without a
clone. It adds no stages, scopes or agents and changes nothing in your
workflow.

First build the plugin for every tool, with the one `aidlc-plugins` catalogue
that lists AI-DLC's own plugins. From your clone:

```bash
bun scripts/package.ts
```

That writes `dist/plugins/`. A native install of an AI-DLC release that
includes this plugin keeps the same catalogue at the path its installer
printed (`aidlc doctor --verbose` names it under Machine); you can use that
path in place of `<clone>/dist/plugins`.

| Tool | Steps |
|---|---|
| Claude Code | `/plugin marketplace add <clone>/dist/plugins`, then `/plugin install aidlc-review-ui@aidlc-plugins`. The next session adds it. |
| Codex CLI | `codex plugin marketplace add <clone>/dist/plugins`, then `codex plugin add aidlc-review-ui@aidlc-plugins`, and approve its hook once. The next session adds it. |
| Cursor, GitHub Copilot | Install `aidlc-review-ui` from the `aidlc-plugins` catalogue in `<clone>/dist/plugins`, the way your tool installs plugins. The next session adds it. |
| Kiro IDE | Copy `<clone>/dist/plugins/review-ui/kiro-ide/.kiro` into your project. The next session adds it. |
| Kiro CLI | Copy `<clone>/dist/plugins/review-ui/kiro/.kiro` into your project, then from the project run `aidlc engine plugin sync --harness-dir .kiro --plugin-root .kiro/aidlc-plugins/aidlc-review-ui`. |
| opencode | From the project, run `aidlc engine plugin sync --harness-dir .aidlc --plugin-root <clone>/dist/plugins/review-ui/opencode`. |

On Kiro CLI and opencode without the `aidlc` command, run the plugin's own
composer instead, with the same plugin folder and harness folder:

```bash
AIDLC_PLUGIN_ROOT=<plugin folder> AIDLC_PROJECT_DIR=<project> AIDLC_HARNESS_DIR=<harness-dir> \
  bun <plugin folder>/hooks/compose.ts
```

To update it, repeat the same steps with a newer clone or release. To take it
out, remove the plugin the way your tool removes plugins; the files it copied
stay until you delete `<harness-dir>/tools/review-ui.ts` and the
`<harness-dir>/tools/review-ui/` folder.

See [The Plugin Mechanism](../../docs/reference/18-plugin-mechanism.md) for how
AI-DLC plugins are built and added to an install.

## What each screen shows

The layout has a rail of icons on the left, the workflow panel beside it, the
document in the middle, and one panel on the right.

### Rail

- **Inbox**, with a badge counting what needs you: the intents in the space,
  the ones waiting for you first.
- **Workflow** shows or hides the workflow panel (`⌘\` on macOS, `Ctrl+\`
  elsewhere). Below 900 pixels wide the panel starts hidden.
- **Search** (⌘K on macOS, Ctrl+K elsewhere) finds an intent, a stage, a file
  or an action by name.

### Workflow panel

- The intent picker groups the space's intents under **Needs you**,
  **In progress** and **Done**, with archived ones folded under
  **Archived · N**. A space switcher changes what you see; it never changes
  your active space.
- Under the intent: its scope, depth, phase and how many stages are done.
- **Stages**, with **Collapse all** and **Expand all**, then each phase and its
  stages. Each stage says where it stands, in one word with its detail:

  | In `aidlc-state.md` | The stage says |
  |---|---|
  | `[x]` | done |
  | `[-]` | questions, while an answer in its questions files is still open; otherwise current |
  | `[?]` | in review · r2 (the version you are reviewing) |
  | `[R]` | revising |
  | the Next Stage | next |
  | another `[ ]` row marked `EXECUTE` | later |
  | `[S]` | skipped · the reason AI-DLC recorded |
  | a `[ ]` row marked `SKIP` | folded per phase, as "3 more · not in this plan", or "7 stages · not in this plan" for a whole phase with the reason AI-DLC recorded for skipping it |
  | `[-]`, `[?]` or `[R]` in an intent that is completed or archived | stopped in progress, stopped at review · r1, or stopped while revising · r1 |

  A finished or archived intent has no current stage. Opening a stage shows its
  **Questions** and the documents it wrote, one group per unit in Construction;
  in team mode each unit also shows its own cell of the Unit Progress table. A
  stage that wrote nothing says so: "Not started yet; nothing produced.", or
  its skip reason followed by "— nothing produced."
- **All files** at the foot opens every file of the intent, and the space's
  code knowledge base (`codekb/`) under its own heading.

An intent **needs you** when its current stage waits for your review (`[?]`),
or runs (`[-]`) with an answer you have not given: an open question, or an
open confirmation, plan approval or request for changes in its questions files.
In team mode a unit waiting for your review counts too: its cell in the Unit
Progress table reads `[?]`, or its Gate does once its last stage is done. A
stage being revised (`[R]`) is in progress: the agent is the one working.
Nothing in a completed or archived intent needs you.

### Header

- Where you are, as `space › intent › Phase › Stage`, and a picker for the
  stage's files.
- One line for where the stage stands. The blue accent is kept for when you
  are needed:

  | When | The line says |
  |---|---|
  | The Inbox, something waiting | 2 items need you |
  | The Inbox, nothing waiting | Nothing waiting |
  | Questions, some open | 3 questions for you |
  | Questions, some open, in a completed or archived intent | 3 questions left open |
  | Questions, all answered | Answered |
  | A questions file with nothing to answer | No questions in this file |
  | A stage in review | Awaiting your review · r1 |
  | A finished stage | Done · 11:15, the time in your browser's time zone |
  | A finished stage, once the intent is completed | Workflow complete |
  | A finished stage, once the intent is archived | Archived |
  | A stage still open when its intent was completed or archived | Stopped at review · r1, Stopped while revising · r1, or Stopped in progress |
  | A skipped stage | Skipped |
  | A stage not started | Next, or Later |
  | The current stage, working | In progress |
  | A stage being revised | Revising · r2 |
  | No stage to show | Workflow unavailable |

  In team mode a unit's own pages take the line from its cell in the Unit
  Progress table, such as "Awaiting your review · r1" for a unit whose review
  waits on you. When a unit waits for your review while another stage is
  current, the intent's line says so as the Inbox does.

- A dot that shows the live connection to the server.
- **Outline** (on documents) and **Decisions** (on documents and questions)
  open the right-hand panel.
- Links that take you somewhere, such as "Back to Code Generation →",
  "Read 3 questions →" or "Open requirements.md".

### Documents

A stage's Markdown files, read-only, with headings you can jump to from the
Outline. A banner says where the stage stands:

- Done stage · Requirements Analysis finished today at 11:15 · read-only
- In progress · Requirements Analysis is still running — this page updates as
  files change
- Awaiting your approval · Requirements Analysis r1 — approve or ask for changes
  where you run AI-DLC
- Revising · the agent is working on your feedback for Requirements Analysis
- Archived · Requirements Analysis stopped here when this intent was archived ·
  read-only
- Stopped · Requirements Analysis was still open when this intent completed ·
  read-only

An older stage finished "yesterday at 11:15" or "on 19 Oct at 11:15". In team
mode a unit's documents name it, as in "Code Generation for auth", and the
banner follows the unit's own cell. Other text files show as plain text.

### Questions

A stage's questions file, laid out as a set of answered questions: each
question with its options, your choice highlighted. A question still open says
"Open · answer in `<file>` or where you run AI-DLC"; once the intent is
completed or archived it says "Open · left unanswered when this intent
completed", or "when this intent was archived". Confirmation and approval
sections show on their own lines, such as "summary confirmed", "plan approved"
or "waiting for your approval of the plan", and the line under the title names
any that still waits on you: "All 4 questions in this round are answered;
waiting for you to confirm the summary — answer it in `<file>` or where you run
AI-DLC." Only what the file shows counts: text inside code blocks, HTML or
comments does not.

### Stage overview

Selecting a stage's name opens its overview: a short line on where it stands,
then four cards:

- **Asks first**: its questions file and how many are answered.
- **Will produce**: the files it has written, with when each was written.
- **Builds on**: the previous stage's files, with when they were approved.
- **Then**: the stages after it.

Below them, the stage's diary (`memory.md`), folded. For a stage left open
when its intent was archived, the line says so and how to pick it up again:
"Code Generation stopped here when this intent was archived; unarchive the
intent where you run AI-DLC to pick it up again."

### Decisions

The right-hand panel lists the intent's decisions, newest first, grouped by day
("Today · 21 Oct"), for **This stage** or **All**:

- asked: a decision put to you, or a review gate that opened;
- answered: an answer, a confirmed summary, an approved plan, a recorded
  verification command or Construction setting, and your own replies;
- decided: an approval, or a request for changes with your words;
- also: a stage sent back for changes, a skipped stage with its reason, a
  skipped plan approval, and each review's verdict.

An answer is shown with the question it answers. When two clones recorded
events at the same moment, the entries say "order not known".

### Live updates

The page follows the files: when AI-DLC writes, the page refreshes on its own.
When the current stage moves on, the page opens the new current stage once,
and the tab title shows "(1)" while the intent needs you. On load, and when you
pick another intent, it opens where the work stands: the stage that waits on
you (the current one, or in team mode one where a unit waits for your review),
else the current stage; there, a questions file with an open answer, else the
first document, else the stage's overview. A finished intent opens on its last
finished stage.

## What it reads

Only files whose format AI-DLC documents, all under `aidlc/`:

| File | Described in | What it is read for |
|---|---|---|
| `aidlc/spaces/<space>/intents/<record>/aidlc-state.md` | [State template](../../core/knowledge/aidlc-shared/state-template.md), [State and Audit](../../docs/guide/10-state-and-audit.md) | The stage rows (the markers `[ ]`, `[-]`, `[?]`, `[R]`, `[x]`, `[S]` and `EXECUTE` or `SKIP`), Project, Scope, Depth, Lifecycle Phase, Current Stage, Next Stage, Status, Last Updated, Total Stages, Completed, Phase Progress, and the Unit Progress table in team mode |
| `<record>/audit/*.md` | [Audit format](../../core/knowledge/aidlc-shared/audit-format.md), [Rules and the Learning Loop](../../docs/guide/09-rules-and-the-learning-loop.md), [State and Audit](../../docs/guide/10-state-and-audit.md) | The decisions, when each stage (and unit) was decided, skip reasons, and each stage's revision; a phase's skip reason counts only until the plan changes (`SCOPE_CHANGED` or `RECOMPOSED`) |
| `aidlc/spaces/<space>/intents/intents.json` | [Spaces and Intents](../../docs/guide/03-spaces-and-intents.md) | Each intent's name (its `slug`, else the folder name without the date in front) and whether it is archived |
| `aidlc/active-space` and `aidlc/spaces/<space>/intents/active-intent` | [Spaces and Intents](../../docs/guide/03-spaces-and-intents.md), [Artifacts Reference](../../docs/guide/14-artifacts-reference.md) | Which space and intent to show first: the ones last selected in this checkout. They are never written. |
| `<record>/<phase>/<stage>/` and `<record>/<phase>/<unit>/<stage>/` | [Artifacts Reference](../../docs/guide/14-artifacts-reference.md), the reviewers' [review template](../../core/knowledge/aidlc-architecture-reviewer-agent/reviewing.md) | The documents, `<stage>-questions.md`, the `memory.md` diary, and `reviews/review-NN.md` with its `**Verdict:**` and `**Date:**` lines |
| `aidlc/spaces/<space>/codekb/<repo>/` | [Spaces and Intents](../../docs/guide/03-spaces-and-intents.md), [Artifacts Reference](../../docs/guide/14-artifacts-reference.md) | Reverse Engineering's documents |

How it reads them:

- A field is the first line that starts with its label; Windows line endings
  read the same as any other.
- Times are put in date order. Events with the same time keep the order of the
  audit files, then their order inside each file.
- A file it cannot read is left out with a note that says so, and a value it
  does not recognise reads as unknown; neither stops the server.
- The state file's `Status` says whether an intent is running or completed. An
  intent is archived when its state file or the registry says so. The registry
  is used for the rest only when the state file is missing or unreadable, and a
  registry with merge-conflict markers is set aside for the folders on disk.
- A stage's revision starts at r1 and goes up by one each time the stage is
  sent back for changes after it last started. The intent's own
  `Revision Count` is never shown as a stage's revision.
- A question is a `## Q<n>` section, or a `###` or `####` one; a role label
  such as `[Developer]` and a leading emoji are optional. An `[Answer]:` that
  is empty or only underscores is open. A Summary Confirmation, Assumption
  Confirmation, Plan Approval or Requested Changes Feedback section with an
  `[Answer]:` is shown on its own line, and an open one waits on you as an
  open question does. `[Approval Fingerprint]:`, `[Planned Source]:` and
  `[Note]:` lines are not answers.
- A per-unit folder is `<phase>/<unit>/<stage>/`, where the unit folder is not
  itself a stage of that phase.

## HTTP API

These routes are the plugin's contract between its server and its page. They
are read-only: `GET` and `HEAD` only. JSON fields are snake_case, and the
shapes are typed in `tools/review-ui/types.ts`; change that file and this
section together.

`space` must name a space the server found and `intent` a record in that
space. `path` is a project-relative path starting with `aidlc/spaces/<space>/`:
a file of that intent's record, or, with `root=codekb` or a path under it, of
the space's `codekb/`.

| Route | Answer |
|---|---|
| `GET /`, `GET /index.html` | The page |
| `GET /assets/<file>` | A `.js`, `.css` or `.txt` file of `tools/review-ui/public/` |
| `GET /api/health` | `{ok, version}`: `version` is the plugin's version |
| `GET /api/workspace[?space=]` | `{project, space, spaces, intents, selected_intent, sentence}` |
| `GET /api/workflow?space=&intent=` | `{space, intent, label, description, scope, depth, phase, status, current_stage, next_stage, stages_done, stages_total, stages_skipped, needs, sentence, phases, unit_progress, notes, updated_at}` |
| `GET /api/tree?space=&intent=[&root=codekb]` | `{space, intent, root, entries}` |
| `GET /api/render?space=&intent=&path=[&root=codekb]` | `{path, kind, html, outline, mtime}` |
| `GET /api/questions?space=&intent=&path=[&root=codekb]` | `{path, stage, stage_name, questions, sections, total, answered, open, open_answers, sentence}`, for a path ending `-questions.md` |
| `GET /api/decisions?space=&intent=[&stage=&unit=]` | `{space, intent, entries, notes}`, newest first |
| `WS /ws` | Sends `{"type":"state"}` when files change; the page then asks again. It takes nothing from the page: a message closes the connection |

`/api/workspace` without `space` answers for the space last selected in this
checkout, else `default`, else the first one found. Its intents come most
recently updated first. `selected_intent` is the intent last selected in this
checkout when that names one of them (by folder name, slug or id); else the
only intent that is not archived; else the running one updated last; else
`null`.

The objects inside them:

| Object | Fields |
|---|---|
| A space (`spaces`) | `name`, `intents` (how many), `needs_you` (how many need you) |
| An intent (`intents`) | `space`, `record` (the record folder's name, the intent's id in every route), `label`, `description` (the state file's one-line Project, or `""`), `scope`, `depth`, `phase`, `current_stage`, `current_stage_name` (its name as the workflow shows it, or `null`), `status` (`running`, `completed`, `archived` or `unknown`), `group` (`needs-you`, `in-progress`, `done` or `archived`), `needs`, `stages_done`, `stages_total`, `updated_at` |
| `needs` | `null`, or `{kind, label}`: `kind` is `gate` or `questions`, `label` is "Review approval gate" or "N questions" |
| `sentence` | `{text, tone, at}`: the header line, with `tone` `needs`, `ok` or `quiet`; `at`, on a finished stage's line, is the time the page shows after the text on the browser's own clock ("Done · 11:15"), and is absent or `null` otherwise |
| A phase (`phases`) | `name`, `status` (its Phase Progress value, or `null`), `skipped_reason`, `stages`, `not_in_plan` (how many stages are folded), `not_in_plan_label` (the folded line, such as "3 more · not in this plan", or `null`) |
| A stage (`stages`) | `slug`, `name`, `marker` (the character between the brackets), `scope` (`EXECUTE`, `SKIP` or `unknown`), `word`, `label` (the word with its detail), `reason`, `revision` (0 before it starts), `decided_at`, `is_current`, `questions`, `artifacts`, `diary`, `reviews`, `units`, `sentence` (the header line while it is shown), `hint` (the line for a stage with no files, or `null`) |
| `word` | `done`, `questions`, `current`, `in-review`, `revising`, `next`, `later`, `skipped`, `not-in-plan`, or `stopped` (still open when its intent was completed or archived) |
| A unit (`units`) | `unit`, `questions`, `artifacts`, `diary`, and in team mode its cell in the Unit Progress table as `marker`, `word`, `label` and `sentence` (the header line while the unit is shown); these are `null` without a cell |
| A Unit Progress row (`unit_progress`, team mode only) | `unit`, `owner` (or `null` while it reads `-`), `cells` (each `{stage, marker}`), `gate` (a marker), `needs_you` |
| `notes` | Plain-words notes about files left out, such as a state file over 4 MiB |
| A file (`artifacts`, `diary`, `reviews`) | `path` (project-relative, starting with `aidlc/`), `name`, `kind` (`markdown`, `text` or `other`), `size`, `mtime` |
| A questions summary (`questions`) | `path`, `total`, `answered`, `open` (open numbered questions), `open_answers` (those plus open confirmation, approval and change-request sections: the count that makes an intent need you), `sections` (plain words, such as "summary confirmed") |
| A tree entry (`entries` of `/api/tree`) | `path`, `name`, `type` (`file` or `dir`), `kind` and `size` (files only), `mtime` |
| An outline item (`outline`) | `level`, `text`, `id` (always starting `md-`, unique in the document) |
| A question (`questions` of `/api/questions`) | `number`, `title`, `role`, `prompt`, `options` (each `{letter, text}`), `answer`, `chosen` (the option letter the answer starts with), `chosen_all` (every letter it names), `open` |
| A section (`sections` of `/api/questions`) | `title`, `state` (`open` or `answered`), `answer`, `note` |
| A decision (`entries` of `/api/decisions`) | `at`, `kind`, `event` (the audit event, or `REVIEW` for a review file), `stage`, `stage_name`, `unit`, `title`, `summary`, `question` (for an answer, the question it closed), `order_unknown`, `path` (for a review, the file to open) |
| `kind` of a decision | `asked`, `answered`, `reply`, `approved`, `changes-requested`, `gate-opened`, `revising`, `skipped`, `plan-approval-skipped` or `review` |

Times are ISO 8601 strings, and any of them can be `null` when the files don't
say. `/api/render` returns Markdown as HTML (raw HTML in the document shown as
text, except that a `<br>` breaks the line and a comment is hidden; a Mermaid
block as its source in `pre.mermaid`) and any other text file as one
`<pre><code>` block.

Errors are JSON `{error}` with a fixed sentence that names no path:

| Status | When | Sentence |
|---|---|---|
| 400 | An unknown space or intent | "That space or intent was not found." |
| 400 | A `path` that is not a file of the intent, or an unknown `root` | "That path is not a file of this intent." |
| 400 | A `stage` or `unit` that is not a plain name | "That stage or unit was not found." |
| 400 | `/ws` asked for without a WebSocket upgrade | "Live updates need a WebSocket connection." |
| 403 | A request from another machine | "The Review UI only answers this computer." |
| 403 | A hidden file | "That file is not shown in the Review UI." |
| 403 | `/ws` opened by any page but the server's own | "Live updates only connect from the Review UI page." |
| 404 | Nothing there | "Not found." |
| 405 | Any method other than `GET` and `HEAD` (with `Allow: GET, HEAD`) | "The Review UI only reads; it does not accept changes." |
| 413 | A file over 4 MiB | "This file is over 4 MiB; open it in your editor." |
| 415 | A file that is not text | "This file is not text; open it in your editor." |
| 500 | Anything unexpected | "Something went wrong reading the workspace." |

When a route fails that way, the terminal where the Review UI runs says why, in
a line starting `Review UI could not answer a request:`.

A request that names the server by anything other than `127.0.0.1`,
`localhost` or `[::1]` gets a 403 page instead: "This page only answers at
`http://127.0.0.1:<port>/`. Open that address instead." Every response, errors
included, carries a Content Security Policy that allows only the server's own
scripts, styles, images and live connection, plus `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, and same-origin
`Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`. API answers
and errors are never cached; the page's files are checked again on each load.

## Safety

- **On this machine only.** It listens on `127.0.0.1`, and there is no setting
  that changes that. It answers only requests that come from this machine and
  name it `127.0.0.1`, `localhost` or `[::1]`, so a web page elsewhere cannot
  reach it by pointing its own name at your machine. The live connection
  accepts only the page the server itself served.
- **No accounts and no tokens.** While it runs, anyone who can connect to that
  port on this machine can read what it shows, and that includes other
  accounts on a shared machine. On a machine you share, stop it (Ctrl+C) when
  you are done.
- **It never writes.** It answers `GET` and `HEAD` only and writes nothing: not
  in your project, not in your home folder, not the active space or intent.
- **Only your AI-DLC files.** It reads the intents it found under
  `aidlc/spaces/` and the space's own `codekb/` folder (not one that is a link
  to somewhere else), and nothing else. Inside them it does not follow
  symlinks; it does not serve a record's state file, its `audit/` folder or
  its `runtime-graph.json` (the engine's own entries at the top of the
  record), or any folder or file whose name starts with a dot, at any depth
  (their content reaches you through the views); and it does not open files
  over 4 MiB or files that are not text.
- **Documents are treated as untrusted.** Raw HTML in a document is shown as
  text, links are limited to `http`, `https`, `mailto` and links to files in
  the document's own record (or code knowledge base), and images are shown as
  links. The page loads nothing from the internet: its styles, scripts and
  icons ship with the plugin.

## Limits

- **Read-only.** Approve, answer and ask for changes where you run AI-DLC.
- **No Compare or Diff** between revisions of a document.
- **Mermaid diagrams** are shown as their source.
- **Light theme only.**

## Development

The plugin is plain TypeScript and browser JavaScript run by Bun, with no
dependencies and no build step.

```text
plugins/review-ui/
  .aidlc-plugin/plugin.json   the manifest: ships tools/ only, built on core
  README.md                   this file
  tools/review-ui.ts          the command: serve, --project-dir, --help
  tools/review-ui/            the server
  tools/review-ui/public/     the page: HTML, ES modules, CSS, icons and their licence
  tests/                      the plugin's tests
```

| Server module | Role |
|---|---|
| `workspace.ts` | The only module that reads the disk: finding spaces and intents, keeping every read inside them, capped reads |
| `state.ts` | Reading `aidlc-state.md` |
| `audit.ts` | Reading the audit files, and the Decisions timeline's words: what each event means, when a stage was decided, why it was skipped, its revision |
| `questions.ts` | Reading questions files, and the notes on their confirmation and approval sections |
| `model.ts` | Stage words, needs you, counts, the header line and its tone, intent groups, and the Decisions panel: review verdict entries, filtering by stage and unit, newest first |
| `render.ts` | Markdown to safe HTML |
| `server.ts` | The routes, the request checks and the response headers |
| `serve.ts` | Listening on `127.0.0.1` and the live updates over `/ws` |
| `types.ts` | The JSON shapes of the HTTP API |

The reader banners, the stage overview and the empty states are worded in the
page (`tools/review-ui/public/`).

Two rules keep it independent of the engine, and `tests/plugin.test.ts` checks
both. The code under `tools/` imports only Bun and Node built-ins and its own
files. It reads only the formats in [What it reads](#what-it-reads), and never
the engine's own files.

The records in `tests/fixtures/` are three real 2.10.0 records, with names and
paths replaced, and one synthetic record of the same shape. `tests/plugin.test.ts`
also fails on any account number, email address outside the example domains,
home or workspace folder path, or internal host name in any file of the
plugin, fixtures included.

| Test | What it checks |
|---|---|
| `tests/model.test.ts` | Every word and sentence the screens show, the needs-you rules, the registry and the state file disagreeing, team and per-unit layouts, questions files, the decisions timeline, and that Windows line endings and malformed input read cleanly |
| `tests/contract.test.ts` | That what it reads still matches the state template, the audit format, the guides' examples and the reviewers' review template, and that a record made by the packaged engine and the fixture records read cleanly |
| `tests/server.test.ts` | Every route in process: the answers, the errors, the headers, the request checks, the confinement, hostile Markdown, and that no file changes on disk |
| `tests/serve.test.ts` | The command: it listens on `127.0.0.1` only, checks the live connection's origin, pushes updates, exits cleanly, writes nothing, and stops with the exact sentences |
| `tests/plugin.test.ts` | The manifest, adding it to a Claude Code install, the server running from the added copy, that no file carries private data, and the independence and page-safety rules: only its own modules and Node built-ins, every module file read, one listener on `127.0.0.1`, nothing loaded from the internet, HTML inserted only by the reader, and no inline styles or handlers |

Run them from the repository root. The tests use the packaged engine in
`dist/`, so build it first:

```bash
bun scripts/package.ts
bun test plugins/review-ui/tests/
bash tests/run-tests.sh --integration --filter "plugin-review-ui"
bun dist/claude/.claude/tools/aidlc-plugin-validate.ts plugins/review-ui
```

The plugin's version in `.aidlc-plugin/plugin.json` (the one `/api/health`
reports) starts at 0.1.0 and goes up when its content changes after a release.
