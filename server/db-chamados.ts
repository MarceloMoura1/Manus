/**
 * Database helpers para gerenciar chamados
 */

import { getDb } from './db';
const db = getDb();
import { 
  megadeskDomainChamados, 
  megadeskDomainChamadoActivities,
  megadeskDomainChamadoSequence 
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

  const chamado = await db.insert(megadeskDomainChamados).values({
    chamadoId,
    clientId,
    chamadoNumber,
    customerId,
    customerName,
    company,
    title,
    observations,
    status: 'open',
    priority: priority as any,
    assignedTo,
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
    priority,
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
    .from(megadeskDomainChamados)
    .where(
      and(
        eq(megadeskDomainChamados.chamadoId, chamadoId),
        eq(megadeskDomainChamados.clientId, clientId)
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
}

/**
 * Listar chamados de um cliente
 */
export async function listChamados(
  clientId: string,
  status?: string,
  limit: number = 100
): Promise<ChamadoWithActivities[]> {
  let query = db
    .select()
    .from(megadeskDomainChamados)
    .where(eq(megadeskDomainChamados.clientId, clientId));

  if (status && status !== 'total') {
    query = query.where(eq(megadeskDomainChamados.status, status));
  } else if (status === 'total') {
    // Excluir fechados
    query = db
      .select()
      .from(megadeskDomainChamados)
      .where(
        and(
          eq(megadeskDomainChamados.clientId, clientId),
          ne(megadeskDomainChamados.status, 'closed')
        )
      );
  }

  const chamados = await query.limit(limit);

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
      assignedTo: c.assignedTo || undefined,
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
  await db
    .update(megadeskDomainChamados)
    .set(updates as any)
    .where(
      and(
        eq(megadeskDomainChamados.chamadoId, chamadoId),
        eq(megadeskDomainChamados.clientId, clientId)
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
  newDescription: string
): Promise<void> {
  await db
    .update(megadeskDomainChamadoActivities)
    .set({ description: newDescription })
    .where(
      and(
        eq(megadeskDomainChamadoActivities.activityId, activityId),
        eq(megadeskDomainChamadoActivities.chamadoId, chamadoId),
        eq(megadeskDomainChamadoActivities.clientId, clientId)
      )
    );
}
