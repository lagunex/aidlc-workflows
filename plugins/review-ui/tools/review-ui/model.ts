// Every word and sentence the screens show about intents and stages, and the
// rule behind each, in one place (one owner per rule): stage words, labels and
// display names, Needs you, the counts, the header line and its tone, intent
// status, groups and selection, per-unit stages and the team Unit Progress
// table. A time travels as an ISO string, for the page to word on the
// person's own clock. The Decisions timeline's words are audit.ts's, except
// the review verdict entries (reviewEntry), which come from the review files
// this module is handed. Pure: the
// server hands in parsed files and folder listings.
import {
  type OrderedEvent,
  phaseSkipReasons,
  type StageFacts,
  stageFacts,
  type TimelineEntry,
  unitFactKey,
  unitStageFacts,
} from "./audit.ts";
import { openAnswers, type ParsedQuestions, summarizeQuestions } from "./questions.ts";
import type { ParsedState, StateRow, UnitProgressTable, UnitProgressTableRow } from "./state.ts";
import type {
  DecisionEntry,
  DecisionsPayload,
  FileKind,
  FileRef,
  IntentGroup,
  IntentStatus,
  IntentSummary,
  Marker,
  Needs,
  SpaceSummary,
  StageUnit,
  StageWord,
  StatusSentence,
  UnitProgressRow,
  WorkflowPayload,
  WorkflowPhase,
  WorkflowStage,
  WorkspacePayload,
} from "./types.ts";
import type { FileEntry, ReadProblem } from "./workspace.ts";

/** The stage whose deliverables live in the space's codekb/ (guide 14, Artifacts Reference). */
export const CODEKB_STAGE = "reverse-engineering";

const SMALL_WORDS = new Set(["a", "an", "and", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);
const ACRONYMS = new Set(["api", "aws", "cd", "ci", "iac", "mvp", "nfr", "poc", "qa", "sla", "slo", "ui", "ux"]);
const MARKDOWN = /\.(?:md|markdown)$/i;
const TEXT_EXTENSIONS = new Set(
  (
    "adoc bash c cfg cjs conf cpp cs css csv diff dot env gitignore go gradle graphql h hcl hpp htm html ini java js json " +
    "jsonl jsx kt log mjs mmd patch php properties puml py rb rs rst scala sh sql swift tf toml ts tsv tsx txt xml yaml yml zsh"
  ).split(" "),
);

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A slug or phase name in title case: "build-and-test" reads "Build and Test", "nfr-design" "NFR Design". */
export function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function iso(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}

function isoOf(text: string): string | null {
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function fileKind(name: string): FileKind {
  if (MARKDOWN.test(name)) return "markdown";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "text";
  return TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase()) ? "text" : "other";
}

export function fileRef(entry: FileEntry): FileRef {
  return { path: entry.rel, name: entry.name, kind: fileKind(entry.name), size: entry.size, mtime: iso(entry.mtimeMs) };
}

/** One row of a space's intents/intents.json (guide 03, Spaces and Intents). */
export interface RegistryRow {
  uuid: string;
  slug: string;
  dirName: string;
  scope: string;
  repos: string[];
  status: string;
}

/** The registry rows, or null when the file is not the documented JSON (a merge conflict, say). */
export function parseRegistry(text: string): RegistryRow[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const rows = Array.isArray(data) ? data : null;
  if (!rows) return null;
  const asText = (value: unknown): string => (typeof value === "string" ? value : "");
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row))
    .map((row) => ({
      uuid: asText(row.uuid),
      slug: asText(row.slug),
      dirName: asText(row.dirName),
      scope: asText(row.scope),
      repos: Array.isArray(row.repos) ? row.repos.filter((repo): repo is string => typeof repo === "string") : [],
      status: asText(row.status),
    }));
}

export function registryRowFor(rows: RegistryRow[] | null, record: string): RegistryRow | null {
  return rows?.find((row) => row.dirName === record) ?? null;
}

