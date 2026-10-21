// The workflow panel (intent selector, the Stages bar, the phase tree and the
// All files footer) and the two pages it opens in the main column: a stage's
// overview and the intent's All files list.

import { get } from "./api.js";
import { icon } from "./icons.js";
import {
  allStages,
  backTarget,
  basename,
  el,
  filesOf,
  findStage,
  finished,
  focusKey,
  formatSize,
  formatTime,
  formatWhen,
  inPlan,
  known,
  openAnswers,
  openFiles,
  openOverview,
  openPath,
  openView,
  phaseOf,
  phaseWord,
  placeholder,
  plural,
  QUESTIONS_FILE,
  rebuild,
  rememberKinds,
  store,
  unitAwaiting,
  wordsFor,
  workflowFor,
} from "./store.js";

/** The glyph inside .stage-glyph.<word>; the colour comes from the word's class. */
const GLYPHS = {
  done: "✓",
  questions: "?",
  "in-review": "●",
  current: "●",
  revising: "●",
  stopped: "■",
};

const GROUPS = [
  ["needs-you", "Needs you"],
  ["in-progress", "In progress"],
  ["done", "Done"],
];

let panel;
let contextBox;
let bar;
let tree;
let footer;
let overview;
let popoverOpen = false;
let popoverArchived = false;

function glyph(stage) {
  return el("span", { class: ["stage-glyph", stage.word], "aria-hidden": "true" }, GLYPHS[stage.word] ?? "");
}

