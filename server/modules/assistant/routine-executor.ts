import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, isStepCount } from "ai";
import { createHermesTools } from "../../hermes-tools";
import {
  CANONICAL_GEMINI_MODEL,
  resolveGeminiApiKey,
} from "./assistant-threads.router";
import { AssistantThreadsRepository, assistantThreadsRepository } from "./repository";
import { AssistantRoutinesRepository, assistantRoutinesRepository } from "./routines-repository";
import { recordAiUsageLog } from "../ai-usage/ai-usage.service";
import type { MegadeskAiRoutine } from "../../../drizzle/schema";

export interface ExecuteRoutineOptions {
  aiGenerator?: typeof generateText;
  dbPool?: any;
  threadsRepo?: AssistantThreadsRepository;
  routinesRepo?: AssistantRoutinesRepository;
}

export function buildRoutinePrompt(routine: MegadeskAiRoutine): string {
  if (routine.triggerType === "morning_briefing") {
    return (
      routine.promptInstruction ||
      "Consulte os chamados em aberto com SLA prioritário, os clientes que enviaram mensagem e aguardam retorno há mais de 24h e as propostas em negociação pendentes. Monte um resumo executivo direto e acionável com o título '📋 O QUE TEMOS PARA HOJE' contendo prioridades, alertas urgentes e lista de ação imediata."
    );
  }
  if (routine.triggerType === "stale_leads") {
    return (
      routine.promptInstruction ||
      "Analise os contatos do CRM e conversas recentes. Identifique clientes, leads ou propostas sem interação recente (há mais de 48h) e gere uma lista priorizada com o título '⏱️ RADAR DE FOLLOW-UP (48H)' destacando quem precisa ser contatado hoje, telefone/canal e motivo do follow-up."
    );
  }
  if (routine.triggerType === "eod_summary") {
    return (
      routine.promptInstruction ||
      "Consulte o faturamento e vendas registradas no dia, os chamados fechados e os que continuam em andamento ou pendentes. Monte um relatório executivo com o título '📊 FECHAMENTO E PENDÊNCIAS DO DIA' contendo balanço geral, conquistas do turno e pendências prioritárias para amanhã."
    );
  }
  return routine.promptInstruction || "Execute a análise da rotina e produza um resumo operacional detalhado.";
}

export async function executeRoutine(
  routine: MegadeskAiRoutine,
  options?: ExecuteRoutineOptions
): Promise<{
  success: boolean;
  status: "success" | "warning" | "error";
  outputSummary: string;
  threadId?: string;
}> {
  const aiGenerator = options?.aiGenerator ?? generateText;
  const threadsRepo = options?.threadsRepo ?? assistantThreadsRepository;
  const routinesRepo = options?.routinesRepo ?? assistantRoutinesRepository;
  const promptText = buildRoutinePrompt(routine);

  try {
    const apiKey = await resolveGeminiApiKey(routine.tenantId);
    let outputSummary = "";

    if (!apiKey) {
      outputSummary = `[Simulação de Rotina: ${routine.title}]\nA chave de API Gemini não está configurada no ambiente. Para execuções ao vivo com IA, configure GEMINI_API_KEY.\n\nInstrução programada:\n${promptText}`;
    } else {
      const google = createGoogleGenerativeAI({ apiKey });
      const targetModel = process.env.GEMINI_MODEL || CANONICAL_GEMINI_MODEL;
      const tenantTools = createHermesTools({
        clientId: routine.tenantId,
        userId: routine.userId,
        hitlRequired: false,
        pool: options?.dbPool,
      });

      const systemInstruction = `Você é o Copiloto de Inteligência Artificial da plataforma MegaDesk executando a rotina autônoma "${routine.title}".
Seu objetivo é analisar as regras de negócio e dados do sistema (chamados, clientes no CRM, propostas e vendas) e entregar um relatório executivo direto, claro, altamente acionável e estruturado em Markdown com tabelas e marcadores.
Não gere mensagens de confirmação de aprovação nem faça perguntas ao usuário. Produza diretamente a entrega final solicitada.`;

      const aiResult = await aiGenerator({
        model: google(targetModel),
        system: systemInstruction,
        prompt: promptText,
        tools: tenantTools,
        stopWhen: isStepCount(6),
      });

      void recordAiUsageLog({
        tenantId: routine.tenantId,
        userId: routine.userId,
        featureSource: "automation",
        conversationId: routine.id,
        usage: aiResult.usage,
      });

      outputSummary =
        aiResult.text?.trim() ||
        `Rotina "${routine.title}" executada com sucesso. Nenhuma ação pendente ou anomalia detectada.`;
    }

    // 1. Salvar na thread "Operações do Dia" se o canal for chat_thread (ou default)
    let threadId: string | undefined;
    if (!routine.actionTarget || routine.actionTarget === "chat_thread") {
      try {
        const thread = await threadsRepo.getOrCreateDailyOperationsThread(
          routine.tenantId,
          routine.userId
        );
        threadId = thread.id;
        const formattedMessage = `🤖 **Rotina Autônoma:** ${routine.title}\n\n${outputSummary}`;
        await threadsRepo.saveMessage(thread.id, "assistant", formattedMessage);
        await threadsRepo.touchThread(thread.id);
      } catch (err: any) {
        console.warn("[RoutineExecutor] Não foi possível salvar na thread:", err?.message);
      }
    }

    // 2. Gravar no log de execuções
    try {
      await routinesRepo.createLog({
        routineId: routine.id,
        tenantId: routine.tenantId,
        status: "success",
        outputSummary,
      });
      await routinesRepo.updateLastRunAt(routine.id);
    } catch (err: any) {
      console.warn("[RoutineExecutor] Não foi possível salvar log no banco:", err?.message);
    }

    return {
      success: true,
      status: "success",
      outputSummary,
      threadId,
    };
  } catch (error: any) {
    const errorMsg = error?.message || "Erro desconhecido ao executar rotina.";
    console.error(`[RoutineExecutor] Falha na rotina ${routine.id} (${routine.title}):`, errorMsg);

    try {
      await routinesRepo.createLog({
        routineId: routine.id,
        tenantId: routine.tenantId,
        status: "error",
        outputSummary: `Falha na execução: ${errorMsg}`,
      });
      await routinesRepo.updateLastRunAt(routine.id);
    } catch {}

    return {
      success: false,
      status: "error",
      outputSummary: `Erro ao executar rotina: ${errorMsg}`,
    };
  }
}