/** The registry slug, else the folder name without its YYMMDD- date. */
export function intentLabel(record: string, row: RegistryRow | null): string {
  return row?.slug || record.replace(/^\d{6}-/, "") || record;
}

/**
 * The state file's Status decides running or completed; either the state or
 * the registry saying archived makes it archived. The registry answers only
 * when the state file could not be read.
 */
export function intentStatus(state: ParsedState | null, row: RegistryRow | null): IntentStatus {
  const readable = state?.recognized ? state : null;
  const stated = readable?.status.trim().toLowerCase() ?? "";
  if (stated === "archived" || row?.status.trim().toLowerCase() === "archived") return "archived";
  if (readable) {
    if (stated === "running") return "running";
    if (stated === "completed" || stated === "complete") return "completed";
    return "unknown";
  }
  switch (row?.status.trim().toLowerCase()) {
    case "in-flight":
      return "running";
    case "complete":
    case "completed":
      return "completed";
    default:
      return "unknown";
  }
}

/** An archived or completed intent: nothing in it waits on the person any more. */
function ended(status: IntentStatus): boolean {
  return status === "archived" || status === "completed";
}

/** The markers of a stage, or of a unit's cell, still open: running, awaiting review, revising. */
const OPEN_MARKERS: ReadonlySet<Marker> = new Set(["-", "?", "R"]);

/** A finished or archived intent has no current stage; Current Stage counts only when it names a row. */
export function currentRow(state: ParsedState | null, status: IntentStatus): StateRow | null {
  if (!state?.recognized || ended(status)) return null;
  return state.rows.find((row) => row.slug === state.currentStage) ?? null;
}

function nextRow(state: ParsedState | null, status: IntentStatus): StateRow | null {
  if (!state?.recognized || ended(status)) return null;
  return state.rows.find((row) => row.slug === state.nextStage) ?? null;
}

