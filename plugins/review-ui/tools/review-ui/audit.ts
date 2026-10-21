// Reads an intent's audit shards, the format the event registry
// (core/knowledge/aidlc-shared/audit-format.md) and the guide's "Rules and the
// Learning Loop" and "State Tracking and Audit Trail" chapters document. A
// shard is Markdown blocks split by lines that are exactly `---`, each with
// `**Field**: value` lines. This module owns what the events mean for the
// person: the Decisions timeline, when a stage was decided, why it was
// skipped, and which revision it is on. Pure and forgiving: an unreadable
// block is left out and nothing here throws.
import type { DecisionEntry, DecisionKind } from "./types.ts";

/** Each event read, with the fields read from it; contract.test.ts checks them against the registry. */
export const AUDIT_READS = {
  STAGE_STARTED: ["Stage"],
  STAGE_AWAITING_APPROVAL: ["Stage"],
  STAGE_REVISING: ["Stage"],
  STAGE_COMPLETED: ["Stage"],
  STAGE_SKIPPED: ["Stage", "Reason"],
  PHASE_SKIPPED: ["Phase", "Reason"],
  DECISION_RECORDED: ["Stage", "Decision", "Options", "Unit"],
  QUESTION_ANSWERED: ["Stage", "Details", "Unit", "Person Reply"],
  QUESTION_REPLIED: ["Question", "Reply"],
  SUMMARY_CONFIRMATION_RECORDED: ["Stage", "Details", "Unit", "Feedback"],
  PLAN_APPROVAL_RECORDED: ["Stage", "Person Reply"],
  PLAN_APPROVAL_SKIPPED: ["Stage", "Source", "Unit"],
  VERIFICATION_COMMAND_RECORDED: ["Stage", "Command Label"],
  CONSTRUCTION_POLICY_RECORDED: ["Stage", "Field", "Value"],
  GATE_APPROVED: ["Stage", "User Input", "Person Reply", "Unit"],
  GATE_REJECTED: ["Stage", "Feedback", "Unit"],
  UNIT_STARTED: ["Stage", "Unit"],
  UNIT_COMPLETED: ["Stage", "Unit"],
  UNIT_SKIPPED: ["Stage", "Unit", "Reason"],
  SCOPE_CHANGED: [],
  RECOMPOSED: [],
} as const satisfies Record<string, readonly string[]>;

export type AuditEventName = keyof typeof AUDIT_READS;

export interface AuditEvent {
  event: string;
  /** The block's first Timestamp, as written; older blocks can carry a second one. */
  timestamp: string | null;
  /** Date.parse of the timestamp; null when it does not parse. */
  time: number | null;
  /** The shard's place among the record's shards (sorted by file name). */
  shard: number;
  /** The block's place in its shard. */
  index: number;
  /** The first value of each field, by lower-case name. */
  fields: Map<string, string>;
}

export interface OrderedEvent extends AuditEvent {
  /** The time the event sorts by: its own, else the last one before it in its shard. */
  sortTime: number;
}

// The `s` flag lets the final `.*` reach the end of a line that holds U+2028,
// so it never backs into the blanks before it.
const FIELD = /^\*\*([^*\n]+?)\*\*[ \t]*:[ \t]*(.*)$/s;
const EVENT_NAME = /^[A-Z][A-Z0-9_]*$/;

export function parseShard(text: string, shard: number): AuditEvent[] {
  const events: AuditEvent[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/^---$/m);
  blocks.forEach((block, index) => {
    const fields = new Map<string, string>();
    for (const line of block.split("\n")) {
      const match = FIELD.exec(line);
      if (!match) continue;
      const name = match[1].trim().toLowerCase();
      if (!fields.has(name)) fields.set(name, match[2].trim());
    }
    const event = fields.get("event") ?? "";
    if (!EVENT_NAME.test(event)) return;
    const timestamp = fields.get("timestamp") || null;
    const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
    events.push({ event, timestamp, time: Number.isNaN(parsed) ? null : parsed, shard, index, fields });
  });
  return events;
}

/** A field's value, "" when the block has none. */
export function field(event: AuditEvent, name: string): string {
  return event.fields.get(name.toLowerCase()) ?? "";
}

/**
 * Every shard's events in one timeline: by time, then by shard, then by place
 * in the shard. An event whose timestamp does not parse keeps its neighbours'
 * place instead of jumping to either end.
 */
export function orderEvents(events: AuditEvent[]): OrderedEvent[] {
  const byShard = new Map<number, AuditEvent[]>();
  for (const event of events) {
    const list = byShard.get(event.shard);
    if (list) list.push(event);
    else byShard.set(event.shard, [event]);
  }
  const ordered: OrderedEvent[] = [];
  for (const shardEvents of byShard.values()) {
    let last = Number.NEGATIVE_INFINITY;
    for (const event of shardEvents.sort((a, b) => a.index - b.index)) {
      if (event.time !== null) last = event.time;
      ordered.push({ ...event, sortTime: event.time ?? last });
    }
  }
  return ordered.sort((a, b) => a.sortTime - b.sortTime || a.shard - b.shard || a.index - b.index);
}

