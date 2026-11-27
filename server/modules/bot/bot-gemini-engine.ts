/**
 * Bot Module — Cognitive Fallback Engine (Gemini + ERP/CRM Tools)
 * Processa mensagens em linguagem natural recebidas pelo WhatsApp
 * utilizando o Gemini com persona configurada do tenant e ferramentas do ERP/CRM.
 *
 * Política de Transbordo Elegante:
 * - Para orçamentos, cotações de produtos/serviços e dúvidas comerciais específicas,
 *   a IA acolhe o cliente, pede detalhes contextuais se útil e
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
import { formatTenantMemoryForPrompt, getTenantAiMemory, getTenantCompanyName } from "../ai-memory/tenant-ai-memory";
import { getTenantNicheContext } from "../niche-guard";
import { getRestaurantMenuCatalog, ingestExternalDeliveryOrder } from "../delivery/delivery.service";

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

    // 2. Busca o nome da empresa, nicho e a base de conhecimento do tenant (100% isolado por tenantId)
    const companyName = await getTenantCompanyName(tenantId, pool);
    const tenantMemory = await getTenantAiMemory(tenantId, pool).catch(() => null);
    const tenantMemoryBlock = formatTenantMemoryForPrompt(companyName, tenantMemory);
    const nicheCtx = await getTenantNicheContext(tenantId, pool).catch(() => null);
    const isRestaurantNiche = nicheCtx?.nicheProfile === "restaurante";
    const restaurantMenu = isRestaurantNiche
      ? await getRestaurantMenuCatalog(tenantId, undefined, pool).catch(() => [])
      : [];

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
          search: z.string().optional().describe("Termo de busca, nome do produto, serviço ou código"),
        }),
        execute: async ({ search }: { search?: string }) => {
          try {
            const queryTerm = (search || text || "").trim();
            const results = await queryErpProducts(tenantId, queryTerm);
            if (results.length === 0) {
              return {
                found: false,
                message: "Item não localizado no catálogo padrão ou requer cotação personalizada. Acolha cordialmente o cliente, informe que a equipe especializada irá verificar a disponibilidade e valores exatos, solicite detalhes contextuais se útil, e acione transfer_to_human.",
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

    // Ferramenta exclusiva para tenants do nicho Restaurante: fechamento estruturado de pedido delivery
    if (isRestaurantNiche) {
      tools.create_restaurant_delivery_order = tool({
        description:
          "Registra automaticamente um pedido de delivery confirmado pelo cliente no WhatsApp, criando o Ticket, o Pedido de Delivery (código de 4 dígitos e link de rastreio) e a Venda no ERP > Vendas. Só acione após o cliente confirmar os itens, endereço completo e forma de pagamento.",
        parameters: z.object({
          customerName: z.string().min(2).describe("Nome do cliente"),
          deliveryAddress: z.string().min(3).describe("Endereço completo de entrega (rua, número, bairro)"),
          addressType: z
            .enum(["casa", "apartamento", "comercial", "outro"])
            .default("casa")
            .describe("Tipo do endereço"),
          addressComplement: z
            .string()
            .optional()
            .describe("Complemento (bloco, apartamento, portão ou referência)"),
          paymentMethod: z
            .string()
            .min(2)
            .describe("Forma de pagamento escolhida (ex: Pix, Cartão na entrega, Dinheiro/Troco, Pago online)"),
          deliveryFee: z.number().min(0).default(0).describe("Taxa de entrega em reais (se informada na base do restaurante)"),
          observations: z.string().optional().describe("Observações de preparo (ex: sem cebola, ponto da carne)"),
          items: z
            .array(
              z.object({
                productPublicId: z.string().optional().describe("ID do produto no cardápio oficial"),
                name: z.string().min(1).describe("Nome exato do item do cardápio"),
                quantity: z.number().positive().describe("Quantidade"),
                unitPrice: z.number().min(0).optional().describe("Preço unitário em reais"),
              })
            )
            .min(1),
        }),
        execute: async (orderArgs: {
          customerName: string;
          deliveryAddress: string;
          addressType?: "casa" | "apartamento" | "comercial" | "outro";
          addressComplement?: string;
          paymentMethod: string;
          deliveryFee?: number;
          observations?: string;
          items: Array<{ productPublicId?: string; name: string; quantity: number; unitPrice?: number }>;
        }) => {
          try {
            const created = await ingestExternalDeliveryOrder({
              clientId: tenantId,
              orderSource: "whatsapp",
              customerName: orderArgs.customerName || customerName || "Cliente WhatsApp",
              customerPhone: phone,
              deliveryAddress: orderArgs.deliveryAddress,
              addressType: orderArgs.addressType ?? "casa",
              addressComplement: orderArgs.addressComplement ?? null,
              paymentMethod: orderArgs.paymentMethod,
              deliveryFee: Number(orderArgs.deliveryFee ?? 0),
              observations: orderArgs.observations,
              items: orderArgs.items,
            });
            return {
              success: true,
              ticketNumber: `#${String(created.ticket.number).padStart(4, "0")}`,
              orderTotal: `R$ ${created.deliveryOrder.orderTotal.toFixed(2).replace(".", ",")}`,
              deliveryCode: created.deliveryOrder.deliveryCode,
              stageLabel: created.deliveryOrder.stageLabel,
              erpSaleCreated: Boolean(created.deliveryOrder.erpSalePublicId),
              message: "Pedido registrado com sucesso! Informe o número do pedido, o resumo, o valor total e avise que enviaremos o link de rastreio assim que o motoboy sair para entrega.",
            };
          } catch (err: any) {
            return {
              success: false,
              error: err?.message || "Não foi possível registrar o pedido automaticamente. Acione transfer_to_human.",
            };
          }
        },
      } as any);
    }

    const restaurantMenuBlock = isRestaurantNiche
      ? `\n\n=== CARDÁPIO OFICIAL DO RESTAURANTE (ERP > PRODUTOS) ===\n${
          restaurantMenu.length > 0
            ? restaurantMenu
                .slice(0, 80)
                .map(
                  (p) =>
                    `- [ID: ${p.id}] ${p.name}${p.category ? ` (${p.category})` : ""} — R$ ${p.price.toFixed(2).replace(".", ",")}`
                )
                .join("\n")
            : "(Nenhum produto ativo cadastrado no cardápio ainda. Caso o cliente peça algo, transfira para um atendente humano.)"
        }\n\nREGRAS EXCLUSIVAS DE PEDIDO DELIVERY:\n- Apresente itens e preços SOMENTE com base no cardápio oficial acima.\n- Antes de finalizar um pedido, confirme com o cliente: (1) itens e quantidades, (2) endereço completo, se é Casa/Apartamento/Comercial e complemento/bloco/apto, (3) forma de pagamento.\n- Assim que o cliente confirmar o pedido, ACIONE OBRIGATORIAMENTE a ferramenta create_restaurant_delivery_order com os itens do cardápio (informando productPublicId, name, quantity e unitPrice) para criar automaticamente o Ticket, o Delivery e a Venda no ERP.`
      : "";

    // 5. System Instruction configurada com a política de transbordo elegante
    const systemInstruction = `Você é o assistente virtual de atendimento da empresa "${companyName}".
Você atende clientes via WhatsApp em português brasileiro de forma acolhedora, prestativa, ágil, direta e altamente profissional.

Diretrizes obrigatórias de comportamento:
1. Para perguntas gerais, saudações ou institucionais:
   - Responda de forma natural, calorosa e objetiva.

2. Para orçamentos, cotações de produtos/serviços, preços específicos ou dúvidas comerciais/técnicas:
   - NUNCA invente, presuma ou alucine preços, prazos, horários, políticas ou dados que não estejam na base de conhecimento oficial da empresa ou no catálogo do ERP.
   - NUNCA diga secamente que "o produto não existe", que "não foi localizado no catálogo" ou que "não temos o item". Isso prejudica a imagem da empresa.
   - Sempre acolha o cliente com gentileza e informe que você está transferindo o atendimento para um de nossos especialistas para confirmar os detalhes, a disponibilidade e os valores exatos.
   - Sempre que aplicável, solicite cordialmente um detalhe contextual útil para que a equipe humana já tenha o contexto completo ao assumir.
   - ACIONE OBRIGATORIAMENTE a ferramenta transfer_to_human.

3. Quando consultar a ferramenta get_erp_products:
   - Se o produto tiver preço e estoque claros e confirmados, informe cordialmente ao cliente.
   - Se o produto não for localizado ou o resultado for inconclusivo: acione imediatamente transfer_to_human e explique que os especialistas humanos farão a cotação correta.

4. Formate mensagens de forma limpa para WhatsApp: use quebras de linha e negrito (*texto*) onde facilitar a leitura. Evite textos excessivamente longos.

${tenantMemoryBlock}${restaurantMenuBlock}`;

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

    try {
      await recordAiUsageLog({
        tenantId,
        featureSource: "whatsapp_bot",
        conversationId,
        usage: aiResult.usage,
        promptText: text,
        completionText: replyText,
      });
    } catch (usageErr) {
      console.error("[ai-usage] failed to record in bot-gemini-engine:", usageErr);
    }

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
