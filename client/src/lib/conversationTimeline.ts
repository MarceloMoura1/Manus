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

type TimelineCandidate = ConversationTimelineItem & { sourceOrder: number };

export type ConversationTimelineComposition = {
  timeline: ConversationTimelineItem[];
  indeterminateHistory: ConversationTimelineItem[];
};

function timestampValue(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function hasConfirmedTimelineTimestamp(item: Pick<ConversationTimelineItem, "timestamp">) {
  return timestampValue(item.timestamp) !== null;
}
function timelineItemId(item: ConversationTimelineItem) {
  return item.kind === "message" ? String(item.id ?? item.clientAttemptId ?? "") : item.id;
}

function compareTimelineCandidates(left: TimelineCandidate, right: TimelineCandidate) {
  const leftTimestamp = timestampValue(left.timestamp);
  const rightTimestamp = timestampValue(right.timestamp);
  if (leftTimestamp === null || rightTimestamp === null) return left.sourceOrder - right.sourceOrder;

  const timeDifference = leftTimestamp - rightTimestamp;
  if (timeDifference) return timeDifference;

  const leftId = timelineItemId(left);
  const rightId = timelineItemId(right);
  if (leftId && rightId && leftId !== rightId) return leftId.localeCompare(rightId);

  // Same timestamp without two distinct canonical IDs: retain the explicit input
  // order instead of assigning a semantic message/event precedence.
  return left.sourceOrder - right.sourceOrder;
}

export function composeConversationTimeline(
  messages: ConversationTimelineMessage[],
  events: ConversationActivityEvent[],
): ConversationTimelineComposition {
  const uniqueEventIds = new Set<string>();
  const candidates: TimelineCandidate[] = [
    ...messages.map((message, sourceOrder) => ({ ...message, kind: "message" as const, sourceOrder })),
    ...events
      .filter(event => {
        if (uniqueEventIds.has(event.id)) return false;
        uniqueEventIds.add(event.id);
        return true;
      })
      .map((event, index) => ({ ...event, kind: "activity" as const, sourceOrder: messages.length + index })),
  ];
  const chronological: TimelineCandidate[] = [];
  const indeterminate: TimelineCandidate[] = [];

  for (const candidate of candidates) {
    (hasConfirmedTimelineTimestamp(candidate) ? chronological : indeterminate).push(candidate);
  }

  return {
    timeline: chronological.sort(compareTimelineCandidates).map(({ sourceOrder: _sourceOrder, ...item }) => item),
    indeterminateHistory: indeterminate.map(({ sourceOrder: _sourceOrder, ...item }) => item),
  };
}

export function mergeConversationTimeline(messages: ConversationTimelineMessage[], events: ConversationActivityEvent[]): ConversationTimelineItem[] {
  return composeConversationTimeline(messages, events).timeline;
}

/** Removes an optimistic message only when its persisted canonical attempt exists. */
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
