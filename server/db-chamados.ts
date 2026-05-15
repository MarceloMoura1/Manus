/**
 * Database helpers para gerenciar chamados
 */

import { getDb } from './db';
const db = getDb();
import {
  megadeskDomainTickets,
  megadeskDomainChamadoActivities,
  megadeskDomainChamadoSequence,
} from '../drizzle/schema';
import { eq, and, desc, ne } from 'drizzle-orm';
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

/**
 * Obter próximo número de chamado para um cliente
 */
export async function getNextChamadoNumber(clientId: string): Promise<number> {
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
    return 1;
  }

  const current = sequence[0].nextChamadoNumber;
  
  // Incrementar para próximo
  await db
    .update(megadeskDomainChamadoSequence)
    .set({ nextChamadoNumber: current + 1 })
    .where(eq(megadeskDomainChamadoSequence.clientId, clientId));

  return current;
}

/**
 * Criar novo chamado
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
  const chamadoNumber = await getNextChamadoNumber(clientId);
  const chamadoId = uuidv4();

  await db.insert(megadeskDomainTickets).values({
    ticketId: chamadoId,
    clientId,
    chamadoNumber,
    customer: customerName,
    company,
    problem: title,
    category: 'Geral',
    description: observations,
    status: 'open',
    createdLabel: new Date().toISOString(),
    createdAt: new Date(),
  });

  return {
    id: chamadoId,
    number: chamadoNumber,
    customerName,
    company,
    title,
    observations,
    status: 'open',
    priority: priority || 'media',
    assignedTo,
    createdAt: new Date(),
    activities: [],
  };
}

/**
 * Obter chamado com atividades
 */
export async function getChamadoWithActivities(
  chamadoId: string,
  clientId: string
): Promise<ChamadoWithActivities | null> {
  const chamado = await db
    .select()
    .from(megadeskDomainTickets)
    .where(
      and(
        eq(megadeskDomainTickets.ticketId, chamadoId),
        eq(megadeskDomainTickets.clientId, clientId)
      )
    )
    .limit(1);

  if (chamado.length === 0) {
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
    id: c.ticketId,
    number: c.chamadoNumber,
    customerName: c.customer,
    company: c.company,
    title: c.problem,
    observations: c.description,
    status: c.status,
    priority: 'media',
    assignedTo: undefined,
    createdAt: c.createdAt,
    activities: activities.map(a => ({
      id: a.activityId,
      date: a.createdAt,
      description: a.description,
      attendant: a.attendant,
    })),
  };
}

/**
 * Listar chamados de um cliente
 */
export async function listChamados(
  clientId: string,
  status?: string,
  limit: number = 10,
  offset: number = 0
): Promise<ChamadoWithActivities[]> {
  let query = db
    .select()
    .from(megadeskDomainTickets)
    .where(eq(megadeskDomainTickets.clientId, clientId));

  if (status && status !== 'total') {
    query = query.where(eq(megadeskDomainTickets.status, status));
  } else if (status === 'total') {
    // Excluir fechados
    query = db
      .select()
      .from(megadeskDomainTickets)
      .where(
        and(
          eq(megadeskDomainTickets.clientId, clientId),
          ne(megadeskDomainTickets.status, 'closed')
        )
      );
  }

  const chamados = await query.limit(limit).offset(offset);

  // Para cada chamado, buscar atividades
  const result: ChamadoWithActivities[] = [];
  for (const c of chamados) {
    const activities = await db
      .select()
      .from(megadeskDomainChamadoActivities)
      .where(
        and(
          eq(megadeskDomainChamadoActivities.chamadoId, c.ticketId),
          eq(megadeskDomainChamadoActivities.clientId, clientId)
        )
      )
      .orderBy(desc(megadeskDomainChamadoActivities.createdAt));

    result.push({
      id: c.ticketId,
      number: c.chamadoNumber,
      customerName: c.customer,
      company: c.company,
      title: c.problem,
      observations: c.description,
      status: c.status,
      priority: 'media',
      assignedTo: undefined,
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
}

/**
 * Atualizar chamado
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
  const updateData: any = {};
  
  if (updates.title) updateData.problem = updates.title;
  if (updates.observations) updateData.description = updates.observations;
  if (updates.status) updateData.status = updates.status;
  if (updates.priority) updateData.priority = updates.priority;
  if (updates.assignedTo) updateData.assignedTo = updates.assignedTo;

  await db
    .update(megadeskDomainTickets)
    .set(updateData)
    .where(
      and(
        eq(megadeskDomainTickets.ticketId, chamadoId),
        eq(megadeskDomainTickets.clientId, clientId)
      )
    );
}

/**
 * Adicionar atividade a um chamado
 */
export async function addActivityToChamado(
  chamadoId: string,
  clientId: string,
  description: string,
  attendant: string
): Promise<void> {
  const activityId = uuidv4();

  await db.insert(megadeskDomainChamadoActivities).values({
    activityId,
    chamadoId,
    clientId,
    description,
    attendant,
    createdAt: new Date(),
  });
}

/**
 * Editar atividade
 */
export async function editActivity(
  activityId: string,
  chamadoId: string,
  clientId: string,
  description: string
): Promise<void> {
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
    throw new Error('Atividade não encontrada');
  }

  // Atualizar descrição
  await db
    .update(megadeskDomainChamadoActivities)
    .set({ description })
    .where(eq(megadeskDomainChamadoActivities.activityId, activityId));
}
