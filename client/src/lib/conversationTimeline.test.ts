import { describe, expect, it } from "vitest";
import {
  composeConversationTimeline,
  mergeConversationTimeline,
  reconcileConversationMessages,
} from "./conversationTimeline";

describe("conversation timeline", () => {
  it("keeps activities interspersed with messages by timestamp and stable id", () => {
    const timeline = mergeConversationTimeline(
      [
        { id: "message-a", timestamp: "2026-09-02T12:00:00.000Z" },
        { id: "message-b", timestamp: "2026-09-02T12:02:00.000Z" },
      ],
      [
        { id: "activity-x", eventType: "claimed", timestamp: "2026-09-02T12:01:00.000Z" },
        { id: "activity-y", eventType: "transferred", timestamp: "2026-09-02T12:01:30.000Z" },
      ],
    );

    expect(timeline.map(item => item.id)).toEqual(["message-a", "activity-x", "activity-y", "message-b"]);
  });

  it("does not push non-created activities below messages with the same timestamp", () => {
    const timeline = mergeConversationTimeline(
      [{ id: "message-b", timestamp: "2026-09-02T12:00:00.000Z" }],
      [{ id: "activity-a", eventType: "claimed", timestamp: "2026-09-02T12:00:00.000Z" }],
    );

    expect(timeline.map(item => item.id)).toEqual(["activity-a", "message-b"]);
  });

  it("replaces one optimistic attempt with its persisted counterpart without collapsing equal messages", () => {
    const optimistic = [
      { id: "pending-attempt-c", clientAttemptId: "attempt-c", text: "C", timestamp: "2026-09-02T12:03:00.000Z" },
      { id: "pending-attempt-d", clientAttemptId: "attempt-d", text: "Mesmo texto", timestamp: "2026-09-02T12:04:00.000Z" },
    ];
    const persisted = [
      { id: "message-c", clientAttemptId: "attempt-c", text: "C", timestamp: "2026-09-02T12:03:00.000Z" },
      { id: "message-d", clientAttemptId: "attempt-d", text: "Mesmo texto", timestamp: "2026-09-02T12:04:00.000Z" },
      { id: "message-e", clientAttemptId: "attempt-e", text: "Mesmo texto", timestamp: "2026-09-02T12:05:00.000Z" },
    ];

    expect(reconcileConversationMessages([], optimistic).map(message => message.id)).toEqual(["pending-attempt-c", "pending-attempt-d"]);
    expect(reconcileConversationMessages(persisted, optimistic).map(message => message.id)).toEqual(["message-c", "message-d", "message-e"]);
  });

  it("keeps an anchored activity fixed through optimistic send and canonical reconciliation", () => {
    const activityX = {
      id: "event-x", eventType: "claimed", timestamp: "2026-09-02T10:10:00.000Z",
      anchorMessageId: "msg-a", timelineAnchorKind: "message" as const,
    };
    const history = [
      { id: "msg-c", text: "C", timestamp: "2026-09-02T10:03:00.000Z" },
      { id: "msg-a", text: "A", timestamp: "2026-09-02T10:00:00.000Z" },
      { id: "msg-b", text: "B", timestamp: "2026-09-02T10:02:00.000Z" },
    ];
    const optimisticD = [{
      id: "pending-attempt-d", clientAttemptId: "attempt-d", text: "D", timestamp: "2026-09-02T10:04:00.000Z",
    }];

    const whilePending = mergeConversationTimeline(reconcileConversationMessages(history, optimisticD), [activityX]);
    expect(whilePending.map(item => item.id)).toEqual(["msg-a", "event-x", "msg-b", "msg-c", "pending-attempt-d"]);
    expect(whilePending.findIndex(item => item.id === "event-x")).toBe(1);

    const canonicalD = { id: "msg-d", clientAttemptId: "attempt-d", text: "D", timestamp: "2026-09-02T10:04:00.000Z" };
    const afterRefetch = mergeConversationTimeline(
      reconcileConversationMessages([canonicalD, ...history], optimisticD),
      [activityX],
    );

    expect(afterRefetch.map(item => item.id)).toEqual(["msg-a", "event-x", "msg-b", "msg-c", "msg-d"]);
    expect(afterRefetch.findIndex(item => item.id === "event-x")).toBe(1);
    expect(afterRefetch.filter(item => item.id === "msg-d" || item.id === "pending-attempt-d")).toHaveLength(1);
  });
});

