/**
 * WhatsApp Module — Types
 * Todos os tipos do módulo são definidos aqui para facilitar extração futura como microserviço.
 */

// ─── Conta WhatsApp ────────────────────────────────────────────────────────────

export type WaAccountStatus = "active" | "inactive" | "error";

export interface WaAccountRecord {
  id: string;
  clientId: string;
  displayName: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  webhookVerifyToken: string;
  status: WaAccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Conversas ─────────────────────────────────────────────────────────────────

export type WaConversationStatus = "open" | "pending" | "closed";

export interface WaConversationRecord {
  id: string;
  clientId: string;
  accountId: string;
  customerName: string;
  customerPhone: string;
  lastMessage: string | null;
  lastMessageAt: Date;
  unreadCount: number;
  status: WaConversationStatus;
  assignedUserId: string | null;
  crmClientId: string | null;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Mensagens ─────────────────────────────────────────────────────────────────

export type WaSenderType = "customer" | "agent" | "bot";
export type WaMessageType = "text" | "image" | "audio" | "video" | "document" | "template" | "sticker" | "location" | "reaction";
export type WaMessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export interface WaMessageRecord {
  id: string;
  conversationId: string;
  clientId: string;
  waMessageId: string | null;
  senderType: WaSenderType;
  messageType: WaMessageType;
  content: string | null;
  mediaUrl: string | null;
  mediaId: string | null;
  caption: string | null;
  status: WaMessageStatus;
  errorMessage: string | null;
  metadataJson: string | null;
  createdAt: Date;
}

// ─── Payloads de entrada ───────────────────────────────────────────────────────

export interface CreateWaAccountInput {
  clientId: string;
  displayName: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
}

export interface SendTextMessageInput {
  clientId: string;
  accountId: string;
  to: string; // número destino
  text: string;
  conversationId?: string;
}

export interface SendMediaMessageInput {
  clientId: string;
  accountId: string;
  to: string;
  type: "image" | "audio" | "video" | "document";
  mediaUrl: string;
  caption?: string;
  filename?: string;
}

export interface SendTemplateMessageInput {
  clientId: string;
  accountId: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: MetaTemplateComponent[];
}

// ─── Meta API Types ────────────────────────────────────────────────────────────

export interface MetaTemplateComponent {
  type: "header" | "body" | "button";
  parameters: MetaTemplateParameter[];
}

export interface MetaTemplateParameter {
  type: "text" | "image" | "document" | "video";
  text?: string;
  image?: { link: string };
  document?: { link: string; filename?: string };
}

export interface MetaSendMessageResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string; message_status?: string }[];
}

// ─── Webhook Payload Types (Meta Cloud API) ────────────────────────────────────

export interface MetaWebhookPayload {
  object: string;
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string;
  changes: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  value: MetaWebhookValue;
  field: string;
}

export interface MetaWebhookValue {
  messaging_product: string;
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: MetaWebhookContact[];
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
  errors?: MetaWebhookError[];
}

export interface MetaWebhookContact {
  profile: { name: string };
  wa_id: string;
}

export interface MetaWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: WaMessageType;
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  audio?: { id: string; mime_type: string };
  video?: { id: string; mime_type: string; sha256: string; caption?: string };
  document?: { id: string; filename: string; mime_type: string; sha256: string; caption?: string };
  sticker?: { id: string; mime_type: string; sha256: string; animated: boolean };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  reaction?: { message_id: string; emoji: string };
  context?: { from: string; id: string };
}

export interface MetaWebhookStatus {
  id: string;
  recipient_id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  errors?: MetaWebhookError[];
}

export interface MetaWebhookError {
  code: number;
  title: string;
  message?: string;
  error_data?: { details: string };
}

// ─── Socket.IO Events ──────────────────────────────────────────────────────────

export interface WaSocketEvents {
  // Server → Client
  "wa:new_message": (data: { conversation: WaConversationRecord; message: WaMessageRecord }) => void;
  "wa:message_status": (data: { messageId: string; waMessageId: string; status: WaMessageStatus }) => void;
  "wa:conversation_updated": (data: { conversation: WaConversationRecord }) => void;
  "wa:new_conversation": (data: { conversation: WaConversationRecord }) => void;
  // Client → Server
  "wa:join_client": (clientId: string) => void;
  "wa:leave_client": (clientId: string) => void;
}
