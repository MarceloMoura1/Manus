import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationMessageBubbleClasses,
  conversationMessageBubbleStyle,
} from "./ConversationMessageBubble";
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

  it("keeps legacy classes by default and resolves readable custom bubble colours", () => {
    expect(conversationMessageBubbleStyle("incoming")).toBeUndefined();
    expect(
      conversationMessageBubbleStyle("outgoing", {
        ...DEFAULT_CONVERSATION_BACKGROUND,
        outgoingBubbleColor: "#FFFFFF",
      })
    ).toEqual({ backgroundColor: "#FFFFFF", color: "#0F172A" });
    expect(
      conversationMessageBubbleStyle("incoming", {
        ...DEFAULT_CONVERSATION_BACKGROUND,
        incomingBubbleColor: "#1E293B",
      })
    ).toEqual({
      backgroundColor: "#1E293B",
      color: "#FFFFFF",
      borderColor: "#1E293B",
    });
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

  it("shares custom colour delivery between preview bubbles and the production primitive", () => {
    const markup = renderToStaticMarkup(
      createElement(ConversationAppearancePreview, {
        preference: {
          ...DEFAULT_CONVERSATION_BACKGROUND,
          incomingBubbleColor: "#DBEAFE",
          outgoingBubbleColor: "#1E293B",
        },
      })
    );

    expect(markup).toContain('data-bubble-color="#DBEAFE"');
    expect(markup).toContain('data-bubble-color="#1E293B"');
    expect(markup).toContain("color:#0F172A");
    expect(markup).toContain("color:#FFFFFF");
  });
});