function domId(prefix, value) {
  return `${prefix}-${String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}

// ---- Fold state ---------------------------------------------------------------

// Folds are kept per intent and keyed by stage slug, so a stage the person
// opened or closed by hand stays that way through every live refresh.
const foldState = new Map();

function folds(workflow) {
  const key = `${workflow.space}/${workflow.intent}`;
  if (!foldState.has(key)) {
    foldState.set(key, { opened: new Set(), closed: new Set(), phasesClosed: new Set(), unitsOpened: new Set(), unitsClosed: new Set() });
  }
  return foldState.get(key);
}

function viewedHere(stage, unit = null) {
  const view = store.view;
  return view.stage === stage.slug && (unit === null || view.unit === unit);
}

/** A stage starts open while it is current, on screen, or holds a unit whose gate waits on the person. */
function stageOpen(fold, stage) {
  if (fold.closed.has(stage.slug)) return false;
  if (fold.opened.has(stage.slug)) return true;
  return stage.is_current || viewedHere(stage) || unitAwaiting(stage) !== null;
}

function unitOpen(fold, stage, unit) {
  const key = `${stage.slug}/${unit}`;
  if (fold.unitsClosed.has(key)) return false;
  if (fold.unitsOpened.has(key)) return true;
  return viewedHere(stage, unit);
}

function flip(openSet, closedSet, key, open) {
  openSet.delete(key);
  closedSet.delete(key);
  if (open) closedSet.add(key);
  else openSet.add(key);
}

function toggleStage(workflow, slug) {
  const fold = folds(workflow);
  const stage = findStage(workflow, slug);
  if (!stage) return;
  flip(fold.opened, fold.closed, slug, stageOpen(fold, stage));
  renderTree();
  renderBar();
}

function toggleUnit(workflow, slug, unit) {
  const fold = folds(workflow);
  const stage = findStage(workflow, slug);
  if (!stage) return;
  flip(fold.unitsOpened, fold.unitsClosed, `${slug}/${unit}`, unitOpen(fold, stage, unit));
  renderTree();
}

function togglePhase(workflow, name) {
  const fold = folds(workflow);
  if (fold.phasesClosed.has(name)) fold.phasesClosed.delete(name);
  else fold.phasesClosed.add(name);
  renderTree();
  renderBar();
}

function foldablePhases(workflow) {
  return (workflow.phases ?? []).filter((phase) => (phase.stages ?? []).some(inPlan));
}

function anyPhaseOpen(workflow) {
  const fold = folds(workflow);
  return foldablePhases(workflow).some((phase) => !fold.phasesClosed.has(phase.name));
}

/** Collapse all folds every phase, stage and unit; Expand all opens them all. */
function toggleAll(workflow) {
  const fold = folds(workflow);
  const expanding = !anyPhaseOpen(workflow);
  for (const set of Object.values(fold)) set.clear();
  for (const stage of allStages(workflow)) {
    (expanding ? fold.opened : fold.closed).add(stage.slug);
    for (const unit of stage.units ?? []) (expanding ? fold.unitsOpened : fold.unitsClosed).add(`${stage.slug}/${unit.unit}`);
  }
  if (!expanding) for (const phase of foldablePhases(workflow)) fold.phasesClosed.add(phase.name);
  renderTree();
  renderBar();
}

// ---- Intent selector and popover ------------------------------------------------

function metaLine(workflow) {
  return [
    known(workflow.scope),
    known(workflow.depth),
    phaseWord(known(workflow.phase)),
    `${workflow.stages_done} / ${workflow.stages_total} stages`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function intentWhere(intent) {
  return intent.current_stage_name || phaseWord(known(intent.phase));
}

function intentStatus(intent) {
  if (intent.needs) return intent.needs.label;
  if (intent.group === "in-progress") return "in progress";
  if (intent.group === "archived") return "archived";
  return "done";
}

function choose(intent) {
  closePopover(false);
  store.emit("select-intent", { space: intent.space, intent: intent.record });
}

function chooseSpace(name) {
  closePopover(false);
  store.emit("select-space", name);
}

function intentRow(intent, viewing) {
  const on = intent.record === viewing;
  return el(
    "button",
    {
      type: "button",
      class: ["intent-row", on && "on"],
      title: intent.description || null,
      "aria-current": on ? "true" : null,
      "data-key": `popover:${intent.record}`,
      on: { click: () => choose(intent) },
    },
    el("span", { class: ["intent-dot", intent.group], "aria-hidden": "true" }),
    el("span", { class: "intent-row-main" }, el("b", { text: intent.label }), el("small", { text: intentWhere(intent) })),
    el("em", { text: intentStatus(intent) }),
  );
}

function popover(workspace, workflow) {
  const intents = workspace?.intents ?? [];
  const viewing = workflow?.intent ?? null;
  const archived = intents.filter((intent) => intent.group === "archived");
  const spaces = workspace?.spaces ?? [];
  return el(
    "div",
    { id: "intent-popover", class: "intent-popover", role: "dialog", "aria-label": `Intents in ${workspace?.space ?? "this workspace"}`, on: { keydown: onPopoverKey } },
    GROUPS.map(([group, label]) => {
      const members = intents.filter((intent) => intent.group === group);
      return el(
        "div",
        { class: "intent-group" },
        el("h3", { text: label }),
        members.length ? members.map((intent) => intentRow(intent, viewing)) : el("p", { class: "intent-group-empty", text: "None" }),
      );
    }),
    archived.length
      ? el(
          "div",
          { class: "intent-group archived" },
          el(
            "button",
            {
              type: "button",
              class: "group-toggle",
              "aria-expanded": String(popoverArchived),
              "data-key": "popover:archived",
              on: {
                click: () => {
                  popoverArchived = !popoverArchived;
                  renderContext();
                },
              },
            },
            icon(popoverArchived ? "chevronDown" : "chevronRight", { size: 12 }),
            `Archived · ${archived.length}`,
          ),
          popoverArchived ? archived.map((intent) => intentRow(intent, viewing)) : null,
        )
      : null,
    spaces.length > 1
      ? el(
          "div",
          { class: "intent-popover-footer" },
          el("h3", { text: "Spaces · view only" }),
          spaces.map((space) => {
            const on = space.name === workspace.space;
            return el(
              "button",
              { type: "button", class: ["space-row", on && "on"], "aria-current": on ? "true" : null, "data-key": `space:${space.name}`, on: { click: () => chooseSpace(space.name) } },
              el("b", { text: space.name }),
              el("small", { text: [plural(space.intents, "intent", "intents"), space.needs_you ? `${space.needs_you} ${space.needs_you === 1 ? "needs" : "need"} you` : null].filter(Boolean).join(" · ") }),
            );
          }),
        )
      : null,
  );
}

function renderContext() {
  const workspace = store.workspace;
  const workflow = store.workflow;
  const label = workflow?.label ?? (workspace?.intents?.length ? "Choose an intent" : "No intents yet");
  const meta = workflow ? metaLine(workflow) : workspace ? plural(workspace.intents.length, "intent", "intents") : "";
  const selector = el(
    "button",
    {
      type: "button",
      class: ["intent-selector", popoverOpen && "open"],
      "aria-expanded": String(popoverOpen),
      "aria-controls": "intent-popover",
      title: workflow ? [workflow.label, workflow.description, meta].filter(Boolean).join(" · ") : null,
      "data-key": "selector",
      disabled: !workspace,
      on: { click: () => (popoverOpen ? closePopover(true) : openPopover()) },
    },
    el("small", { text: `${workspace?.space || "workspace"} · intent` }),
    el("strong", { text: label }),
    meta ? el("span", { text: meta }) : null,
    el("i", { "aria-hidden": "true" }, icon("chevronDown", { size: 12 })),
  );
  rebuild(contextBox, selector, popoverOpen ? popover(workspace, workflow) : null);
}

function openPopover() {
  popoverOpen = true;
  renderContext();
  // A selector list matches in document order, so the viewed row is asked for first.
  const target = contextBox.querySelector(".intent-row.on") ?? contextBox.querySelector(".intent-popover button");
  if (target instanceof HTMLElement) target.focus();
}

function closePopover(focusSelector) {
  if (!popoverOpen) return;
  popoverOpen = false;
  renderContext();
  if (focusSelector) focusKey(contextBox, "selector");
}

function onPopoverKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closePopover(true);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const buttons = [...contextBox.querySelectorAll(".intent-popover button")];
  const index = buttons.indexOf(document.activeElement);
  const next = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

// ---- Stages bar ------------------------------------------------------------------

function renderBar() {
  const workflow = store.workflow;
  bar.hidden = !workflow;
  if (!workflow) return;
  const skipped = workflow.stages_skipped ?? 0;
  rebuild(
    bar,
    el("b", { text: "Stages" }),
    el("span", { text: `· ${workflow.stages_total} · ${workflow.stages_done} done` }),
    skipped ? el("span", { class: "workflow-bar-skipped", text: `· ${skipped} skipped` }) : null,
    el("button", { type: "button", "data-key": "fold-all", on: { click: () => toggleAll(workflow) } }, anyPhaseOpen(workflow) ? "Collapse all" : "Expand all"),
  );
}

// ---- Tree ------------------------------------------------------------------------

function hintRow(text) {
  return el("div", { class: "workflow-child hint" }, el("span", { "aria-hidden": "true" }), el("span", { text }));
}

/** "N open", in the accent pill only while the intent runs: a stopped one waits on nobody. */
function openMeta(workflow, questions) {
  const open = openAnswers(questions);
  if (open === 0) return null;
  return finished(workflow) ? `${open} open` : el("span", { class: "open-pill", text: `${open} open` });
}

function questionsMeta(workflow, questions) {
  const open = openMeta(workflow, questions);
  if (open) return open;
  if (questions.total > 0) return [el("b", { text: `${questions.answered} / ${questions.total}` }), " answered"];
  return questions.sections.join(" · ");
}

function questionsChild(workflow, stage, unit, questions) {
  const viewing = store.view.path === questions.path;
  const complete = openAnswers(questions) === 0 && (questions.total > 0 || questions.sections.length > 0);
  return el(
    "button",
    {
      type: "button",
      class: ["workflow-child", "questions", viewing && "on", !stage.is_current && "past"],
      title: questions.path,
      "aria-current": viewing ? "page" : null,
      "data-key": `file:${questions.path}`,
      "data-tree-item": "file",
      on: { click: () => openPath(questions.path, { stage: stage.slug, unit }) },
    },
    el("span", { class: ["child-icon", complete && "complete"], "aria-hidden": "true" }, icon("question", { size: 14 })),
    el("span", { class: "child-label", text: "Questions" }),
    el("span", { class: "child-meta" }, questionsMeta(workflow, questions)),
  );
}

function fileChild(stage, unit, file) {
  const viewing = store.view.path === file.path;
  return el(
    "button",
    {
      type: "button",
      class: ["workflow-child", "artifact", viewing && "on", !stage.is_current && "past"],
      title: file.mtime ? `${file.path} · updated ${formatWhen(file.mtime)}` : file.path,
      "aria-current": viewing ? "page" : null,
      "data-key": `file:${file.path}`,
      "data-tree-item": "file",
      on: { click: () => openPath(file.path, { stage: stage.slug, unit }) },
    },
    el("span", { class: "child-icon", "aria-hidden": "true" }, icon("documentText", { size: 14 })),
    el("span", { class: "child-label" }, el("code", { text: file.name || basename(file.path) })),
    el("span", { class: "child-meta" }),
  );
}

function unitChild(workflow, stage, entry, fold) {
  const open = unitOpen(fold, stage, entry.unit);
  const id = domId("unit", `${stage.slug}-${entry.unit}`);
  const files = filesOf(stage, entry.unit);
  const count = files.artifacts.length + (files.questions ? 1 : 0);
  // Open answers first while the intent runs; then a team-mode unit's own
  // word (its cell's); otherwise how much the unit produced.
  const meta = (finished(workflow) ? null : openMeta(workflow, files.questions)) ?? entry.label ?? (count ? plural(count, "file", "files") : "");
  const viewingOverview = store.view.kind === "overview" && viewedHere(stage, entry.unit);
  return el(
    "div",
    { class: ["workflow-unit", open && "open"] },
    el(
      "button",
      {
        type: "button",
        class: "workflow-child unit",
        "aria-expanded": String(open),
        "aria-controls": id,
        title: `${stage.name} for ${entry.unit}`,
        "data-key": `unit:${stage.slug}/${entry.unit}`,
        "data-tree-item": "unit",
        on: { click: () => toggleUnit(workflow, stage.slug, entry.unit) },
      },
      el("span", { class: "child-icon", "aria-hidden": "true" }, icon(open ? "chevronDown" : "chevronRight", { size: 12 })),
      el("span", { class: "child-label" }, entry.word ? glyph(entry) : null, entry.unit),
      el("span", { class: ["child-meta", entry.word && `unit-${entry.word}`] }, meta),
    ),
    el(
      "div",
      { id, class: "unit-children", hidden: !open },
      files.questions ? questionsChild(workflow, stage, entry.unit, files.questions) : null,
      files.artifacts.map((file) => fileChild(stage, entry.unit, file)),
      count === 0 ? hintRow(finished(workflow) ? "Nothing produced." : "Nothing produced yet.") : null,
      el(
        "button",
        {
          type: "button",
          class: ["workflow-child", "unit-overview", viewingOverview && "on", !stage.is_current && "past"],
          "aria-current": viewingOverview ? "page" : null,
          "data-key": `unit-overview:${stage.slug}/${entry.unit}`,
          "data-tree-item": "file",
          on: { click: () => openOverview(stage.slug, entry.unit) },
        },
        el("span", { class: "child-icon", "aria-hidden": "true" }, icon("book", { size: 14 })),
        el("span", { class: "child-label", text: "Overview" }),
        el("span", { class: "child-meta" }),
      ),
    ),
  );
}

function stageChildren(workflow, stage, fold) {
  const files = filesOf(stage);
  const rows = [
    files.questions ? questionsChild(workflow, stage, null, files.questions) : null,
    ...files.artifacts.map((file) => fileChild(stage, null, file)),
    ...(stage.units ?? []).map((entry) => unitChild(workflow, stage, entry, fold)),
  ].filter(Boolean);
  // The server words the hint for a stage that produced nothing; the stages
  // it has no hint for are done or stopped (nothing came of them) or still running.
  if (rows.length) return rows;
  return hintRow(stage.hint ?? (stage.word === "done" || finished(workflow) ? "Nothing produced." : "Nothing produced yet."));
}

function stageNode(workflow, stage, fold) {
  const open = stageOpen(fold, stage);
  const childrenId = domId("stage", stage.slug);
  const statusId = domId("status", stage.slug);
  const viewing = store.view.kind === "overview" && store.view.stage === stage.slug && !store.view.unit;
  const row = el(
    "div",
    { class: "stage-row" },
    glyph(stage),
    el(
      "button",
      {
        type: "button",
        class: "stage-name",
        title: `${stage.name} · ${stage.label}`,
        "aria-describedby": statusId,
        "aria-current": viewing ? "page" : null,
        "data-key": `stage:${stage.slug}`,
        "data-tree-item": "stage",
        on: { click: () => openOverview(stage.slug) },
      },
      stage.name,
    ),
    el("span", { id: statusId, class: "stage-status", title: stage.label, text: stage.label }),
    el(
      "button",
      {
        type: "button",
        class: "stage-toggle",
        tabindex: "-1",
        "aria-expanded": String(open),
        "aria-controls": childrenId,
        "aria-label": `${open ? "Hide" : "Show"} what ${stage.name} produced`,
        "data-key": `toggle:${stage.slug}`,
        on: { click: () => toggleStage(workflow, stage.slug) },
      },
      icon("chevronDown", { size: 10 }),
    ),
  );
  // A click on the row outside its two buttons folds it, as on a summary row.
  row.addEventListener("click", (event) => {
    if (event.target instanceof Element && !event.target.closest("button")) toggleStage(workflow, stage.slug);
  });
  return el(
    "div",
    { class: ["workflow-stage", stage.word, open && "open"], "data-stage": stage.slug },
    row,
    el("div", { id: childrenId, class: "workflow-children", hidden: !open }, stageChildren(workflow, stage, fold)),
  );
}

function phaseSummary(phase) {
  const shown = (phase.stages ?? []).filter(inPlan);
  const done = shown.filter((stage) => stage.word === "done").length;
  const skipped = shown.filter((stage) => stage.word === "skipped").length;
  if (shown.length > 0 && done === shown.length) return "all done";
  const current = shown.find((stage) => stage.is_current);
  const parts = [current?.label, done ? `${done} done` : null, skipped ? `${skipped} skipped` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "not started";
}

function phaseNode(workflow, phase, fold) {
  const stages = phase.stages ?? [];
  const shown = stages.filter(inPlan);
  const folded = stages.filter((stage) => !inPlan(stage));
  if (stages.length > 0 && shown.length === 0) {
    // The whole phase is out of this plan: one faint line, and the reason.
    return el(
      "section",
      { class: "workflow-phase scope-skipped", "data-phase": phase.name },
      el(
        "div",
        { class: "phase-heading", title: phase.skipped_reason ?? folded.map((stage) => stage.name).join(", ") },
        el("span", { class: "phase-chevron", "aria-hidden": "true" }),
        el("b", { text: phase.name }),
        phase.not_in_plan_label ? el("span", { class: "phase-summary", text: `· ${phase.not_in_plan_label}` }) : null,
      ),
      phase.skipped_reason ? el("p", { class: "scope-skipped-reason", text: phase.skipped_reason }) : null,
    );
  }
  const closed = fold.phasesClosed.has(phase.name);
  const done = shown.filter((stage) => stage.word === "done").length;
  const counted = shown.filter((stage) => stage.word !== "skipped").length;
  const stagesId = domId("phase", phase.name);
  const foldedNames = folded.map((stage) => stage.name).join(", ");
  return el(
    "section",
    { class: ["workflow-phase", closed && "closed"], "data-phase": phase.name },
    el(
      "button",
      {
        type: "button",
        class: "phase-heading",
        "aria-expanded": String(!closed),
        "aria-controls": stagesId,
        "data-key": `phase:${phase.name}`,
        "data-tree-item": "phase",
        on: { click: () => togglePhase(workflow, phase.name) },
      },
      el("span", { class: "phase-chevron", "aria-hidden": "true" }, icon("chevronDown", { size: 10 })),
      el("b", { text: phase.name }),
      el("span", { class: "phase-summary", text: `· ${phaseSummary(phase)}` }),
      counted > 0 ? el("span", { class: "phase-count", text: `${done} / ${counted}` }) : null,
    ),
    el(
      "div",
      { id: stagesId, class: "phase-stages", hidden: closed },
      shown.map((stage) => stageNode(workflow, stage, fold)),
      phase.not_in_plan_label
        ? el(
            "div",
            { class: "scope-skipped-more", title: phase.skipped_reason ? `${foldedNames}: ${phase.skipped_reason}` : foldedNames },
            phase.not_in_plan_label,
          )
        : null,
    ),
  );
}

function renderTree() {
  const workflow = store.workflow;
  const workspace = store.workspace;
  if (!workflow) {
    const line = !workspace
      ? placeholder("Reading your workspace…", null, "workflow-tree-empty")
      : workspace.intents.length
        ? placeholder("Choose an intent", "Pick one above to see its stages.", "workflow-tree-empty")
        : placeholder("No intents yet", "Start one where you run AI-DLC.", "workflow-tree-empty");
    rebuild(tree, line);
    return;
  }
  const phases = workflow.phases ?? [];
  if (phases.length === 0) {
    rebuild(
      tree,
      (workflow.notes ?? []).map((note) => el("p", { class: "workflow-note", text: note })),
      placeholder("No stages to show yet", "They appear once the intent's plan is written.", "workflow-tree-empty"),
    );
    return;
  }
  const fold = folds(workflow);
  rebuild(
    tree,
    (workflow.notes ?? []).map((note) => el("p", { class: "workflow-note", text: note })),
    phases.map((phase) => phaseNode(workflow, phase, fold)),
  );
}

function renderFooter() {
  const on = store.view.kind === "files";
  rebuild(
    footer,
    el(
      "button",
      { type: "button", class: on ? "on" : null, disabled: !store.workflow, "aria-current": on ? "page" : null, "data-key": "all-files", on: { click: openFiles } },
      icon("documentText", { size: 14 }),
      "All files",
    ),
  );
}

// ---- Tree keyboard -----------------------------------------------------------------

function visibleItems() {
  return [...tree.querySelectorAll("[data-tree-item]")].filter((node) => node.getClientRects().length > 0 && !node.disabled);
}

function focusItem(node) {
  if (node instanceof HTMLElement) node.focus();
}

function firstItemIn(container) {
  return [...(container?.querySelectorAll("[data-tree-item]") ?? [])].find((node) => node.getClientRects().length > 0) ?? null;
}

function expandOrEnter(workflow, item) {
  const kind = item.dataset.treeItem;
  if (kind === "phase") {
    if (item.getAttribute("aria-expanded") === "false") togglePhase(workflow, item.closest(".workflow-phase")?.dataset.phase);
    else focusItem(firstItemIn(item.closest(".workflow-phase")?.querySelector(".phase-stages")));
  } else if (kind === "stage") {
    const node = item.closest(".workflow-stage");
    if (!node?.classList.contains("open")) toggleStage(workflow, node?.dataset.stage);
    else focusItem(firstItemIn(node.querySelector(".workflow-children")));
  } else if (kind === "unit") {
    if (item.getAttribute("aria-expanded") === "false") item.click();
    else focusItem(firstItemIn(item.closest(".workflow-unit")?.querySelector(".unit-children")));
  }
}

function collapseOrLeave(workflow, item) {
  const kind = item.dataset.treeItem;
  const stageNode = item.closest(".workflow-stage");
  if (kind === "phase") {
    if (item.getAttribute("aria-expanded") === "true") togglePhase(workflow, item.closest(".workflow-phase")?.dataset.phase);
  } else if (kind === "stage") {
    if (stageNode?.classList.contains("open")) toggleStage(workflow, stageNode.dataset.stage);
    else focusItem(item.closest(".workflow-phase")?.querySelector(".phase-heading"));
  } else if (kind === "unit") {
    if (item.getAttribute("aria-expanded") === "true") item.click();
    else focusItem(stageNode?.querySelector(".stage-name"));
  } else {
    const unit = item.closest(".workflow-unit");
    focusItem(unit ? unit.querySelector(".workflow-child.unit") : stageNode?.querySelector(".stage-name"));
  }
}

function onTreeKey(event) {
  const workflow = store.workflow;
  const item = event.target instanceof Element ? event.target.closest("[data-tree-item]") : null;
  if (!workflow || !item || !tree.contains(item)) return;
  const items = visibleItems();
  const index = items.indexOf(item);
  switch (event.key) {
    case "ArrowDown":
      focusItem(items[index + 1]);
      break;
    case "ArrowUp":
      focusItem(items[index - 1]);
      break;
    case "Home":
      focusItem(items[0]);
      break;
    case "End":
      focusItem(items.at(-1));
      break;
    case "ArrowRight":
      expandOrEnter(workflow, item);
      break;
    case "ArrowLeft":
      collapseOrLeave(workflow, item);
      break;
    default:
      return;
  }
  event.preventDefault();
}

function renderPanel() {
  renderContext();
  renderBar();
  renderTree();
  renderFooter();
}

// ---- Stage overview ------------------------------------------------------------------

function card(title, body, hot = false) {
  return el("section", { class: ["overview-card", hot && "hot"] }, el("h2", { text: title }), body);
}

function cardRows(rows, emptyText) {
  return rows.length ? el("ul", null, rows) : el("p", { class: "overview-placeholder", text: emptyText });
}

/** One row of an overview card; `key` (card:<card>:<what>) lets a live redraw keep focus on it. */
function cardRow(key, iconNode, label, meta, metaClass, open) {
  return el(
    "li",
    { class: "card-item" },
    el(
      "button",
      { type: "button", class: "card-row", "data-key": key, on: { click: open } },
      el("span", { class: "card-icon", "aria-hidden": "true" }, iconNode),
      label,
      meta ? el("em", { class: metaClass, text: meta }) : null,
    ),
  );
}

function questionsCount(questions) {
  const open = openAnswers(questions);
  if (open > 0) return `${open} open`;
  if (questions.total > 0) return `${questions.answered} / ${questions.total} answered`;
  return questions.sections[0] ?? "";
}

/** Every artifact of a stage, its units' included, with the unit each belongs to. */
function producedBy(stage) {
  return [
    ...filesOf(stage).artifacts.map((file) => ({ file, unit: null })),
    ...(stage.units ?? []).flatMap((entry) => entry.artifacts.map((file) => ({ file, unit: entry.unit }))),
  ];
}

function previousWithFiles(workflow, stage) {
  const stages = allStages(workflow).filter(inPlan);
  const index = stages.findIndex((candidate) => candidate.slug === stage.slug);
  for (let at = index - 1; at >= 0; at -= 1) {
    if (producedBy(stages[at]).length > 0) return stages[at];
  }
  return null;
}

function nextStages(workflow, stage) {
  const stages = allStages(workflow).filter(inPlan);
  const index = stages.findIndex((candidate) => candidate.slug === stage.slug);
  return stages.slice(index + 1).filter((candidate) => candidate.word !== "skipped");
}

/** The overview's lead for a stage, or a team-mode unit (wordsFor), which names the unit. */
function leadFor(workflow, words) {
  const name = words.unit ? `${words.name} for ${words.unit}` : words.name;
  const phase = phaseOf(workflow, words.slug)?.name;
  const where = phase ? ` It is part of the ${phase} phase.` : "";
  switch (words.word) {
    case "done":
      return `${name} finished${words.decided_at ? ` ${formatWhen(words.decided_at)}` : ""}.${where}`;
    case "questions":
      return `${name} is waiting for your answers.${where}`;
    case "in-review":
      return `${name} is waiting for your approval${words.revision ? ` at r${words.revision}` : ""}.${where}`;
    case "revising":
      return `The agent is working on your feedback for ${name}.${where}`;
    case "current":
      return `${name} is in progress.${where}`;
    case "stopped":
      return workflow.status === "archived"
        ? `${name} stopped here when this intent was archived; unarchive the intent where you run AI-DLC to pick it up again.${where}`
        : `${name} was still open when this intent completed.${where}`;
    case "next":
      return `${name} is next in this plan.${where}`;
    case "later":
      return `${name} comes later in this plan.${where}`;
    case "skipped":
      return `${name} was skipped${words.reason ? `: ${words.reason.replace(/[.\s]+$/, "")}` : ""}.${where}`;
    default:
      return `${name} is not in the ${known(workflow.scope) ?? "current"} plan.${where}`;
  }
}

const diaryOpen = new Set();
// The Diary body last drawn, by key. A live refresh redraws the overview; a
// fresh body would read "Reading…" and fetch again, so the page would shrink
// under the reader and lose their place. An open Diary's body is carried into
// the new page as a copy instead (the old one stays until rebuild swaps the
// pages, so rebuild keeps the scroll and focus), and memory.md is read again
// only when its size or mtime changed.
let diaryShown = null;

function diaryNode(view, stage, diary) {
  if (!diary) return null;
  const key = `${view.space}/${view.intent}:${diary.path}`;
  const stamp = `${diary.size}:${diary.mtime}`;
  const open = diaryOpen.has(key);
  const carried = open && diaryShown?.key === key ? diaryShown.body.cloneNode(true) : null;
  const body = carried ?? el("div", { class: "diary-body" }, el("p", { class: "overview-placeholder", text: "Reading…" }));
  diaryShown = { key, body };
  const details = el(
    "details",
    { class: "stage-diary", open },
    el(
      "summary",
      { "data-key": `diary:${diary.path}` },
      el("span", { class: "diary-icon", "aria-hidden": "true" }, icon("book", { size: 14 })),
      el("b", { text: "Diary" }),
      el("small", { text: `the agent's interpretations, deviations and open questions while ${stage.name} runs` }),
    ),
    body,
  );
  // A details element made open fires toggle too, so a redrawn Diary passes
  // here once; its carried body already holds this version.
  details.addEventListener("toggle", () => {
    if (!details.open) {
      diaryOpen.delete(key);
      return;
    }
    diaryOpen.add(key);
    // The reader (document.js) owns turning server HTML into nodes.
    if (body.dataset.filled !== stamp) store.emit("diary", { target: body, space: view.space, intent: view.intent, path: diary.path, stamp });
  });
  return details;
}

