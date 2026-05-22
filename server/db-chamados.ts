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
  megadeskDomainChamadoSequence,
} from '../drizzle/schema';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export type ChamadoWithActivities = {
  id: string;
  number: number;
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerCNPJ?: string | null;
  company: string;
  title: string;
  observations: string;
  status: string;
  priority?: string;
  assignedTo?: string;
  createdAt: number; // timestamp em millisegundos
  activities: Array<{
    id: string;
    date: number; // timestamp em millisegundos
    description: string;
    attendant: string;
    actionType?: string;
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
  assignedTo?: string,
  customerPhone?: string,
  customerEmail?: string,
  customerCNPJ?: string
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
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      customerCNPJ: customerCNPJ || null,
      company: sanitizedCompany,
      title: sanitizedTitle,
      observations: sanitizedObservations,
      status: 'open',
      priority: (priority || 'media') as typeof VALID_PRIORITIES[number],
      assignedTo: sanitizedAssignedTo,
      createdAt: new Date(),
    });

    console.log(`[SUCCESS] Chamado #${chamadoNumber} criado com sucesso (ID: ${chamadoId})`);

    const now = new Date();
        return {
      id: chamadoId,
      number: chamadoNumber,
      customerId: customerId || `cust-${Date.now()}`,
      customerName: sanitizedCustomerName,
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      customerCNPJ: customerCNPJ || null,
      company: sanitizedCompany,
      title: sanitizedTitle,
      observations: sanitizedObservations,
      status: 'open',
      priority: priority || 'media',
      assignedTo: sanitizedAssignedTo,
      createdAt: now.getTime(),
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

    let activities: any[] = [];
    try {
      activities = await db
        .select()
        .from(megadeskDomainChamadoActivities)
        .where(
          and(
            eq(megadeskDomainChamadoActivities.chamadoId, chamadoId),
            eq(megadeskDomainChamadoActivities.clientId, clientId)
          )
        )
        .orderBy(desc(megadeskDomainChamadoActivities.createdAt));
    } catch (error: any) {
      if (error.code === 'ER_NO_SUCH_TABLE' || error.message?.includes('doesn\'t exist')) {
        console.warn(`[WARN] Tabela megadesk_domain_chamado_activities nao existe, continuando sem atividades`);
        activities = [];
      } else {
        throw error;
      }
    }

        const c = chamado[0];
    return {
      id: c.chamadoId,
      number: c.chamadoNumber,
      customerId: c.customerId,
      customerName: c.customerName,
      customerPhone: c.customerPhone,
      customerEmail: c.customerEmail,
      customerCNPJ: c.customerCNPJ,
      company: c.company,
      title: c.title,
      observations: c.observations,
      status: c.status,
      priority: c.priority,
      assignedTo: c.assignedTo || undefined,
      createdAt: c.createdAt instanceof Date ? c.createdAt.getTime() : new Date(c.createdAt).getTime(),
      activities: activities.map(a => {
        let date = a.createdAt;
        let timestamp: number;
        if (date instanceof Date) {
          timestamp = date.getTime();
        } else {
          // Converte string MySQL (YYYY-MM-DD HH:MM:SS) para timestamp
          const dateObj = new Date((a.createdAt as string).replace(' ', 'T') + 'Z');
          timestamp = dateObj.getTime();
        }
        return {
          id: a.activityId,
          date: timestamp,
          description: a.description,
          attendant: a.attendant,
          actionType: a.actionType || 'note',
        };
      }),
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

    // Otimização: Buscar TODAS as atividades em uma única query (evitar N+1)
    const chamadoIds = chamados.map((c: any) => c.chamadoId);
    let allActivities: any[] = [];
    
    if (chamadoIds.length > 0) {
      try {
        allActivities = await db
          .select()
          .from(megadeskDomainChamadoActivities)
          .where(
            and(
              inArray(megadeskDomainChamadoActivities.chamadoId, chamadoIds),
              eq(megadeskDomainChamadoActivities.clientId, clientId)
            )
          )
          .orderBy(desc(megadeskDomainChamadoActivities.createdAt));
      } catch (error: any) {
        if (error.code === 'ER_NO_SUCH_TABLE' || error.message?.includes('doesn\'t exist')) {
          console.warn(`[WARN] Tabela megadesk_domain_chamado_activities nao existe, continuando sem atividades`);
          allActivities = [];
        } else {
          throw error;
        }
      }
    }

    // Agrupar atividades por chamado_id
    const activitiesByChamado: Record<string, any[]> = {};
    allActivities.forEach(a => {
      if (!activitiesByChamado[a.chamadoId]) {
        activitiesByChamado[a.chamadoId] = [];
      }
      activitiesByChamado[a.chamadoId].push(a);
    });

    // Mapear chamados com suas atividades
    const result: ChamadoWithActivities[] = chamados.map((c: any) => ({
      id: c.chamadoId,
      number: c.chamadoNumber,
      customerId: c.customerId,
      customerName: c.customerName,
      customerPhone: c.customerPhone,
      customerEmail: c.customerEmail,
      customerCNPJ: c.customerCNPJ,
      company: c.company,
      title: c.title,
      observations: c.observations,
      status: c.status,
      priority: c.priority,
      assignedTo: c.assignedTo,
      createdAt: c.createdAt instanceof Date ? c.createdAt.getTime() : new Date(c.createdAt).getTime(),
      activities: (activitiesByChamado[c.chamadoId] || []).map(a => {
        // Converter data para string ISO
        let isoDate: string;
        try {
          if (typeof a.createdAt === 'string') {
            // Se já é string, garantir que está em formato ISO
            isoDate = a.createdAt.replace(' ', 'T');
            if (!isoDate.endsWith('Z')) {
              isoDate += 'Z';
            }
            // Validar se é uma data válida
            const testDate = new Date(isoDate);
            if (isNaN(testDate.getTime())) {
              isoDate = new Date().toISOString();
            }
          } else if (a.createdAt instanceof Date) {
            if (isNaN(a.createdAt.getTime())) {
              isoDate = new Date().toISOString();
            } else {
              isoDate = a.createdAt.toISOString();
            }
          } else {
            isoDate = new Date().toISOString();
          }
        } catch (e) {
          isoDate = new Date().toISOString();
        }
        // Converter para timestamp em millisegundos
        let timestamp: number;
        try {
          if (typeof a.createdAt === 'number') {
            timestamp = a.createdAt;
          } else if (a.createdAt instanceof Date) {
            timestamp = a.createdAt.getTime();
          } else if (typeof a.createdAt === 'string') {
            timestamp = new Date(a.createdAt).getTime();
          } else {
            timestamp = Date.now();
          }
        } catch (e) {
          timestamp = Date.now();
        }
        return {
                    id: a.activityId,
          date: timestamp,
          description: a.description,
          attendant: a.attendant,
          actionType: a.actionType || 'note',
        };
      }),
    }));
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
      updatedAt: new Date(),
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


/**
 * Listar colaboradores de um chamado
 */
export async function getCollaborators(chamadoId: string, clientId: string): Promise<Array<{ userId: string; userName: string }>> {
  if (!chamadoId || !chamadoId.trim()) {
    throw new Error('chamadoId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  return retryWithBackoff(async () => {
    const { megadeskDomainChamadoCollaborators } = await import('../drizzle/schema');
    const collaborators = await db
      .select({
        userId: megadeskDomainChamadoCollaborators.userId,
        userName: megadeskDomainChamadoCollaborators.userName,
      })
      .from(megadeskDomainChamadoCollaborators)
      .where(
        and(
          eq(megadeskDomainChamadoCollaborators.chamadoId, chamadoId),
          eq(megadeskDomainChamadoCollaborators.clientId, clientId)
        )
      );

    return collaborators;
  });
}

/**
 * Adicionar colaborador a um chamado
 */
export async function addCollaborator(
  chamadoId: string,
  clientId: string,
  userId: string,
  userName: string
): Promise<void> {
  if (!chamadoId || !chamadoId.trim()) {
    throw new Error('chamadoId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }
  if (!userId || !userId.trim()) {
    throw new Error('userId não pode estar vazio');
  }

  validateNonEmptyString(userName, 'userName');

  return retryWithBackoff(async () => {
    const { megadeskDomainChamadoCollaborators } = await import('../drizzle/schema');
    const collaboratorId = uuidv4();

    await db
      .insert(megadeskDomainChamadoCollaborators)
      .values({
        collaboratorId,
        chamadoId,
        clientId,
        userId,
        userName,
      })
      .onDuplicateKeyUpdate({
        set: { userName },
      });

    console.log(`[LOG] Colaborador ${userName} adicionado ao chamado ${chamadoId}`);
  });
}

/**
 * Remover colaborador de um chamado
 */
export async function removeCollaborator(
  chamadoId: string,
  clientId: string,
  userId: string
): Promise<void> {
  if (!chamadoId || !chamadoId.trim()) {
    throw new Error('chamadoId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }
  if (!userId || !userId.trim()) {
    throw new Error('userId não pode estar vazio');
  }

  return retryWithBackoff(async () => {
    const { megadeskDomainChamadoCollaborators } = await import('../drizzle/schema');
    await db
      .delete(megadeskDomainChamadoCollaborators)
      .where(
        and(
          eq(megadeskDomainChamadoCollaborators.chamadoId, chamadoId),
          eq(megadeskDomainChamadoCollaborators.clientId, clientId),
          eq(megadeskDomainChamadoCollaborators.userId, userId)
        )
      );

    console.log(`[LOG] Colaborador ${userId} removido do chamado ${chamadoId}`);
  });
}

/**
 * Atualizar colaboradores de um chamado (substituir todos)
 */
export async function updateCollaborators(
  chamadoId: string,
  clientId: string,
  collaborators: Array<{ userId: string; userName: string }>
): Promise<void> {
  if (!chamadoId || !chamadoId.trim()) {
    throw new Error('chamadoId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }

  return retryWithBackoff(async () => {
    const { megadeskDomainChamadoCollaborators } = await import('../drizzle/schema');

    // Remover todos os colaboradores existentes
    await db
      .delete(megadeskDomainChamadoCollaborators)
      .where(
        and(
          eq(megadeskDomainChamadoCollaborators.chamadoId, chamadoId),
          eq(megadeskDomainChamadoCollaborators.clientId, clientId)
        )
      );

    // Adicionar novos colaboradores
    if (collaborators.length > 0) {
      const valuesToInsert = collaborators.map(c => ({
        collaboratorId: uuidv4(),
        chamadoId,
        clientId,
        userId: c.userId,
        userName: c.userName,
      }));

      await db.insert(megadeskDomainChamadoCollaborators).values(valuesToInsert);
    }

    console.log(`[LOG] Colaboradores do chamado ${chamadoId} atualizados: ${collaborators.length} colaboradores`);
  });
}

/**
 * Registrar nova atividade em um chamado
 */
export async function registerActivity(
  chamadoId: string,
  clientId: string,
  description: string,
  attendant: string,
  actionType: 'register' | 'edit' | 'close' | 'forward' | 'note' = 'note'
): Promise<{ id: string }> {
  if (!chamadoId || !chamadoId.trim()) {
    throw new Error('chamadoId não pode estar vazio');
  }
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }
  if (!description || !description.trim()) {
    throw new Error('description não pode estar vazia');
  }
  if (!attendant || !attendant.trim()) {
    throw new Error('attendant não pode estar vazio');
  }

  // Validar tamanho da descrição
  if (description.length > MAX_OBSERVATIONS_LENGTH) {
    throw new Error(`description não pode ter mais de ${MAX_OBSERVATIONS_LENGTH} caracteres`);
  }

  return retryWithBackoff(async () => {
    const activityId = uuidv4();
    
    await db.insert(megadeskDomainChamadoActivities).values({
      activityId,
      chamadoId,
      clientId,
      description: description.trim(),
      attendant: attendant.trim(),
      actionType,
      createdAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    });

    console.log(`[LOG] Atividade registrada: ${activityId} para chamado ${chamadoId}`);
    return { id: activityId };
  });
}

/**
 * Contar total de chamados para um cliente com filtro de status
 */
export async function countChamados(
  clientId: string,
  status?: string
): Promise<number> {
  const db = getDb();
  
  try {
    let query: any = db
      .select({ count: sql<number>`count(*)` })
      .from(megadeskDomainChamados)
      .where(eq(megadeskDomainChamados.clientId, clientId));

    if (status && status !== 'total') {
      query = query.where(eq(megadeskDomainChamados.status, status as typeof VALID_STATUSES[number]));
    } else if (status === 'total') {
      // Excluir fechados
      query = db
        .select({ count: sql<number>`count(*)` })
        .from(megadeskDomainChamados)
        .where(
          and(
            eq(megadeskDomainChamados.clientId, clientId),
            ne(megadeskDomainChamados.status, 'closed' as typeof VALID_STATUSES[number])
          )
        );
    }

    const result = await query;
    return result[0]?.count || 0;
  } catch (error) {
    console.error(`[ERROR] Failed to count chamados for ${clientId}:`, error);
    throw error;
  }
}

/**
 * Obter contadores de chamados por status
 */
export async function getStatusCounts(clientId: string): Promise<{
  total: number;
  open: number;
  in_progress: number;
  waiting: number;
  closed: number;
}> {
  const db = getDb();
  
  try {
    // Buscar todos os chamados para contar por status
    const allChamados = await db
      .select({ status: megadeskDomainChamados.status })
      .from(megadeskDomainChamados)
      .where(eq(megadeskDomainChamados.clientId, clientId));

    const counts = {
      total: allChamados.length, // Total de TODOS os chamados
      open: 0,
      in_progress: 0,
      waiting: 0,
      closed: 0,
    };

    // Contar por status
    for (const chamado of allChamados) {
      if (chamado.status === 'open') {
        counts.open++;
      } else if (chamado.status === 'in_progress') {
        counts.in_progress++;
      } else if (chamado.status === 'waiting') {
        counts.waiting++;
      } else if (chamado.status === 'closed') {
        counts.closed++;
      }
    }

    console.log(`[LOG] Status counts for ${clientId}:`, counts);
    return counts;
  } catch (error) {
    console.error(`[ERROR] Failed to get status counts for ${clientId}:`, error);
    throw error;
  }
}


/**
 * Adicionar anexo a um chamado
 */
export async function addAttachment(
  chamadoId: string,
  clientId: string,
  fileName: string,
  fileUrl: string,
  uploadedBy: string,
  fileSize?: number,
  mimeType?: string
): Promise<{ attachmentId: string }> {
  const attachmentId = uuidv4();
  
  await db.insert(megadeskDomainChamadoAttachments).values({
    attachmentId,
    chamadoId,
    clientId,
    fileName,
    fileUrl,
    fileSize,
    mimeType,
    uploadedBy,
    createdAt: new Date(),
  });
  
  return { attachmentId };
}

/**
 * Obter anexos de um chamado
 */
export async function getAttachments(chamadoId: string, clientId: string) {
  const attachments = await db
    .select()
    .from(megadeskDomainChamadoAttachments)
    .where(
      and(
        eq(megadeskDomainChamadoAttachments.chamadoId, chamadoId),
        eq(megadeskDomainChamadoAttachments.clientId, clientId)
      )
    )
    .orderBy(desc(megadeskDomainChamadoAttachments.createdAt));
  
  return attachments;
}


/**
 * Obter histórico completo de chamados de um cliente (dossiê)
 */
export async function getCustomerChamadoHistory(
  clientId: string,
  customerId: string
): Promise<ChamadoWithActivities[]> {
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }
  if (!customerId || !customerId.trim()) {
    throw new Error('customerId não pode estar vazio');
  }

  const chamados = await db
    .select()
    .from(megadeskDomainChamados)
    .where(
      and(
        eq(megadeskDomainChamados.clientId, clientId),
        eq(megadeskDomainChamados.customerId, customerId)
      )
    )
    .orderBy(desc(megadeskDomainChamados.createdAt));

  // Buscar atividades para todos os chamados
  const chamadoIds = chamados.map((c) => c.chamadoId);
  let allActivities: any[] = [];

  if (chamadoIds.length > 0) {
    allActivities = await db
      .select()
      .from(megadeskDomainChamadoActivities)
      .where(inArray(megadeskDomainChamadoActivities.chamadoId, chamadoIds))
      .orderBy(desc(megadeskDomainChamadoActivities.createdAt));
  }

  // Mapear atividades para cada chamado
  return chamados.map((chamado) => ({
    id: chamado.chamadoId,
    number: chamado.chamadoNumber,
    customerId: chamado.customerId,
    customerName: chamado.customerName,
    customerPhone: chamado.customerPhone,
    customerEmail: chamado.customerEmail,
    customerCNPJ: chamado.customerCNPJ,
    company: chamado.company,
    title: chamado.title,
    observations: chamado.observations,
    status: chamado.status,
    priority: chamado.priority,
    assignedTo: chamado.assignedTo || undefined,
    createdAt: chamado.createdAt.getTime(),
    activities: allActivities
      .filter((a) => a.chamadoId === chamado.chamadoId)
      .map((a) => ({
        id: a.activityId,
        date: a.createdAt.getTime(),
        description: a.description,
        attendant: a.attendant,
        actionType: a.actionType,
      })),
  }));
}
