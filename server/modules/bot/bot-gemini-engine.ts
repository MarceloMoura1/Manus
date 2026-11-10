/**
 * Bot Module — Cognitive Fallback Engine (Gemini + ERP/CRM Tools)
 * Processa mensagens em linguagem natural recebidas pelo WhatsApp
 * utilizando o Gemini com persona configurada do tenant e ferramentas do ERP/CRM.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, tool } from "ai";
import { z } from "zod";
import { getPool } from "../../db";
import { queryErpProducts, queryTicketsByPhone, saveLead } from "./bot.router";
import { checkBotEligibility, deliverBotMessage, transferConversationToHuman } from "./bot-runtime";

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

    // 1. Verifica elegibilidade da conversa via runtime compartilhado
    const eligibility = await checkBotEligibility(tenantId, conversationId);
    if (!eligibility.eligible) {
      console.log(`[BotGeminiEngine] Conversa ${conversationId} ignorada: ${eligibility.reason}`);
      return { replied: false, error: eligibility.reason };
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
    const targetModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

    console.log(`[BotGeminiEngine] Gerando resposta com modelo ${targetModel} para tenant=${tenantId}...`);

    const aiResult = await generateText({
      model: googleInstance(targetModel),
      system: systemInstruction,
      messages: historyMessages,
      tools,
    });

    let replyText = (aiResult.text || "").trim();

    // 6. Se o transbordo humano foi acionado
    if (requestedHumanTransfer) {
      await transferConversationToHuman({
        tenantId,
        conversationId,
        phone,
        reason: "Solicitado via atendimento inteligente",
      });

      if (!replyText) {
        replyText = "Estou transferindo você para um de nossos atendentes. Em instantes nossa equipe dará continuidade ao seu atendimento!";
      }
    }

    if (!replyText) {
      replyText = "Olá! Como posso ajudar você hoje?";
    }

    // 7. Envia a resposta via WhatsApp e grava no histórico
    await deliverBotMessage({
      tenantId,
      conversationId,
      phone,
      text: replyText,
    });

    console.log(`[BotGeminiEngine] Resposta enviada com sucesso para conv=${conversationId}`);

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
