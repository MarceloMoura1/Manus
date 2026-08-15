/**
 * Helpers para gerenciar status personalizados de chamados por cliente
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { randomUUID } from "crypto";
import { megadeskTicketStatuses } from "../drizzle/schema";

export interface TicketStatus {
  statusId: string;
  clientId: string;
  name: string;
  color: string;
  order: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Listar todos os status de um cliente
 */
export async function getTicketStatuses(clientId: string): Promise<TicketStatus[]> {
  return getDb().select().from(megadeskTicketStatuses)
    .where(eq(megadeskTicketStatuses.clientId, clientId))
    .orderBy(asc(megadeskTicketStatuses.order));
}

/**
 * Criar novo status personalizado
 */
export async function createTicketStatus(
  clientId: string,
  name: string,
  color: string = "#3b82f6",
  order: number = 0
): Promise<TicketStatus> {
  const db = getDb();
  const statusId = randomUUID();

  await db.insert(megadeskTicketStatuses).values({ statusId, clientId, name, color, order, isDefault: false });
  const rows = await db.select().from(megadeskTicketStatuses).where(and(
    eq(megadeskTicketStatuses.statusId, statusId),
    eq(megadeskTicketStatuses.clientId, clientId),
  )).limit(1);
  if (!rows[0]) throw new Error("TICKET_STATUS_CREATE_FAILED");
  return rows[0];
}

/**
 * Atualizar status personalizado
 */
export async function updateTicketStatus(
  clientId: string,
  statusId: string,
  updates: { name?: string; color?: string; order?: number }
): Promise<TicketStatus> {
  const db = getDb();

  if (Object.keys(updates).length === 0) {
    throw new Error("Nenhum campo para atualizar");
  }
  await db.update(megadeskTicketStatuses).set(updates).where(and(
    eq(megadeskTicketStatuses.statusId, statusId),
    eq(megadeskTicketStatuses.clientId, clientId),
  ));
  const rows = await db.select().from(megadeskTicketStatuses).where(and(
    eq(megadeskTicketStatuses.statusId, statusId),
    eq(megadeskTicketStatuses.clientId, clientId),
  )).limit(1);
  if (!rows[0]) throw new Error("TICKET_STATUS_NOT_FOUND");
  return rows[0];
}

/**
 * Deletar status personalizado
 */
export async function deleteTicketStatus(clientId: string, statusId: string): Promise<void> {
  const db = getDb();
  await db.delete(megadeskTicketStatuses).where(and(
    eq(megadeskTicketStatuses.statusId, statusId),
    eq(megadeskTicketStatuses.clientId, clientId),
  ));
}

/**
 * Obter status padrão de um cliente (ou criar se não existir)
 */
export async function getOrCreateDefaultStatuses(clientId: string): Promise<TicketStatus[]> {
  const existing = await getTicketStatuses(clientId);
  if (existing.length > 0) return existing;

  // Criar status padrão
  const defaultStatuses = [
    { name: "Aberto", color: "#ef4444", order: 1 },
    { name: "Em Progresso", color: "#f59e0b", order: 2 },
    { name: "Aguardando", color: "#3b82f6", order: 3 },
    { name: "Fechado", color: "#10b981", order: 4 },
  ];

  const created: TicketStatus[] = [];
  for (const status of defaultStatuses) {
    const newStatus = await createTicketStatus(clientId, status.name, status.color, status.order);
    created.push(newStatus);
  }

  return created;
}
