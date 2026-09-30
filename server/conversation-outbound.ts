import type { Pool, PoolConnection } from "mysql2/promise";
import { createHash } from "node:crypto";
import { persistCanonicalMessage, type CanonicalMessageWrite } from "./conversation-message-store";
import { normalizeProviderMessageReference, type ProviderMessageReference } from "./conversation-provider-reference";
import { readConversationMedia, writeConversationMedia, type ConversationMediaReferenceV2 } from "./conversation-media-storage";
import { capturePreEvolutionAudioDiagnostic } from "./audio-pre-evolution-diagnostic";
import { normalizeOutboundAudio, OUTBOUND_AUDIO_MIME_TYPE } from "./outbound-audio-normalization";
import {
  reconcileConversationReceiptAfterOutbound,
  type ConversationReceiptReplayResult,
} from "./conversation-receipt-store";

export type OutboundAttemptInput = Omit<CanonicalMessageWrite, "direction" | "status" | "externalMessageId" | "clientAttemptId"> & {
  clientAttemptId: string;
  recipient: string;
};

const OUTBOUND_ATTEMPT_BINDING_KEY = "_megadeskOutboundAttempt";
type OutboundAttemptBinding = { version: 1; fingerprint: string };

/**
 * Binds a browser-generated retry ID to the logical server-side operation.
 * The hash is deliberately streamed from bounded canonical fields; it never
 * serializes media bytes or transient provider/browser URLs.
 */
export function outboundAttemptFingerprint(input: OutboundAttemptInput): string {
  const hash = createHash("sha256");
  const field = (name: string, value: unknown) => hash.update(name).update("\0").update(String(value ?? "")).update("\0");
  field("tenant", input.clientId);
  field("conversation", input.conversationId);
  field("recipient", input.recipient.trim().toLowerCase());
  field("provider", input.provider);
  field("integration", input.integrationId);
  field("sender", input.sender);
  field("senderUser", input.senderUserId);
  field("type", input.messageType);
  field("text", input.text);
  field("reply", input.replyToMessageId);
  const media = input.mediaReference as Partial<ConversationMediaReferenceV2> | null | undefined;
  field("mediaSha256", media?.sha256);
  field("mediaMime", media?.mimeType?.toLowerCase());
  field("mediaName", media?.fileName);
  field("mediaSize", media?.byteSize);
  return hash.digest("hex");
}

function withOutboundAttemptBinding(
  mediaReference: Record<string, unknown> | null | undefined,
  fingerprint: string,
): Record<string, unknown> {
  return { ...(mediaReference ?? {}), [OUTBOUND_ATTEMPT_BINDING_KEY]: { version: 1, fingerprint } satisfies OutboundAttemptBinding };
}

function storedOutboundAttemptFingerprint(value: unknown): string | null {
  if (typeof value === "string") {
    try { return storedOutboundAttemptFingerprint(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const binding = (value as Record<string, unknown>)[OUTBOUND_ATTEMPT_BINDING_KEY];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return null;
  const fingerprint = (binding as Record<string, unknown>).fingerprint;
  return typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint) ? fingerprint : null;
}

export class OutboundReconciliationError extends Error {
  constructor(public readonly messageId: string, public readonly intendedStatus: "sent" | "failed", cause: unknown) {
    super(intendedStatus === "sent" ? "OUTBOUND_SENT_RECONCILIATION_PENDING" : "OUTBOUND_FAILED_RECONCILIATION_PENDING", { cause });
  }
}

export class OutboundProviderOutcomeUncertainError extends Error {
  constructor(public readonly messageId: string, cause: unknown) {
    super("OUTBOUND_PROVIDER_OUTCOME_UNCERTAIN", { cause });
    this.name = "OutboundProviderOutcomeUncertainError";
  }
}

export class OutboundPreProviderFailureError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "OUTBOUND_PRE_PROVIDER_FAILURE", { cause });
    this.name = "OutboundPreProviderFailureError";
  }
}

export class OutboundAttemptAlreadyRecordedError extends Error {
  constructor(public readonly status: string) { super("OUTBOUND_ATTEMPT_ALREADY_RECORDED"); }
}

