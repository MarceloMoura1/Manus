/**
 * Bot Module — Unified Bot Orchestrator
 *
 * Ponto central de execução do Bot para mensagens recebidas via WhatsApp:
 * 1. Verifica elegibilidade da conversa (status 'bot', assigned_user_id 'bot_system', sem trava 24h).
 * 2. Tenta executar o Typebot publicado no Workspace do cliente via rede interna (Typebot Viewer).
 * 3. Se não houver Typebot publicado (ou se falhar), aciona o Fallback Cognitivo com IA (Gemini).
 */
import { checkBotEligibility, deliverBotMessage, transferConversationToHuman } from "./bot-runtime";
import { resolvePublishedTypebot, runTypebotTurn } from "./typebot-runtime.service";
import { processCognitiveBotMessage } from "./bot-gemini-engine";

export interface BotDispatchInput {
  tenantId: string;
  conversationId: string;
  phone: string;
  text: string;
  customerName?: string;
}

export async function dispatchBotConversationMessage(input: BotDispatchInput): Promise<void> {
  const { tenantId, conversationId, phone, text, customerName } = input;
  console.log(`[BotWebhook] Recebido gatilho para bot: tenant=${tenantId} conv=${conversationId} phone=${phone} text="${text.slice(0, 60)}"`);

  // 1. Verifica elegibilidade da conversa
  const eligibility = await checkBotEligibility(tenantId, conversationId);
  if (!eligibility.eligible) {
    console.log(`[BotWebhook] Conversa ${conversationId} ignorada pelo bot: ${eligibility.reason}`);
    return;
  }

  // 2. Tenta resolver Typebot publicado para este tenant
  let publishedTypebot = null;
  try {
    publishedTypebot = await resolvePublishedTypebot(tenantId);
  } catch (err: any) {
    console.error(`[BotWebhook] Erro ao consultar Typebot publicado para tenant=${tenantId}:`, err?.message || err);
  }

  if (publishedTypebot) {
    console.log(`[BotWebhook] Typebot publicado encontrado: "${publishedTypebot.name}" (publicId=${publishedTypebot.publicId}). Executando fluxo...`);
    try {
      const turn = await runTypebotTurn({
        tenantId,
        conversationId,
        typebot: publishedTypebot,
        text,
        phone,
        customerName,
      });

      console.log(`[BotWebhook] Turno Typebot concluído com ${turn.messages.length} mensagens. flowEnded=${turn.flowEnded}`);

      let transferred = false;
      for (const msg of turn.messages) {
        if (!msg.trim()) continue;
        await deliverBotMessage({ tenantId, conversationId, phone, text: msg });
        // Detecta se a mensagem indica transferência para atendente humano
        if (/transferir|atendente humano|equipe dar[aá] continuidade/i.test(msg)) {
          transferred = true;
        }
      }

      if (transferred) {
        await transferConversationToHuman({
          tenantId,
          conversationId,
          phone,
          reason: "Transferência automática indicada pelo fluxo do Typebot",
        });
      }

      return;
    } catch (typebotErr: any) {
      console.error(`[BotWebhook] Falha ao executar Typebot: ${typebotErr?.message || typebotErr}. Acionando fallback Gemini...`);
    }
  } else {
    console.log(`[BotWebhook] Nenhum Typebot publicado encontrado para tenant=${tenantId}. Usando Fallback Cognitivo Gemini...`);
  }

  // 3. Fallback Cognitivo com IA (Gemini)
  try {
    const outcome = await processCognitiveBotMessage({
      tenantId,
      conversationId,
      phone,
      text,
      customerName,
    });
    console.log(`[BotWebhook] Fallback Gemini finalizado: replied=${outcome.replied} error=${outcome.error || "none"}`);
  } catch (geminiErr: any) {
    console.error(`[BotWebhook] Falha crítica no processamento cognitivo do bot:`, geminiErr);
  }
}
