import { router, protectedProcedure } from "./_core/trpc";
import type { Context } from "./_core/trpc";
import { z } from "zod";
import { getFailedMessagesPending, countPendingFailedMessages } from "./baileys-failed-messages";
import { sendBaileysMessage } from "./whatsapp-baileys";
import { incrementRetryCount, markMessageAsCompleted, markMessageAsFailed } from "./baileys-failed-messages";

export const retryRouter = router({
  /**
   * Obter contagem de mensagens falhadas pendentes
   */
  getPendingCount: protectedProcedure.query(async ({ ctx }: any) => {
    try {
      const count = await countPendingFailedMessages(ctx.user.clientId);
      return { count };
    } catch (err: any) {
      console.error("Erro ao contar mensagens falhadas:", err);
      return { count: 0 };
    }
  }),

  /**
   * Obter lista de mensagens falhadas
   */
  getFailedMessages: protectedProcedure.query(async ({ ctx }: any) => {
    try {
      const messages = await getFailedMessagesPending(ctx.user.clientId, 100);
      return {
        messages: messages.map((m: any) => ({
          id: m.id,
          phone: m.phone,
          messageText: m.message_text,
          errorType: m.error_type,
          errorMessage: m.error_message,
          retryCount: m.retry_count,
          maxRetries: m.max_retries,
          status: m.status,
          createdAt: m.created_at,
          lastRetryAt: m.last_retry_at,
        })),
      };
    } catch (err: any) {
      console.error("Erro ao obter mensagens falhadas:", err);
      return { messages: [] };
    }
  }),

  /**
   * Reenviar todas as mensagens falhadas pendentes
   */
  retryAll: protectedProcedure.mutation(async ({ ctx }: any) => {
    try {
      const failedMessages = await getFailedMessagesPending(ctx.user.clientId);

      if (failedMessages.length === 0) {
        return {
          success: true,
          message: "Nenhuma mensagem falhada para reenviar",
          retried: 0,
          succeeded: 0,
          failed: 0,
        };
      }

      let succeeded = 0;
      let failed = 0;

      for (const msg of failedMessages) {
        try {
          // Verificar se atingiu máximo de retries
          if (msg.retry_count >= msg.max_retries) {
            await markMessageAsFailed(msg.id, "Máximo de tentativas atingido");
            failed++;
            continue;
          }

          // Incrementar retry count
          await incrementRetryCount(msg.id);

          // Tentar reenviar
          const result = await sendBaileysMessage(
            ctx.user.clientId,
            msg.conversation_id,
            msg.phone,
            msg.message_text,
            ctx.user.name || "Sistema"
          );

          if (result.ok) {
            await markMessageAsCompleted(msg.id);
            succeeded++;
            console.log(`[Retry] Mensagem ${msg.id} reenviada com sucesso`);
          } else {
            failed++;
            console.log(`[Retry] Falha ao reenviar ${msg.id}: ${result.error}`);
          }
        } catch (err: any) {
          failed++;
          console.error(`[Retry] Erro ao reenviar ${msg.id}:`, err);
        }

        // Delay para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      return {
        success: true,
        message: `Reenvio concluído: ${succeeded} sucesso, ${failed} falha`,
        retried: failedMessages.length,
        succeeded,
        failed,
      };
    } catch (err: any) {
      console.error("Erro ao reenviar mensagens:", err);
      return {
        success: false,
        message: err.message || "Erro ao reenviar mensagens",
        retried: 0,
        succeeded: 0,
        failed: 0,
      };
    }
  }),

  /**
   * Reenviar uma mensagem específica
   */
  retryOne: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }: any) => {
      try {
        const [messages]: any = await (await import("./db")).getPool().execute(
          `SELECT * FROM baileys_failed_messages WHERE id = ? AND client_id = ? LIMIT 1`,
          [input.messageId, ctx.user.clientId]
        );

        if (!messages || messages.length === 0) {
          return { success: false, message: "Mensagem não encontrada" };
        }

        const msg = messages[0];

        if (msg.retry_count >= msg.max_retries) {
          return { success: false, message: "Máximo de tentativas atingido" };
        }

        await incrementRetryCount(msg.id);

        const result = await sendBaileysMessage(
          ctx.user.clientId,
          msg.conversation_id,
          msg.phone,
          msg.message_text,
          ctx.user.name || "Sistema"
        );

        if (result.ok) {
          await markMessageAsCompleted(msg.id);
          return { success: true, message: "Mensagem reenviada com sucesso" };
        } else {
          return { success: false, message: result.error || "Erro ao reenviar" };
        }
      } catch (err: any) {
        console.error("Erro ao reenviar mensagem:", err);
        return { success: false, message: err.message || "Erro ao reenviar" };
      }
    }),
});
