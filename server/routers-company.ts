/**
 * tRPC router para gerenciar dados da empresa
 */
import { router, adminProcedure } from "./_core/trpc";
import { z } from "zod";
import { getCompanySettings, saveCompanySettings } from "./db-company";
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

export const companyRouter = router({
  /**
   * Buscar configurações da empresa
   */
  getSettings: adminProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      await getReleasedClientOrThrow(input.clientId);
      return await getCompanySettings(input.clientId);
    }),

  /**
   * Salvar configurações da empresa
   */
  saveSettings: adminProcedure
    .input(
      z.object({
        clientId: z.string(),
        companyName: z.string().optional(),
        logoUrl: z.string().optional(),
        primaryEmail: z.string().email().optional(),
        primaryPhone: z.string().optional(),
        primaryWhatsapp: z.string().optional(),
        address: z.string().optional(),
        businessHoursStart: z.string().optional(),
        businessHoursEnd: z.string().optional(),
      })
    )
    .mutation(async ({ input: data }) => {
      const input = data;
      await getReleasedClientOrThrow(input.clientId);

      const settings = await saveCompanySettings(input.clientId, {
        companyName: input.companyName,
        logoUrl: input.logoUrl,
        primaryEmail: input.primaryEmail,
        primaryPhone: input.primaryPhone,
        primaryWhatsapp: input.primaryWhatsapp,
        address: input.address,
        businessHoursStart: input.businessHoursStart,
        businessHoursEnd: input.businessHoursEnd,
      });

      return { success: true, settings };
    }),
});
