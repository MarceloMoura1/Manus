import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { executeOutboundAttempt, outboundAttemptFingerprint, OutboundAttemptAlreadyRecordedError, OutboundAttemptConflictError, OutboundPendingPersistenceError, OutboundPreProviderFailureError, OutboundProviderOutcomeUncertainError, OutboundReconciliationError, reconcileOutboundDelivery, sendOutboundConversationMediaFromPrivateStorage, writeOutboundConversationMedia } from "./conversation-outbound";
import { decodeConversationMediaDataUrl, readConversationMedia, writeConversationMedia } from "./conversation-media-storage";

const input = {
  messageId: "local-1", clientAttemptId: "attempt-1", conversationId: "conv-1", clientId: "tenant-a", provider: "evolution",
  integrationId: "instance-a", recipient: "5541999999999", messageType: "text", sender: "agent" as const, text: "hello",
  timestamp: new Date("2026-08-29T12:00:00Z"), legacyMessage: { from: "agent", text: "hello" },
};

const providerReference = {
  key: { id: "provider-1", remoteJid: "5541999999999@s.whatsapp.net", fromMe: true },
  message: { conversation: "hello" },
};

function pool(options: { insertError?: Error; reconciliationError?: Error; reconciliationAffectedRows?: number;
  reconciliationRowExists?: boolean; existing?: any; pendingReceipt?: { receiptId: string; status: string } } = {}) {
  const existing = options.existing ? {
    ...options.existing,
    media_reference: options.existing.media_reference ?? JSON.stringify({
      _megadeskOutboundAttempt: { version: 1, fingerprint: outboundAttemptFingerprint(input) },
    }),
  } : undefined;
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
    execute: vi.fn(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("client_attempt_id") && sql.includes("SELECT message_id")) return [[existing].filter(Boolean)];
      if (sql.includes("INSERT INTO megadesk_domain_conversations_messages") && options.insertError) throw options.insertError;
      if (sql.includes("SELECT messages_json")) return [[{ messages_json: "[]" }]];
      if (sql.startsWith("UPDATE megadesk_domain_conversations_messages")) {
        if (options.reconciliationError) throw options.reconciliationError;
        return [{ affectedRows: options.reconciliationAffectedRows ?? 1 }];
      }
      if (sql.startsWith("SELECT message_id FROM megadesk_domain_conversations_messages")) {
        return [options.reconciliationRowExists ? [{ message_id: input.messageId }] : []];
      }
      if (sql.includes("FROM megadesk_conversation_pending_receipts")) {
        return [[...(options.pendingReceipt ? [options.pendingReceipt] : [])]];
      }
      if (sql.includes("FROM megadesk_domain_conversations_messages") && sql.includes("external_message_id")) {
        return [[{ messageId: input.messageId, status: options.pendingReceipt?.status ?? "sent" }]];
      }
      return [{ affectedRows: 1 }];
    }),
  };
  const execute = vi.fn(async () => {
    if (options.reconciliationError) throw options.reconciliationError;
    if (options.reconciliationAffectedRows === 0 && options.reconciliationRowExists) {
      return [[{ message_id: input.messageId }]];
    }
    return [{ affectedRows: options.reconciliationAffectedRows ?? 1 }];
  });
  return { value: { getConnection: vi.fn(async () => connection), execute } as any, connection, execute };
}

