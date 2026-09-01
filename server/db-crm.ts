/**
 * db-crm.ts — Helpers de banco de dados para a página de Clientes (CRM)
 * REGRA 1: Toda query DEVE filtrar por clientId para garantir isolamento de dados.
 */
import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, like, or, desc, ne } from "drizzle-orm";
import { megadeskCrmClients } from "../drizzle/schema";

import { getPool } from "./db";
import { randomUUID } from "crypto";
import { normalizeDigits, normalizeEmail } from "./_core/provisioning-guards";
import type { CustomerType } from "../shared/crm";
import { contactPhoneStorageDigitsVariants, normalizeContactPhone, sameContactPhone } from "../shared/contact-phone";

type Database = ReturnType<typeof drizzle>;

function getDb(): Database {
  return drizzle(getPool() as any);
}

type SqlExecutor = {
  execute(sql: string, values?: unknown[]): Promise<unknown>;
};

type CrmAttendanceRow = {
  crmClientId: string;
  companyName: string;
  responsibleName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  contactsJson: string | null;
};

export type CrmAttendanceRecipient = {
  crmClientId: string;
  companyName: string;
  responsibleName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  recipientPhone: string;
};

function parseAdditionalPhones(contactsJson: string | null): string[] {
  if (!contactsJson) return [];
  try {
    const contacts = JSON.parse(contactsJson) as unknown;
    if (!Array.isArray(contacts)) return [];
    return contacts.flatMap(contact => {
      if (!contact || typeof contact !== "object") return [];
      const values = [
        (contact as { phone?: unknown }).phone,
        (contact as { whatsapp?: unknown }).whatsapp,
      ];
      return values.filter((value): value is string => typeof value === "string");
    });
  } catch {
    return [];
  }
}

function canonicalStoredPhone(value: string | null | undefined): string | null {
  const normalized = normalizeContactPhone(value);
  return normalized.status === "valid" ? normalized.value : null;
}

function selectAttendanceRecipient(row: CrmAttendanceRow, term: string, canonicalPhone: string | null): CrmAttendanceRecipient | null {
  const phones = [row.whatsapp, row.phone, ...parseAdditionalPhones(row.contactsJson)];
  const matchedPhone = canonicalPhone
    ? phones.find(phone => sameContactPhone(phone, canonicalPhone)) ?? null
    : null;
  const normalizedPhone = canonicalStoredPhone(matchedPhone)
    ?? phones.map(canonicalStoredPhone).find((phone): phone is string => Boolean(phone));
  const normalizedTerm = term.toLocaleLowerCase();
  const matchesText = Boolean(normalizedTerm) && [row.companyName, row.responsibleName]
    .some(value => value.toLocaleLowerCase().includes(normalizedTerm));
  if (!normalizedPhone || (!matchesText && !matchedPhone)) return null;
  return {
    crmClientId: row.crmClientId,
    companyName: row.companyName,
    responsibleName: row.responsibleName,
    phone: canonicalStoredPhone(row.phone),
    whatsapp: canonicalStoredPhone(row.whatsapp),
    email: row.email,
    recipientPhone: normalizedPhone,
  };
}

/** Busca canônica de Clientes CRM usada pelo ERP e pelo Novo atendimento. */
export async function searchCrmClientsForAttendance(
  clientId: string,
  query: string,
  executor: SqlExecutor = getPool(),
): Promise<{ canonicalPhone: string | null; candidates: CrmAttendanceRecipient[] }> {
  const term = query.trim();
  const normalized = normalizeContactPhone(term);
  const canonicalPhone = normalized.status === "valid" ? normalized.value : null;
  const variants = canonicalPhone ? contactPhoneStorageDigitsVariants(canonicalPhone) : [];
  const textSearch = `%${term}%`;
  const clauses = ["company_name LIKE ?", "responsible_name LIKE ?"];
  const values: unknown[] = [clientId, textSearch, textSearch];

  if (variants.length) {
    const placeholders = variants.map(() => "?").join(", ");
    clauses.push(
      `REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '') IN (${placeholders})`,
      `REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '') IN (${placeholders})`,
      `(${variants.map(() => "REGEXP_REPLACE(COALESCE(contacts_json, ''), '[^0-9]', '') LIKE CONCAT('%', ?, '%')").join(" OR ")})`,
    );
    values.push(...variants, ...variants, ...variants);
  }

  const [rows] = await executor.execute(
    `SELECT crm_client_id AS crmClientId, company_name AS companyName,
            responsible_name AS responsibleName, phone, whatsapp, email,
            contacts_json AS contactsJson
       FROM megadesk_crm_clients
      WHERE client_id = ? AND lifecycle_state = 'active'
        AND (${clauses.join(" OR ")})
      ORDER BY company_name, crm_client_id LIMIT 25`,
    values,
  ) as [CrmAttendanceRow[]];
  const candidates = rows
    .map(row => selectAttendanceRecipient(row, term, canonicalPhone))
    .filter((candidate): candidate is CrmAttendanceRecipient => Boolean(candidate))
    .slice(0, 10);
  return { canonicalPhone, candidates };
}

