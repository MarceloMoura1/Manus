import { normalizeProviderMessageReference, type ProviderMessageReference } from "./conversation-provider-reference";

type SqlConnection = { execute: (sql: string, values: unknown[]) => Promise<any> };

export class ConversationReplyResolutionError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT", message: string) {
    super(message);
  }
}

export async function resolveConversationReplyReference(connection: SqlConnection, input: {
  clientId: string;
  conversationId: string;
  integrationId: string;
  replyToMessageId?: string;
}): Promise<ProviderMessageReference | undefined> {
  if (!input.replyToMessageId) return undefined;
  const [rows] = await connection.execute(
    `SELECT message_id, conversation_id, external_message_id, provider, integration_id, provider_message_reference
     FROM megadesk_domain_conversations_messages
     WHERE client_id = ? AND message_id = ? LIMIT 1`,
    [input.clientId, input.replyToMessageId],
  ) as any[];
  const original = rows[0];
  if (!original) {
    throw new ConversationReplyResolutionError("NOT_FOUND", "Mensagem citada não encontrada neste cliente.");
  }
  if (original.conversation_id !== input.conversationId) {
    throw new ConversationReplyResolutionError("BAD_REQUEST", "A mensagem citada não pertence a este atendimento.");
  }
  if (original.provider !== "evolution" || original.integration_id !== input.integrationId) {
    throw new ConversationReplyResolutionError("BAD_REQUEST", "A mensagem citada não pertence a este canal do WhatsApp.");
  }
  const reference = normalizeProviderMessageReference(original.provider_message_reference);
  if (!original.external_message_id || !reference || reference.key.id !== original.external_message_id) {
    throw new ConversationReplyResolutionError("CONFLICT", "A mensagem citada ainda não possui referência WhatsApp disponível.");
  }
  return reference;
}
