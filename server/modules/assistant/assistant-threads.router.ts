import { TRPCError } from "@trpc/server";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, isStepCount } from "ai";
import { router, isolatedProcedure } from "../../_core/trpc";
import { createHermesTools } from "../../hermes-tools";
import { getClientGeminiToken } from "../../gemini-client";
import { recordAiUsageLog } from "../ai-usage/ai-usage.service";
import {
  createThreadSchema,
  deleteThreadSchema,
  renameThreadSchema,
  getThreadMessagesSchema,
  sendThreadMessageSchema,
  sendThreadAudioMessageSchema,
} from "./contracts";
import {
  AssistantThreadsRepository,
  assistantThreadsRepository,
} from "./repository";

export const CANONICAL_GEMINI_MODEL = "gemini-3.5-flash-lite";

export function buildToneInstruction(tone?: "pratico" | "formal" | "direto"): string {
  switch (tone) {
    case "formal":
      return "Adote uma postura corporativa, profissional, polida e técnica na formulação das respostas.";
    case "direto":
      return "Adote uma postura ultra-concisa. Seja direto ao ponto, priorize dados e tabelas, omitindo saudações ou despedidas desnecessárias.";
    case "pratico":
    default:
      return "Adote uma postura prática, colaborativa e direta, focada na agilidade da rotina operacional.";
  }
}

export interface AssistantSessionIdentity {
  tenantId: string;
  userId: string;
  userEmail?: string;
  operationalUserId?: string;
  userRole?: string;
}

export function resolveAssistantIdentity(ctx: any): AssistantSessionIdentity {
  // 1. Sessão Operacional MegaDesk
  if (ctx?.tenantId && (ctx?.userEmail || ctx?.operationalUserId)) {
    const userEmail = ctx.userEmail ? String(ctx.userEmail).trim().toLowerCase() : undefined;
    const operationalUserId = ctx.operationalUserId ? String(ctx.operationalUserId).trim().toLowerCase() : undefined;
    const userRole = ctx.operationalUserRole || ctx.userRole || ctx.role || (ctx.user?.role ? String(ctx.user.role) : undefined);
    return {
      tenantId: String(ctx.tenantId).trim(),
      userId: (userEmail || operationalUserId)!,
      userEmail,
      operationalUserId,
      userRole: userRole ? String(userRole).trim().toLowerCase() : undefined,
    };
  }

  // 2. Sessão Administrativa (MegaAdmin / Administrador)
  if (ctx?.user) {
    const adminId = ctx.user.email || ctx.user.openId || (ctx.user.id ? String(ctx.user.id) : null);
    if (adminId) {
      const email = ctx.user.email ? String(ctx.user.email).trim().toLowerCase() : undefined;
      const userRole = ctx.user.role || ctx.operationalUserRole || ctx.userRole || "admin";
      return {
        tenantId: ctx.user.clientId ? String(ctx.user.clientId).trim() : "main",
        userId: adminId.trim().toLowerCase(),
        userEmail: email,
        operationalUserId: ctx.user.id ? String(ctx.user.id).trim().toLowerCase() : undefined,
        userRole: userRole ? String(userRole).trim().toLowerCase() : "admin",
      };
    }
  }

  // 3. Contexto explícito de testes unitários / integração
  if (ctx?.assistantIdentity?.tenantId && ctx?.assistantIdentity?.userId) {
    return {
      tenantId: String(ctx.assistantIdentity.tenantId).trim(),
      userId: String(ctx.assistantIdentity.userId).trim().toLowerCase(),
      userEmail: ctx.assistantIdentity.userEmail ? String(ctx.assistantIdentity.userEmail).trim().toLowerCase() : undefined,
      operationalUserId: ctx.assistantIdentity.operationalUserId ? String(ctx.assistantIdentity.operationalUserId).trim().toLowerCase() : undefined,
      userRole: ctx.assistantIdentity.userRole ? String(ctx.assistantIdentity.userRole).trim().toLowerCase() : undefined,
    };
  }

  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "Sessão não autorizada para o assistente IA. Faça login para continuar.",
  });
}