function integer(text: string | undefined): number {
  const value = Number.parseInt(text ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Stages in the plan (every row but SKIP), the [x] among them, and the [S] shown apart. */
export function stageCounts(state: ParsedState | null): { total: number; done: number; skipped: number } {
  if (!state?.recognized) return { total: 0, done: 0, skipped: 0 };
  if (state.rows.length === 0) return { total: integer(state.totalStages), done: integer(state.completed), skipped: 0 };
  const inPlan = state.rows.filter((row) => row.scope !== "SKIP");
  return {
    total: inPlan.length,
    done: inPlan.filter((row) => row.marker === "x").length,
    skipped: inPlan.filter((row) => row.marker === "S").length,
  };
}

const GATE_NEEDS: Needs = { kind: "gate", label: "Review approval gate" };

function questionsNeeds(open: number): Needs {
  return { kind: "questions", label: plural(open, "question", "questions") };
}

/**
 * Whether a team unit awaits the person's review at a stage: its cell there
 * is [?], or its Gate is [?] with no [?] cell, which is the unit-end gate the
 * engine opens on the last per-unit stage.
 */
function unitAwaitsAt(row: UnitProgressTableRow, table: UnitProgressTable, stage: string): boolean {
  if (row.cells[stage] === "?") return true;
  return row.gate === "?" && stage === table.stages.at(-1) && !Object.values(row.cells).includes("?");
}

/** Whether a team unit awaits the person's review at any stage; its Gate counts even in a table with no stage column. */
function unitAwaits(row: UnitProgressTableRow): boolean {
  return row.gate === "?" || Object.values(row.cells).includes("?");
}

/**
 * The person is needed when the current stage awaits their review ([?]), or
 * runs with answers still open ([-]); a unit of the team table awaiting review
 * (a [?] cell or Gate) counts too. Revising ([R]) is the agent's turn, so it
 * is not.
 */
export function intentNeeds(
  state: ParsedState | null,
  status: IntentStatus,
  currentOpenAnswers: number,
): Needs | null {
  if (ended(status) || !state?.recognized) return null;
  const current = currentRow(state, status);
  if (current?.marker === "?" || (state.unitProgress?.rows ?? []).some(unitAwaits)) return GATE_NEEDS;
  if (current?.marker === "-" && currentOpenAnswers > 0) return questionsNeeds(currentOpenAnswers);
  return null;
}

export function intentGroup(status: IntentStatus, needs: Needs | null): IntentGroup {
  if (status === "archived") return "archived";
  if (needs) return "needs-you";
  if (status === "completed") return "done";
  return "in-progress";
}

/** The one word a stage shows; an archived or completed intent's open stage is "stopped". */
export function stageWord(row: StateRow, isCurrent: boolean, open: number, nextSlug: string | null, status: IntentStatus): StageWord {
  if (ended(status) && OPEN_MARKERS.has(row.marker)) return "stopped";
  switch (row.marker) {
    case "x":
      return "done";
    case "-":
      return isCurrent && open > 0 ? "questions" : "current";
    case "?":
      return "in-review";
    case "R":
      return "revising";
    case "S":
      return "skipped";
    default:
      if (row.scope === "SKIP") return "not-in-plan";
      return row.slug === nextSlug ? "next" : "later";
  }
}

/** Where an open stage or unit stood when its intent ended, by its marker: "at review · r2", "in progress". */
function stoppedAt(marker: Marker, revision: number): string {
  const r = Math.max(revision, 1);
  if (marker === "?") return `at review · r${r}`;
  if (marker === "R") return `while revising · r${r}`;
  return "in progress";
}

/** The word with its detail: "in review · r2", "skipped · <reason>", "stopped at review · r1". */
export function stageLabel(word: StageWord, revision: number, reason: string | null, marker: Marker): string {
  switch (word) {
    case "in-review":
      return `in review · r${Math.max(revision, 1)}`;
    case "skipped":
      return reason ? `skipped · ${reason}` : "skipped";
    case "not-in-plan":
      return "not in this plan";
    case "stopped":
      return `stopped ${stoppedAt(marker, revision)}`;
    default:
      return word;
  }
}

/**
 * The header line while a stage (or a team unit) is shown; the accent tone
 * only when the person is needed. A done stage's time travels as `at`, for
 * the browser to show on the person's own clock.
 */
export function stageSentence(word: StageWord, revision: number, decidedAt: string | null, unitAwaiting: boolean, marker: Marker): StatusSentence {
  const r = Math.max(revision, 1);
  switch (word) {
    case "in-review":
      return { text: `Awaiting your review · r${r}`, tone: "needs" };
    case "done":
      return { text: "Done", tone: "ok", at: decidedAt };
    case "skipped":
    case "not-in-plan":
      return { text: "Skipped", tone: "quiet" };
    case "next":
      return { text: "Next", tone: "quiet" };
    case "later":
      return { text: "Later", tone: "quiet" };
    case "revising":
      return { text: `Revising · r${r}`, tone: "quiet" };
    case "stopped":
      return { text: `Stopped ${stoppedAt(marker, revision)}`, tone: "quiet" };
    default:
      return unitAwaiting ? { text: `Awaiting your review · r${r}`, tone: "needs" } : { text: "In progress", tone: "quiet" };
  }
}

/** The intent's line when the team table has a review waiting at no stage the state file lists. */
const AWAITING: StatusSentence = { text: "Awaiting your review", tone: "needs" };

export const UNAVAILABLE: StatusSentence = { text: "Workflow unavailable", tone: "quiet" };

/** The header line for a whole intent: its current stage's, or how it ended. */
export function intentSentence(status: IntentStatus, state: ParsedState | null, current: StatusSentence | null): StatusSentence {
  if (!state?.recognized) return UNAVAILABLE;
  if (status === "archived") return { text: "Archived", tone: "quiet" };
  if (status === "completed") return { text: "Workflow complete", tone: "ok" };
  return current ?? UNAVAILABLE;
}

/** The Inbox header line. */
export function inboxSentence(waiting: number): StatusSentence {
  return waiting > 0
    ? { text: `${plural(waiting, "item", "items")} ${waiting === 1 ? "needs" : "need"} you`, tone: "needs" }
    : { text: "Nothing waiting", tone: "ok" };
}

/** The header line while a questions file is shown; in an archived or completed intent an open answer waits on nobody. */
export function questionsSentence(parsed: ParsedQuestions, status: IntentStatus): StatusSentence {
  const open = openAnswers(parsed);
  if (open > 0) {
    const questions = plural(open, "question", "questions");
    return ended(status) ? { text: `${questions} left open`, tone: "quiet" } : { text: `${questions} for you`, tone: "needs" };
  }
  if (parsed.total + parsed.sections.length === 0) return { text: "No questions in this file", tone: "quiet" };
  return { text: "Answered", tone: "ok" };
}

/**
 * The folded line for a phase's stages that are not in the plan. It never
 * names the scope: a composed or recomposed plan, a skip the person asked
 * for, and a stage the project's kind rules out all mark a row SKIP just as
 * the scope does.
 */
export function notInPlanLabel(count: number, all: boolean): string | null {
  if (count === 0) return null;
  return all ? `${plural(count, "stage", "stages")} · not in this plan` : `${count} more · not in this plan`;
}

/** Plain-words notes for files left out of a view. */
export function fileNotes(stateProblem: ReadProblem | "unrecognized" | null, auditProblems: ReadProblem[]): string[] {
  const notes: string[] = [];
  switch (stateProblem) {
    case "too-large":
      notes.push("The state file is over 4 MiB, so this view shows only what the registry says.");
      break;
    case "binary":
      notes.push("The state file is not text, so this view shows only what the registry says.");
      break;
    case "unrecognized":
      notes.push("The state file does not read as an AI-DLC state file, so this view shows only what the registry says.");
      break;
    case null:
    case "missing":
      break;
    default:
      notes.push("The state file could not be read, so this view shows only what the registry says.");
  }
  const count = (problem: ReadProblem): number => auditProblems.filter((each) => each === problem).length;
  const large = count("too-large");
  const binary = count("binary");
  const unreadable = auditProblems.length - large - binary - count("missing");
  const was = (n: number): string => (n === 1 ? "was" : "were");
  if (large > 0) notes.push(`${plural(large, "audit file", "audit files")} over 4 MiB ${was(large)} left out.`);
  if (binary > 0) notes.push(`${plural(binary, "audit file", "audit files")} that ${binary === 1 ? "is" : "are"} not text ${was(binary)} left out.`);
  if (unreadable > 0) notes.push(`${plural(unreadable, "audit file", "audit files")} could not be read and ${was(unreadable)} left out.`);
  return notes;
}

export interface QuestionsInput {
  path: string;
  parsed: ParsedQuestions;
}

/** What one stage folder holds, by role. */
export interface StageFiles {
  questions: QuestionsInput | null;
  artifacts: FileRef[];
  diary: FileRef | null;
}

export interface StageInputs extends StageFiles {
  reviews: FileRef[];
  /** Per-unit folders of this stage, by unit. */
  units: Array<StageFiles & { unit: string }>;
}

/** Which file of a stage folder is its questions file, which its diary, and the rest its artifacts. */
export function stageFileRoles(slug: string, files: FileEntry[]): { questions: FileEntry | null; diary: FileEntry | null; artifacts: FileEntry[] } {
  const questionsName = `${slug}-questions.md`.toLowerCase();
  let questions: FileEntry | null = null;
  let diary: FileEntry | null = null;
  const artifacts: FileEntry[] = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (name === questionsName && !questions) questions = file;
    else if (name === "memory.md" && !diary) diary = file;
    else artifacts.push(file);
  }
  return { questions, diary, artifacts };
}

/** A phase folder's per-unit folders: the ones that are not themselves a stage of that phase. */
export function unitFolders(dirs: string[], phaseSlugs: ReadonlySet<string>): string[] {
  return dirs.filter((dir) => !phaseSlugs.has(dir));
}

/** A reviews/ folder's review-NN.md files, in order. */
export function reviewFiles(files: FileEntry[]): FileEntry[] {
  return files
    .filter((file) => /^review-\d+\.md$/i.test(file.name))
    .sort((a, b) => Number(/\d+/.exec(a.name)?.[0]) - Number(/\d+/.exec(b.name)?.[0]));
}

export interface IntentInput {
  space: string;
  record: string;
  registry: RegistryRow | null;
  state: ParsedState | null;
  stateMtimeMs: number | null;
}

function updatedAt(input: IntentInput): string | null {
  const stated = input.state?.recognized ? isoOf(input.state.lastUpdated) : null;
  return stated ?? iso(input.stateMtimeMs);
}

function summaryFields(input: IntentInput, status: IntentStatus) {
  const state = input.state?.recognized ? input.state : null;
  const current = currentRow(state, status);
  return {
    label: intentLabel(input.record, input.registry),
    scope: state?.scope || input.registry?.scope || "unknown",
    depth: state?.depth || "unknown",
    phase: state?.lifecyclePhase || "unknown",
    current_stage: current?.slug ?? null,
    current_stage_name: current ? titleCase(current.slug) : null,
    description: state?.project ?? "",
  };
}

/** One intent for the Inbox, the picker and the space counts. */
export function intentSummary(input: IntentInput, currentOpenAnswers: number): IntentSummary {
  const status = intentStatus(input.state, input.registry);
  const needs = intentNeeds(input.state, status, currentOpenAnswers);
  const counts = stageCounts(input.state);
  const fields = summaryFields(input, status);
  return {
    space: input.space,
    record: input.record,
    label: fields.label,
    scope: fields.scope,
    depth: fields.depth,
    phase: fields.phase,
    current_stage: fields.current_stage,
    current_stage_name: fields.current_stage_name,
    status,
    group: intentGroup(status, needs),
    needs,
    stages_done: counts.done,
    stages_total: counts.total,
    updated_at: updatedAt(input),
    description: fields.description,
  };
}

/** The space to show when none is asked for: the checkout's cursor, else default, else the first. */
export function chooseSpace(names: string[], cursor: string | null): string {
  if (cursor && names.includes(cursor)) return cursor;
  if (names.includes("default")) return "default";
  return names[0] ?? "";
}

/**
 * The intent to open first: the checkout's active-intent cursor when it names
 * a record (by folder, registry slug or uuid); else the only intent not
 * archived; else the running one updated last; else none.
 */
export function selectIntent(intents: IntentSummary[], cursor: string | null, registry: RegistryRow[] | null): string | null {
  const records = new Set(intents.map((intent) => intent.record));
  if (cursor) {
    if (records.has(cursor)) return cursor;
    const row = registry?.find((each) => (each.slug === cursor || each.uuid === cursor) && records.has(each.dirName));
    if (row) return row.dirName;
  }
  const live = intents.filter((intent) => intent.status !== "archived");
  if (live.length === 1) return live[0].record;
  const running = intents
    .filter((intent) => intent.status === "running")
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.record.localeCompare(a.record));
  return running[0]?.record ?? null;
}

