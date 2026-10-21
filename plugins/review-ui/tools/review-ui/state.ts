// Reads an intent's aidlc-state.md, the format the state template
// (core/knowledge/aidlc-shared/state-template.md) and the guide's "State
// Tracking and Audit Trail" chapter document. Pure and forgiving: a missing
// field reads "", a malformed row is skipped, and nothing here throws, so a
// half-written or conflicted state file still shows what it can.
import type { Marker, StageScope } from "./types.ts";

/** The labels read, by the template section that defines each; contract.test.ts checks them against the template. */
export const STATE_FIELDS = {
  "Project Information": ["Project", "Scope"],
  "Scope Configuration": ["Depth"],
  "Execution Plan Summary": ["Total Stages", "Completed"],
  "Current Status": ["Lifecycle Phase", "Current Stage", "Next Stage", "Status", "Last Updated"],
} as const;

/** The other template sections read, and the Unit Progress columns read by name. */
export const STATE_SECTIONS = ["Phase Progress", "Stage Progress", "Unit Progress"] as const;
export const UNIT_PROGRESS_COLUMNS = ["unit", "owner", "gate"] as const;

/** The six checkbox markers of the template's Stage Progress legend. */
export const MARKERS: readonly Marker[] = [" ", "-", "?", "R", "x", "S"];

export interface StateRow {
  slug: string;
  marker: Marker;
  scope: StageScope;
  /** The phase heading the row sits under, lower case ("construction"); "" before any. */
  phase: string;
}

export interface UnitProgressTableRow {
  unit: string;
  owner: string | null;
  /** Stage slug to the cell's marker; null for a cell that is not a checkbox. */
  cells: Record<string, Marker | null>;
  gate: Marker | null;
}

export interface UnitProgressTable {
  /** The per-unit stage columns, in table order. */
  stages: string[];
  rows: UnitProgressTableRow[];
}

export interface ParsedState {
  /** False when the text holds none of the template's fields or rows (empty, binary, foreign). */
  recognized: boolean;
  project: string;
  scope: string;
  depth: string;
  lifecyclePhase: string;
  currentStage: string;
  nextStage: string;
  status: string;
  lastUpdated: string;
  totalStages: string;
  completed: string;
  /** Phase heading names in file order, lower case. */
  phases: string[];
  rows: StateRow[];
  /** Phase Progress values by lower-case phase name. */
  phaseProgress: Record<string, string>;
  unitProgress: UnitProgressTable | null;
}

// Each pattern below runs on one line of a file anyone can commit, so each
// matches a line in only one way: a pattern that can split the same text
// several ways retries every split before it fails, which takes minutes on a
// line of a few thousand characters. The `s` flag lets the final `.*` reach
// the end of a line holding U+2028, so it never backs into the blanks before it.
//
// `- **Name**: value` or `**Name**: value`, anchored at the line start. The
// value never runs onto the next line, so an empty field stays empty.
const FIELD_LINE = /^(?:[-*+][ \t]+)?\*\*([^*\n]+?)\*\*[ \t]*:[ \t]*(.*)$/s;
const HEADING = /^(#{1,6})[ \t]+(.*)$/s;
// A run of emoji before a heading's words is decoration ("### 🏗️ CONSTRUCTION PHASE").
// The lookahead takes the longest run once, so a run with no blank after it
// fails at once instead of retrying every way of splitting it.
const LEADING_EMOJI = /^(?=(\p{RGI_Emoji}(?:\u200D?\p{RGI_Emoji})*))\1[ \t]+/v;
const PHASE_NAME = /^[A-Za-z][A-Za-z -]*$/;
const ROW = /^[ \t]*[-*+][ \t]+\[([^\]\n]?)\][ \t]+(\S+)(.*)$/s;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// The label after the separator: an em dash, an en dash, or a spaced hyphen.
// Whatever follows it (": reason") is ignored.
const ROW_LABEL = /^[ \t]*(?:[—–]|-(?=[ \t]))[ \t]*(EXECUTE|SKIP)\b/i;
const TABLE_SEPARATOR = /^:?-{3,}:?$/;

/** A checkbox character in its canonical form, or null when it is not one of the six. */
export function toMarker(raw: string): Marker | null {
  switch (raw) {
    case "":
    case " ":
      return " ";
    case "-":
      return "-";
    case "?":
      return "?";
    case "R":
    case "r":
      return "R";
    case "x":
    case "X":
      return "x";
    case "S":
    case "s":
      return "S";
    default:
      return null;
  }
}

/** Heading text with any leading emoji decoration removed. */
export function headingKey(title: string): string {
  return title.replace(LEADING_EMOJI, "").trim();
}

/**
 * The text without the characters `drop` accepts at its end, in one pass from
 * the end. An end-anchored pattern such as /[:,]+$/ starts again at every
 * character of a run that is not at the end, which is quadratic in the run.
 */
export function trimEndWhere(text: string, drop: (char: string) => boolean): string {
  let end = text.length;
  while (end > 0 && drop(text[end - 1])) end--;
  return text.slice(0, end);
}

