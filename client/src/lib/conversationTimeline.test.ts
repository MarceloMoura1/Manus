import { describe, expect, it } from "vitest";
import {
  composeConversationTimeline,
  mergeConversationTimeline,
  reconcileConversationMessages,
} from "./conversationTimeline";

const at = (minute: number) => `2026-09-06T10:${String(minute).padStart(2, "0")}:00.000Z`;
const ids = (items: ReturnType<typeof mergeConversationTimeline>) => items.map(item => item.id);

describe("conversation timeline", () => {
  it("places attendance and transfer events between their confirmed messages", () => {
    expect(ids(mergeConversationTimeline(
      [{ id: "m1", timestamp: at(0) }, { id: "m2", timestamp: at(1) }, { id: "m3", timestamp: at(3) }, { id: "m4", timestamp: at(5) }],
      [{ id: "start", eventType: "claimed", timestamp: at(2) }, { id: "transfer", eventType: "transferred", timestamp: at(4) }],
    ))).toEqual(["m1", "m2", "start", "m3", "transfer", "m4"]);
  });

  it("keeps historical events fixed when multiple realtime messages arrive", () => {
    const events = [{ id: "start", eventType: "claimed", timestamp: at(2) }, { id: "transfer", eventType: "transferred", timestamp: at(4) }];
    const initial = [{ id: "m1", timestamp: at(0) }, { id: "m2", timestamp: at(1) }, { id: "m3", timestamp: at(3) }, { id: "m4", timestamp: at(5) }];
    expect(ids(mergeConversationTimeline([...initial, { id: "m5", timestamp: at(6) }], events))).toEqual(["m1", "m2", "start", "m3", "transfer", "m4", "m5"]);
    expect(ids(mergeConversationTimeline([...initial, { id: "m5", timestamp: at(6) }, { id: "m6", timestamp: at(7) }], events))).toEqual(["m1", "m2", "start", "m3", "transfer", "m4", "m5", "m6"]);
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
    expect(ids(mergeConversationTimeline(
      [{ id: "m1", timestamp: at(0) }],
      [{ id: "transfer", eventType: "transferred", timestamp: at(1) }, { id: "transfer", eventType: "transferred", timestamp: at(1) }],
    ))).toEqual(["m1", "transfer"]);
  });
});
