/**
 * tRPC router para gerenciar scripts de bot IA
 */
import { z } from "zod";
import { router, megadeskProcedure } from "./_core/trpc";
import {
  createBotScript,
  getBotScripts,
  getBotScript,
  updateBotScript,
  deleteBotScript,
  activateBotScript,
  deactivateBotScript,
  getActiveBotScript,
} from "./db-bot-scripts";

import { TRPCError } from "@trpc/server";
import { invokeLLM } from "./_core/llm";

function assertOwnTenant(requestedClientId: string, tenantId: string | undefined): void {
  if (!tenantId || requestedClientId !== tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
  }
}

function assertPromptManager(role: string | undefined): void {
  if (role !== "admin" && role !== "manager") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Permissão insuficiente para gerenciar instruções do bot" });
  }
}

export const botScriptsRouter = router({
  /**
   * Listar todos os scripts de bot de um cliente
   */
  list: megadeskProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Validar que clientId pertence ao tenant
      assertOwnTenant(input.clientId, ctx.tenantId);
      return getBotScripts(input.clientId);
    }),

  /**
   * Obter um script específico
   */
  get: megadeskProcedure
    .input(z.object({ clientId: z.string(), scriptId: z.string() }))
    .query(async ({ input, ctx }) => {
      assertOwnTenant(input.clientId, ctx.tenantId);
      assertPromptManager(ctx.operationalUserRole);
      const script = await getBotScript(input.clientId, input.scriptId);
      if (!script) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bot script not found",
        });
      }
      return script;
    }),

  /**
   * Criar novo script de bot
   */
  create: megadeskProcedure
    .input(
      z.object({
        clientId: z.string(),
        name: z.string().min(1),
        description: z.string().optional(),
        systemPrompt: z.string().min(1),
        initialMessage: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assertOwnTenant(input.clientId, ctx.tenantId);
      assertPromptManager(ctx.operationalUserRole);
      const scriptId = await createBotScript(input.clientId, {
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        initialMessage: input.initialMessage,
      });
      return { scriptId };
    }),

  /**
   * Atualizar script de bot
   */
  update: megadeskProcedure
    .input(
      z.object({
        clientId: z.string(),
        scriptId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        systemPrompt: z.string().optional(),
        initialMessage: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assertOwnTenant(input.clientId, ctx.tenantId);
      assertPromptManager(ctx.operationalUserRole);
      const script = await getBotScript(input.clientId, input.scriptId);
      if (!script) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bot script not found",
        });
      }

      await updateBotScript(input.clientId, input.scriptId, {
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        initialMessage: input.initialMessage,
      });

      return { success: true };
    }),

  /**
   * Deletar script de bot
   */
  delete: megadeskProcedure
    .input(z.object({ clientId: z.string(), scriptId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      assertOwnTenant(input.clientId, ctx.tenantId);
      assertPromptManager(ctx.operationalUserRole);
      const script = await getBotScript(input.clientId, input.scriptId);
      if (!script) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bot script not found",
        });
      }

      await deleteBotScript(input.clientId, input.scriptId);
      return { success: true };
    }),

  /**
   * Ativar script de bot
   */
  activate: megadeskProcedure
    .input(z.object({ clientId: z.string(), scriptId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      assertOwnTenant(input.clientId, ctx.tenantId);
      assertPromptManager(ctx.operationalUserRole);
      const script = await getBotScript(input.clientId, input.scriptId);
      if (!script) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bot script not found",
        });
      }

      await activateBotScript(input.clientId, input.scriptId);
      return { success: true };
    }),

  /**
   * Desativar script de bot
   */
  deactivate: megadeskProcedure
    .input(z.object({ clientId: z.string(), scriptId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      assertOwnTenant(input.clientId, ctx.tenantId);
      assertPromptManager(ctx.operationalUserRole);
      const script = await getBotScript(input.clientId, input.scriptId);
      if (!script) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bot script not found",
        });
      }

      await deactivateBotScript(input.clientId, input.scriptId);
      return { success: true };
    }),

  /**
   * Obter script ativo
   */
  getActive: megadeskProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input, ctx }) => {
      assertOwnTenant(input.clientId, ctx.tenantId);
      const script = await getActiveBotScript(input.clientId);
      return script;
    }),

  testScript: megadeskProcedure
    .input(
      z.object({
        clientId: z.string(),
        scriptId: z.string(),
        userMessage: z.string(),
        conversationHistory: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assertOwnTenant(input.clientId, ctx.tenantId);
      const script = await getBotScript(input.clientId, input.scriptId);
      if (!script) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bot script not found",
        });
      }

      const messages: Array<{
        role: "user" | "assistant" | "system";
        content: string;
      }> = [
        {
          role: "system",
          content: script.systemPrompt,
        },
      ];

      if (input.conversationHistory && input.conversationHistory.length > 0) {
        messages.push(...input.conversationHistory);
      }

      messages.push({
        role: "user",
        content: input.userMessage,
      });

      try {
        const response = await invokeLLM({
          messages,
        });

        const messageContent = response.choices?.[0]?.message?.content;
        const botResponse = typeof messageContent === "string" 
          ? messageContent 
          : "Desculpe, não consegui gerar uma resposta.";

        return {
          success: true,
          botResponse,
        };
      } catch {
        console.error("Erro ao chamar Gemini IA; detalhes sensíveis omitidos.");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao gerar resposta do bot",
        });
      }
    }),
});
