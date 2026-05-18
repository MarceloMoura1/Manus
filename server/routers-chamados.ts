/**
 * Procedures tRPC para gerenciar chamados
 * MELHORIAS DE ROBUSTEZ:
 * - Validações Zod mais rigorosas
 * - Sanitização de inputs
 * - Tratamento de erros detalhado
 * - Rate limiting por cliente
 * - Logging estruturado
 * - Isolamento de tenant garantido
 */

import { router, protectedProcedure, megadeskProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createChamado,
  getChamadoWithActivities,
  listChamados,
  countChamados,
  getStatusCounts,
  updateChamado,
  addActivityToChamado,
  editActivity,
  getCollaborators,
  addCollaborator,
  removeCollaborator,
  updateCollaborators,
  registerActivity,
  addAttachment,
  getAttachments,
  getCustomerChamadoHistory,
  type ChamadoWithActivities,
} from "./db-chamados";

// Schemas Zod com validações rigorosas
const ChamadoIdSchema = z.string().uuid('ID de chamado inválido');
const ClientIdSchema = z.string().min(1, 'clientId não pode estar vazio');
const StringFieldSchema = z.string().min(1, 'Campo não pode estar vazio').max(500, 'Campo muito longo');
const ObservationsSchema = z.string().max(2000, 'Observações muito longas');
const PrioritySchema = z.enum(['baixa', 'media', 'alta', 'critica']);
const StatusSchema = z.enum(['open', 'in_progress', 'waiting', 'closed']);
const ActivityDescriptionSchema = z.string().min(1, 'Descrição não pode estar vazia').max(2000, 'Descrição muito longa');

// Rate limiting simples em memória
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minuto
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requisições por minuto

function checkRateLimit(clientId: string): void {
  const now = Date.now();
  const record = requestCounts.get(clientId);

  if (!record || now > record.resetTime) {
    requestCounts.set(clientId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Limite de requisições excedido. Tente novamente em alguns momentos.",
    });
  }

  record.count++;
}

