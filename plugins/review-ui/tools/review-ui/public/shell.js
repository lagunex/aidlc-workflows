// The app rail, the header over the main column, the Inbox, the empty view
// and the search palette. Everything here navigates; nothing changes a file.

import { icon } from "./icons.js";
import {
  allStages,
  backTarget,
  basename,
  el,
  fileScopes,
  filesOf,
  findStage,
  finished,
  focusKey,
  inPlan,
  known,
  needsYouCount,
  openAnswers,
  openFiles,
  openInbox,
  openOverview,
  openPath,
  openView,
  panelsFor,
  phaseOf,
  phaseWord,
  placeholder,
  plural,
  rebuild,
  relativeTime,
  sentenceText,
  shortcut,
  shortcutAria,
  store,
  wordsFor,
  workflowFor,
} from "./store.js";

const PANELS = {
  outline: { label: "Outline", icon: "textBulletListTree" },
  decisions: { label: "Decisions", icon: "checkmarkCircle" },
};

const GROUPS = [
  ["needs-you", "Needs you"],
  ["in-progress", "In progress"],
  ["done", "Done"],
];

// The regions a module redraws whole, each with its own data-keys.
const FOCUS_REGIONS = "#rail, #panel, #header, #notice, #viewer, #questions-view, #overview, #inbox, #slot";

let rail;
let header;
let inbox;
let empty;
let search;
let archivedOpen = false;
let pickerOpenFor = null;

function selectIntent(intent) {
  store.emit("select-intent", { space: intent.space, intent: intent.record });
}

// ---- Rail -------------------------------------------------------------------

function renderRail() {
  const count = needsYouCount();
  const inboxLabel = count ? `Inbox · ${count} ${count === 1 ? "needs" : "need"} you` : "Inbox";
  const onInbox = store.view.kind === "inbox";
  rebuild(
    rail,
    el(
      "button",
      { type: "button", class: "logo", title: "AI-DLC Workflows · read-only", "aria-label": "AI-DLC Workflows, open the Inbox", "data-key": "logo", on: { click: openInbox } },
      "A",
    ),
    el(
      "button",
      {
        type: "button",
        class: onInbox ? "on" : null,
        title: inboxLabel,
        "aria-label": inboxLabel,
        "aria-current": onInbox ? "page" : null,
        "data-key": "inbox",
        on: { click: openInbox },
      },
      icon("mailInbox", { size: 18 }),
      count ? el("span", { class: "rail-badge", "aria-hidden": "true" }, String(count)) : null,
    ),
    el(
      "button",
      {
        type: "button",
        class: store.sidebar ? "on" : null,
        title: `Workflow · ${shortcut("\\")}`,
        "aria-label": "Workflow panel",
        "aria-pressed": String(store.sidebar),
        "aria-keyshortcuts": shortcutAria("\\"),
        "data-key": "workflow",
        on: { click: () => store.set({ sidebar: !store.sidebar }) },
      },
      icon("flowchart", { size: 18 }),
    ),
    el(
      "button",
      {
        type: "button",
        title: `Search or jump · ${shortcut("K")}`,
        "aria-label": "Search or jump",
        "aria-keyshortcuts": shortcutAria("K"),
        "data-key": "search",
        on: { click: () => store.emit("palette", "open") },
      },
      icon("search", { size: 18 }),
    ),
  );
}

// ---- Header -----------------------------------------------------------------

function viewTitle(view, stage) {
  const unit = view.unit ? ` · ${view.unit}` : "";
  switch (view.kind) {
    case "inbox":
      return "Inbox";
    case "files":
      return "All files";
    case "overview":
      return stage ? `${stage.name}${unit} · overview` : "Stage";
    case "document":
    case "questions":
      return basename(view.path);
    default:
      return "AI-DLC Workflows";
  }
}

