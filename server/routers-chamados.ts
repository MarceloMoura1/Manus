/**
 * Procedures tRPC para gerenciar chamados
 * Importar em routers.ts e adicionar ao appRouter
 * AUTENTICADO: Todas as procedures usam protectedProcedure e derivam clientId de ctx.user
 */

import { router, protectedProcedure } from "./_core/trpc";
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
   * Listar chamados do usuário autenticado
   * O clientId é derivado de ctx.user.id
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["total", "open", "in_progress", "waiting", "closed"]).optional(),
        limit: z.number().default(10),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const chamados = await listChamados(String(ctx.user.id), input.status, input.limit, input.offset);
        return { chamados, limit: input.limit, offset: input.offset };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao listar chamados: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Obter detalhes de um chamado com atividades
   * Valida que o chamado pertence ao usuário autenticado
   */
  getDetail: protectedProcedure
    .input(
      z.object({
        chamadoId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const chamado = await getChamadoWithActivities(input.chamadoId, String(ctx.user.id));
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
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
   * O clientId é derivado de ctx.user.id
   */
  create: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        customerName: z.string(),
        company: z.string(),
        title: z.string(),
        observations: z.string().default(""),
        priority: z.enum(["baixa", "media", "alta", "critica"]).default("media"),
        assignedTo: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const chamado = await createChamado(
          String(ctx.user.id),
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
   * Valida que o chamado pertence ao usuário autenticado
   */
  update: protectedProcedure
    .input(
      z.object({
        chamadoId: z.string(),
        title: z.string().optional(),
        observations: z.string().optional(),
        status: z.enum(["open", "in_progress", "waiting", "closed"]).optional(),
        priority: z.enum(["baixa", "media", "alta", "critica"]).optional(),
        assignedTo: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { chamadoId, ...updates } = input;
        await updateChamado(chamadoId, String(ctx.user.id), updates);
        const chamado = await getChamadoWithActivities(chamadoId, String(ctx.user.id));
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
        return { chamado };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao atualizar chamado: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Adicionar atividade a um chamado
   * Valida que o chamado pertence ao usuário autenticado
   */
  addActivity: protectedProcedure
    .input(
      z.object({
        chamadoId: z.string(),
        description: z.string(),
        attendant: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (!input.description.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Descrição da atividade não pode estar vazia",
          });
        }

        await addActivityToChamado(
          input.chamadoId,
          String(ctx.user.id),
          input.description,
          input.attendant
        );

        const chamado = await getChamadoWithActivities(input.chamadoId, String(ctx.user.id));
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
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
   * Valida que o chamado pertence ao usuário autenticado
   */
  editActivity: protectedProcedure
    .input(
      z.object({
        activityId: z.string(),
        chamadoId: z.string(),
        description: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
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
          String(ctx.user.id),
          input.description
        );

        const chamado = await getChamadoWithActivities(input.chamadoId, String(ctx.user.id));
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
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
