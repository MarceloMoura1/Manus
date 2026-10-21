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
  customerType: CustomerType | null;
  companyName: string;
  responsibleName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  contactsJson: string | null;
};

export type CrmAttendanceRecipient = {
  crmClientId: string;
  customerType: CustomerType | null;
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
    customerType: row.customerType,
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
    `SELECT crm_client_id AS crmClientId, customer_type AS customerType, company_name AS companyName,
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
  contacts?: Array<{
    name?: string;
    role?: string;
    email?: string;
    phone: string;
    whatsapp: string;
    description?: string;
  } & Record<string, unknown>>;
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
 * Centraliza a deduplicação na entidade canônica megadesk_crm_clients:
 * antes de QUALQUER INSERT nessa tabela, faz o lookup por telefone canônico/email e REAPROVEITA o registro se já existir.
 */
export async function createCrmClient(clientId: string, input: CrmClientInput) {
  const db = getDb();

  // Sincronizar phone e whatsapp se apenas um foi fornecido
  const rawPhone = input.phone?.trim() ? input.phone : (input.whatsapp?.trim() ? input.whatsapp : undefined);
  const rawWhatsapp = input.whatsapp?.trim() ? input.whatsapp : (input.phone?.trim() ? input.phone : undefined);
  const normalizedPhone = normalizeStoredPhone(rawPhone, true);
  const normalizedWhatsapp = normalizeStoredPhone(rawWhatsapp, false) ?? "";
  const rawEmail = input.email && input.email.trim() ? normalizeEmail(input.email) : null;
  const normalizedEmail = rawEmail && rawEmail.length > 0 ? rawEmail : null;
  const rawDoc = input.cpfCnpj ? normalizeDigits(input.cpfCnpj) : null;
  const normalizedDoc = rawDoc && rawDoc.length > 0 ? rawDoc : null;

  // 1. Checagem de duplicidade / deduplicação estrita na entidade canônica megadesk_crm_clients
  const duplicate = await findDuplicateCrmClient(clientId, {
    cpfCnpj: normalizedDoc ?? undefined,
    phone: normalizedPhone ?? undefined,
    whatsapp: normalizedWhatsapp || undefined,
    email: normalizedEmail ?? undefined,
    contacts: input.contacts,
  });

  if (duplicate) {
    // REAPROVEITAR o registro existente e complementar campos faltantes
    const updateData: Partial<typeof megadeskCrmClients.$inferInsert> = {
      updatedAt: new Date().toISOString() as any,
    };
    if (!duplicate.phone && normalizedPhone) updateData.phone = normalizedPhone;
    if ((!duplicate.whatsapp || duplicate.whatsapp === "") && normalizedWhatsapp) updateData.whatsapp = normalizedWhatsapp;
    if (!duplicate.cpfCnpj && normalizedDoc) updateData.cpfCnpj = normalizedDoc;
    if (!duplicate.email && normalizedEmail) updateData.email = normalizedEmail;
    if (input.address && !duplicate.phone) updateData.address = input.address;
    if (input.city) updateData.city = input.city;
    if (input.state) updateData.state = input.state;
    if (input.cep) updateData.cep = input.cep;

    if (Object.keys(updateData).length > 1) {
      await db
        .update(megadeskCrmClients)
        .set(updateData)
        .where(
          and(
            eq(megadeskCrmClients.crmClientId, duplicate.crmClientId),
            eq(megadeskCrmClients.clientId, clientId)
          )
        );
    }
    return { crmClientId: duplicate.crmClientId, deduplicated: true };
  }

  const crmClientId = `crm-${randomUUID()}`;
  await db.insert(megadeskCrmClients).values({
    crmClientId,
    clientId,
    customerType: input.customerType,
    companyName: input.companyName,
    responsibleName: input.responsibleName ?? "",
    cpfCnpj: normalizedDoc,
    phone: normalizedPhone,
    whatsapp: normalizedWhatsapp,
    email: normalizedEmail,
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
  return { crmClientId, deduplicated: false };
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

export async function findDuplicateCrmClient(
  clientId: string,
  input: {
    cpfCnpj?: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
    contacts?: Array<{ phone?: string; whatsapp?: string; email?: string }>;
  },
  excludeCrmClientId?: string
): Promise<{
  crmClientId: string;
  companyName: string;
  cpfCnpj: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  matchedField?: "cpfCnpj" | "phone" | "whatsapp" | "email";
} | null> {
  const clauses: string[] = [];
  const values: unknown[] = [clientId];

  // 1. CPF/CNPJ
  const document = input.cpfCnpj ? normalizeDigits(input.cpfCnpj) : "";
  if (document && document.length >= 8) {
    clauses.push("cpf_cnpj = ?");
    values.push(document);
  }

  // 2. Telefone e WhatsApp com variantes canônicas de dígitos
  const phoneVariantsSet = new Set<string>();
  const collectVariants = (val: string | null | undefined) => {
    if (!val) return;
    const norm = normalizeContactPhone(val);
    if (norm.status === "valid") {
      const vars = contactPhoneStorageDigitsVariants(norm.value);
      vars.forEach(v => phoneVariantsSet.add(v));
    }
  };

  collectVariants(input.phone);
  collectVariants(input.whatsapp);
  if (Array.isArray(input.contacts)) {
    for (const c of input.contacts) {
      collectVariants(c.phone);
      collectVariants(c.whatsapp);
    }
  }

  const phoneVariants = Array.from(phoneVariantsSet);
  if (phoneVariants.length > 0) {
    const placeholders = phoneVariants.map(() => "?").join(", ");
    clauses.push(
      `(phone IS NOT NULL AND phone IN (${placeholders}))`,
      `(whatsapp IS NOT NULL AND whatsapp <> '' AND whatsapp IN (${placeholders}))`
    );
    values.push(...phoneVariants, ...phoneVariants);

    for (const pv of phoneVariants) {
      if (pv.length >= 8) {
        clauses.push(`(contacts_json IS NOT NULL AND contacts_json LIKE ?)`);
        values.push(`%${pv}%`);
      }
    }
  }

  // 3. E-mail
  const emailSet = new Set<string>();
  if (input.email && input.email.trim()) {
    emailSet.add(input.email.trim().toLowerCase());
  }
  if (Array.isArray(input.contacts)) {
    for (const c of input.contacts) {
      if (c.email && c.email.trim()) {
        emailSet.add(c.email.trim().toLowerCase());
      }
    }
  }
  const emails = Array.from(emailSet);
  if (emails.length > 0) {
    const placeholders = emails.map(() => "?").join(", ");
    clauses.push(`(email IS NOT NULL AND LOWER(email) IN (${placeholders}))`);
    values.push(...emails);

    for (const em of emails) {
      clauses.push(`(contacts_json IS NOT NULL AND LOWER(contacts_json) LIKE ?)`);
      values.push(`%${em}%`);
    }
  }

  if (clauses.length === 0) return null;

  if (excludeCrmClientId) {
    values.push(excludeCrmClientId);
  }

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT crm_client_id AS crmClientId, company_name AS companyName,
            cpf_cnpj AS cpfCnpj, phone, whatsapp, email
     FROM megadesk_crm_clients
     WHERE client_id = ? AND (${clauses.join(" OR ")})${excludeCrmClientId ? " AND crm_client_id <> ?" : ""}
     ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
    values,
  ) as any[];

  if (!rows || rows.length === 0) return null;
  const match = rows[0];

  let matchedField: "cpfCnpj" | "phone" | "whatsapp" | "email" = "phone";
  if (document && match.cpfCnpj === document) {
    matchedField = "cpfCnpj";
  } else if (emails.length > 0 && match.email && emails.includes(match.email.toLowerCase())) {
    matchedField = "email";
  } else if (input.whatsapp && match.whatsapp) {
    matchedField = "whatsapp";
  }

  return {
    crmClientId: match.crmClientId,
    companyName: match.companyName,
    cpfCnpj: match.cpfCnpj ?? null,
    phone: match.phone ?? null,
    whatsapp: match.whatsapp ?? null,
    email: match.email ?? null,
    matchedField,
  };
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
  },
  executor: SqlExecutor = getPool()
) {

  const id = randomUUID();
  await executor.execute(
    `INSERT INTO megadesk_crm_timeline (timeline_id, crm_client_id, client_id, entry_type, description, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [id, crmClientId, clientId, entry.type, entry.description, entry.author ?? "Sistema"]
  );
}

