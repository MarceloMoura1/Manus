/**
 * Helpers para gerenciar status personalizados de chamados por cliente
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { randomUUID } from "crypto";

export interface TicketStatus {
  statusId: string;
  clientId: string;
  name: string;
  color: string;
  order: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Listar todos os status de um cliente
 */
export async function getTicketStatuses(clientId: string): Promise<TicketStatus[]> {
  const db = getDb();
  const result = await db.execute(
    sql`SELECT * FROM megadesk_ticket_statuses WHERE client_id = ${clientId} ORDER BY \`order\` ASC`
  );

  if (!result || (Array.isArray(result) && (result as any[]).length === 0)) return [];

  return (result as any[]).map((row: any) => ({
    statusId: row.status_id,
    clientId: row.client_id,
    name: row.name,
    color: row.color,
    order: row.order,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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

  await db.execute(
    sql`INSERT INTO megadesk_ticket_statuses (status_id, client_id, name, color, \`order\`, is_default)
        VALUES (${statusId}, ${clientId}, ${name}, ${color}, ${order}, false)`
  );

  const result = await db.execute(
    sql`SELECT * FROM megadesk_ticket_statuses WHERE status_id = ${statusId}`
  );

  const row = (result as any[])[0];
  return {
    statusId: row.status_id,
    clientId: row.client_id,
    name: row.name,
    color: row.color,
    order: row.order,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

  const setClauses: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    values.push(updates.name);
  }
  if (updates.color !== undefined) {
    setClauses.push("color = ?");
    values.push(updates.color);
  }
  if (updates.order !== undefined) {
    setClauses.push("`order` = ?");
    values.push(updates.order);
  }

  if (setClauses.length === 0) {
    throw new Error("Nenhum campo para atualizar");
  }

  values.push(statusId);
  values.push(clientId);

  const query = `UPDATE megadesk_ticket_statuses SET ${setClauses.join(", ")} WHERE status_id = ? AND client_id = ?`;
  // Execute raw SQL query
  const pool = (db as any)._.client;
  await (pool as any).execute(query, values);

  const result = await db.execute(
    sql`SELECT * FROM megadesk_ticket_statuses WHERE status_id = ${statusId}`
  );

  const row = (result as any[])[0];
  return {
    statusId: row.status_id,
    clientId: row.client_id,
    name: row.name,
    color: row.color,
    order: row.order,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deletar status personalizado
 */
export async function deleteTicketStatus(clientId: string, statusId: string): Promise<void> {
  const db = getDb();
  await db.execute(
    sql`DELETE FROM megadesk_ticket_statuses WHERE status_id = ${statusId} AND client_id = ${clientId}`
  );
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
