// The right-hand panel: Outline (the open document's headings) and Decisions
// (the audit record's questions, answers and approvals, newest first). Both
// only read; a review entry opens its file in the reader.

import { get } from "./api.js";
import { icon } from "./icons.js";
import { basename, el, formatDay, formatTime, openPath, plural, store } from "./store.js";

// Chip words per DecisionKind. The colours live in panels.css: approvals and
// requested changes green, question rounds amber, the rest neutral.
const CHIPS = {
  asked: "asked",
  answered: "question round",
  reply: "your reply",
  approved: "approved",
  "changes-requested": "changes requested",
  "gate-opened": "gate opened",
  revising: "revising",
  skipped: "skipped",
  "plan-approval-skipped": "plan approval skipped",
  review: "review",
};

let slot;
let filter = "stage";
let decisions = { key: null, payload: null, error: null, loading: false };
let token = 0;

/** Closes the panel and gives focus back to the header button that opens it. */
function closePanel() {
  const kind = store.panel;
  store.set({ panel: null });
  if (kind) document.querySelector(`#header [data-key="panel:${kind}"]`)?.focus({ preventScroll: true });
}

function header(titleId, title, detail, closeLabel, extra = null) {
  return el(
    "header",
    { class: "side-panel-header" },
    el(
      "div",
      null,
      el("h2", { id: titleId, text: title }),
      el("span", { class: "side-panel-detail", text: detail ?? "" }),
      el(
        "button",
        { type: "button", class: "side-panel-close", "aria-label": closeLabel, title: closeLabel, "data-key": "panel-close", on: { click: closePanel } },
        icon("dismiss", { size: 14 }),
      ),
    ),
    extra,
  );
}

function empty(title, line) {
  return el("p", { class: "side-panel-empty" }, el("b", { text: title }), line);
}