function renderOverview() {
  const view = store.view;
  if (view.kind !== "overview") return;
  const workflow = workflowFor(view);
  const stage = findStage(workflow, view.stage);
  if (!workflow || !stage) {
    rebuild(overview, placeholder("Stage unavailable", "This stage is not in the intent's plan right now."));
    return;
  }
  const unit = view.unit;
  const owner = { stage: stage.slug, unit };
  const files = filesOf(stage, unit);
  const words = wordsFor(stage, unit);
  const skipped = stage.word === "skipped" || stage.word === "not-in-plan";
  const ended = finished(workflow);
  // Open answers take the accent only while the intent runs.
  const asking = openAnswers(files.questions) > 0;
  const waiting = asking && !ended;

  const asks = files.questions
    ? [
        cardRows(
          [
            cardRow(
              `card:asks:${files.questions.path}`,
              icon("question", { size: 14 }),
              el("code", { text: basename(files.questions.path) }),
              questionsCount(files.questions),
              waiting ? "open" : asking ? null : "ready",
              () => openPath(files.questions.path, owner),
            ),
          ],
          "",
        ),
        files.questions.sections.length ? el("p", { class: "card-note", text: files.questions.sections.join(" · ") }) : null,
      ]
    : el("p", { class: "overview-placeholder", text: skipped ? "Nothing — this stage is skipped." : `No questions file in this stage${ended ? "" : " yet"}.` });

  const produced = files.artifacts.map((file) =>
    cardRow(
      `card:produce:${file.path}`,
      icon("documentText", { size: 14 }),
      el("code", { text: file.name || basename(file.path) }),
      file.mtime ? `written ${formatTime(file.mtime)}` : null,
      "ready",
      () => openPath(file.path, owner),
    ),
  );
  if (!unit) {
    for (const entry of stage.units ?? []) {
      const count = entry.artifacts.length + (entry.questions ? 1 : 0);
      produced.push(
        cardRow(
          `card:unit:${entry.unit}`,
          icon("flowchart", { size: 14 }),
          el("span", { class: "card-label", text: entry.unit }),
          count ? plural(count, "file", "files") : "nothing yet",
          null,
          () => openOverview(stage.slug, entry.unit),
        ),
      );
    }
  }

  const previous = previousWithFiles(workflow, stage);
  const builds = previous
    ? [
        cardRows(
          producedBy(previous)
            .slice(0, 4)
            .map(({ file, unit: from }) =>
              cardRow(
                `card:builds:${file.path}`,
                icon("documentText", { size: 14 }),
                el("code", { text: file.name || basename(file.path) }),
                previous.word === "done" && previous.decided_at ? `approved ${formatTime(previous.decided_at)}` : previous.label,
                previous.word === "done" ? "ready" : null,
                () => openPath(file.path, { stage: previous.slug, unit: from }),
              ),
            ),
          "",
        ),
        el("p", { class: "card-note", text: `From ${previous.name}` }),
      ]
    : el("p", { class: "overview-placeholder", text: "Nothing before this stage." });

  const next = nextStages(workflow, stage).slice(0, 4);
  const then = next.length
    ? el(
        "ul",
        null,
        next.map((candidate) =>
          el(
            "li",
            { class: "card-item" },
            el(
              "button",
              { type: "button", class: "card-row then-row", "data-key": `card:then:${candidate.slug}`, on: { click: () => openOverview(candidate.slug) } },
              glyph(candidate),
              el("span", { class: "then-label" }, el("b", { text: candidate.name }), el("small", { text: ` · ${candidate.label}` })),
            ),
          ),
        ),
      )
    : el("p", { class: "overview-placeholder", text: "This is the last stage in the plan." });

  const scope = known(workflow.scope);
  const depth = known(workflow.depth);
  const title = unit ? `${stage.name} · ${unit}` : stage.name;
  rebuild(
    overview,
    el(
      "div",
      { class: "stage-overview-page" },
      el("h1", null, el("span", { class: "overview-title", text: title }), el("span", { class: ["overview-pill", words.word], text: words.label })),
      el("p", { class: "overview-lead", text: leadFor(workflow, words.unit || !unit ? words : { ...words, unit }) }),
      el(
        "div",
        { class: "overview-grid" },
        card("Asks first", asks, waiting),
        card("Will produce", cardRows(produced, skipped ? "Nothing — this stage is skipped." : ended ? "Nothing was written." : "Nothing written yet.")),
        card("Builds on", builds),
        card("Then", then, false),
      ),
      diaryNode(view, stage, files.diary),
      el(
        "aside",
        { class: "scope-note" },
        scope || depth ? el("b", { text: `${[scope ? `${scope} scope` : null, depth ? `${depth} depth` : null].filter(Boolean).join(" · ")}.` }) : null,
        `${scope || depth ? " " : ""}Read from aidlc-state.md, the audit record and the stage files; every action happens where you run AI-DLC.`,
      ),
    ),
  );
}

