import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { conversationMessageBubbleClasses } from "./ConversationMessageBubble";

describe("ConversationMessageBubble", () => {
  it("defines the visual language used by incoming and outgoing messages", () => {
    expect(conversationMessageBubbleClasses("incoming")).toContain("bg-white/95");
    expect(conversationMessageBubbleClasses("outgoing")).toContain("bg-blue-600");
    expect(conversationMessageBubbleClasses("incoming")).toContain("rounded-2xl");
  });

  it("is shared by the real conversation and the personalization preview", () => {
    const realConversation = readFileSync(resolve(process.cwd(), "client/src/pages/ConversasPage.tsx"), "utf8");
    const preview = readFileSync(resolve(process.cwd(), "client/src/components/UserPersonalizationTab.tsx"), "utf8");

    expect(realConversation).toContain('from "@/components/ConversationMessageBubble"');
    expect(realConversation).toContain("<ConversationMessageBubble");
    expect(preview).toContain('from "@/components/ConversationMessageBubble"');
    expect(preview).toContain("<ConversationMessageBubble");
  });
});