/** Redraws the slot, keeping its scroll when the same panel is drawn again. */
function show(kind, section) {
  const previous = slot.querySelector(".side-panel-body");
  const keep = slot.dataset.panel === kind && previous ? previous.scrollTop : 0;
  const active = document.activeElement;
  const key = active instanceof Element && slot.contains(active) ? active.getAttribute("data-key") : null;
  slot.dataset.panel = kind;
  slot.replaceChildren(section);
  const body = slot.querySelector(".side-panel-body");
  if (body) body.scrollTop = keep;
  if (key) slot.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

// ---- Outline -------------------------------------------------------------------

function renderOutline() {
  const view = store.view;
  const payload = store.document?.path === view.path ? store.document : null;
  const failed = store.documentError?.path === view.path ? store.documentError : null;
  const items = payload?.outline ?? [];
  const body = !payload
    ? failed
      ? empty("No outline available.", failed.message)
      : empty("Reading the document…", null)
    : items.length === 0
      ? empty("No outline available.", "This document has no headings.")
      : el(
          "nav",
          { class: "outline-list", "aria-label": "Headings" },
          items.map((item) =>
            el(
              "button",
              {
                type: "button",
                class: ["outline-heading", `level-${Math.min(Math.max(item.level, 1), 6)}`],
                title: item.text,
                "data-key": `outline:${item.id}`,
                on: { click: () => store.emit("scroll-to", item.id) },
              },
              el("span", { class: "outline-text", text: item.text }),
            ),
          ),
        );
  show(
    "outline",
    el(
      "section",
      { class: "outline-panel", "aria-labelledby": "outline-title" },
      header("outline-title", "Outline", basename(view.path), "Close outline"),
      el("div", { class: "side-panel-body" }, body),
    ),
  );
}

// ---- Decisions -------------------------------------------------------------------

function query() {
  const view = store.view;
  const byStage = filter === "stage" && Boolean(view.stage);
  return { space: view.space, intent: view.intent, stage: byStage ? view.stage : null, unit: byStage ? view.unit : null };
}

async function loadDecisions(quiet) {
  const params = query();
  const key = JSON.stringify(params);
  const mine = ++token;
  decisions = { key, payload: quiet && decisions.key === key ? decisions.payload : null, error: null, loading: true };
  if (!quiet && store.panel === "decisions") renderDecisions();
  try {
    const payload = await get("/api/decisions", params);
    if (mine !== token) return;
    decisions = { key, payload, error: null, loading: false };
  } catch (error) {
    if (mine !== token) return;
    decisions = { key, payload: null, error: error.message, loading: false };
  }
  if (store.panel === "decisions") renderDecisions();
}

function dayGroups(entries) {
  const groups = [];
  for (const entry of entries) {
    const label = formatDay(entry.at);
    const last = groups.at(-1);
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

function entryNode(entry) {
  const where = [entry.stage_name || entry.stage, entry.unit].filter(Boolean).join(" · ");
  const parts = [
    el(
      "span",
      { class: "history-entry-title" },
      el("b", { text: entry.title }),
      entry.at ? el("time", { datetime: entry.at, text: formatTime(entry.at) }) : null,
    ),
    filter === "all" || entry.unit ? el("span", { class: "history-entry-detail", text: where }) : null,
    entry.question ? el("span", { class: "history-entry-question", text: entry.question }) : null,
    entry.summary ? el("span", { class: "history-entry-summary", text: entry.summary }) : null,
    el(
      "span",
      { class: "history-entry-meta" },
      el("span", { class: ["decision-chip", entry.kind], text: CHIPS[entry.kind] ?? entry.kind }),
      entry.order_unknown ? el("span", { class: "history-entry-note", text: "order not known" }) : null,
    ),
  ];
  if (entry.path) {
    return el(
      "button",
      { type: "button", class: "history-entry", title: `Open ${basename(entry.path)}`, "data-key": `decision:${entry.path}`, on: { click: () => openPath(entry.path) } },
      parts,
    );
  }
  return el("div", { class: "history-entry" }, parts);
}

function segment() {
  const hasStage = Boolean(store.view.stage);
  const option = (value, label) => {
    const on = (hasStage ? filter : "all") === value;
    return el(
      "button",
      {
        type: "button",
        class: on ? "on" : null,
        "aria-pressed": String(on),
        disabled: value === "stage" && !hasStage,
        "data-key": `filter:${value}`,
        on: {
          click: () => {
            if (filter === value) return;
            filter = value;
            loadDecisions(false);
          },
        },
      },
      label,
    );
  };
  return el("div", { class: "decisions-filter" }, el("span", { class: "history-segment", role: "group", "aria-label": "Show decisions for" }, option("stage", "This stage"), option("all", "All")));
}

function renderDecisions() {
  const params = query();
  if (decisions.key !== JSON.stringify(params)) {
    loadDecisions(false);
    return;
  }
  const entries = decisions.payload?.entries ?? [];
  const notes = (decisions.payload?.notes ?? []).map((note) => el("p", { class: "side-panel-note", text: note }));
  let body;
  if (decisions.error) body = empty("Decisions are not available right now.", decisions.error);
  else if (!decisions.payload) body = empty("Reading the audit record…", null);
  else if (entries.length === 0) {
    body = empty("No decisions yet.", "Approvals, requested changes and answers appear here as the audit records them.");
  } else {
    body = dayGroups(entries).map((group) =>
      el(
        "section",
        { class: "decisions-day" },
        el("h3", { text: group.label }),
        group.entries.map(entryNode),
      ),
    );
  }
  show(
    "decisions",
    el(
      "section",
      { class: "decisions-panel", "aria-labelledby": "decisions-title" },
      header("decisions-title", "Decisions", decisions.payload ? `· ${plural(entries.length, "entry", "entries")}` : null, "Close decisions", segment()),
      el("div", { class: "side-panel-body" }, notes, body),
    ),
  );
}

// ---- Wiring ----------------------------------------------------------------------

function render() {
  if (store.panel === "outline") renderOutline();
  else if (store.panel === "decisions") renderDecisions();
  else {
    slot.removeAttribute("data-panel");
    slot.replaceChildren();
  }
}

export function init() {
  slot = document.getElementById("slot");
  store.on("panel", (panel) => {
    if (panel === "decisions") {
      filter = store.view.stage ? "stage" : "all";
      // Pushes re-read Decisions only while it is open, so opening it reads
      // the audit again; the last timeline for the same filter shows meanwhile.
      loadDecisions(true);
    }
    render();
  });
  store.on("view", render);
  store.on("workflow", () => {
    if (store.panel === "decisions") renderDecisions();
  });
  store.on("document", () => {
    if (store.panel === "outline") renderOutline();
  });
  // store.set emits once per changed key, and a failed read changes only this one.
  store.on("documentError", () => {
    if (store.panel === "outline") renderOutline();
  });
  store.on("refresh", () => {
    if (store.panel === "decisions") loadDecisions(true);
  });
  slot.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });
}
