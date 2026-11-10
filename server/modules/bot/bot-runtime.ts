/**
 * Bot Module — Runtime compartilhado (elegibilidade, entrega e transbordo).
 *
 * Usado tanto pelo fluxo Typebot quanto pelo fallback cognitivo (Gemini).
 *
 * IMPORTANTE (schema real): `megadesk_domain_conversations.status` é
 * ENUM('open','bot','closed'). Não existe `waiting_human` no banco. A fila
 * "Aguardando humano" é representada por `status = 'bot' AND assigned_user_id IS NULL`;
 * a fila "BOT" (robô atendendo) por `status = 'bot' AND assigned_user_id = 'bot_system'`.
 */
import { randomUUID } from "node:crypto";
import { getPool } from "../../db";
import { botDispatcherService } from "./bot-dispatcher.service";
import { emitOperationalTenantEvent } from "../whatsapp/socket/whatsapp.socket";

export const BOT_SYSTEM_USER_ID = "bot_system";

export type BotEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

/** Verifica se a conversa ainda está sob responsabilidade do robô e sem trava de 24h. */
export async function checkBotEligibility(tenantId: string, conversationId: string): Promise<BotEligibility> {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT status, assigned_user_id, bot_suspended_at
     FROM megadesk_domain_conversations
     WHERE conversation_id = ? AND client_id = ?
     LIMIT 1`,
    [conversationId, tenantId]
  ) as any[];
  const conv = rows?.[0];
  if (!conv) return { eligible: false, reason: "conversa não encontrada" };
  if (conv.status !== "bot") return { eligible: false, reason: `status=${conv.status}` };
  if (conv.assigned_user_id !== BOT_SYSTEM_USER_ID) {
    return { eligible: false, reason: `assigned_user_id=${conv.assigned_user_id ?? "NULL"} (fila humana)` };
  }
  if (conv.bot_suspended_at && new Date(conv.bot_suspended_at) > new Date()) {
    return { eligible: false, reason: "bot suspenso por intervenção humana (trava 24h)" };
  }
  return { eligible: true };
}

/** Envia uma mensagem do robô pelo WhatsApp, grava no histórico e notifica a tela de atendimento. */
export async function deliverBotMessage(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  text: string;
}): Promise<void> {
  const { tenantId, conversationId, phone } = input;
  const text = input.text.trim();
  if (!text) return;

  console.log(`[BotDispatcher] Enviando resposta do bot tenant=${tenantId} conv=${conversationId} chars=${text.length}`);
  await botDispatcherService.sendTextMessage({ tenantId, to: phone, text, provider: "evolution" });
  console.log(`[BotDispatcher] Resposta entregue à Evolution API tenant=${tenantId} conv=${conversationId}`);

  const pool = getPool();
  const botMessageId = `msg-bot-${randomUUID()}`;
  const now = new Date();
  const timeLabel = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  await pool.execute(
    `INSERT INTO megadesk_domain_conversations_messages
     (message_id, conversation_id, client_id, provider, integration_id,
      direction, message_type, sender, sender_name_snapshot, message, status, timestamp, updated_at)
     VALUES (?, ?, ?, 'evolution', ?, 'outbound', 'text', 'bot', 'Bot Virtual', ?, 'sent', NOW(), NOW())`,
    [botMessageId, conversationId, tenantId, `megadesk-${tenantId}`, text]
  );
  await pool.execute(
    `UPDATE megadesk_domain_conversations
     SET last_message = ?, last_message_from = 'bot', time_label = ?, updated_at = NOW()
     WHERE conversation_id = ? AND client_id = ?`,
    [text.substring(0, 255), timeLabel, conversationId, tenantId]
  );

  emitOperationalTenantEvent(tenantId, "conversation:message", {
    conversationId,
    clientId: tenantId,
    message: {
      id: botMessageId,
      from: "bot",
      sender: "bot",
      text,
      time: timeLabel,
      timestamp: now.toISOString(),
    },
  });
}

/**
 * Transfere a conversa para a fila humana ("Aguardando") e silencia o robô por 24h.
 * Usa apenas valores válidos do ENUM de status.
 */
export async function transferConversationToHuman(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  reason: string;
}): Promise<void> {
  const { tenantId, conversationId, phone, reason } = input;
  const pool = getPool();
  await pool.execute(
    `UPDATE megadesk_domain_conversations
     SET status = 'bot',
         assigned_user_id = NULL,
         assigned_user_name = NULL,
         ia_active = 0,
         bot_suspended_at = DATE_ADD(NOW(), INTERVAL 24 HOUR),
         updated_at = NOW()
     WHERE conversation_id = ? AND client_id = ?`,
    [conversationId, tenantId]
  );
  console.log(`[BotWebhook] Conversa transferida para fila humana tenant=${tenantId} conv=${conversationId} motivo="${reason}"`);

  emitOperationalTenantEvent(tenantId, "wa:transfer_to_human", {
    conversationId,
    phone,
    status: "AGUARDANDO_HUMANO",
    reason,
    timestamp: new Date().toISOString(),
  });
  emitOperationalTenantEvent(tenantId, "wa:conversation_updated", {
    conversation: { id: conversationId, status: "pending", assignedUserId: null, iaActive: 0 },
  });
}

