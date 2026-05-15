/**
 * Procedures tRPC para gerenciar chamados
 * Importar em routers.ts e adicionar ao appRouter
 */

import { router, publicProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createChamado,
  getChamadoWithActivities,
  listChamados,
  updateChamado,
  addActivityToChamado,
  editActivity,
  type ChamadoWithActivities,
} from "./db-chamados";

export const chamadosRouter = router({
  /**
   * Listar chamados de um cliente
   */
  list: publicProcedure
    .input(
      z.object({
        clientId: z.string(),
        status: z.enum(["total", "open", "in_progress", "waiting", "closed"]).optional(),
        limit: z.number().default(100),
      })
    )
    .query(async ({ input }) => {
      try {
        const chamados = await listChamados(input.clientId, input.status, input.limit);
        return { chamados };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao listar chamados: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Obter detalhes de um chamado com atividades
   */
  getDetail: publicProcedure
    .input(
      z.object({
        chamadoId: z.string(),
        clientId: z.string(),
      })
    )
    .query(async ({ input }) => {
      try {
        const chamado = await getChamadoWithActivities(input.chamadoId, input.clientId);
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado",
          });
        }
        return { chamado };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao obter chamado: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Criar novo chamado
   */
  create: publicProcedure
    .input(
      z.object({
        clientId: z.string(),
        customerId: z.string(),
        customerName: z.string(),
        company: z.string(),
        title: z.string(),
        observations: z.string().default(""),
        priority: z.enum(["baixa", "media", "alta", "critica"]).default("media"),
        assignedTo: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const chamado = await createChamado(
          input.clientId,
          input.customerId,
          input.customerName,
          input.company,
          input.title,
          input.observations,
          input.priority,
          input.assignedTo
        );
        return { chamado };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao criar chamado: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Atualizar chamado
   */
  update: publicProcedure
    .input(
      z.object({
        chamadoId: z.string(),
        clientId: z.string(),
        title: z.string().optional(),
        observations: z.string().optional(),
        status: z.enum(["open", "in_progress", "waiting", "closed"]).optional(),
        priority: z.enum(["baixa", "media", "alta", "critica"]).optional(),
        assignedTo: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { chamadoId, clientId, ...updates } = input;
        await updateChamado(chamadoId, clientId, updates);
        const chamado = await getChamadoWithActivities(chamadoId, clientId);
        return { chamado };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao atualizar chamado: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Adicionar atividade a um chamado
   */
  addActivity: publicProcedure
    .input(
      z.object({
        chamadoId: z.string(),
        clientId: z.string(),
        description: z.string(),
        attendant: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        if (!input.description.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Descrição da atividade não pode estar vazia",
          });
        }

        await addActivityToChamado(
          input.chamadoId,
          input.clientId,
          input.description,
          input.attendant
        );

        const chamado = await getChamadoWithActivities(input.chamadoId, input.clientId);
        return { chamado };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao adicionar atividade: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Editar atividade de um chamado
   */
  editActivity: publicProcedure
    .input(
      z.object({
        activityId: z.string(),
        chamadoId: z.string(),
        clientId: z.string(),
        description: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        if (!input.description.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Descrição da atividade não pode estar vazia",
          });
        }

        await editActivity(
          input.activityId,
          input.chamadoId,
          input.clientId,
          input.description
        );

        const chamado = await getChamadoWithActivities(input.chamadoId, input.clientId);
        return { chamado };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao editar atividade: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),
});
