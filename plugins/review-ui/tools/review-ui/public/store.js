// The app's shared state and its change events, plus the small helpers every
// view module needs (building nodes, finding stages and files, formatting
// times, naming views), so no view module imports another one. The wire
// shapes are the server's, typed in ../types.ts.

const listeners = new Map();
const snapshots = new Map();

function serialise(value) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text;
}

export const store = {
  /** GET /api/workspace for the space on screen. */
  workspace: null,
  /** GET /api/workflow for the intent on screen, or null. */
  workflow: null,
  /** What the main column shows: kind is empty, inbox, overview, files, document or questions. */
  view: { kind: "empty", space: null, intent: null, stage: null, unit: null, path: null },
  /** The right-hand panel: "outline", "decisions" or null. */
  panel: null,
  /** Whether the workflow panel is shown. */
  sidebar: true,
  /** GET /api/render for the open document, or null. */
  document: null,
  /** When the open document could not be read: {path, message} with the server's sentence; else null. */
  documentError: null,
  /** GET /api/questions for the open questions file, or null. */
  questions: null,
  /** The live socket is open. */
  connected: false,
  /** The server's sentence when the workspace could not be read at all. */
  problem: null,

  /**
   * Takes each key whose value differs structurally (compared as serialised
   * JSON) from what the store holds, then emits one event per changed key.
   * An identical payload from a live refresh therefore redraws nothing.
   */
  set(partial) {
    const changed = [];
    for (const [key, value] of Object.entries(partial)) {
      const next = serialise(value);
      const previous = snapshots.has(key) ? snapshots.get(key) : serialise(store[key]);
      if (previous === next) continue;
      snapshots.set(key, next);
      store[key] = value;
      changed.push(key);
    }
    for (const key of changed) store.emit(key, store[key]);
  },

  /** Subscribes to a key or event; returns the unsubscribe function. */
  on(key, listener) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(listener);
    return () => listeners.get(key)?.delete(listener);
  },

  emit(key, payload) {
    for (const listener of listeners.get(key) ?? []) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[review-ui] a listener for "${key}" failed`, error);
      }
    }
  },
};

/**
 * Shows a line under the header, or clears it with null. An "info" line hides
 * itself; an error stays until it is dismissed or ends: `offline` marks one
 * the server being unreachable caused, which ends when the page reconnects,
 * and `refresh` one a live re-read hit, which ends when a re-read succeeds.
 */
export function setNotice(message, kind = "error", { offline = false, refresh = false } = {}) {
  store.emit("notice", message ? { message, kind, offline, refresh } : null);
}

// ---- Keyboard ---------------------------------------------------------------

const platform = navigator.userAgentData?.platform || navigator.platform || "";

/** macOS and iOS use the Command key for shortcuts; everything else uses Ctrl. */
export const IS_MAC = /mac|iphone|ipad/i.test(platform);

/** How a shortcut reads on this platform, e.g. "⌘K" or "Ctrl+K". */
export function shortcut(key) {
  return IS_MAC ? `⌘${key}` : `Ctrl+${key}`;
}

/** The aria-keyshortcuts value for the same shortcut. */
export function shortcutAria(key) {
  return IS_MAC ? `Meta+${key}` : `Control+${key}`;
}

export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---- DOM ------------------------------------------------------------------

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === "") continue;
    if (Array.isArray(child)) append(node, child);
    else if (child instanceof Node) node.append(child);
    else node.append(document.createTextNode(String(child)));
  }
}

// The page's CSP refuses inline styles and handlers, and document.js is the one
// place HTML becomes nodes, so the builder takes no attribute that would set them.
const REFUSED_ATTRIBUTE = /^(?:style|srcdoc|on.+)$/i;

/**
 * Builds an element. `attrs` takes "class" (a string or a list), "text",
 * "dataset", "on" (event name to handler) and plain attributes; true means
 * a boolean attribute, and null, undefined or false leaves it off. A style,
 * srcdoc or on... attribute throws. Children are nodes, strings or lists of
 * them.
 */
export function el(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") {
      node.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : String(value);
    } else if (name === "text") {
      node.textContent = String(value);
    } else if (name === "dataset") {
      for (const [key, data] of Object.entries(value)) {
        if (data !== null && data !== undefined) node.dataset[key] = String(data);
      }
    } else if (name === "on") {
      for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    } else if (REFUSED_ATTRIBUTE.test(name)) {
      throw new Error(`el() does not set a ${name} attribute`);
    } else {
      node.setAttribute(name, value === true ? "" : String(value));
    }
  }
  append(node, children);
  return node;
}

/**
 * Replaces a container's children, keeping its scroll position and, when
 * focus was inside it, moving focus to the new element with the same
 * data-key, so a live refresh never throws the reader's place away.
 */
export function rebuild(container, ...children) {
  const active = document.activeElement;
  const key =
    active instanceof Element && container.contains(active) ? (active.closest("[data-key]")?.getAttribute("data-key") ?? null) : null;
  const top = container.scrollTop;
  container.replaceChildren();
  append(container, children);
  container.scrollTop = top;
  if (key !== null) focusKey(container, key);
}

/** Focuses the element with this data-key inside `container`; true when found. */
export function focusKey(container, key) {
  const target = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!(target instanceof HTMLElement)) return false;
  target.focus({ preventScroll: true });
  return true;
}

/** The centred "title and one line" state used by empty and failed views. */
export function placeholder(title, line, className = "placeholder") {
  return el("div", { class: className }, el("b", { text: title }), line ? el("span", { text: line }) : null);
}

// ---- Words and times ----------------------------------------------------------

export function basename(path) {
  return (
    String(path ?? "")
      .split("/")
      .filter(Boolean)
      .pop() ?? ""
  );
}

/**
 * A Lifecycle Phase, which the state file writes as one upper-case word, as
 * the server titles phases: "CONSTRUCTION" reads "Construction". Stage and
 * phase names come from the server (WorkflowStage.name, WorkflowPhase.name,
 * IntentSummary.current_stage_name), so nothing else is title-cased here;
 * anything but one word is shown as written.
 */
export function phaseWord(value) {
  const text = String(value ?? "");
  return /^[A-Za-z]+$/.test(text) ? `${text.charAt(0).toUpperCase()}${text.slice(1).toLowerCase()}` : text;
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** A value the server reports as unknown reads as absent. */
export function known(value) {
  return value && value !== "unknown" ? value : null;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "09:10", 24-hour local time. */
export function formatTime(value) {
  const date = toDate(value);
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";
}

/**
 * A server header line as shown: its words, then its time (StatusSentence.at)
 * on this browser's clock, the one every other time on the page uses:
 * "Done · 09:10".
 */
export function sentenceText(sentence) {
  if (!sentence) return "";
  const time = formatTime(sentence.at);
  return time ? `${sentence.text} · ${time}` : sentence.text;
}

function dayMonth(date, now) {
  const options = { day: "numeric", month: "short" };
  if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
  return date.toLocaleDateString("en-GB", options);
}

/** A day heading: "Today · 21 Oct", "Yesterday · 20 Oct" or "Mon · 19 Oct". */
export function formatDay(value) {
  const date = toDate(value);
  if (!date) return "Time not recorded";
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, now)) return `Today · ${dayMonth(date, now)}`;
  if (sameDay(date, yesterday)) return `Yesterday · ${dayMonth(date, now)}`;
  return `${date.toLocaleDateString("en-GB", { weekday: "short" })} · ${dayMonth(date, now)}`;
}

/** "today at 09:10", "yesterday at 09:10" or "on 19 Oct at 09:10". */
export function formatWhen(value) {
  const date = toDate(value);
  if (!date) return "";
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const time = formatTime(date);
  if (sameDay(date, now)) return `today at ${time}`;
  if (sameDay(date, yesterday)) return `yesterday at ${time}`;
  return `on ${dayMonth(date, now)} at ${time}`;
}

/** "just now", "4 min ago", "2 hr ago", "3 days ago". */
export function relativeTime(value) {
  const date = toDate(value);
  if (!date) return "";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return plural(Math.round(hours / 24), "day ago", "days ago");
}

export function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- Stages and files -------------------------------------------------------

/** Every stage of a workflow payload, in plan order. */
export function allStages(workflow) {
  return (workflow?.phases ?? []).flatMap((phase) => phase.stages ?? []);
}

export function findStage(workflow, slug) {
  if (!slug) return null;
  return allStages(workflow).find((stage) => stage.slug === slug) ?? null;
}

/** The stage the state file names as current; null for a finished intent. */
export function currentStage(workflow) {
  return allStages(workflow).find((stage) => stage.is_current) ?? null;
}

export function phaseOf(workflow, slug) {
  return (workflow?.phases ?? []).find((phase) => (phase.stages ?? []).some((stage) => stage.slug === slug)) ?? null;
}

/** False for the stages this plan leaves out, which the tree folds per phase. */
export function inPlan(stage) {
  return stage.word !== "not-in-plan";
}

/** An archived or completed intent: nothing in it waits on the person. */
export function finished(workflow) {
  return workflow?.status === "archived" || workflow?.status === "completed";
}

/**
 * What a questions file still waits for (QuestionsSummary.open_answers): open
 * questions plus open confirmation, approval and change-request sections, the
 * count the server's Needs you uses.
 */
export function openAnswers(questions) {
  return questions?.open_answers ?? 0;
}

/** A unit of the stage whose own cell awaits the person's review, or null. */
export function unitAwaiting(stage) {
  return (stage?.units ?? []).find((entry) => entry.word === "in-review") ?? null;
}

/**
 * A stage as one of its units reads it. In team mode a unit has its own cell
 * in the Unit Progress table, so while that unit is shown its word, label and
 * header line stand in for the stage's, and `unit` names it. The unit's
 * revision is only in its label, so `revision` is null; a done unit's time is
 * its header line's. Without a cell the stage's own words stand.
 */
export function wordsFor(stage, unit) {
  const entry = stage && unit ? (stage.units ?? []).find((each) => each.unit === unit) : null;
  if (!entry?.word) return stage;
  return {
    ...stage,
    word: entry.word,
    label: entry.label ?? stage.label,
    sentence: entry.sentence ?? stage.sentence,
    revision: null,
    decided_at: entry.word === "done" ? (entry.sentence?.at ?? null) : null,
    unit: entry.unit,
  };
}

/**
 * Where the intent's work stands, as {stage, unit}: Current Stage when it
 * waits on the person, else a unit whose review gate does (the Inbox's
 * "Review approval gate"), else Current Stage; null for a finished intent.
 */
export function currentPlace(workflow) {
  const current = currentStage(workflow);
  if (current && (current.word === "in-review" || current.word === "questions")) return { stage: current, unit: null };
  for (const stage of allStages(workflow)) {
    const waiting = unitAwaiting(stage);
    if (waiting) return { stage, unit: waiting.unit };
  }
  return current ? { stage: current, unit: null } : null;
}

/** The questions file, artifacts and diary of a stage, or of one of its units. */
export function filesOf(stage, unit = null) {
  const scope = unit ? (stage?.units ?? []).find((entry) => entry.unit === unit) : stage;
  return {
    questions: scope?.questions ?? null,
    artifacts: scope?.artifacts ?? [],
    diary: scope?.diary ?? null,
  };
}

/** The stage-level files first, then each unit's, as {unit, files}. */
export function fileScopes(stage) {
  if (!stage) return [];
  return [{ unit: null, files: filesOf(stage) }, ...(stage.units ?? []).map((entry) => ({ unit: entry.unit, files: filesOf(stage, entry.unit) }))];
}

function owns(scope, path) {
  return (
    scope.questions?.path === path ||
    scope.diary?.path === path ||
    (scope.artifacts ?? []).some((file) => file.path === path) ||
    (scope.reviews ?? []).some((file) => file.path === path)
  );
}

export const QUESTIONS_FILE = /-questions\.md$/i;

/** Which stage (and unit) a project-relative path belongs to, or null. */
function ownerOf(workflow, path) {
  if (!workflow || !path) return null;
  for (const stage of allStages(workflow)) {
    if (owns(stage, path)) return { stage: stage.slug, unit: null };
    for (const unit of stage.units ?? []) {
      if (owns(unit, path)) return { stage: stage.slug, unit: unit.unit };
    }
  }
  // Files the payload does not list follow the record's folder layout:
  // <phase>/<stage>/... or <phase>/<unit>/<stage>/...
  const prefix = `aidlc/spaces/${workflow.space}/intents/${workflow.intent}/`;
  if (path.startsWith(prefix)) {
    const parts = path.slice(prefix.length).split("/");
    if (parts.length > 2 && findStage(workflow, parts[1])) return { stage: parts[1], unit: null };
    if (parts.length > 3 && findStage(workflow, parts[2])) return { stage: parts[2], unit: parts[1] };
  }
  // The space's code knowledge base holds Reverse Engineering's deliverables.
  if (path.startsWith(`aidlc/spaces/${workflow.space}/codekb/`) && findStage(workflow, "reverse-engineering")) {
    return { stage: "reverse-engineering", unit: null };
  }
  return null;
}

/** Where an intent opens when currentPlace names nothing: its latest done stage, else its first one. */
function restingStage(workflow) {
  const stages = allStages(workflow).filter(inPlan);
  return stages.filter((stage) => stage.word === "done").pop() ?? stages[0] ?? null;
}

// ---- Views -----------------------------------------------------------------

function view(kind, fields, workflow) {
  return {
    kind,
    space: workflow?.space ?? store.workspace?.space ?? null,
    intent: workflow?.intent ?? null,
    stage: null,
    unit: null,
    path: null,
    ...fields,
  };
}

export function inboxView(workspace = store.workspace, workflow = store.workflow) {
  return { kind: "inbox", space: workspace?.space ?? null, intent: workflow?.intent ?? null, stage: null, unit: null, path: null };
}

/** Questions file, else document, for a path; the owner comes from the workflow. */
function pathView(path, owner = ownerOf(store.workflow, path), workflow = store.workflow) {
  return view(QUESTIONS_FILE.test(path) ? "questions" : "document", { path, stage: owner?.stage ?? null, unit: owner?.unit ?? null }, workflow);
}

/**
 * What an intent opens on, at the stage currentPlace names: a questions file
 * still waiting for answers, else the waiting unit's first document (or its
 * overview), else the stage's first document, else its overview. A finished
 * intent opens on its last done stage; an intent with no stages at all opens
 * on its files.
 */
export function currentThingView(workflow) {
  const place = currentPlace(workflow);
  const stage = place?.stage ?? restingStage(workflow);
  if (!stage) return view("files", {}, workflow);
  const scopes = fileScopes(stage);
  const asking = scopes.find((scope) => openAnswers(scope.files.questions) > 0);
  if (asking) return pathView(asking.files.questions.path, { stage: stage.slug, unit: asking.unit }, workflow);
  const waiting = place?.unit ? scopes.find((scope) => scope.unit === place.unit) : null;
  if (waiting) {
    const first = waiting.files.artifacts[0];
    if (!first) return view("overview", { stage: stage.slug, unit: waiting.unit }, workflow);
    return pathView(first.path, { stage: stage.slug, unit: waiting.unit }, workflow);
  }
  const written = scopes.find((scope) => scope.files.artifacts.length > 0);
  if (written) return pathView(written.files.artifacts[0].path, { stage: stage.slug, unit: written.unit }, workflow);
  return view("overview", { stage: stage.slug }, workflow);
}

/**
 * Where "Back to …" goes while the intent runs: currentThingView, named by the
 * stage (and unit) it opens; null for a finished intent, which has nowhere
 * its work stands.
 */
export function backTarget(workflow) {
  if (!currentPlace(workflow)) return null;
  const target = currentThingView(workflow);
  const stage = findStage(workflow, target.stage);
  if (!stage) return null;
  return { view: target, stage, unit: target.unit, label: target.unit ? `${stage.name} · ${target.unit}` : stage.name };
}

export function openView(next) {
  store.set({ view: next });
}

export function openInbox() {
  openView(inboxView());
}

export function openFiles() {
  openView(view("files", {}, store.workflow));
}

export function openOverview(stage, unit = null) {
  openView(view("overview", { stage, unit }, store.workflow));
}

export function openPath(path, owner) {
  openView(pathView(path, owner ?? ownerOf(store.workflow, path)));
}

/** The workflow payload when it is the one the view belongs to. */
export function workflowFor(current = store.view) {
  const workflow = store.workflow;
  return workflow && workflow.intent === current.intent && workflow.space === current.space ? workflow : null;
}

// The kind of every file an All files listing named (TreeEntry.kind), by path.
const listedKinds = new Map();

/** Keeps the kind of each file a /api/tree listing names, for files no stage lists. */
export function rememberKinds(entries) {
  for (const entry of entries ?? []) {
    if (entry.type === "file" && entry.kind) listedKinds.set(entry.path, entry.kind);
  }
}

/**
 * How the server shows a file (model.ts fileKind owns the rule): the kind its
 * FileRef or All files entry gives, else the read document's; null until one
 * of them names it.
 */
function kindOf(path) {
  for (const stage of allStages(store.workflow)) {
    for (const scope of [stage, ...(stage.units ?? [])]) {
      const file = [...(scope.artifacts ?? []), scope.diary, ...(scope.reviews ?? [])].find((each) => each?.path === path);
      if (file) return file.kind;
    }
  }
  if (listedKinds.has(path)) return listedKinds.get(path);
  return store.document?.path === path ? store.document.kind : null;
}

/**
 * The right-hand panels a view offers: Decisions on files, and Outline on a
 * document the server reads as Markdown. A file nothing has named yet keeps
 * the Outline until it is read, so an open Outline stays open across a link
 * to it; app.js closes it if the file turns out not to be Markdown.
 */
export function panelsFor(current) {
  if (current.kind === "document") return (kindOf(current.path) ?? "markdown") === "markdown" ? ["outline", "decisions"] : ["decisions"];
  if (current.kind === "questions") return ["decisions"];
  return [];
}

export function needsYouCount(workspace = store.workspace) {
  return (workspace?.intents ?? []).filter((intent) => intent.group === "needs-you").length;
}
