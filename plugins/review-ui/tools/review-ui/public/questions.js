// The questions view: one questions file from /api/questions, in the
// answered-round layout. Every round is read-only here: a chosen option is
// tinted and locked, and an open question says where to answer it, or, once
// the intent is archived or completed, that it was left unanswered.

import { get } from "./api.js";
import { basename, el, findStage, finished, placeholder, rebuild, store, workflowFor } from "./store.js";

let root;
let token = 0;
let shown = { file: null, drawn: null };

function fileKey(view) {
  return `${view.space}/${view.intent}:${view.path}`;
}

function onScreen(view) {
  return store.view.kind === "questions" && fileKey(store.view) === fileKey(view);
}

/** The words for an open answer once the intent no longer runs, e.g. "when this intent was archived"; null while it runs. */
function endedWhen(workflow) {
  if (!finished(workflow)) return null;
  return workflow.status === "archived" ? "when this intent was archived" : "when this intent completed";
}

/**
 * The line under the title. An open confirmation, approval or change-request
 * section waits on the person as an open question does, so it is named too.
 */
function lead(payload, file, ended) {
  if (ended && payload.open_answers > 0) return `This round was still open ${ended}.`;
  const waiting = payload.sections.filter((section) => section.state === "open").map((section) => section.note);
  const where = `in ${file} or where you run AI-DLC`;
  const notes = waiting.join(" and ");
  if (payload.total === 0) {
    if (waiting.length) return `${notes.charAt(0).toUpperCase()}${notes.slice(1)} — answer ${waiting.length === 1 ? "it" : "them"} ${where}.`;
    return payload.sections.length ? "This file asks for a confirmation rather than numbered questions." : "This file has no numbered questions yet.";
  }
  if (payload.open === 0) {
    const answered = payload.total === 1 ? "The question in this round is answered" : `All ${payload.total} questions in this round are answered`;
    return waiting.length ? `${answered}; ${notes} — answer ${waiting.length === 1 ? "it" : "them"} ${where}.` : `${answered}.`;
  }
  return `${payload.open} of ${payload.total} still open${waiting.length ? `, and ${notes}` : ""}; answer them ${where}.`;
}

function paragraphs(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => el("p", { text: part }));
}

/** Every option letter the answer names: "A", or "A, B, E" for a multiple choice. */
function chosenLetters(question) {
  if (question.chosen_all?.length) return question.chosen_all;
  return question.chosen ? [question.chosen] : [];
}

function answerLine(question, file, ended) {
  if (question.open) {
    return el("p", { class: "ans-line open" }, el("b", { text: "Open" }), ended ? ` · left unanswered ${ended}` : ` · answer in ${file} or where you run AI-DLC`);
  }
  const letters = chosenLetters(question);
  const named = letters.length === 0 ? " · in your own words" : ` · ${letters.length === 1 ? "option" : "options"} ${letters.join(", ")}`;
  return el("p", { class: "ans-line" }, el("b", { text: "✓ Answered" }), named);
}

function optionNode(question, option) {
  const chosen = !question.open && chosenLetters(question).includes(option.letter);
  return el(
    "li",
    { class: ["option", chosen && "chosen"] },
    el("span", { class: "option-mark", "aria-hidden": "true" }),
    el("span", { class: "option-letter", text: option.letter }),
    el("span", { class: "option-text", text: option.text }),
    chosen ? el("span", { class: "rectag", text: "Chosen" }) : null,
  );
}

function comparable(text) {
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.;:]+$/, "")
    .trim();
}

/**
 * The answer in the person's words, when it says more than the options it
 * chose: "C" or "A, C" alone, or a letter followed by that option's own text,
 * repeat what the tinted options already show.
 */
function answerText(question) {
  const answer = question.answer?.trim();
  if (question.open || !answer) return null;
  const letters = chosenLetters(question);
  if (letters.length > 0) {
    const rest = answer.replace(/^[\s([]*[A-Za-z](?:\s*[,;&]\s*[A-Za-z])*[\s.):\]—–-]*/, "");
    const chosenTexts = question.options.filter((option) => letters.includes(option.letter)).map((option) => comparable(option.text));
    if (!rest.trim() || chosenTexts.includes(comparable(rest))) return null;
  }
  return el("blockquote", { class: "ans-text", text: answer });
}

