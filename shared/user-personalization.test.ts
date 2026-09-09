import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONVERSATION_BACKGROUND,
  normalizeConversationBackgroundPreference,
  resolveConversationBackgroundStyle,
} from "./user-personalization";

describe("conversation background preference", () => {
  it("uses a trusted preset and rejects arbitrary preset IDs", () => {
    expect(normalizeConversationBackgroundPreference({
      backgroundType: "preset",
      presetId: "solid-blue",
      customImageUrl: null,
      hasCustomImage: false,
    })).toMatchObject({ backgroundType: "preset", presetId: "solid-blue" });
    expect(normalizeConversationBackgroundPreference({
      backgroundType: "preset",
      presetId: "background: url(https://example.invalid)",
    })).toEqual(DEFAULT_CONVERSATION_BACKGROUND);
  });

  it("falls back when a custom image URL is absent", () => {
    expect(resolveConversationBackgroundStyle({
      backgroundType: "custom",
      presetId: null,
      customImageUrl: null,
      hasCustomImage: true,
    })).toEqual({ backgroundColor: "#f8fafc" });
  });

  it("renders the server-issued private image route as a custom background", () => {
    expect(resolveConversationBackgroundStyle({
      backgroundType: "custom",
      presetId: null,
      customImageUrl: "/api/user-personalization/background",
      hasCustomImage: true,
    })).toMatchObject({
      backgroundImage: 'url("/api/user-personalization/background")',
      backgroundSize: "cover",
    });
  });
});
