/**
 * WhatsApp Module — Validators (Zod)
 * Validações de entrada para procedures tRPC e webhooks.
 */
import { z } from "zod";

// ─── Conta WhatsApp ────────────────────────────────────────────────────────────

export const createWaAccountSchema = z.object({
  clientId: z.string().min(1),
  displayName: z.string().min(1).max(180),
  phoneNumberId: z.string().min(1),
  businessAccountId: z.string().min(1),
  accessToken: z.string().min(1),
});

export const updateWaAccountSchema = z.object({
  clientId: z.string().min(1),
  accountId: z.string().min(1),
  displayName: z.string().min(1).max(180).optional(),
  accessToken: z.string().min(1).optional(),
  status: z.enum(["active", "inactive", "error"]).optional(),
});

export const deleteWaAccountSchema = z.object({
  clientId: z.string().min(1),
  accountId: z.string().min(1),
});

// ─── Conversas ─────────────────────────────────────────────────────────────────

export const listConversationsSchema = z.object({
  clientId: z.string().min(1),
  accountId: z.string().optional(),
  status: z.enum(["open", "pending", "closed"]).optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const getConversationSchema = z.object({
  clientId: z.string().min(1),
  conversationId: z.string().min(1),
});

export const updateConversationSchema = z.object({
  clientId: z.string().min(1),
  conversationId: z.string().min(1),
  status: z.enum(["open", "pending", "closed"]).optional(),
  assignedUserId: z.string().nullable().optional(),
  customerName: z.string().min(1).optional(),
});

export const markReadSchema = z.object({
  clientId: z.string().min(1),
  conversationId: z.string().min(1),
});

// ─── Mensagens ─────────────────────────────────────────────────────────────────

export const listMessagesSchema = z.object({
  clientId: z.string().min(1),
  conversationId: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(50),
  before: z.string().optional(), // cursor: messageId para paginação
});

export const sendTextSchema = z.object({
  clientId: z.string().min(1),
  conversationId: z.string().min(1),
  text: z.string().min(1).max(4096),
});

export const sendMediaSchema = z.object({
  clientId: z.string().min(1),
  conversationId: z.string().min(1),
  type: z.enum(["image", "audio", "video", "document"]),
  mediaUrl: z.string().url(),
  caption: z.string().max(1024).optional(),
  filename: z.string().optional(),
});

export const sendTemplateSchema = z.object({
  clientId: z.string().min(1),
  conversationId: z.string().min(1),
  templateName: z.string().min(1),
  languageCode: z.string().default("pt_BR"),
  components: z.array(z.any()).optional(),
});

// ─── OAuth Meta ────────────────────────────────────────────────────────────────

export const oauthCallbackSchema = z.object({
  clientId: z.string().min(1),
  code: z.string().min(1),
  displayName: z.string().min(1).default("Meu WhatsApp"),
});

// ─── Webhook ───────────────────────────────────────────────────────────────────

export const webhookVerifySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1),
  "hub.challenge": z.string().min(1),
});
