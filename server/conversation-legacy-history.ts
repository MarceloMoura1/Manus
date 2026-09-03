export type ConversationMessageChronology = "absolute" | "unknown";

export type ConversationHistoryMessage = Record<string, unknown> & {
  id?: string;
  timestamp?: string | Date | null;
  chronology: ConversationMessageChronology;
};

export type ConversationHistoryRead = {
  messages: ConversationHistoryMessage[];
  indeterminateHistory: ConversationHistoryMessage[];
};

const RFC3339_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/;

function nonEmptyId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Accepts only an unambiguous absolute instant; local or display-only time never enters the timeline sort. */
export function hasAbsoluteTimestamp(value: unknown) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === "string" && RFC3339_WITH_OFFSET.test(value) && !Number.isNaN(new Date(value).getTime());
}

function parseLegacyMessages(messagesJson: unknown, limit: number) {
  if (typeof messagesJson !== "string") return [] as Record<string, unknown>[];
  try {
    const parsed = JSON.parse(messagesJson);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").slice(0, limit)
      : [];
  } catch {
    return [];
  }
}

/**
 * Normalized messages are authoritative. JSON entries with a proven matching id are mirrors and are omitted;
 * all remaining JSON entries are preserved, either on the absolute timeline or in the explicitly indeterminate section.
 */
export function readConversationHistory(
  normalized: Record<string, unknown>[],
  messagesJson: unknown,
  limit: number,
): ConversationHistoryRead {
  const normalizedIds = new Set(normalized.map(message => nonEmptyId(message.id)).filter(Boolean));
  const messages: ConversationHistoryMessage[] = normalized.map(message => ({ ...message, chronology: "absolute" }));
  const indeterminateHistory: ConversationHistoryMessage[] = [];

  for (const message of parseLegacyMessages(messagesJson, limit)) {
    const legacyId = nonEmptyId(message.id);
    if (legacyId && normalizedIds.has(legacyId)) continue;
    if (hasAbsoluteTimestamp(message.timestamp)) {
      messages.push({ ...message, chronology: "absolute" });
    } else {
      indeterminateHistory.push({ ...message, chronology: "unknown" });
    }
  }

  return { messages, indeterminateHistory };
}
