import type { PoolConnection } from "mysql2/promise";
import { isDuplicateConstraint } from "./conversation-public-code";
import { normalizeProviderMessageReference, type ProviderMessageReference } from "./conversation-provider-reference";
import { containsConversationMediaBinary } from "./conversation-media-storage";

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

const TRANSIENT_MEDIA_FIELDS = new Set(["mediadata", "base64", "dataurl"]);
const BINARY_DATA_URL = /^data:[^,]+;base64,[A-Za-z0-9+/=\s]*$/i;

/**
 * The compatibility mirror is never a binary transport.  This applies to all
 * writers, including the older global-state snapshot writer, so a new Data URL
 * cannot re-enter MySQL through a path other than the canonical media writer.
 */
export function stripTransientConversationMedia(value: unknown, depth = 0): unknown {
  if (depth > 16 || value == null || typeof value !== "object") {
    return typeof value === "string" && BINARY_DATA_URL.test(value) ? undefined : value;
  }
  if (Array.isArray(value)) return value
    .map(item => stripTransientConversationMedia(item, depth + 1))
    .filter(item => item !== undefined);
  const safe: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (TRANSIENT_MEDIA_FIELDS.has(key.toLowerCase())) continue;
    const sanitized = stripTransientConversationMedia(nested, depth + 1);
    if (sanitized !== undefined) safe[key] = sanitized;
  }
  return safe;
}

export function sanitizeConversationMessagesForPersistence(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .map(message => stripTransientConversationMedia(message))
    .filter(message => message !== undefined);
}

export function lightweightLegacyMessage(input: CanonicalMessageWrite): Record<string, unknown> {
  const metadata = stripTransientConversationMedia(input.legacyMessage) as Record<string, unknown>;
  if (input.mediaReference == null) return metadata;
  return {
    ...metadata,
    mediaReference: { storage: "private", messageId: input.messageId },
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
  // V1 rows are read-only compatibility data. Every new canonical write must use
  // metadata or a V2 local reference, never a transient provider/browser payload.
  if (input.mediaReference != null && containsConversationMediaBinary(input.mediaReference)) {
    throw new Error("CONVERSATION_MEDIA_BINARY_REFERENCE_FORBIDDEN");
  }
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