export async function findCrmClientForAttendance(
  clientId: string,
  phone: string,
  executor: SqlExecutor = getPool(),
): Promise<CrmAttendanceRecipient | null> {
  const lookup = await searchCrmClientsForAttendance(clientId, phone, executor);
  if (!lookup.canonicalPhone) return null;
  return lookup.candidates.find(candidate => candidate.recipientPhone === lookup.canonicalPhone) ?? null;
}

export type CrmClientInput = {
  customerType: CustomerType | null;
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
  contacts?: Array<{ phone: string; whatsapp: string; description?: string }>;
};

/**
 * Lista todos os clientes CRM de um tenant (clientId).
 * Suporta busca por nome, telefone, CNPJ ou e-mail.
 */
export async function listCrmClients(clientId: string, search?: string, lifecycle: "active" | "inactive" | "archived" | "all" = "active") {
  const db = getDb();
  const lifecycleClause = lifecycle === "all"
    ? ne(megadeskCrmClients.lifecycleState, "archived")
    : eq(megadeskCrmClients.lifecycleState, lifecycle);
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    const rows = await db
      .select()
      .from(megadeskCrmClients)
      .where(
        and(
          eq(megadeskCrmClients.clientId, clientId),
          lifecycleClause,
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
    .where(and(eq(megadeskCrmClients.clientId, clientId), lifecycleClause))
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
    customerType: input.customerType,
    companyName: input.companyName,
    responsibleName: input.responsibleName ?? "",
    cpfCnpj: input.cpfCnpj ? normalizeDigits(input.cpfCnpj) : null,
    phone: normalizeStoredPhone(input.phone, true),
    whatsapp: normalizeStoredPhone(input.whatsapp, false) ?? "",
    email: input.email ? normalizeEmail(input.email) : null,
    address: input.address ?? "",
    city: input.city ?? "",
    state: input.state ?? "",
    cep: input.cep ?? "",
    status: input.status ?? "lead",
    origin: input.origin ?? "outro",
    internalResponsible: input.internalResponsible ?? "",
    tags: input.tags ?? "",
    observations: input.observations ?? "",
    contactsJson: input.contacts ? JSON.stringify(input.contacts) : "",
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

  const updateData: Partial<typeof megadeskCrmClients.$inferInsert> = {};
  if (input.customerType !== undefined) updateData.customerType = input.customerType;
  if (input.companyName !== undefined) updateData.companyName = input.companyName;
  if (input.responsibleName !== undefined) updateData.responsibleName = input.responsibleName;
  if (input.cpfCnpj !== undefined) updateData.cpfCnpj = input.cpfCnpj ? normalizeDigits(input.cpfCnpj) : null;
  if (input.phone !== undefined) updateData.phone = normalizeStoredPhone(input.phone, true);
  if (input.whatsapp !== undefined) updateData.whatsapp = normalizeStoredPhone(input.whatsapp, false) ?? "";
  if (input.email !== undefined) updateData.email = input.email ? normalizeEmail(input.email) : null;
  if (input.address !== undefined) updateData.address = input.address;
  if (input.city !== undefined) updateData.city = input.city;
  if (input.state !== undefined) updateData.state = input.state;
  if (input.cep !== undefined) updateData.cep = input.cep;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.origin !== undefined) updateData.origin = input.origin;
  if (input.internalResponsible !== undefined) updateData.internalResponsible = input.internalResponsible;
  if (input.tags !== undefined) updateData.tags = input.tags;
  if (input.observations !== undefined) updateData.observations = input.observations;
  if (input.contacts !== undefined) updateData.contactsJson = JSON.stringify(input.contacts);

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

export async function findDuplicateCrmClient(clientId: string, input: { cpfCnpj?: string; phone?: string }, excludeCrmClientId?: string) {
  const document = input.cpfCnpj ? normalizeDigits(input.cpfCnpj) : "";
  const normalizedPhone = normalizeStoredPhone(input.phone, true) ?? "";
  if (!document && !normalizedPhone) return null;
  const clauses: string[] = [];
  const values: unknown[] = [clientId];
  if (document) { clauses.push("cpf_cnpj = ?"); values.push(document); }
  if (normalizedPhone) { clauses.push("phone = ?"); values.push(normalizedPhone); }
  if (excludeCrmClientId) { values.push(excludeCrmClientId); }
  const [rows] = await getPool().execute(
    `SELECT crm_client_id AS crmClientId, company_name AS companyName, cpf_cnpj AS cpfCnpj, phone
     FROM megadesk_crm_clients
     WHERE client_id = ? AND (${clauses.join(" OR ")})${excludeCrmClientId ? " AND crm_client_id <> ?" : ""}
     ORDER BY company_name, crm_client_id LIMIT 1`,
    values,
  ) as any[];
  return rows[0] as { crmClientId: string; companyName: string; cpfCnpj: string | null; phone: string | null } | undefined ?? null;
}

function normalizeStoredPhone(value: string | undefined, nullable: boolean): string | null {
  const result = normalizeContactPhone(value);
  if (result.status === "empty") return nullable ? null : "";
  if (result.status === "invalid") throw new Error(result.reason);
  return result.value;
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
