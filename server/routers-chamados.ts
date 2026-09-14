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
import { randomUUID } from "node:crypto";
import {
  createChamadoWithActivity,
  getChamadoWithActivities,
  listChamados,
  countChamados,
  getStatusCounts,
  updateChamadoWithActivity,
  editActivity,
  getCollaborators,
  addCollaborator,
  removeCollaborator,
  updateCollaboratorsWithActivities,
  registerManualTicketActivity,
  uploadTicketAttachment,
  listTicketAttachments,
  logicallyRemoveTicketAttachment,
  TicketAttachmentError,
  getCustomerChamadoHistory,
  getActiveClientUser,
  type ChamadoWithActivities,
  type TicketScope,
  type TicketSortDirection,
  type TicketSortKey,
} from "./db-chamados";
import { getCrmClientById, listCrmClients } from "./db-crm";

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

type TicketCustomerSnapshot = {
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerCNPJ?: string | null;
  company?: string | null;
};

type CanonicalTicketCustomer = {
  crmClientId: string;
  customerType?: "person" | "company" | null;
  companyName?: string | null;
  responsibleName?: string | null;
  cpfCnpj?: string | null;
  phone?: string | null;
  email?: string | null;
};

export function resolveTicketDetailCustomer(
  chamado: TicketCustomerSnapshot,
  canonicalCustomer: CanonicalTicketCustomer | null,
) {
  if (canonicalCustomer) {
    return {
      id: canonicalCustomer.crmClientId,
      type: canonicalCustomer.customerType ?? null,
      name: canonicalCustomer.companyName?.trim() || canonicalCustomer.responsibleName?.trim() || null,
      document: canonicalCustomer.cpfCnpj || null,
      phone: canonicalCustomer.phone || null,
      email: canonicalCustomer.email || null,
      source: "erp" as const,
    };
  }

  return {
    id: chamado.customerId || null,
    type: null,
    name: chamado.customerName?.trim() || chamado.company?.trim() || null,
    document: chamado.customerCNPJ || null,
    phone: chamado.customerPhone || null,
    email: chamado.customerEmail || null,
    source: "snapshot" as const,
  };
}

/**
 * Activities retain a display-name snapshot, so resolve that snapshot from the
 * canonical operational identity instead of accepting an author supplied by
 * the browser. The lookup is constrained to the active tenant.
 */
async function requireCanonicalActivityActor(clientId: string, operationalUserId?: string) {
  const author = await getActiveClientUser(clientId, operationalUserId ?? "");
  if (!author) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Não foi possível identificar o autor da atividade neste tenant.",
    });
  }

  return author;
}

