import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";

export type ConversationReceiptStatus = "pending" | "sent" | "delivered" | "read" | "played" | "failed";

export type ConversationReceiptIdentity = {
  clientId: string;
  provider: string;
  integrationId: string;
  externalMessageId: string;
};

export type ConversationReceiptInput = ConversationReceiptIdentity & {
  status: ConversationReceiptStatus;
  providerEventAt: string | null;
  receivedAt: Date;
};

export type ConversationReceiptPersistenceResult = {
  affectedRows: number;
  matchedRows: number;
  applied: boolean;
  deferred: boolean;
  zeroMatch: boolean;
  storedStatus: string | null;
};

export type ConversationReceiptReplayResult = {
  reconciled: boolean;
  applied: boolean;
  messageId: string | null;
  storedStatus: string | null;
};

export type ReceiptSqlExecutor = {
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown?]>;
};

export const PENDING_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const PENDING_RECEIPT_CLEANUP_LIMIT = 100;

/**
 * Canonical successful progression. `failed` is a separate terminal state and
 * deliberately ranks above successful receipts so a provider failure cannot be
 * overwritten by a later ambiguous callback.
 */
export const CONVERSATION_RECEIPT_STATUS_RANK: Readonly<Record<ConversationReceiptStatus, number>> = Object.freeze({
  pending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  played: 5,
  failed: 6,
});

export function strongestConversationReceiptStatus(
  current: ConversationReceiptStatus,
  incoming: ConversationReceiptStatus,
): ConversationReceiptStatus {
  if (current === "failed") return current;
  if (incoming === "failed") {
    return CONVERSATION_RECEIPT_STATUS_RANK[current] <= CONVERSATION_RECEIPT_STATUS_RANK.sent
      ? incoming
      : current;
  }
  return CONVERSATION_RECEIPT_STATUS_RANK[incoming] > CONVERSATION_RECEIPT_STATUS_RANK[current]
    ? incoming
    : current;
}

export function conversationReceiptLockName(input: ConversationReceiptIdentity): string {
  return createHash("sha256")
    .update("receipt\0")
    .update(input.clientId)
    .update("\0")
    .update(input.provider)
    .update("\0")
    .update(input.integrationId)
    .update("\0")
    .update(input.externalMessageId)
    .digest("hex");
}

const MONOTONIC_MESSAGE_UPDATE_SQL = `UPDATE megadesk_domain_conversations_messages
 SET status = ?, updated_at = NOW()
 WHERE client_id = ? AND provider = ? AND integration_id = ?
   AND external_message_id = ? AND direction = 'outbound'
   AND status <> 'failed'
   AND ((? = 'failed' AND status IN ('pending', 'sent'))
     OR (? <> 'failed'
       AND FIELD(?, 'pending', 'sent', 'delivered', 'read', 'played')
         > FIELD(status, 'pending', 'sent', 'delivered', 'read', 'played')))`;

async function findMessageStatus(
  executor: ReceiptSqlExecutor,
  identity: ConversationReceiptIdentity,
): Promise<{ messageId: string; status: string } | null> {
  const [matched] = await executor.execute(
    `SELECT message_id AS messageId, status
     FROM megadesk_domain_conversations_messages
     WHERE client_id = ? AND provider = ? AND integration_id = ?
       AND external_message_id = ? AND direction = 'outbound' LIMIT 1`,
    [identity.clientId, identity.provider, identity.integrationId, identity.externalMessageId],
  );
  const rows = Array.isArray(matched) ? matched as Array<{ messageId?: unknown; status?: unknown }> : [];
  return typeof rows[0]?.status === "string"
    ? { messageId: typeof rows[0].messageId === "string" ? rows[0].messageId : "", status: rows[0].status }
    : null;
}

/** Runs inside the caller's transaction. */
export async function persistOrApplyConversationReceipt(
  executor: ReceiptSqlExecutor,
  input: ConversationReceiptInput,
): Promise<ConversationReceiptPersistenceResult> {
  const updateValues = [input.status, input.clientId, input.provider, input.integrationId,
    input.externalMessageId, input.status, input.status, input.status];
  const [result] = await executor.execute(MONOTONIC_MESSAGE_UPDATE_SQL, updateValues);
  const affectedRows = Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0);
  if (affectedRows > 0) {
    return { affectedRows, matchedRows: 1, applied: true, deferred: false, zeroMatch: false, storedStatus: input.status };
  }

  const matched = await findMessageStatus(executor, input);
  if (matched) {
    return { affectedRows: 0, matchedRows: 1, applied: false, deferred: false, zeroMatch: false, storedStatus: matched.status };
  }

  const rank = CONVERSATION_RECEIPT_STATUS_RANK[input.status];
  const expiresAt = new Date(input.receivedAt.getTime() + PENDING_RECEIPT_TTL_MS);
  await executor.execute(
    `INSERT INTO megadesk_conversation_pending_receipts
       (receipt_id, client_id, provider, integration_id, external_message_id, status, status_rank,
        provider_event_at, received_at, expires_at, replay_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE
       provider_event_at = IF(
         status <> 'failed' AND ((VALUES(status) = 'failed' AND status_rank <= 2)
           OR (VALUES(status) <> 'failed' AND VALUES(status_rank) > status_rank)),
         VALUES(provider_event_at), provider_event_at),
       status_rank = CASE
         WHEN status = 'failed' THEN status_rank
         WHEN VALUES(status) = 'failed' AND status_rank <= 2 THEN VALUES(status_rank)
         WHEN VALUES(status) = 'failed' THEN status_rank
         ELSE GREATEST(status_rank, VALUES(status_rank)) END,
       status = CASE
         WHEN status = 'failed' THEN status
         WHEN status_rank = 6 THEN 'failed'
         WHEN VALUES(status) <> 'failed' AND status_rank = VALUES(status_rank) THEN VALUES(status)
         ELSE status END,
       received_at = LEAST(received_at, VALUES(received_at)),
       expires_at = expires_at,
       replay_state = 'pending', message_id = NULL, replayed_at = NULL, updated_at = NOW()`,
    [randomUUID(), input.clientId, input.provider, input.integrationId, input.externalMessageId,
      input.status, rank, input.providerEventAt === null ? null : new Date(input.providerEventAt),
      input.receivedAt, expiresAt],
  );
  const [pendingRows] = await executor.execute(
    `SELECT status FROM megadesk_conversation_pending_receipts
     WHERE client_id = ? AND provider = ? AND integration_id = ? AND external_message_id = ? LIMIT 1`,
    [input.clientId, input.provider, input.integrationId, input.externalMessageId],
  );
  const pending = Array.isArray(pendingRows) ? pendingRows as Array<{ status?: unknown }> : [];
  const storedStatus = typeof pending[0]?.status === "string" ? pending[0].status : input.status;
  return { affectedRows: 0, matchedRows: 0, applied: false, deferred: true, zeroMatch: true, storedStatus };
}

