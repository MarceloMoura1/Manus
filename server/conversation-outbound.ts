import type { Pool, PoolConnection } from "mysql2/promise";
import { createHash } from "node:crypto";
import { persistCanonicalMessage, type CanonicalMessageWrite } from "./conversation-message-store";
import { normalizeProviderMessageReference, type ProviderMessageReference } from "./conversation-provider-reference";

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
    throw error;
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