export class OutboundAttemptConflictError extends Error {
  constructor() {
    super("OUTBOUND_ATTEMPT_CONTEXT_CONFLICT");
    this.name = "OutboundAttemptConflictError";
  }
}

/** The pending row never committed, so a caller may safely compensate its new object. */
export class OutboundPendingPersistenceError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "OUTBOUND_PENDING_PERSISTENCE_FAILED", { cause });
  }
}

/**
 * Only an explicit 4xx provider response proves that the provider rejected the
 * request. Transport failures, 5xx responses and malformed success responses
 * may happen after provider acceptance and must remain pending.
 */
export function isDefinitiveOutboundProviderFailure(error: unknown): boolean {
  if (error instanceof OutboundPreProviderFailureError) return true;
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = Number((error as { status?: unknown }).status);
  return [400, 401, 403, 404, 405, 413, 415, 422].includes(status);
}

export function isOutboundOutcomeUncertain(error: unknown): boolean {
  return error instanceof OutboundProviderOutcomeUncertainError
    || error instanceof OutboundReconciliationError
    || error instanceof OutboundAttemptConflictError
    || (error instanceof OutboundAttemptAlreadyRecordedError && error.status !== "failed");
}

type ConversationAttachmentKind = "image" | "video" | "audio" | "document" | "sticker";
type OutboundAudioSource = "recording" | "attachment";
type ConversationAttachmentProviderInput = {
  instanceName: string;
  number: string;
  kind: ConversationAttachmentKind;
  dataUrl: string;
  mimeType: string;
  fileName?: string;
  caption?: string;
  quoted?: ProviderMessageReference;
};

export class OutboundAudioSourceRequiredError extends Error {
  constructor() {
    super("OUTBOUND_AUDIO_SOURCE_REQUIRED");
    this.name = "OutboundAudioSourceRequiredError";
  }
}

export class OutboundRecordedAudioCanonicalMediaError extends Error {
  constructor() {
    super("OUTBOUND_RECORDED_AUDIO_CANONICAL_MEDIA_REQUIRED");
    this.name = "OutboundRecordedAudioCanonicalMediaError";
  }
}

/**
 * Creates the one private canonical representation used by both the timeline
 * and the provider. Only browser recordings are repaired; normal attachments
 * and every other media kind remain byte-identical.
 */
export async function writeOutboundConversationMedia(
  input: {
    clientId: string;
    bytes: Buffer;
    mimeType: string;
    fileName?: string | null;
    objectId: string;
    kind: ConversationAttachmentKind;
    mediaSource?: OutboundAudioSource;
  },
  dependencies: {
    normalizeAudio?: typeof normalizeOutboundAudio;
    write?: typeof writeConversationMedia;
  } = {},
): Promise<ConversationMediaReferenceV2> {
  if (input.kind === "audio" && input.mediaSource === undefined) {
    throw new OutboundAudioSourceRequiredError();
  }
  const canonicalMedia = input.kind === "audio" && input.mediaSource === "recording"
    ? await (dependencies.normalizeAudio ?? normalizeOutboundAudio)({ bytes: input.bytes, mimeType: input.mimeType })
    : { bytes: input.bytes, mimeType: input.mimeType, ...(input.fileName ? { fileName: input.fileName } : {}) };
  return (dependencies.write ?? writeConversationMedia)({
    clientId: input.clientId,
    bytes: canonicalMedia.bytes,
    mimeType: canonicalMedia.mimeType,
    fileName: canonicalMedia.fileName,
    objectId: input.objectId,
  });
}

