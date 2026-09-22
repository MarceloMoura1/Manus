import type { Pool, PoolConnection } from "mysql2/promise";
import { createHash } from "node:crypto";
import { persistCanonicalMessage, type CanonicalMessageWrite } from "./conversation-message-store";
import { normalizeProviderMessageReference, type ProviderMessageReference } from "./conversation-provider-reference";
import { readConversationMedia, type ConversationMediaReferenceV2 } from "./conversation-media-storage";

export type OutboundAttemptInput = Omit<CanonicalMessageWrite, "direction" | "status" | "externalMessageId" | "clientAttemptId"> & {
  clientAttemptId: string;
};

export class OutboundReconciliationError extends Error {
  constructor(public readonly messageId: string, cause: unknown) {
    super("OUTBOUND_SENT_RECONCILIATION_PENDING", { cause });
  }
}

export class OutboundAttemptAlreadyRecordedError extends Error {
  constructor(public readonly status: string) { super("OUTBOUND_ATTEMPT_ALREADY_RECORDED"); }
}

/** The pending row never committed, so a caller may safely compensate its new object. */
export class OutboundPendingPersistenceError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "OUTBOUND_PENDING_PERSISTENCE_FAILED", { cause });
  }
}

type ConversationAttachmentKind = "image" | "video" | "audio" | "document" | "sticker";
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

/** The router's provider payload is built only after re-reading the private V2 object. */
export async function sendOutboundConversationMediaFromPrivateStorage(
  input: Omit<ConversationAttachmentProviderInput, "dataUrl" | "mimeType" | "fileName"> & {
    clientId: string;
    mediaReference: ConversationMediaReferenceV2;
  },
  dependencies: {
    read?: typeof readConversationMedia;
    send: (input: ConversationAttachmentProviderInput) => Promise<ProviderMessageReference>;
  },
): Promise<ProviderMessageReference> {
  const stored = await (dependencies.read ?? readConversationMedia)({ clientId: input.clientId, reference: input.mediaReference });
  return dependencies.send({
    instanceName: input.instanceName,
    number: input.number,
    kind: input.kind,
    dataUrl: `data:${stored.mimeType};base64,${stored.bytes.toString("base64")}`,
    mimeType: stored.mimeType,
    ...(stored.fileName ? { fileName: stored.fileName } : {}),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(input.quoted !== undefined ? { quoted: input.quoted } : {}),
  });
}

async function updateDelivery(pool: Pool, input: OutboundAttemptInput, status: "sent" | "failed", externalMessageId?: string,
  providerMessageReference?: ProviderMessageReference | null) {
  const reference = normalizeProviderMessageReference(providerMessageReference);
  await pool.execute(
    `UPDATE megadesk_domain_conversations_messages
     SET status = ?, external_message_id = COALESCE(?, external_message_id),
       provider_message_reference = COALESCE(?, provider_message_reference), updated_at = NOW()
     WHERE message_id = ? AND conversation_id = ? AND client_id = ? AND provider = ? AND integration_id = ?`,
     [status, externalMessageId ?? null, reference ? JSON.stringify(reference) : null,
       input.messageId, input.conversationId, input.clientId, input.provider, input.integrationId],
  );
}

export async function executeOutboundAttempt(
  pool: Pool,
  input: OutboundAttemptInput,
  sendProvider: () => Promise<ProviderMessageReference>,
): Promise<{ messageId: string; externalMessageId: string; status: "sent" }> {
  const connection = await pool.getConnection();
  let existing: { message_id: string; status: string; external_message_id: string | null } | undefined;
  const lockName = createHash("sha256").update(`outbound\0${input.clientId}\0${input.clientAttemptId}`).digest("hex");
  try {
    const [lockRows] = await connection.execute("SELECT GET_LOCK(?, 10) AS acquired", [lockName]) as any[];
    if (Number(lockRows?.[0]?.acquired) !== 1) throw new Error("OUTBOUND_ATTEMPT_LOCK_TIMEOUT");
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT message_id, status, external_message_id FROM megadesk_domain_conversations_messages
       WHERE client_id = ? AND client_attempt_id = ? LIMIT 1 FOR UPDATE`,
      [input.clientId, input.clientAttemptId],
    ) as any[];
    existing = rows[0];
    if (!existing) {
      await persistCanonicalMessage(connection as PoolConnection, {
        ...input, direction: "outbound", status: "pending", externalMessageId: null,
      });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw new OutboundPendingPersistenceError(error);
  } finally {
    await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    connection.release();
  }

  if (existing?.status === "sent" && existing.external_message_id) {
    return { messageId: existing.message_id, externalMessageId: existing.external_message_id, status: "sent" };
  }
  if (existing) throw new OutboundAttemptAlreadyRecordedError(existing.status);

  let response: ProviderMessageReference;
  try {
    response = await sendProvider();
    response = normalizeProviderMessageReference(response) as ProviderMessageReference;
    if (!response) throw new Error("PROVIDER_MESSAGE_REFERENCE_MISSING");
  } catch (error) {
    await updateDelivery(pool, input, "failed").catch(() => undefined);
    throw error;
  }

  try {
    await updateDelivery(pool, input, "sent", response.key.id, response);
  } catch (error) {
    throw new OutboundReconciliationError(input.messageId, error);
  }
  return { messageId: input.messageId, externalMessageId: response.key.id, status: "sent" };
}
