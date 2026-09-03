import { describe, expect, it } from "vitest";
import { readConversationHistory } from "./conversation-legacy-history";

const normalized = [{ id: "canonical-a", timestamp: "2026-09-02T10:00:00.000Z", text: "Canonical" }];

describe("conversation legacy history reader", () => {
  it("keeps a normalized-only conversation unchanged", () => {
    expect(readConversationHistory(normalized, "[]", 200)).toEqual({
      messages: [{ ...normalized[0], chronology: "absolute" }], indeterminateHistory: [],
    });
  });

  it("keeps legacy-only timestamped messages on the chronological timeline", () => {
    const result = readConversationHistory([], JSON.stringify([{ id: "legacy-a", timestamp: "2026-09-02T09:00:00.000-03:00" }]), 200);
    expect(result.messages).toEqual([{ id: "legacy-a", timestamp: "2026-09-02T09:00:00.000-03:00", chronology: "absolute" }]);
    expect(result.indeterminateHistory).toEqual([]);
  });

  it("does not duplicate a legacy mirror with a strong normalized id match", () => {
    const result = readConversationHistory(normalized, JSON.stringify([{ id: "canonical-a", timestamp: "2026-09-02T10:00:00.000Z" }]), 200);
    expect(result.messages.map(message => message.id)).toEqual(["canonical-a"]);
  });

  it("preserves unmatched and id-less legacy messages", () => {
    const result = readConversationHistory(normalized, JSON.stringify([
      { id: "legacy-b", timestamp: "2026-09-02T11:00:00Z" },
      { text: "Historical without id", timestamp: "2026-09-02T12:00:00Z" },
    ]), 200);
    expect(result.messages.map(message => message.id)).toEqual(["canonical-a", "legacy-b", undefined]);
  });

  it("preserves timestamp-less legacy history separately without a fabricated time or order", () => {
    const result = readConversationHistory(normalized, JSON.stringify([{ id: "legacy-unknown", text: "Old" }]), 200);
    expect(result.messages.map(message => message.id)).toEqual(["canonical-a"]);
    expect(result.indeterminateHistory).toEqual([{ id: "legacy-unknown", text: "Old", chronology: "unknown" }]);
  });
});
