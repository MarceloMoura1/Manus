import { describe, expect, it } from "vitest";
import { mergeConversationTimeline, reconcileConversationMessages } from "./conversationTimeline";

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

  it("keeps an activity fixed between history messages through optimistic send and canonical reconciliation", () => {
    const activityX = { id: "event-x", eventType: "claimed", timestamp: "2026-09-02T10:01:00.000Z" };
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
