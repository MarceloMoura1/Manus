import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conversationMessageBubbleStyle,
} from "@/components/ConversationMessageBubble";
import { DEFAULT_CONVERSATION_BACKGROUND } from "@shared/user-personalization";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("saved conversation background consumers", () => {
  it("uses the per-user background in the Home conversations canvas reached after new attendance", () => {
    const home = source("client/src/pages/Home.tsx");

    expect(home).toContain('import { useUserPersonalization } from "@/hooks/useUserPersonalization"');
    expect(home).toContain('const { preference: conversationBackground } = useUserPersonalization();');
    expect(home).toContain('<ConversationBackground preference={conversationBackground} className="min-h-0 flex-1 overflow-hidden">');
    expect(home).toContain('data-testid="conversation-message-scroll-region"');
    const messageCanvas = home.slice(home.indexOf('<ConversationBackground preference={conversationBackground} className="min-h-0 flex-1 overflow-hidden">'));
    expect(messageCanvas.slice(0, messageCanvas.indexOf('</ConversationBackground>'))).not.toContain('style={{ background:');
  });

  it("applies the saved personalization to the actual Home conversation bubbles", () => {
    const home = source("client/src/pages/Home.tsx");

    expect(home).toContain('import { conversationMessageBubbleStyle } from "@/components/ConversationMessageBubble"');
    const messageCanvas = home.slice(home.indexOf('<ConversationBackground preference={conversationBackground} className="min-h-0 flex-1 overflow-hidden">'));
    expect(messageCanvas).toContain(
      'style={conversationMessageBubbleStyle(isAgent ? "outgoing" : "incoming", conversationBackground)}'
    );

    const before = {
      ...DEFAULT_CONVERSATION_BACKGROUND,
      incomingBubbleColor: "#DBEAFE",
      outgoingBubbleColor: "#1E293B",
    };
    const afterIncomingOnly = {
      ...before,
      incomingBubbleColor: "#FECACA",
    };
    const afterOutgoingOnly = {
      ...before,
      outgoingBubbleColor: "#2563EB",
    };

    expect(conversationMessageBubbleStyle("incoming", afterIncomingOnly)).toMatchObject({
      backgroundColor: "#FECACA",
    });
    expect(conversationMessageBubbleStyle("outgoing", afterIncomingOnly)).toMatchObject({
      backgroundColor: "#1E293B",
    });
    expect(conversationMessageBubbleStyle("incoming", afterOutgoingOnly)).toMatchObject({
      backgroundColor: "#DBEAFE",
    });
    expect(conversationMessageBubbleStyle("outgoing", afterOutgoingOnly)).toMatchObject({
      backgroundColor: "#2563EB",
    });
  });

  it("uses the same saved background in New Attendance and keeps its recipient input opaque", () => {
    const attendance = source("client/src/pages/NewAttendanceFlow.tsx");

    expect(attendance).toContain('const { preference: conversationBackground } = useUserPersonalization();');
    expect(attendance).toContain('<ConversationBackground preference={conversationBackground}');
    expect(attendance).toMatch(/id="attendance-recipient"[\s\S]*?bg-white/);
  });

  it("passes the saved preference through the shared bubble primitive in Conversas", () => {
    const conversations = source("client/src/pages/ConversasPage.tsx");

    expect(conversations).toContain(
      'import { useUserPersonalization } from "@/hooks/useUserPersonalization"'
    );
    expect(conversations).toContain(
      'const { preference: conversationBackground } = useUserPersonalization();'
    );
    expect(conversations).toContain("<ConversationMessageBubble");
    expect(conversations).toContain("preference={conversationBackground}");
  });
});