/** The router's provider payload is built only after re-reading the private V2 object. */
export async function sendOutboundConversationMediaFromPrivateStorage(
  input: Omit<ConversationAttachmentProviderInput, "dataUrl" | "mimeType" | "fileName"> & {
    clientId: string;
    mediaReference: ConversationMediaReferenceV2;
    mediaSource?: OutboundAudioSource;
    recordingInput?: { mimeType: string; byteLength: number };
  },
  dependencies: {
    read?: typeof readConversationMedia;
    send: (input: ConversationAttachmentProviderInput) => Promise<ProviderMessageReference>;
    captureAudioDiagnostic?: typeof capturePreEvolutionAudioDiagnostic;
  },
): Promise<ProviderMessageReference> {
  let stored: Awaited<ReturnType<typeof readConversationMedia>>;
  let normalizationAttempted: boolean;
  try {
    // These checks and the private read happen before dependencies.send. Their
    // failure therefore proves that no provider request was attempted.
    if (input.kind === "audio" && input.mediaSource === undefined) {
      throw new OutboundAudioSourceRequiredError();
    }
    stored = await (dependencies.read ?? readConversationMedia)({ clientId: input.clientId, reference: input.mediaReference });
    normalizationAttempted = input.kind === "audio" && input.mediaSource === "recording";
    if (normalizationAttempted && stored.mimeType !== OUTBOUND_AUDIO_MIME_TYPE) {
      throw new OutboundRecordedAudioCanonicalMediaError();
    }
  } catch (error) {
    throw new OutboundPreProviderFailureError(error);
  }
  const providerMedia = stored;
  if (input.kind === "audio") {
    await (dependencies.captureAudioDiagnostic ?? capturePreEvolutionAudioDiagnostic)({
      bytes: providerMedia.bytes,
      mimeType: providerMedia.mimeType,
      tenantId: input.clientId,
      mediaSource: input.mediaSource,
      normalizationAttempted,
      inputMimeType: input.recordingInput?.mimeType ?? stored.mimeType,
      inputByteLength: input.recordingInput?.byteLength ?? stored.bytes.length,
      normalizationFallback: false,
    }).catch(() => null);
  }
  return dependencies.send({
    instanceName: input.instanceName,
    number: input.number,
    kind: input.kind,
    dataUrl: `data:${providerMedia.mimeType};base64,${providerMedia.bytes.toString("base64")}`,
    mimeType: providerMedia.mimeType,
    ...(providerMedia.fileName ? { fileName: providerMedia.fileName } : {}),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(input.quoted !== undefined ? { quoted: input.quoted } : {}),
  });
}

export async function reconcileOutboundDelivery(pool: Pool, input: OutboundAttemptInput, status: "sent" | "failed", externalMessageId?: string,
  providerMessageReference?: ProviderMessageReference | null): Promise<ConversationReceiptReplayResult> {
  const reference = normalizeProviderMessageReference(providerMessageReference);
  const attach = async (executor: Pick<PoolConnection, "execute">) => {
    const [result] = await executor.execute(
      `UPDATE megadesk_domain_conversations_messages
       SET status = CASE
           WHEN ? = 'sent' AND status = 'pending' THEN 'sent'
           WHEN ? = 'failed' AND status IN ('pending', 'sent') THEN 'failed'
           ELSE status END,
         external_message_id = COALESCE(?, external_message_id),
         provider_message_reference = COALESCE(?, provider_message_reference), updated_at = NOW()
       WHERE message_id = ? AND conversation_id = ? AND client_id = ? AND provider = ? AND integration_id = ?`,
       [status, status, externalMessageId ?? null, reference ? JSON.stringify(reference) : null,
         input.messageId, input.conversationId, input.clientId, input.provider, input.integrationId],
    );
    if (Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0) === 0) {
      const [rows] = await executor.execute(
        `SELECT message_id FROM megadesk_domain_conversations_messages
         WHERE message_id = ? AND conversation_id = ? AND client_id = ? AND provider = ? AND integration_id = ? LIMIT 1`,
        [input.messageId, input.conversationId, input.clientId, input.provider, input.integrationId],
      );
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error("OUTBOUND_DELIVERY_UPDATE_MISSING");
    }
  };
  if (status === "sent" && externalMessageId) {
    return reconcileConversationReceiptAfterOutbound(pool, {
      clientId: input.clientId,
      provider: input.provider,
      integrationId: input.integrationId,
      externalMessageId,
    }, attach);
  }
  await attach(pool as unknown as PoolConnection);
  return { reconciled: false, applied: false, messageId: null, storedStatus: null };
}