function pathLine(view, workflow, stage) {
  const parts = [view.space ?? store.workspace?.space ?? "workspace"];
  if (view.kind !== "inbox" && workflow) {
    parts.push(workflow.label);
    if (stage) {
      parts.push(phaseOf(workflow, stage.slug)?.name ?? "", stage.name);
      if (view.unit) parts.push(view.unit);
    } else if (view.kind === "files") {
      parts.push("All files");
    }
  }
  const line = el("span", { class: "header-path" });
  parts.filter(Boolean).forEach((part, index) => {
    if (index > 0) line.append(el("i", { "aria-hidden": "true" }, "›"));
    line.append(part);
  });
  return line;
}

function pickerItems(view, stage) {
  if (!stage || !["overview", "document", "questions"].includes(view.kind)) return [];
  const owner = { stage: stage.slug, unit: view.unit };
  const { questions, artifacts } = filesOf(stage, view.unit);
  const items = [];
  if (questions) {
    items.push({ key: `q:${questions.path}`, label: "Questions", on: view.path === questions.path, open: () => openPath(questions.path, owner) });
  }
  for (const file of artifacts) {
    items.push({ key: `f:${file.path}`, label: file.name || basename(file.path), on: view.path === file.path, open: () => openPath(file.path, owner) });
  }
  const unit = view.unit ? ` · ${view.unit}` : "";
  items.push({ key: "overview", label: `${stage.name}${unit} · overview`, on: view.kind === "overview", open: () => openOverview(stage.slug, view.unit) });
  return items;
}

function titleNode(view, stage) {
  const title = viewTitle(view, stage);
  const items = pickerItems(view, stage);
  if (items.length === 0 || (items.length === 1 && items[0].on)) {
    return el("strong", { class: "header-title", title }, title);
  }
  const viewKey = JSON.stringify(view);
  const details = el("details", { class: "header-picker", open: pickerOpenFor === viewKey });
  details.addEventListener("toggle", () => {
    const redrawn = pickerOpenFor === viewKey;
    pickerOpenFor = details.open ? viewKey : null;
    // A redraw re-creates an open picker, which fires toggle again; only an
    // open the person made moves focus, and it goes to the file on screen.
    if (!details.open || redrawn) return;
    const target = details.querySelector(".header-picker-menu button.on") ?? details.querySelector(".header-picker-menu button");
    target?.focus({ preventScroll: true });
  });
  const menu = el(
    "div",
    { class: "header-picker-menu", "aria-label": "Files of this stage" },
    items.map((item) =>
      el(
        "button",
        {
          type: "button",
          class: item.on ? "on" : null,
          "aria-current": item.on ? "page" : null,
          "data-key": `picker:${item.key}`,
          on: {
            click: () => {
              pickerOpenFor = null;
              details.open = false;
              item.open();
            },
          },
        },
        item.label,
      ),
    ),
  );
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    const next = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  details.append(
    el(
      "summary",
      { title, "data-key": "picker" },
      el("span", { class: "header-picker-title" }, title),
      el("span", { class: "header-picker-caret", "aria-hidden": "true" }, icon("chevronDown", { size: 12 })),
    ),
    menu,
  );
  return details;
}

/**
 * The header sentence. The server words every one (model.ts owns them): the
 * Inbox's, each stage's, a team-mode unit's, each questions file's and the
 * intent's; sentenceText adds its time on this browser's clock. This only
 * picks the one for the view; a done stage of a finished intent reads as how
 * the intent ended ("Workflow complete").
 */
function viewSentence(view, workflow, stage) {
  if (view.kind === "inbox") return store.workspace?.sentence ?? null;
  if (view.kind === "empty") return null;
  if (!workflow) return { text: "Workflow unavailable", tone: "quiet" };
  const words = stage ? wordsFor(stage, view.unit) : null;
  if (view.kind === "questions") {
    if (store.questions?.path === view.path) return store.questions.sentence;
    return words?.sentence ?? workflow.sentence;
  }
  if (!words) return workflow.sentence;
  return finished(workflow) && words.word === "done" ? workflow.sentence : words.sentence;
}

