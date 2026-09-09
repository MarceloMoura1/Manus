import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("uses the same saved background in New Attendance and keeps its recipient input opaque", () => {
    const attendance = source("client/src/pages/NewAttendanceFlow.tsx");

    expect(attendance).toContain('const { preference: conversationBackground } = useUserPersonalization();');
    expect(attendance).toContain('<ConversationBackground preference={conversationBackground}');
    expect(attendance).toMatch(/id="attendance-recipient"[\s\S]*?bg-white/);
  });
});
