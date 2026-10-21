// The JSON contract between the server and the browser app, as it travels on
// the wire (snake_case). The README's HTTP API section documents the same
// shapes; change both together.

/** The character between a stage row's brackets in aidlc-state.md. */
export type Marker = " " | "-" | "?" | "R" | "x" | "S";

/** The row's plan label: EXECUTE, SKIP, or absent. */
export type StageScope = "EXECUTE" | "SKIP" | "unknown";

/** The one word a stage shows in the tree; the label adds detail to it. */
export type StageWord =
  | "done"
  | "questions"
  | "current"
  | "in-review"
  | "revising"
  | "next"
  | "later"
  | "skipped"
  | "not-in-plan"
  /** An archived (or completed) intent's stage left open: nothing waits on the person. */
  | "stopped";

/** needs: the person is waiting to act. ok: settled. quiet: nothing to do. */
export type Tone = "needs" | "ok" | "quiet";

export type IntentStatus = "running" | "completed" | "archived" | "unknown";

export type IntentGroup = "needs-you" | "in-progress" | "done" | "archived";

export interface Needs {
  kind: "gate" | "questions";
  /** "Review approval gate" or "N questions". */
  label: string;
}

export interface StatusSentence {
  text: string;
  tone: Tone;
  /** A time the browser shows after the text, formatted in the person's own time zone. */
  at?: string | null;
}

export interface Health {
  ok: true;
  version: string;
}

export interface SpaceSummary {
  name: string;
  intents: number;
  needs_you: number;
}

export interface IntentSummary {
  space: string;
  /** Record directory name, the intent's id in every route. */
  record: string;
  label: string;
  scope: string;
  depth: string;
  /** Lifecycle Phase as written, or "unknown". */
  phase: string;
  current_stage: string | null;
  /** The current stage's display name, the same as its WorkflowStage.name. */
  current_stage_name: string | null;
  status: IntentStatus;
  group: IntentGroup;
  needs: Needs | null;
  stages_done: number;
  stages_total: number;
  /** Last Updated, else the state file's mtime, as ISO 8601. */
  updated_at: string | null;
  /** The state file's one-line Project preview, "" when it has none. */
  description: string;
}

export interface WorkspacePayload {
  /** The project folder's name only, never its absolute path. */
  project: string;
  space: string;
  spaces: SpaceSummary[];
  intents: IntentSummary[];
  /** The intent to open first: the checkout's cursor when it names a record, else a rule (README). */
  selected_intent: string | null;
  /** The Inbox header line: "N items need you" or "Nothing waiting". */
  sentence: StatusSentence;
}

export type FileKind = "markdown" | "text" | "other";

export interface FileRef {
  /** Project-relative POSIX path starting with "aidlc/". */
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  mtime: string | null;
}

export interface QuestionsSummary {
  path: string;
  total: number;
  answered: number;
  open: number;
  /**
   * Open numbered questions plus open confirmation, approval and change-request
   * sections: the count Needs you, the stage word and the header line use.
   */
  open_answers: number;
  /** Confirmation and approval sections, in plain words, e.g. "summary confirmed". */
  sections: string[];
}

export interface StageUnit {
  unit: string;
  questions: QuestionsSummary | null;
  artifacts: FileRef[];
  diary: FileRef | null;
  /** Team mode: the unit's cell for this stage in the Unit Progress table; null otherwise. */
  marker: Marker | null;
  /** The cell's word and label, by the same rules as a stage's; null without a cell. */
  word: StageWord | null;
  label: string | null;
  /** Team mode: the header line while this unit is shown; null without a cell. */
  sentence: StatusSentence | null;
}

export interface WorkflowStage {
  slug: string;
  /** Title-cased slug, e.g. "Code Generation". */
  name: string;
  marker: Marker;
  scope: StageScope;
  word: StageWord;
  /** The word with its detail, e.g. "in review · r2" or "skipped · scope poc excludes it". */
  label: string;
  reason: string | null;
  /** 1 + the STAGE_REVISING rows since the stage last started; 0 before it starts. */
  revision: number;
  decided_at: string | null;
  is_current: boolean;
  questions: QuestionsSummary | null;
  artifacts: FileRef[];
  diary: FileRef | null;
  reviews: FileRef[];
  units: StageUnit[];
  /** The header line while this stage is shown. */
  sentence: StatusSentence;
  /** The row shown for a stage with no files: "Not started yet; nothing produced." or "<reason> — nothing produced."; null otherwise. */
  hint: string | null;
}