function connectionDot() {
  const label = store.connected ? "Live: this page updates as files change" : "Paused: this page is not updating";
  return el("span", { class: ["connection", store.connected ? "connected" : "disconnected"], role: "img", "aria-label": label, title: label }, el("i"));
}

function panelButtons(view) {
  return panelsFor(view).map((key) => {
    const { label, icon: name } = PANELS[key];
    const on = store.panel === key;
    return el(
      "button",
      {
        type: "button",
        class: ["header-icon", on && "on"],
        title: label,
        "aria-label": label,
        "aria-pressed": String(on),
        "data-key": `panel:${key}`,
        on: { click: () => store.set({ panel: on ? null : key }) },
      },
      icon(name, { size: 17 }),
    );
  });
}

/** Navigation only: the header never offers an action that changes a file. */
function headerActions(view, workflow, stage) {
  if (!workflow || !stage || !["overview", "document", "questions"].includes(view.kind)) return [];
  const actions = [];
  const owner = { stage: stage.slug, unit: view.unit };
  const { questions, artifacts } = filesOf(stage, view.unit);
  const open = openAnswers(questions);
  if (view.kind !== "questions" && questions && open > 0) {
    actions.push({ key: "read-questions", label: `Read ${plural(open, "question", "questions")} →`, run: () => openPath(questions.path, owner) });
  } else if (view.kind !== "document" && artifacts.length > 0) {
    const first = artifacts[0];
    actions.push({ key: "open-file", label: `Open ${first.name || basename(first.path)}`, run: () => openPath(first.path, owner) });
  }
  const back = backTarget(workflow);
  if (back && (back.stage.slug !== stage.slug || (back.unit && back.unit !== view.unit))) {
    actions.push({ key: "back", label: `Back to ${back.label} →`, run: () => openView(back.view) });
  }
  return actions.map((action, index) =>
    el(
      "button",
      { type: "button", class: index === actions.length - 1 ? "btn primary" : "link", "data-key": `action:${action.key}`, on: { click: action.run } },
      action.label,
    ),
  );
}

function renderHeader() {
  const view = store.view;
  const workflow = workflowFor(view);
  const stage = view.stage ? findStage(workflow, view.stage) : null;
  const sentence = viewSentence(view, workflow, stage);
  const line = sentenceText(sentence);
  rebuild(
    header,
    el("nav", { class: "header-context", "aria-label": "Where you are" }, pathLine(view, workflow, stage), titleNode(view, stage)),
    el("div", { class: ["header-state", sentence?.tone ?? "quiet"] }, line ? el("b", { text: line, title: line }) : null),
    el("div", { class: "header-tools" }, connectionDot(), panelButtons(view), headerActions(view, workflow, stage)),
  );
}

// ---- Inbox --------------------------------------------------------------------

function intentWhere(intent) {
  return [phaseWord(known(intent.phase)), intent.current_stage_name].filter(Boolean).join(" · ");
}

function intentStatus(intent) {
  if (intent.needs) return intent.needs.label;
  if (intent.group === "in-progress") return "in progress";
  if (intent.group === "archived") return "archived";
  return "done";
}

function inboxRow(intent) {
  const where = intentWhere(intent);
  const meta = [known(intent.scope), known(intent.depth)?.toLowerCase(), relativeTime(intent.updated_at)].filter(Boolean).join(" · ");
  const viewing = store.workflow?.intent === intent.record && store.workflow?.space === intent.space;
  return el(
    "button",
    {
      type: "button",
      class: ["inbox-row", intent.group, viewing && "on"],
      title: intent.description || null,
      "data-key": `intent:${intent.record}`,
      on: { click: () => selectIntent(intent) },
    },
    el("span", { class: ["intent-dot", intent.group], "aria-hidden": "true" }),
    el(
      "span",
      { class: "inbox-main" },
      el("b", { text: intent.label }),
      where || meta ? el("small", null, where, meta ? el("em", null, where ? ` · ${meta}` : meta) : null) : null,
    ),
    el("span", { class: ["inbox-status", intent.needs && "needs"] }, intentStatus(intent)),
    el("span", { class: "inbox-go", "aria-hidden": "true" }, icon("chevronRight", { size: 14 })),
  );
}

