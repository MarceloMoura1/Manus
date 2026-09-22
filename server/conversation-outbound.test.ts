import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { executeOutboundAttempt, OutboundAttemptAlreadyRecordedError, OutboundPendingPersistenceError, OutboundReconciliationError, sendOutboundConversationMediaFromPrivateStorage } from "./conversation-outbound";
import { decodeConversationMediaDataUrl, readConversationMedia, writeConversationMedia } from "./conversation-media-storage";

const input = {
  messageId: "local-1", clientAttemptId: "attempt-1", conversationId: "conv-1", clientId: "tenant-a", provider: "evolution",
  integrationId: "instance-a", messageType: "text", sender: "agent" as const, text: "hello",
  timestamp: new Date("2026-08-29T12:00:00Z"), legacyMessage: { from: "agent", text: "hello" },
};

const providerReference = {
  key: { id: "provider-1", remoteJid: "5541999999999@s.whatsapp.net", fromMe: true },
  message: { conversation: "hello" },
};

function pool(options: { insertError?: Error; reconciliationError?: Error; existing?: any } = {}) {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
    execute: vi.fn(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("client_attempt_id") && sql.includes("SELECT message_id")) return [[options.existing].filter(Boolean)];
      if (sql.includes("INSERT INTO megadesk_domain_conversations_messages") && options.insertError) throw options.insertError;
      if (sql.includes("SELECT messages_json")) return [[{ messages_json: "[]" }]];
      return [{ affectedRows: 1 }];
    }),
  };
  const execute = vi.fn(async () => {
    if (options.reconciliationError) throw options.reconciliationError;
    return [{ affectedRows: 1 }];
  });
  return { value: { getConnection: vi.fn(async () => connection), execute } as any, connection, execute };
}

async function temporaryRoot() {
  return mkdtemp(path.join(os.tmpdir(), "megadesk-conversation-outbound-"));
}