/**
 * Lista a timeline operacional de um cliente CRM.
 * REGRA 1: Filtra por clientId.
 */
export type CrmTimelineEntry = {
  id: string;
  type: string;
  description: string;
  author: string | null;
  createdAt: Date | string;
};

function timelineDescriptionWithResolvedActor(row: {
  entry_type: string;
  description: string;
  persisted_author?: string | null;
  author?: string | null;
}): string {
  if (row.entry_type !== "edit" && row.entry_type !== "status_change") return row.description;
  const persistedAuthor = row.persisted_author?.trim();
  const resolvedAuthor = row.author?.trim();
  if (!persistedAuthor || !resolvedAuthor || persistedAuthor === resolvedAuthor) return row.description;
  const actorFragment = `por ${persistedAuthor}`;
  const actorIndex = row.description.lastIndexOf(actorFragment);
  if (actorIndex < 0) return row.description;
  return `${row.description.slice(0, actorIndex)}por ${resolvedAuthor}${row.description.slice(actorIndex + actorFragment.length)}`;
}

type CrmLifecycleAuditMetadata = {
  crmClientId?: unknown;
  from?: unknown;
  to?: unknown;
};

function parseCrmLifecycleAuditMetadata(value: unknown): CrmLifecycleAuditMetadata | null {
  if (typeof value === "string") {
    try {
      return parseCrmLifecycleAuditMetadata(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? value as CrmLifecycleAuditMetadata : null;
}

function lifecycleAuditDescription(action: string, metadata: CrmLifecycleAuditMetadata): string {
  const stateLabel: Record<string, string> = {
    active: "ativo",
    inactive: "inativo",
    archived: "arquivado",
  };
  const from = typeof metadata.from === "string" ? stateLabel[metadata.from] : undefined;
  const to = typeof metadata.to === "string" ? stateLabel[metadata.to] : undefined;
  if (from && to) return `Estado operacional alterado de ${from} para ${to}.`;
  const actionLabel: Record<string, string> = {
    crm_client_deactivate: "Cliente inativado.",
    crm_client_reactivate: "Cliente reativado.",
    crm_client_archive: "Cliente arquivado.",
    crm_client_restore: "Cliente restaurado.",
  };
  return actionLabel[action] ?? "Estado operacional do cliente atualizado.";
}

/**
 * Lê somente eventos de ciclo de vida que possuem uma prova auditável no log
 * operacional. O tenant é filtrado no banco e o CRM público é confirmado a
 * partir do metadata gravado pela própria transação de lifecycle.
 */
export async function listCrmLifecycleTimeline(
  crmClientId: string,
  clientId: string,
  executor: SqlExecutor = getPool(),
): Promise<CrmTimelineEntry[]> {
  const [rows] = await executor.execute(
    `SELECT a.audit_id, a.action, a.operator_user_id, a.metadata_json, a.created_at,
            COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(u.email), ''), a.operator_user_id, 'Sistema') AS author
       FROM megadesk_domain_audit_logs a
       LEFT JOIN megadesk_domain_client_users u
         ON u.client_id = a.client_id AND u.user_id = a.operator_user_id
      WHERE a.client_id = ?
        AND a.origin = 'crm_clients'
        AND a.event_phase = 'success'
        AND a.action IN ('crm_client_deactivate', 'crm_client_reactivate', 'crm_client_archive', 'crm_client_restore')
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [clientId],
  ) as any[];

  return (rows as any[]).flatMap(row => {
    const metadata = parseCrmLifecycleAuditMetadata(row.metadata_json);
    if (!metadata || metadata.crmClientId !== crmClientId) return [];
    return [{
      id: `audit-${row.audit_id}`,
      type: `lifecycle_${String(row.action).replace("crm_client_", "")}`,
      description: lifecycleAuditDescription(String(row.action), metadata),
      author: row.author ?? "Sistema",
      createdAt: row.created_at,
    }];
  });
}

export async function listCrmTimeline(
  crmClientId: string,
  clientId: string,
  executor: SqlExecutor = getPool(),
): Promise<CrmTimelineEntry[]> {
  const [rows] = await executor.execute(
    `SELECT t.timeline_id, t.entry_type, t.description, t.author AS persisted_author, t.created_at,
            COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(t.author), ''), 'Sistema') AS author
       FROM megadesk_crm_timeline t
       LEFT JOIN megadesk_domain_client_users u
         ON u.client_id = t.client_id AND LOWER(u.email) = LOWER(t.author)
      WHERE t.crm_client_id = ? AND t.client_id = ?
      ORDER BY t.created_at DESC LIMIT 100`,
    [crmClientId, clientId]
  ) as any[];
  return (rows as any[]).map(r => ({
    id: r.timeline_id,
    type: r.entry_type,
    description: timelineDescriptionWithResolvedActor(r),
    author: r.author,
    createdAt: r.created_at,
  }));
}
