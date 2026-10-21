import { getPool } from "../../../db";
import { randomUUID } from "crypto";
import { normalizeDigits, normalizeEmail } from "../../../_core/provisioning-guards";
import {
  normalizeContactPhone,
  contactPhoneStorageDigitsVariants,
  sameContactPhone,
} from "../../../../shared/contact-phone";
import type {
  LeadListInput,
  LeadCreateInput,
  LeadUpdateInput,
  LeadConvertInput,
  LeadView,
  LeadContactItem,
} from "./contracts";
import { addCrmTimeline, listCrmTimeline } from "../../../db-crm";

function normalizeStoredPhone(value: string | undefined, nullable: boolean): string | null {
  const result = normalizeContactPhone(value);
  if (result.status === "empty") return nullable ? null : "";
  if (result.status === "invalid") throw new Error(result.reason);
  return result.value;
}

function parseContacts(raw: string | null | undefined): LeadContactItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: any) => ({
      name: typeof item.name === "string" ? item.name : "",
      role: typeof item.role === "string" ? item.role : "",
      phone: typeof item.phone === "string" ? item.phone : "",
      whatsapp: typeof item.whatsapp === "string" ? item.whatsapp : "",
      email: typeof item.email === "string" ? item.email : "",
      description: typeof item.description === "string" ? item.description : "",
    }));
  } catch {
    return [];
  }
}

