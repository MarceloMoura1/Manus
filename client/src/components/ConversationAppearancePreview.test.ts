import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationAppearancePreview } from "./ConversationAppearancePreview";

function renderPreview(
  preference: Parameters<typeof ConversationAppearancePreview>[0]["preference"]
) {
  return renderToStaticMarkup(
    createElement(ConversationAppearancePreview, { preference })
  );
}

describe("ConversationAppearancePreview", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { location: { hostname: "app.megadesk.online" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the same message canvas for the default, solid and styled backgrounds", () => {
    const defaultPreview = renderPreview({
      backgroundType: "default",
      presetId: null,
      customImageUrl: null,
      hasCustomImage: false,
    });
    const solidPreview = renderPreview({
      backgroundType: "preset",
      presetId: "solid-blue",
      customImageUrl: null,
      hasCustomImage: false,
    });
    const styledPreview = renderPreview({
      backgroundType: "preset",
      presetId: "minimal-blue",
      customImageUrl: null,
      hasCustomImage: false,
    });

    expect(defaultPreview).toContain("background-color:#f8fafc");
    expect(solidPreview).toContain("background-color:#dbeafe");
    expect(styledPreview).toContain("radial-gradient");
    for (const markup of [defaultPreview, solidPreview, styledPreview]) {
      expect(markup).toContain(
        'data-testid="conversation-preview-message-area"'
      );
      expect(markup).toContain('data-testid="conversation-message-outgoing"');
      expect(markup).toContain("aspect-[16/10]");
    }
  });

  it("combines every background mode with draft bubble colours through the real bubble primitive", () => {
    for (const background of [
      {
        backgroundType: "default" as const,
        presetId: null,
        customImageUrl: null,
        hasCustomImage: false,
      },
      {
        backgroundType: "preset" as const,
        presetId: "solid-blue",
        customImageUrl: null,
        hasCustomImage: false,
      },
      {
        backgroundType: "preset" as const,
        presetId: "minimal-blue",
        customImageUrl: null,
        hasCustomImage: false,
      },
      {
        backgroundType: "custom" as const,
        presetId: null,
        customImageUrl:
          "/api/user-personalization/background?v=abcdef0123456789",
        hasCustomImage: true,
      },
    ]) {
      const markup = renderPreview({
        ...background,
        incomingBubbleColor: "#DBEAFE",
        outgoingBubbleColor: "#1E293B",
      });
      expect(markup).toContain('data-bubble-color="#DBEAFE"');
      expect(markup).toContain('data-bubble-color="#1E293B"');
    }
  });

  it("renders a selected custom image in the live conversation canvas", () => {
    const markup = renderPreview({
      backgroundType: "custom",
      presetId: null,
      customImageUrl: "/api/user-personalization/background?v=abcdef0123456789",
      hasCustomImage: true,
    });

    expect(markup).toContain(
      "https://api.megadesk.online/api/user-personalization/background?v=abcdef0123456789"
    );
    expect(markup).toContain("background-size:cover");
  });
});
