import { describe, expect, it } from "vitest";
import { formatConversationListTimestamp, getConversationChannelPresentation } from "./conversation-list-presentation";

describe("conversation list presentation", () => {
  it("uses a WhatsApp indicator only for real WhatsApp metadata", () => {
    expect(getConversationChannelPresentation("evolution", "whatsapp")).toMatchObject({ label: "WhatsApp" });
    expect(getConversationChannelPresentation("whatsapp", null)).toMatchObject({ label: "WhatsApp" });
    expect(getConversationChannelPresentation(null, null)).toBeNull();
    expect(getConversationChannelPresentation("other", "email")).toBeNull();
  });

  it("formats recent time and older dates without inventing a value", () => {
    // 2026-09-01T17:30:00.000Z is 14:30 in Brasília
    const now = "2026-09-01T17:30:00.000Z";
    // 2026-09-01T14:32:00.000Z is 11:32 in Brasília
    expect(formatConversationListTimestamp("2026-09-01T14:32:00.000Z", now)).toBe("11:32");
    // Also test SQL timestamp normalized to UTC: 14:32:00 UTC -> 11:32 Brasília
    expect(formatConversationListTimestamp("2026-09-01 14:32:00", now)).toBe("11:32");
    // Previous day: 2026-08-31
    expect(formatConversationListTimestamp("2026-08-31T14:32:00.000Z", now)).toBe("31/08");
    expect(formatConversationListTimestamp(null, now)).toBe("");
  });
});