function mapRowToLeadView(row: any): LeadView {
  return {
    crmClientId: row.crm_client_id,
    customerType: row.customer_type ?? null,
    companyName: row.company_name,
    responsibleName: row.responsible_name ?? "",
    cpfCnpj: row.cpf_cnpj ?? null,
    phone: row.phone ?? null,
    whatsapp: row.whatsapp ?? "",
    email: row.email ?? null,
    status: row.status,
    origin: row.origin,
    internalResponsible: row.internal_responsible ?? "",
    tags: row.tags ?? "",
    observations: row.observations ?? "",
    contacts: parseContacts(row.contacts_json),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export type ExistingCrmClientMatch = {
  crm_client_id: string;
  client_id: string;
  customer_type: string | null;
  company_name: string;
  responsible_name: string | null;
  cpf_cnpj: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  status: string;
  origin: string | null;
  internal_responsible: string | null;
  tags: string | null;
  observations: string | null;
  contacts_json: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function findExistingLeadOrClient(
  clientId: string,
  criteria: {
    cpfCnpj?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    email?: string | null;
    contacts?: LeadContactItem[];
  },
  executor: { execute: (sql: string, params?: unknown[]) => Promise<unknown> } = getPool()
): Promise<ExistingCrmClientMatch | null> {
  const conditions: string[] = [];
  const params: unknown[] = [clientId];

  // 1. Document (CPF/CNPJ)
  const cleanedDoc = criteria.cpfCnpj ? normalizeDigits(criteria.cpfCnpj) : null;
  if (cleanedDoc && cleanedDoc.length >= 8) {
    conditions.push("(cpf_cnpj IS NOT NULL AND cpf_cnpj = ?)");
    params.push(cleanedDoc);
  }

  // 2. Telefone e WhatsApp normalizados com variantes canônicas
  const phoneVariantsSet = new Set<string>();
  const collectVariants = (val: string | null | undefined) => {
    if (!val) return;
    const norm = normalizeContactPhone(val);
    if (norm.status === "valid") {
      const vars = contactPhoneStorageDigitsVariants(norm.value);
      vars.forEach(v => phoneVariantsSet.add(v));
    }
  };

  collectVariants(criteria.phone);
  collectVariants(criteria.whatsapp);
  if (Array.isArray(criteria.contacts)) {
    for (const c of criteria.contacts) {
      collectVariants(c.phone);
      collectVariants(c.whatsapp);
    }
  }

  const phoneVariants = Array.from(phoneVariantsSet);
  if (phoneVariants.length > 0) {
    const placeholders = phoneVariants.map(() => "?").join(", ");
    conditions.push(
      `(phone IS NOT NULL AND phone IN (${placeholders}))`,
      `(whatsapp IS NOT NULL AND whatsapp <> '' AND whatsapp IN (${placeholders}))`
    );
    params.push(...phoneVariants, ...phoneVariants);

    for (const pv of phoneVariants) {
      if (pv.length >= 8) {
        conditions.push(`(contacts_json IS NOT NULL AND contacts_json LIKE ?)`);
        params.push(`%${pv}%`);
      }
    }
  }

  // 3. E-mail (principal e contatos secundários)
  const emailSet = new Set<string>();
  if (criteria.email && criteria.email.trim()) {
    emailSet.add(criteria.email.trim().toLowerCase());
  }
  if (Array.isArray(criteria.contacts)) {
    for (const c of criteria.contacts) {
      if (c.email && c.email.trim()) {
        emailSet.add(c.email.trim().toLowerCase());
      }
    }
  }
  const emails = Array.from(emailSet);
  if (emails.length > 0) {
    const placeholders = emails.map(() => "?").join(", ");
    conditions.push(`(email IS NOT NULL AND LOWER(email) IN (${placeholders}))`);
    params.push(...emails);

    for (const em of emails) {
      conditions.push(`(contacts_json IS NOT NULL AND LOWER(contacts_json) LIKE ?)`);
      params.push(`%${em}%`);
    }
  }

  if (conditions.length === 0) return null;

  const sql = `
    SELECT crm_client_id, client_id, customer_type, company_name, responsible_name,
           cpf_cnpj, phone, whatsapp, email, status, origin, internal_responsible,
           tags, observations, contacts_json, created_at, updated_at
    FROM megadesk_crm_clients
    WHERE client_id = ? AND lifecycle_state = 'active'
      AND (${conditions.join(" OR ")})
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `;

  const [rows] = await executor.execute(sql, params) as any[];
  if (!rows || rows.length === 0) return null;
  return rows[0] as ExistingCrmClientMatch;
}

export async function listLeads(
  clientId: string,
  input: LeadListInput
): Promise<{ leads: LeadView[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const pool = getPool();
  const whereClauses: string[] = ["client_id = ?", "lifecycle_state = 'active'"];
  const params: unknown[] = [clientId];

  if (input.status && input.status !== "all") {
    whereClauses.push("status = ?");
    params.push(input.status);
  }

  if (input.origin) {
    whereClauses.push("origin = ?");
    params.push(input.origin);
  }

  if (input.internalResponsible && input.internalResponsible.trim()) {
    whereClauses.push("internal_responsible = ?");
    params.push(input.internalResponsible.trim());
  }

  if (input.dateFrom) {
    whereClauses.push("DATE(created_at) >= ?");
    params.push(input.dateFrom);
  }

  if (input.dateTo) {
    whereClauses.push("DATE(created_at) <= ?");
    params.push(input.dateTo);
  }

  if (input.search && input.search.trim()) {
    const rawSearch = input.search.trim();
    const term = `%${rawSearch}%`;
    const searchConditions: string[] = [
      "company_name LIKE ?",
      "responsible_name LIKE ?",
      "email LIKE ?",
      "phone LIKE ?",
      "whatsapp LIKE ?",
    ];
    params.push(term, term, term, term, term);

    const phoneVariants = contactPhoneStorageDigitsVariants(rawSearch);
    if (phoneVariants.length > 0) {
      for (const variant of phoneVariants) {
        searchConditions.push("phone LIKE ?", "whatsapp LIKE ?");
        params.push(`%${variant}%`, `%${variant}%`);
      }
    }

    const docDigits = rawSearch.replace(/\D/g, "");
    if (docDigits.length >= 8) {
      searchConditions.push("cpf_cnpj LIKE ?");
      params.push(`%${docDigits}%`);
    }

    whereClauses.push(`(${searchConditions.join(" OR ")})`);
  }

  const whereSql = whereClauses.join(" AND ");

  // Total count
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM megadesk_crm_clients WHERE ${whereSql}`,
    params
  ) as any[];
  const total = Number((countRows as any[])[0]?.total ?? 0);

  // Pagination
  const page = Math.max(1, input.page);
  const pageSize = Math.max(1, Math.min(100, input.pageSize));
  const offset = (page - 1) * pageSize;
  const totalPages = Math.ceil(total / pageSize) || 1;

  const [rows] = await pool.execute(
    `SELECT crm_client_id, client_id, customer_type, company_name, responsible_name,
            cpf_cnpj, phone, whatsapp, email, status, origin, internal_responsible,
            tags, observations, contacts_json, created_at, updated_at
     FROM megadesk_crm_clients
     WHERE ${whereSql}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  ) as any[];

  const leads = (rows as any[]).map(mapRowToLeadView);

  return {
    leads,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function getLeadsSummary(clientId: string): Promise<{
  total: number;
  activeLeads: number;
  convertedLeads: number;
  inactiveLeads: number;
  cancelledLeads: number;
}> {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status = 'lead' THEN 1 ELSE 0 END), 0) AS activeLeads,
       COALESCE(SUM(CASE WHEN status = 'ativo' THEN 1 ELSE 0 END), 0) AS convertedLeads,
       COALESCE(SUM(CASE WHEN status = 'inativo' THEN 1 ELSE 0 END), 0) AS inactiveLeads,
       COALESCE(SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END), 0) AS cancelledLeads
     FROM megadesk_crm_clients
     WHERE client_id = ? AND lifecycle_state = 'active'`,
    [clientId]
  ) as any[];

  const r = (rows as any[])[0] || {};
  return {
    total: Number(r.total || 0),
    activeLeads: Number(r.activeLeads || 0),
    convertedLeads: Number(r.convertedLeads || 0),
    inactiveLeads: Number(r.inactiveLeads || 0),
    cancelledLeads: Number(r.cancelledLeads || 0),
  };
}

export async function getLeadById(
  clientId: string,
  crmClientId: string
): Promise<LeadView | null> {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT crm_client_id, client_id, customer_type, company_name, responsible_name,
            cpf_cnpj, phone, whatsapp, email, status, origin, internal_responsible,
            tags, observations, contacts_json, created_at, updated_at
     FROM megadesk_crm_clients
     WHERE client_id = ? AND crm_client_id = ?
     LIMIT 1`,
    [clientId, crmClientId]
  ) as any[];

  if (!(rows as any[])[0]) return null;
  return mapRowToLeadView((rows as any[])[0]);
}

export async function createLead(
  clientId: string,
  input: LeadCreateInput,
  actor: string
): Promise<{ crmClientId: string; deduplicated?: boolean; status?: string }> {
  const normalizedPhone = normalizeStoredPhone(input.phone, true);
  const normalizedWhatsapp = normalizeStoredPhone(input.whatsapp, false) ?? "";
  const rawEmail = input.email && input.email.trim() ? normalizeEmail(input.email) : null;
  const normalizedEmail = rawEmail && rawEmail.length > 0 ? rawEmail : null;
  const rawDoc = input.cpfCnpj ? normalizeDigits(input.cpfCnpj) : null;
  const normalizedDoc = rawDoc && rawDoc.length > 0 ? rawDoc : null;

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    // 1. Checagem de existência prévia para deduplicação (upsert / reúso)
    const existing = await findExistingLeadOrClient(
      clientId,
      {
        cpfCnpj: normalizedDoc,
        phone: normalizedPhone,
        whatsapp: normalizedWhatsapp,
        email: normalizedEmail,
        contacts: input.contacts,
      },
      connection
    );

    if (existing) {
      const crmClientId = existing.crm_client_id;
      const updates: string[] = ["updated_at = NOW()"];
      const updateParams: unknown[] = [];

      // Atualizar campos vazios ou complementares sem sobrescrever dados válidos pré-existentes
      if ((!existing.company_name || existing.company_name.trim().toLowerCase() === "sem nome") && input.companyName?.trim()) {
        updates.push("company_name = ?");
        updateParams.push(input.companyName.trim());
      }

      if (!existing.responsible_name && input.responsibleName?.trim()) {
        updates.push("responsible_name = ?");
        updateParams.push(input.responsibleName.trim());
      }

      if (!existing.customer_type && input.customerType) {
        updates.push("customer_type = ?");
        updateParams.push(input.customerType);
      }

      if (!existing.cpf_cnpj && normalizedDoc) {
        updates.push("cpf_cnpj = ?");
        updateParams.push(normalizedDoc);
      }

      if (!existing.phone && normalizedPhone) {
        updates.push("phone = ?");
        updateParams.push(normalizedPhone);
      }

      if ((!existing.whatsapp || existing.whatsapp === "") && normalizedWhatsapp) {
        updates.push("whatsapp = ?");
        updateParams.push(normalizedWhatsapp);
      }

      if (!existing.email && normalizedEmail) {
        updates.push("email = ?");
        updateParams.push(normalizedEmail);
      }

      if ((!existing.origin || existing.origin === "outro") && input.origin && input.origin !== "outro") {
        updates.push("origin = ?");
        updateParams.push(input.origin);
      }

      if (!existing.internal_responsible && input.internalResponsible?.trim()) {
        updates.push("internal_responsible = ?");
        updateParams.push(input.internalResponsible.trim());
      }

      // Merge inteligente de tags sem duplicação
      if (input.tags?.trim()) {
        const existingTags = (existing.tags || "").split(",").map(t => t.trim()).filter(Boolean);
        const newTags = input.tags.split(",").map(t => t.trim()).filter(Boolean);
        const mergedTags = Array.from(new Set([...existingTags, ...newTags])).join(", ");
        if (mergedTags !== (existing.tags || "")) {
          updates.push("tags = ?");
          updateParams.push(mergedTags);
        }
      }

      // Concatenação de novas observações com carimbo de contexto
      if (input.observations?.trim()) {
        const currentObs = existing.observations?.trim() || "";
        const newObs = input.observations.trim();
        if (!currentObs.includes(newObs)) {
          const mergedObs = currentObs
            ? `${currentObs}\n\n[Prospecção via ${input.origin}]: ${newObs}`
            : newObs;
          updates.push("observations = ?");
          updateParams.push(mergedObs);
        }
      }

      // Merge de contatos adicionais B2B
      if (input.contacts && input.contacts.length > 0) {
        const existingContacts = parseContacts(existing.contacts_json);
        const mergedContacts = [...existingContacts];
        for (const c of input.contacts) {
          const alreadyExists = existingContacts.some(ec =>
            (c.phone && sameContactPhone(ec.phone, c.phone)) ||
            (c.whatsapp && sameContactPhone(ec.whatsapp, c.whatsapp)) ||
            (c.email && c.email.trim().toLowerCase() === ec.email.trim().toLowerCase()) ||
            (c.name && ec.name && c.name.trim().toLowerCase() === ec.name.trim().toLowerCase())
          );
          if (!alreadyExists && (c.name || c.phone || c.email)) {
            mergedContacts.push(c);
          }
        }
        if (mergedContacts.length > existingContacts.length) {
          updates.push("contacts_json = ?");
          updateParams.push(JSON.stringify(mergedContacts));
        }
      }

      // Se cadastro anterior estava inativo ou cancelado, reativa como lead
      let finalStatus = existing.status;
      if (existing.status === "inativo" || existing.status === "cancelado") {
        updates.push("status = 'lead'");
        finalStatus = "lead";
      }

      updateParams.push(clientId, crmClientId);
      await connection.execute(
        `UPDATE megadesk_crm_clients SET ${updates.join(", ")} WHERE client_id = ? AND crm_client_id = ?`,
        updateParams
      );

      await addCrmTimeline(crmClientId, clientId, {
        type: "note",
        description: `Lead/Contato registrado via ${input.origin} por ${actor}. Dados complementares vinculados ao cadastro existente (${existing.company_name}).`,
        author: actor,
      }, connection);

      await connection.commit();
      return { crmClientId, deduplicated: true, status: finalStatus };
    }

    // 2. Se não existir duplicata, cria novo registro canônico
    const crmClientId = `crm-${randomUUID()}`;

    await connection.execute(
      `INSERT INTO megadesk_crm_clients (
        crm_client_id, client_id, customer_type, company_name, responsible_name,
        cpf_cnpj, phone, whatsapp, email, status, origin, internal_responsible,
        tags, observations, contacts_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lead', ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        crmClientId,
        clientId,
        input.customerType,
        input.companyName.trim(),
        input.responsibleName?.trim() ?? "",
        normalizedDoc,
        normalizedPhone,
        normalizedWhatsapp,
        normalizedEmail,
        input.origin,
        input.internalResponsible?.trim() ?? "",
        input.tags?.trim() ?? "",
        input.observations?.trim() ?? "",
        input.contacts && input.contacts.length > 0 ? JSON.stringify(input.contacts) : "",
      ]
    );

    await addCrmTimeline(crmClientId, clientId, {
      type: "note",
      description: `Lead cadastrado por ${actor} via ${input.origin}.`,
      author: actor,
    }, connection);

    await connection.commit();
    return { crmClientId, deduplicated: false, status: "lead" };
  } catch (error: any) {
    await connection.rollback();
    const msg = String(error?.message || "");
    if (msg.includes("Duplicate entry") || msg.includes("uq_mcc_tenant")) {
      // Reúso concorrente em caso de race condition de chave única
      const fallback = await findExistingLeadOrClient(clientId, {
        cpfCnpj: normalizedDoc,
        phone: normalizedPhone,
        whatsapp: normalizedWhatsapp,
        email: normalizedEmail,
        contacts: input.contacts,
      });
      if (fallback) {
        return { crmClientId: fallback.crm_client_id, deduplicated: true, status: fallback.status };
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateLead(
  clientId: string,
  crmClientId: string,
  input: LeadUpdateInput,
  actor: string
): Promise<void> {
  const pool = getPool();
  const existing = await getLeadById(clientId, crmClientId);
  if (!existing) {
    throw new Error("Lead não encontrado ou sem permissão.");
  }

  const updates: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];

  if (input.companyName !== undefined) {
    updates.push("company_name = ?");
    params.push(input.companyName);
  }

  if (input.customerType !== undefined) {
    updates.push("customer_type = ?");
    params.push(input.customerType);
  }

  if (input.responsibleName !== undefined) {
    updates.push("responsible_name = ?");
    params.push(input.responsibleName);
  }

  if (input.cpfCnpj !== undefined) {
    updates.push("cpf_cnpj = ?");
    const rawDoc = input.cpfCnpj ? normalizeDigits(input.cpfCnpj) : null;
    params.push(rawDoc && rawDoc.length > 0 ? rawDoc : null);
  }

  if (input.phone !== undefined) {
    updates.push("phone = ?");
    params.push(normalizeStoredPhone(input.phone, true));
  }

  if (input.whatsapp !== undefined) {
    updates.push("whatsapp = ?");
    params.push(normalizeStoredPhone(input.whatsapp, false) ?? "");
  }

  if (input.email !== undefined) {
    updates.push("email = ?");
    const rawEmail = input.email && input.email.trim() ? normalizeEmail(input.email) : null;
    params.push(rawEmail && rawEmail.length > 0 ? rawEmail : null);
  }

  if (input.origin !== undefined) {
    updates.push("origin = ?");
    params.push(input.origin);
  }

  if (input.internalResponsible !== undefined) {
    updates.push("internal_responsible = ?");
    params.push(input.internalResponsible);
  }

  if (input.tags !== undefined) {
    updates.push("tags = ?");
    params.push(input.tags);
  }

  if (input.observations !== undefined) {
    updates.push("observations = ?");
    params.push(input.observations);
  }

  if (input.contacts !== undefined) {
    updates.push("contacts_json = ?");
    params.push(JSON.stringify(input.contacts));
  }

  params.push(clientId, crmClientId);

  await pool.execute(
    `UPDATE megadesk_crm_clients SET ${updates.join(", ")} WHERE client_id = ? AND crm_client_id = ?`,
    params
  );

  await addCrmTimeline(crmClientId, clientId, {
    type: "edit",
    description: `Dados do Lead atualizados por ${actor}.`,
    author: actor,
  });
}

export async function convertLeadToClient(
  clientId: string,
  input: LeadConvertInput,
  actor: string
): Promise<{ crmClientId: string; companyName: string }> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT crm_client_id, company_name, status FROM megadesk_crm_clients
       WHERE client_id = ? AND crm_client_id = ? FOR UPDATE`,
      [clientId, input.crmClientId]
    ) as any[];

    const existing = (rows as any[])[0];
    if (!existing) {
      throw new Error("Lead não encontrado ou sem permissão.");
    }

    if (existing.status === "ativo") {
      throw new Error("Este lead já foi convertido em cliente ativo.");
    }

    if (existing.status !== "lead") {
      throw new Error(`Este lead não pode ser convertido pois está com status '${existing.status}'.`);
    }

    const updates: string[] = ["status = 'ativo'", "updated_at = NOW()"];
    const params: unknown[] = [];

    if (input.companyName && input.companyName.trim()) {
      updates.push("company_name = ?");
      params.push(input.companyName.trim());
    }

    if (input.customerType) {
      updates.push("customer_type = ?");
      params.push(input.customerType);
    }

    if (input.responsibleName !== undefined) {
      updates.push("responsible_name = ?");
      params.push(input.responsibleName.trim());
    }

    if (input.cpfCnpj !== undefined) {
      const rawDoc = input.cpfCnpj ? normalizeDigits(input.cpfCnpj) : null;
      if (rawDoc && rawDoc.length > 0) {
        updates.push("cpf_cnpj = ?");
        params.push(rawDoc);
      }
    }

    params.push(clientId, input.crmClientId);

    const [updateResult] = await connection.execute(
      `UPDATE megadesk_crm_clients SET ${updates.join(", ")}
       WHERE client_id = ? AND crm_client_id = ? AND status = 'lead'`,
      params
    ) as any[];

    const affectedRows = (updateResult as any)?.affectedRows ?? 0;
    if (affectedRows !== 1) {
      throw new Error("Falha na conversão concorrente do lead. O status já foi alterado por outra requisição.");
    }

    const notesSuffix = input.notes ? ` Nota: ${input.notes}` : "";
    await addCrmTimeline(input.crmClientId, clientId, {
      type: "status_change",
      description: `Lead qualificado e convertido em Cliente Ativo por ${actor}.${notesSuffix}`,
      author: actor,
    }, connection);

    await connection.commit();

    return {
      crmClientId: input.crmClientId,
      companyName: input.companyName?.trim() || existing.company_name,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getLeadTimeline(
  clientId: string,
  crmClientId: string
) {
  return listCrmTimeline(crmClientId, clientId);
}

export async function addLeadTimelineNote(
  clientId: string,
  crmClientId: string,
  note: string,
  actor: string
): Promise<void> {
  const existing = await getLeadById(clientId, crmClientId);
  if (!existing) {
    throw new Error("Lead não encontrado ou sem permissão.");
  }
  await addCrmTimeline(crmClientId, clientId, {
    type: "note",
    description: note,
    author: actor,
  });
}