export async function resolveGeminiApiKey(tenantId: string): Promise<string | null> {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey && envKey.length > 5) {
    return envKey;
  }
  try {
    const tenantKey = await getClientGeminiToken(tenantId);
    if (tenantKey && tenantKey.trim().length > 5) {
      return tenantKey.trim();
    }
  } catch {
    // Em ambiente de teste sem banco de dados ativo, ignora e retorna null
  }
  return null;
}

export function stripAudioDataUrlPrefix(audioBase64: string): string {
  return audioBase64.replace(/^data:[^;]+;base64,/i, "").trim();
}

export function extractToolMetadata(aiResult: any): Record<string, unknown> | null {
  const toolResults = Array.isArray(aiResult?.toolResults) ? aiResult.toolResults : [];
  const toolCalls = Array.isArray(aiResult?.toolCalls) ? aiResult.toolCalls : [];
  if (toolResults.length === 0 && toolCalls.length === 0) {
    return null;
  }

  let pendingActionRequest: unknown = undefined;
  for (const tr of toolResults) {
    const output = tr?.output ?? tr?.result;
    if (output && typeof output === "object" && "pendingActionRequest" in output && output.pendingActionRequest) {
      pendingActionRequest = output.pendingActionRequest;
      break;
    }
  }

  return {
    toolCalls: toolCalls.map((tc: any) => ({
      toolName: tc.toolName,
      args: tc.input ?? tc.args ?? {},
    })),
    toolResults: toolResults.map((tr: any) => ({
      toolName: tr.toolName,
      output: tr.output ?? tr.result ?? null,
    })),
    ...(pendingActionRequest ? { pendingActionRequest } : {}),
  };
}