function otherSpaces(workspace) {
  const others = (workspace.spaces ?? []).filter((space) => space.name !== workspace.space);
  if (others.length === 0) return null;
  return el(
    "p",
    { class: "inbox-spaces" },
    "Other spaces, view only: ",
    others.map((space, index) => [
      index > 0 ? ", " : null,
      el(
        "button",
        { type: "button", class: "link-inline", "data-key": `space:${space.name}`, on: { click: () => store.emit("select-space", space.name) } },
        space.needs_you ? `${space.name} · ${space.needs_you} ${space.needs_you === 1 ? "needs" : "need"} you` : space.name,
      ),
    ]),
  );
}

function renderInbox() {
  if (store.view.kind !== "inbox") return;
  const workspace = store.workspace;
  if (!workspace) {
    rebuild(inbox, placeholder("Inbox unavailable", "The workspace could not be read yet."));
    return;
  }
  const intents = workspace.intents ?? [];
  const heading = el(
    "header",
    { class: "inbox-heading" },
    el("h1", { text: "Inbox" }),
    el("span", { class: "inbox-tagline" }, `${plural(intents.length, "intent", "intents")}${workspace.space ? ` in ${workspace.space}` : ""}`),
    workspace.sentence ? el("b", { class: workspace.sentence.tone, text: sentenceText(workspace.sentence) }) : null,
  );
  const groups = GROUPS.map(([group, label]) => {
    const members = intents.filter((intent) => intent.group === group);
    if (members.length === 0) return null;
    return el(
      "section",
      { class: ["inbox-group", group === "needs-you" && "needs"] },
      el("h2", null, label, el("span", { class: "inbox-count", text: String(members.length) })),
      members.map(inboxRow),
    );
  });
  const archived = intents.filter((intent) => intent.group === "archived");
  const archivedGroup =
    archived.length > 0
      ? el(
          "section",
          { class: "inbox-group archived" },
          el(
            "button",
            {
              type: "button",
              class: "group-toggle",
              "aria-expanded": String(archivedOpen),
              "data-key": "archived",
              on: {
                click: () => {
                  archivedOpen = !archivedOpen;
                  renderInbox();
                },
              },
            },
            icon(archivedOpen ? "chevronDown" : "chevronRight", { size: 12 }),
            `Archived · ${archived.length}`,
          ),
          archivedOpen ? archived.map(inboxRow) : null,
        )
      : null;
  const body =
    intents.length === 0
      ? el(
          "div",
          { class: "inbox-empty" },
          icon("mailInbox", { size: 22 }),
          el("b", { text: "No intents yet" }),
          el("span", { class: "inbox-empty-line", text: "Start one where you run AI-DLC; it shows up here as soon as its folder exists." }),
        )
      : [groups, archivedGroup];
  rebuild(inbox, el("div", { class: "inbox-page" }, heading, otherSpaces(workspace), body));
}

// ---- Empty view ---------------------------------------------------------------

function renderEmpty() {
  if (store.view.kind !== "empty") return;
  rebuild(
    empty,
    store.problem
      ? placeholder("The Review UI could not read this workspace.", store.problem)
      : placeholder("Reading your workspace…", "The Review UI only reads; every action happens where you run AI-DLC."),
  );
}

// ---- Palette ------------------------------------------------------------------

let palette = null;

