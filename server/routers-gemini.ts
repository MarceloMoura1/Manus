import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import {
  saveGeminiConfig,
  testGeminiConnection,
  toggleGeminiStatus,
  getGeminiConfig,
  getQuotaInfo,
  validateQuota,
  saveIAConversation,
  getConversationHistory,
  updateConversationHistory,
  getGeminiToken,
} from "./db-gemini";
import { TRPCError } from "@trpc/server";

export const geminiRouter = router({
  /**
   * Salvar/atualizar token Gemini (MegaAdmin)
   */
  saveToken: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        token: z.string().min(10),
        quotaMode: z.enum(["free", "limited", "hybrid"]).default("free"),
        quotaMensal: z.number().int().positive().default(5000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Validar que usuário é admin
        if (ctx.user?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Apenas admins podem configurar Gemini",
          });
        }

        const configId = await saveGeminiConfig(
          input.clientId,
          input.token,
          input.quotaMode,
          input.quotaMensal
        );

        return {
          success: true,
          configId,
          message: "Token Gemini salvo com sucesso",
        };
      } catch (error) {
        console.error("[ERROR] Falha ao salvar token:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Falha ao salvar token Gemini",
        });
      }
    }),

  /**
   * Testar conexão com Gemini (MegaAdmin)
   */
  testConnection: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Apenas admins podem testar conexão",
          });
        }

        const success = await testGeminiConnection(input.clientId);

        return {
          success,
          message: success ? "Conexão testada com sucesso!" : "Falha ao conectar com Gemini",
        };
      } catch (error) {
        console.error("[ERROR] Erro ao testar conexão:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao testar conexão",
        });
      }
    }),

  /**
   * Ativar/desativar Gemini (MegaAdmin)
   */
  toggleStatus: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        ativo: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Apenas admins podem alternar status",
          });
        }

        await toggleGeminiStatus(input.clientId, input.ativo);

        return {
          success: true,
          message: `Gemini ${input.ativo ? "ativado" : "desativado"}`,
        };
      } catch (error) {
        console.error("[ERROR] Erro ao alternar status:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao alternar status",
        });
      }
    }),

  /**
   * Obter configuração Gemini (MegaAdmin)
   */
  getConfig: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        if (ctx.user?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Apenas admins podem ver configuração",
          });
        }

        const config = await getGeminiConfig(input.clientId);
        if (!config) {
          return {
            configured: false,
            config: null,
          };
        }

        return {
          configured: true,
          config: {
            quotaMode: config.quotaMode,
            quotaMensal: config.quotaMensal,
            quotaUsadaMes: config.quotaUsadaMes,
            ativo: config.ativo,
            testeConexao: config.testeConexao,
            ultimoTesteEm: config.ultimoTesteEm,
            createdAt: config.createdAt,
          },
        };
      } catch (error) {
        console.error("[ERROR] Erro ao obter config:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao obter configuração",
        });
      }
    }),

  /**
   * Obter informações de quota (MegaDesk)
   */
  getQuotaInfo: protectedProcedure.query(async ({ ctx }) => {
    try {
      const clientId = ctx.tenantId || String(ctx.user.id);
      if (!clientId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Cliente não identificado",
        });
      }

      const quotaInfo = await getQuotaInfo(clientId);
      return quotaInfo;
    } catch (error) {
      console.error("[ERROR] Erro ao obter quota:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Erro ao obter informações de quota",
      });
    }
  }),

  /**
   * Enviar mensagem para Gemini (MegaDesk)
   */
  sendMessage: protectedProcedure
    .input(
      z.object({
        message: z.string().min(1),
        tipo: z.enum(["consulta", "relatorio", "acao", "analise"]).default("consulta"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user.id);
        const userId = String(ctx.user.id);

        if (!clientId || !userId) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Usuário não identificado",
          });
        }

        // Validar quota
        const hasQuota = await validateQuota(clientId);
        if (!hasQuota) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Quota de Gemini excedida para este mês",
          });
        }

        // Obter token
        const token = await getGeminiToken(clientId);
        if (!token) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Token Gemini não configurado",
          });
        }

        // Obter histórico de conversa
        const history = await getConversationHistory(clientId, userId);
        const messages = history?.messages || [];

        // Preparar mensagens para Gemini
        const geminiMessages = [
          ...messages,
          {
            role: "user",
            content: input.message,
          },
        ];

        // Chamar Gemini
        console.log(`[LOG] Enviando mensagem para Gemini: ${input.message.substring(0, 50)}...`);

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": token,
            },
            body: JSON.stringify({
              contents: geminiMessages.map((msg) => ({
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.content }],
              })),
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          console.error("[ERROR] Erro Gemini:", errorData);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Erro ao processar mensagem com Gemini",
          });
        }

        const data = await response.json();
        const iaResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sem resposta";

        // Salvar conversa
        await saveIAConversation(clientId, userId, input.message, iaResponse, 0, input.tipo);

        // Atualizar histórico
        const newMessages = [
          ...geminiMessages,
          {
            role: "assistant",
            content: iaResponse,
          },
        ];
        await updateConversationHistory(clientId, userId, newMessages);

        console.log(`[SUCCESS] Resposta Gemini recebida`);

        return {
          success: true,
          response: iaResponse,
        };
      } catch (error) {
        console.error("[ERROR] Erro ao enviar mensagem:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao processar mensagem",
        });
      }
    }),

  /**
   * Obter histórico de conversa (MegaDesk)
   */
  getHistory: protectedProcedure.query(async ({ ctx }) => {
    try {
      const clientId = ctx.tenantId || String(ctx.user.id);
      const userId = String(ctx.user.id);

      if (!clientId || !userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Usuário não identificado",
        });
      }

      const history = await getConversationHistory(clientId, userId);
      return history || { messages: [], context: {} };
    } catch (error) {
      console.error("[ERROR] Erro ao obter histórico:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Erro ao obter histórico",
      });
    }
  }),
});
