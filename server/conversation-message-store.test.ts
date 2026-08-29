import { describe, expect, it, vi } from "vitest";
import { lightweightLegacyMessage, persistCanonicalMessage, type CanonicalMessageWrite } from "./conversation-message-store";
import { normalizedMessage } from "./routers-conversations";

const base: CanonicalMessageWrite = {
  messageId: "msg-1", conversationId: "conv-1", clientId: "tenant-a", externalMessageId: "external-1",
  provider: "evolution", integrationId: "instance-a", direction: "inbound", messageType: "text",
  sender: "customer", text: "hello", status: "received", timestamp: new Date("2026-08-29T12:00:00Z"),
  legacyMessage: { from: "customer", text: "hello" }, incrementUnread: true,
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
  it("writes integration-scoped identity and media before the legacy JSON", async () => {
    const db = connection();
    await expect(persistCanonicalMessage(db, { ...base, messageType: "image", mediaReference: { mediaData: "data:image/png;base64,AA==", mimeType: "image/png" } })).resolves.toBe(true);
    expect(db.execute).toHaveBeenCalledTimes(3);
    expect(db.execute.mock.calls[0][0]).toContain("integration_id");
    expect(db.execute.mock.calls[0][1]).toContain("instance-a");
    expect(db.execute.mock.calls[1][0]).toContain("FOR UPDATE");
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

  it.each(["image", "video", "audio", "document", "sticker", "contact"])("reconstructs %s payload from media_reference", (type) => {
    const mediaData = type === "contact" ? undefined : `data:application/octet-stream;base64,${type}`;
    const row = normalizedMessage({ id: "msg", type, mediaReference: JSON.stringify({ mediaData, fileName: `${type}.bin`, contact: type === "contact" ? { name: "A", vcard: "VCARD" } : undefined }) });
    expect(row.type).toBe(type);
    if (type === "contact") expect(row.contact).toEqual({ name: "A", vcard: "VCARD" });
    else expect(row.mediaData).toBe(mediaData);
  });

  it("keeps heavy media only in the normalized reference", () => {
    const heavy = "data:video/mp4;base64," + "A".repeat(1_000_000);
    const legacy = lightweightLegacyMessage({ ...base, messageType: "video",
      legacyMessage: { type: "video", mediaData: heavy, mimeType: "video/mp4", fileName: "a.mp4" },
      mediaReference: { mediaData: heavy, mimeType: "video/mp4" } });
    expect(JSON.stringify(legacy)).not.toContain("A".repeat(100));
    expect(legacy).toMatchObject({ type: "video", mimeType: "video/mp4",
      mediaReference: { storage: "normalized", messageId: "msg-1" } });
  });
});