function paletteItems() {
  const items = [];
  const workspace = store.workspace;
  const workflow = store.workflow;
  for (const intent of workspace?.intents ?? []) {
    const where = intentWhere(intent);
    items.push({ group: "Intents", label: intent.label, meta: [where, intentStatus(intent)].filter(Boolean).join(" · "), run: () => selectIntent(intent) });
  }
  for (const stage of allStages(workflow).filter(inPlan)) {
    items.push({ group: "Stages", label: stage.name, meta: `${phaseOf(workflow, stage.slug)?.name ?? ""} · ${stage.label}`, run: () => openOverview(stage.slug) });
  }
  for (const stage of allStages(workflow)) {
    for (const { unit, files } of fileScopes(stage)) {
      const where = unit ? `${stage.name} · ${unit}` : stage.name;
      const owner = { stage: stage.slug, unit };
      if (files.questions) {
        items.push({ group: "Files", label: basename(files.questions.path), meta: `${where} · questions`, run: () => openPath(files.questions.path, owner) });
      }
      for (const file of files.artifacts) {
        items.push({ group: "Files", label: file.name || basename(file.path), meta: where, run: () => openPath(file.path, owner) });
      }
      if (files.diary) {
        items.push({ group: "Files", label: basename(files.diary.path), meta: `${where} · diary`, run: () => openPath(files.diary.path, owner) });
      }
    }
  }
  items.push({ group: "Actions", label: "Open Inbox", meta: "What needs you", run: openInbox });
  items.push({ group: "Actions", label: store.sidebar ? "Hide Workflow" : "Show Workflow", meta: shortcut("\\"), run: () => store.set({ sidebar: !store.sidebar }) });
  if (workflow) items.push({ group: "Actions", label: "All files", meta: workflow.label, run: openFiles });
  for (const key of panelsFor(store.view)) {
    if (store.panel !== key) items.push({ group: "Actions", label: `Show ${PANELS[key].label}`, meta: "Right panel", run: () => store.set({ panel: key }) });
  }
  for (const space of workspace?.spaces ?? []) {
    if (space.name === workspace.space) continue;
    items.push({ group: "Actions", label: `Switch to space ${space.name}`, meta: `${plural(space.intents, "intent", "intents")} · view only`, run: () => store.emit("select-space", space.name) });
  }
  return items;
}

function renderResults() {
  const { input, results } = palette;
  const query = input.value.trim().toLowerCase();
  palette.matches = palette.items.filter((item) => !query || `${item.label} ${item.meta} ${item.group}`.toLowerCase().includes(query));
  palette.index = Math.min(palette.index, Math.max(0, palette.matches.length - 1));
  if (palette.matches.length === 0) {
    results.replaceChildren(el("p", { class: "palette-empty" }, "No matching destination"));
    input.removeAttribute("aria-activedescendant");
    return;
  }
  const groups = new Map();
  palette.matches.forEach((item, index) => {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push([item, index]);
  });
  results.replaceChildren(
    ...[...groups].map(([group, members], groupIndex) =>
      el(
        "div",
        { class: "palette-group", role: "group", "aria-labelledby": `palette-group-${groupIndex}` },
        el("h2", { id: `palette-group-${groupIndex}`, text: group }),
        members.map(([item, index]) =>
          el(
            "div",
            {
              id: `palette-option-${index}`,
              class: ["palette-option", index === palette.index && "on"],
              role: "option",
              "aria-selected": String(index === palette.index),
              on: {
                click: () => runItem(index),
                mousemove: () => {
                  if (palette && palette.index !== index) moveTo(index);
                },
              },
            },
            el("span", { class: "palette-label", text: item.label }),
            item.meta ? el("small", { class: "palette-meta", text: item.meta }) : null,
          ),
        ),
      ),
    ),
  );
  input.setAttribute("aria-activedescendant", `palette-option-${palette.index}`);
}

function moveTo(index) {
  const { results, input } = palette;
  palette.index = index;
  for (const option of results.querySelectorAll(".palette-option")) {
    const on = option.id === `palette-option-${index}`;
    option.classList.toggle("on", on);
    option.setAttribute("aria-selected", String(on));
    if (on) option.scrollIntoView({ block: "nearest" });
  }
  input.setAttribute("aria-activedescendant", `palette-option-${index}`);
}

function runItem(index) {
  const item = palette?.matches[index];
  closePalette();
  item?.run();
}

