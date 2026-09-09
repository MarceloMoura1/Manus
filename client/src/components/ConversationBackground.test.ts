import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationBackground } from "./ConversationBackground";

describe("ConversationBackground private custom image", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { location: { hostname: "app.megadesk.online" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the persisted private image from the authenticated API origin", () => {
    const markup = renderToStaticMarkup(createElement(
      ConversationBackground,
      {
        preference: {
          backgroundType: "custom",
          presetId: null,
          customImageUrl: "/api/user-personalization/background",
          hasCustomImage: true,
        },
        className: "conversation-message-canvas",
      },
      createElement("div", { "data-testid": "conversation-message-scroll-region" }),
    ));

    expect(markup).toContain("https://api.megadesk.online/api/user-personalization/background");
  });
});
