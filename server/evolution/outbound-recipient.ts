import { normalizeEvolutionRecipient } from "./client";

type QueryExecutor = {
  execute(sql: string, values: unknown[]): Promise<unknown>;
};

export type OutboundConversation = {
  conversationId: string;
  clientId: string;
  integrationId: string;
  conversationPhone: string;
  crmWhatsapp: string | null;
  crmPhone: string | null;
};

export type OutboundRecipientInput = {
  conversationPhone?: string | null;
  crmWhatsapp?: string | null;
  crmPhone?: string | null;
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  mappedLidPhone?: string | null;
};

function phoneFromJid(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? "";
  if (!candidate || candidate.endsWith("@lid") || candidate.startsWith("lid")) return null;
  if (candidate.includes("@") && !candidate.endsWith("@s.whatsapp.net")) return null;
  return candidate.replace(/@s\.whatsapp\.net$/, "");
}

function canonicalPhone(value: string | null | undefined): string | null {
  const candidate = phoneFromJid(value);
  if (!candidate) return null;
  try {
    return normalizeEvolutionRecipient(candidate);
  } catch {
    return null;
  }
}

/**
 * Resolve somente endereços comprovadamente telefônicos. Um LID nunca é
 * reinterpretado como número: ele precisa de telefone alternativo ou mapping.
 */
export function resolveOutboundRecipient(input: OutboundRecipientInput): string {
  const candidates = [
    input.crmWhatsapp,
    input.crmPhone,
    input.conversationPhone,
    input.remoteJid,
    input.remoteJidAlt,
    input.mappedLidPhone,
  ];
  for (const candidate of candidates) {
    const canonical = canonicalPhone(candidate);
    if (canonical) return canonical;
  }
  throw new Error("A conversa não possui um destinatário de WhatsApp seguro.");
}

function rowsOf(result: unknown): any[] {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
}

/** Busca autoritativa por conversa + tenant; não depende do snapshot em memória. */
export async function loadOutboundConversation(
  executor: QueryExecutor,
  tenantId: string,
  conversationId: string,
): Promise<OutboundConversation | null> {
  const rows = rowsOf(await executor.execute(
    `SELECT c.conversation_id AS conversationId,
            c.client_id AS clientId,
            COALESCE(c.integration_id, CONCAT('megadesk-', c.client_id)) AS integrationId,
            c.phone AS conversationPhone,
            crm.whatsapp AS crmWhatsapp,
            crm.phone AS crmPhone
       FROM megadesk_domain_conversations c
       LEFT JOIN megadesk_crm_clients crm
         ON crm.crm_client_id = c.crm_client_id
        AND crm.client_id = c.client_id
      WHERE c.conversation_id = ? AND c.client_id = ?
      LIMIT 1`,
    [conversationId, tenantId],
  ));
  if (!rows.length) return null;
  const row = rows[0];
  return {
    conversationId: String(row.conversationId),
    clientId: String(row.clientId),
    integrationId: String(row.integrationId),
    conversationPhone: String(row.conversationPhone ?? ""),
    crmWhatsapp: row.crmWhatsapp == null ? null : String(row.crmWhatsapp),
    crmPhone: row.crmPhone == null ? null : String(row.crmPhone),
  };
}

export function safeOutboundProviderMessage(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (message === "A conversa não possui um destinatário de WhatsApp seguro.") return message;
  if (status === 400 || status === 422) return "A Evolution rejeitou o destinatário ou o conteúdo da mensagem.";
  if (status === 401 || status === 403) return "A Evolution recusou a autenticação configurada.";
  if (status === 404) return "A instância do WhatsApp não foi encontrada na Evolution.";
  if (status >= 500 || name === "TimeoutError" || /timeout|ECONNREFUSED/i.test(message)) {
    return "A Evolution está temporariamente indisponível.";
  }
  return "Não foi possível enviar a mensagem pelo WhatsApp.";
}