export function createAssistantThreadsRouter(
  repo: AssistantThreadsRepository = assistantThreadsRepository,
  aiGenerator: typeof generateText = generateText
) {
  return router({
    listThreads: isolatedProcedure.query(async ({ ctx }) => {
      const { tenantId, userId } = resolveAssistantIdentity(ctx);
      const threads = await repo.listThreads(tenantId, userId);
      return {
        threads,
      };
    }),

    createThread: isolatedProcedure
      .input(createThreadSchema)
      .mutation(async ({ ctx, input }) => {
        const { tenantId, userId } = resolveAssistantIdentity(ctx);
        const thread = await repo.createThread(tenantId, userId, input?.title);
        return {
          thread,
        };
      }),

    deleteThread: isolatedProcedure
      .input(deleteThreadSchema)
      .mutation(async ({ ctx, input }) => {
        const { tenantId, userId } = resolveAssistantIdentity(ctx);
        const thread = await repo.getThread(tenantId, userId, input.threadId);
        if (!thread) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sessão de conversa não encontrada ou acesso não autorizado.",
          });
        }
        const result = await repo.deleteThread(tenantId, userId, input.threadId);
        return result;
      }),

    renameThread: isolatedProcedure
      .input(renameThreadSchema)
      .mutation(async ({ ctx, input }) => {
        const { tenantId, userId } = resolveAssistantIdentity(ctx);
        const thread = await repo.getThread(tenantId, userId, input.threadId);
        if (!thread) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sessão de conversa não encontrada ou acesso não autorizado.",
          });
        }
        const updated = await repo.renameThread(tenantId, userId, input.threadId, input.title);
        return {
          thread: updated,
        };
      }),

    getThreadMessages: isolatedProcedure
      .input(getThreadMessagesSchema)
      .query(async ({ ctx, input }) => {
        const { tenantId, userId } = resolveAssistantIdentity(ctx);
        const thread = await repo.getThread(tenantId, userId, input.threadId);
        if (!thread) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sessão de conversa não encontrada ou acesso não autorizado.",
          });
        }
        const messages = await repo.getThreadMessages(input.threadId);
        return {
          thread,
          messages,
        };
      }),

    sendThreadMessage: isolatedProcedure
      .input(sendThreadMessageSchema)
      .mutation(async ({ ctx, input }) => {
        const identity = resolveAssistantIdentity(ctx);
        const { tenantId, userId } = identity;
        const thread = await repo.getThread(tenantId, userId, input.threadId);
        if (!thread) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sessão de conversa não encontrada ou acesso não autorizado.",
          });
        }

        const trimmedContent = input.content.trim();

        // 1. Salva a mensagem do usuário imediatamente
        const userMessage = await repo.saveMessage(input.threadId, "user", trimmedContent);

        // 2. Carrega histórico sequencial limpo
        const allMessages = await repo.getThreadMessages(input.threadId);

        // 3. Atualiza o título da conversa se for a primeira mensagem e ainda tiver o título padrão
        if (thread.title === "Nova Conversa" && allMessages.filter(m => m.role === "user").length === 1) {
          const autoTitle = trimmedContent.length > 40
            ? `${trimmedContent.slice(0, 37)}...`
            : trimmedContent;
          await repo.touchThread(input.threadId, autoTitle);
        } else {
          await repo.touchThread(input.threadId);
        }

        // 4. Verifica chave do Gemini
        const apiKey = await resolveGeminiApiKey(tenantId);
        if (!apiKey) {
          const fallbackContent = "A chave da API Gemini (GEMINI_API_KEY) não está configurada no ambiente. Configure a credencial para ativar as respostas da inteligência artificial.";
          const assistantMessage = await repo.saveMessage(input.threadId, "assistant", fallbackContent);
          return {
            userMessage,
            assistantMessage,
          };
        }

        // 5. Prepara mensagens para o Vercel AI SDK
        const promptMessages = allMessages.map((m) => ({
          role: (m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user") as "user" | "assistant" | "system",
          content: m.content,
        }));

        try {
          const google = createGoogleGenerativeAI({ apiKey });
          const targetModel = process.env.GEMINI_MODEL || CANONICAL_GEMINI_MODEL;
          const hitlRequired = input.settings?.hitlRequired ?? true;
          const tenantTools = createHermesTools({
            clientId: tenantId,
            userId,
            userEmail: identity.userEmail,
            operationalUserId: identity.operationalUserId,
            userRole: identity.userRole,
            hitlRequired,
          });

          const toneInstruction = buildToneInstruction(input.settings?.tone);
          const systemInstruction = `Você é o Copiloto de Inteligência Artificial da plataforma MegaDesk.
Atue como um assessor executivo e operacional ágil, estruturado, acolhedor e focado em resolver as necessidades do usuário em português do Brasil.
${toneInstruction}
Você tem acesso a ferramentas operacionais para:
- Consultar em tempo real os indicadores e métricas operacionais da empresa com get_system_metrics_summary (conversas ativas no WhatsApp, carga de atendentes, chamados abertos/críticos, rastreamentos, leads no CRM, orçamentos e status da cota de tokens de IA). SEMPRE use get_system_metrics_summary quando o usuário perguntar como está o dia, pendências, prioridades, gargalos da equipe ou consumo da plataforma.
- Registrar tarefas acionáveis e prioritárias no checklist de 'Tarefas do Dia' do Centro de Comando com create_daily_action_task (especificando title, priority e targetRoute). Sempre que o usuário pedir para gerar plano do dia, sugerir prioridades ou organizar as ações operacionais, utilize create_daily_action_task para adicionar as tarefas mais importantes diretamente no painel.
- Consultar chamados, vendas e clientes no CRM.
- Abrir chamados e enviar mensagens via WhatsApp (send_whatsapp_message).`;

          const aiResult = await aiGenerator({
            model: google(targetModel),
            system: systemInstruction,
            messages: promptMessages,
            tools: tenantTools,
            stopWhen: isStepCount(5),
          });

          void recordAiUsageLog({
            tenantId,
            userId,
            featureSource: "assistant_chat",
            conversationId: input.threadId,
            usage: aiResult.usage,
            promptText: input.content,
            completionText: aiResult.text || "",
          });

          const toolMetadata = extractToolMetadata(aiResult);
          const pendingReq = toolMetadata?.pendingActionRequest as any;

          let directMessage = "";
          if (Array.isArray(toolMetadata?.toolResults)) {
            for (const tr of toolMetadata.toolResults as any[]) {
              if (tr?.output?.status === "executado_direto" && tr?.output?.ticketNumber) {
                directMessage = `Criei o chamado #${tr.output.ticketNumber} com o assunto "${tr.output.assunto || ""}" para o cliente ${tr.output.cliente || ""}.`;
                break;
              }
              if (tr?.output?.status === "executado_direto" && tr?.output?.recipient) {
                directMessage = `Mensagem enviada com sucesso para ${tr.output.recipient} via WhatsApp.`;
                break;
              }
            }
          }

          const replyText =
            aiResult.text?.trim() ||
            directMessage ||
            (pendingReq?.summary ? `Preparei a ação solicitada para sua aprovação: ${pendingReq.summary}` : "Não foi possível obter uma resposta do assistente.");

          const assistantMessage = await repo.saveMessage(
            input.threadId,
            "assistant",
            replyText,
            toolMetadata
          );

          return {
            userMessage,
            assistantMessage,
          };
        } catch (error: any) {
          console.error(`[AssistantThreadsRouter] Erro ao chamar Gemini no thread=${input.threadId}:`, error);
          const errorMessage = `Erro na comunicação com a IA: ${error?.message || "Falha temporária no provedor."}`;
          const assistantMessage = await repo.saveMessage(input.threadId, "assistant", errorMessage);
          return {
            userMessage,
            assistantMessage,
          };
        }
      }),

    sendThreadAudioMessage: isolatedProcedure
      .input(sendThreadAudioMessageSchema)
      .mutation(async ({ ctx, input }) => {
        const identity = resolveAssistantIdentity(ctx);
        const { tenantId, userId } = identity;
        const thread = await repo.getThread(tenantId, userId, input.threadId);
        if (!thread) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sessão de conversa não encontrada ou acesso não autorizado.",
          });
        }

        const cleanBase64 = stripAudioDataUrlPrefix(input.audioBase64);
        const normalizedMimeType = (input.mimeType || "audio/webm").trim();

        // 1. Salva a mensagem do usuário indicando inicialmente o envio de áudio
        const userMessage = await repo.saveMessage(
          input.threadId,
          "user",
          "🎤 [Processando áudio...]",
          { type: "audio", mimeType: normalizedMimeType }
        );

        // 2. Carrega histórico anterior da conversa
        const allMessages = await repo.getThreadMessages(input.threadId);
        const previousMessages = allMessages.filter((m) => m.id !== userMessage.id);

        if (thread.title === "Nova Conversa" && previousMessages.filter((m) => m.role === "user").length === 0) {
          await repo.touchThread(input.threadId, "Comando de Voz");
        } else {
          await repo.touchThread(input.threadId);
        }

        // 3. Verifica chave do Gemini
        const apiKey = await resolveGeminiApiKey(tenantId);
        if (!apiKey) {
          const fallbackContent = "A chave da API Gemini (GEMINI_API_KEY) não está configurada no ambiente. Configure a credencial para ativar a transcrição e execução multimodal.";
          const assistantMessage = await repo.saveMessage(input.threadId, "assistant", fallbackContent);
          return {
            userMessage,
            assistantMessage,
            transcription: null,
          };
        }

        // 4. Monta o histórico + payload multimodal de áudio para o Gemini 3.5 Flash Lite
        const historyPrompt = previousMessages.map((m) => ({
          role: (m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user") as "user" | "assistant" | "system",
          content: m.content,
        }));

        const multimodalMessages: any[] = [
          ...historyPrompt,
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: "Interprete o áudio a seguir e execute as ações necessárias ou responda ao usuário:",
              },
              {
                type: "file" as const,
                data: cleanBase64,
                mediaType: normalizedMimeType,
                mimeType: normalizedMimeType,
              },
            ],
          },
        ];

        try {
          const google = createGoogleGenerativeAI({ apiKey });
          const targetModel = process.env.GEMINI_MODEL || CANONICAL_GEMINI_MODEL;
          const hitlRequired = input.settings?.hitlRequired ?? true;
          const autoTranscribe = input.settings?.autoTranscribe ?? true;
          const tenantTools = createHermesTools({
            clientId: tenantId,
            userId,
            userEmail: identity.userEmail,
            operationalUserId: identity.operationalUserId,
            userRole: identity.userRole,
            hitlRequired,
          });

          const toneInstruction = buildToneInstruction(input.settings?.tone);
          const systemInstruction = `Você é o Copiloto Multimodal de Inteligência Artificial da plataforma MegaDesk.
O usuário enviou um comando ou pergunta por voz.
${toneInstruction}
REGRA OBRIGATÓRIA DE TRANSCRIÇÃO:
Na PRIMEIRA LINHA da sua resposta final em texto, você DEVE transcrever exatamente o que o usuário falou no áudio no seguinte formato exato:
[Transcrição: "texto falado pelo usuário"]

Após essa primeira linha, pule uma linha e forneça a sua resposta natural ou resultado da execução das ferramentas ao usuário.
Execute imediatamente as ferramentas necessárias (como consultar resumo e métricas operacionais com get_system_metrics_summary, registrar tarefas prioritárias no painel com create_daily_action_task, consultar CRM, vendas, chamados, preparar abertura de chamado ou enviar mensagem via WhatsApp) e responda de forma clara, estruturada e direta em português do Brasil.`;

          const aiResult = await aiGenerator({
            model: google(targetModel),
            system: systemInstruction,
            messages: multimodalMessages,
            tools: tenantTools,
            stopWhen: isStepCount(5),
          });

          void recordAiUsageLog({
            tenantId,
            userId,
            featureSource: "assistant_chat",
            conversationId: input.threadId,
            usage: aiResult.usage,
            fallbackPromptChars: 200,
            completionText: aiResult.text || "",
          });

          let rawText = aiResult.text?.trim() || "";
          let transcription = "";
          const match = rawText.match(/\[Transcrição:\s*["“]?([^"”\]]+)["”]?\]/i);
          if (match && match[1]) {
            transcription = match[1].trim();
            rawText = rawText.replace(/\[Transcrição:\s*["“]?[^"”\]]+["”]?\]\s*/i, "").trim();
          }

          const toolMetadata = extractToolMetadata(aiResult);
          const pendingReq = toolMetadata?.pendingActionRequest as any;

          let directMessage = "";
          if (Array.isArray(toolMetadata?.toolResults)) {
            for (const tr of toolMetadata.toolResults as any[]) {
              if (tr?.output?.status === "executado_direto" && tr?.output?.ticketNumber) {
                directMessage = `Criei o chamado #${tr.output.ticketNumber} com o assunto "${tr.output.assunto || ""}" para o cliente ${tr.output.cliente || ""}.`;
                break;
              }
              if (tr?.output?.status === "executado_direto" && tr?.output?.recipient) {
                directMessage = `Mensagem enviada com sucesso para ${tr.output.recipient} via WhatsApp.`;
                break;
              }
            }
          }

          const replyText =
            rawText ||
            directMessage ||
            (pendingReq?.summary ? `Preparei a ação solicitada por voz para sua aprovação: ${pendingReq.summary}` : "Áudio processado com sucesso.");

          // Atualiza a mensagem do usuário no banco (se autoTranscribe for true grava a transcrição real, senão preserva áudio)
          const userDisplayContent = (autoTranscribe && transcription)
            ? `🎤 ${transcription}`
            : "🎤 [Mensagem de voz enviada]";
          const updatedUserMessage = await repo.updateMessageContent(
            userMessage.id,
            userDisplayContent,
            { type: "audio", mimeType: normalizedMimeType, transcription: autoTranscribe ? (transcription || null) : null }
          );

          if (autoTranscribe && transcription) {
            const autoTitle = transcription.length > 40 ? `${transcription.slice(0, 37)}...` : transcription;
            await repo.touchThread(input.threadId, autoTitle);
          }

          const assistantMessage = await repo.saveMessage(
            input.threadId,
            "assistant",
            replyText,
            toolMetadata
          );

          return {
            userMessage: updatedUserMessage ?? userMessage,
            assistantMessage,
            transcription: transcription || null,
          };
        } catch (error: any) {
          console.error(`[AssistantThreadsRouter] Erro ao processar áudio no Gemini thread=${input.threadId}:`, error);
          const errorMessage = `Erro ao processar o áudio na IA: ${error?.message || "Falha temporária no provedor multimodal."}`;
          const assistantMessage = await repo.saveMessage(input.threadId, "assistant", errorMessage);
          return {
            userMessage,
            assistantMessage,
            transcription: null,
          };
        }
      }),
  });
}

export const assistantThreadsRouter = createAssistantThreadsRouter();

export type AssistantThreadsRouter = typeof assistantThreadsRouter;