export const chamadosRouter = router({
  /**
   * Busca clientes canônicos do ERP para abertura de chamado.
   * O tenant vem exclusivamente da sessão; nenhum clientId do navegador é aceito.
   */
  searchCustomers: megadeskProcedure
    .input(z.object({ query: z.string().trim().min(2).max(120) }).strict())
    .query(async ({ input, ctx }) => {
      const digits = input.query.replace(/\D/g, "");
      const searchTerms = digits.length >= 3 && digits !== input.query ? [input.query, digits] : [input.query];
      const matches = (await Promise.all(searchTerms.map(term => listCrmClients(ctx.tenantId, term, "active")))).flat();
      const clients = [...new Map(matches.map(client => [client.crmClientId, client])).values()];
      return {
        customers: clients.slice(0, 10).map(client => ({
          id: client.crmClientId,
          type: client.customerType,
          name: client.companyName,
          responsibleName: client.responsibleName,
          document: client.cpfCnpj,
          phone: client.phone,
        })),
      };
    }),

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
        scope: z.enum(['all', 'mine']).default('all'),
        search: z.string().trim().max(180).optional(),
        sortBy: z.enum(['number', 'createdAt', 'customer', 'title', 'assignee', 'priority', 'status']).default('createdAt'),
        sortDirection: z.enum(['asc', 'desc']).default('desc'),
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

        if (process.env.NODE_ENV === 'development') console.log('[DEBUG] Listing chamados for clientId:', clientId, 'status:', input.status);
        
        const [chamados, total] = await Promise.all([
          listChamados(clientId, input.status, input.limit, input.offset, {
            scope: input.scope as TicketScope,
            operationalUserId: ctx.operationalUserId ?? '',
            search: input.search,
            sortBy: input.sortBy as TicketSortKey,
            sortDirection: input.sortDirection as TicketSortDirection,
          }),
          countChamados(clientId, input.status, {
            scope: input.scope as TicketScope,
            operationalUserId: ctx.operationalUserId ?? '',
            search: input.search,
          }),
        ]);
        if (process.env.NODE_ENV === 'development') console.log('[DEBUG] Found chamados:', chamados.length, 'total:', total);
        
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
        const clientId = ctx.tenantId;
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        if (process.env.NODE_ENV === 'development') console.log('[DEBUG] Getting chamado detail:', input.chamadoId, 'for clientId:', clientId);
        
        const chamado = await getChamadoWithActivities(input.chamadoId, clientId);
        
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
        
        const canonicalCustomer = chamado.customerId
          ? await getCrmClientById(chamado.customerId, clientId)
          : null;

        return {
          chamado: {
            ...chamado,
            customer: resolveTicketDetailCustomer(chamado, canonicalCustomer),
          },
        };
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
        customerId: z.string().trim().min(1, "Selecione um cliente").max(80),
        title: StringFieldSchema,
        observations: ObservationsSchema.optional().default(""),
        priority: PrioritySchema.default("media"),
        assignedToUserId: z.string().max(80).optional(),
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

        const customer = await getCrmClientById(input.customerId, clientId);
        if (!customer || customer.lifecycleState !== "active") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cliente não encontrado no ERP ou não pertence a este ambiente.",
          });
        }

        const canonicalName = customer.companyName.trim();
        const customerName = customer.customerType === "company" && customer.responsibleName.trim()
          ? customer.responsibleName.trim()
          : canonicalName;

        if (process.env.NODE_ENV === 'development') console.log('[DEBUG] Creating chamado with clientId:', clientId, 'input:', {
          customerId: customer.crmClientId,
          title: input.title,
          priority: input.priority,
        });
        
        const creator = await getActiveClientUser(clientId, ctx.operationalUserId ?? '');
        if (!creator) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Não foi possível identificar o atendente criador do chamado.",
          });
        }

        const chamado = await createChamadoWithActivity({
          clientId,
          customerId: customer.crmClientId,
          customerName,
          company: canonicalName,
          title: input.title,
          observations: input.observations,
          priority: input.priority,
          assignedTo: creator.userName,
          assignedToUserId: creator.userId,
          customerPhone: customer.phone ?? null,
          customerEmail: customer.email ?? null,
          customerCNPJ: customer.cpfCnpj ?? null,
          actor: creator,
        });
        
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
        assignedToUserId: z.string().max(80).optional(),
        customerId: z.string().trim().min(1, "Selecione um cliente").max(80).optional(),
        forwardObservation: ObservationsSchema.optional(),
      }).strict()
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

        if (process.env.NODE_ENV === 'development') console.log('[DEBUG] Updating chamado:', input.chamadoId, 'for clientId:', clientId);
        
        const { chamadoId, assignedToUserId, customerId, forwardObservation, ...updates } = input;
        const assignedTo = assignedToUserId === undefined
          ? undefined
          : await getActiveClientUser(clientId, assignedToUserId);
        if (assignedToUserId !== undefined && !assignedTo) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Atendente responsável inválido para este tenant." });
        }

        const customer = customerId === undefined ? null : await getCrmClientById(customerId, clientId);
        if (customerId !== undefined && (!customer || customer.lifecycleState !== "active")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Cliente não encontrado no ERP ou não pertence a este ambiente.",
          });
        }

        const canonicalName = customer?.companyName.trim();
        const customerName = customer && customer.customerType === "company" && customer.responsibleName.trim()
          ? customer.responsibleName.trim()
          : canonicalName;

        const actor = await requireCanonicalActivityActor(clientId, ctx.operationalUserId);
        const mode = assignedToUserId !== undefined
          ? 'forward'
          : updates.status !== undefined
            ? 'status'
            : 'edit';
        await updateChamadoWithActivity({
          chamadoId,
          clientId,
          actor,
          mode,
          updates: {
          ...updates,
          ...(customer && canonicalName && customerName ? {
            customerId: customer.crmClientId,
            customerName,
            customerPhone: customer.phone ?? null,
            customerEmail: customer.email ?? null,
            customerCNPJ: customer.cpfCnpj ?? null,
            company: canonicalName,
          } : {}),
          assignedTo: assignedTo?.userName,
          assignedToUserId: assignedTo?.userId,
            forwardObservation,
          },
        });
        
        const chamado = await getChamadoWithActivities(chamadoId, clientId);
        
        if (!chamado) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chamado não encontrado ou acesso negado",
          });
        }
        
        const canonicalCustomer = customer ?? (chamado.customerId
          ? await getCrmClientById(chamado.customerId, clientId)
          : null);

        console.log('[SUCCESS] Chamado updated:', chamadoId);
        
        return { 
          chamado: {
            ...chamado,
            customer: resolveTicketDetailCustomer(chamado, canonicalCustomer),
          },
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
        const actor = await requireCanonicalActivityActor(clientId, ctx.operationalUserId);

        if (process.env.NODE_ENV === 'development') console.log('[DEBUG] Adding activity to chamado:', input.chamadoId);

        await registerManualTicketActivity({
          chamadoId: input.chamadoId,
          clientId,
          description: input.description,
          actor,
        });

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

        if (process.env.NODE_ENV === 'development') console.log('[DEBUG] Editing activity:', input.activityId, 'in chamado:', input.chamadoId);

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

        if (process.env.NODE_ENV === 'development') console.log('[DEBUG] Getting collaborators for chamado:', input.chamadoId);

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

        if (process.env.NODE_ENV === 'development') console.log('[DEBUG] Updating collaborators for chamado:', input.chamadoId);

        const actor = await requireCanonicalActivityActor(clientId, ctx.operationalUserId);
        await updateCollaboratorsWithActivities({
          chamadoId: input.chamadoId,
          clientId,
          collaboratorIds: input.collaborators.map(collaborator => collaborator.userId),
          actor,
        });

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

      if (!clientId || clientId.trim() === '') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'clientId nao pode estar vazio',
        });
      }

      try {
        const actor = await requireCanonicalActivityActor(clientId, ctx.operationalUserId);
        const result = await registerManualTicketActivity({
          chamadoId: input.chamadoId,
          clientId,
          description: input.description,
          actor,
        });

        return {
          success: true,
          activityId: result.id,
          chamado: await getChamadoWithActivities(input.chamadoId, clientId),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
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
    .input(z.object({ scope: z.enum(['all', 'mine']).default('all') }).default({ scope: 'all' }))
    .query(async ({ ctx, input }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        const counts = await getStatusCounts(clientId, input.scope as TicketScope, ctx.operationalUserId ?? '');
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
        clientAttemptId: z.string().uuid().optional(),
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
        const actor = await requireCanonicalActivityActor(clientId, ctx.operationalUserId);
        const result = await uploadTicketAttachment({
          chamadoId: input.chamadoId,
          clientId,
          actor,
          clientAttemptId: input.clientAttemptId ?? randomUUID(),
          fileName: input.fileName,
          declaredMimeType: input.fileType,
          fileBase64: input.fileBase64,
        });
        const chamado = await getChamadoWithActivities(input.chamadoId, clientId);
        return {
          success: true,
          attachmentId: result.attachmentId,
          reused: result.reused,
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
        const attachments = await listTicketAttachments(input.chamadoId, clientId);
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

  removeAttachment: megadeskProcedure
    .input(z.object({ chamadoId: ChamadoIdSchema, attachmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const clientId = ctx.tenantId || String(ctx.user?.id ?? "unknown");
      if (!clientId || clientId.trim() === "") throw new TRPCError({ code: "UNAUTHORIZED", message: "Identificação de cliente inválida" });
      checkRateLimit(clientId);
      const actor = await requireCanonicalActivityActor(clientId, ctx.operationalUserId);
      try {
        const result = await logicallyRemoveTicketAttachment({ ...input, clientId, actor });
        const chamado = await getChamadoWithActivities(input.chamadoId, clientId);
        return { ...result, chamado };
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "ATTACHMENT_NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado." });
        if (code === "ATTACHMENT_NOT_REMOVABLE" || code === "ATTACHMENT_REMOVE_CONFLICT") {
          throw new TRPCError({ code: "CONFLICT", message: "Anexo não está disponível para remoção." });
        }
        throw error;
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
