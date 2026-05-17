/**
 * Procedures tRPC para gerenciar conversas
 * MELHORIAS DE ROBUSTEZ:
 * - Validações Zod rigorosas
 * - Sanitização de inputs
 * - Tratamento de erros detalhado
 * - Rate limiting por cliente
 * - Logging estruturado
 * - Isolamento de tenant garantido
 */

import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createConversation,
  getConversationWithMessages,
  listConversations,
  updateConversation,
  addMessageToConversation,
  searchConversationByPhone,
  type ConversationWithMessages,
} from "./db-conversas";

// Schemas Zod
const ConversationIdSchema = z.string().uuid('ID de conversa inválido');
const ClientIdSchema = z.string().min(1, 'clientId não pode estar vazio');
const PhoneSchema = z.string().min(8, 'Telefone deve ter pelo menos 8 dígitos').max(40, 'Telefone muito longo');
const StringFieldSchema = z.string().min(1, 'Campo não pode estar vazio').max(500, 'Campo muito longo');
const MessageSchema = z.string().min(1, 'Mensagem não pode estar vazia').max(2000, 'Mensagem muito longa');
const StatusSchema = z.enum(['open', 'bot', 'closed']);

// Rate limiting
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

export const conversasRouter = router({
  /**
   * Listar conversas do usuário autenticado
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["open", "bot", "closed"]).optional(),
        limit: z.number().int().min(1).max(100).default(10),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user.id);
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Listing conversas for clientId:', clientId, 'status:', input.status);
        
        const conversas = await listConversations(clientId, input.status, input.limit, input.offset);
        console.log('[DEBUG] Found conversas:', conversas.length);
        
        return { 
          conversas, 
          limit: input.limit, 
          offset: input.offset,
          total: conversas.length,
        };
      } catch (error) {
        console.error('[ERROR] Failed to list conversas:', error);
        
        if (error instanceof TRPCError) throw error;
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao listar conversas: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Obter detalhes de uma conversa
   */
  getDetail: protectedProcedure
    .input(
      z.object({
        conversationId: ConversationIdSchema,
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user.id);
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Getting conversa detail:', input.conversationId, 'for clientId:', clientId);
        
        const conversa = await getConversationWithMessages(input.conversationId, clientId);
        
        if (!conversa) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversa não encontrada ou acesso negado",
          });
        }
        
        return { conversa };
      } catch (error) {
        console.error('[ERROR] Failed to get conversa detail:', error);
        
        if (error instanceof TRPCError) throw error;
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao obter conversa: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Criar nova conversa
   */
  create: protectedProcedure
    .input(
      z.object({
        customerName: StringFieldSchema,
        phone: PhoneSchema,
        company: StringFieldSchema,
        lastMessage: z.string().max(2000).optional().default(""),
        status: StatusSchema.optional().default("open"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user.id);
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Creating conversa with clientId:', clientId, 'input:', {
          customerName: input.customerName,
          phone: input.phone,
          company: input.company,
        });
        
        const conversa = await createConversation(
          clientId,
          input.customerName,
          input.phone,
          input.company,
          input.lastMessage,
          input.status
        );
        
        console.log('[SUCCESS] Conversa created:', conversa.id);
        
        return { 
          conversa,
          message: `Conversa criada com sucesso`,
        };
      } catch (error) {
        console.error('[ERROR] Failed to create conversa:', error);
        
        if (error instanceof TRPCError) throw error;
        
        let errorMessage = "Erro ao criar conversa";
        if (error instanceof Error) {
          if (error.message.includes('inválid') || error.message.includes('vazio')) {
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
   * Atualizar status da conversa
   */
  updateStatus: protectedProcedure
    .input(
      z.object({
        conversationId: ConversationIdSchema,
        status: StatusSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user.id);
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Updating conversa status:', input.conversationId, 'to:', input.status);
        
        await updateConversation(input.conversationId, clientId, { status: input.status });
        
        const conversa = await getConversationWithMessages(input.conversationId, clientId);
        
        if (!conversa) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversa não encontrada ou acesso negado",
          });
        }
        
        console.log('[SUCCESS] Conversa status updated:', input.conversationId);
        
        return { 
          conversa,
          message: "Status da conversa atualizado com sucesso",
        };
      } catch (error) {
        console.error('[ERROR] Failed to update conversa status:', error);
        
        if (error instanceof TRPCError) throw error;
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao atualizar conversa: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Adicionar mensagem a uma conversa
   */
  addMessage: protectedProcedure
    .input(
      z.object({
        conversationId: ConversationIdSchema,
        from: z.enum(['customer', 'agent', 'bot']),
        text: MessageSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user.id);
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Adding message to conversa:', input.conversationId);

        await addMessageToConversation(
          input.conversationId,
          clientId,
          input.from,
          input.text
        );

        const conversa = await getConversationWithMessages(input.conversationId, clientId);
        
        if (!conversa) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversa não encontrada ou acesso negado",
          });
        }
        
        console.log('[SUCCESS] Message added to conversa:', input.conversationId);
        
        return { 
          conversa,
          message: "Mensagem registrada com sucesso",
        };
      } catch (error) {
        console.error('[ERROR] Failed to add message:', error);
        
        if (error instanceof TRPCError) throw error;
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao adicionar mensagem: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Buscar conversa por telefone
   */
  searchByPhone: protectedProcedure
    .input(
      z.object({
        phone: PhoneSchema,
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user.id);
        
        if (!clientId || clientId.trim() === '') {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Identificação de cliente inválida",
          });
        }

        checkRateLimit(clientId);

        console.log('[DEBUG] Searching conversa by phone:', input.phone);
        
        const conversa = await searchConversationByPhone(clientId, input.phone);
        
        return { 
          conversa,
          found: conversa !== null,
        };
      } catch (error) {
        console.error('[ERROR] Failed to search conversa:', error);
        
        if (error instanceof TRPCError) throw error;
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Erro ao buscar conversa: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
        });
      }
    }),

  /**
   * Health check
   */
  healthCheck: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const clientId = ctx.tenantId || String(ctx.user.id);
        
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
          message: 'Sistema de conversas está funcionando normalmente',
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
});