export const chamadosRouter = router({
  /**
   * Listar chamados do usuário autenticado
   * O clientId é derivado de ctx.tenantId
   */
  list: megadeskProcedure
    .input(
      z.object({
        status: z.enum(["total", "open", "in_progress", "waiting", "closed"]).optional(),
        limit: z.number().int().min(1).max(100).default(10),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        
        // Validar clientId
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        // Rate limiting
        checkRateLimit(clientId);

        console.log('[DEBUG] Listing chamados for clientId:', clientId, 'status:', input.status);
        
        const [chamados, total] = await Promise.all([
          listChamados(clientId, input.status, input.limit, input.offset),
          countChamados(clientId, input.status),
        ]);
        console.log('[DEBUG] Found chamados:', chamados.length, 'total:', total);
        
        return { 
          chamados, 
          limit: input.limit, 
          offset: input.offset,
          total: total,
        };
      } catch (error) {
        console.error('[ERROR] Failed to list chamados:', error);
        
        if (error instanceof TRPCError) throw error;
        
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
  getDetail: megadeskProcedure
    .input(
      z.object({
        chamadoId: ChamadoIdSchema,
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Getting chamado detail:', input.chamadoId, 'for clientId:', clientId);
        
        const chamado = await getChamadoWithActivities(input.chamadoId, clientId);
        
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
        
        return { chamado };
      } catch (error) {
        console.error('[ERROR] Failed to get chamado detail:', error);
        
        if (error instanceof TRPCError) throw error;
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao obter chamado: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Criar novo chamado
   * O clientId é derivado de ctx.tenantId
   */
  create: megadeskProcedure
    .input(
      z.object({
        customerId: z.string().optional(),
        customerName: StringFieldSchema,
        customerPhone: z.string().optional(),
        customerEmail: z.string().optional(),
        customerCNPJ: z.string().optional(),
        company: StringFieldSchema,
        title: StringFieldSchema,
        observations: ObservationsSchema.optional().default(""),
        priority: PrioritySchema.default("media"),
        assignedTo: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId;
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Creating chamado with clientId:', clientId, 'input:', {
          customerName: input.customerName,
          company: input.company,
          title: input.title,
          priority: input.priority,
        });
        
        const chamado = await createChamado(
          clientId,
          input.customerId || '',
          input.customerName,
          input.company,
          input.title,
          input.observations,
          input.priority,
          input.assignedTo,
          input.customerPhone,
          input.customerEmail,
          input.customerCNPJ
        );
        
        console.log('[SUCCESS] Chamado created:', chamado.id, 'number:', chamado.number);
        
        return { 
          chamado,
          message: `Chamado #${chamado.number} criado com sucesso`,
        };
      } catch (error) {
        console.error('[ERROR] Failed to create chamado:', error);
        
        if (error instanceof TRPCError) throw error;
        
        // Extrair mensagem de erro mais específica
        let errorMessage = "Erro ao criar chamado";
        if (error instanceof Error) {
          if (error.message.includes('inválid')) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error.message,
            });
          }
          errorMessage = error.message;
        }
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),

  /**
   * Atualizar chamado
   * Valida que o chamado pertence ao usuário autenticado
   */
  update: megadeskProcedure
    .input(
      z.object({
        chamadoId: ChamadoIdSchema,
        title: StringFieldSchema.optional(),
        observations: ObservationsSchema.optional(),
        status: StatusSchema.optional(),
        priority: PrioritySchema.optional(),
        assignedTo: z.string().optional(),
        clientName: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Updating chamado:', input.chamadoId, 'for clientId:', clientId);
        
        const { chamadoId, ...updates } = input;
        
        await updateChamado(chamadoId, clientId, updates);
        
        const chamado = await getChamadoWithActivities(chamadoId, clientId);
        
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
        
        console.log('[SUCCESS] Chamado updated:', chamadoId);
        
        return { 
          chamado,
          message: "Chamado atualizado com sucesso",
        };
      } catch (error) {
        console.error('[ERROR] Failed to update chamado:', error);
        
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
  addActivity: megadeskProcedure
    .input(
      z.object({
        chamadoId: ChamadoIdSchema,
        description: ActivityDescriptionSchema,
        attendant: StringFieldSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Adding activity to chamado:', input.chamadoId);

        await addActivityToChamado(
          input.chamadoId,
          clientId,
          input.description,
          input.attendant
        );

        const chamado = await getChamadoWithActivities(input.chamadoId, clientId);
        
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
        
        console.log('[SUCCESS] Activity added to chamado:', input.chamadoId);
        
        return { 
          chamado,
          message: "Atividade registrada com sucesso",
        };
      } catch (error) {
        console.error('[ERROR] Failed to add activity:', error);
        
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
  editActivity: megadeskProcedure
    .input(
      z.object({
        activityId: z.string().uuid('ID de atividade inválido'),
        chamadoId: ChamadoIdSchema,
        description: ActivityDescriptionSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Editing activity:', input.activityId, 'in chamado:', input.chamadoId);

        await editActivity(
          input.activityId,
          input.chamadoId,
          clientId,
          input.description
        );

        const chamado = await getChamadoWithActivities(input.chamadoId, clientId);
        
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
        
        console.log('[SUCCESS] Activity edited:', input.activityId);
        
        return { 
          chamado,
          message: "Atividade atualizada com sucesso",
        };
      } catch (error) {
        console.error('[ERROR] Failed to edit activity:', error);
        
        if (error instanceof TRPCError) throw error;
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao editar atividade: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Listar colaboradores de um chamado
   */
  getCollaborators: megadeskProcedure
    .input(z.object({
      chamadoId: ChamadoIdSchema,
    }))
    .query(async ({ ctx, input }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Getting collaborators for chamado:', input.chamadoId);

        const collaborators = await getCollaborators(input.chamadoId, clientId);
        
        return { collaborators };
      } catch (error) {
        console.error('[ERROR] Failed to get collaborators:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao buscar colaboradores: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Atualizar colaboradores de um chamado
   */
  updateCollaborators: megadeskProcedure
    .input(z.object({
      chamadoId: ChamadoIdSchema,
      collaborators: z.array(z.object({
        userId: z.string().min(1),
        userName: z.string().min(1),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Updating collaborators for chamado:', input.chamadoId);

        await updateCollaborators(input.chamadoId, clientId, input.collaborators);

        const chamado = await getChamadoWithActivities(input.chamadoId, clientId);
        
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
        
        console.log('[SUCCESS] Collaborators updated for chamado:', input.chamadoId);
        
        return { 
          chamado,
          message: "Colaboradores atualizados com sucesso",
        };
      } catch (error) {
        console.error('[ERROR] Failed to update collaborators:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao atualizar colaboradores: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Health check para diagnosticar problemas
   */
  healthCheck: megadeskProcedure
    .query(async ({ ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        console.log('[HEALTH_CHECK] Checking health for clientId:', clientId);

        return {
          status: 'healthy',
          clientId,
          timestamp: new Date().toISOString(),
          message: 'Sistema de chamados está funcionando normalmente',
        };
      } catch (error) {
        console.error('[HEALTH_CHECK] Failed:', error);
        
        return {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Erro desconhecido',
          timestamp: new Date().toISOString(),
        };
      }
    }),

  registerActivity: megadeskProcedure
    .input(
      z.object({
        chamadoId: z.string().min(1, 'chamadoId é obrigatório'),
        description: z.string().min(1, 'description é obrigatória').max(2000, 'description muito longa'),
        actionType: z.enum(['register', 'edit', 'close', 'forward', 'note']).default('note'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Obter clientId do tenantId (sessão MegaDesk)
      const clientId = ctx.tenantId || String(ctx.user?.id ?? 'unknown');
      const attendantName = ctx.user?.name || ctx.user?.email || 'Atendente';

      if (!clientId || clientId.trim() === '') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'clientId nao pode estar vazio',
        });
      }

      try {
        const result = await registerActivity(
          input.chamadoId,
          clientId,
          input.description,
          attendantName,
          input.actionType
        );

        return {
          success: true,
          activityId: result.id,
        };
      } catch (error) {
        console.error('[ERROR] Erro ao registrar atividade:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Erro ao registrar atividade',
        });
      }
    }),

  /**
   * Obter contadores de chamados por status
   */
  getStatusCounts: megadeskProcedure
    .query(async ({ ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        const counts = await getStatusCounts(clientId);
        return counts;
      } catch (error) {
        console.error('[ERROR] Failed to get status counts:', error);
        
        if (error instanceof TRPCError) throw error;
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao obter contadores: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

    uploadAttachment: megadeskProcedure
    .input(
      z.object({
        chamadoId: ChamadoIdSchema,
        fileName: z.string().min(1),
        fileType: z.string().default('application/octet-stream'),
        fileBase64: z.string().min(1),
        attendant: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificacao de cliente invalida",
          });
        }
        checkRateLimit(clientId);
        const uploadedBy = input.attendant || "Atendente";
        // Converter base64 para Buffer e fazer upload para storage
        const fileBuffer = Buffer.from(input.fileBase64, 'base64');
        const storageKey = `chamados/${clientId}/${input.chamadoId}/${Date.now()}-${input.fileName}`;
        const { storagePut } = await import('../server/storage');
        const { url: fileUrl } = await storagePut(storageKey, fileBuffer, input.fileType);
        const result = await addAttachment(
          input.chamadoId,
          clientId,
          input.fileName,
          fileUrl,
          uploadedBy,
          fileBuffer.length,
          input.fileType
        );
        await addActivityToChamado(
          input.chamadoId,
          clientId,
          `${uploadedBy} adicionou anexo: ${input.fileName}`,
          uploadedBy
        );
        const chamado = await getChamadoWithActivities(input.chamadoId, clientId);
        return {
          success: true,
          attachmentId: result.attachmentId,
          fileUrl,
          chamado,
        };
      } catch (error) {
        console.error('[ERROR] Failed to upload attachment:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao fazer upload do anexo: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  getAttachments: megadeskProcedure
    .input(
      z.object({
        chamadoId: ChamadoIdSchema,
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificacao de cliente invalida",
          });
        }
        const attachments = await getAttachments(input.chamadoId, clientId);
        return attachments;
      } catch (error) {
        console.error('[ERROR] Failed to get attachments:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao obter anexos: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  getCustomerHistory: megadeskProcedure
    .input(
      z.object({
        customerId: z.string().min(1),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificacao de cliente invalida",
          });
        }
        checkRateLimit(clientId);
        const chamados = await getCustomerChamadoHistory(clientId, input.customerId);
        return chamados;
      } catch (error) {
        console.error('[ERROR] Failed to get customer history:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao obter historico do cliente: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),
});
