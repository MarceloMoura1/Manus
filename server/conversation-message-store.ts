import type { PoolConnection } from "mysql2/promise";
import { isDuplicateConstraint } from "./conversation-public-code";
import { normalizeProviderMessageReference, type ProviderMessageReference } from "./conversation-provider-reference";

export type CanonicalMessageWrite = {
  messageId: string;
  conversationId: string;
  clientId: string;
  externalMessageId?: string | null;
  provider: string;
  integrationId: string;
  clientAttemptId?: string | null;
  replyToMessageId?: string | null;
  providerMessageReference?: ProviderMessageReference | null;
  direction: "inbound" | "outbound" | "system";
  messageType: string;
  sender: "customer" | "agent" | "bot" | "system";
  senderUserId?: string | null;
  senderNameSnapshot?: string | null;
  text: string;
  status: string;
  timestamp: Date;
  legacyMessage: Record<string, unknown>;
  mediaReference?: Record<string, unknown> | null;
  incrementUnread?: boolean;
};

export function lightweightLegacyMessage(input: CanonicalMessageWrite): Record<string, unknown> {
  if (input.mediaReference == null) return input.legacyMessage;
  const { mediaData: _mediaData, base64: _base64, dataUrl: _dataUrl, ...metadata } = input.legacyMessage as any;
  return {
    ...metadata,
    mediaReference: { storage: "normalized", messageId: input.messageId },
  };
}

/** The compatibility JSON must carry the same identity as its normalized source. */
export function canonicalMessageMirror(input: CanonicalMessageWrite): Record<string, unknown> {
  const providerMessageReference = normalizeProviderMessageReference(input.providerMessageReference);
  return {
    ...lightweightLegacyMessage(input),
    id: input.messageId,
    ...(input.externalMessageId ? { externalMessageId: input.externalMessageId } : {}),
    ...(input.clientAttemptId ? { clientAttemptId: input.clientAttemptId } : {}),
    ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
    ...(providerMessageReference ? { providerMessageReference } : {}),
    from: input.sender,
    direction: input.direction,
    type: input.messageType,
    text: input.text,
    timestamp: input.timestamp.toISOString(),
    status: input.status,
  };
}

/** Transitional single writer. The normalized row wins; JSON is updated only after that insert. */
export async function persistCanonicalMessage(connection: PoolConnection, input: CanonicalMessageWrite): Promise<boolean> {
  try {
    await connection.execute(
    `INSERT INTO megadesk_domain_conversations_messages
     (message_id, conversation_id, client_id, external_message_id, provider, integration_id, client_attempt_id, reply_to_message_id, provider_message_reference, direction, message_type,
       sender_user_id, sender_name_snapshot, media_reference, sender, message, timestamp, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.messageId, input.conversationId, input.clientId, input.externalMessageId ?? null, input.provider,
      input.integrationId, input.clientAttemptId ?? null, input.replyToMessageId ?? null,
      (() => { const reference = normalizeProviderMessageReference(input.providerMessageReference); return reference ? JSON.stringify(reference) : null; })(),
      input.direction, input.messageType,
      input.senderUserId ?? null, input.senderNameSnapshot ?? null,
      input.mediaReference == null ? null : JSON.stringify(input.mediaReference),
      input.sender, input.text, input.timestamp, input.status],
    );
  } catch (error) {
    if (isDuplicateConstraint(error, "uq_mdcm_external")) return false;
    throw error;
  }
  const [rows] = await connection.execute(
    `SELECT messages_json FROM megadesk_domain_conversations
     WHERE conversation_id = ? AND client_id = ? LIMIT 1 FOR UPDATE`, [input.conversationId, input.clientId],
  ) as any[];
  if (!rows.length) throw new Error("ATTENDANCE_NOT_FOUND");
  let messages: unknown[] = [];
  try { messages = JSON.parse(rows[0].messages_json || "[]"); } catch { messages = []; }
  if (!messages.some((item: any) => item?.id === input.messageId ||
    (input.externalMessageId != null && item?.externalMessageId === input.externalMessageId))) {
    messages.push(canonicalMessageMirror(input));
  }
  await connection.execute(
    `UPDATE megadesk_domain_conversations SET messages_json = ?, last_message = ?,
     last_message_from = ?, unread_count = unread_count + ?, updated_at = NOW()
     WHERE conversation_id = ? AND client_id = ?`,
    [JSON.stringify(messages), input.text.substring(0, 255), input.sender === "customer" ? "customer" : input.sender,
      input.incrementUnread ? 1 : 0, input.conversationId, input.clientId],
  );
  return true;
}
