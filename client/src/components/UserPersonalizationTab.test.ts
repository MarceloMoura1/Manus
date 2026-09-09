import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conversationBackgroundSaveInput,
  hasUnsavedConversationBackground,
  persistedCustomBackgroundFromUpload,
} from "./UserPersonalizationTab";

const saved = {
  backgroundType: "default" as const,
  presetId: null,
  customImageUrl: null,
  hasCustomImage: false,
};

describe("UserPersonalizationTab save flow", () => {
  it("keeps a draft separate from the saved preference until it has a valid save payload", () => {
    const draft = {
      backgroundType: "preset" as const,
      presetId: "solid-blue",
      customImageUrl: null,
      hasCustomImage: false,
    };

    expect(hasUnsavedConversationBackground(draft, saved, false)).toBe(true);
    expect(conversationBackgroundSaveInput(draft, {
      clientId: "tenant-a",
      userEmail: "agent@example.invalid",
    })).toEqual({
      clientId: "tenant-a",
      userEmail: "agent@example.invalid",
      backgroundType: "preset",
      presetId: "solid-blue",
    });
    expect(saved).toMatchObject({ backgroundType: "default", presetId: null });
  });

  it("keeps a pending image dirty until its upload is confirmed", () => {
    const imageDraft = {
      backgroundType: "custom" as const,
      presetId: null,
      customImageUrl: "blob:preview",
      hasCustomImage: true,
    };

    expect(hasUnsavedConversationBackground(imageDraft, saved, true)).toBe(true);
    expect(hasUnsavedConversationBackground(null, saved, false)).toBe(false);
  });

  it("accepts only a persisted custom background URL from the upload response", () => {
    expect(persistedCustomBackgroundFromUpload({
      ok: true,
      preference: {
        backgroundType: "custom",
        presetId: null,
        customImageUrl: "/api/user-personalization/background?v=0123456789abcdef",
        hasCustomImage: true,
      },
    })).toMatchObject({ backgroundType: "custom", customImageUrl: "/api/user-personalization/background?v=0123456789abcdef" });
    expect(persistedCustomBackgroundFromUpload({ ok: true })).toBeNull();
    expect(persistedCustomBackgroundFromUpload({
      ok: true,
      preference: { backgroundType: "custom", customImageUrl: "blob:preview" },
    })).toBeNull();
  });

  it("wires the explicit Save command to the per-user mutation and only clears the draft on success", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/UserPersonalizationTab.tsx"), "utf8");

    expect(source).toContain('saveMutation.mutateAsync(conversationBackgroundSaveInput(preview, personalization.cacheIdentity))');
    expect(source).toContain('utils.userPersonalization.get.setData(personalization.cacheIdentity, saved)');
    expect(source).toContain('const saved = persistedCustomBackgroundFromUpload(payload)');
    expect(source).toContain('utils.userPersonalization.get.setData(personalization.cacheIdentity, saved)');
    expect(source).toContain('fetch(userPersonalizationBackgroundUrl(), {');
    expect(source).toContain('onClick={() => void save()}');
    expect(source).toContain('{isSaving ? "Salvando…" : "Salvar"}');
    expect(source).not.toContain('saveMutation.mutate({');
  });

  it("renders a large responsive preview with the shared conversation bubble primitive", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/UserPersonalizationTab.tsx"), "utf8");

    expect(source).toContain("min-h-[22rem]");
    expect(source).toContain("sm:min-h-[28rem]");
    expect(source).toContain("<ConversationMessageBubble direction=\"incoming\"");
    expect(source).toContain("<ConversationMessageBubble direction=\"outgoing\"");
    expect(source).toContain("aria-pressed={selected}");
  });
});