export interface WorkflowPhase {
  /** Title case, e.g. "Construction". */
  name: string;
  /** Phase Progress value (Pending, Active, Verified, Skipped), or null. */
  status: string | null;
  /** PHASE_SKIPPED reason when the whole phase is out of the plan. */
  skipped_reason: string | null;
  stages: WorkflowStage[];
  /** How many of this phase's stages are not in the plan (shown folded). */
  not_in_plan: number;
  /** The folded line, e.g. "3 more · not in poc scope"; null when every stage is in the plan. */
  not_in_plan_label: string | null;
}

/** One cell of the team-mode Unit Progress table. */
export interface UnitProgressCell {
  stage: string;
  marker: Marker | null;
}

/** One row of the team-mode Unit Progress table in aidlc-state.md. */
export interface UnitProgressRow {
  unit: string;
  /** The owner column, or null while it reads "-". */
  owner: string | null;
  cells: UnitProgressCell[];
  gate: Marker | null;
  /** A cell or the gate is awaiting the person's review ([?]). */
  needs_you: boolean;
}

export interface WorkflowPayload {
  space: string;
  intent: string;
  label: string;
  scope: string;
  depth: string;
  phase: string;
  status: IntentStatus;
  current_stage: string | null;
  next_stage: string | null;
  stages_done: number;
  stages_total: number;
  needs: Needs | null;
  sentence: StatusSentence;
  phases: WorkflowPhase[];
  updated_at: string | null;
  /** The state file's one-line Project preview, "" when it has none. */
  description: string;
  /** In-plan stages skipped while the work ran ([S]), shown apart from the done count. */
  stages_skipped: number;
  /** Team mode only; empty otherwise. */
  unit_progress: UnitProgressRow[];
  /** Plain-words notes about files left out, such as a state file over 4 MiB. */
  notes: string[];
}

export interface TreeEntry {
  path: string;
  name: string;
  type: "file" | "dir";
  /** Files only: how /api/render will show it. */
  kind?: FileKind;
  size?: number;
  mtime?: string;
}

export interface TreePayload {
  space: string;
  intent: string;
  root: "record" | "codekb";
  entries: TreeEntry[];
}

export interface OutlineItem {
  level: number;
  text: string;
  /** Always "md-" prefixed, unique within the document. */
  id: string;
}

export interface RenderPayload {
  path: string;
  kind: "markdown" | "text";
  html: string;
  outline: OutlineItem[];
  mtime: string | null;
}

export interface QuestionOption {
  letter: string;
  text: string;
}

export interface Question {
  number: number;
  title: string;
  /** The "[Developer]"-style label, when the heading has one. */
  role: string | null;
  /** The question's own text between the heading and the options, plain. */
  prompt: string;
  options: QuestionOption[];
  answer: string | null;
  /** The option letter the answer starts with, when it names one. */
  chosen: string | null;
  /** Every option letter the answer names: one, or several for "A, B, E". */
  chosen_all: string[];
  open: boolean;
}

export interface QuestionSection {
  title: string;
  state: "open" | "answered";
  answer: string | null;
  /** Plain-words line, e.g. "summary confirmed" or "waiting for your approval of the plan". */
  note: string;
}

export interface QuestionsPayload {
  path: string;
  stage: string;
  /** The stage's display name, the same as its WorkflowStage.name. */
  stage_name: string;
  questions: Question[];
  sections: QuestionSection[];
  total: number;
  answered: number;
  open: number;
  /** As in QuestionsSummary: open questions plus open sections. */
  open_answers: number;
  /** The header line while this file is shown: "N questions for you" or "Answered". */
  sentence: StatusSentence;
}

export type DecisionKind =
  | "asked"
  | "answered"
  | "reply"
  | "approved"
  | "changes-requested"
  | "gate-opened"
  | "revising"
  | "skipped"
  | "plan-approval-skipped"
  | "review";

export interface DecisionEntry {
  at: string | null;
  kind: DecisionKind;
  /** The audit event name, or "REVIEW" for a reviews/review-NN.md file. */
  event: string;
  stage: string;
  /** The stage's display name, the same as its WorkflowStage.name. */
  stage_name: string;
  unit: string | null;
  title: string;
  summary: string | null;
  /** For an answer: the question it closed. */
  question: string | null;
  /** Another shard has an event with the same timestamp, so the order between them is not known. */
  order_unknown: boolean;
  /** For a review: the file to open. */
  path: string | null;
}

export interface DecisionsPayload {
  space: string;
  intent: string;
  entries: DecisionEntry[];
  /** Plain-words notes about audit files left out, such as one over 4 MiB. */
  notes: string[];
}

export interface LiveMessage {
  type: "state";
}
