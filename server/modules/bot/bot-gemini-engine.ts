/**
 * Bot Module — Cognitive Fallback Engine (Gemini + ERP/CRM Tools)
 * Processa mensagens em linguagem natural recebidas pelo WhatsApp
 * utilizando o Gemini com persona configurada do tenant e ferramentas do ERP/CRM.
 *
 * Política de Transbordo Elegante:
 * - Para orçamentos, cotações de peças/serviços e dúvidas comerciais específicas,
 *   a IA acolhe o cliente, pede detalhes contextuais se útil (ex: modelo/ano) e
 *   transfere para a equipe humana especializada.
 * - NUNCA inventa valores nem diz que o produto não existe.
 * - Elimina qualquer loop de saudação estática ("Olá! Como posso ajudar...").
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, tool, isStepCount } from "ai";
import { z } from "zod";
import { getPool } from "../../db";
import { queryErpProducts, queryTicketsByPhone, saveLead } from "./bot.router";
import { checkBotEligibility, deliverBotMessage, transferConversationToHuman } from "./bot-runtime";
import { recordAiUsageLog } from "../ai-usage/ai-usage.service";

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

export const ELEGANT_TRANSFER_MESSAGE =
  "Compreendi perfeitamente o seu pedido! Estou encaminhando a sua solicitação para um de nossos especialistas para confirmar esses detalhes para você. Aguarde só um instante que nossa equipe já vai te responder por aqui.";

/**
 * Obtém a chave de API do Gemini para o tenant ou do ambiente.
 */
function getGeminiApiKey(): string | null {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  return envKey || null;
}