// ---- All files --------------------------------------------------------------------------

let files = { key: null, record: null, codekb: null, error: null };
let filesToken = 0;

async function loadFiles(view) {
  const key = `${view.space}/${view.intent}`;
  const token = ++filesToken;
  try {
    const [record, codekb] = await Promise.all([
      get("/api/tree", { space: view.space, intent: view.intent }),
      get("/api/tree", { space: view.space, intent: view.intent, root: "codekb" }).catch(() => null),
    ]);
    if (token !== filesToken) return;
    rememberKinds(record.entries);
    rememberKinds(codekb?.entries);
    files = { key, record, codekb, error: null };
  } catch (error) {
    if (token !== filesToken) return;
    files = { key, record: null, codekb: null, error: error.message };
  }
  renderFiles();
}

function fileRole(entry) {
  if (QUESTIONS_FILE.test(entry.name)) return "Questions";
  if (entry.name === "memory.md") return "Diary";
  if (entry.path.split("/").includes("reviews")) return "Review";
  return "";
}

/** A record folder named after one of the workflow's phases, as the server names that phase. */
function phaseNamed(workflow, folder) {
  return (workflow.phases ?? []).find((phase) => phase.name.toLowerCase() === folder.toLowerCase())?.name ?? null;
}

/**
 * Folders in plan order: by phase, then by the stage they belong to, then by
 * name. A codekb folder (`asWritten`) is a repository's own, so it is matched
 * against no stage or phase and sorts by name alone.
 */
