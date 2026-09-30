/**
 * tRPC router para gerenciar configurações de WhatsApp
 * Apenas admins podem acessar estas procedures
 */
import { router, megadeskAdminProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  getWhatsappConfig,
  saveWhatsappConfig,
  updateConnectionStatus,
  updateWebhookStatus,
  deleteWhatsappConfig,
} from "./db-whatsapp";

function sanitizeWhatsappConfig<T extends { accessToken?: string | null; webhookVerifyToken?: string | null }>(config: T) {
  const { accessToken, webhookVerifyToken, ...safe } = config;
  return {
    ...safe,
    accessTokenConfigured: Boolean(accessToken),
    webhookVerifyTokenConfigured: Boolean(webhookVerifyToken),
  };
}

export const whatsappRouter = router({
  /**
   * Buscar configuração WhatsApp do cliente (admin)
   */
  getConfig: megadeskAdminProcedure.input(z.object({ clientId: z.string() })).query(async ({ input }) => {
    const config = await getWhatsappConfig(input.clientId);
    
    return config ? sanitizeWhatsappConfig(config) : null;
  }),

  /**
   * Salvar configuração WhatsApp (admin)
   */
  saveConfig: megadeskAdminProcedure
    .input(
      z.object({
        clientId: z.string(),
        phoneNumberId: z.string(),
        businessAccountId: z.string(),
        accessToken: z.string().optional(),
        webhookVerifyToken: z.string().optional(),
        phoneNumber: z.string(),
        webhookUrl: z.string().optional(),
      })
    )
    .mutation(async ({ input: data }) => {
      const input = data;
      const current = await getWhatsappConfig(input.clientId);
      const accessToken = input.accessToken?.trim() || current?.accessToken;
      const webhookVerifyToken = input.webhookVerifyToken?.trim() || current?.webhookVerifyToken || "";
      if (!accessToken) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o token de acesso do WhatsApp." });
      }
      const config = await saveWhatsappConfig(input.clientId, {
        phoneNumberId: input.phoneNumberId,
        businessAccountId: input.businessAccountId,
        accessToken,
        webhookVerifyToken,
        phoneNumber: input.phoneNumber,
        webhookUrl: input.webhookUrl,
      });

      return {
        success: true,
        config: config ? sanitizeWhatsappConfig(config) : null,
      };
    }),

  /**
   * Testar conexão com WhatsApp (admin)
   */
  testConnection: megadeskAdminProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ input: data }) => {
      const input = data;
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
      } catch {
        await updateWebhookStatus(input.clientId, "failed");
        return {
          success: false,
          message: "Erro ao testar conexão com o WhatsApp.",
        };
      }
    }),

  /**
   * Atualizar status do webhook (admin)
   */
  updateWebhookStatus: megadeskAdminProcedure
    .input(
      z.object({
        clientId: z.string(),
        status: z.enum(["pending", "verified", "failed"]),
      })
    )
    .mutation(async ({ input }) => {
      const config = await updateWebhookStatus(input.clientId, input.status);
      return { success: true, config };
    }),

  /**
   * Deletar configuração WhatsApp (admin)
   */
  deleteConfig: megadeskAdminProcedure
    .input(z.object({ clientId: z.string() }))
    .mutation(async ({ input }) => {
      await deleteWhatsappConfig(input.clientId);
      return { success: true, message: "Configuração WhatsApp deletada com sucesso" };
    }),
});
