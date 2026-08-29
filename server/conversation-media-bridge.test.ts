import { describe, expect, it, vi } from "vitest";
import { createConversationMediaHandler } from "./conversation-media-bridge";

function response() {
  const res: any = { status: vi.fn(), end: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res); return res;
}
function request(conversationId = "conv-a", messageId = "msg-a") { return { params: { conversationId, messageId }, query: { ignored: "1" }, headers: {} } as any; }
const identity = async () => ({ tenantId: "tenant-a", userId: "user-a", sessionId: "session-a", role: "agent" as const, permissions: [], userEmail: "a@example.invalid" });

describe("conversation media bridge", () => {
  it("rejects an unauthenticated request without querying media", async () => {
    const execute = vi.fn(); const res = response();
    await createConversationMediaHandler({ execute } as any, async () => null)(request(), res);
    expect(res.status).toHaveBeenCalledWith(401); expect(execute).not.toHaveBeenCalled();
  });

  it.each(["image/png", "audio/ogg", "video/mp4", "application/pdf", "image/webp"])("streams permitted %s privately", async mime => {
    const execute = vi.fn().mockResolvedValue([[{ mediaReference: JSON.stringify({ mediaData: `data:${mime};base64,QQ==`, fileName: "safe.bin" }), messageType: mime === "application/pdf" ? "document" : "image" }]]);
    const res = response(); await createConversationMediaHandler({ execute } as any, identity)(request(), res);
    expect(execute.mock.calls[0][1]).toEqual(["msg-a", "conv-a", "tenant-a"]);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", mime); expect(res.send).toHaveBeenCalledWith(Buffer.from("A"));
  });

  it("does not disclose cross-tenant, wrong-conversation, absent or forbidden media", async () => {
    for (const rows of [[], [{ mediaReference: "{}", messageType: "image" }]]) {
      const execute = vi.fn().mockResolvedValue([rows]); const res = response();
      await createConversationMediaHandler({ execute } as any, identity)(request("conv-other", "msg-other"), res);
      expect(res.status).toHaveBeenCalledWith(404); expect(res.send).not.toHaveBeenCalled();
    }
  });

  it("uses safe attachment disposition and never writes or calls an external service", async () => {
    const execute = vi.fn().mockResolvedValue([[{ mediaReference: JSON.stringify({ mediaData: "data:application/pdf;base64,QQ==", fileName: 'x\"\r\nInjected: yes' }), messageType: "document" }]]);
    const res = response(); await createConversationMediaHandler({ execute } as any, identity)(request(), res);
    const disposition = res.setHeader.mock.calls.find((call: any[]) => call[0] === "Content-Disposition")?.[1] as string;
    expect(disposition).toMatch(/^attachment; filename=\".*\"$/);
    expect(disposition.slice("attachment; filename=\"".length, -1)).not.toMatch(/[\r\n\"]/);
    expect(execute.mock.calls).toHaveLength(1);
  });
});