function fileGroups(workflow, entries, root, asWritten = false) {
  const stages = allStages(workflow);
  const phaseNames = (workflow.phases ?? []).map((phase) => phase.name.toLowerCase());
  const groups = new Map();
  for (const entry of entries ?? []) {
    if (entry.type !== "file" || !entry.path.startsWith(root)) continue;
    const relative = entry.path.slice(root.length);
    const folder = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(entry);
  }
  return [...groups]
    .map(([folder, members]) => {
      const parts = folder ? folder.split("/") : [];
      const stage = asWritten ? null : (parts.map((part) => findStage(workflow, part)).find(Boolean) ?? null);
      const phaseRank = !asWritten && parts.length ? phaseNames.indexOf(parts[0].toLowerCase()) : -1;
      return {
        folder,
        parts,
        stage,
        members,
        asWritten,
        rank: [phaseRank < 0 ? 99 : phaseRank, stage ? stages.indexOf(stage) : 999],
      };
    })
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.folder.localeCompare(b.folder));
}

// The record's other documented top-level folder (guide 14, "Phase Boundary
// Verification"), headed like the phase folders beside it.
const RECORD_FOLDER_NAMES = { verification: "Verification" };

/**
 * A folder's heading: stage and phase folders by the server's names, the
 * record's documented verification/ folder by its name, and every other folder
 * (one the person made, a unit) as written.
 */
