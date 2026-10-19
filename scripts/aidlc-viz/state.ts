// Parses an intent's `aidlc-state.md` (template:
// core/knowledge/aidlc-shared/state-template.md). Pure string parsing that
// never throws: a missing field reads "unknown" and a malformed stage line is
// skipped, so a partly written state file still renders.

export type StageState = "pending" | "in-progress" | "awaiting-approval" | "revising" | "completed" | "skipped";

/** The EXECUTE/SKIP label after a stage line; "unknown" when the line has none. */
export type StageScope = "EXECUTE" | "SKIP" | "unknown";

export interface StageEntry {
  slug: string;
  state: StageState;
  /** Lowercased phase heading the stage sits under ("" before any heading). */
  phase: string;
  scope: StageScope;
}

export interface ParsedState {
  title: string;
  scope: string;
  phase: string;
  currentStage: string;
  status: string;
  stages: StageEntry[];
}

export interface Progress {
  done: number;
  total: number;
  /** done / total, or 0 when total is 0. */
  fraction: number;
}

export interface GraphStage {
  slug: string;
  name: string;
  scope: StageScope;
  state: StageState;
  /** False for SKIP and unlabelled stages, which the view greys out. */
  inFlow: boolean;
  /** What the stage card says: the checkbox marker and state, or that it is not part of this flow. */
  label: string;
}

export interface GraphPhase {
  phase: string;
  stages: GraphStage[];
}

export const PHASE_ORDER = ["initialization", "ideation", "inception", "construction", "operation"];

export const NOT_IN_FLOW_LABEL = "Not part of this flow";

const STATE_DISPLAY: Record<StageState, { marker: string; label: string }> = {
  pending: { marker: "[ ]", label: "Pending" },
  "in-progress": { marker: "[-]", label: "In progress" },
  "awaiting-approval": { marker: "[?]", label: "Awaiting approval" },
  revising: { marker: "[R]", label: "Revising" },
  completed: { marker: "[x]", label: "Completed" },
  skipped: { marker: "[S]", label: "Skipped" },
};

/** The state a checkbox marker (the character between the brackets) encodes, or null for an unknown marker. */
export function markerToState(marker: string): StageState | null {
  switch (marker) {
    case "":
    case " ":
      return "pending";
    case "-":
      return "in-progress";
    case "?":
      return "awaiting-approval";
    case "R":
    case "r":
      return "revising";
    case "x":
    case "X":
      return "completed";
    case "S":
    case "s":
      return "skipped";
    default:
      return null;
  }
}

// "- [x] code-generation — EXECUTE" or "- [ ] market-research - SKIP: reason".
// The separator may be an em dash, en dash, or hyphen, and the label is
// optional so an unlabelled line still parses.
const STAGE_LINE = /^\s*-\s*\[(.?)\]\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*[—–-]\s*([A-Za-z]+))?/;
const PHASE_HEADING = /^#{2,}\s+([A-Z][A-Za-z-]*)\s+PHASE\s*$/;

function readField(text: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`\\*\\*${escaped}\\*\\*\\s*:[ \\t]*(.*)`, "i"));
  return match ? match[1].trim() : "";
}

function toScope(raw: string | undefined): StageScope {
  const upper = (raw ?? "").toUpperCase();
  return upper === "EXECUTE" || upper === "SKIP" ? upper : "unknown";
}

export function parseState(text: string): ParsedState {
  const stages: StageEntry[] = [];
  let phase = "";
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(PHASE_HEADING);
    if (heading) {
      phase = heading[1].toLowerCase();
      continue;
    }
    const stage = line.match(STAGE_LINE);
    const state = stage ? markerToState(stage[1]) : null;
    if (stage && state) stages.push({ slug: stage[2], state, phase, scope: toScope(stage[3]) });
  }
  return {
    title: readField(text, "Project"),
    scope: readField(text, "Scope") || "unknown",
    phase: readField(text, "Lifecycle Phase") || "unknown",
    currentStage: readField(text, "Current Stage") || "unknown",
    status: readField(text, "Status") || "unknown",
    stages,
  };
}

/**
 * Progress over the stages the plan executes. SKIP and unlabelled stages are
 * out of both numerator and denominator, so a finished plan reads 100%
 * however many stages its scope skipped. An EXECUTE stage later skipped by a
 * jump (`[S]`) is resolved, so it counts as done.
 */
export function computeProgress(stages: StageEntry[]): Progress {
  const inFlow = stages.filter((s) => s.scope === "EXECUTE");
  const done = inFlow.filter((s) => s.state === "completed" || s.state === "skipped").length;
  return { done, total: inFlow.length, fraction: inFlow.length === 0 ? 0 : done / inFlow.length };
}

function displayName(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Stages grouped into phase columns: the five known phases in lifecycle
 * order, then any other phase in the order it first appears. Stages keep
 * their file order within a phase.
 */
export function buildGraph(stages: StageEntry[]): GraphPhase[] {
  const byPhase = new Map<string, StageEntry[]>();
  for (const stage of stages) byPhase.set(stage.phase, [...(byPhase.get(stage.phase) ?? []), stage]);
  const names = [
    ...PHASE_ORDER.filter((p) => byPhase.has(p)),
    ...[...byPhase.keys()].filter((p) => !PHASE_ORDER.includes(p)),
  ];
  return names.map((phase) => ({
    phase,
    stages: (byPhase.get(phase) ?? []).map((s) => {
      const inFlow = s.scope === "EXECUTE";
      const display = STATE_DISPLAY[s.state];
      return {
        slug: s.slug,
        name: displayName(s.slug),
        scope: s.scope,
        state: s.state,
        inFlow,
        label: inFlow ? `${display.marker} ${display.label}` : NOT_IN_FLOW_LABEL,
      };
    }),
  }));
}