describe("outbound tracked workflow", () => {
  it("commits pending before provider and reconciles the same row", async () => {
    const db = pool();
    const send = vi.fn(async () => {
      expect(db.connection.commit).toHaveBeenCalledOnce();
      return providerReference;
    });
    await expect(executeOutboundAttempt(db.value, input, send)).resolves.toMatchObject({ status: "sent", externalMessageId: "provider-1" });
    expect(db.execute.mock.calls[0][1]).toEqual(["sent", "provider-1", JSON.stringify(providerReference), "local-1", "conv-1", "tenant-a", "evolution", "instance-a"]);
  });

  it("never calls provider when initial persistence fails", async () => {
    const db = pool({ insertError: new Error("database unavailable") });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, input, send)).rejects.toBeInstanceOf(OutboundPendingPersistenceError);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the local row and marks failure when provider fails", async () => {
    const db = pool();
    await expect(executeOutboundAttempt(db.value, input, async () => { throw new Error("provider failed"); })).rejects.toThrow("provider failed");
    expect(db.connection.commit).toHaveBeenCalledOnce();
    expect(db.execute.mock.calls[0][1][0]).toBe("failed");
  });

  it("leaves a reconcilable pending row when post-provider update fails", async () => {
    const db = pool({ reconciliationError: new Error("update failed") });
    await expect(executeOutboundAttempt(db.value, input, async () => providerReference))
      .rejects.toBeInstanceOf(OutboundReconciliationError);
    expect(db.connection.commit).toHaveBeenCalledOnce();
  });

  it("returns an already-sent attempt without calling provider", async () => {
    const db = pool({ existing: { message_id: "stored-1", status: "sent", external_message_id: "provider-1" } });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, input, send)).resolves.toEqual({ messageId: "stored-1", externalMessageId: "provider-1", status: "sent" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed"])("does not blindly resend an existing %s attempt", async (status) => {
    const db = pool({ existing: { message_id: "stored-1", status, external_message_id: null } });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, input, send)).rejects.toBeInstanceOf(OutboundAttemptAlreadyRecordedError);
    expect(send).not.toHaveBeenCalled();
  });

  it("persists the quote relation in the pending row before calling the provider", async () => {
    const db = pool();
    await executeOutboundAttempt(db.value, { ...input, replyToMessageId: "original-1" }, async () => providerReference);
    const insert = db.connection.execute.mock.calls.find(call => String(call[0]).includes("INSERT INTO megadesk_domain_conversations_messages"));
    expect(insert?.[1][7]).toBe("original-1");
  });

  it("persists an outbound pending media row with V2 metadata only", async () => {
    const db = pool();
    const mediaReference = { version: 2 as const, storage: "local" as const,
      storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin",
      mimeType: "application/pdf", fileName: "proposal.pdf", byteSize: 3, sha256: "a".repeat(64) };
    await executeOutboundAttempt(db.value, { ...input, messageType: "document", mediaReference }, async () => providerReference);
    const insert = db.connection.execute.mock.calls.find(call => String(call[0]).includes("INSERT INTO megadesk_domain_conversations_messages"));
    const serialized = String(insert?.[1][13]);
    expect(JSON.parse(serialized)).toEqual(mediaReference);
    expect(serialized).not.toMatch(/mediaData|base64|dataUrl|data:.*;base64/i);
  });

  it("uses the router's private-storage provider path after pending persistence and retains media when the provider fails", async () => {
    const root = await temporaryRoot();
    const clientAttemptId = randomUUID();
    const bytes = Buffer.from("private attachment fixture");
    const dataUrl = `data:application/pdf;base64,${bytes.toString("base64")}`;
    try {
      const decoded = decodeConversationMediaDataUrl(dataUrl, "application/pdf");
      expect(decoded).toMatchObject({ bytes, mimeType: "application/pdf" });
      const mediaReference = await writeConversationMedia({ clientId: "tenant-a", bytes: decoded!.bytes,
        mimeType: decoded!.mimeType, fileName: "proposal.pdf", objectId: clientAttemptId, root });
      const db = pool();
      const privateRead = vi.fn((request: any) =>
        readConversationMedia({ ...request, root }));
      const provider = vi.fn(async (providerInput: any) => {
        expect(db.connection.commit).toHaveBeenCalledOnce();
        return providerReference;
      });

      await executeOutboundAttempt(db.value, {
        ...input, messageId: "local-media", clientAttemptId, messageType: "document", mediaReference,
        legacyMessage: { type: "document", fileName: "proposal.pdf", byteSize: bytes.length },
      }, () => sendOutboundConversationMediaFromPrivateStorage({
        clientId: "tenant-a", mediaReference, instanceName: "megadesk-tenant-a", number: "5541999999999",
        kind: "document", caption: "Proposal",
      }, { read: privateRead, send: provider }));

      const insert = db.connection.execute.mock.calls.find(call => String(call[0]).includes("INSERT INTO megadesk_domain_conversations_messages"));
      const persistedReference = String(insert?.[1][13]);
      expect(JSON.parse(persistedReference)).toEqual(mediaReference);
      expect(persistedReference).not.toMatch(/mediaData|base64|dataUrl|data:.*;base64/i);
      expect(mediaReference.storageKey).toMatch(/^tenants\/tenant-a\/conversation-media\//);
      expect(path.isAbsolute(mediaReference.storageKey)).toBe(false);
      expect(privateRead).toHaveBeenCalledWith({ clientId: "tenant-a", reference: mediaReference });
      expect(provider).toHaveBeenCalledWith(expect.objectContaining({ dataUrl, mimeType: "application/pdf", fileName: "proposal.pdf" }));

      const failed = pool();
      await expect(executeOutboundAttempt(failed.value, {
        ...input, messageId: "local-media-failed", clientAttemptId: randomUUID(), messageType: "document", mediaReference,
        legacyMessage: { type: "document", fileName: "proposal.pdf", byteSize: bytes.length },
      }, () => sendOutboundConversationMediaFromPrivateStorage({
        clientId: "tenant-a", mediaReference, instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "document",
      }, {
        read: request => readConversationMedia({ ...request, root }),
        send: async () => { throw new Error("provider unavailable"); },
      }))).rejects.toThrow("provider unavailable");
      await expect(readConversationMedia({ clientId: "tenant-a", reference: mediaReference, root }))
        .resolves.toMatchObject({ bytes });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
