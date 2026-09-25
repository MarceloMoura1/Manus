import { describe, expect, it, vi } from "vitest";
import { createConversationMediaHandler } from "./conversation-media-bridge";

function response() {
  const res: any = { status: vi.fn(), end: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res); return res;
}
function request(conversationId = "conv-a", messageId = "msg-a") { return { params: { conversationId, messageId }, query: { ignored: "1" }, headers: {} } as any; }
const identity = async () => ({ tenantId: "tenant-a", userId: "user-a", sessionId: "session-a", role: "agent" as const, permissions: ["conversations"], userEmail: "a@example.invalid" });

describe("conversation media bridge", () => {
  const diagnostics = () => ({ warn: vi.fn() });

  it("rejects an unauthenticated request without querying media", async () => {
    const execute = vi.fn(); const res = response(); const logger = diagnostics();
    await createConversationMediaHandler({ execute } as any, async () => null, undefined, undefined, logger, () => "corr-auth")(request(), res);
    expect(res.status).toHaveBeenCalledWith(401); expect(execute).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("[ConversationMediaBridge] media unavailable", {
      code: "AUTH", correlationId: "corr-auth",
    });
  });

  it.each(["image/png", "audio/ogg", "video/mp4", "application/pdf", "image/webp"])("streams permitted %s privately", async mime => {
    const execute = vi.fn().mockResolvedValue([[{ mediaReference: JSON.stringify({ mediaData: `data:${mime};base64,QQ==`, fileName: "safe.bin" }), messageType: mime === "application/pdf" ? "document" : "image" }]]);
    const res = response(); await createConversationMediaHandler({ execute } as any, identity)(request(), res);
    expect(execute.mock.calls[0][1]).toEqual(["msg-a", "conv-a", "tenant-a"]);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", mime); expect(res.send).toHaveBeenCalledWith(Buffer.from("A"));
  });

  it.each([
    ["a viewer", { tenantId: "tenant-a", userId: "viewer", sessionId: "session-v", role: "viewer" as const, permissions: ["conversations"], userEmail: "viewer@example.invalid" }],
    ["an operator without the module permission", { tenantId: "tenant-a", userId: "agent", sessionId: "session-p", role: "agent" as const, permissions: [], userEmail: "agent@example.invalid" }],
  ])("rejects %s before querying private media", async (_label, deniedIdentity) => {
    const execute = vi.fn(); const res = response(); const logger = diagnostics();
    await createConversationMediaHandler({ execute } as any, async () => deniedIdentity, undefined, undefined, logger, () => "corr-access")(request(), res);
    expect(res.status).toHaveBeenCalledWith(403); expect(execute).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("[ConversationMediaBridge] media unavailable", {
      code: "ACCESS", correlationId: "corr-access",
    });
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
    ["another tenant", request("conv-a", "legacy-only"), async () => ({ tenantId: "tenant-b", userId: "user-b", sessionId: "session-b", role: "agent" as const, permissions: ["conversations"], userEmail: "b@example.invalid" }), ["conv-a", "tenant-b"]],
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

  it.each([
    ["image", "imageMessage", "image/jpeg", "foto.jpg"],
    ["audio", "audioMessage", "audio/ogg", undefined],
    ["video", "videoMessage", "video/mp4", "video.mp4"],
    ["document", "documentMessage", "application/pdf", "pedido.pdf"],
  ] as const)("recovers historical %s media from Evolution through the tenant-scoped backend", async (messageType, node, mimeType, fileName) => {
    const providerMessageReference = {
      key: { id: `provider-${messageType}`, remoteJid: "5541999999999@s.whatsapp.net", fromMe: false },
      message: { [node]: { mimetype: mimeType, ...(fileName ? { fileName } : {}) } },
    };
    const execute = vi.fn().mockResolvedValue([[{
      mediaReference: JSON.stringify({ type: messageType, mimeType, fileName }),
      providerMessageReference: JSON.stringify(providerMessageReference),
      provider: "evolution", integrationId: "megadesk-tenant-a", messageType,
    }]]);
    const download = vi.fn().mockResolvedValue({ base64: "QQ==", mimetype: mimeType, fileName });
    const res = response();
    await createConversationMediaHandler({ execute } as any, identity, undefined, download)(request(), res);
    expect(execute.mock.calls[0][1]).toEqual(["msg-a", "conv-a", "tenant-a"]);
    expect(download).toHaveBeenCalledWith("megadesk-tenant-a", providerMessageReference);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", mimeType);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", expect.stringMatching(messageType === "document" ? /^attachment;/ : /^inline;/));
    expect(res.send).toHaveBeenCalledWith(Buffer.from("A"));
  });

  it("never calls Evolution for a row outside the authenticated tenant scope", async () => {
    const execute = vi.fn().mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    const download = vi.fn();
    const res = response();
    await createConversationMediaHandler({ execute } as any, identity, undefined, download)(request("conv-other", "msg-other"), res);
    expect(execute.mock.calls[0][1]).toEqual(["msg-other", "conv-other", "tenant-a"]);
    expect(download).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("reports a private-storage failure internally without leaking the diagnostic in the response", async () => {
    const reference = { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "image/png", byteSize: 2, sha256: "a".repeat(64) };
    const execute = vi.fn().mockResolvedValue([[{ mediaReference: JSON.stringify(reference), messageType: "image" }]]);
    const logger = diagnostics(); const res = response();
    await createConversationMediaHandler({ execute } as any, identity, async () => { throw new Error("private path must not leak"); }, undefined, logger, () => "corr-storage")(request(), res);
    expect(logger.warn).toHaveBeenCalledWith("[ConversationMediaBridge] media unavailable", {
      code: "PRIVATE_STORAGE_READ_FAILURE", correlationId: "corr-storage",
    });
    expect(res.setHeader).toHaveBeenCalledWith("X-Correlation-Id", "corr-storage");
    expect(JSON.stringify(res.status.mock.calls)).not.toContain("private path must not leak");
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("reports provider fallback failure without exposing provider details", async () => {
    const providerMessageReference = { key: { id: "provider-a" }, message: { imageMessage: { mimetype: "image/jpeg" } } };
    const execute = vi.fn().mockResolvedValue([[{
      mediaReference: JSON.stringify({ type: "image", mimeType: "image/jpeg" }),
      providerMessageReference: JSON.stringify(providerMessageReference), provider: "evolution",
      integrationId: "megadesk-tenant-a", messageType: "image",
    }]]);
    const logger = diagnostics(); const res = response();
    await createConversationMediaHandler({ execute } as any, identity, undefined, async () => { throw new Error("provider URL must not leak"); }, logger, () => "corr-provider")(request(), res);
    expect(logger.warn).toHaveBeenCalledWith("[ConversationMediaBridge] media unavailable", {
      code: "PROVIDER_FALLBACK_FAILURE", correlationId: "corr-provider",
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/tenant-a|provider URL|image\/jpeg/i);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it.each([
    ["MESSAGE_NOT_FOUND", [], "corr-message"],
    ["LEGACY_MEDIA_NOT_FOUND", [{ messagesJson: "[]" }], "corr-legacy"],
  ] as const)("distinguishes %s internally while preserving a safe 404", async (code, legacyRows, correlationId) => {
    const execute = vi.fn().mockResolvedValueOnce([[]]).mockResolvedValueOnce([legacyRows]);
    const logger = diagnostics(); const res = response();
    await createConversationMediaHandler({ execute } as any, identity, undefined, undefined, logger, () => correlationId)(request(), res);
    expect(logger.warn).toHaveBeenCalledWith("[ConversationMediaBridge] media unavailable", { code, correlationId });
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("identifies an invalid canonical media reference internally", async () => {
    const execute = vi.fn().mockResolvedValue([[{ mediaReference: "not-json", messageType: "image" }]]);
    const logger = diagnostics(); const res = response();
    await createConversationMediaHandler({ execute } as any, identity, undefined, undefined, logger, () => "corr-invalid")(request(), res);
    expect(logger.warn).toHaveBeenCalledWith("[ConversationMediaBridge] media unavailable", {
      code: "INVALID_MEDIA_REFERENCE", correlationId: "corr-invalid",
    });
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("does not disclose cross-tenant, wrong-conversation, absent or forbidden media", async () => {
    for (const rows of [[], [{ mediaReference: "{}", messageType: "image" }]]) {
      const execute = vi.fn().mockResolvedValue([rows]); const res = response();
      await createConversationMediaHandler({ execute } as any, identity)(request("conv-other", "msg-other"), res);
      expect(res.status).toHaveBeenCalledWith(404); expect(res.send).not.toHaveBeenCalled();
    }
  });

  it("uses safe attachment disposition and never writes or calls an external service", async () => {
    const execute = vi.fn().mockResolvedValue([[{ mediaReference: JSON.stringify({ mediaData: "data:application/pdf;base64,QQ==", fileName: '../x\\\"\r\nInjected: yes' }), messageType: "document" }]]);
    const res = response(); await createConversationMediaHandler({ execute } as any, identity)(request(), res);
    const disposition = res.setHeader.mock.calls.find((call: any[]) => call[0] === "Content-Disposition")?.[1] as string;
    expect(disposition).toMatch(/^attachment; filename=\".*\"$/);
    expect(disposition.slice("attachment; filename=\"".length, -1)).not.toMatch(/[\\/\r\n\"]/);
    expect(execute.mock.calls).toHaveLength(1);
  });
});