/** Runs in the same transaction that attaches the provider external ID. */
export async function reconcilePendingConversationReceipt(
  executor: ReceiptSqlExecutor,
  identity: ConversationReceiptIdentity,
): Promise<ConversationReceiptReplayResult> {
  const [pendingRows] = await executor.execute(
    `SELECT receipt_id AS receiptId, status
     FROM megadesk_conversation_pending_receipts
     WHERE client_id = ? AND provider = ? AND integration_id = ? AND external_message_id = ?
       AND replay_state = 'pending' AND expires_at > NOW() LIMIT 1 FOR UPDATE`,
    [identity.clientId, identity.provider, identity.integrationId, identity.externalMessageId],
  );
  const pending = Array.isArray(pendingRows)
    ? pendingRows as Array<{ receiptId?: unknown; status?: unknown }>
    : [];
  if (typeof pending[0]?.receiptId !== "string" || typeof pending[0]?.status !== "string") {
    return { reconciled: false, applied: false, messageId: null, storedStatus: null };
  }
  const status = pending[0].status as ConversationReceiptStatus;
  if (!(status in CONVERSATION_RECEIPT_STATUS_RANK)) {
    throw new Error("PENDING_RECEIPT_STATUS_INVALID");
  }
  const [updateResult] = await executor.execute(MONOTONIC_MESSAGE_UPDATE_SQL, [
    status, identity.clientId, identity.provider, identity.integrationId, identity.externalMessageId,
    status, status, status,
  ]);
  const applied = Number((updateResult as { affectedRows?: unknown } | null)?.affectedRows ?? 0) > 0;
  const message = await findMessageStatus(executor, identity);
  if (!message?.messageId) throw new Error("PENDING_RECEIPT_MESSAGE_MISSING");
  await executor.execute(
    `UPDATE megadesk_conversation_pending_receipts
     SET replay_state = 'replayed', message_id = ?, replayed_at = NOW(), updated_at = NOW()
     WHERE receipt_id = ? AND client_id = ? AND provider = ? AND integration_id = ?
       AND external_message_id = ? AND replay_state = 'pending'`,
    [message.messageId, pending[0].receiptId, identity.clientId, identity.provider,
      identity.integrationId, identity.externalMessageId],
  );
  return { reconciled: true, applied, messageId: message.messageId, storedStatus: message.status };
}

async function withReceiptTransaction<T>(
  pool: Pool,
  identity: ConversationReceiptIdentity,
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();
  const lockName = conversationReceiptLockName(identity);
  try {
    const [lockRows] = await connection.execute("SELECT GET_LOCK(?, 10) AS acquired", [lockName]) as any[];
    if (Number(lockRows?.[0]?.acquired) !== 1) throw new Error("RECEIPT_RECONCILIATION_LOCK_TIMEOUT");
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
    connection.release();
  }
}

export async function persistConversationReceipt(
  pool: Pool,
  input: ConversationReceiptInput,
): Promise<ConversationReceiptPersistenceResult> {
  return withReceiptTransaction(pool, input, connection => persistOrApplyConversationReceipt(connection, input));
}

export async function reconcileConversationReceiptAfterOutbound(
  pool: Pool,
  identity: ConversationReceiptIdentity,
  attachExternalId: (connection: PoolConnection) => Promise<void>,
): Promise<ConversationReceiptReplayResult> {
  return withReceiptTransaction(pool, identity, async connection => {
    await attachExternalId(connection);
    return reconcilePendingConversationReceipt(connection, identity);
  });
}

export async function cleanupExpiredConversationReceipts(
  executor: ReceiptSqlExecutor,
  limit = PENDING_RECEIPT_CLEANUP_LIMIT,
): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(PENDING_RECEIPT_CLEANUP_LIMIT, Math.trunc(limit)));
  const [result] = await executor.execute(
    `DELETE FROM megadesk_conversation_pending_receipts
     WHERE expires_at <= NOW() ORDER BY expires_at LIMIT ${boundedLimit}`,
  );
  return Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0);
}
