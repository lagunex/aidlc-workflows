// Review UI bootstrap. It loads the workspace and the intent on screen, reads
// them again whenever the server says files changed, shows the region the
// view names, and hands every other region to its module. Modules share state
// only through store.js.

import { connectSocket, get } from "./api.js";
import { init as initDocument } from "./document.js";
import { icon } from "./icons.js";
import { init as initPanels } from "./panels.js";
import { init as initQuestions } from "./questions.js";
import { init as initShell } from "./shell.js";
import { currentThingView, el, IS_MAC, inboxView, panelsFor, rebuild, setNotice, store } from "./store.js";
import { init as initWorkflow } from "./workflow.js";

const BASE_TITLE = "AI-DLC Workflows · read-only";

// The region of #main each view kind fills.
const REGIONS = {
  document: "viewer",
  questions: "questions-view",
  overview: "overview",
  files: "overview",
  inbox: "inbox",
  empty: "empty",
};

// Below 1080px the right-hand panel closes when the window narrows (app.css's
// 1079px rule lays it over the document); below 900px the workflow panel
// starts hidden, a first state only, with no CSS rule of its own.
const NARROW_SLOT = "(max-width: 1079px)";
const NARROW_PANEL = "(max-width: 899px)";

// The line under the header that is on screen, as setNotice emitted it.
let noticeShown = null;

/** Shows a failed read's sentence; a network failure (status 0) ends when the page reconnects. */
function showFailure(error, prefix = "", refresh = false) {
  setNotice(`${prefix}${error.message}`, "error", { offline: error.status === 0, refresh });
}

function showRegion(view) {
  const target = REGIONS[view.kind] ?? "empty";
  for (const id of new Set(Object.values(REGIONS))) {
    const node = document.getElementById(id);
    if (node) node.hidden = id !== target;
  }
}

function updateTitle() {
  document.title = store.workflow?.needs ? `(1) ${BASE_TITLE}` : BASE_TITLE;
}

function onShortcut(event) {
  const command = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command || event.altKey || event.shiftKey) return;
  if (event.key.toLowerCase() === "k") {
    event.preventDefault();
    store.emit("palette", "toggle");
  } else if (event.key === "\\") {
    event.preventDefault();
    store.set({ sidebar: !store.sidebar });
  }
}

function wireChrome() {
  const app = document.getElementById("app");
  const body = document.getElementById("body");
  const slot = document.getElementById("slot");
  const notice = document.getElementById("notice");
  const paused = document.getElementById("paused-overlay");
  let noticeTimer = null;

  store.on("notice", (value) => {
    window.clearTimeout(noticeTimer);
    noticeShown = value;
    if (!value) {
      notice.hidden = true;
      notice.replaceChildren();
      return;
    }
    const info = value.kind === "info";
    notice.className = `notice ${info ? "info" : "error"}`;
    rebuild(
      notice,
      el("span", { class: "notice-text", text: value.message }),
      info
        ? null
        : el(
            "button",
            { type: "button", class: "notice-close", title: "Dismiss", "aria-label": "Dismiss this message", "data-key": "notice-close", on: { click: () => setNotice(null) } },
            icon("dismiss", { size: 12 }),
          ),
    );
    notice.hidden = false;
    if (info) noticeTimer = window.setTimeout(() => setNotice(null), 6000);
  });
  // The paused overlay says the server is unreachable; an error that came of
  // that outage goes with it.
  store.on("connected", (live) => {
    if (live && noticeShown?.offline) setNotice(null);
  });
  store.on("paused", (message) => {
    paused.textContent = message ?? "";
    paused.hidden = !message;
  });
  store.on("sidebar", (visible) => app.classList.toggle("panel-hidden", !visible));
  store.on("panel", (panel) => {
    slot.hidden = !panel;
    body.classList.toggle("slot-hidden", !panel);
  });
  const closeUnoffered = () => {
    if (store.panel && !panelsFor(store.view).includes(store.panel)) store.set({ panel: null });
  };
  store.on("view", (view) => {
    showRegion(view);
    closeUnoffered();
  });
  // A file no listing named keeps the Outline until it is read; the read says
  // whether it is Markdown.
  store.on("document", closeUnoffered);
  store.on("workflow", updateTitle);
  document.addEventListener("keydown", onShortcut);
  window.matchMedia(NARROW_SLOT).addEventListener("change", (event) => {
    if (event.matches && store.panel) store.set({ panel: null });
  });
}

// ---- Loading -----------------------------------------------------------------

// Bumped by every switch of intent or space, so a slower read that started
// before the switch never overwrites what the person chose.
let generation = 0;