export type OutboundAttemptDependencies = {
  emitReceipt?: (clientId: string, payload: { status: string; receivedAt: string }) => Promise<void>;
};

export async function executeOutboundAttempt(
  pool: Pool,
  input: OutboundAttemptInput,
  sendProvider: () => Promise<ProviderMessageReference>,
  dependencies: OutboundAttemptDependencies = {},
): Promise<{ messageId: string; externalMessageId: string; status: "sent" }> {
  const connection = await pool.getConnection();
  let existing: { message_id: string; status: string; external_message_id: string | null; media_reference: unknown } | undefined;
  const fingerprint = outboundAttemptFingerprint(input);
  const lockName = createHash("sha256").update(`outbound\0${input.clientId}\0${input.clientAttemptId}`).digest("hex");
  try {
    const [lockRows] = await connection.execute("SELECT GET_LOCK(?, 10) AS acquired", [lockName]) as any[];
    if (Number(lockRows?.[0]?.acquired) !== 1) throw new Error("OUTBOUND_ATTEMPT_LOCK_TIMEOUT");
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT message_id, status, external_message_id, media_reference FROM megadesk_domain_conversations_messages
       WHERE client_id = ? AND client_attempt_id = ? LIMIT 1 FOR UPDATE`,
      [input.clientId, input.clientAttemptId],
    ) as any[];
    existing = rows[0];
    if (existing && storedOutboundAttemptFingerprint(existing.media_reference) !== fingerprint) {
      throw new OutboundAttemptConflictError();
    }
    if (!existing) {
      await persistCanonicalMessage(connection as PoolConnection, {
        ...input,
        mediaReference: withOutboundAttemptBinding(input.mediaReference, fingerprint),
        direction: "outbound", status: "pending", externalMessageId: null,
      });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    if (error instanceof OutboundAttemptConflictError) throw error;
    throw new OutboundPendingPersistenceError(error);
  } finally {
    await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    connection.release();
  }

  if (existing?.external_message_id && ["sent", "delivered", "read", "played"].includes(existing.status)) {
    return { messageId: existing.message_id, externalMessageId: existing.external_message_id, status: "sent" };
  }
  if (existing) throw new OutboundAttemptAlreadyRecordedError(existing.status);

  let response: ProviderMessageReference;
  try {
    response = await sendProvider();
    response = normalizeProviderMessageReference(response) as ProviderMessageReference;
    if (!response) throw new Error("PROVIDER_MESSAGE_REFERENCE_MISSING");
  } catch (error) {
    if (!isDefinitiveOutboundProviderFailure(error)) {
      throw new OutboundProviderOutcomeUncertainError(input.messageId, error);
    }
    try {
      await reconcileOutboundDelivery(pool, input, "failed");
    } catch (reconciliationError) {
      throw new OutboundReconciliationError(input.messageId, "failed", new AggregateError(
        [error, reconciliationError],
        "OUTBOUND_PROVIDER_AND_FAILURE_RECONCILIATION_FAILED",
      ));
    }
    throw error;
  }

  try {
    const replay = await reconcileOutboundDelivery(pool, input, "sent", response.key.id, response);
    if (replay.reconciled && replay.storedStatus) {
      const emitReceipt = dependencies.emitReceipt ?? (async (clientId, payload) => {
        const { emitOperationalTenantEventAsync } = await import("./modules/whatsapp/socket/whatsapp.socket");
        await emitOperationalTenantEventAsync(clientId, "conversation:receipt", { clientId, ...payload });
      });
      await emitReceipt(input.clientId, {
        status: replay.storedStatus,
        receivedAt: new Date().toISOString(),
      }).catch(() => {
        console.warn("[Evolution Receipt] reconciled receipt realtime delivery failed");
      });
    }
  } catch (error) {
    throw new OutboundReconciliationError(input.messageId, "sent", error);
  }
  return { messageId: input.messageId, externalMessageId: response.key.id, status: "sent" };
}
