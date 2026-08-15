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
  webhookVerifyToken: z.string().optional(),
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

const webhookMessageTypeSchema = z.enum([
  "text", "image", "audio", "video", "document", "template", "sticker", "location", "reaction",
]);

const webhookErrorSchema = z.object({
  code: z.number(),
  title: z.string(),
  message: z.string().optional(),
  error_data: z.object({ details: z.string() }).optional(),
});

const webhookMessageSchema = z.object({
  from: z.string().min(1),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  type: webhookMessageTypeSchema,
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ id: z.string(), mime_type: z.string(), sha256: z.string(), caption: z.string().optional() }).optional(),
  audio: z.object({ id: z.string(), mime_type: z.string() }).optional(),
  video: z.object({ id: z.string(), mime_type: z.string(), sha256: z.string(), caption: z.string().optional() }).optional(),
  document: z.object({ id: z.string(), filename: z.string(), mime_type: z.string(), sha256: z.string(), caption: z.string().optional() }).optional(),
  sticker: z.object({ id: z.string(), mime_type: z.string(), sha256: z.string(), animated: z.boolean() }).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number(), name: z.string().optional(), address: z.string().optional() }).optional(),
  reaction: z.object({ message_id: z.string(), emoji: z.string() }).optional(),
  template: z.object({}).passthrough().optional(),
  context: z.object({ from: z.string(), id: z.string() }).optional(),
}).superRefine((message, ctx) => {
  const requiredField: Record<typeof message.type, keyof typeof message> = {
    text: "text", image: "image", audio: "audio", video: "video", document: "document",
    template: "template", sticker: "sticker", location: "location", reaction: "reaction",
  };
  if (!message[requiredField[message.type]]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Campo obrigatório ausente para mensagem ${message.type}` });
  }
});

const webhookStatusSchema = z.object({
  id: z.string().min(1),
  recipient_id: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: z.string(),
  errors: z.array(webhookErrorSchema).optional(),
});

export const metaWebhookEnvelopeSchema = z.object({
  object: z.string().min(1),
  entry: z.array(z.unknown()),
});

export const metaWebhookPayloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      field: z.string(),
      value: z.object({
        messaging_product: z.string(),
        metadata: z.object({ display_phone_number: z.string(), phone_number_id: z.string().min(1) }),
        contacts: z.array(z.object({ profile: z.object({ name: z.string() }), wa_id: z.string() })).optional(),
        messages: z.array(webhookMessageSchema).optional(),
        statuses: z.array(webhookStatusSchema).optional(),
        errors: z.array(webhookErrorSchema).optional(),
      }),
    })),
  })),
});