function folderLabel(workflow, group, fallback) {
  if (group.parts.length === 0) return fallback;
  if (group.asWritten) return group.parts.join(" › ");
  const topLevel = (part) => phaseNamed(workflow, part) ?? RECORD_FOLDER_NAMES[part] ?? part;
  return group.parts.map((part, index) => findStage(workflow, part)?.name ?? (index === 0 ? topLevel(part) : part)).join(" › ");
}

function fileList(group) {
  return el(
    "ul",
    { class: "record-files" },
    group.members.map((entry) => {
      const role = fileRole(entry);
      return el(
        "li",
        { class: "record-file" },
        el(
          "button",
          { type: "button", "data-key": `files:${entry.path}`, title: entry.mtime ? `${entry.path} · updated ${formatWhen(entry.mtime)}` : entry.path, on: { click: () => openPath(entry.path) } },
          el("span", { class: "card-icon", "aria-hidden": "true" }, icon(role === "Questions" ? "question" : "documentText", { size: 14 })),
          el("code", { text: entry.name }),
          el("em", { text: role }),
          el("small", { text: formatSize(entry.size) }),
        ),
      );
    }),
  );
}

function groupNode(workflow, group, fallback) {
  return el(
    "section",
    { class: "record-group" },
    el(
      "h2",
      null,
      group.stage ? glyph(group.stage) : null,
      el("span", { text: folderLabel(workflow, group, fallback) }),
      group.stage ? el("small", { text: group.stage.label }) : null,
    ),
    fileList(group),
  );
}

