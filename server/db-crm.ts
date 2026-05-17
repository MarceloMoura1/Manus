/**
 * db-crm.ts — Helpers de banco de dados para a página de Clientes (CRM)
 * REGRA 1: Toda query DEVE filtrar por clientId para garantir isolamento de dados.
 */
import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, like, or, desc } from "drizzle-orm";
import { megadeskCrmClients } from "../drizzle/schema";
import { getPool } from "./db";
import { randomUUID } from "crypto";

type Database = ReturnType<typeof drizzle>;

function getDb(): Database {
  return drizzle(getPool() as any);
}

export type CrmClientInput = {
  companyName: string;
  responsibleName?: string;
  cpfCnpj?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  cep?: string;
  status?: "lead" | "ativo" | "inativo" | "cancelado" | "inadimplente";
  origin?: "whatsapp" | "instagram" | "facebook" | "site" | "indicacao" | "outro";
  internalResponsible?: string;
  tags?: string;
  observations?: string;
};

/**
 * Lista todos os clientes CRM de um tenant (clientId).
 * Suporta busca por nome, telefone, CNPJ ou e-mail.
 */
export async function listCrmClients(clientId: string, search?: string) {
  const db = getDb();
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    const rows = await db
      .select()
      .from(megadeskCrmClients)
      .where(
        and(
          eq(megadeskCrmClients.clientId, clientId),
          or(
            like(megadeskCrmClients.companyName, term),
            like(megadeskCrmClients.phone, term),
            like(megadeskCrmClients.cpfCnpj, term),
            like(megadeskCrmClients.email, term),
            like(megadeskCrmClients.responsibleName, term)
          )
        )
      )
      .orderBy(desc(megadeskCrmClients.updatedAt));
    return rows;
  }
  return db
    .select()
    .from(megadeskCrmClients)
    .where(eq(megadeskCrmClients.clientId, clientId))
    .orderBy(desc(megadeskCrmClients.updatedAt));
}

/**
 * Busca um cliente CRM por ID, verificando isolamento por clientId.
 */
export async function getCrmClientById(crmClientId: string, clientId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(megadeskCrmClients)
    .where(
      and(
        eq(megadeskCrmClients.crmClientId, crmClientId),
        eq(megadeskCrmClients.clientId, clientId) // REGRA 3: verificar dono
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Cria um novo cliente CRM.
 */
export async function createCrmClient(clientId: string, input: CrmClientInput) {
  const db = getDb();
  const crmClientId = `crm-${randomUUID()}`;
  await db.insert(megadeskCrmClients).values({
    crmClientId,
    clientId,
    companyName: input.companyName,
    responsibleName: input.responsibleName ?? "",
    cpfCnpj: input.cpfCnpj ?? "",
    phone: input.phone ?? "",
    whatsapp: input.whatsapp ?? "",
    email: input.email ?? "",
    address: input.address ?? "",
    city: input.city ?? "",
    state: input.state ?? "",
    cep: input.cep ?? "",
    status: input.status ?? "lead",
    origin: input.origin ?? "outro",
    internalResponsible: input.internalResponsible ?? "",
    tags: input.tags ?? "",
    observations: input.observations ?? "",
  });
  return { crmClientId };
}

/**
 * Atualiza um cliente CRM. REGRA 4: WHERE inclui clientId.
 */
export async function updateCrmClient(
  crmClientId: string,
  clientId: string,
  input: Partial<CrmClientInput>
) {
  const db = getDb();
  // Verificar que o cliente pertence ao tenant antes de atualizar (REGRA 3)
  const existing = await getCrmClientById(crmClientId, clientId);
  if (!existing) throw new Error("Cliente não encontrado ou sem permissão.");

  const updateData: Record<string, any> = {};
  if (input.companyName !== undefined) updateData.companyName = input.companyName;
  if (input.responsibleName !== undefined) updateData.responsibleName = input.responsibleName;
  if (input.cpfCnpj !== undefined) updateData.cpfCnpj = input.cpfCnpj;
  if (input.phone !== undefined) updateData.phone = input.phone;
  if (input.whatsapp !== undefined) updateData.whatsapp = input.whatsapp;
  if (input.email !== undefined) updateData.email = input.email;
  if (input.address !== undefined) updateData.address = input.address;
  if (input.city !== undefined) updateData.city = input.city;
  if (input.state !== undefined) updateData.state = input.state;
  if (input.cep !== undefined) updateData.cep = input.cep;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.origin !== undefined) updateData.origin = input.origin;
  if (input.internalResponsible !== undefined) updateData.internalResponsible = input.internalResponsible;
  if (input.tags !== undefined) updateData.tags = input.tags;
  if (input.observations !== undefined) updateData.observations = input.observations;

  if (Object.keys(updateData).length === 0) return;

  await db
    .update(megadeskCrmClients)
    .set(updateData)
    .where(
      and(
        eq(megadeskCrmClients.crmClientId, crmClientId),
        eq(megadeskCrmClients.clientId, clientId) // REGRA 4: AND client_id = ?
      )
    );
}

/**
 * Exclui um cliente CRM. REGRA 3: verificar dono antes de excluir.
 */
export async function deleteCrmClient(crmClientId: string, clientId: string) {
  const db = getDb();
  const existing = await getCrmClientById(crmClientId, clientId);
  if (!existing) throw new Error("Cliente não encontrado ou sem permissão.");

  await db
    .delete(megadeskCrmClients)
    .where(
      and(
        eq(megadeskCrmClients.crmClientId, crmClientId),
        eq(megadeskCrmClients.clientId, clientId)
      )
    );
}

/**
 * Adiciona uma entrada na timeline operacional de um cliente CRM.
 * REGRA 1: Filtra por clientId.
 */
export async function addCrmTimeline(
  crmClientId: string,
  clientId: string,
  entry: {
    type: string;
    description: string;
    author?: string;
  }
) {
  const pool = getPool();
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO megadesk_crm_timeline (timeline_id, crm_client_id, client_id, entry_type, description, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [id, crmClientId, clientId, entry.type, entry.description, entry.author ?? "Sistema"]
  );
}

/**
 * Lista a timeline operacional de um cliente CRM.
 * REGRA 1: Filtra por clientId.
 */
export async function listCrmTimeline(crmClientId: string, clientId: string) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT timeline_id, entry_type, description, author, created_at
     FROM megadesk_crm_timeline
     WHERE crm_client_id = ? AND client_id = ?
     ORDER BY created_at DESC LIMIT 100`,
    [crmClientId, clientId]
  ) as any[];
  return (rows as any[]).map(r => ({
    id: r.timeline_id,
    type: r.entry_type,
    description: r.description,
    author: r.author,
    createdAt: r.created_at,
  }));
}