const at = (minute: number) => `2026-09-06T10:${String(minute).padStart(2, "0")}:00.000Z`;
const ids = (items: ReturnType<typeof mergeConversationTimeline>) => items.map(item => item.id);

describe("conversation timeline", () => {
  it("places attendance and transfer events between their confirmed messages", () => {
    expect(ids(mergeConversationTimeline(
      [{ id: "m1", timestamp: at(0) }, { id: "m2", timestamp: at(1) }, { id: "m3", timestamp: at(3) }, { id: "m4", timestamp: at(5) }],
      [{ id: "start", eventType: "claimed", timestamp: at(2) }, { id: "transfer", eventType: "transferred", timestamp: at(4) }],
    ))).toEqual(["m1", "m2", "start", "m3", "transfer", "m4"]);
  });

  it("keeps a persisted interaction after its anchor while realtime messages arrive", () => {
    const event = {
      id: "transfer", eventType: "transferred", timestamp: "2026-09-06T13:00:00.000Z",
      anchorMessageId: "m2", timelineAnchorKind: "message" as const,
    };
    const initial = [{ id: "m1", timestamp: at(0) }, { id: "m2", timestamp: at(1) }, { id: "m3", timestamp: at(2) }];
    expect(ids(mergeConversationTimeline(initial, [event]))).toEqual(["m1", "m2", "transfer", "m3"]);
    expect(ids(mergeConversationTimeline([...initial, { id: "m4", timestamp: at(3) }], [event])))
      .toEqual(["m1", "m2", "transfer", "m3", "m4"]);
    expect(ids(mergeConversationTimeline([...initial, { id: "m4", timestamp: at(3) }, { id: "m5", timestamp: at(4) }], [event])))
      .toEqual(["m1", "m2", "transfer", "m3", "m4", "m5"]);
  });

  it("uses one chronology for incoming and outgoing messages and reload/realtime inputs", () => {
    const events = [{ id: "start", eventType: "claimed", timestamp: at(2) }];
    const reload = [{ id: "incoming", direction: "inbound", timestamp: at(1) }, { id: "outgoing", direction: "outbound", timestamp: at(3) }];
    const realtime = [{ id: "outgoing", direction: "outbound", timestamp: at(3) }, { id: "incoming", direction: "inbound", timestamp: at(1) }];
    expect(ids(mergeConversationTimeline(reload, events))).toEqual(["incoming", "start", "outgoing"]);
    expect(ids(mergeConversationTimeline(realtime, events))).toEqual(["incoming", "start", "outgoing"]);
  });

  it("uses canonical IDs for deterministic timestamp ties and explicit source order when IDs are unavailable", () => {
    expect(ids(mergeConversationTimeline(
      [{ id: "message-b", timestamp: at(0) }],
      [{ id: "activity-a", eventType: "claimed", timestamp: at(0) }],
    ))).toEqual(["activity-a", "message-b"]);

    const composition = composeConversationTimeline(
      [{ timestamp: at(0), text: "first" }, { timestamp: at(0), text: "second" }],
      [],
    );
    expect(composition.timeline.map(item => item.text)).toEqual(["first", "second"]);
  });

  it("keeps items without a confirmed time outside the chronological sequence", () => {
    const composition = composeConversationTimeline(
      [{ id: "timed", timestamp: at(1) }, { id: "legacy", text: "old message" }],
      [{ id: "event-untimed", eventType: "claimed" }],
    );
    expect(composition.timeline.map(item => item.id)).toEqual(["timed"]);
    expect(composition.indeterminateHistory.map(item => item.id)).toEqual(["legacy", "event-untimed"]);
  });

  it("uses strong IDs only: canonical attempts replace optimistic mirrors without heuristic collapse", () => {
    const persisted = [
      { id: "canonical-a", clientAttemptId: "attempt-a", text: "same", timestamp: at(3) },
      { id: "canonical-b", clientAttemptId: "attempt-b", text: "same", timestamp: at(4) },
    ];
    const optimistic = [
      { id: "pending-a", clientAttemptId: "attempt-a", text: "same", timestamp: at(3) },
      { id: "pending-c", clientAttemptId: "attempt-c", text: "same", timestamp: at(5) },
    ];
    expect(reconcileConversationMessages(persisted, optimistic).map(item => item.id)).toEqual(["canonical-a", "canonical-b", "pending-c"]);
  });

  it("does not duplicate persisted events with the same strong event ID", () => {
    const timeline = mergeConversationTimeline(
      [{ id: "m1", timestamp: at(0) }],
      [{ id: "transfer", eventType: "transferred", timestamp: at(1) }, { id: "transfer", eventType: "transferred", timestamp: at(1) }],
    );
    expect(ids(timeline)).toEqual(["m1", "transfer"]);
    expect(timeline.filter(item => item.id === "transfer")).toHaveLength(1);
  });

  it("keeps an interaction between messages when its timestamp is within the loaded message range", () => {
    expect(ids(mergeConversationTimeline(
      [{ id: "m1", timestamp: at(0) }, { id: "m2", timestamp: at(10) }],
      [{ id: "transfer", eventType: "transferred", timestamp: at(5) }],
    ))).toEqual(["m1", "transfer", "m2"]);
  });

  it("orders multiple events sharing an anchor deterministically by confirmed timestamp", () => {
    expect(ids(mergeConversationTimeline(
      [{ id: "m1", timestamp: at(0) }, { id: "m2", timestamp: at(10) }, { id: "m3", timestamp: at(20) }],
      [
        { id: "event-b", eventType: "transferred", timestamp: at(16), anchorMessageId: "m2", timelineAnchorKind: "message" },
        { id: "event-a", eventType: "claimed", timestamp: at(15), anchorMessageId: "m2", timelineAnchorKind: "message" },
      ],
    ))).toEqual(["m1", "m2", "event-a", "event-b", "m3"]);
  });

  it("places a new before-first event before the first canonical message", () => {
    expect(ids(mergeConversationTimeline(
      [{ id: "m1", timestamp: at(10) }, { id: "m2", timestamp: at(20) }],
      [{ id: "start", eventType: "claimed", timestamp: at(30), anchorMessageId: null, timelineAnchorKind: "before_first" }],
    ))).toEqual(["start", "m1", "m2"]);
  });

  it("keeps legacy events without an anchor on the existing timestamp fallback", () => {
    expect(ids(mergeConversationTimeline(
      [{ id: "m1", timestamp: at(0) }, { id: "m2", timestamp: at(10) }],
      [{ id: "legacy", eventType: "transferred", timestamp: at(5), anchorMessageId: null, timelineAnchorKind: null }],
    ))).toEqual(["m1", "legacy", "m2"]);
  });

  it("keeps interactions without a timestamp in indeterminate history", () => {
    const composition = composeConversationTimeline(
      [{ id: "m1", timestamp: at(0) }, { id: "m2", timestamp: at(10) }],
      [{ id: "event-untimed", eventType: "transferred" }],
    );
    expect(composition.timeline.map(item => item.id)).toEqual(["m1", "m2"]);
    expect(composition.indeterminateHistory.map(item => item.id)).toEqual(["event-untimed"]);
  });
});