function renderFiles() {
  const view = store.view;
  if (view.kind !== "files") return;
  const workflow = workflowFor(view);
  if (!workflow) {
    rebuild(overview, placeholder("No intent open", "Choose an intent to list its files."));
    return;
  }
  const key = `${view.space}/${view.intent}`;
  if (files.key !== key) {
    rebuild(overview, placeholder("Reading the files…", null));
    loadFiles(view);
    return;
  }
  if (files.error) {
    rebuild(overview, placeholder("The files could not be listed.", files.error));
    return;
  }
  const recordRoot = `aidlc/spaces/${view.space}/intents/${view.intent}/`;
  const codekbRoot = `aidlc/spaces/${view.space}/codekb/`;
  const groups = fileGroups(workflow, files.record?.entries, recordRoot);
  const codekb = fileGroups(workflow, files.codekb?.entries, codekbRoot, true);
  const count = [...groups, ...codekb].reduce((total, group) => total + group.members.length, 0);
  const back = backTarget(workflow);
  rebuild(
    overview,
    el(
      "div",
      { class: "record-tree-page" },
      back
        ? el(
            "button",
            { type: "button", class: "record-back", "data-key": "files:back", on: { click: () => openView(back.view) } },
            icon("arrowLeft", { size: 12 }),
            back.label,
          )
        : null,
      el("h1", null, "All files", count ? el("small", { text: String(count) }) : null),
      el("p", { text: `Every file the Review UI shows for ${workflow.label}, by folder.` }),
      groups.length || codekb.length
        ? [
            groups.map((group) => groupNode(workflow, group, workflow.label)),
            codekb.length
              ? el(
                  "section",
                  { class: "record-codekb" },
                  el("h2", { class: "record-codekb-title", text: `Code knowledge base of ${view.space}` }),
                  codekb.map((group) => groupNode(workflow, group, "Knowledge base")),
                )
              : null,
          ]
        : el("p", { class: "overview-placeholder", text: "Nothing written yet. Files appear here as stages ask questions and produce artifacts." }),
    ),
  );
}