function questionBlock(question, index, count, file, ended) {
  const titleId = `question-${index + 1}`;
  return el(
    "section",
    { class: ["qblock", question.open ? "open" : "answered"], "aria-labelledby": titleId },
    el("p", { class: "qnum" }, `Question ${index + 1} of ${count}`, question.role ? el("span", { class: "qrole", text: ` · ${question.role}` }) : null),
    el("h2", { id: titleId, text: question.title }),
    question.prompt ? el("div", { class: "explain" }, paragraphs(question.prompt)) : null,
    el(
      "article",
      { class: "qcard" },
      el("h3", { text: "Your answer" }),
      answerLine(question, file, ended),
      question.options.length ? el("ul", { class: "options" }, question.options.map((option) => optionNode(question, option))) : null,
      answerText(question),
    ),
  );
}

function sectionNode(section, ended) {
  return el(
    "div",
    { class: ["qsection", section.state] },
    el("b", { text: section.title }),
    el("span", { text: ended && section.state === "open" ? `left unanswered ${ended}` : section.note }),
    section.state === "answered" && section.answer ? el("blockquote", { class: "ans-text", text: section.answer }) : null,
  );
}

function draw(view, payload) {
  const workflow = workflowFor(view);
  const stage = findStage(workflow, view.stage);
  const title = `${stage?.name ?? (payload.stage_name || payload.stage)}${view.unit ? ` · ${view.unit}` : ""} · questions`;
  const file = basename(payload.path);
  const ended = endedWhen(workflow);
  const drawn = JSON.stringify([payload, title, ended]);
  if (shown.file === fileKey(view) && shown.drawn === drawn) return;
  const sameFile = shown.file === fileKey(view);
  shown = { file: fileKey(view), drawn };
  rebuild(
    root,
    el(
      "div",
      // An archived or completed intent's open round waits on nobody, so it loses the accent.
      { class: ["qcol", ended && "ended"] },
      el("div", { class: "qintro" }, el("h1", { text: title }), el("p", { text: lead(payload, file, ended) })),
      payload.questions.map((question, index) => questionBlock(question, index, payload.questions.length, file, ended)),
      payload.sections.length ? el("div", { class: "qsections" }, payload.sections.map((section) => sectionNode(section, ended))) : null,
    ),
  );
  if (!sameFile) root.scrollTop = 0;
}

async function load(view, quiet) {
  const mine = ++token;
  if (!quiet) store.set({ questions: null });
  const slow = quiet
    ? null
    : window.setTimeout(() => {
        if (mine !== token) return;
        shown = { file: null, drawn: null };
        rebuild(root, el("p", { class: "questions-placeholder", text: `Opening ${basename(view.path)}…` }));
      }, 150);
  try {
    const payload = await get("/api/questions", { space: view.space, intent: view.intent, path: view.path });
    if (mine !== token || !onScreen(view)) return;
    store.set({ questions: payload });
    draw(store.view, payload);
  } catch (error) {
    if (mine !== token || !onScreen(view)) return;
    store.set({ questions: null });
    shown = { file: null, drawn: null };
    rebuild(root, placeholder(basename(view.path), error.message, "questions-placeholder"));
  } finally {
    window.clearTimeout(slow);
  }
}

export function init() {
  root = document.getElementById("questions-view");
  store.on("view", (view) => {
    if (view.kind !== "questions") {
      token += 1;
      shown = { file: null, drawn: null };
      if (store.questions) store.set({ questions: null });
      return;
    }
    if (shown.file === fileKey(view) && store.questions?.path === view.path) draw(view, store.questions);
    else load(view, false);
  });
  store.on("refresh", () => {
    if (store.view.kind === "questions") load(store.view, true);
  });
  store.on("workflow", () => {
    if (store.view.kind === "questions" && store.questions?.path === store.view.path) draw(store.view, store.questions);
  });
}
