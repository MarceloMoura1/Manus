import { getPool } from "./db";
import { normalizeContactPhone } from "../shared/contact-phone";

type SqlExecutor = {
  execute(sql: string, values?: unknown[]): Promise<unknown>;
};

export type ConversationContact = {
  contactId: string;
  displayName: string;
  canonicalPhone: string | null;
  crmClientId: string | null;
};

function canonicalPhoneOrNull(value: string): string | null {
  const normalized = normalizeContactPhone(value);
  return normalized.status === "valid" ? normalized.value : null;
}

export async function findConversationContactByPhone(
  clientId: string,
  phone: string,
  executor: SqlExecutor = getPool(),
): Promise<ConversationContact | null> {
  const canonicalPhone = canonicalPhoneOrNull(phone);
  if (!canonicalPhone) return null;
  const [rows] = await executor.execute(
    `SELECT contact_id AS contactId, display_name AS displayName,
            canonical_phone AS canonicalPhone, crm_client_id AS crmClientId
       FROM megadesk_conversation_contacts
      WHERE client_id = ? AND channel = 'whatsapp' AND provider = 'evolution'
        AND (canonical_phone = ? OR external_identity = ?)
      ORDER BY updated_at DESC LIMIT 1`,
    [clientId, canonicalPhone, canonicalPhone],
  ) as [ConversationContact[]];
  return rows[0] ?? null;
}

/** Searches only standalone conversation contacts; CRM-backed contacts are resolved by the CRM service. */
export async function searchLightweightContactsForAttendance(
  clientId: string,
  query: string,
  executor: SqlExecutor = getPool(),
): Promise<{ canonicalPhone: string | null; contacts: ConversationContact[] }> {
  const term = query.trim();
  const canonicalPhone = canonicalPhoneOrNull(term);
  const [rows] = await executor.execute(
    canonicalPhone
      ? `SELECT contact_id AS contactId, display_name AS displayName,
                canonical_phone AS canonicalPhone, crm_client_id AS crmClientId
           FROM megadesk_conversation_contacts
          WHERE client_id = ? AND channel = 'whatsapp' AND provider = 'evolution'
            AND crm_client_id IS NULL
            AND (canonical_phone = ? OR external_identity = ?)
          ORDER BY updated_at DESC LIMIT 10`
      : `SELECT contact_id AS contactId, display_name AS displayName,
                canonical_phone AS canonicalPhone, crm_client_id AS crmClientId
           FROM megadesk_conversation_contacts
          WHERE client_id = ? AND channel = 'whatsapp' AND provider = 'evolution'
            AND crm_client_id IS NULL AND display_name LIKE ?
          ORDER BY updated_at DESC LIMIT 10`,
    canonicalPhone ? [clientId, canonicalPhone, canonicalPhone] : [clientId, `%${term}%`],
  ) as [ConversationContact[]];
  return { canonicalPhone, contacts: rows };
}
