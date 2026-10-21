// The reader: one file from /api/render under a neutral banner and a line that
// says when it changed. It opens [data-open-path] links inside the app,
// scrolls to Outline headings, fills the overview's folded Diary, and owns the
// one place server HTML becomes nodes (renderedHtml).

import { get } from "./api.js";
import { basename, el, findStage, formatWhen, openPath, placeholder, rebuild, reducedMotion, store, wordsFor, workflowFor } from "./store.js";

let viewer;
let token = 0;
// What the viewer shows: the file, and everything its drawing depended on.
let shown = { file: null, drawn: null };

/**
 * The one HTML sink in the app. The HTML is a /api/render body: the server's
 * renderer (render.ts) owns what it may contain (raw HTML escaped, links
 * limited to safe schemes, images shown as links), and the page's CSP
 * refuses inline script and style. A template's content is inert, so
 * nothing in it runs or loads while it is parsed.
 */
function renderedHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = typeof html === "string" ? html : "";
  return template.content;
}

function fileKey(view) {
  return `${view.space}/${view.intent}:${view.path}`;
}

function onScreen(view) {
  return store.view.kind === "document" && fileKey(store.view) === fileKey(view);
}

/**
 * The reader banner for a stage, or a team-mode unit (wordsFor): a bold label
 * and one sentence, never an action, and none that asks for one once the
 * intent stopped ("stopped" is an archived or completed intent's open stage).
 */
function bannerFor(words, workflow) {
  if (!words) return null;
  const name = words.unit ? `${words.name} for ${words.unit}` : words.name;
  switch (words.word) {
    case "done":
      return ["Done stage", `· ${name} finished${words.decided_at ? ` ${formatWhen(words.decided_at)}` : ""} · read-only`];
    case "in-review":
      return ["Awaiting your approval", `· ${name}${words.revision ? ` r${words.revision}` : ""} — approve or ask for changes where you run AI-DLC`];
    case "revising":
      return ["Revising", `· the agent is working on your feedback for ${name}`];
    case "current":
    case "questions":
      return ["In progress", `· ${name} is still running — this page updates as files change`];
    case "stopped":
      return workflow?.status === "archived"
        ? ["Archived", `· ${name} stopped here when this intent was archived · read-only`]
        : ["Stopped", `· ${name} was still open when this intent completed · read-only`];
    default:
      return null;
  }
}

function draw(view, payload) {
  const workflow = workflowFor(view);
  const words = view.stage ? wordsFor(findStage(workflow, view.stage), view.unit) : null;
  const banner = bannerFor(words, workflow);
  const meta = [payload.mtime ? `Updated ${formatWhen(payload.mtime)}` : null, words?.revision > 0 ? `r${words.revision}` : null]
    .filter(Boolean)
    .join(" · ");
  const drawn = JSON.stringify([payload.path, payload.kind, payload.mtime, payload.html, banner, meta]);
  if (shown.file === fileKey(view) && shown.drawn === drawn) return;
  const sameFile = shown.file === fileKey(view);
  shown = { file: fileKey(view), drawn };
  rebuild(
    viewer,
    el(
      "div",
      { class: "document-page" },
      banner ? el("div", { class: "read-only-banner" }, el("b", { text: banner[0] }), el("span", { text: banner[1] })) : null,
      el("div", { class: "document-meta" }, el("span", { text: meta || "Read-only" }), el("code", { class: "document-path", title: payload.path, text: payload.path })),
      el("div", { class: ["document-body", payload.kind === "text" && "text"] }, renderedHtml(payload.html)),
    ),
  );
  if (!sameFile) viewer.scrollTop = 0;
}

async function load(view, quiet) {
  const mine = ++token;
  // The Outline must not show the previous file's headings meanwhile.
  if (!quiet) store.set({ document: null, documentError: null });
  // A quick read shows no loading line at all; a slow one says what it opens.
  const slow = quiet
    ? null
    : window.setTimeout(() => {
        if (mine !== token) return;
        shown = { file: null, drawn: null };
        rebuild(viewer, el("div", { class: "document-loading", text: `Opening ${basename(view.path)}…` }));
      }, 150);
  try {
    const payload = await get("/api/render", { space: view.space, intent: view.intent, path: view.path });
    if (mine !== token || !onScreen(view)) return;
    store.set({ document: payload, documentError: null });
    draw(store.view, payload);
  } catch (error) {
    if (mine !== token || !onScreen(view)) return;
    // Kept in the store, so an Outline opened after the failure says it too.
    store.set({ document: null, documentError: { path: view.path, message: error.message } });
    shown = { file: null, drawn: null };
    rebuild(viewer, placeholder(basename(view.path), error.message, "document-placeholder"));
  } finally {
    window.clearTimeout(slow);
  }
}

// ---- Links, headings and the Diary ----------------------------------------------

function linkIn(event) {
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  return link?.closest(".document-body") ? link : null;
}

// Web links carry target="_blank" from the server, so they open beside the
// app on their own; a link to a file of the same root opens it here.
function onClick(event) {
  if (event.defaultPrevented || event.button !== 0) return;
  const path = linkIn(event)?.getAttribute("data-open-path");
  if (!path) return;
  event.preventDefault();
  openPath(path);
}

function onAuxClick(event) {
  // A middle click on an in-app link would open a tab the server cannot answer.
  if (linkIn(event)?.hasAttribute("data-open-path")) event.preventDefault();
}

function scrollToHeading(id) {
  const target = typeof id === "string" ? document.getElementById(id) : null;
  if (!target || !viewer.contains(target)) return;
  target.setAttribute("tabindex", "-1");
  target.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
}

// The latest Diary read asked for each body, so an older read that lands later is dropped.
const diaryReads = new WeakMap();

/**
 * Fills the overview's Diary body with memory.md. `stamp` names the version
 * read (its FileRef's size and mtime); the body keeps it in data-filled once
 * filled, so workflow.js reads again only when the file changed. A failed
 * read leaves no stamp, so the next open tries again.
 */
async function fillDiary({ target, space, intent, path, stamp }) {
  const mine = (diaryReads.get(target) ?? 0) + 1;
  diaryReads.set(target, mine);
  const current = () => target.isConnected && diaryReads.get(target) === mine;
  try {
    const payload = await get("/api/render", { space, intent, path });
    if (!current()) return;
    target.replaceChildren(
      payload.html.trim()
        ? el("div", { class: "diary-entries document-body" }, renderedHtml(payload.html))
        : el("p", { class: "overview-placeholder", text: "Nothing recorded yet." }),
    );
    target.dataset.filled = stamp ?? "";
  } catch (error) {
    if (!current()) return;
    target.replaceChildren(el("p", { class: "overview-placeholder", text: error.message }));
    target.removeAttribute("data-filled");
  }
}

export function init() {
  viewer = document.getElementById("viewer");
  const main = document.getElementById("main");
  main.addEventListener("click", onClick);
  main.addEventListener("auxclick", onAuxClick);

  store.on("view", (view) => {
    if (view.kind !== "document") {
      token += 1;
      shown = { file: null, drawn: null };
      if (store.document || store.documentError) store.set({ document: null, documentError: null });
      return;
    }
    if (shown.file === fileKey(view) && store.document?.path === view.path) draw(view, store.document);
    else load(view, false);
  });
  store.on("refresh", () => {
    if (store.view.kind === "document") load(store.view, true);
  });
  store.on("workflow", () => {
    if (store.view.kind === "document" && store.document?.path === store.view.path) draw(store.view, store.document);
  });
  store.on("scroll-to", scrollToHeading);
  store.on("diary", fillDiary);
}