function openPalette() {
  if (palette) return;
  const input = el("input", {
    type: "search",
    placeholder: "Search intents, stages, files, actions…",
    "aria-label": "Search or jump",
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": "palette-results",
    "aria-autocomplete": "list",
    autocomplete: "off",
    spellcheck: "false",
  });
  const results = el("div", { id: "palette-results", class: "palette-results", role: "listbox", "aria-label": "Destinations" });
  // Clicking a result must not take focus from the input.
  results.addEventListener("mousedown", (event) => event.preventDefault());
  // Data-keys repeat across regions (space:<name> is in the Inbox and the
  // popover), so a live redraw's successor is found by key within the region.
  const restore = document.activeElement;
  const region = restore instanceof Element ? restore.closest(FOCUS_REGIONS) : null;
  const restoreKey = restore instanceof Element ? (restore.closest("[data-key]")?.getAttribute("data-key") ?? null) : null;
  palette = { input, results, items: paletteItems(), matches: [], index: 0, restore, region, restoreKey };
  input.addEventListener("input", () => {
    palette.index = 0;
    renderResults();
  });
  input.addEventListener("keydown", (event) => {
    const count = palette.matches.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count > 0) moveTo((palette.index + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (count > 0) runItem(palette.index);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "Tab") {
      // The dialog is modal: focus stays in its one field.
      event.preventDefault();
    }
  });
  search.replaceChildren(
    el(
      "div",
      { class: "palette-box", role: "dialog", "aria-modal": "true", "aria-label": "Search or jump" },
      el("label", { class: "palette-field" }, icon("search", { size: 18 }), input, el("kbd", { text: shortcut("K") })),
      results,
      el(
        "footer",
        null,
        el("span", { text: "↑↓ move" }),
        el("span", { text: "↵ open" }),
        el("span", { text: "esc close" }),
        el("b", { text: "Read-only: every action happens where you run AI-DLC." }),
      ),
    ),
  );
  search.hidden = false;
  renderResults();
  input.focus();
}

function closePalette() {
  if (!palette) return;
  const { restore, region, restoreKey } = palette;
  palette = null;
  search.hidden = true;
  search.replaceChildren();
  if (restore instanceof HTMLElement && restore.isConnected) {
    restore.focus({ preventScroll: true });
    return;
  }
  // A live redraw replaced what had focus: its successor, else the rail's
  // Search button. focusKey finds a hidden element too, which takes no focus.
  if (region && restoreKey) focusKey(region, restoreKey);
  if (document.activeElement === document.body) focusKey(rail, "search");
}

// ---- Wiring -------------------------------------------------------------------

export function init() {
  rail = document.getElementById("rail");
  header = document.getElementById("header");
  inbox = document.getElementById("inbox");
  empty = document.getElementById("empty");
  search = document.getElementById("search");

  search.addEventListener("click", (event) => {
    if (event.target === search) closePalette();
  });
  document.addEventListener("click", (event) => {
    const picker = header.querySelector(".header-picker[open]");
    if (picker && !event.composedPath().includes(picker)) {
      pickerOpenFor = null;
      picker.open = false;
    }
  });
  header.addEventListener("keydown", (event) => {
    const picker = header.querySelector(".header-picker[open]");
    if (event.key === "Escape" && picker) {
      pickerOpenFor = null;
      picker.open = false;
      picker.querySelector("summary")?.focus();
    }
  });

  store.on("palette", (mode) => {
    if (mode === "close" || (mode === "toggle" && palette)) closePalette();
    else openPalette();
  });
  store.on("workspace", () => {
    renderRail();
    renderHeader();
    renderInbox();
  });
  store.on("workflow", () => {
    renderHeader();
    renderInbox();
  });
  store.on("view", () => {
    renderRail();
    renderHeader();
    renderInbox();
    renderEmpty();
  });
  store.on("questions", renderHeader);
  // A read says whether a file no listing named is Markdown, which decides its Outline button.
  store.on("document", renderHeader);
  store.on("panel", renderHeader);
  store.on("connected", renderHeader);
  store.on("sidebar", renderRail);
  store.on("problem", renderEmpty);
  renderRail();
  renderHeader();
  renderEmpty();
}
