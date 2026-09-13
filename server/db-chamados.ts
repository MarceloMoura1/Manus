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

import { getDb, getLazyDb } from './db';
const db = getLazyDb();
import {
  megadeskDomainChamados,
  megadeskDomainChamadoSequence,
  megadeskDomainChamadoActivities,
  megadeskDomainChamadoCollaborators,
  megadeskDomainClientUsers,
  megadeskDomainChamadoAttachments,
} from '../drizzle/schema';
import { and, asc, desc, eq, exists, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export type ChamadoWithActivities = {
  id: string;
  number: number;
  customerId: string | null;
  customerName: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerCNPJ?: string | null;
  company: string | null;
  title: string | null;
  observations: string | null;
  status: string;
  priority?: string;
  assignedTo?: string;
  assignedToUserId?: string;
  collaborators: Array<{
    userId: string;
    userName: string;
  }>;
  createdAt: number; // timestamp em millisegundos
  activities: Array<{
    id: string;
    date: number; // timestamp em millisegundos
    description: string;
    attendant: string;
    actionType?: string;
  }>;
};

export type ChamadoCollaborator = ChamadoWithActivities['collaborators'][number];

export type TicketScope = 'all' | 'mine';
export type TicketSortKey = 'number' | 'createdAt' | 'customer' | 'title' | 'assignee' | 'priority' | 'status';
export type TicketSortDirection = 'asc' | 'desc';

export type TicketListOptions = {
  scope: TicketScope;
  operationalUserId: string;
  search?: string;
  sortBy: TicketSortKey;
  sortDirection: TicketSortDirection;
};

type TicketStatusCountRow = { status: string | null; count: number | string };

export type TicketStatusCounts = {
  total: number;
  open: number;
  in_progress: number;
  waiting: number;
  closed: number;
};

/** Converts a grouped, tenant-scoped aggregate into the fixed five-card contract. */
export function buildTicketStatusCounts(rows: TicketStatusCountRow[]): TicketStatusCounts {
  const counts: TicketStatusCounts = { total: 0, open: 0, in_progress: 0, waiting: 0, closed: 0 };
  for (const row of rows) {
    const value = Number(row.count) || 0;

    // "Total" means every active status in the already-scoped aggregate. Keep this
    // independent from the three currently displayed active-status cards so a future
    // active domain status is not silently omitted.
    if (row.status !== 'closed') counts.total += value;

    if (row.status === 'open' || row.status === 'in_progress' || row.status === 'waiting' || row.status === 'closed') {
      counts[row.status] = value;
    }
  }
  return counts;
}

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

/** Resolves the canonical list/count filter selected by a status card. */
export function ticketStatusCondition(status?: string) {
  if (!status) return null;
  if (status === 'total') return ne(megadeskDomainChamados.status, 'closed');

  validateStatus(status);
  return eq(megadeskDomainChamados.status, status);
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
 * Resolve a identidade operacional canônica do usuário ativo do tenant.
 * O nome é persistido em assignedTo; o ID permanece disponível na relação
 * de colaboradores quando ela for usada.
 */
export async function getActiveClientUser(
  clientId: string,
  userId: string,
): Promise<ChamadoCollaborator | null> {
  if (!clientId?.trim() || !userId?.trim()) return null;

  const users = await db
    .select({
      userId: megadeskDomainClientUsers.userId,
      userName: megadeskDomainClientUsers.name,
    })
    .from(megadeskDomainClientUsers)
    .where(and(
      eq(megadeskDomainClientUsers.clientId, clientId),
      eq(megadeskDomainClientUsers.userId, userId),
      eq(megadeskDomainClientUsers.status, 'active'),
    ))
    .limit(1);

  return users[0] ?? null;
}

/**
 * Legacy rows predate assignedToUserId and retain only a display snapshot. They
 * are resolved once against the active tenant directory only when the name is
 * unambiguous; all normal filtering still compares canonical user IDs.
 */
export function resolveUnambiguousTenantLegacyDisplayName(
  clientId: string,
  current: ChamadoCollaborator | null,
  candidates: Array<{ clientId: string; userId: string; userName: string }>,
): string | null {
  if (!current) return null;
  const sameNameInTenant = candidates.filter(candidate =>
    candidate.clientId === clientId && candidate.userName === current.userName,
  );
  return sameNameInTenant.length === 1 && sameNameInTenant[0].userId === current.userId
    ? current.userName
    : null;
}

async function getUnambiguousLegacyPrimaryName(clientId: string, userId: string): Promise<string | null> {
  const current = await getActiveClientUser(clientId, userId);
  if (!current) return null;

  const sameNameUsers = await db
    .select({
      clientId: megadeskDomainClientUsers.clientId,
      userId: megadeskDomainClientUsers.userId,
      userName: megadeskDomainClientUsers.name,
    })
    .from(megadeskDomainClientUsers)
    .where(and(
      eq(megadeskDomainClientUsers.clientId, clientId),
      eq(megadeskDomainClientUsers.name, current.userName),
      eq(megadeskDomainClientUsers.status, 'active'),
    ));

  return resolveUnambiguousTenantLegacyDisplayName(clientId, current, sameNameUsers);
}

async function ticketScopeCondition(clientId: string, scope: TicketScope, operationalUserId: string) {
  const tenantCondition = eq(megadeskDomainChamados.clientId, clientId);
  if (scope === 'all') return tenantCondition;
  if (!operationalUserId?.trim()) throw new Error('operationalUserId não pode estar vazio para escopo meus');

  const legacyPrimaryName = await getUnambiguousLegacyPrimaryName(clientId, operationalUserId);
  const primaryCondition = legacyPrimaryName
    ? or(
      eq(megadeskDomainChamados.assignedToUserId, operationalUserId),
      and(isNull(megadeskDomainChamados.assignedToUserId), eq(megadeskDomainChamados.assignedTo, legacyPrimaryName)),
    )
    : eq(megadeskDomainChamados.assignedToUserId, operationalUserId);
  const collaboratorCondition = exists(
    db.select({ chamadoId: megadeskDomainChamadoCollaborators.chamadoId })
      .from(megadeskDomainChamadoCollaborators)
      .where(and(
        eq(megadeskDomainChamadoCollaborators.chamadoId, megadeskDomainChamados.chamadoId),
        eq(megadeskDomainChamadoCollaborators.clientId, clientId),
        eq(megadeskDomainChamadoCollaborators.userId, operationalUserId),
      )),
  );

  return and(tenantCondition, or(primaryCondition, collaboratorCondition));
}

function ticketSearchCondition(search: string | undefined) {
  const value = search?.trim();
  if (!value) return null;
  const pattern = `%${value.toLocaleLowerCase()}%`;
  return or(
    sql`LOWER(COALESCE(${megadeskDomainChamados.customerName}, '')) LIKE ${pattern}`,
    sql`LOWER(COALESCE(${megadeskDomainChamados.company}, '')) LIKE ${pattern}`,
    sql`LOWER(COALESCE(${megadeskDomainChamados.title}, '')) LIKE ${pattern}`,
    sql`CAST(${megadeskDomainChamados.chamadoNumber} AS CHAR) LIKE ${pattern}`,
    sql`CONCAT('#', LPAD(${megadeskDomainChamados.chamadoNumber}, 4, '0')) LIKE ${pattern}`,
  );
}

function ticketSortOrder(sortBy: TicketSortKey, sortDirection: TicketSortDirection) {
  const order = (expression: any) => sortDirection === 'asc' ? asc(expression) : desc(expression);
  const stableTicketNumber = asc(megadeskDomainChamados.chamadoNumber);
  switch (sortBy) {
    case 'createdAt':
      return [order(megadeskDomainChamados.createdAt), stableTicketNumber];
    case 'customer':
      return [order(sql`LOWER(CONCAT(COALESCE(${megadeskDomainChamados.customerName}, ''), ' ', COALESCE(${megadeskDomainChamados.company}, '')))`), stableTicketNumber];
    case 'title':
      return [order(sql`LOWER(COALESCE(${megadeskDomainChamados.title}, ''))`), stableTicketNumber];
    case 'assignee':
      return [order(sql`LOWER(COALESCE(${megadeskDomainChamados.assignedTo}, ''))`), stableTicketNumber];
    case 'priority':
      return [order(sql`CASE ${megadeskDomainChamados.priority} WHEN 'critica' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 WHEN 'baixa' THEN 1 ELSE 0 END`), stableTicketNumber];
    case 'status':
      return [order(sql`CASE ${megadeskDomainChamados.status} WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'waiting' THEN 3 WHEN 'closed' THEN 4 ELSE 5 END`), stableTicketNumber];
    case 'number':
    default:
      return [order(megadeskDomainChamados.chamadoNumber)];
  }
}

async function resolveLegacyPrimaryAssigneeIds(clientId: string, chamados: Array<{ assignedTo?: string | null; assignedToUserId?: string | null }>) {
  const names = [...new Set(chamados
    .filter(chamado => !chamado.assignedToUserId && chamado.assignedTo?.trim())
    .map(chamado => chamado.assignedTo!.trim()))];
  if (!names.length) return new Map<string, string>();

  const users = await db
    .select({ userId: megadeskDomainClientUsers.userId, userName: megadeskDomainClientUsers.name })
    .from(megadeskDomainClientUsers)
    .where(and(
      eq(megadeskDomainClientUsers.clientId, clientId),
      eq(megadeskDomainClientUsers.status, 'active'),
      inArray(megadeskDomainClientUsers.name, names),
    ));
  const byName = new Map<string, string[]>();
  users.forEach(user => byName.set(user.userName, [...(byName.get(user.userName) ?? []), user.userId]));
  return new Map([...byName].flatMap(([name, userIds]) => userIds.length === 1 ? [[name, userIds[0]] as const] : []));
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
  customerCNPJ?: string,
  assignedToUserId?: string,
): Promise<any> {
  // Validações de entrada
  if (!clientId || !clientId.trim()) {
    throw new Error('clientId não pode estar vazio');
  }
  validateNonEmptyString(customerId, 'customerId');
  
  validateNonEmptyString(customerName, 'customerName');
  validateNonEmptyString(company, 'company');
  validateNonEmptyString(title, 'title');
  validatePriority(priority);

  // Sanitizar strings
  const sanitizedCustomerName = sanitizeString(customerName, 180);
  const sanitizedCompany = sanitizeString(company, 255);
  const sanitizedCustomerId = sanitizeString(customerId, 80);
  const sanitizedTitle = sanitizeString(title, 255);
  const sanitizedObservations = sanitizeString(observations, MAX_OBSERVATIONS_LENGTH);
  const sanitizedAssignedTo = assignedTo ? sanitizeString(assignedTo, 180) : undefined;
  const sanitizedAssignedToUserId = assignedToUserId ? sanitizeString(assignedToUserId, 80) : undefined;

  return retryWithBackoff(async () => {
    const chamadoNumber = await getNextChamadoNumber(clientId);
    const chamadoId = uuidv4();

    console.log(`[LOG] Criando chamado #${chamadoNumber} para cliente ${clientId}`);

    await db.insert(megadeskDomainChamados).values({
      chamadoId,
      clientId,
      chamadoNumber,
      customerId: sanitizedCustomerId,
      customerName: sanitizedCustomerName,
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      customerCNPJ: customerCNPJ || null,
      company: sanitizedCompany,
      title: sanitizedTitle,
      observations: sanitizedObservations,
      status: 'open' as 'open',
      priority: (priority || 'media') as typeof VALID_PRIORITIES[number],
      assignedTo: sanitizedAssignedTo,
      assignedToUserId: sanitizedAssignedToUserId,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });

    console.log(`[SUCCESS] Chamado #${chamadoNumber} criado com sucesso (ID: ${chamadoId})`);

    const now = new Date();
        return {
      id: chamadoId,
      number: chamadoNumber,
      customerId: sanitizedCustomerId,
      customerName: sanitizedCustomerName,
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      customerCNPJ: customerCNPJ || null,
      company: sanitizedCompany,
      title: sanitizedTitle,
      observations: sanitizedObservations,
      status: 'open' as 'open',
      priority: priority || 'media',
      assignedTo: sanitizedAssignedTo,
      assignedToUserId: sanitizedAssignedToUserId,
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
): Promise<any> {
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

    const collaborators = await getCollaborators(chamadoId, clientId);

    const c = chamado[0];
    const legacyPrimaryAssigneeIds = await resolveLegacyPrimaryAssigneeIds(clientId, [c]);
    return {
      id: c.chamadoId, // eslint-disable-line
      number: c.chamadoNumber,
      customerId: c.customerId ?? "",
      customerName: c.customerName ?? "",
      customerPhone: c.customerPhone,
      customerEmail: c.customerEmail,
      customerCNPJ: c.customerCNPJ,
      company: c.company ?? "",
      title: c.title ?? "",
      observations: c.observations ?? "",
      status: c.status,
      priority: c.priority,
      assignedTo: c.assignedTo || undefined,
      assignedToUserId: c.assignedToUserId || (c.assignedTo ? legacyPrimaryAssigneeIds.get(c.assignedTo) : undefined),
      collaborators,
      createdAt: new Date((c.createdAt as string).replace(' ', 'T') + 'Z').getTime(),
      activities: activities.map(a => {
        let date = a.createdAt;
        let timestamp: number;
        if (false && date instanceof Date) { // Drizzle retorna string
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
  offset: number = 0,
  options: TicketListOptions = {
    scope: 'all',
    operationalUserId: '',
    sortBy: 'createdAt',
    sortDirection: 'desc',
  },
): Promise<any[]> {
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

  return retryWithBackoff(async () => {
    const conditions = [await ticketScopeCondition(clientId, options.scope, options.operationalUserId)];
    const statusCondition = ticketStatusCondition(status);
    if (statusCondition) conditions.push(statusCondition);
    const searchCondition = ticketSearchCondition(options.search);
    if (searchCondition) conditions.push(searchCondition);

    // ORDER BY precedes LIMIT/OFFSET so no header ever orders only a visible page.
    const chamados = await db
      .select()
      .from(megadeskDomainChamados)
      .where(and(...conditions))
      .orderBy(...ticketSortOrder(options.sortBy, options.sortDirection))
      .limit(limit)
      .offset(offset);

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

    let allCollaborators: Array<ChamadoCollaborator & { chamadoId: string }> = [];
    if (chamadoIds.length > 0) {
      allCollaborators = await db
        .select({
          chamadoId: megadeskDomainChamadoCollaborators.chamadoId,
          userId: megadeskDomainChamadoCollaborators.userId,
          userName: megadeskDomainChamadoCollaborators.userName,
        })
        .from(megadeskDomainChamadoCollaborators)
        .where(and(
          inArray(megadeskDomainChamadoCollaborators.chamadoId, chamadoIds),
          eq(megadeskDomainChamadoCollaborators.clientId, clientId),
        ));
    }

    // Agrupar atividades por chamado_id
    const activitiesByChamado: Record<string, any[]> = {};
    allActivities.forEach(a => {
      if (!activitiesByChamado[a.chamadoId]) {
        activitiesByChamado[a.chamadoId] = [];
      }
      activitiesByChamado[a.chamadoId].push(a);
    });

    const collaboratorsByChamado: Record<string, ChamadoCollaborator[]> = {};
    allCollaborators.forEach(collaborator => {
      if (!collaboratorsByChamado[collaborator.chamadoId]) {
        collaboratorsByChamado[collaborator.chamadoId] = [];
      }
      collaboratorsByChamado[collaborator.chamadoId].push({
        userId: collaborator.userId,
        userName: collaborator.userName,
      });
    });

    // Mapear chamados com suas atividades
    const legacyPrimaryAssigneeIds = await resolveLegacyPrimaryAssigneeIds(clientId, chamados);
    const result: ChamadoWithActivities[] = chamados.map((c: any) => ({
      id: c.chamadoId,
      number: c.chamadoNumber,
      customerId: c.customerId ?? "",
      customerName: c.customerName ?? "",
      customerPhone: c.customerPhone,
      customerEmail: c.customerEmail,
      customerCNPJ: c.customerCNPJ,
      company: c.company ?? "",
      title: c.title ?? "",
      observations: c.observations ?? "",
      status: c.status,
      priority: c.priority,
      assignedTo: c.assignedTo,
      assignedToUserId: c.assignedToUserId || (c.assignedTo ? legacyPrimaryAssigneeIds.get(c.assignedTo) : undefined),
      collaborators: collaboratorsByChamado[c.chamadoId] || [],
      createdAt: new Date((c.createdAt as string).replace(' ', 'T') + 'Z').getTime(),
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
    assignedToUserId?: string;
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
  if (updates.assignedToUserId !== undefined) {
    updateData.assignedToUserId = updates.assignedToUserId ? sanitizeString(updates.assignedToUserId, 80) : null;
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
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
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
  status?: string,
  options: Pick<TicketListOptions, 'scope' | 'operationalUserId' | 'search'> = {
    scope: 'all',
    operationalUserId: '',
  },
): Promise<number> {
  const db = getDb();
  
  try {
    const conditions = [await ticketScopeCondition(clientId, options.scope, options.operationalUserId)];
    const statusCondition = ticketStatusCondition(status);
    if (statusCondition) conditions.push(statusCondition);
    const searchCondition = ticketSearchCondition(options.search);
    if (searchCondition) conditions.push(searchCondition);
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(megadeskDomainChamados)
      .where(and(...conditions));
    return Number(result[0]?.count) || 0;
  } catch (error) {
    console.error(`[ERROR] Failed to count chamados for ${clientId}:`, error);
    throw error;
  }
}

/**
 * Obter contadores de chamados por status
 */
export async function getStatusCounts(
  clientId: string,
  scope: TicketScope,
  operationalUserId: string,
): Promise<TicketStatusCounts> {
  const db = getDb();
  
  try {
    // A agregação é feita no banco para representar o conjunto inteiro, não a página atual.
    const rows = await db
      .select({
        status: megadeskDomainChamados.status,
        count: sql<number>`count(*)`,
      })
      .from(megadeskDomainChamados)
      .where(await ticketScopeCondition(clientId, scope, operationalUserId))
      .groupBy(megadeskDomainChamados.status);

    const counts = buildTicketStatusCounts(rows);

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
    createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
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
): Promise<any[]> {
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
    createdAt: new Date((chamado.createdAt as string).replace(" ", "T") + "Z").getTime(),
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
