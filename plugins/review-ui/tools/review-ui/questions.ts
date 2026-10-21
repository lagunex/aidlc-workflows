// Reads a stage's questions file, `<stage>-questions.md` (the guide's
// "Artifacts Reference", Question Files). Only what the person sees counts:
// text inside code, raw HTML or comments is never a question, an option or an
// answer, and an `[Answer]:` counts only where it starts a line. Those are the
// engine's rules, read through Bun.markdown the way the engine reads them;
// they are written again here because the plugin imports nothing from the
// engine, by design, so an engine change cannot break it.
import { headingKey, trimEndWhere } from "./state.ts";
import type { Question, QuestionOption, QuestionSection, QuestionsSummary } from "./types.ts";

export interface ParsedQuestions {
  questions: Question[];
  sections: QuestionSection[];
  total: number;
  answered: number;
  open: number;
}

/** A visible block: a heading (with its level) or the lines of a paragraph or list item. */
export interface VisibleBlock {
  heading: number | null;
  lines: string[];
}

// Delimiters for serialising the render into flat records. The source is
// cleaned of them (and of TAG_MARK) first, so a document cannot forge one.
const OPEN = "\u0001";
const FIELD = "\u0002";
const CLOSE = "\u0003";
const RAW_OPEN = "\u0004";
const RAW_CLOSE = "\u0005";
// Stands where inline raw HTML was, so text after a tag never starts a line.
const HIDDEN = "\u0007";
// Put before a control tag so `[Answer]: B` stays a line instead of becoming
// a link reference definition, which Markdown would drop from view. A tag
// that starts a source line keeps the mark through the render, which is how
// the parser tells it from one inside a list or a quote.
export const TAG_MARK = "\uE000";
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are the record delimiters and the tag mark, removed from the source.
const DELIMITERS = /[\u0001-\u0007\uE000]/g;
const LINE_START_TAG = /^\[(Answer|Note|Approval Fingerprint|Planned Source)\]:/gm;
// The quote and list prefix is one class, so a line matches it one way only.
// In a prefix like "(?:[ \t]*>[ \t]?)*[ \t]*" each blank after a '>' can go to
// either part, so a deep "> > > …" line tries every split, and when the regex
// engine's backtracking limit stops the search, every tag after it is left
// unmarked.
const CONTAINED_TAG = /^([ \t>]*(?:[-*+][ \t]+|\d{1,9}[.)][ \t]+)?)\[(Answer|Note|Approval Fingerprint|Planned Source)\]:/gim;
// Bun.markdown hands each inline raw HTML token (a tag, a comment, a
// declaration) to the text callback as a chunk of its own; entity-decoded
// text arrives in separate pieces, so it never looks like one.
const RAW_HTML_CHUNK =
  /^<(?:[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|\/[A-Za-z][A-Za-z0-9-]*\s*>|!--[\s\S]*?-->|\?[\s\S]*?\?>|![A-Za-z][^>]*>|!\[CDATA\[[\s\S]*?\]\]>)$/;

/**
 * The source with its control tags kept visible: those that start a line, or
 * with `contained`, those inside a list item or a quote too (what a reader of
 * the document sees, though the engine reads only the first kind).
 */
export function neutralizeControlTags(source: string, options: { contained?: boolean } = {}): string {
  const clean = source.replace(DELIMITERS, "");
  return options.contained ? clean.replace(CONTAINED_TAG, `$1${TAG_MARK}[$2]:`) : clean.replace(LINE_START_TAG, `${TAG_MARK}[$1]:`);
}

/** Removes the marks neutralizeControlTags put in. */
export function stripTagMarks(text: string): string {
  return text.replaceAll(TAG_MARK, "");
}

export function isRawHtmlChunk(text: string): boolean {
  return RAW_HTML_CHUNK.test(text);
}

/** Keeps a raw HTML chunk's place in rendered text until the caller decides how to show it. */
function rawPlaceholder(index: number): string {
  return `${RAW_OPEN}${index}${RAW_CLOSE}`;
}

function replaceRawPlaceholders(text: string, replace: (index: number) => string): string {
  return text.replace(new RegExp(`${RAW_OPEN}(\\d+)${RAW_CLOSE}`, "g"), (_, index: string) => replace(Number(index)));
}

function record(kind: string, text: string): string {
  return `${OPEN}${kind}${FIELD}${text}${CLOSE}`;
}

// A list item's own inline text becomes a record beside the records of the
// blocks nested in it, so the output stays flat.
function liftInline(children: string): string {
  let out = "";
  let at = 0;
  while (at < children.length) {
    const start = children.indexOf(OPEN, at);
    const text = children.slice(at, start < 0 ? children.length : start);
    if (text.trim()) out += record("P", text);
    if (start < 0) break;
    const end = children.indexOf(CLOSE, start);
    if (end < 0) break;
    out += children.slice(start, end + 1);
    at = end + 1;
  }
  return out;
}

/**
 * The headings, paragraphs and list items a reader sees, in order; code, HTML
 * and tables drop out. A line the source starts with a control tag keeps
 * TAG_MARK in front of it.
 */
export function visibleBlocks(source: string): VisibleBlock[] {
  const raws: string[] = [];
  const literal = (text: string): string => replaceRawPlaceholders(text, (index) => raws[index] ?? "");
  const inline = (children: string): string => children;
  const rendered = Bun.markdown.render(
    neutralizeControlTags(source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")),
    {
      heading: (children, meta) => record(`H${meta.level}`, children),
      paragraph: (children) => record("P", children),
      listItem: liftInline,
      list: inline,
      blockquote: inline,
      code: () => "",
      html: () => "",
      hr: () => "",
      table: () => "",
      strong: inline,
      emphasis: inline,
      strikethrough: inline,
      link: inline,
      image: inline,
      codespan: (children) => `\`${literal(children)}\``,
      text: (text) => (isRawHtmlChunk(text) ? rawPlaceholder(raws.push(text) - 1) : text),
    },
    { tasklists: false },
  );
  const visible = replaceRawPlaceholders(rendered, () => HIDDEN);
  const blocks: VisibleBlock[] = [];
  for (const match of visible.matchAll(new RegExp(`${OPEN}([^${FIELD}]*)${FIELD}([^${CLOSE}]*)${CLOSE}`, "g"))) {
    const heading = /^H([1-6])$/.exec(match[1]);
    blocks.push({ heading: heading ? Number(heading[1]) : null, lines: match[2].split("\n").map((line) => line.trimEnd()) });
  }
  return blocks;
}

function plain(text: string): string {
  return stripTagMarks(text.replaceAll(HIDDEN, "")).trim();
}

type SectionKind = "summary" | "assumptions" | "plan" | "changes" | "other";

function sectionKind(title: string): SectionKind | null {
  const key = trimEndWhere(title, (char) => /[\s.:]/.test(char))
    .trim()
    .toLowerCase();
  if (/(^|\s)summary confirmation$/.test(key)) return "summary";
  if (key === "assumption confirmation") return "assumptions";
  if (/(^|\s)plan approval$/.test(key)) return "plan";
  if (key === "requested changes feedback") return "changes";
  return null;
}

/** The plain-words line for a confirmation, approval or change-request section. */
export function sectionNote(kind: SectionKind, answer: string | null): string {
  if (answer === null) {
    switch (kind) {
      case "summary":
        return "waiting for you to confirm the summary";
      case "assumptions":
        return "waiting for you to accept the assumptions or turn them into questions";
      case "plan":
        return "waiting for your approval of the plan";
      case "changes":
        return "waiting for you to say what should change";
      default:
        return "waiting for your answer";
    }
  }
  switch (kind) {
    case "summary":
      if (/^looks correct/i.test(answer)) return "summary confirmed";
      if (/^request changes/i.test(answer)) return "changes to the summary requested";
      return "summary answered";
    case "assumptions":
      if (/convert|follow-up/i.test(answer)) return "assumptions turned into follow-up questions";
      if (/accept/i.test(answer)) return "assumptions accepted";
      return "assumptions answered";
    case "plan": {
      // The engine writes the person's choice with its option letter
      // ("B. Request Changes"), as a questions file letters its options.
      const choice = answer.replace(/^[A-Z][.)][ \t]*/, "");
      if (/^plan approval off/i.test(choice)) return "plan approval was off";
      if (/^request changes/i.test(choice)) return "changes to the plan requested";
      if (/approve/i.test(choice)) return "plan approved";
      return "plan answered";
    }
    case "changes":
      return "changes requested";
    default:
      return "answered";
  }
}

interface Draft {
  kind: "question" | SectionKind;
  number: number;
  title: string;
  role: string | null;
  prompt: string[][];
  options: QuestionOption[];
  answer: string | null;
  answered: boolean;
}

// With the `s` flag the final `.*` reaches the end of a line that holds
// U+2028, so it never backs into the blanks before it (see state.ts).
const QUESTION_TITLE = /^Q([1-9][0-9]*)(?:[.:](?:[ \t]+(.*))?)?$/s;
const ROLE = /^\[([^\]]+)\][ \t]*(.*)$/s;
const ANSWER_LINE = /^\uE000\[Answer\]:[ \t]*(.*)$/s;
const IGNORED_LINE = /^\uE000\[(?:Approval Fingerprint|Planned Source|Note)\]:/;
const OPTION_LINE = /^([A-Z])[.)][ \t]+(.+)$/s;