function providerRejection(status: number, message = "provider rejected") {
  return Object.assign(new Error(message), { status });
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
    const delivery = db.connection.execute.mock.calls.find(call => String(call[0]).startsWith("UPDATE megadesk_domain_conversations_messages"));
    expect(delivery?.[1]).toEqual(["sent", "sent", "provider-1", JSON.stringify(providerReference), "local-1", "conv-1", "tenant-a", "evolution", "instance-a"]);
    expect(String(delivery?.[0])).toContain("WHEN ? = 'sent' AND status = 'pending' THEN 'sent'");
    expect(String(delivery?.[0])).toContain("WHEN ? = 'failed' AND status IN ('pending', 'sent') THEN 'failed'");
  });

  it("accepts an idempotent zero-change reattach when the fully scoped message still exists", async () => {
    const db = pool({ reconciliationAffectedRows: 0, reconciliationRowExists: true });
    await expect(reconcileOutboundDelivery(db.value, input, "sent", "provider-1", providerReference))
      .resolves.toMatchObject({ reconciled: false });
    expect(db.connection.commit).toHaveBeenCalledOnce();
    expect(db.connection.execute.mock.calls.some(call => String(call[0])
      .startsWith("SELECT message_id FROM megadesk_domain_conversations_messages"))).toBe(true);
  });

  it("never calls provider when initial persistence fails", async () => {
    const db = pool({ insertError: new Error("database unavailable") });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, input, send)).rejects.toBeInstanceOf(OutboundPendingPersistenceError);
    expect(send).not.toHaveBeenCalled();
  });

  it("marks failed only when the provider definitively rejects before acceptance", async () => {
    const db = pool();
    const send = vi.fn(async () => { throw providerRejection(422); });
    await expect(executeOutboundAttempt(db.value, input, send)).rejects.toThrow("provider rejected");
    expect(db.connection.commit).toHaveBeenCalledOnce();
    expect(db.execute.mock.calls[0][1][0]).toBe("failed");
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    Object.assign(new Error("request timed out"), { name: "TimeoutError" }),
    new Error("ECONNRESET after request write"),
    providerRejection(503, "provider unavailable after request"),
  ])("keeps an uncertain provider outcome pending without a second send", async (providerError) => {
    const db = pool();
    const send = vi.fn(async () => { throw providerError; });
    await expect(executeOutboundAttempt(db.value, input, send))
      .rejects.toBeInstanceOf(OutboundProviderOutcomeUncertainError);
    expect(send).toHaveBeenCalledOnce();
    expect(db.execute).not.toHaveBeenCalled();

    const retry = pool({ existing: { message_id: input.messageId, status: "pending", external_message_id: null } });
    await expect(executeOutboundAttempt(retry.value, input, send))
      .rejects.toBeInstanceOf(OutboundAttemptAlreadyRecordedError);
    expect(send).toHaveBeenCalledOnce();
  });

  it("leaves a reconcilable pending row when post-provider update fails", async () => {
    const db = pool({ reconciliationError: new Error("update failed") });
    await expect(executeOutboundAttempt(db.value, input, async () => providerReference))
      .rejects.toBeInstanceOf(OutboundReconciliationError);
    expect(db.connection.commit).toHaveBeenCalledOnce();
  });

  it("CAUSAL replays a pending receipt in the outbound reconciliation boundary and emits tenant-scoped realtime", async () => {
    const db = pool({ pendingReceipt: { receiptId: "receipt-1", status: "read" } });
    const emitReceipt = vi.fn().mockResolvedValue(undefined);
    await expect(executeOutboundAttempt(db.value, input, async () => providerReference, { emitReceipt }))
      .resolves.toMatchObject({ status: "sent", externalMessageId: "provider-1" });
    expect(emitReceipt).toHaveBeenCalledWith("tenant-a", expect.objectContaining({ status: "read" }));
    expect(db.connection.commit).toHaveBeenCalledTimes(2);
    const replayMark = db.connection.execute.mock.calls.find(call => String(call[0]).startsWith("UPDATE megadesk_conversation_pending_receipts"));
    expect(replayMark?.[1]).toEqual(expect.arrayContaining(["local-1", "receipt-1", "tenant-a", "evolution", "instance-a", "provider-1"]));
  });

  it("treats a zero-row sent reconciliation as uncertain instead of reporting success", async () => {
    const db = pool({ reconciliationAffectedRows: 0 });
    const send = vi.fn(async () => providerReference);
    await expect(executeOutboundAttempt(db.value, input, send))
      .rejects.toMatchObject({
        name: "Error",
        message: "OUTBOUND_SENT_RECONCILIATION_PENDING",
        intendedStatus: "sent",
      });
    expect(send).toHaveBeenCalledOnce();

    const retry = pool({ existing: { message_id: input.messageId, status: "pending", external_message_id: null } });
    await expect(executeOutboundAttempt(retry.value, input, send))
      .rejects.toBeInstanceOf(OutboundAttemptAlreadyRecordedError);
    expect(send).toHaveBeenCalledOnce();
  });

  it("surfaces a zero-row failed reconciliation instead of silently swallowing it", async () => {
    const db = pool({ reconciliationAffectedRows: 0 });
    await expect(executeOutboundAttempt(db.value, input, async () => { throw providerRejection(400); }))
      .rejects.toMatchObject({
        name: "Error",
        message: "OUTBOUND_FAILED_RECONCILIATION_PENDING",
        intendedStatus: "failed",
      });
  });

  it.each(["sent", "delivered", "read", "played"])("returns an already-confirmed %s attempt without calling provider", async (status) => {
    const db = pool({ existing: { message_id: "stored-1", status, external_message_id: "provider-1" } });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, input, send)).resolves.toEqual({ messageId: "stored-1", externalMessageId: "provider-1", status: "sent" });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the same attempt identifier isolated between tenants", async () => {
    const tenantB = { ...input, clientId: "tenant-b", conversationId: "conv-b", integrationId: "instance-b",
      recipient: "5511888888888", messageId: "local-b" };
    const db = pool();
    const send = vi.fn(async () => providerReference);
    await expect(executeOutboundAttempt(db.value, tenantB, send)).resolves.toMatchObject({ status: "sent" });
    expect(send).toHaveBeenCalledOnce();
    const lookup = db.connection.execute.mock.calls.find(call => String(call[0]).includes("client_attempt_id"));
    expect(lookup?.[1]).toEqual(["tenant-b", "attempt-1"]);
  });

  it.each(["pending", "failed"])("does not blindly resend an existing %s attempt", async (status) => {
    const db = pool({ existing: { message_id: "stored-1", status, external_message_id: null } });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, input, send)).rejects.toBeInstanceOf(OutboundAttemptAlreadyRecordedError);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["payload", { text: "different payload" }],
    ["conversation", { conversationId: "conv-2" }],
    ["recipient", { recipient: "5511999999999" }],
  ])("fails closed when the same attempt ID is reused with a different %s", async (_field, change) => {
    const db = pool({ existing: { message_id: "stored-1", status: "sent", external_message_id: "provider-1" } });
    const send = vi.fn();
    await expect(executeOutboundAttempt(db.value, { ...input, ...change }, send))
      .rejects.toBeInstanceOf(OutboundAttemptConflictError);
    expect(send).not.toHaveBeenCalled();
  });

  it("allows an explicit new logical attempt after a definitive failure without reusing the failed identity", async () => {
    const first = pool();
    const firstSend = vi.fn(async () => { throw providerRejection(400); });
    await expect(executeOutboundAttempt(first.value, input, firstSend)).rejects.toThrow("provider rejected");

    const second = pool();
    const secondSend = vi.fn(async () => providerReference);
    await expect(executeOutboundAttempt(second.value, {
      ...input,
      messageId: "local-2",
      clientAttemptId: "attempt-2",
    }, secondSend)).resolves.toMatchObject({ status: "sent" });
    expect(firstSend).toHaveBeenCalledOnce();
    expect(secondSend).toHaveBeenCalledOnce();
  });

  it("marks a proven pre-provider media failure as definitive without calling the provider", async () => {
    const db = pool();
    const provider = vi.fn();
    const mediaReference = { version: 2 as const, storage: "local" as const,
      storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin",
      mimeType: "application/pdf", fileName: "proposal.pdf", byteSize: 3, sha256: "a".repeat(64) };

    await expect(executeOutboundAttempt(db.value, {
      ...input,
      messageType: "document",
      mediaReference,
    }, () => sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference,
      instanceName: "instance-a",
      number: "5541999999999",
      kind: "document",
    }, {
      read: vi.fn().mockRejectedValue(new Error("private object unavailable")),
      send: provider,
    }))).rejects.toBeInstanceOf(OutboundPreProviderFailureError);
    expect(provider).not.toHaveBeenCalled();
    expect(db.execute.mock.calls[0][1][0]).toBe("failed");
  });

  it("allows at most one provider send while a concurrent request uses the same attempt identity", async () => {
    let pendingPersisted = false;
    const connections = Array.from({ length: 3 }, () => ({
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
        if (sql.includes("SELECT message_id")) return [pendingPersisted
          ? [{ message_id: input.messageId, status: "pending", external_message_id: null,
            media_reference: JSON.stringify({ _megadeskOutboundAttempt: { version: 1, fingerprint: outboundAttemptFingerprint(input) } }) }]
          : []];
        if (sql.includes("INSERT INTO megadesk_domain_conversations_messages")) pendingPersisted = true;
        if (sql.includes("SELECT messages_json")) return [[{ messages_json: "[]" }]];
        if (sql.includes("FROM megadesk_conversation_pending_receipts")) return [[]];
        return [{ affectedRows: 1 }];
      }),
    }));
    const db = {
      getConnection: vi.fn()
        .mockResolvedValueOnce(connections[0])
        .mockResolvedValueOnce(connections[1])
        .mockResolvedValueOnce(connections[2]),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    } as any;
    let releaseProvider!: (value: typeof providerReference) => void;
    const providerBlocked = new Promise<typeof providerReference>(resolve => { releaseProvider = resolve; });
    const send = vi.fn(() => providerBlocked);

    const firstRequest = executeOutboundAttempt(db, input, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await expect(executeOutboundAttempt(db, input, send)).rejects.toBeInstanceOf(OutboundAttemptAlreadyRecordedError);
    expect(send).toHaveBeenCalledOnce();
    releaseProvider(providerReference);
    await expect(firstRequest).resolves.toMatchObject({ status: "sent" });
    expect(send).toHaveBeenCalledOnce();
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
    expect(JSON.parse(serialized)).toMatchObject(mediaReference);
    expect(JSON.parse(serialized)._megadeskOutboundAttempt.fingerprint).toMatch(/^[a-f0-9]{64}$/);
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
      expect(JSON.parse(persistedReference)).toMatchObject(mediaReference);
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
      }))).rejects.toBeInstanceOf(OutboundProviderOutcomeUncertainError);
      await expect(readConversationMedia({ clientId: "tenant-a", reference: mediaReference, root }))
        .resolves.toMatchObject({ bytes });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes a recording once before storage and sends the exact canonical OGG bytes", async () => {
    const root = await temporaryRoot();
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x10, 0x20]);
    const normalizedBytes = Buffer.from("OggS-normalized");
    const events: string[] = [];
    const normalizeAudio = vi.fn(async ({ bytes: source, mimeType }: { bytes: Buffer; mimeType: string }) => {
      events.push("normalize");
      expect(source).toEqual(bytes);
      expect(mimeType).toBe("audio/webm");
      return { bytes: normalizedBytes, mimeType: "audio/ogg" as const, fileName: "audio.ogg" as const };
    });
    const captureAudioDiagnostic = vi.fn(async ({
      bytes: captured, mimeType, tenantId, mediaSource, normalizationAttempted,
      inputMimeType, inputByteLength, normalizationFallback,
    }: {
      bytes: Buffer;
      mimeType: string;
      tenantId: string;
      mediaSource?: "recording" | "attachment";
      normalizationAttempted?: boolean;
      inputMimeType?: string;
      inputByteLength?: number;
      normalizationFallback?: false;
    }) => {
      events.push("capture");
      expect(captured).toEqual(normalizedBytes);
      expect(mimeType).toBe("audio/ogg");
      expect(tenantId).toBe("tenant-a");
      expect({ mediaSource, normalizationAttempted, inputMimeType, inputByteLength, normalizationFallback }).toEqual({
        mediaSource: "recording",
        normalizationAttempted: true,
        inputMimeType: "audio/webm",
        inputByteLength: bytes.length,
        normalizationFallback: false,
      });
      return null;
    });
    const send = vi.fn(async providerInput => {
      events.push("send");
      const providerBytes = Buffer.from(providerInput.dataUrl.split(",")[1], "base64");
      expect(providerBytes).toEqual(normalizedBytes);
      expect(createHash("sha256").update(providerBytes).digest("hex"))
        .toBe(createHash("sha256").update(normalizedBytes).digest("hex"));
      expect(providerBytes).not.toEqual(bytes);
      expect(providerInput).toMatchObject({ mimeType: "audio/ogg", fileName: "audio.ogg" });
      return providerReference;
    });
    try {
      const mediaReference = await writeOutboundConversationMedia({
        clientId: "tenant-a", bytes, mimeType: "audio/webm", fileName: "recording.webm",
        objectId: randomUUID(), kind: "audio", mediaSource: "recording",
      }, {
        normalizeAudio,
        write: request => writeConversationMedia({ ...request, root }),
      });
      const canonical = await readConversationMedia({ clientId: "tenant-a", reference: mediaReference, root });
      expect(mediaReference).toMatchObject({
        mimeType: "audio/ogg", fileName: "audio.ogg", byteSize: normalizedBytes.length,
        sha256: createHash("sha256").update(normalizedBytes).digest("hex"),
      });
      expect(canonical.bytes).toEqual(normalizedBytes);

      await sendOutboundConversationMediaFromPrivateStorage({
        clientId: "tenant-a", mediaReference, instanceName: "megadesk-tenant-a",
        number: "5541999999999", kind: "audio", mediaSource: "recording",
        recordingInput: { mimeType: "audio/webm", byteLength: bytes.length },
      }, {
        read: request => readConversationMedia({ ...request, root }),
        captureAudioDiagnostic,
        send,
      });

      expect(events).toEqual(["normalize", "capture", "send"]);
      expect(normalizeAudio).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores the repaired recording bytes as the canonical media served by the timeline", async () => {
    const root = await temporaryRoot();
    const original = Buffer.from("synthetic-malformed-webm-timeline");
    const normalized = Buffer.from("OggS-synthetic-repaired-timeline");
    const objectId = randomUUID();
    try {
      const normalizeAudio = vi.fn(async () => ({
        bytes: normalized,
        mimeType: "audio/ogg" as const,
        fileName: "audio.ogg" as const,
      }));
      const mediaReference = await writeOutboundConversationMedia({
        clientId: "tenant-a",
        bytes: original,
        mimeType: "audio/webm",
        fileName: "recording.webm",
        objectId,
        kind: "audio",
        mediaSource: "recording",
      }, {
        normalizeAudio,
        write: request => writeConversationMedia({ ...request, root }),
      });
      const provider = vi.fn(async () => providerReference);
      await sendOutboundConversationMediaFromPrivateStorage({
        clientId: "tenant-a",
        mediaReference,
        instanceName: "megadesk-tenant-a",
        number: "5541999999999",
        kind: "audio",
        mediaSource: "recording",
      }, {
        read: request => readConversationMedia({ ...request, root }),
        captureAudioDiagnostic: async () => null,
        send: provider,
      });

      const canonical = await readConversationMedia({ clientId: "tenant-a", reference: mediaReference, root });
      const providerBytes = Buffer.from(provider.mock.calls[0][0].dataUrl.split(",")[1], "base64");
      expect(canonical.mimeType).toBe("audio/ogg");
      expect(canonical.bytes).toEqual(normalized);
      expect(mediaReference.byteSize).toBe(normalized.length);
      expect(mediaReference.sha256).toBe(createHash("sha256").update(normalized).digest("hex"));
      expect(providerBytes).toEqual(canonical.bytes);
      expect(normalizeAudio).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not capture non-audio attachments", async () => {
    const captureAudioDiagnostic = vi.fn();
    await sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "image/png", byteSize: 1, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "image",
    }, {
      read: async () => ({ bytes: Buffer.from([1]), mimeType: "image/png" }),
      captureAudioDiagnostic,
      send: async () => providerReference,
    });
    expect(captureAudioDiagnostic).not.toHaveBeenCalled();
  });

  it("keeps the provider send unchanged if optional diagnostic capture fails", async () => {
    const send = vi.fn(async () => providerReference);
    await sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "audio/ogg", byteSize: 4, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "audio", mediaSource: "recording",
    }, {
      read: async () => ({ bytes: Buffer.from("OggS"), mimeType: "audio/ogg", fileName: "audio.ogg" }),
      captureAudioDiagnostic: async () => { throw new Error("diagnostic unavailable"); },
      send,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("never falls back to the original audio when normalization fails", async () => {
    const write = vi.fn();
    await expect(writeOutboundConversationMedia({
      clientId: "tenant-a", bytes: Buffer.from([1]), mimeType: "audio/webm",
      objectId: randomUUID(), kind: "audio", mediaSource: "recording",
    }, {
      normalizeAudio: async () => { throw new Error("normalization failed"); },
      write,
    })).rejects.toThrow("normalization failed");
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["audio/webm", "audio/ogg", "audio/mp4"])("normalizes each supported MediaRecorder %s format", async mimeType => {
    const write = vi.fn(async () => ({ version: 2 as const, storage: "local" as const,
      storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin",
      mimeType: "audio/ogg", fileName: "audio.ogg", byteSize: 4, sha256: "a".repeat(64) }));
    await writeOutboundConversationMedia({
      clientId: "tenant-a", bytes: Buffer.from([1]), mimeType,
      objectId: randomUUID(), kind: "audio", mediaSource: "recording",
    }, {
      normalizeAudio: async () => ({ bytes: Buffer.from("OggS"), mimeType: "audio/ogg", fileName: "audio.ogg" }),
      write,
    });
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      bytes: Buffer.from("OggS"),
      mimeType: "audio/ogg",
      fileName: "audio.ogg",
    }));
  });

  it.each([
    ["image", undefined, "image/png", "image.png"],
    ["video", undefined, "video/mp4", "video.mp4"],
    ["document", undefined, "application/pdf", "document.pdf"],
    ["sticker", undefined, "image/webp", "sticker.webp"],
    ["audio", "attachment", "audio/mpeg", "attachment.mp3"],
  ] as const)("writes %s media without normalization", async (kind, mediaSource, mimeType, fileName) => {
    const bytes = Buffer.from(`unchanged-${kind}`);
    const normalizeAudio = vi.fn();
    const write = vi.fn(async () => ({ version: 2 as const, storage: "local" as const,
      storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin",
      mimeType, fileName, byteSize: bytes.length, sha256: "a".repeat(64) }));
    await writeOutboundConversationMedia({
      clientId: "tenant-a", bytes, mimeType, fileName, objectId: randomUUID(), kind, mediaSource,
    }, { normalizeAudio, write });
    expect(normalizeAudio).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "tenant-a", bytes, mimeType, fileName,
    }));
    expect(write.mock.calls[0][0].bytes).toBe(bytes);
  });

  it.each([
    ["audio/mpeg", "existing.mp3"],
    ["audio/ogg", "existing.ogg"],
  ])("keeps normal %s attachments byte-identical without FFmpeg", async (mimeType, fileName) => {
    const original = Buffer.from(`original-${mimeType}`);
    const captureAudioDiagnostic = vi.fn(async input => {
      expect(input.bytes).toBe(original);
      expect(input).toMatchObject({
        mimeType,
        mediaSource: "attachment",
        normalizationAttempted: false,
        inputMimeType: mimeType,
        inputByteLength: original.length,
        normalizationFallback: false,
      });
      return null;
    });
    const send = vi.fn(async () => providerReference);
    await sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType, fileName, byteSize: original.length, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "audio", mediaSource: "attachment",
    }, {
      read: async () => ({ bytes: original, mimeType, fileName }),
      captureAudioDiagnostic,
      send,
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      dataUrl: `data:${mimeType};base64,${original.toString("base64")}`,
      mimeType,
      fileName,
    }));
    expect(captureAudioDiagnostic).toHaveBeenCalledOnce();
  });

  it("fails closed for ambiguous audio without mediaSource instead of sending stored WebM", async () => {
    const captureAudioDiagnostic = vi.fn(async () => null);
    const send = vi.fn(async () => providerReference);
    await expect(sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "audio/webm", byteSize: 1, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "audio",
    }, {
      read: async () => ({ bytes: Buffer.from([1]), mimeType: "audio/webm" }),
      captureAudioDiagnostic,
      send,
    })).rejects.toThrow("OUTBOUND_AUDIO_SOURCE_REQUIRED");
    expect(captureAudioDiagnostic).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not write canonical media when normalization cleanup fails", async () => {
    const write = vi.fn();
    await expect(writeOutboundConversationMedia({
      clientId: "tenant-a", bytes: Buffer.from([1]), mimeType: "audio/webm",
      objectId: randomUUID(), kind: "audio", mediaSource: "recording",
    }, {
      normalizeAudio: async () => { throw Object.assign(new Error("OUTBOUND_AUDIO_NORMALIZATION_FAILED"), { stage: "cleanup" }); },
      write,
    })).rejects.toMatchObject({ stage: "cleanup" });
    expect(write).not.toHaveBeenCalled();
  });

  it("fails closed if a recording bypasses canonical normalization", async () => {
    const captureAudioDiagnostic = vi.fn();
    const send = vi.fn();
    await expect(sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "audio/webm", byteSize: 1, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "audio", mediaSource: "recording",
    }, {
      read: async () => ({ bytes: Buffer.from([1]), mimeType: "audio/webm" }),
      captureAudioDiagnostic,
      send,
    })).rejects.toThrow("OUTBOUND_RECORDED_AUDIO_CANONICAL_MEDIA_REQUIRED");
    expect(captureAudioDiagnostic).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
