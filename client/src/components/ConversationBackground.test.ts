import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationBackground } from "./ConversationBackground";
import { userConversationBackgroundPreference } from "../../../server/user-personalization";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(innerResolve => { resolve = innerResolve; }), resolve };
}

function customSettings(imageKey: string) {
  return {
    conversationBackgroundType: "custom",
    conversationBackgroundPresetId: null,
    conversationBackgroundImageKey: imageKey,
  } as const;
}

function renderedPrivateImageUrl(preference: ReturnType<typeof userConversationBackgroundPreference>) {
  const markup = renderToStaticMarkup(createElement(
    ConversationBackground,
    { preference, className: "conversation-message-canvas" },
    createElement("div"),
  ));
  return markup.match(/<img[^>]*src="([^"]+)"/)?.[1];
}

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

  it("gives each confirmed asynchronous custom upload a distinct browser resource identity", async () => {
    const imageA = "user-backgrounds/0123456789abcdef0123456789abcdef/11111111-1111-4111-8111-111111111111.webp";
    const imageB = "user-backgrounds/0123456789abcdef0123456789abcdef/22222222-2222-4222-8222-222222222222.webp";
    const imageC = "user-backgrounds/0123456789abcdef0123456789abcdef/33333333-3333-4333-8333-333333333333.webp";
    const uploadB = deferred<ReturnType<typeof customSettings>>();
    const uploadC = deferred<ReturnType<typeof customSettings>>();

    const initialUrl = renderedPrivateImageUrl(userConversationBackgroundPreference(customSettings(imageA)));
    const preferenceB = uploadB.promise.then(userConversationBackgroundPreference);
    uploadB.resolve(customSettings(imageB));
    const urlB = renderedPrivateImageUrl(await preferenceB);

    const preferenceC = uploadC.promise.then(userConversationBackgroundPreference);
    uploadC.resolve(customSettings(imageC));
    const urlC = renderedPrivateImageUrl(await preferenceC);

    expect(urlB).not.toBe(initialUrl);
    expect(urlC).not.toBe(urlB);
  });
});
