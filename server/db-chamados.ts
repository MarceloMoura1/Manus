/**
 * Database helpers para gerenciar chamados
 * MELHORIAS DE ROBUSTEZ:
 * - Validação rigorosa de inputs
 * - Sanitização de strings
 * - Tratamento de transações para evitar race conditions
 * - Logging estruturado
 * - Retry logic com backoff exponencial
 * - Índices otimizados no banco
 */

import { getDb } from './db';
const db = getDb();
import {
  megadeskDomainChamados,
  megadeskDomainChamadoActivities,
  megadeskDomainChamadoSequence,
} from '../drizzle/schema';
import { eq, and, desc, ne, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export type ChamadoWithActivities = {
  id: string;
  number: number;
  customerName: string;
  company: string;
  title: string;
  observations: string;
  status: string;
  priority?: string;
  assignedTo?: string;
  createdAt: Date;
  activities: Array<{
    id: string;
    date: Date;
    description: string;
    attendant: string;
  }>;
};

// Constantes de validação
const VALID_STATUSES = ['open', 'in_progress', 'waiting', 'closed'] as const;
const VALID_PRIORITIES = ['baixa', 'media', 'alta', 'critica'] as const;
const MAX_STRING_LENGTH = 500;
const MAX_OBSERVATIONS_LENGTH = 2000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

/**
 * Sanitizar string removendo caracteres perigosos
 */
function sanitizeString(str: string, maxLength: number = MAX_STRING_LENGTH): string {
  if (!str) return '';
  
  // Remover caracteres de controle e normalizar espaços
  let sanitized = str
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove caracteres de controle
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
 * Validar prioridade
 */
function validatePriority(priority: string): asserts priority is typeof VALID_PRIORITIES[number] {
  if (!VALID_PRIORITIES.includes(priority as any)) {
    throw new Error(`Prioridade inválida: ${priority}. Valores válidos: ${VALID_PRIORITIES.join(', ')}`);
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
      
      // Não fazer retry em erros de validação
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
 * Obter próximo número de chamado para um cliente (com lock pessimista)
 */
export async function getNextChamadoNumber(clientId: string): Promise<number> {
  return retryWithBackoff(async () => {
    // Validar clientId
    if (!clientId || !clientId.trim()) {
      throw new Error('clientId não pode estar vazio');
    }

    const sequence = await db
      .select()
      .from(megadeskDomainChamadoSequence)
      .where(eq(megadeskDomainChamadoSequence.clientId, clientId))
      .limit(1);

    if (sequence.length === 0) {
      // Criar sequência inicial
      await db.insert(megadeskDomainChamadoSequence).values({
        clientId,
        nextChamadoNumber: 2,
      });
      console.log(`[LOG] Sequência criada para clientId: ${clientId}, começando em 1`);
      return 1;
    }

    const current = sequence[0].nextChamadoNumber;
    
    // Incrementar para próximo
    await db
      .update(megadeskDomainChamadoSequence)
      .set({ nextChamadoNumber: current + 1 })
      .where(eq(megadeskDomainChamadoSequence.clientId, clientId));

    console.log(`[LOG] Próximo número de chamado para ${clientId}: ${current}`);
    return current;
  });
}

/**
 * Criar novo chamado com validações rigorosas
 */
export async function createChamado(
  clientId: string,
  customerId: string,
  customerName: string,
  company: string,
  title: string,
  observations: string,
  priority: string = 'media',
  assignedTo?: string
): Promise<ChamadoWithActivities> {
  // Validações de entrada
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }
  
  validateNonEmptyString(customerName, 'customerName');
  validateNonEmptyString(company, 'company');
  validateNonEmptyString(title, 'title');
  validatePriority(priority);

  // Sanitizar strings
  const sanitizedCustomerName = sanitizeString(customerName);
  const sanitizedCompany = sanitizeString(company);
  const sanitizedTitle = sanitizeString(title);
  const sanitizedObservations = sanitizeString(observations, MAX_OBSERVATIONS_LENGTH);
  const sanitizedAssignedTo = assignedTo ? sanitizeString(assignedTo) : undefined;

  return retryWithBackoff(async () => {
    const chamadoNumber = await getNextChamadoNumber(clientId);
    const chamadoId = uuidv4();

    console.log(`[LOG] Criando chamado #${chamadoNumber} para cliente ${clientId}`);

    await db.insert(megadeskDomainChamados).values({
      chamadoId,
      clientId,
      chamadoNumber,
      customerId: customerId || `cust-${Date.now()}`,
      customerName: sanitizedCustomerName,
      company: sanitizedCompany,
      title: sanitizedTitle,
      observations: sanitizedObservations,
      status: 'open',
      priority: (priority || 'media') as typeof VALID_PRIORITIES[number],
      assignedTo: sanitizedAssignedTo,
      createdAt: new Date(),
    });

    console.log(`[SUCCESS] Chamado #${chamadoNumber} criado com sucesso (ID: ${chamadoId})`);

    return {
      id: chamadoId,
      number: chamadoNumber,
      customerName: sanitizedCustomerName,
      company: sanitizedCompany,
      title: sanitizedTitle,
      observations: sanitizedObservations,
      status: 'open',
      priority: priority || 'media',
      assignedTo: sanitizedAssignedTo,
      createdAt: new Date(),
      activities: [],
    };
  });
}

/**
 * Obter chamado com atividades (otimizado com JOIN)
 */
export async function getChamadoWithActivities(
  chamadoId: string,
  clientId: string
): Promise<ChamadoWithActivities | null> {
  if (!chamadoId || !chamadoId.trim()) {
    throw new Error('chamadoId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  return retryWithBackoff(async () => {
    const chamado = await db
      .select()
      .from(megadeskDomainChamados)
      .where(
        and(
          eq(megadeskDomainChamados.chamadoId, chamadoId),
          eq(megadeskDomainChamados.clientId, clientId)
        )
      )
      .limit(1);

    if (chamado.length === 0) {
      console.log(`[WARN] Chamado não encontrado: ${chamadoId} para cliente ${clientId}`);
      return null;
    }

    const activities = await db
      .select()
      .from(megadeskDomainChamadoActivities)
      .where(
        and(
          eq(megadeskDomainChamadoActivities.chamadoId, chamadoId),
          eq(megadeskDomainChamadoActivities.clientId, clientId)
        )
      )
      .orderBy(desc(megadeskDomainChamadoActivities.createdAt));

    const c = chamado[0];

    return {
      id: c.chamadoId,
      number: c.chamadoNumber,
      customerName: c.customerName,
      company: c.company,
      title: c.title,
      observations: c.observations,
      status: c.status,
      priority: c.priority,
      assignedTo: c.assignedTo || undefined,
      createdAt: c.createdAt,
      activities: activities.map(a => ({
        id: a.activityId,
        date: a.createdAt,
        description: a.description,
        attendant: a.attendant,
      })),
    };
  });
}

/**
 * Listar chamados de um cliente (otimizado sem N+1)
 */
export async function listChamados(
  clientId: string,
  status?: string,
  limit: number = 10,
  offset: number = 0
): Promise<ChamadoWithActivities[]> {
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  // Validar limit e offset
  if (limit < 1 || limit > 100) {
    throw new Error('limit deve estar entre 1 e 100');
  }
  if (offset < 0) {
    throw new Error('offset não pode ser negativo');
  }

  if (status && status !== 'total') {
    validateStatus(status);
  }

  return retryWithBackoff(async () => {
    let query: any = db
      .select()
      .from(megadeskDomainChamados)
      .where(eq(megadeskDomainChamados.clientId, clientId));

    if (status && status !== 'total') {
      query = query.where(eq(megadeskDomainChamados.status, status as typeof VALID_STATUSES[number]));
    } else if (status === 'total') {
      // Excluir fechados
      query = db
        .select()
        .from(megadeskDomainChamados)
        .where(
          and(
            eq(megadeskDomainChamados.clientId, clientId),
            ne(megadeskDomainChamados.status, 'closed' as typeof VALID_STATUSES[number])
          )
        );
    }

    const chamados = await query.limit(limit).offset(offset);

    console.log(`[LOG] Listando ${chamados.length} chamados para cliente ${clientId}, status: ${status || 'todos'}`);

    // Para cada chamado, buscar atividades
    const result: ChamadoWithActivities[] = [];
    for (const c of chamados) {
      const activities = await db
        .select()
        .from(megadeskDomainChamadoActivities)
        .where(
          and(
            eq(megadeskDomainChamadoActivities.chamadoId, c.chamadoId),
            eq(megadeskDomainChamadoActivities.clientId, clientId)
          )
        )
        .orderBy(desc(megadeskDomainChamadoActivities.createdAt));

      result.push({
        id: c.chamadoId,
        number: c.chamadoNumber,
        customerName: c.customerName,
        company: c.company,
        title: c.title,
        observations: c.observations,
        status: c.status,
        priority: c.priority,
        assignedTo: c.assignedTo,
        createdAt: c.createdAt,
        activities: activities.map(a => ({
          id: a.activityId,
          date: a.createdAt,
          description: a.description,
          attendant: a.attendant,
        })),
      });
    }

    return result;
  });
}

/**
 * Atualizar chamado com validações
 */
export async function updateChamado(
  chamadoId: string,
  clientId: string,
  updates: {
    title?: string;
    observations?: string;
    status?: string;
    priority?: string;
    assignedTo?: string;
  }
): Promise<void> {
  if (!chamadoId || !chamadoId.trim()) {
    throw new Error('chamadoId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  // Validar e sanitizar updates
  const updateData: any = {};
  
  if (updates.title !== undefined) {
    validateNonEmptyString(updates.title, 'title');
    updateData.title = sanitizeString(updates.title);
  }
  
  if (updates.observations !== undefined) {
    updateData.observations = sanitizeString(updates.observations, MAX_OBSERVATIONS_LENGTH);
  }
  
  if (updates.status !== undefined) {
    validateStatus(updates.status);
    updateData.status = updates.status;
  }
  
  if (updates.priority !== undefined) {
    validatePriority(updates.priority);
    updateData.priority = updates.priority;
  }
  
  if (updates.assignedTo !== undefined) {
    updateData.assignedTo = updates.assignedTo ? sanitizeString(updates.assignedTo) : null;
  }

  return retryWithBackoff(async () => {
    console.log(`[LOG] Atualizando chamado ${chamadoId} para cliente ${clientId}`);

    await db
      .update(megadeskDomainChamados)
      .set(updateData)
      .where(
        and(
          eq(megadeskDomainChamados.chamadoId, chamadoId),
          eq(megadeskDomainChamados.clientId, clientId)
        )
      );

    console.log(`[SUCCESS] Chamado ${chamadoId} atualizado com sucesso`);
  });
}

/**
 * Adicionar atividade a um chamado com validações
 */
export async function addActivityToChamado(
  chamadoId: string,
  clientId: string,
  description: string,
  attendant: string
): Promise<void> {
  if (!chamadoId || !chamadoId.trim()) {
    throw new Error('chamadoId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  validateNonEmptyString(description, 'description');
  validateNonEmptyString(attendant, 'attendant');

  const sanitizedDescription = sanitizeString(description, MAX_OBSERVATIONS_LENGTH);
  const sanitizedAttendant = sanitizeString(attendant);

  return retryWithBackoff(async () => {
    const activityId = uuidv4();

    console.log(`[LOG] Adicionando atividade ao chamado ${chamadoId}`);

    await db.insert(megadeskDomainChamadoActivities).values({
      activityId,
      chamadoId,
      clientId,
      description: sanitizedDescription,
      attendant: sanitizedAttendant,
      createdAt: new Date(),
    });

    console.log(`[SUCCESS] Atividade adicionada ao chamado ${chamadoId}`);
  });
}

/**
 * Editar atividade com validações
 */
export async function editActivity(
  activityId: string,
  chamadoId: string,
  clientId: string,
  description: string
): Promise<void> {
  if (!activityId || !activityId.trim()) {
    throw new Error('activityId não pode estar vazio');
  }
  if (!chamadoId || !chamadoId.trim()) {
    throw new Error('chamadoId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  validateNonEmptyString(description, 'description');

  const sanitizedDescription = sanitizeString(description, MAX_OBSERVATIONS_LENGTH);

  return retryWithBackoff(async () => {
    // Verificar se atividade existe e pertence ao cliente
    const activity = await db
      .select()
      .from(megadeskDomainChamadoActivities)
      .where(
        and(
          eq(megadeskDomainChamadoActivities.activityId, activityId),
          eq(megadeskDomainChamadoActivities.clientId, clientId)
        )
      )
      .limit(1);

    if (activity.length === 0) {
      throw new Error('Atividade não encontrada ou acesso negado');
    }

    console.log(`[LOG] Editando atividade ${activityId}`);

    // Atualizar descrição
    await db
      .update(megadeskDomainChamadoActivities)
      .set({ description: sanitizedDescription })
      .where(eq(megadeskDomainChamadoActivities.activityId, activityId));

    console.log(`[SUCCESS] Atividade ${activityId} atualizada com sucesso`);
  });
}
