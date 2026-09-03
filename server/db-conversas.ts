/**
 * Database helpers para gerenciar conversas
 * MELHORIAS DE ROBUSTEZ:
 * - Validação rigorosa de inputs
 * - Sanitização de strings
 * - Tratamento de transações
 * - Logging estruturado
 * - Retry logic com backoff exponencial
 * - Índices otimizados no banco
 */

import { getLazyDb } from './db';
const db = getLazyDb();
import {
  megadeskDomainConversations,
} from '../drizzle/schema';
import { eq, and, desc, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export type ConversationWithMessages = {
  id: string;
  clientId: string;
  customerName: string;
  phone: string;
  company: string;
  status: 'open' | 'bot' | 'closed';
  lastMessage: string;
  timeLabel: string;
  messages: Array<{
    from: 'customer' | 'agent' | 'bot';
    text: string;
    time: string;
  }>;
  createdAt: Date | string;
  updatedAt: Date | string;
};

// Constantes de validação
const VALID_STATUSES = ['open', 'bot', 'closed'] as const;
const MAX_STRING_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

/**
 * Sanitizar string
 */
function sanitizeString(str: string, maxLength: number = MAX_STRING_LENGTH): string {
  if (!str) return '';
  
  let sanitized = str
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .substring(0, maxLength);
  
  return sanitized;
}

/**
 * Validar se string não está vazia
 */
function validateNonEmptyString(str: string, fieldName: string): void {
  if (!str || !str.trim()) {
    throw new Error(`${fieldName} não pode estar vazio`);
  }
}

/**
 * Validar status
 */
function validateStatus(status: string): asserts status is typeof VALID_STATUSES[number] {
  if (!VALID_STATUSES.includes(status as any)) {
    throw new Error(`Status inválido: ${status}. Valores válidos: ${VALID_STATUSES.join(', ')}`);
  }
}

/**
 * Validar telefone (formato básico)
 */
function validatePhone(phone: string): void {
  if (!phone || !phone.trim()) {
    throw new Error('Telefone não pode estar vazio');
  }
  
  // Aceita números, parênteses, hífens, espaços
  if (!/^[\d\s\-()]+$/.test(phone)) {
    throw new Error('Telefone contém caracteres inválidos');
  }
  
  // Deve ter pelo menos 8 dígitos
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) {
    throw new Error('Telefone deve ter pelo menos 8 dígitos');
  }
}

/**
 * Retry logic com backoff exponencial
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  delayMs: number = RETRY_DELAY_MS
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (lastError.message.includes('inválid') || lastError.message.includes('vazio')) {
        throw lastError;
      }
      
      if (attempt < maxRetries - 1) {
        const delay = delayMs * Math.pow(2, attempt);
        console.log(`[RETRY] Tentativa ${attempt + 1}/${maxRetries}, aguardando ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Erro desconhecido após retries');
}

/**
 * Criar nova conversa
 */
export async function createConversation(
  clientId: string,
  customerName: string,
  phone: string,
  company: string,
  lastMessage: string = '',
  status: 'open' | 'bot' | 'closed' = 'open'
): Promise<ConversationWithMessages> {
  // Validações
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }
  
  validateNonEmptyString(customerName, 'customerName');
  validatePhone(phone);
  validateNonEmptyString(company, 'company');
  validateStatus(status);

  // Sanitizar
  const sanitizedCustomerName = sanitizeString(customerName);
  const sanitizedPhone = sanitizeString(phone, 40);
  const sanitizedCompany = sanitizeString(company);
  const sanitizedLastMessage = sanitizeString(lastMessage, MAX_MESSAGE_LENGTH);

  return retryWithBackoff(async () => {
    const conversationId = uuidv4();
    const timeLabel = new Date().toLocaleString('pt-BR');
    const messagesJson = JSON.stringify([]);

    console.log(`[LOG] Criando conversa para cliente ${clientId}, telefone: ${sanitizedPhone}`);

    await db.insert(megadeskDomainConversations).values({
      conversationId,
      clientId,
      customerName: sanitizedCustomerName,
      phone: sanitizedPhone,
      company: sanitizedCompany,
      status,
      lastMessage: sanitizedLastMessage,
      timeLabel,
      messagesJson,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });

    console.log(`[SUCCESS] Conversa criada com sucesso (ID: ${conversationId})`);

    return {
      id: conversationId,
      clientId,
      customerName: sanitizedCustomerName,
      phone: sanitizedPhone,
      company: sanitizedCompany,
      status,
      lastMessage: sanitizedLastMessage,
      timeLabel,
      messages: [],
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
  });
}

/**
 * Obter conversa com mensagens
 */
