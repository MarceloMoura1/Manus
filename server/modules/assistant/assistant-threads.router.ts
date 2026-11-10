import { TRPCError } from "@trpc/server";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { router, isolatedProcedure } from "../../_core/trpc";
import {
  createThreadSchema,
  deleteThreadSchema,
  renameThreadSchema,
  getThreadMessagesSchema,
  sendThreadMessageSchema,
} from "./contracts";
import {
  AssistantThreadsRepository,
  assistantThreadsRepository,
} from "./repository";

export const CANONICAL_GEMINI_MODEL = "gemini-3.5-flash-lite";

export interface AssistantSessionIdentity {
  tenantId: string;
  userId: string;
}

export function resolveAssistantIdentity(ctx: any): AssistantSessionIdentity {
  // 1. Sessão Operacional MegaDesk
  if (ctx?.tenantId && (ctx?.operationalUserId || ctx?.userEmail)) {
    return {
      tenantId: String(ctx.tenantId).trim(),
      userId: String(ctx.operationalUserId || ctx.userEmail).trim().toLowerCase(),
    };
  }

  // 2. Sessão Administrativa (MegaAdmin / Administrador)
  if (ctx?.user) {
    const adminId = ctx.user.email || ctx.user.openId || (ctx.user.id ? String(ctx.user.id) : null);
    if (adminId) {
      return {
        tenantId: ctx.user.clientId ? String(ctx.user.clientId).trim() : "main",
        userId: adminId.trim().toLowerCase(),
      };
    }
  }

  // 3. Contexto explícito de testes unitários / integração
  if (ctx?.assistantIdentity?.tenantId && ctx?.assistantIdentity?.userId) {
    return {
      tenantId: String(ctx.assistantIdentity.tenantId).trim(),
      userId: String(ctx.assistantIdentity.userId).trim().toLowerCase(),
    };
  }

  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "Sessão não autorizada para o assistente IA. Faça login para continuar.",
  });
}

function getGeminiApiKey(tenantId: string): string | null {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey && envKey.length > 5) {
    return envKey;
  }
  return null;
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
        const { tenantId, userId } = resolveAssistantIdentity(ctx);
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
        const apiKey = getGeminiApiKey(tenantId);
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

          const systemInstruction = `Você é o Copiloto de Inteligência Artificial da plataforma MegaDesk.
Atue como um assessor executivo e operacional ágil, estruturado, acolhedor e focado em resolver as necessidades do usuário em português do Brasil.
Seja direto e prático nas respostas sem prolixidade mecânica.`;

          const aiResult = await aiGenerator({
            model: google(targetModel),
            system: systemInstruction,
            messages: promptMessages,
          });

          const replyText = aiResult.text?.trim() || "Não foi possível obter uma resposta do assistente.";

          const assistantMessage = await repo.saveMessage(input.threadId, "assistant", replyText);

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
  });
}

export const assistantThreadsRouter = createAssistantThreadsRouter();

export type AssistantThreadsRouter = typeof assistantThreadsRouter;
