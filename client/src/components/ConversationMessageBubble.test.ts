import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationMessageBubbleClasses,
  conversationMessageBubbleGradient,
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

  it("keeps legacy classes by default and derives readable tonal custom bubble colours", () => {
    expect(conversationMessageBubbleStyle("incoming")).toBeUndefined();
    expect(
      conversationMessageBubbleStyle("outgoing", {
        ...DEFAULT_CONVERSATION_BACKGROUND,
        outgoingBubbleColor: "#FFFFFF",
      })
    ).toEqual({
      backgroundColor: "#FFFFFF",
      backgroundImage: conversationMessageBubbleGradient("#FFFFFF"),
      color: "#0F172A",
    });
    expect(
      conversationMessageBubbleStyle("incoming", {
        ...DEFAULT_CONVERSATION_BACKGROUND,
        incomingBubbleColor: "#1E293B",
      })
    ).toEqual({
      backgroundColor: "#1E293B",
      backgroundImage: conversationMessageBubbleGradient("#1E293B"),
      color: "#FFFFFF",
      borderColor: "#1E293B",
    });
  });

  it("derives deterministic, valid gradients independently from each base colour", () => {
    const blue = conversationMessageBubbleGradient("#2563EB");
    const red = conversationMessageBubbleGradient("#DC2626");

    expect(blue).toMatch(
      /^linear-gradient\(135deg, #[0-9A-F]{6} 0%, #2563EB 52%, #[0-9A-F]{6} 100%\)$/
    );
    expect(red).toMatch(
      /^linear-gradient\(135deg, #[0-9A-F]{6} 0%, #DC2626 52%, #[0-9A-F]{6} 100%\)$/
    );
    expect(blue).not.toBe(red);

    const preference = {
      ...DEFAULT_CONVERSATION_BACKGROUND,
      incomingBubbleColor: "#DC2626",
      outgoingBubbleColor: "#2563EB",
    };
    expect(conversationMessageBubbleStyle("incoming", preference)?.backgroundImage).toBe(red);
    expect(conversationMessageBubbleStyle("outgoing", preference)?.backgroundImage).toBe(blue);
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
    expect(markup).toContain("background-image:linear-gradient");
    expect(markup).toContain("color:#0F172A");
    expect(markup).toContain("color:#FFFFFF");
  });
});