/**
 * Motor cognitivo de resposta do Bot via Gemini com Política de Transbordo Elegante.
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
    let companyName = "FaYerS Company LTDA";
    try {
      const [clientRows] = await pool.execute(
        "SELECT company FROM megadesk_domain_clients WHERE client_id = ? LIMIT 1",
        [tenantId]
      ) as any[];
      if (clientRows?.[0]?.company?.trim()) {
        companyName = clientRows[0].company.trim();
      }
    } catch {
      // fallback gracioso para a persona
    }

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      console.warn("[BotGeminiEngine] GEMINI_API_KEY ausente. Acionando transbordo elegante de contingência...");
      await transferConversationToHuman({
        tenantId,
        conversationId,
        phone,
        reason: "Transferência por contingência: GEMINI_API_KEY ausente",
      });
      await deliverBotMessage({
        tenantId,
        conversationId,
        phone,
        text: ELEGANT_TRANSFER_MESSAGE,
      });
      return { replied: true, replyText: ELEGANT_TRANSFER_MESSAGE, transferredToHuman: true };
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
    let transferReason = "Solicitado via atendimento inteligente";

    const tools: Record<string, any> = {
      get_erp_products: tool({
        description: "Consulta o catálogo de produtos e serviços do ERP, seus preços e disponibilidade em estoque.",
        parameters: z.object({
          search: z.string().optional().describe("Termo de busca, nome do produto, peça ou SKU"),
        }),
        execute: async ({ search }: { search?: string }) => {
          try {
            const queryTerm = (search || text || "").trim();
            const results = await queryErpProducts(tenantId, queryTerm);
            if (results.length === 0) {
              return {
                found: false,
                message: "Item não localizado no catálogo padrão ou requer cotação personalizada. Acolha cordialmente o cliente, informe que a equipe especializada irá verificar a disponibilidade e valores exatos, solicite detalhes como modelo/ano se útil, e acione transfer_to_human.",
              };
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
            return {
              found: false,
              error: err?.message || "Erro na consulta ao catálogo. Transfira para a equipe humana.",
            };
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
        description: "Transfere o atendimento imediatamente para a equipe de especialistas humanos e silencia o robô por 24h.",
        parameters: z.object({
          reason: z.string().optional().describe("Motivo da transferência para atendente humano"),
        }),
        execute: async ({ reason }: { reason?: string }) => {
          requestedHumanTransfer = true;
          if (reason) transferReason = reason;
          return {
            transferred: true,
            message: `Atendimento transferido para fila humana com sucesso. Motivo: ${transferReason}`,
          };
        },
      } as any),
    };

    // 5. System Instruction configurada com a política de transbordo elegante
    const systemInstruction = `Você é o assistente virtual de atendimento da empresa "${companyName}".
Você atende clientes via WhatsApp em português brasileiro de forma acolhedora, prestativa, ágil, direta e altamente profissional.

Diretrizes obrigatórias de comportamento:
1. Para perguntas gerais, saudações ou institucionais:
   - Responda de forma natural, calorosa e objetiva.

2. Para orçamentos, cotações de peças/serviços, preços específicos ou dúvidas comerciais/técnicas:
   - NUNCA invente, presuma ou alucine preços, prazos ou dados que não existam no catálogo oficial.
   - NUNCA diga secamente que "o produto não existe", que "não foi localizado no catálogo" ou que "não temos o item". Isso prejudica a imagem da empresa.
   - Sempre acolha o cliente com gentileza e informe que você está transferindo o atendimento para um de nossos especialistas para confirmar os detalhes, a disponibilidade e os valores exatos.
   - Sempre que aplicável, solicite cordialmente um dado contextual importante (ex: modelo, ano ou versão do veículo/equipamento) para que os especialistas já tenham o contexto completo ao assumirem.
   - ACIONE OBRIGATORIAMENTE a ferramenta transfer_to_human.

3. Quando consultar a ferramenta get_erp_products:
   - Se o produto tiver preço e estoque claros e confirmados, informe cordialmente ao cliente.
   - Se o produto não for localizado ou o resultado for inconclusivo: acione imediatamente transfer_to_human e explique que os especialistas humanos farão a cotação correta.

4. Formate mensagens de forma limpa para WhatsApp: use quebras de linha e negrito (*texto*) onde facilitar a leitura. Evite textos excessivamente longos.`;

    const googleInstance = createGoogleGenerativeAI({ apiKey });
    const targetModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

    console.log(`[BotGeminiEngine] Gerando resposta com modelo ${targetModel} para tenant=${tenantId}...`);

    const aiResult = await generateText({
      model: googleInstance(targetModel),
      system: systemInstruction,
      messages: historyMessages,
      tools,
      stopWhen: isStepCount(5),
    });

    let replyText = (aiResult.text || "").trim();

    void recordAiUsageLog({
      tenantId,
      featureSource: "whatsapp_bot",
      conversationId,
      usage: aiResult.usage,
      promptText: text,
      completionText: replyText,
    });

    // 6. Se o transbordo humano foi acionado por ferramenta ou detecção
    if (requestedHumanTransfer) {
      await transferConversationToHuman({
        tenantId,
        conversationId,
        phone,
        reason: transferReason,
      });

      if (!replyText) {
        replyText = ELEGANT_TRANSFER_MESSAGE;
      }
    }

    // 7. Se não houve texto de resposta gerado (ou falha na geração de texto), aciona transbordo elegante
    if (!replyText) {
      console.log(`[BotGeminiEngine] Resposta vazia da IA. Executando transbordo elegante para conv=${conversationId}...`);
      await transferConversationToHuman({
        tenantId,
        conversationId,
        phone,
        reason: "Transbordo elegante por ausência de texto final da IA",
      });
      replyText = ELEGANT_TRANSFER_MESSAGE;
      requestedHumanTransfer = true;
    }

    // 8. Envia a resposta via WhatsApp e grava no histórico
    await deliverBotMessage({
      tenantId,
      conversationId,
      phone,
      text: replyText,
    });

    console.log(`[BotGeminiEngine] Resposta enviada com sucesso para conv=${conversationId} (transferred=${requestedHumanTransfer})`);

    return {
      replied: true,
      replyText,
      transferredToHuman: requestedHumanTransfer,
    };
  } catch (error: any) {
    console.error(`[BotGeminiEngine] Erro ao processar mensagem do bot para tenant=${tenantId}:`, error);

    // Contingência elegante: transfere para atendimento humano com aviso educado
    try {
      await transferConversationToHuman({
        tenantId,
        conversationId,
        phone,
        reason: "Transferência por contingência/dúvida técnica",
      });

      await deliverBotMessage({
        tenantId,
        conversationId,
        phone,
        text: ELEGANT_TRANSFER_MESSAGE,
      });

      return {
        replied: true,
        replyText: ELEGANT_TRANSFER_MESSAGE,
        transferredToHuman: true,
      };
    } catch (deliverErr) {
      console.error("[BotGeminiEngine] Falha crítica ao enviar transbordo de contingência:", deliverErr);
      return { replied: false, error: error?.message || "Erro interno do motor do bot." };
    }
  }
}
