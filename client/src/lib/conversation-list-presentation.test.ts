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
    const now = new Date("2026-09-01T14:30:00");
    expect(formatConversationListTimestamp("2026-09-01T11:32:00", now)).toBe("11:32");
    expect(formatConversationListTimestamp("2026-08-31T11:32:00", now)).toBe("31/08");
    expect(formatConversationListTimestamp(null, now)).toBe("");
  });
});