function iso(time: number | null): string | null {
  return time === null ? null : new Date(time).toISOString();
}

export interface StageFacts {
  /** A STAGE_STARTED row exists for the stage. */
  started: boolean;
  /** 1 + the STAGE_REVISING rows since the stage last started; 0 before it starts. */
  revision: number;
  /** Every STAGE_REVISING row for the stage, for a record whose start row is missing. */
  revisingTotal: number;
  /** The latest GATE_APPROVED or GATE_REJECTED, else STAGE_COMPLETED or STAGE_SKIPPED. */
  decidedAt: string | null;
  /** The latest STAGE_SKIPPED Reason. */
  skipReason: string | null;
}

/** The events that start, send back, finish and skip what a set of facts is about. */
interface FactEvents {
  started: string;
  revised: string;
  completed: string;
  skipped: string;
}

const STAGE_EVENTS: FactEvents = { started: "STAGE_STARTED", revised: "STAGE_REVISING", completed: "STAGE_COMPLETED", skipped: "STAGE_SKIPPED" };
// The registry puts Unit on the UNIT_* rows and on the gate rows, not on
// STAGE_REVISING, so a unit's revisions are counted from its requests for
// changes.
const UNIT_EVENTS: FactEvents = { started: "UNIT_STARTED", revised: "GATE_REJECTED", completed: "UNIT_COMPLETED", skipped: "UNIT_SKIPPED" };

function collectFacts(ordered: OrderedEvent[], keyOf: (event: OrderedEvent) => string | null, names: FactEvents): Map<string, StageFacts> {
  const facts = new Map<string, StageFacts & { gateAt: string | null; endAt: string | null }>();
  for (const event of ordered) {
    const key = keyOf(event);
    if (key === null) continue;
    const entry = facts.get(key) ?? {
      started: false,
      revision: 0,
      revisingTotal: 0,
      decidedAt: null,
      skipReason: null,
      gateAt: null,
      endAt: null,
    };
    facts.set(key, entry);
    const name = event.event;
    if (name === names.started) {
      entry.started = true;
      entry.revision = 1;
    }
    if (name === names.revised) {
      entry.revisingTotal += 1;
      if (entry.started) entry.revision += 1;
    }
    if (name === "GATE_APPROVED" || name === "GATE_REJECTED") entry.gateAt = iso(event.time) ?? entry.gateAt;
    if (name === names.skipped) entry.skipReason = field(event, "Reason") || entry.skipReason;
    if (name === names.completed || name === names.skipped) entry.endAt = iso(event.time) ?? entry.endAt;
    entry.decidedAt = entry.gateAt ?? entry.endAt;
  }
  return new Map(
    [...facts].map(([key, { started, revision, revisingTotal, decidedAt, skipReason }]) => [
      key,
      { started, revision, revisingTotal, decidedAt, skipReason },
    ]),
  );
}

/** Each stage's facts, by stage slug, from every row that names the stage. */
export function stageFacts(ordered: OrderedEvent[]): Map<string, StageFacts> {
  return collectFacts(ordered, (event) => field(event, "Stage") || null, STAGE_EVENTS);
}

/** Where unitStageFacts keeps one unit's facts for one stage. */
export function unitFactKey(stage: string, unit: string): string {
  return `${stage}\u0000${unit}`;
}

/** Each team unit's facts for a stage, by unitFactKey, from the rows that name both. */
export function unitStageFacts(ordered: OrderedEvent[]): Map<string, StageFacts> {
  return collectFacts(
    ordered,
    (event) => {
      const stage = field(event, "Stage");
      const unit = field(event, "Unit");
      return stage && unit ? unitFactKey(stage, unit) : null;
    },
    UNIT_EVENTS,
  );
}

/**
 * The latest PHASE_SKIPPED Reason, by lower-case phase name, while it still
 * describes the plan. The engine writes these reasons only when the intent is
 * made, so a scope change or a recomposed plan leaves them stale.
 */
export function phaseSkipReasons(ordered: OrderedEvent[]): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const event of ordered) {
    if (event.event === "SCOPE_CHANGED" || event.event === "RECOMPOSED") {
      reasons.clear();
      continue;
    }
    if (event.event !== "PHASE_SKIPPED") continue;
    const phase = field(event, "Phase").toLowerCase();
    const reason = field(event, "Reason");
    if (phase && reason) reasons.set(phase, reason);
  }
  return reasons;
}

/** A timeline entry with what it sorts by, which the payload drops; model.ts adds the stage's display name. */
export interface TimelineEntry extends Omit<DecisionEntry, "stage_name"> {
  sortTime: number;
  seq: number;
}

