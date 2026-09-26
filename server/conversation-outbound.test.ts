import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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

  it("normalizes audio and captures the exact OGG buffer immediately before the provider send", async () => {
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x10, 0x20]);
    const normalizedBytes = Buffer.from("OggS-normalized");
    const mediaReference = { version: 2 as const, storage: "local" as const,
      storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin",
      mimeType: "audio/webm", fileName: "audio.webm", byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") };
    const events: string[] = [];
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
      expect(captured).toBe(normalizedBytes);
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
    const normalizeAudio = vi.fn(async ({ bytes: source, mimeType }: { bytes: Buffer; mimeType: string }) => {
      events.push("normalize");
      expect(source).toEqual(bytes);
      expect(mimeType).toBe("audio/webm");
      return { bytes: normalizedBytes, mimeType: "audio/ogg" as const, fileName: "audio.ogg" as const };
    });

    await sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a", mediaReference, instanceName: "megadesk-tenant-a",
      number: "5541999999999", kind: "audio", mediaSource: "recording",
    }, {
      read: vi.fn(async request => {
        expect(request).toEqual({ clientId: "tenant-a", reference: mediaReference });
        return { bytes, mimeType: "audio/webm", fileName: "audio.webm" };
      }),
      captureAudioDiagnostic,
      normalizeAudio,
      send,
    });

    expect(events).toEqual(["normalize", "capture", "send"]);
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not capture non-audio attachments", async () => {
    const captureAudioDiagnostic = vi.fn();
    const normalizeAudio = vi.fn();
    await sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "image/png", byteSize: 1, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "image",
    }, {
      read: async () => ({ bytes: Buffer.from([1]), mimeType: "image/png" }),
      captureAudioDiagnostic,
      normalizeAudio,
      send: async () => providerReference,
    });
    expect(captureAudioDiagnostic).not.toHaveBeenCalled();
    expect(normalizeAudio).not.toHaveBeenCalled();
  });

  it("keeps the provider send unchanged if optional diagnostic capture fails", async () => {
    const send = vi.fn(async () => providerReference);
    await sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "audio/webm", byteSize: 1, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "audio", mediaSource: "recording",
    }, {
      read: async () => ({ bytes: Buffer.from([1]), mimeType: "audio/webm" }),
      normalizeAudio: async () => ({ bytes: Buffer.from("OggS"), mimeType: "audio/ogg", fileName: "audio.ogg" }),
      captureAudioDiagnostic: async () => { throw new Error("diagnostic unavailable"); },
      send,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("never falls back to the original audio when normalization fails", async () => {
    const send = vi.fn();
    const captureAudioDiagnostic = vi.fn();
    await expect(sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "audio/webm", byteSize: 1, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "audio", mediaSource: "recording",
    }, {
      read: async () => ({ bytes: Buffer.from([1]), mimeType: "audio/webm", fileName: "recording.webm" }),
      normalizeAudio: async () => { throw new Error("normalization failed"); },
      captureAudioDiagnostic,
      send,
    })).rejects.toThrow("normalization failed");
    expect(captureAudioDiagnostic).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["audio/webm", "audio/ogg", "audio/mp4"])("normalizes each supported MediaRecorder %s format", async mimeType => {
    const send = vi.fn(async () => providerReference);
    await sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType, byteSize: 1, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "audio", mediaSource: "recording",
    }, {
      read: async () => ({ bytes: Buffer.from([1]), mimeType }),
      normalizeAudio: async () => ({ bytes: Buffer.from("OggS"), mimeType: "audio/ogg", fileName: "audio.ogg" }),
      captureAudioDiagnostic: async () => null,
      send,
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      dataUrl: `data:audio/ogg;base64,${Buffer.from("OggS").toString("base64")}`,
      mimeType: "audio/ogg",
      fileName: "audio.ogg",
    }));
  });

  it.each([
    ["audio/mpeg", "existing.mp3"],
    ["audio/ogg", "existing.ogg"],
  ])("keeps normal %s attachments byte-identical without FFmpeg", async (mimeType, fileName) => {
    const original = Buffer.from(`original-${mimeType}`);
    const normalizeAudio = vi.fn();
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
      normalizeAudio,
      captureAudioDiagnostic,
      send,
    });
    expect(normalizeAudio).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      dataUrl: `data:${mimeType};base64,${original.toString("base64")}`,
      mimeType,
      fileName,
    }));
    expect(captureAudioDiagnostic).toHaveBeenCalledOnce();
  });

  it("fails closed for ambiguous audio without mediaSource instead of sending stored WebM", async () => {
    const normalizeAudio = vi.fn();
    const captureAudioDiagnostic = vi.fn(async () => null);
    const send = vi.fn(async () => providerReference);
    await expect(sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "audio/webm", byteSize: 1, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "audio",
    }, {
      read: async () => ({ bytes: Buffer.from([1]), mimeType: "audio/webm" }),
      normalizeAudio,
      captureAudioDiagnostic,
      send,
    })).rejects.toThrow("OUTBOUND_AUDIO_SOURCE_REQUIRED");
    expect(normalizeAudio).not.toHaveBeenCalled();
    expect(captureAudioDiagnostic).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not call the provider when normalization cleanup fails", async () => {
    const send = vi.fn();
    await expect(sendOutboundConversationMediaFromPrivateStorage({
      clientId: "tenant-a",
      mediaReference: { version: 2, storage: "local", storageKey: "tenants/tenant-a/conversation-media/22/22222222-2222-4222-8222-222222222222.bin", mimeType: "audio/webm", byteSize: 1, sha256: "a".repeat(64) },
      instanceName: "megadesk-tenant-a", number: "5541999999999", kind: "audio", mediaSource: "recording",
    }, {
      read: async () => ({ bytes: Buffer.from([1]), mimeType: "audio/webm" }),
      normalizeAudio: async () => { throw Object.assign(new Error("OUTBOUND_AUDIO_NORMALIZATION_FAILED"), { stage: "cleanup" }); },
      captureAudioDiagnostic: async () => null,
      send,
    })).rejects.toMatchObject({ stage: "cleanup" });
    expect(send).not.toHaveBeenCalled();
  });
});
