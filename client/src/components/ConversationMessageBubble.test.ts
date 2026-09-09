import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversationMessageBubbleClasses } from "./ConversationMessageBubble";
import { ConversationAppearancePreview } from "./ConversationAppearancePreview";
import { DEFAULT_CONVERSATION_BACKGROUND } from "@shared/user-personalization";

describe("ConversationMessageBubble", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defines the visual language used by incoming and outgoing messages", () => {
    expect(conversationMessageBubbleClasses("incoming")).toContain(
      "bg-white/95"
    );
    expect(conversationMessageBubbleClasses("outgoing")).toContain(
      "bg-blue-600"
    );
    expect(conversationMessageBubbleClasses("incoming")).toContain(
      "rounded-2xl"
    );
  });

  it("renders the real conversation bubble primitive inside the personalization preview", () => {
    const markup = renderToStaticMarkup(
      createElement(ConversationAppearancePreview, {
        preference: DEFAULT_CONVERSATION_BACKGROUND,
      })
    );

    expect(markup).toContain('data-testid="conversation-message-incoming"');
    expect(markup).toContain('data-testid="conversation-message-outgoing"');
    expect(
      markup.match(/data-testid="conversation-message-incoming"/g)
    ).toHaveLength(2);
    expect(markup).toContain("Olá! Preciso de uma atualização");
  });
});
