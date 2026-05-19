/**
 * tRPC router para gerenciar scripts de bot IA
 */
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
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

export const botScriptsRouter = router({
  /**
   * Listar todos os scripts de bot de um cliente
   */
  list: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      return getBotScripts(input.clientId);
    }),

  /**
   * Obter um script específico
   */
  get: protectedProcedure
    .input(z.object({ clientId: z.string(), scriptId: z.string() }))
    .query(async ({ input }) => {
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
  create: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        name: z.string().min(1),
        description: z.string().optional(),
        systemPrompt: z.string().min(1),
        initialMessage: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
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
  update: protectedProcedure
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
    .mutation(async ({ input }) => {
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
  delete: protectedProcedure
    .input(z.object({ clientId: z.string(), scriptId: z.string() }))
    .mutation(async ({ input }) => {
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
  activate: protectedProcedure
    .input(z.object({ clientId: z.string(), scriptId: z.string() }))
    .mutation(async ({ input }) => {
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
  deactivate: protectedProcedure
    .input(z.object({ clientId: z.string(), scriptId: z.string() }))
    .mutation(async ({ input }) => {
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
  getActive: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      return getActiveBotScript(input.clientId);
    }),
});