const ANSWERS = new Set([
  "QUESTION_ANSWERED",
  "SUMMARY_CONFIRMATION_RECORDED",
  "PLAN_APPROVAL_RECORDED",
  "VERIFICATION_COMMAND_RECORDED",
  "CONSTRUCTION_POLICY_RECORDED",
]);

function optionsLine(options: string): string | null {
  const parts = options
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function summaryTitle(details: string): string {
  if (/^looks correct/i.test(details)) return "Summary confirmed";
  if (/^request changes/i.test(details)) return "Changes to the summary requested";
  return details || "Summary answered";
}

/** The person's own words when the row kept them and they add to the title. */
function theirWords(event: AuditEvent, title: string): string | null {
  const reply = field(event, "Person Reply");
  return reply && reply !== title ? reply : null;
}

/**
 * The Decisions timeline from the audit rows, oldest first. An answer is paired
 * per (stage, unit): it closes every question asked there since the answer
 * before it. Equal timestamps in different shards mark both entries
 * order-unknown, since two clones' clocks cannot order them.
 */
export function auditTimeline(ordered: OrderedEvent[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const openQuestions = new Map<string, string[]>();
  const revision = new Map<string, number>();
  let lastStage = "";
  ordered.forEach((event, seq) => {
    const stage = field(event, "Stage");
    if (stage) lastStage = stage;
    const unit = field(event, "Unit") || null;
    const key = `${stage}\u0000${unit ?? ""}`;
    const rev = (): number => revision.get(stage) ?? 1;
    const push = (kind: DecisionKind, title: string, summary: string | null, question: string | null = null): void => {
      entries.push({
        at: iso(event.time),
        kind,
        event: event.event,
        stage: stage || (event.event === "QUESTION_REPLIED" ? lastStage : ""),
        unit,
        title,
        summary,
        question,
        order_unknown: false,
        path: null,
        sortTime: event.sortTime,
        seq,
      });
    };
    if (ANSWERS.has(event.event)) {
      const asked = openQuestions.get(key) ?? [];
      openQuestions.delete(key);
      const question = asked.length > 0 ? asked.join(" · ") : null;
      switch (event.event) {
        case "QUESTION_ANSWERED": {
          const title = field(event, "Details") || "Answered";
          push("answered", title, theirWords(event, title), question);
          return;
        }
        case "SUMMARY_CONFIRMATION_RECORDED":
          push("answered", summaryTitle(field(event, "Details")), field(event, "Feedback") || null, question);
          return;
        case "PLAN_APPROVAL_RECORDED":
          push("answered", "Plan approved", theirWords(event, "Plan approved"), question);
          return;
        case "VERIFICATION_COMMAND_RECORDED":
          push("answered", "Verification command approved", field(event, "Command Label") || null, question);
          return;
        default: {
          const name = field(event, "Field");
          const value = field(event, "Value");
          push("answered", name && value ? `${name} set to ${value}` : "Construction setting approved", null, question);
          return;
        }
      }
    }
    switch (event.event) {
      case "STAGE_STARTED":
        if (stage) revision.set(stage, 1);
        return;
      case "DECISION_RECORDED": {
        const decision = field(event, "Decision") || "A question was asked";
        const waiting = openQuestions.get(key);
        if (waiting) waiting.push(decision);
        else openQuestions.set(key, [decision]);
        push("asked", decision, optionsLine(field(event, "Options")));
        return;
      }
      case "STAGE_AWAITING_APPROVAL":
        push("gate-opened", `Approval gate opened · r${rev()}`, null);
        return;
      case "QUESTION_REPLIED":
        push("reply", field(event, "Reply") || "You replied", null, field(event, "Question") || null);
        return;
      case "GATE_APPROVED": {
        const input = field(event, "User Input");
        const plain = /^approve\.?$/i.test(input) ? "" : input;
        push("approved", `Approved · r${rev()}`, field(event, "Person Reply") || plain || null);
        return;
      }
      case "GATE_REJECTED":
        push("changes-requested", `Changes requested · r${rev()}`, field(event, "Feedback") || null);
        return;
      case "STAGE_REVISING":
        if (stage) revision.set(stage, rev() + 1);
        push("revising", `Revising · r${rev()}`, null);
        return;
      case "STAGE_SKIPPED":
        push("skipped", "Skipped", field(event, "Reason") || null);
        return;
      case "PLAN_APPROVAL_SKIPPED":
        push("plan-approval-skipped", "Plan approval was off", field(event, "Source") || null);
        return;
    }
  });
  const shardsAt = new Map<number, Set<number>>();
  for (const entry of entries) {
    const { time, shard } = ordered[entry.seq];
    if (time !== null) shardsAt.set(time, (shardsAt.get(time) ?? new Set()).add(shard));
  }
  for (const entry of entries) {
    const { time } = ordered[entry.seq];
    if (time !== null && (shardsAt.get(time)?.size ?? 0) > 1) entry.order_unknown = true;
  }
  return entries;
}
