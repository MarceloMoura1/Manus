/**
 * Bot Module — Cognitive Fallback Engine (Gemini + ERP/CRM Tools)
 * Processa mensagens em linguagem natural recebidas pelo WhatsApp
 * utilizando o Gemini com persona configurada do tenant e ferramentas do ERP/CRM.
 */

import { randomUUID } from "node:crypto";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, tool } from "ai";
import { z } from "zod";
import { getPool } from "../../db";
import { botDispatcherService } from "./bot-dispatcher.service";
import { queryErpProducts, queryTicketsByPhone, saveLead } from "./bot.router";
import { emitOperationalTenantEvent } from "../whatsapp/socket/whatsapp.socket";

export interface ProcessBotMessageInput {
  tenantId: string;
  conversationId: string;
  phone: string;
  text: string;
  customerName?: string;
}

export interface BotProcessOutcome {
  replied: boolean;
  replyText?: string;
  transferredToHuman?: boolean;
  error?: string;
}

/**
 * Obtém a chave de API do Gemini para o tenant ou do ambiente.
 */
function getGeminiApiKey(): string | null {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  return envKey || null;
}

/**
 * Motor cognitivo de resposta do Bot via Gemini.
 */
export async function processCognitiveBotMessage(
  input: ProcessBotMessageInput
): Promise<BotProcessOutcome> {
  const { tenantId, conversationId, phone, text, customerName } = input;

  try {
    const pool = getPool();

    // 1. Verifica se a conversa ainda está no ciclo do bot e não está suspensa
    const [convRows] = await pool.execute(
      `SELECT status, assigned_user_id, bot_suspended_at
       FROM megadesk_domain_conversations
       WHERE conversation_id = ? AND client_id = ?
       LIMIT 1`,
      [conversationId, tenantId]
    ) as any[];

    if (!convRows || convRows.length === 0) {
      return { replied: false, error: "Conversa não encontrada." };
    }

    const currentConv = convRows[0];
    if (currentConv.status !== "bot") {
      return { replied: false, error: "Conversa não está na fila do bot." };
    }

    if (currentConv.bot_suspended_at && new Date(currentConv.bot_suspended_at) > new Date()) {
      return { replied: false, error: "Bot suspenso por operador humano." };
    }

    // 2. Busca o nome da empresa (persona do tenant)
    let companyName = "MegaDesk";
    try {
      const [clientRows] = await pool.execute(
        "SELECT company FROM megadesk_domain_clients WHERE client_id = ? LIMIT 1",
        [tenantId]
      ) as any[];
      if (clientRows?.[0]?.company) {
        companyName = clientRows[0].company;
      }
    } catch {
      // fallback gracioso
    }

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      console.warn("[BotGeminiEngine] GEMINI_API_KEY não configurada. Bot não pôde responder.");
      return { replied: false, error: "GEMINI_API_KEY ausente." };
    }

    // 3. Carrega histórico recente da conversa (últimas 6 mensagens) para contexto
    const [msgRows] = await pool.execute(
      `SELECT sender, message, direction
       FROM megadesk_domain_conversations_messages
       WHERE conversation_id = ? AND client_id = ?
       ORDER BY timestamp DESC
       LIMIT 6`,
      [conversationId, tenantId]
    ) as any[];

    const historyMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    const ordered = (msgRows || []).reverse();
    for (const m of ordered) {
      if (m.sender === "customer" || m.direction === "inbound") {
        historyMessages.push({ role: "user", content: String(m.message || "") });
      } else {
        historyMessages.push({ role: "assistant", content: String(m.message || "") });
      }
    }

    // Garante que a mensagem atual está presente no histórico
    if (!historyMessages.some(m => m.role === "user" && m.content === text)) {
      historyMessages.push({ role: "user", content: text });
    }

    // 4. Declaração das ferramentas cognitivas integradas ao ERP/CRM
    let requestedHumanTransfer = false;

    const tools: Record<string, any> = {
      get_erp_products: tool({
        description: "Consulta o catálogo de produtos e serviços do ERP, seus preços e disponibilidade em estoque.",
        parameters: z.object({
          search: z.string().describe("Termo de busca, nome do produto ou SKU"),
        }),
        execute: async ({ search }: { search: string }) => {
          try {
            const results = await queryErpProducts(tenantId, search || "");
            if (results.length === 0) {
              return { found: false, message: "Nenhum produto encontrado com este termo no catálogo." };
            }
            return {
              found: true,
              products: results.slice(0, 5).map(p => ({
                nome: p.name,
                preco: `R$ ${p.price.toFixed(2).replace(".", ",")}`,
                disponivel: p.inStock ? "Em estoque" : "Indisponível no momento",
              })),
            };
          } catch (err: any) {
            return { found: false, error: err?.message || "Erro ao consultar produtos." };
          }
        },
      } as any),

      get_open_tickets: tool({
        description: "Consulta chamados de suporte abertos ou recentes vinculados ao telefone do cliente.",
        parameters: z.object({
          phone: z.string().optional().describe("Número de telefone a consultar. Se omitido, usa o do cliente atual."),
        }),
        execute: async ({ phone: queryPhone }: { phone?: string }) => {
          try {
            const phoneToUse = queryPhone || phone;
            const tickets = await queryTicketsByPhone(tenantId, phoneToUse);
            if (tickets.length === 0) {
              return { found: false, message: "Nenhum chamado aberto encontrado para este número." };
            }
            return {
              found: true,
              tickets: tickets.slice(0, 5).map(t => ({
                numero: `#${t.number}`,
                titulo: t.title,
                status: t.status,
                data: t.createdAt,
              })),
            };
          } catch (err: any) {
            return { found: false, error: err?.message || "Erro ao consultar chamados." };
          }
        },
      } as any),

      capture_lead: tool({
        description: "Registra ou atualiza os dados cadastrais e interesse do cliente (lead) no CRM.",
        parameters: z.object({
          name: z.string().optional().describe("Nome do contato ou cliente"),
          phone: z.string().optional().describe("Telefone de contato"),
          email: z.string().optional().describe("E-mail de contato"),
          notes: z.string().describe("Resumo da necessidade, interesse ou observações do cliente"),
        }),
        execute: async ({ name, phone: leadPhone, email, notes }: { name?: string; phone?: string; email?: string; notes: string }) => {
          try {
            const res = await saveLead(tenantId, {
              name: name || customerName,
              phone: leadPhone || phone,
              email,
              notes,
            });
            return {
              success: true,
              message: "Lead registrado/atualizado com sucesso no CRM.",
              leadId: res.lead.crmClientId,
            };
          } catch (err: any) {
            return { success: false, error: err?.message || "Erro ao salvar lead no CRM." };
          }
        },
      } as any),

      transfer_to_human: tool({
        description: "Transfere o atendimento imediatamente para a fila humana e silencia o robô.",
        parameters: z.object({
          reason: z.string().describe("Motivo da transferência para atendente humano"),
        }),
        execute: async ({ reason }: { reason: string }) => {
          requestedHumanTransfer = true;
          return {
            transferred: true,
            message: `Atendimento transferido para fila humana com sucesso. Motivo: ${reason}`,
          };
        },
      } as any),
    };

    // 5. System Instruction configurada com a persona da empresa
    const systemInstruction = `Você é o assistente virtual de atendimento da empresa "${companyName}".
Você atende clientes via WhatsApp de forma cordial, prestativa, direta e resolutiva.

Diretrizes obrigatórias:
1. Responda em português brasileiro de forma natural e amigável.
2. Utilize as ferramentas disponíveis sempre que o cliente perguntar por produtos, preços, estoque, chamados em andamento ou quiser registrar seu interesse/orçamento.
3. NUNCA invente, presuma ou alucine preços ou produtos que não foram confirmados pela ferramenta get_erp_products.
4. Se o cliente solicitar expressamente falar com um atendente humano, ou se o assunto exigir intervenção humana (reclamação grave, negociação especial fora do padrão), use a ferramenta transfer_to_human e informe cordialmente que um especialista humano dará sequência.
5. Formate mensagens de forma limpa para WhatsApp: use quebras de linha e negrito (*texto*) onde facilitar a leitura. Evite textos excessivamente longos.`;

    const googleInstance = createGoogleGenerativeAI({ apiKey });
    const targetModel = "gemini-1.5-flash";

    const aiResult = await generateText({
      model: googleInstance(targetModel),
      system: systemInstruction,
      messages: historyMessages,
      tools,
    });

    let replyText = (aiResult.text || "").trim();

    // 6. Se o transbordo humano foi acionado
    if (requestedHumanTransfer) {
      await pool.execute(
        `UPDATE megadesk_domain_conversations
         SET status = 'waiting_human',
             assigned_user_id = NULL,
             assigned_user_name = NULL,
             ia_active = 0,
             bot_suspended_at = DATE_ADD(NOW(), INTERVAL 24 HOUR),
             updated_at = NOW()
         WHERE conversation_id = ? AND client_id = ?`,
        [conversationId, tenantId]
      );

      emitOperationalTenantEvent(tenantId, "wa:transfer_to_human", {
        conversationId,
        phone,
        status: "AGUARDANDO_HUMANO",
        reason: "Solicitado via atendimento inteligente",
        timestamp: new Date().toISOString(),
      });
      emitOperationalTenantEvent(tenantId, "wa:conversation_updated", {
        conversation: {
          id: conversationId,
          status: "waiting_human",
          assignedUserId: null,
          iaActive: 0,
        },
      });

      if (!replyText) {
        replyText = "Estou transferindo você para um de nossos atendentes. Em instantes nossa equipe dará continuidade ao seu atendimento!";
      }
    }

    if (!replyText) {
      replyText = "Olá! Como posso ajudar você hoje?";
    }

    // 7. Envia a resposta via WhatsApp
    await botDispatcherService.sendTextMessage({
      tenantId,
      to: phone,
      text: replyText,
      provider: "evolution",
    });

    // 8. Grava a mensagem do Bot no banco de dados e atualiza a conversa
    const botMessageId = `msg-bot-${randomUUID()}`;
    const now = new Date();
    const timeLabel = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    await pool.execute(
      `INSERT INTO megadesk_domain_conversations_messages
       (message_id, conversation_id, client_id, provider, integration_id,
        direction, message_type, sender, sender_name_snapshot, message, status, timestamp, updated_at)
       VALUES (?, ?, ?, 'evolution', ?, 'outbound', 'text', 'bot', 'Bot Virtual', ?, 'sent', NOW(), NOW())`,
      [botMessageId, conversationId, tenantId, `megadesk-${tenantId}`, replyText]
    );

    await pool.execute(
      `UPDATE megadesk_domain_conversations
       SET last_message = ?,
           last_message_from = 'bot',
           time_label = ?,
           updated_at = NOW()
       WHERE conversation_id = ? AND client_id = ?`,
      [replyText.substring(0, 255), timeLabel, conversationId, tenantId]
    );

    // 9. Emite evento WebSocket para atualizar tela de atendimento em tempo real
    const socketPayload = {
      conversationId,
      clientId: tenantId,
      message: {
        id: botMessageId,
        from: "bot",
        sender: "bot",
        text: replyText,
        time: timeLabel,
        timestamp: now.toISOString(),
      },
    };

    emitOperationalTenantEvent(tenantId, "conversation:message", socketPayload);

    return {
      replied: true,
      replyText,
      transferredToHuman: requestedHumanTransfer,
    };
  } catch (error: any) {
    console.error(`[BotGeminiEngine] Erro ao processar mensagem do bot para tenant=${tenantId}:`, error);
    return { replied: false, error: error?.message || "Erro interno do motor do bot." };
  }
}
