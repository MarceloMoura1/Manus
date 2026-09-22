import { describe, expect, it, vi } from "vitest";
import { lightweightLegacyMessage, persistCanonicalMessage, type CanonicalMessageWrite } from "./conversation-message-store";
import { normalizedMessage } from "./routers-conversations";

const base: CanonicalMessageWrite = {
  messageId: "msg-1", conversationId: "conv-1", clientId: "tenant-a", externalMessageId: "external-1",
  provider: "evolution", integrationId: "instance-a", direction: "inbound", messageType: "text",
  sender: "customer", text: "hello", status: "received", timestamp: new Date("2026-08-29T12:00:00Z"),
  legacyMessage: { from: "customer", text: "hello" }, incrementUnread: true,
};

const v2Reference = {
  version: 2 as const, storage: "local" as const,
  storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin",
  mimeType: "image/png", fileName: "foto.png", byteSize: 1, sha256: "a".repeat(64),
};

function connection(responses: unknown[] = [{ affectedRows: 1 }, [{ messages_json: "[]" }], { affectedRows: 1 }]) {
  const execute = vi.fn(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return [response];
  });
  return { execute } as any;
}

describe("canonical message store", () => {
  it("writes integration-scoped V2 media metadata before the legacy JSON", async () => {
    const db = connection();
    await expect(persistCanonicalMessage(db, { ...base, messageType: "image", mediaReference: v2Reference })).resolves.toBe(true);
    expect(db.execute).toHaveBeenCalledTimes(3);
    expect(db.execute.mock.calls[0][0]).toContain("integration_id");
    expect(db.execute.mock.calls[0][1]).toContain("instance-a");
    expect(String(db.execute.mock.calls[0][1][13])).not.toMatch(/mediaData|base64|dataUrl|data:.*;base64/i);
    expect(db.execute.mock.calls[1][0]).toContain("FOR UPDATE");
  });

  it("persists the internal quote relation and compact provider reference", async () => {
    const db = connection();
    await persistCanonicalMessage(db, {
      ...base,
      replyToMessageId: "original-1",
      providerMessageReference: {
        key: { id: "external-1", remoteJid: "5541999999999@s.whatsapp.net", fromMe: false },
        message: { imageMessage: { caption: "Pedido", base64: "A".repeat(500) } },
      },
    });
    expect(db.execute.mock.calls[0][0]).toContain("reply_to_message_id");
    expect(db.execute.mock.calls[0][1][7]).toBe("original-1");
    expect(db.execute.mock.calls[0][1][8]).toContain('"external-1"');
    expect(db.execute.mock.calls[0][1][8]).not.toContain("A".repeat(100));
  });

  it("returns duplicate only for the external-message constraint and never touches JSON", async () => {
    const duplicate = { code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'uq_mdcm_external'" };
    const db = { execute: vi.fn(async () => { throw duplicate; }) } as any;
    await expect(persistCanonicalMessage(db, base)).resolves.toBe(false);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("does not hide unrelated insert failures", async () => {
    const failure = Object.assign(new Error("insert failed"), { code: "ER_DATA_TOO_LONG" });
    await expect(persistCanonicalMessage(connection([failure]), base)).rejects.toBe(failure);
  });

  it("stops after a locked JSON read or summary update failure so the caller can roll back", async () => {
    await expect(persistCanonicalMessage(connection([{ affectedRows: 1 }, new Error("json read")]), base)).rejects.toThrow("json read");
    await expect(persistCanonicalMessage(connection([{ affectedRows: 1 }, [{ messages_json: "[]" }], new Error("summary")]), base)).rejects.toThrow("summary");
  });

  it.each(["image", "video", "audio", "document", "sticker"])("returns a private pointer instead of V1 data from %s media_reference", (type) => {
    const mediaData = `data:application/octet-stream;base64,${type}`;
    const row = normalizedMessage({ id: "msg", type, mediaReference: JSON.stringify({ mediaData, fileName: `${type}.bin` }) });
    expect(row.type).toBe(type);
    expect(row.mediaData).toBeUndefined();
    expect(row.mediaReference).toEqual({ storage: "private", messageId: "msg" });
  });

  it("returns V2 metadata and a private pointer without Base64 or a storage key", () => {
    const row = normalizedMessage({ id: "msg-v2", type: "image", mediaReference: JSON.stringify(v2Reference) });
    expect(row).toMatchObject({ mimeType: "image/png", fileName: "foto.png", byteSize: 1,
      mediaReference: { storage: "private", messageId: "msg-v2" } });
    expect(JSON.stringify(row)).not.toMatch(/mediaData|base64|dataUrl|storageKey|data:.*;base64/i);
  });

  it("returns a lightweight quote preview without original media", () => {
    const row = normalizedMessage({
      id: "reply", type: "text", mediaReference: null, replyToMessageId: "original",
      replyMessageId: "original", replySender: "customer", replyDirection: "inbound",
      replyText: "Mensagem original", replyType: "image", replyMediaLabel: "Foto",
    });
    expect(row.replyTo).toEqual({ messageId: "original", senderName: null, sender: "customer", direction: "inbound",
      type: "image", textPreview: "Mensagem original", mediaLabel: "Foto", available: true });
    expect(JSON.stringify(row.replyTo)).not.toContain("base64");
  });

  it("keeps the legacy mirror lightweight for a V2 reference", () => {
    const heavy = "data:video/mp4;base64," + "A".repeat(1_000_000);
    const legacy = lightweightLegacyMessage({ ...base, messageType: "video",
      legacyMessage: { type: "video", mediaData: heavy, mimeType: "video/mp4", fileName: "a.mp4" },
      mediaReference: { ...v2Reference, mimeType: "video/mp4" } });
    expect(JSON.stringify(legacy)).not.toContain("A".repeat(100));
    expect(legacy).toMatchObject({ type: "video", mimeType: "video/mp4",
      mediaReference: { storage: "private", messageId: "msg-1" } });
  });

  it("blocks every new media reference containing a transient binary field", async () => {
    const db = connection();
    await expect(persistCanonicalMessage(db, { ...base, messageType: "image",
      mediaReference: { ...v2Reference, mediaData: "data:image/png;base64,AA==" } }))
      .rejects.toThrow("CONVERSATION_MEDIA_BINARY_REFERENCE_FORBIDDEN");
    expect(db.execute).not.toHaveBeenCalled();
  });
});
