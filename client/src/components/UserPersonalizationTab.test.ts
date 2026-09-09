import { describe, expect, it } from "vitest";
import {
  conversationBackgroundMode,
  conversationBackgroundSaveInput,
  hasUnsavedConversationBackground,
  persistedCustomBackgroundFromUpload,
} from "./UserPersonalizationTab";

const saved = {
  backgroundType: "default" as const,
  presetId: null,
  customImageUrl: null,
  hasCustomImage: false,
  incomingBubbleColor: null,
  outgoingBubbleColor: null,
};

describe("UserPersonalizationTab save flow", () => {
  it("keeps a draft separate from the saved preference until it has a valid save payload", () => {
    const draft = {
      backgroundType: "preset" as const,
      presetId: "solid-blue",
      customImageUrl: null,
      hasCustomImage: false,
      incomingBubbleColor: null,
      outgoingBubbleColor: null,
    };

    expect(hasUnsavedConversationBackground(draft, saved, false)).toBe(true);
    expect(
      conversationBackgroundSaveInput(draft, {
        clientId: "tenant-a",
        userEmail: "agent@example.invalid",
      })
    ).toEqual({
      clientId: "tenant-a",
      userEmail: "agent@example.invalid",
      backgroundType: "preset",
      presetId: "solid-blue",
      incomingBubbleColor: null,
      outgoingBubbleColor: null,
    });
    expect(saved).toMatchObject({ backgroundType: "default", presetId: null });
  });

  it("keeps a pending image dirty until its upload is confirmed", () => {
    const imageDraft = {
      backgroundType: "custom" as const,
      presetId: null,
      customImageUrl: "blob:preview",
      hasCustomImage: true,
      incomingBubbleColor: null,
      outgoingBubbleColor: null,
    };

    expect(hasUnsavedConversationBackground(imageDraft, saved, true)).toBe(
      true
    );
    expect(hasUnsavedConversationBackground(null, saved, false)).toBe(false);
  });

  it("keeps draft bubble colours unsaved until the shared personalization mutation succeeds", () => {
    const colorDraft = {
      ...saved,
      incomingBubbleColor: "#DBEAFE",
      outgoingBubbleColor: "#1E293B",
    };
    expect(hasUnsavedConversationBackground(colorDraft, saved, false)).toBe(
      true
    );
    expect(
      conversationBackgroundSaveInput(colorDraft, {
        clientId: "tenant-a",
        userEmail: "agent@example.invalid",
      })
    ).toMatchObject({
      incomingBubbleColor: "#DBEAFE",
      outgoingBubbleColor: "#1E293B",
    });
    expect(
      hasUnsavedConversationBackground(
        { ...colorDraft, incomingBubbleColor: null, outgoingBubbleColor: null },
        saved,
        false
      )
    ).toBe(false);
  });

  it("accepts only a persisted custom background URL from the upload response", () => {
    expect(
      persistedCustomBackgroundFromUpload({
        ok: true,
        preference: {
          backgroundType: "custom",
          presetId: null,
          customImageUrl:
            "/api/user-personalization/background?v=0123456789abcdef",
          hasCustomImage: true,
        },
      })
    ).toMatchObject({
      backgroundType: "custom",
      customImageUrl: "/api/user-personalization/background?v=0123456789abcdef",
    });
    expect(persistedCustomBackgroundFromUpload({ ok: true })).toBeNull();
    expect(
      persistedCustomBackgroundFromUpload({
        ok: true,
        preference: {
          backgroundType: "custom",
          customImageUrl: "blob:preview",
        },
      })
    ).toBeNull();
  });

  it("keeps each persisted background value in its corresponding visual mode without changing its contract", () => {
    expect(conversationBackgroundMode(saved)).toBe("default");
    expect(
      conversationBackgroundMode({
        backgroundType: "preset",
        presetId: "solid-blue",
        customImageUrl: null,
        hasCustomImage: false,
      })
    ).toBe("solid");
    expect(
      conversationBackgroundMode({
        backgroundType: "preset",
        presetId: "minimal-blue",
        customImageUrl: null,
        hasCustomImage: false,
      })
    ).toBe("pattern");
    expect(
      conversationBackgroundMode({
        backgroundType: "custom",
        presetId: null,
        customImageUrl:
          "/api/user-personalization/background?v=abcdef0123456789",
        hasCustomImage: true,
      })
    ).toBe("custom");
  });
});
