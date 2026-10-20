import { getPool } from "../../../db";
import { randomUUID } from "crypto";
import { normalizeDigits, normalizeEmail } from "../../../_core/provisioning-guards";
import { normalizeContactPhone } from "../../../../shared/contact-phone";
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

export async function listLeads(
  clientId: string,
  input: LeadListInput
): Promise<{ leads: LeadView[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const pool = getPool();
  const whereClauses: string[] = ["client_id = ?", "lifecycle_state = 'active'"];
  const params: unknown[] = [clientId];

  if (input.status) {
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
    const term = `%${input.search.trim()}%`;
    whereClauses.push(
      "(company_name LIKE ? OR responsible_name LIKE ? OR email LIKE ? OR phone LIKE ? OR whatsapp LIKE ?)"
    );
    params.push(term, term, term, term, term);
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
): Promise<{ crmClientId: string }> {
  const connection = await getPool().getConnection();
  const crmClientId = `crm-${randomUUID()}`;

  const normalizedPhone = normalizeStoredPhone(input.phone, true);
  const normalizedWhatsapp = normalizeStoredPhone(input.whatsapp, false) ?? "";
  const rawEmail = input.email && input.email.trim() ? normalizeEmail(input.email) : null;
  const normalizedEmail = rawEmail && rawEmail.length > 0 ? rawEmail : null;
  const rawDoc = input.cpfCnpj ? normalizeDigits(input.cpfCnpj) : null;
  const normalizedDoc = rawDoc && rawDoc.length > 0 ? rawDoc : null;

  try {
    await connection.beginTransaction();

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
        input.companyName,
        input.responsibleName ?? "",
        normalizedDoc,
        normalizedPhone,
        normalizedWhatsapp,
        normalizedEmail,
        input.origin,
        input.internalResponsible ?? "",
        input.tags ?? "",
        input.observations ?? "",
        input.contacts ? JSON.stringify(input.contacts) : "",
      ]
    );

    await addCrmTimeline(crmClientId, clientId, {
      type: "note",
      description: `Lead cadastrado por ${actor} via ${input.origin}.`,
      author: actor,
    }, connection);

    await connection.commit();
    return { crmClientId };
  } catch (error) {
    await connection.rollback();
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