// ---- Wiring ------------------------------------------------------------------------------

export function init() {
  panel = document.getElementById("panel");
  overview = document.getElementById("overview");
  contextBox = el("div", { class: "workflow-context" });
  bar = el("div", { class: "workflow-bar" });
  tree = el("div", { class: "workflow-tree", "aria-label": "Stages", role: "group" });
  footer = el("footer", { class: "workflow-footer" });
  panel.replaceChildren(contextBox, bar, tree, footer);

  tree.addEventListener("keydown", onTreeKey);
  contextBox.addEventListener("focusout", (event) => {
    if (popoverOpen && event.relatedTarget instanceof Node && !contextBox.contains(event.relatedTarget)) closePopover(false);
  });
  // The path, not the target: a click inside the popover can redraw it and
  // detach the very button that was clicked.
  document.addEventListener("click", (event) => {
    if (popoverOpen && !event.composedPath().includes(contextBox)) closePopover(false);
  });

  store.on("workspace", () => {
    renderContext();
    renderTree();
  });
  store.on("workflow", () => {
    renderPanel();
    renderOverview();
    renderFiles();
  });
  store.on("view", (view) => {
    renderTree();
    renderFooter();
    renderOverview();
    renderFiles();
    // Pushes re-read All files only while it is shown, so coming back to it
    // reads it again behind the listing drawn from the last visit.
    if (view.kind === "files" && files.key === `${view.space}/${view.intent}`) loadFiles(view);
  });
  store.on("refresh", () => {
    if (store.view.kind === "files") loadFiles(store.view);
  });
  renderPanel();
}
