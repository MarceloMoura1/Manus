import {
  contactPhoneStorageDigitsVariants,
  normalizeContactPhone,
  sameContactPhone,
} from "../shared/contact-phone";

type SqlExecutor = {
  execute(sql: string, values?: unknown[]): Promise<unknown>;
};

type CrmRecipientRow = {
  crmClientId: string;
  companyName: string;
  responsibleName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  contactsJson: string | null;
};

export type AttendanceRecipient = {
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

function selectRecipient(row: CrmRecipientRow, term: string, canonicalPhone: string | null): AttendanceRecipient | null {
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

function rowsFrom(result: unknown): CrmRecipientRow[] {
  const rows = Array.isArray(result) ? result[0] : [];
  return Array.isArray(rows) ? rows as CrmRecipientRow[] : [];
}

export async function searchAttendanceRecipients(
  executor: SqlExecutor,
  tenantId: string,
  query: string,
): Promise<{ canonicalPhone: string | null; candidates: AttendanceRecipient[] }> {
  const term = query.trim();
  const normalized = normalizeContactPhone(term);
  const canonicalPhone = normalized.status === "valid" ? normalized.value : null;
  const variants = canonicalPhone ? contactPhoneStorageDigitsVariants(canonicalPhone) : [];
  const textSearch = `%${term}%`;
  const clauses = ["company_name LIKE ?", "responsible_name LIKE ?"];
  const values: unknown[] = [tenantId, textSearch, textSearch];

  if (variants.length) {
    const placeholders = variants.map(() => "?").join(", ");
    clauses.push(
      `REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '') IN (${placeholders})`,
      `REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '') IN (${placeholders})`,
      `(${variants.map(() => "REGEXP_REPLACE(COALESCE(contacts_json, ''), '[^0-9]', '') LIKE CONCAT('%', ?, '%')").join(" OR ")})`,
    );
    values.push(...variants, ...variants, ...variants);
  }

  const result = await executor.execute(
    `SELECT crm_client_id AS crmClientId, company_name AS companyName,
            responsible_name AS responsibleName, phone, whatsapp, email,
            contacts_json AS contactsJson
       FROM megadesk_crm_clients
      WHERE client_id = ? AND lifecycle_state = 'active'
        AND (${clauses.join(" OR ")})
      ORDER BY company_name, crm_client_id LIMIT 25`,
    values,
  );
  const candidates = rowsFrom(result)
    .map(row => selectRecipient(row, term, canonicalPhone))
    .filter((candidate): candidate is AttendanceRecipient => Boolean(candidate))
    .slice(0, 10);
  return { canonicalPhone, candidates };
}

export async function findAttendanceRecipientByPhone(
  executor: SqlExecutor,
  tenantId: string,
  phone: string,
): Promise<AttendanceRecipient | null> {
  const lookup = await searchAttendanceRecipients(executor, tenantId, phone);
  if (!lookup.canonicalPhone) return null;
  return lookup.candidates.find(candidate => candidate.recipientPhone === lookup.canonicalPhone) ?? null;
}