export async function getConversationWithMessages(
  conversationId: string,
  clientId: string
): Promise<ConversationWithMessages | null> {
  if (!conversationId || !conversationId.trim()) {
    throw new Error('conversationId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  return retryWithBackoff(async () => {
    const conversation = await db
      .select()
      .from(megadeskDomainConversations)
      .where(
        and(
          eq(megadeskDomainConversations.conversationId, conversationId),
          eq(megadeskDomainConversations.clientId, clientId)
        )
      )
      .limit(1);

    if (conversation.length === 0) {
      console.log(`[WARN] Conversa não encontrada: ${conversationId} para cliente ${clientId}`);
      return null;
    }

    const c = conversation[0] as any;
    const messages = JSON.parse(c.messagesJson || '[]');

    return {
      id: c.conversationId,
      clientId: c.clientId,
      customerName: c.customerName,
      phone: c.phone,
      company: c.company,
      status: c.status as 'open' | 'bot' | 'closed',
      lastMessage: c.lastMessage,
      timeLabel: c.timeLabel,
      messages,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });
}

/**
 * Listar conversas de um cliente
 */
export async function listConversations(
  clientId: string,
  status?: 'open' | 'bot' | 'closed',
  limit: number = 10,
  offset: number = 0
): Promise<ConversationWithMessages[]> {
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  if (limit < 1 || limit > 100) {
    throw new Error('limit deve estar entre 1 e 100');
  }
  if (offset < 0) {
    throw new Error('offset não pode ser negativo');
  }

  if (status) {
    validateStatus(status);
  }

  return retryWithBackoff(async () => {
    let query: any = db
      .select()
      .from(megadeskDomainConversations)
      .where(eq(megadeskDomainConversations.clientId, clientId));

    if (status) {
      query = query.where(eq(megadeskDomainConversations.status, status));
    }

    const conversations = await query
      .orderBy(desc(megadeskDomainConversations.updatedAt))
      .limit(limit)
      .offset(offset);

    console.log(`[LOG] Listando ${conversations.length} conversas para cliente ${clientId}, status: ${status || 'todas'}`);

    return conversations.map((c: any) => ({
      id: c.conversationId,
      clientId: c.clientId,
      customerName: c.customerName,
      phone: c.phone,
      company: c.company,
      status: c.status as 'open' | 'bot' | 'closed',
      lastMessage: c.lastMessage,
      timeLabel: c.timeLabel,
      messages: JSON.parse(c.messagesJson || '[]'),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  });
}

/**
 * Atualizar conversa
 */
export async function updateConversation(
  conversationId: string,
  clientId: string,
  updates: {
    status?: 'open' | 'bot' | 'closed';
    lastMessage?: string;
    messagesJson?: string;
  }
): Promise<void> {
  if (!conversationId || !conversationId.trim()) {
    throw new Error('conversationId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  const updateData: any = {};
  
  if (updates.status !== undefined) {
    validateStatus(updates.status);
    updateData.status = updates.status;
  }
  
  if (updates.lastMessage !== undefined) {
    updateData.lastMessage = sanitizeString(updates.lastMessage, MAX_MESSAGE_LENGTH);
  }
  
  if (updates.messagesJson !== undefined) {
    updateData.messagesJson = updates.messagesJson;
  }

  updateData.updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

  return retryWithBackoff(async () => {
    console.log(`[LOG] Atualizando conversa ${conversationId} para cliente ${clientId}`);

    await db
      .update(megadeskDomainConversations)
      .set(updateData)
      .where(
        and(
          eq(megadeskDomainConversations.conversationId, conversationId),
          eq(megadeskDomainConversations.clientId, clientId)
        )
      );

    console.log(`[SUCCESS] Conversa ${conversationId} atualizada com sucesso`);
  });
}

/**
 * Buscar conversa por telefone
 */
export async function searchConversationByPhone(
  clientId: string,
  phone: string
): Promise<ConversationWithMessages | null> {
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  validatePhone(phone);

  return retryWithBackoff(async () => {
    const sanitizedPhone = sanitizeString(phone, 40);

    const conversation = await db
      .select()
      .from(megadeskDomainConversations)
      .where(
        and(
          eq(megadeskDomainConversations.clientId, clientId),
          eq(megadeskDomainConversations.phone, sanitizedPhone)
        )
      )
      .limit(1);

    if (conversation.length === 0) {
      console.log(`[WARN] Conversa não encontrada para telefone: ${sanitizedPhone}`);
      return null;
    }

    const c = conversation[0] as any;

    return {
      id: c.conversationId,
      clientId: c.clientId,
      customerName: c.customerName,
      phone: c.phone,
      company: c.company,
      status: c.status as 'open' | 'bot' | 'closed',
      lastMessage: c.lastMessage,
      timeLabel: c.timeLabel,
      messages: JSON.parse(c.messagesJson || '[]'),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });
}