function startDraft(rawTitle: string): Draft {
  const title = headingKey(plain(rawTitle));
  const blank: Omit<Draft, "kind" | "number" | "title" | "role"> = { prompt: [], options: [], answer: null, answered: false };
  const question = QUESTION_TITLE.exec(title);
  if (question) {
    let rest = (question[2] ?? "").trim();
    let role: string | null = null;
    const labelled = ROLE.exec(rest);
    if (labelled) {
      role = labelled[1].trim();
      rest = labelled[2].trim();
    }
    const kind = sectionKind(rest);
    if (kind) return { ...blank, kind, number: Number(question[1]), title: rest, role: null };
    return { ...blank, kind: "question", number: Number(question[1]), title: rest, role };
  }
  return { ...blank, kind: sectionKind(title) ?? "other", number: 0, title, role: null };
}

function namesSection(rawTitle: string): boolean {
  const title = headingKey(plain(rawTitle));
  return QUESTION_TITLE.test(title) || sectionKind(title) !== null;
}

function isOpen(answer: string | null): boolean {
  return answer === null || /^[_\s]*$/.test(answer);
}

function chosenLetters(answer: string, options: QuestionOption[]): string[] {
  const letters = new Set(options.map((option) => option.letter));
  const several = /^[A-Z](?:[ \t]*,[ \t]*[A-Z])+(?=$|[.):;\s])/.exec(answer);
  if (several) return [...new Set(several[0].split(",").map((letter) => letter.trim()))].filter((letter) => letters.has(letter));
  const one = /^([A-Z])(?=$|[.):,;]|[ \t]+[-–—][ \t])/.exec(answer);
  return one && letters.has(one[1]) ? [one[1]] : [];
}

