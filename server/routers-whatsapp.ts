/**
 * tRPC router para gerenciar configurações de WhatsApp
 * Apenas admins podem acessar estas procedures
 */
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { z } from "zod";
import {
  getWhatsappConfig,
  saveWhatsappConfig,
  updateConnectionStatus,
  updateWebhookStatus,
  deleteWhatsappConfig,
} from "./db-whatsapp";
import { TRPCError } from "@trpc/server";

/**
 * Validar que o cliente está liberado e ativo
 */
async function getReleasedClientOrThrow(clientId: string) {
  // Implementação simplificada - em produção, buscar do banco de dados
  if (!clientId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cliente não identificado" });
  }
  // TODO: Buscar cliente do banco e validar status
  return { clientId };
}

export const whatsappRouter = router({
  /**
   * Buscar configuração WhatsApp do cliente (admin)
   */
  getConfig: adminProcedure.input(z.object({ clientId: z.string() })).query(async ({ input }) => {
    await getReleasedClientOrThrow(input.clientId);
    const config = await getWhatsappConfig(input.clientId);
    
    // Não retornar accessToken completo por segurança
    if (config) {
      return {
        ...config,
        accessToken: config.accessToken ? "***" + config.accessToken.slice(-10) : "",
      };
    }
    return null;
  }),

  /**
   * Salvar configuração WhatsApp (admin)
   */
  saveConfig: adminProcedure
    .input(
      z.object({
        clientId: z.string(),
        phoneNumberId: z.string(),
        businessAccountId: z.string(),
        accessToken: z.string(),
        webhookVerifyToken: z.string(),
        phoneNumber: z.string(),
        webhookUrl: z.string().optional(),
      })
    )
    .mutation(async ({ input: data }) => {
      const input = data;
      await getReleasedClientOrThrow(input.clientId);

      const config = await saveWhatsappConfig(input.clientId, {
        phoneNumberId: input.phoneNumberId,
        businessAccountId: input.businessAccountId,
        accessToken: input.accessToken,
        webhookVerifyToken: input.webhookVerifyToken,
        phoneNumber: input.phoneNumber,
        webhookUrl: input.webhookUrl,
      });

      return {
        success: true,
        config: config ? { ...config, accessToken: "***" } : null,
      };
    }),

  /**
   * Testar conexão com WhatsApp (admin)
   */
  testConnection: adminProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ input: data }) => {
      const input = data;
      await getReleasedClientOrThrow(input.clientId);
      const config = await getWhatsappConfig(input.clientId);

      if (!config) {
        return { success: false, message: "Configuração WhatsApp não encontrada" };
      }

      try {
        // Simular teste de conexão com API do WhatsApp
        // Em produção, fazer chamada real à API
        const response = await fetch(
          `https://graph.instagram.com/v18.0/${config.phoneNumberId}`,
          {
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
            },
          }
        );

        if (response.ok) {
          // Atualizar status de conexão
          await updateConnectionStatus(input.clientId, true);
          await updateWebhookStatus(input.clientId, "verified");

          return {
            success: true,
            message: "Conexão com WhatsApp verificada com sucesso!",
            phoneNumber: config.phoneNumber,
          };
        } else {
          await updateWebhookStatus(input.clientId, "failed");
          return {
            success: false,
            message: "Falha ao conectar com WhatsApp. Verifique as credenciais.",
          };
        }
      } catch (error) {
        await updateWebhookStatus(input.clientId, "failed");
        return {
          success: false,
          message: "Erro ao testar conexão: " + (error instanceof Error ? error.message : "Erro desconhecido"),
        };
      }
    }),

  /**
   * Atualizar status do webhook (admin)
   */
  updateWebhookStatus: adminProcedure
    .input(
      z.object({
        clientId: z.string(),
        status: z.enum(["pending", "verified", "failed"]),
      })
    )
    .mutation(async ({ input }) => {
      await getReleasedClientOrThrow(input.clientId);
      const config = await updateWebhookStatus(input.clientId, input.status);
      return { success: true, config };
    }),

  /**
   * Deletar configuração WhatsApp (admin)
   */
  deleteConfig: adminProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ input }) => {
      await getReleasedClientOrThrow(input.clientId);
      await deleteWhatsappConfig(input.clientId);
      return { success: true, message: "Configuração WhatsApp deletada com sucesso" };
    }),
});
