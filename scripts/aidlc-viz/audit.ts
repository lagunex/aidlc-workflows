// Selects the decision-bearing events from an intent's audit shards (format:
// core/knowledge/aidlc-shared/audit-format.md). A shard is Markdown blocks
// separated by `---` lines, each with `**Field**: value` lines.

export const DECISION_EVENTS = ["GATE_APPROVED", "GATE_REJECTED", "DECISION_RECORDED", "QUESTION_ANSWERED"] as const;

export type DecisionEvent = (typeof DECISION_EVENTS)[number];

export interface Decision {
  timestamp: string;
  event: DecisionEvent;
  stage: string;
  summary: string;
  /**
   * The question a QUESTION_ANSWERED entry answers: the latest unanswered
   * DECISION_RECORDED in the same stage. Also set on DECISION_RECORDED itself.
   */
  question?: string;
}

// The first match wins, which is what the audit format asks of whole-file
// readers: older blocks can carry a second Timestamp line.
function field(block: string, name: string): string {
  const match = block.match(new RegExp(`\\*\\*${name}\\*\\*\\s*:[ \\t]*(.*)`, "i"));
  return match ? match[1].trim() : "";
}

function isDecisionEvent(event: string): event is DecisionEvent {
  return (DECISION_EVENTS as readonly string[]).includes(event);
}

function questionText(block: string): string {
  const decision = field(block, "Decision");
  const options = field(block, "Options");
  return decision && options ? `${decision} (options: ${options})` : decision;
}

function summarize(event: DecisionEvent, block: string): string {
  switch (event) {
    case "GATE_APPROVED": {
      const input = field(block, "User Input");
      return input ? `Gate approved: ${input}` : "Gate approved";
    }
    case "GATE_REJECTED": {
      const feedback = field(block, "Feedback");
      return feedback ? `Gate rejected: ${feedback}` : "Gate rejected";
    }
    case "DECISION_RECORDED":
      return questionText(block) || "Decision recorded";
    case "QUESTION_ANSWERED": {
      const details = field(block, "Details");
      return details ? `Answered: ${details}` : "Question answered";
    }
  }
}

/**
 * Decision events from every shard, merged and sorted by timestamp. The sort
 * is stable, so events sharing a one-second timestamp keep shard order.
 */
export function parseDecisions(shards: string[]): Decision[] {
  const entries: Decision[] = [];
  for (const text of shards) {
    for (const block of text.split(/^---[ \t]*$/m)) {
      const event = field(block, "Event");
      if (!isDecisionEvent(event)) continue;
      const entry: Decision = {
        timestamp: field(block, "Timestamp"),
        event,
        stage: field(block, "Stage") || "unknown",
        summary: summarize(event, block),
      };
      if (event === "DECISION_RECORDED") {
        const question = questionText(block);
        if (question) entry.question = question;
      }
      entries.push(entry);
    }
  }
  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const openQuestion = new Map<string, string>();
  for (const entry of entries) {
    if (entry.event === "DECISION_RECORDED" && entry.question) {
      openQuestion.set(entry.stage, entry.question);
    } else if (entry.event === "QUESTION_ANSWERED") {
      const question = openQuestion.get(entry.stage);
      if (question) {
        entry.question = question;
        openQuestion.delete(entry.stage);
      }
    }
  }
  return entries;
}