export function parseQuestions(text: string): ParsedQuestions {
  const questions: Question[] = [];
  const sections: QuestionSection[] = [];
  let draft: Draft | null = null;
  const finish = (): void => {
    if (!draft) return;
    const done: Draft = draft;
    draft = null;
    const open = isOpen(done.answer);
    const answer = open ? null : (done.answer as string);
    if (done.kind === "question") {
      const chosenAll = answer ? chosenLetters(answer, done.options) : [];
      questions.push({
        number: done.number,
        title: done.title,
        role: done.role,
        prompt: done.prompt.map((lines) => lines.join("\n")).join("\n\n"),
        options: done.options,
        answer,
        chosen: chosenAll[0] ?? null,
        chosen_all: chosenAll,
        open,
      });
    } else if (done.answered) {
      sections.push({ title: done.title, state: open ? "open" : "answered", answer, note: sectionNote(done.kind, answer) });
    }
  };
  for (const block of visibleBlocks(text)) {
    if (block.heading !== null) {
      const title = block.lines.join(" ");
      // Every H2 opens a section; a deeper heading does when it names a
      // question or a confirmation (files written with "### Q1." exist), and
      // is otherwise part of the question's text.
      const opens = block.heading === 2 || (block.heading <= 4 && namesSection(title));
      if (block.heading === 1 || opens) {
        finish();
        if (opens) draft = startDraft(title);
      } else if (draft?.kind === "question" && !draft.answered && plain(title)) {
        draft.prompt.push([plain(title)]);
      }
      continue;
    }
    if (!draft) continue;
    const current: Draft = draft;
    const promptLines: string[] = [];
    // A line after an option, in the same paragraph or list item, is that
    // option's text wrapped onto the next line.
    let option: QuestionOption | null = null;
    for (const line of block.lines) {
      const answer = ANSWER_LINE.exec(line);
      if (answer) {
        option = null;
        if (!current.answered) {
          current.answer = plain(answer[1]);
          current.answered = true;
        }
        continue;
      }
      if (current.answered || IGNORED_LINE.test(line) || current.kind !== "question") {
        option = null;
        continue;
      }
      const lettered = OPTION_LINE.exec(line);
      const text = plain(line);
      if (lettered) {
        option = { letter: lettered[1], text: plain(lettered[2]) };
        current.options.push(option);
      } else if (text && option) option.text = `${option.text} ${text}`;
      else if (text) promptLines.push(text);
    }
    if (promptLines.length > 0) current.prompt.push(promptLines);
  }
  finish();
  const open = questions.filter((question) => question.open).length;
  return { questions, sections, total: questions.length, answered: questions.length - open, open };
}

/** Open questions plus open confirmation and approval sections: every `[Answer]:` still to fill. */
export function openAnswers(parsed: ParsedQuestions): number {
  return parsed.open + parsed.sections.filter((section) => section.state === "open").length;
}

export function summarizeQuestions(path: string, parsed: ParsedQuestions): QuestionsSummary {
  return {
    path,
    total: parsed.total,
    answered: parsed.answered,
    open: parsed.open,
    open_answers: openAnswers(parsed),
    sections: parsed.sections.map((section) => section.note),
  };
}

/** The stage a questions file belongs to, from its `<stage>-questions.md` name. */
export function questionsStage(path: string): string {
  const name = path.split("/").pop() ?? "";
  return name.replace(/-questions\.md$/i, "");
}
