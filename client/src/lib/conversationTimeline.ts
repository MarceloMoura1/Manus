export type ConversationActivityEvent = {
  id: string;
  eventType: string;
  timestamp?: string | Date | null;
  actorName?: string | null;
  fromUserName?: string | null;
  toUserName?: string | null;
};

export type ConversationTimelineMessage = Record<string, unknown> & {
  id?: string;
  clientAttemptId?: string;
  timestamp?: string | Date | null;
};

export type ConversationTimelineItem =
  | (ConversationTimelineMessage & { kind: "message" })
  | (ConversationActivityEvent & { kind: "activity" });

function timestampValue(value: string | Date | null | undefined) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function timelineItemId(item: ConversationTimelineItem) {
  return item.kind === "message" ? String(item.id ?? item.clientAttemptId ?? "") : item.id;
}

function compareTimelineItemIds(left: ConversationTimelineItem, right: ConversationTimelineItem) {
  const leftId = timelineItemId(left);
  const rightId = timelineItemId(right);
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

/** Removes optimistic attempts only after their canonical counterpart has arrived. */
export function reconcileConversationMessages(
  persisted: ConversationTimelineMessage[],
  optimistic: ConversationTimelineMessage[],
) {
  const persistedAttempts = new Set(
    persisted
      .map(message => String(message.clientAttemptId ?? "").trim())
      .filter(Boolean),
  );

  return [
    ...persisted,
    ...optimistic.filter(message => !persistedAttempts.has(String(message.clientAttemptId ?? "").trim())),
  ];
}

/** Merges canonical messages and persisted activity with a stable, deterministic order. */
export function mergeConversationTimeline(messages: ConversationTimelineMessage[], events: ConversationActivityEvent[]): ConversationTimelineItem[] {
  return [
    ...messages.map(message => ({ ...message, kind: "message" as const })),
    ...events.map(event => ({ ...event, kind: "activity" as const })),
  ].sort((left, right) => {
    const timeDifference = timestampValue(left.timestamp) - timestampValue(right.timestamp);
    if (timeDifference) return timeDifference;
    return compareTimelineItemIds(left, right);
  });
}
