import { describe, expect, it } from "vitest";
import {
  UserPersonalizationError,
  resolveUserBackgroundPath,
  userConversationBackgroundPreference,
  userConversationBackgroundUploadResponse,
} from "./user-personalization";

describe("user personalization storage", () => {
  it("accepts only an opaque key in the private user-background namespace", () => {
    const root = process.cwd();
    const key =
      "user-backgrounds/0123456789abcdef0123456789abcdef/11111111-1111-4111-8111-111111111111.webp";
    expect(resolveUserBackgroundPath(root, key)).toContain("user-backgrounds");
  });

  it("rejects path traversal and keys from other storage namespaces", () => {
    expect(() =>
      resolveUserBackgroundPath(process.cwd(), "../secrets.webp")
    ).toThrow(UserPersonalizationError);
    expect(() =>
      resolveUserBackgroundPath(
        process.cwd(),
        "objects/ab/11111111-1111-4111-8111-111111111111.webp"
      )
    ).toThrow(UserPersonalizationError);
  });

  it("returns only the private serving route for a persisted custom image", () => {
    const settings = {
      conversationBackgroundType: "custom",
      conversationBackgroundPresetId: null,
      conversationBackgroundImageKey:
        "user-backgrounds/0123456789abcdef0123456789abcdef/11111111-1111-4111-8111-111111111111.webp",
      conversationIncomingBubbleColor: "#dbeafe",
      conversationOutgoingBubbleColor: "#1e293b",
    } as const;
    const preference = userConversationBackgroundPreference(settings);
    expect(preference).toMatchObject({
      backgroundType: "custom",
      presetId: null,
      customImageUrl: expect.stringMatching(
        /^\/api\/user-personalization\/background\?v=[0-9a-f]{16}$/
      ),
      hasCustomImage: true,
      incomingBubbleColor: "#DBEAFE",
      outgoingBubbleColor: "#1E293B",
    });
    expect(userConversationBackgroundUploadResponse(settings)).toEqual({
      ok: true,
      preference,
    });
    expect(
      JSON.stringify(userConversationBackgroundUploadResponse(settings))
    ).not.toContain(settings.conversationBackgroundImageKey);
  });

  it("normalizes only canonical bubble colours and preserves visual defaults for missing values", () => {
    const preference = userConversationBackgroundPreference({
      conversationBackgroundType: "default",
      conversationBackgroundPresetId: null,
      conversationBackgroundImageKey: null,
      conversationIncomingBubbleColor: "url(javascript:alert(1))",
      conversationOutgoingBubbleColor: null,
    } as const);

    expect(preference.incomingBubbleColor).toBeNull();
    expect(preference.outgoingBubbleColor).toBeNull();
  });
});
