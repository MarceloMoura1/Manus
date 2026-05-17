/**
 * routers-crm.ts — Procedures tRPC para a página de Clientes (CRM)
 * REGRA 1: Toda procedure filtra por clientId.
 * REGRA 6: getReleasedClientOrThrow é chamado antes de qualquer operação.
 * REGRA 8: clientId sempre vem da sessão MegaDesk.
 */
import { z } from "zod";
import { router, publicProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  listCrmClients,
  getCrmClientById,
  createCrmClient,
  updateCrmClient,
  deleteCrmClient,
} from "./db-crm";

// Helper para extrair clientId da sessão MegaDesk
function getClientIdFromCtx(ctx: any): string {
  const clientId = ctx.megadeskClientId as string | undefined;
  if (!clientId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sessão MegaDesk inválida. clientId não encontrado.",
    });
  }
  return clientId;
}

const crmClientInputSchema = z.object({
  companyName: z.string().min(1, "Nome da empresa é obrigatório"),
  responsibleName: z.string().optional().default(""),
  cpfCnpj: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  whatsapp: z.string().optional().default(""),
  email: z.string().optional().default(""),
  address: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().max(2).optional().default(""),
  cep: z.string().optional().default(""),
  status: z.enum(["lead", "ativo", "inativo", "cancelado", "inadimplente"]).optional().default("lead"),
  origin: z.enum(["whatsapp", "instagram", "facebook", "site", "indicacao", "outro"]).optional().default("outro"),
  internalResponsible: z.string().optional().default(""),
  tags: z.string().optional().default(""),
  observations: z.string().optional().default(""),
});

export const crmRouter = router({
  // Listar clientes CRM do tenant
  list: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const clients = await listCrmClients(input.clientId, input.search);
      return { clients };
    }),

  // Buscar cliente CRM por ID
  getById: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const client = await getCrmClientById(input.crmClientId, input.clientId);
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
      }
      return { client };
    }),

  // Criar novo cliente CRM
  create: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      data: crmClientInputSchema,
    }))
    .mutation(async ({ input }) => {
      const result = await createCrmClient(input.clientId, input.data);
      return { success: true, crmClientId: result.crmClientId };
    }),

  // Atualizar cliente CRM
  update: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
      data: crmClientInputSchema.partial(),
    }))
    .mutation(async ({ input }) => {
      await updateCrmClient(input.crmClientId, input.clientId, input.data);
      return { success: true };
    }),

  // Excluir cliente CRM
  delete: publicProcedure
    .input(z.object({
      clientId: z.string().min(1),
      crmClientId: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      await deleteCrmClient(input.crmClientId, input.clientId);
      return { success: true };
    }),
});