async function loadWorkspace(space) {
  try {
    return await get("/api/workspace", { space });
  } catch (error) {
    // A space that has gone falls back to the server's default one.
    if (space && error.status === 400) return get("/api/workspace");
    throw error;
  }
}

function listed(workspace, record) {
  return Boolean(record) && workspace.intents.some((intent) => intent.record === record);
}

/**
 * The workspace, its first intent's workflow and the view to open on (`next`),
 * and the error of the workflow read when it failed (`failure`), which the
 * caller shows once what it read is on screen.
 */
async function opening(space) {
  const workspace = await loadWorkspace(space);
  const record = listed(workspace, workspace.selected_intent) ? workspace.selected_intent : null;
  let workflow = null;
  let failure = null;
  if (record) {
    try {
      workflow = await get("/api/workflow", { space: workspace.space, intent: record });
    } catch (error) {
      failure = error;
    }
  }
  return { next: { workspace, workflow, view: workflow ? currentThingView(workflow) : inboxView(workspace, null) }, failure };
}

async function start() {
  const token = generation;
  try {
    const { next, failure } = await opening(null);
    if (token !== generation) return;
    store.set({ ...next, problem: null });
    if (failure) showFailure(failure);
  } catch (error) {
    if (token === generation) store.set({ problem: error.message, view: { ...store.view, kind: "empty" } });
  }
}

async function refreshOnce() {
  if (!store.workspace) {
    await start();
    return;
  }
  const token = generation;
  const before = store.workflow;
  const shown = store.workspace;
  let workspace;
  try {
    workspace = await loadWorkspace(shown.space);
  } catch (error) {
    showFailure(error, "", true);
    return;
  }
  let workflow = null;
  let failed = false;
  if (before && workspace.space === before.space && listed(workspace, before.intent)) {
    try {
      workflow = await get("/api/workflow", { space: workspace.space, intent: before.intent });
    } catch (error) {
      showFailure(error, "", true);
      failed = true;
      workflow = before;
    }
  }
  // A switch of intent or space that began or landed while this read ran
  // makes it about what is no longer on screen: read again for what is.
  if (token !== generation || store.workflow !== before || store.workspace !== shown) {
    again = true;
    return;
  }
  const patch = { workspace, workflow, problem: null };
  if (before && !workflow) {
    setNotice(`${before.label} is no longer in this workspace.`, "info");
    patch.view = inboxView(workspace, null);
  } else if (before && workflow && before.current_stage !== workflow.current_stage && store.view.kind !== "inbox") {
    // The intent moved to another stage: take the person to it, once. The
    // Inbox stays put; it is where they look across intents.
    patch.view = currentThingView(workflow);
  }
  store.set(patch);
  if (!failed && noticeShown?.refresh) setNotice(null);
  store.emit("refresh");
}

let refreshing = null;
let again = false;
// How many reads refresh() was asked for, so a switch that ran while a push
// came can read once more after it lands.
let requested = 0;

/** Reads everything on screen again; calls made while one runs fold into one more. */
function refresh() {
  requested += 1;
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      again = false;
      await refreshOnce();
    } while (again);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** After a switch lands: reads again if a push came while it read, since what it read may predate it. */
function caughtUp(asked) {
  if (requested !== asked) refresh();
}

async function selectIntent({ space, intent }) {
  const token = ++generation;
  const asked = requested;
  try {
    const other = space && space !== store.workspace?.space ? await loadWorkspace(space) : null;
    const where = other?.space ?? store.workspace?.space;
    if (!where) return;
    const workflow = await get("/api/workflow", { space: where, intent });
    if (token !== generation) return;
    // In the same space the workspace is the one on screen when this lands,
    // which a refresh may have read again since the click.
    store.set({ workspace: other ?? store.workspace, workflow, view: currentThingView(workflow) });
    setNotice(null);
    caughtUp(asked);
  } catch (error) {
    if (token === generation) showFailure(error, "Could not open that intent: ");
  }
}

async function selectSpace(space) {
  const token = ++generation;
  const asked = requested;
  try {
    const { next, failure } = await opening(space);
    if (token !== generation) return;
    store.set(next);
    if (failure) showFailure(failure);
    else setNotice(null);
    caughtUp(asked);
  } catch (error) {
    if (token === generation) showFailure(error, "Could not open that space: ");
  }
}

function boot() {
  wireChrome();
  initShell();
  initWorkflow();
  initDocument();
  initQuestions();
  initPanels();
  store.on("select-intent", selectIntent);
  store.on("select-space", selectSpace);
  store.set({ sidebar: !window.matchMedia(NARROW_PANEL).matches });
  showRegion(store.view);
  updateTitle();
  refresh();
  connectSocket(refresh);
}

boot();