const isBlank = (char: string): boolean => char === " " || char === "\t";

/** An ATX heading's text without its closing run of '#' and the blanks around it. */
function headingTitle(text: string): string {
  return trimEndWhere(
    trimEndWhere(trimEndWhere(text, isBlank), (char) => char === "#"),
    isBlank,
  );
}

/** The phase a "<Name> PHASE" heading names (any letter case), in lower case; null for any other heading. */
function phaseOf(title: string): string | null {
  if (title.slice(-5).toLowerCase() !== "phase") return null;
  const head = title.slice(0, -5);
  const name = trimEndWhere(head, isBlank);
  return name.length < head.length && PHASE_NAME.test(name) ? name.toLowerCase() : null;
}

function tableCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((cell) => cell.trim());
}

function cellMarker(cell: string | undefined): Marker | null {
  const match = /^\[([^\]]?)\]$/.exec(cell ?? "");
  return match ? toMarker(match[1]) : null;
}

function parseUnitProgress(lines: string[]): UnitProgressTable | null {
  const start = lines.findIndex((line) => /^##[ \t]+Unit Progress[ \t]*$/i.test(line));
  if (start < 0) return null;
  const table: string[][] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##[ \t]/.test(lines[i])) break;
    if (/^[ \t]*\|/.test(lines[i])) table.push(tableCells(lines[i]));
  }
  const header = (table[0] ?? []).map((cell) => cell.toLowerCase());
  const unitAt = header.indexOf("unit");
  if (unitAt < 0) return { stages: [], rows: [] };
  const ownerAt = header.indexOf("owner");
  const gateAt = header.indexOf("gate");
  const first = Math.max(unitAt, ownerAt) + 1;
  const end = gateAt > first ? gateAt : header.length;
  const stageColumns: Array<{ slug: string; at: number }> = [];
  for (let at = first; at < end; at++) {
    if (SLUG.test(header[at] ?? "") && header[at] !== "merged") stageColumns.push({ slug: header[at], at });
  }
  const rows: UnitProgressTableRow[] = [];
  for (const cells of table.slice(1)) {
    if (cells.every((cell) => TABLE_SEPARATOR.test(cell))) continue;
    const unit = cells[unitAt] ?? "";
    if (!unit) continue;
    const owner = ownerAt >= 0 ? (cells[ownerAt] ?? "") : "";
    const row: UnitProgressTableRow = {
      unit,
      owner: owner && owner !== "-" ? owner : null,
      cells: {},
      gate: gateAt >= 0 ? cellMarker(cells[gateAt]) : null,
    };
    for (const column of stageColumns) row.cells[column.slug] = cellMarker(cells[column.at]);
    rows.push(row);
  }
  return { stages: stageColumns.map((column) => column.slug), rows };
}

export function parseState(text: string): ParsedState {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const fields = new Map<string, string>();
  const phases: string[] = [];
  const rows: StateRow[] = [];
  const phaseProgress: Record<string, string> = {};
  let section = "";
  let phase = "";
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = headingKey(headingTitle(heading[2]));
      const named = level >= 2 ? phaseOf(title) : null;
      if (named) {
        phase = named;
        if (!phases.includes(phase)) phases.push(phase);
      } else if (level <= 2) {
        section = title.toLowerCase();
        phase = "";
      }
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (field) {
      const name = field[1].trim().toLowerCase();
      const value = field[2].trim();
      if (!fields.has(name)) fields.set(name, value);
      if (section === "phase progress" && !Object.hasOwn(phaseProgress, name)) phaseProgress[name] = value;
      continue;
    }
    if (!phase && section !== "stage progress") continue;
    const row = ROW.exec(line);
    if (!row) continue;
    const marker = toMarker(row[1]);
    const token = row[2];
    const dash = token.search(/[—–]/);
    const slug = trimEndWhere(dash >= 0 ? token.slice(0, dash) : token, (char) => char === ":" || char === ",");
    if (marker === null || !SLUG.test(slug)) continue;
    const rest = (dash >= 0 ? token.slice(dash) : "") + row[3];
    const label = ROW_LABEL.exec(rest);
    rows.push({ slug, marker, scope: label ? (label[1].toUpperCase() as "EXECUTE" | "SKIP") : "unknown", phase });
  }
  const read = (name: string): string => fields.get(name.toLowerCase()) ?? "";
  const known = Object.values(STATE_FIELDS).flat();
  return {
    recognized: rows.length > 0 || known.some((name) => fields.has(name.toLowerCase())),
    project: read("Project"),
    scope: read("Scope"),
    depth: read("Depth"),
    lifecyclePhase: read("Lifecycle Phase"),
    currentStage: read("Current Stage"),
    nextStage: read("Next Stage"),
    status: read("Status"),
    lastUpdated: read("Last Updated"),
    totalStages: read("Total Stages"),
    completed: read("Completed"),
    phases,
    rows,
    phaseProgress,
    unitProgress: parseUnitProgress(lines),
  };
}