export function workspacePayload(input: {
  project: string;
  space: string;
  spaces: SpaceSummary[];
  intents: IntentSummary[];
  cursor: string | null;
  registry: RegistryRow[] | null;
}): WorkspacePayload {
  const intents = [...input.intents].sort(
    (a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.record.localeCompare(a.record),
  );
  return {
    project: input.project,
    space: input.space,
    spaces: input.spaces,
    intents,
    selected_intent: selectIntent(intents, input.cursor, input.registry),
    sentence: inboxSentence(intents.filter((intent) => intent.needs !== null).length),
  };
}

export function spaceSummary(name: string, intents: IntentSummary[]): SpaceSummary {
  return { name, intents: intents.length, needs_you: intents.filter((intent) => intent.group === "needs-you").length };
}

/** 1 + the revisions since the stage (or unit) last started; every revision when the record has no start row. */
function revisionOf(marker: Marker, facts: StageFacts | undefined): number {
  if (facts?.started) return facts.revision;
  return ["-", "?", "R", "x"].includes(marker) ? 1 + (facts?.revisingTotal ?? 0) : 0;
}

/** A team unit's word, by the same rules as a stage's, for the marker it shows. */
function cellWord(marker: Marker, open: number, status: IntentStatus): StageWord {
  if (ended(status) && OPEN_MARKERS.has(marker)) return "stopped";
  switch (marker) {
    case "x":
      return "done";
    case "-":
      return open > 0 ? "questions" : "current";
    case "?":
      return "in-review";
    case "R":
      return "revising";
    case "S":
      return "skipped";
    default:
      return "later";
  }
}

function unitRows(table: UnitProgressTable | null, status: IntentStatus): UnitProgressRow[] {
  return (table?.rows ?? []).map((row) => ({
    unit: row.unit,
    owner: row.owner,
    cells: (table?.stages ?? []).map((stage) => ({ stage, marker: row.cells[stage] ?? null })),
    gate: row.gate,
    needs_you: !ended(status) && unitAwaits(row),
  }));
}

export interface WorkflowInput extends IntentInput {
  events: OrderedEvent[];
  /** What each stage's folders hold, by stage slug. */
  stages: Map<string, StageInputs>;
  /** The space's codekb/ files, Reverse Engineering's deliverables. */
  codekb: FileRef[];
  notes: string[];
}

export function workflowPayload(input: WorkflowInput): WorkflowPayload {
  const state = input.state?.recognized ? input.state : null;
  const status = intentStatus(input.state, input.registry);
  const facts = stageFacts(input.events);
  const unitFacts = unitStageFacts(input.events);
  const phaseReasons = phaseSkipReasons(input.events);
  const current = currentRow(state, status);
  const nextSlug = nextRow(state, status)?.slug ?? null;
  const table = state?.unitProgress ?? null;
  const counts = stageCounts(state);
  const fields = summaryFields(input, status);
  let currentOpen = 0;
  let currentSentence: StatusSentence | null = null;

  const buildStage = (row: StateRow): WorkflowStage => {
    const stageFact = facts.get(row.slug);
    const files = input.stages.get(row.slug) ?? { questions: null, artifacts: [], diary: null, reviews: [], units: [] };
    const isCurrent = current?.slug === row.slug;
    const unitInputs = new Map(files.units.map((unit) => [unit.unit, unit]));
    const open =
      (files.questions ? openAnswers(files.questions.parsed) : 0) +
      files.units.reduce((sum, unit) => sum + (unit.questions ? openAnswers(unit.questions.parsed) : 0), 0);
    const word = stageWord(row, isCurrent, open, nextSlug, status);
    const revision = revisionOf(row.marker, stageFact);
    const phaseReason = phaseReasons.get(row.phase) ?? null;
    const reason = word === "skipped" ? (stageFact?.skipReason ?? null) : word === "not-in-plan" ? phaseReason : null;
    const decidedAt = stageFact?.decidedAt ?? null;
    const columns = table?.stages.includes(row.slug) ? table.rows : [];
    const unitNames = [...columns.map((unitRow) => unitRow.unit), ...[...unitInputs.keys()].filter((unit) => !columns.some((each) => each.unit === unit)).sort()];
    const unitStates = unitNames.map((unit) => {
      const folder = unitInputs.get(unit);
      const tableRow = columns.find((each) => each.unit === unit);
      const marker = tableRow?.cells[row.slug] ?? null;
      const awaiting = table !== null && tableRow !== undefined && unitAwaitsAt(tableRow, table, row.slug);
      // The unit-end gate waits on a unit whose cell already reads [x].
      const shown: Marker | null = awaiting ? "?" : marker;
      const unitOpen = folder?.questions ? openAnswers(folder.questions.parsed) : 0;
      const unitFact = unitFacts.get(unitFactKey(row.slug, unit));
      const unitRevision = shown ? revisionOf(shown, unitFact) : 0;
      const unitWord = shown ? cellWord(shown, unitOpen, status) : null;
      const unitReason = unitWord === "skipped" ? (unitFact?.skipReason ?? null) : null;
      const value: StageUnit = {
        unit,
        questions: folder?.questions ? summarizeQuestions(folder.questions.path, folder.questions.parsed) : null,
        artifacts: folder?.artifacts ?? [],
        diary: folder?.diary ?? null,
        marker,
        word: unitWord,
        label: unitWord && shown ? stageLabel(unitWord, unitRevision, unitReason, shown) : null,
        sentence: unitWord && shown ? stageSentence(unitWord, unitRevision, unitFact?.decidedAt ?? null, false, shown) : null,
      };
      return { value, revision: unitRevision, awaiting: awaiting && !ended(status) };
    });
    const units = unitStates.map((each) => each.value);
    // A stage reads "Awaiting your review" for a unit of it that waits, at that unit's revision.
    const awaitingUnit = unitStates.find((each) => each.awaiting);
    const ran = row.marker !== " " && row.marker !== "S";
    const artifacts = row.slug === CODEKB_STAGE && ran ? [...files.artifacts, ...input.codekb] : files.artifacts;
    const produced = files.questions !== null || artifacts.length > 0 || units.some((unit) => unit.questions || unit.artifacts.length > 0);
    let hint: string | null = null;
    if (!produced) {
      if (word === "skipped") hint = `${capitalize(reason ?? "skipped")} — nothing produced.`;
      else if (word === "not-in-plan") hint = `${capitalize(reason ?? "not in this plan")} — nothing produced.`;
      else if (word === "next" || word === "later") hint = "Not started yet; nothing produced.";
    }
    const lineRevision = awaitingUnit && word !== "in-review" ? awaitingUnit.revision : revision;
    const sentence = stageSentence(word, lineRevision, decidedAt, awaitingUnit !== undefined, row.marker);
    if (isCurrent) {
      currentOpen = open;
      currentSentence = sentence;
    }
    return {
      slug: row.slug,
      name: titleCase(row.slug),
      marker: row.marker,
      scope: row.scope,
      word,
      label: stageLabel(word, revision, reason, row.marker),
      reason,
      revision,
      decided_at: decidedAt,
      is_current: isCurrent,
      questions: files.questions ? summarizeQuestions(files.questions.path, files.questions.parsed) : null,
      artifacts,
      diary: files.diary,
      reviews: files.reviews,
      units,
      sentence,
      hint,
    };
  };

  const phaseNames = state ? [...state.phases, ...new Set(state.rows.map((row) => row.phase).filter((phase) => !state.phases.includes(phase)))] : [];
  const phases: WorkflowPhase[] = phaseNames.map((phase) => {
    const stages = (state?.rows ?? []).filter((row) => row.phase === phase).map(buildStage);
    const notInPlan = stages.filter((stage) => stage.word === "not-in-plan").length;
    const progress = state && Object.hasOwn(state.phaseProgress, phase) ? state.phaseProgress[phase] : null;
    const wholePhase = stages.length > 0 && notInPlan === stages.length;
    return {
      name: phase ? titleCase(phase) : "Other",
      status: progress || null,
      skipped_reason: (wholePhase || progress?.toLowerCase() === "skipped") ? (phaseReasons.get(phase) ?? null) : null,
      stages,
      not_in_plan: notInPlan,
      not_in_plan_label: notInPlanLabel(notInPlan, wholePhase),
    };
  });

  const needs = intentNeeds(state, status, currentOpen);
  let sentence = intentSentence(status, state, currentSentence);
  // A unit's review can wait at a stage other than Current Stage; the
  // intent's line then says so, as the Inbox does.
  if (needs?.kind === "gate" && sentence.tone !== "needs") {
    const stages = phases.flatMap((phase) => phase.stages);
    sentence =
      stages.flatMap((stage) => stage.units.map((unit) => unit.sentence)).find((line) => line?.tone === "needs") ??
      stages.map((stage) => stage.sentence).find((line) => line.tone === "needs") ??
      AWAITING;
  }
  return {
    space: input.space,
    intent: input.record,
    label: fields.label,
    scope: fields.scope,
    depth: fields.depth,
    phase: fields.phase,
    status,
    current_stage: fields.current_stage,
    next_stage: nextSlug,
    stages_done: counts.done,
    stages_total: counts.total,
    needs,
    sentence,
    phases,
    updated_at: updatedAt(input),
    description: fields.description,
    stages_skipped: counts.skipped,
    unit_progress: unitRows(table, status),
    notes: input.notes,
  };
}

export interface ReviewInput {
  stage: string;
  unit: string | null;
  file: FileEntry;
  text: string | null;
}

const reviewField = (name: string) => new RegExp(`^\\*\\*${name}(?::\\*\\*|\\*\\*[ \\t]*:)[ \\t]*(.+)$`, "im");
const VERDICT_LINE = reviewField("Verdict");
const DATE_LINE = reviewField("Date");

/**
 * A review copy's `**Verdict:**` and `**Date:**` lines, as the reviewers'
 * template writes them (contract.test.ts reads the template); null for a line
 * the file lacks.
 */
export function reviewHeader(text: string): { verdict: string | null; date: string | null } {
  return { verdict: VERDICT_LINE.exec(text)?.[1].trim() || null, date: DATE_LINE.exec(text)?.[1].trim() || null };
}

/** A reviews/review-NN.md file as a timeline entry: its number and verdict. */
export function reviewEntry(review: ReviewInput): TimelineEntry {
  const number = Number(/\d+/.exec(review.file.name)?.[0] ?? "0");
  const { verdict, date } = review.text ? reviewHeader(review.text) : { verdict: null, date: null };
  const at = (date ? isoOf(date) : null) ?? iso(review.file.mtimeMs);
  return {
    at,
    kind: "review",
    event: "REVIEW",
    stage: review.stage,
    unit: review.unit,
    title: verdict ? `Review ${number} · ${verdict}` : `Review ${number}`,
    summary: null,
    question: null,
    order_unknown: false,
    path: review.file.rel,
    sortTime: at ? Date.parse(at) : Number.NEGATIVE_INFINITY,
    seq: Number.MAX_SAFE_INTEGER,
  };
}

/** The Decisions panel: audit entries and review verdicts, newest first, for one stage (and unit) or all. */
export function decisionsPayload(input: {
  space: string;
  intent: string;
  timeline: TimelineEntry[];
  reviews: ReviewInput[];
  stage?: string;
  unit?: string;
  notes: string[];
}): DecisionsPayload {
  const all = [...input.timeline, ...input.reviews.map(reviewEntry)];
  const chosen = all.filter(
    (entry) => (input.stage === undefined || entry.stage === input.stage) && (input.unit === undefined || entry.unit === input.unit),
  );
  chosen.sort((a, b) => b.sortTime - a.sortTime || b.seq - a.seq);
  const entries: DecisionEntry[] = chosen.map(({ sortTime: _sortTime, seq: _seq, ...entry }) => ({
    ...entry,
    stage_name: titleCase(entry.stage),
  }));
  return { space: input.space, intent: input.intent, entries, notes: input.notes };
}
