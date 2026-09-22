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
    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", mime); expect(res.send).toHaveBeenCalledWith(Buffer.from("A"));
  });

  it("reads V1 media that exists only in this tenant's legacy JSON", async () => {
    const legacyJson = JSON.stringify([{ id: "legacy-only", type: "image", fileName: "old.png",
      mediaData: "data:image/png;base64,QQ==" }]);
    const execute = vi.fn()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ messagesJson: legacyJson }]]);
    const res = response();
    await createConversationMediaHandler({ execute } as any, identity)(request("conv-a", "legacy-only"), res);
    expect(execute.mock.calls[1][1]).toEqual(["conv-a", "tenant-a"]);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(res.send).toHaveBeenCalledWith(Buffer.from("A"));
    expect(JSON.stringify(res.send.mock.calls)).not.toMatch(/data:.*;base64|mediaData|storageKey/i);
  });

  it.each([
    ["another tenant", request("conv-a", "legacy-only"), async () => ({ tenantId: "tenant-b", userId: "user-b", sessionId: "session-b", role: "agent" as const, permissions: [], userEmail: "b@example.invalid" }), ["conv-a", "tenant-b"]],
    ["another conversation", request("conv-other", "legacy-only"), identity, ["conv-other", "tenant-a"]],
  ])("does not fall back to legacy JSON from %s", async (_label, req, resolveIdentity, expectedScope) => {
    const execute = vi.fn().mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    const res = response();
    await createConversationMediaHandler({ execute } as any, resolveIdentity)(req, res);
    expect(execute.mock.calls[1][1]).toEqual(expectedScope);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  it.each([
    ["an absent message", JSON.stringify([{ id: "different", mediaData: "data:image/png;base64,QQ==" }])],
    ["a legacy message without media", JSON.stringify([{ id: "legacy-only", type: "image" }])],
    ["an invalid V1 Data URL", JSON.stringify([{ id: "legacy-only", mediaData: "not-a-data-url" }])],
  ])("returns a controlled response for %s", async (_label, messagesJson) => {
    const execute = vi.fn().mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ messagesJson }]]);
    const res = response();
    await createConversationMediaHandler({ execute } as any, identity)(request("conv-a", "legacy-only"), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("reads V2 bytes from private storage without exposing its storage key", async () => {
    const reference = { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "image/png", fileName: "foto.png", byteSize: 2, sha256: "a".repeat(64) };
    const execute = vi.fn().mockResolvedValue([[{ mediaReference: JSON.stringify(reference), messageType: "image" }]]);
    const read = vi.fn().mockResolvedValue({ bytes: Buffer.from("v2"), mimeType: "image/png", fileName: "foto.png" });
    const res = response();
    await createConversationMediaHandler({ execute } as any, identity, read)(request(), res);
    expect(read).toHaveBeenCalledWith({ clientId: "tenant-a", reference });
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(res.send).toHaveBeenCalledWith(Buffer.from("v2"));
    expect(JSON.stringify(res.send.mock.calls)).not.toContain("storageKey");
  });

  it("returns a controlled 404 when a V2 object is missing", async () => {
    const execute = vi.fn().mockResolvedValue([[{ mediaReference: JSON.stringify({ version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "application/pdf", byteSize: 1, sha256: "a".repeat(64) }), messageType: "document" }]]);
    const res = response();
    await createConversationMediaHandler({ execute } as any, identity, async () => { throw new Error("missing"); })(request(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
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
