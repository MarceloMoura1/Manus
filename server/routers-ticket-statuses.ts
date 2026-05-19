/**
 * tRPC router para gerenciar status personalizados de chamados
 */
import { z } from "zod";
import { router, adminProcedure } from "./_core/trpc";
import {
  getTicketStatuses,
  createTicketStatus,
  updateTicketStatus,
  deleteTicketStatus,
  getOrCreateDefaultStatuses,
} from "./db-ticket-statuses";

export const ticketStatusesRouter = router({
  /**
   * Listar todos os status de um cliente (admin)
   */
  list: adminProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      return getTicketStatuses(input.clientId);
    }),

  /**
   * Criar novo status personalizado (admin)
   */
  create: adminProcedure
    .input(
      z.object({
        clientId: z.string(),
        name: z.string().min(1).max(120),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).optional().default("#3b82f6"),
        order: z.number().int().optional().default(0),
      })
    )
    .mutation(async ({ input }) => {
      return createTicketStatus(input.clientId, input.name, input.color, input.order);
    }),

  /**
   * Atualizar status personalizado (admin)
   */
  update: adminProcedure
    .input(
      z.object({
        clientId: z.string(),
        statusId: z.string(),
        name: z.string().min(1).max(120).optional(),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        order: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return updateTicketStatus(input.clientId, input.statusId, {
        name: input.name,
        color: input.color,
        order: input.order,
      });
    }),

  /**
   * Deletar status personalizado (admin)
   */
  delete: adminProcedure
    .input(z.object({ clientId: z.string(), statusId: z.string() }))
    .mutation(async ({ input }) => {
      await deleteTicketStatus(input.clientId, input.statusId);
      return { success: true };
    }),

  /**
   * Obter ou criar status padrão (admin)
   */
  getOrCreateDefaults: adminProcedure
    .input(z.object({ clientId: z.string() }))
    .query(async ({ input }) => {
      return getOrCreateDefaultStatuses(input.clientId);
    }),
});
