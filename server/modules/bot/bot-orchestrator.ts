/**
 * Bot Module — Unified Bot Orchestrator
 *
 * Ponto central de execução do Bot para mensagens recebidas via WhatsApp:
 * 1. Verifica elegibilidade da conversa (status 'bot', assigned_user_id 'bot_system', sem trava 24h).
 * 2. Se a conversa já transitou para modo cognitivo, processa diretamente via IA Gemini.
 * 3. Tenta executar o Typebot publicado no Workspace do cliente via rede interna (Typebot Viewer).
 * 4. Ao término do fluxo do Typebot (flowEnded = true) ou recebimento de dúvida em texto livre,
 *    aciona a Transição Cognitiva Pós-Fluxo com IA Gemini (gemini-3.5-flash-lite) e ferramentas de ERP/CRM.
 * 5. Se o cliente solicitar atendimento humano, executa o transbordo imediato para a fila "Aguardando"
 *    e silencia o robô por 24 horas.
 */
import {
  checkBotEligibility,
  deliverBotMessage,
  transferConversationToHuman,
  isConversationInCognitiveMode,
  setConversationCognitiveMode,
  clearConversationCognitiveMode,
  __resetCognitiveConversations,
} from "./bot-runtime";
import { resolvePublishedTypebot, runTypebotTurn, clearTypebotSession } from "./typebot-runtime.service";
import { processCognitiveBotMessage } from "./bot-gemini-engine";

export {
  isConversationInCognitiveMode,
  setConversationCognitiveMode,
  clearConversationCognitiveMode,
  __resetCognitiveConversations,
};

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

  // 2. Se a conversa já transitou para o modo cognitivo contínuo (IA Gemini)
  if (isConversationInCognitiveMode(tenantId, conversationId)) {
    console.log(`[BotWebhook] Conversa ${conversationId} em modo cognitivo contínuo. Roteando direto para o Gemini...`);
    await processCognitiveBotMessage({
      tenantId,
      conversationId,
      phone,
      text,
      customerName,
    });
    return;
  }

  // 3. Tenta resolver Typebot publicado para este tenant
  let publishedTypebot = null;
  try {
    publishedTypebot = await resolvePublishedTypebot(tenantId);
  } catch (err: any) {
    console.error(`[BotWebhook] Erro ao consultar Typebot publicado para tenant=${tenantId}:`, err?.message || err);
  }

  if (publishedTypebot) {
    console.log(`[BotWebhook] Typebot publicado encontrado: "${publishedTypebot.name}" (publicId=${publishedTypebot.publicId}). Executando turno...`);
    try {
      const turn = await runTypebotTurn({
        tenantId,
        conversationId,
        typebot: publishedTypebot,
        text,
        phone,
        customerName,
      });

      console.log(`[BotWebhook] Turno Typebot concluído com ${turn.items.length} itens. flowEnded=${turn.flowEnded}`);

      let transferred = false;
      for (const item of turn.items) {
        if (item.type === "text") {
          if (!item.text.trim()) continue;
          await deliverBotMessage({ tenantId, conversationId, phone, text: item.text });
          if (/transferir|atendente humano|equipe dar[aá] continuidade|especialista humano/i.test(item.text)) {
            transferred = true;
          }
        } else {
          // Despacho de mídias (imagem, vídeo, áudio)
          await deliverBotMessage({
            tenantId,
            conversationId,
            phone,
            media: {
              type: item.type,
              url: item.url,
              caption: "caption" in item ? item.caption : undefined,
            },
          });
        }
      }

      // Se o fluxo ou o texto indicar transferência humana
      if (transferred || /falar com atendente|quero atendente|atendimento humano|falar com humano/i.test(text)) {
        await transferConversationToHuman({
          tenantId,
          conversationId,
          phone,
          reason: "Transferência automática indicada pelo fluxo do Typebot",
        });
        clearConversationCognitiveMode(tenantId, conversationId);
        clearTypebotSession(tenantId, conversationId);
        return;
      }

      // ─── Transição Cognitiva Pós-Fluxo (Gemini) ─────────────────────────
      // Se o fluxo do Typebot terminou (flowEnded = true)
      if (turn.flowEnded) {
        setConversationCognitiveMode(tenantId, conversationId, true);

        // Se o turno não gerou mensagens de saída (ex: bloco de text input no final do fluxo absorveu a pergunta)
        if (turn.items.length === 0) {
          console.log(`[BotWebhook] Fluxo Typebot encerrou sem mensagens de saída. Acionando IA Gemini para responder a pergunta...`);
          await processCognitiveBotMessage({
            tenantId,
            conversationId,
            phone,
            text,
            customerName,
          });
        }
      }

      return;
    } catch (typebotErr: any) {
      console.error(`[BotWebhook] Falha ao executar Typebot: ${typebotErr?.message || typebotErr}. Acionando fallback Gemini...`);
    }
  } else {
    console.log(`[BotWebhook] Nenhum Typebot publicado encontrado para tenant=${tenantId}. Usando Fallback Cognitivo Gemini...`);
  }

  // 4. Fallback Cognitivo com IA (Gemini)
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
