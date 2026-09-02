import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { normalizeContactPhone } from "../shared/contact-phone";
import { z } from "zod";
import { router, megadeskProcedure } from "./_core/trpc";
import { getPool } from "./db";

const id = z.string().min(1).max(80);
const listInput = z.object({
  viewMode: z.enum(["all", "mine", "waiting"]).default("all"),
  status: z.enum(["active", "closed"]).default("active"),
  search: z.string().trim().max(120).default(""),
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().min(0).default(0),
});

const CONVERSATION_ROLES = new Set(["admin", "manager", "agent"]);

export function requireConversationAccess(ctx: { operationalUserRole?: string; operationalPermissions?: string[] }, permission = "conversations") {
  if (!ctx.operationalUserRole || !CONVERSATION_ROLES.has(ctx.operationalUserRole)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Operador sem acesso a Conversas." });
  }
  if (ctx.operationalPermissions && !ctx.operationalPermissions.includes(permission)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Operador sem acesso a Conversas." });
  }
}

function attendanceEvent(connection: any, tenantId: string, conversationId: string, eventType: string,
  operatorUserId: string | null, metadata: Record<string, string> = {}) {
  return connection.execute(
    `INSERT INTO megadesk_conversation_events
     (event_id, client_id, conversation_id, event_type, operator_user_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`event-${randomUUID()}`, tenantId, conversationId, eventType, operatorUserId, JSON.stringify(metadata)],
  );
}

export function normalizedMessage(row: Record<string, any>) {
  let media: Record<string, unknown> = {};
  if (typeof row.mediaReference === "string" && row.mediaReference) {
    try { media = JSON.parse(row.mediaReference); } catch { media = {}; }
  }
  return { ...row, ...media, mediaReference: row.mediaReference ?? null };
}

async function eligibleUser(tenantId: string, userId: string) {
  const [rows] = await getPool().execute(
    `SELECT user_id, name FROM megadesk_domain_client_users
     WHERE client_id = ? AND user_id = ? AND status = 'active' AND role IN ('admin','manager','agent')
       AND JSON_CONTAINS(permissions_json, JSON_QUOTE('conversations')) LIMIT 1`,
    [tenantId, userId],
  ) as any[];
  if (!rows.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Usuário indisponível para atribuição." });
  return rows[0] as { user_id: string; name: string };
}

export const conversationsRouter = router({
  companyCandidates: megadeskProcedure.input(z.object({
    search: z.string().trim().max(120).default(""),
    limit: z.number().int().min(1).max(25).default(10),
    offset: z.number().int().min(0).default(0),
  })).query(async ({ input, ctx }) => {
    requireConversationAccess(ctx);
    const trimmed = input.search.trim();
    if (trimmed.length < 2) return { items: [], hasMore: false };
    const search = `%${trimmed}%`;
    const digits = trimmed.replace(/\D/g, "");
    const digitSearch = `%${digits}%`;
    const [rows] = await getPool().execute(
      `SELECT crm_client_id AS id, company_name AS name, responsible_name AS responsibleName,
              cpf_cnpj AS document, customer_type AS customerType, phone, whatsapp
       FROM megadesk_crm_clients
       WHERE client_id = ? AND lifecycle_state = 'active'
         AND (? = '%%' OR company_name LIKE ? OR responsible_name LIKE ? OR cpf_cnpj LIKE ?
           OR (? <> '%%' AND (phone LIKE ? OR whatsapp LIKE ?)))
       ORDER BY company_name, crm_client_id LIMIT ${input.limit} OFFSET ${input.offset}`,
      [ctx.tenantId, search, search, search, search, digitSearch, digitSearch, digitSearch],
    ) as any[];
    return { items: rows, hasMore: rows.length === input.limit };
  }),
  phoneCandidates: megadeskProcedure.input(z.object({ phone: z.string().max(40) }).strict())
    .query(async ({ input, ctx }) => {
      requireConversationAccess(ctx);
      const normalized = normalizeContactPhone(input.phone);
      if (normalized.status !== "valid") return { items: [] };
      const [rows] = await getPool().execute(
        `SELECT crm_client_id AS id, company_name AS name, responsible_name AS responsibleName,
                cpf_cnpj AS document, customer_type AS customerType, phone, whatsapp
         FROM megadesk_crm_clients
         WHERE client_id = ? AND lifecycle_state = 'active' AND (phone = ? OR whatsapp = ?)
         ORDER BY company_name, crm_client_id LIMIT 25`,
        [ctx.tenantId, normalized.value, normalized.value],
      ) as any[];
      return { items: rows };
    }),
  list: megadeskProcedure.input(listInput).query(async ({ input, ctx }) => {
    requireConversationAccess(ctx);
    const eligibleOwner = `EXISTS (SELECT 1 FROM megadesk_domain_client_users u
      WHERE u.client_id = c.client_id AND u.user_id = c.assigned_user_id AND u.status = 'active'
        AND u.role IN ('admin','manager','agent')
        AND JSON_CONTAINS(u.permissions_json, JSON_QUOTE('conversations')))`;
    const activeCondition = input.viewMode === "waiting"
      ? "c.status = 'bot' AND c.assigned_user_id IS NULL"
      : `c.status = 'open' AND c.assigned_user_id IS NOT NULL AND ${eligibleOwner}`;
    const conditions = ["c.client_id = ?", input.status === "closed" ? "c.status = 'closed'" : activeCondition];
    const values: unknown[] = [ctx.tenantId];
    if (input.status === "active" && input.viewMode === "mine") { conditions.push("c.assigned_user_id = ?"); values.push(ctx.operationalUserId); }
    if (input.search) {
      conditions.push("(UPPER(c.public_code) = UPPER(?) OR c.customer_name LIKE ? OR contact.display_name LIKE ? OR c.company LIKE ? OR c.phone LIKE ?)");
      values.push(input.search, `%${input.search}%`, `%${input.search}%`, `%${input.search}%`, `%${input.search.replace(/\D/g, "")}%`);
    }
    const [rows] = await getPool().execute(
      `SELECT c.conversation_id AS id, c.public_code AS publicCode, c.contact_id AS contactId,
       COALESCE(crm.responsible_name, crm.company_name, contact.display_name, c.customer_name) AS customerName, c.phone AS customerPhone,
       contact.company_text AS companyText, crm.company_name AS companyName, crm.customer_type AS customerType,
       crm.responsible_name AS crmResponsibleName, crm.phone AS crmPhone, crm.whatsapp AS crmWhatsapp, crm.email AS crmEmail,
       c.last_message AS lastMessage, c.updated_at AS lastMessageAt, c.unread_count AS unreadCount,
       c.provider AS provider, c.channel AS channel,
       CASE WHEN c.status = 'bot' THEN 'pending' ELSE c.status END AS status,
       c.assigned_user_id AS assignedUserId, c.assigned_user_name AS assignedUserName,
       c.last_message_from AS lastMessageFrom, crm.crm_client_id AS crmClientId, c.origin,
       c.created_at AS createdAt, c.closed_at AS closedAt
       FROM megadesk_domain_conversations c
       LEFT JOIN megadesk_conversation_contacts contact
         ON contact.contact_id = c.contact_id AND contact.client_id = c.client_id
       LEFT JOIN megadesk_crm_clients crm
         ON crm.crm_client_id = contact.crm_client_id AND crm.client_id = c.client_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY (c.public_code = ?) DESC, c.updated_at DESC LIMIT ${input.limit} OFFSET ${input.offset}`,
      [...values, input.search || ""],
    ) as any[];
    return rows;
  }),

  counts: megadeskProcedure.query(async ({ ctx }) => {
    requireConversationAccess(ctx);
    const [rows] = await getPool().execute(
      `SELECT SUM(c.status = 'open' AND c.assigned_user_id IS NOT NULL AND
         EXISTS (SELECT 1 FROM megadesk_domain_client_users u
           WHERE u.client_id = c.client_id AND u.user_id = c.assigned_user_id AND u.status = 'active'
             AND u.role IN ('admin','manager','agent')
             AND JSON_CONTAINS(u.permissions_json, JSON_QUOTE('conversations')))) AS active,
       SUM(c.status = 'closed') AS closed,
       SUM(c.status = 'bot' AND c.assigned_user_id IS NULL) AS waiting,
       SUM(c.status = 'open' AND c.assigned_user_id = ?) AS mine
       FROM megadesk_domain_conversations c WHERE c.client_id = ?`,
      [ctx.operationalUserId, ctx.tenantId],
    ) as any[];
    return Object.fromEntries(Object.entries(rows[0] ?? {}).map(([key, value]) => [key, Number(value ?? 0)]));
  }),

  close: megadeskProcedure.input(z.object({ conversationId: id, reason: z.string().trim().max(240).optional() }))
    .mutation(async ({ input, ctx }) => {
      requireConversationAccess(ctx);
      const connection = await getPool().getConnection();
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
          `UPDATE megadesk_domain_conversations SET status = 'closed', closed_at = NOW(),
           closed_by_user_id = ?, active_key = NULL, updated_at = NOW()
           WHERE conversation_id = ? AND client_id = ? AND status IN ('open','bot')`,
          [ctx.operationalUserId, input.conversationId, ctx.tenantId],
        ) as any[];
        if (!result.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "O atendimento já foi atualizado." });
        await attendanceEvent(connection, ctx.tenantId, input.conversationId, "closed", ctx.operationalUserId,
          input.reason ? { reason: input.reason } : {});
        await connection.commit(); return { ok: true };
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }),

  reopen: megadeskProcedure.input(z.object({ conversationId: id })).mutation(async ({ input, ctx }) => {
    requireConversationAccess(ctx);
    const user = await eligibleUser(ctx.tenantId, ctx.operationalUserId);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT conversation_id, active_key,
         SHA2(CONCAT(client_id, CHAR(0), provider, CHAR(0), integration_id, CHAR(0), contact_id), 256) AS requested_active_key
         FROM megadesk_domain_conversations
         WHERE conversation_id = ? AND client_id = ? AND status = 'closed' LIMIT 1 FOR UPDATE`,
        [input.conversationId, ctx.tenantId],
      ) as any[];
      if (!rows.length) throw new TRPCError({ code: "CONFLICT", message: "O atendimento não está encerrado." });
      const [otherActive] = await connection.execute(
        `SELECT conversation_id FROM megadesk_domain_conversations
         WHERE client_id = ? AND active_key = ? AND status IN ('open','bot') AND conversation_id <> ? LIMIT 1 FOR UPDATE`,
        [ctx.tenantId, rows[0].requested_active_key, input.conversationId],
      ) as any[];
      if (otherActive.length) throw new TRPCError({ code: "CONFLICT", message: "Já existe outro atendimento ativo para este contato." });
      const [result] = await connection.execute(
        `UPDATE megadesk_domain_conversations SET status = 'open', assigned_user_id = ?, assigned_user_name = ?,
         reopened_at = NOW(), reopened_by_user_id = ?, closed_at = NULL, closed_by_user_id = NULL,
         bot_suspended_at = NOW(),
         active_key = SHA2(CONCAT(client_id, CHAR(0), provider, CHAR(0), integration_id, CHAR(0), contact_id), 256),
         updated_at = NOW()
         WHERE conversation_id = ? AND client_id = ? AND status = 'closed'`,
        [user.user_id, user.name, user.user_id, input.conversationId, ctx.tenantId],
      ) as any[];
      if (!result.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "O atendimento não está encerrado." });
      await attendanceEvent(connection, ctx.tenantId, input.conversationId, "reopened", user.user_id);
      await connection.commit(); return { ok: true };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }),

  claim: megadeskProcedure.input(z.object({ conversationId: id })).mutation(async ({ input, ctx }) => {
    requireConversationAccess(ctx);
    const user = await eligibleUser(ctx.tenantId, ctx.operationalUserId);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `UPDATE megadesk_domain_conversations SET status = 'open', assigned_user_id = ?, assigned_user_name = ?,
         ia_active = 0, bot_suspended_at = NOW(), updated_at = NOW()
         WHERE conversation_id = ? AND client_id = ? AND status = 'bot' AND assigned_user_id IS NULL`,
        [user.user_id, user.name, input.conversationId, ctx.tenantId],
      ) as any[];
      if (!result.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Esta conversa já foi assumida por outra pessoa." });
      await attendanceEvent(connection, ctx.tenantId, input.conversationId, "claimed", user.user_id);
      await connection.commit(); return { ok: true, assignedUserId: user.user_id, assignedUserName: user.name };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }),

  transfer: megadeskProcedure.input(z.object({ conversationId: id, targetUserId: id,
    expectedAssignedUserId: id.nullable(), note: z.string().trim().max(240).optional() }))
    .mutation(async ({ input, ctx }) => {
      requireConversationAccess(ctx);
      const target = await eligibleUser(ctx.tenantId, input.targetUserId);
      const connection = await getPool().getConnection();
      try {
        await connection.beginTransaction();
        const [current] = await connection.execute(
          `SELECT assigned_user_id FROM megadesk_domain_conversations
           WHERE conversation_id = ? AND client_id = ? AND status IN ('open','bot') LIMIT 1 FOR UPDATE`,
          [input.conversationId, ctx.tenantId],
        ) as any[];
        if (!current.length) throw new TRPCError({ code: "CONFLICT", message: "Reabra o atendimento antes de transferir." });
        if ((current[0].assigned_user_id ?? null) !== input.expectedAssignedUserId) {
          throw new TRPCError({ code: "CONFLICT", message: "A atribuição mudou. Atualize a lista antes de transferir." });
        }
        if (current[0].assigned_user_id === target.user_id) {
          await connection.commit();
          return { ok: true, unchanged: true, assignedUserId: target.user_id, assignedUserName: target.name };
        }
        const [updated] = await connection.execute(
          `UPDATE megadesk_domain_conversations SET status = 'open', assigned_user_id = ?, assigned_user_name = ?,
           ia_active = 0, bot_suspended_at = NOW(), updated_at = NOW()
           WHERE conversation_id = ? AND client_id = ? AND status IN ('open','bot')
             AND assigned_user_id <=> ?`,
          [target.user_id, target.name, input.conversationId, ctx.tenantId, input.expectedAssignedUserId],
        ) as any[];
        if (!updated.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "A atribuição mudou. Atualize a lista antes de transferir." });
        await attendanceEvent(connection, ctx.tenantId, input.conversationId, "transferred", ctx.operationalUserId,
          { fromUserId: current[0].assigned_user_id ?? "unassigned", toUserId: target.user_id, ...(input.note ? { note: input.note } : {}) });
        await connection.commit(); return { ok: true, assignedUserId: target.user_id, assignedUserName: target.name };
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }),

  eligibleUsers: megadeskProcedure.query(async ({ ctx }) => {
    requireConversationAccess(ctx);
    const [rows] = await getPool().execute(
      `SELECT user_id AS id, name, email, role FROM megadesk_domain_client_users
       WHERE client_id = ? AND status = 'active' AND role IN ('admin','manager','agent')
         AND JSON_CONTAINS(permissions_json, JSON_QUOTE('conversations')) ORDER BY name`, [ctx.tenantId],
    );
    return rows as any[];
  }),

  messages: megadeskProcedure.input(z.object({ conversationId: id, limit: z.number().int().min(1).max(200).default(100) }))
    .query(async ({ input, ctx }) => {
      requireConversationAccess(ctx);
      const [rows] = await getPool().execute(
        `SELECT m.message_id AS id, m.sender, m.message AS text, m.timestamp, m.status, m.direction,
         m.message_type AS type, m.client_attempt_id AS clientAttemptId, m.external_message_id AS externalMessageId,
         COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(m.sender_name_snapshot), '')) AS agentName,
         m.media_reference AS mediaReference
         FROM megadesk_domain_conversations_messages m
         LEFT JOIN megadesk_domain_client_users u ON u.client_id = m.client_id AND u.user_id = m.sender_user_id
         WHERE m.client_id = ? AND m.conversation_id = ? ORDER BY m.timestamp ASC, m.message_id ASC LIMIT ${input.limit}`,
        [ctx.tenantId, input.conversationId],
      ) as any[];
      if (rows.length) return { source: "normalized" as const, messages: rows.map(normalizedMessage) };
      const [legacy] = await getPool().execute(
        `SELECT messages_json FROM megadesk_domain_conversations WHERE client_id = ? AND conversation_id = ? LIMIT 1`,
        [ctx.tenantId, input.conversationId],
      ) as any[];
      if (!legacy.length) throw new TRPCError({ code: "NOT_FOUND", message: "Atendimento não encontrado." });
      try { return { source: "legacy_json" as const, messages: JSON.parse(legacy[0].messages_json || "[]") }; }
      catch { return { source: "legacy_json" as const, messages: [] }; }
    }),

  history: megadeskProcedure.input(z.object({ contactId: id })).query(async ({ input, ctx }) => {
    requireConversationAccess(ctx);
    const [rows] = await getPool().execute(
      `SELECT conversation_id AS id, public_code AS publicCode, status, customer_name AS customerName,
       assigned_user_name AS assignedUserName, last_message AS summary, created_at AS startedAt, closed_at AS closedAt
       FROM megadesk_domain_conversations WHERE client_id = ? AND contact_id = ? ORDER BY created_at DESC LIMIT 100`,
      [ctx.tenantId, input.contactId],
    );
    return rows as any[];
  }),

  historyDetail: megadeskProcedure.input(z.object({ conversationId: id })).query(async ({ input, ctx }) => {
    requireConversationAccess(ctx);
    const [conversations] = await getPool().execute(
      `SELECT conversation_id AS id, public_code AS publicCode, status,
       customer_name AS customerName, assigned_user_name AS assignedUserName,
       created_at AS startedAt, closed_at AS closedAt, messages_json AS messagesJson
       FROM megadesk_domain_conversations WHERE client_id = ? AND conversation_id = ? LIMIT 1`,
      [ctx.tenantId, input.conversationId],
    ) as any[];
    if (!conversations.length) throw new TRPCError({ code: "NOT_FOUND", message: "Atendimento não encontrado." });
    const [rows] = await getPool().execute(
      `SELECT m.message_id AS id, m.sender, m.message AS text, m.timestamp, m.status, m.direction,
       m.message_type AS type, m.client_attempt_id AS clientAttemptId, m.external_message_id AS externalMessageId,
       COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(m.sender_name_snapshot), '')) AS agentName,
       m.media_reference AS mediaReference
       FROM megadesk_domain_conversations_messages m
       LEFT JOIN megadesk_domain_client_users u ON u.client_id = m.client_id AND u.user_id = m.sender_user_id
       WHERE m.client_id = ? AND m.conversation_id = ? ORDER BY m.timestamp ASC, m.message_id ASC LIMIT 200`,
      [ctx.tenantId, input.conversationId],
    ) as any[];
    let messages = rows.map(normalizedMessage);
    if (!messages.length) {
      try { messages = JSON.parse(conversations[0].messagesJson || "[]").slice(0, 200); } catch { messages = []; }
    }
    const { messagesJson: _private, ...conversation } = conversations[0];
    return { conversation, messages };
  }),

  linkedTickets: megadeskProcedure.input(z.object({ conversationId: id })).query(async ({ input, ctx }) => {
    requireConversationAccess(ctx);
    const [rows] = await getPool().execute(
      `SELECT DISTINCT t.chamadoId AS id, t.chamadoNumber AS number, t.title, t.status, t.createdAt AS createdAt
       FROM megadesk_domain_conversations c
       LEFT JOIN megadesk_conversation_contacts contact
         ON contact.client_id = c.client_id AND contact.contact_id = c.contact_id
       JOIN megadesk_domain_chamados t ON t.clientId = c.client_id
       LEFT JOIN megadesk_conversation_tickets l
         ON l.client_id = c.client_id AND l.chamado_id = t.chamadoId
        AND (l.contact_id = c.contact_id OR l.conversation_id = c.conversation_id)
       WHERE c.client_id = ? AND c.conversation_id = ?
          AND (l.link_id IS NOT NULL OR (contact.crm_client_id IS NOT NULL AND t.customerId = contact.crm_client_id))
       ORDER BY t.createdAt DESC, t.chamadoId DESC LIMIT 50`,
      [ctx.tenantId, input.conversationId],
    );
    return rows as any[];
  }),

  updateContact: megadeskProcedure.input(z.object({
    contactId: id,
    displayName: z.string().trim().min(1).max(180).optional(),
    companyText: z.union([z.string().transform(value => value.trim()).pipe(z.string().max(255).superRefine((value, ctx) => {
      if (/<[^>]*>/.test(value)) ctx.addIssue({ code: "custom", message: "Empresa não aceita HTML." });
      if (/^[\[{]/.test(value)) {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === "object") ctx.addIssue({ code: "custom", message: "Empresa deve ser texto simples." });
        } catch { /* texto livre que apenas começa com colchete/chave */ }
      }
    })), z.null()]).optional(),
  }).refine(input => input.displayName !== undefined || input.companyText !== undefined, {
    message: "Informe ao menos um campo para atualizar.",
  }))
    .mutation(async ({ input, ctx }) => {
      requireConversationAccess(ctx);
      const assignments: string[] = [];
      const values: unknown[] = [];
      if (input.displayName !== undefined) {
        assignments.push("display_name = ?");
        values.push(input.displayName);
      }
      if (input.companyText !== undefined) {
        assignments.push("company_text = ?");
        values.push(input.companyText?.trim() || null);
      }
      const [result] = await getPool().execute(
        `UPDATE megadesk_conversation_contacts SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE contact_id = ? AND client_id = ?`, [...values, input.contactId, ctx.tenantId],
      ) as any[];
      if (!result.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado." });
      const [rows] = await getPool().execute(
        `SELECT contact_id AS contactId, display_name AS displayName, company_text AS companyText,
         canonical_phone AS canonicalPhone, crm_client_id AS crmClientId
         FROM megadesk_conversation_contacts WHERE contact_id = ? AND client_id = ? LIMIT 1`,
        [input.contactId, ctx.tenantId],
      ) as any[];
      return rows[0];
    }),

  linkCrm: megadeskProcedure.input(z.object({ contactId: id, crmClientId: id.nullable() }))
    .mutation(async ({ input, ctx }) => {
      requireConversationAccess(ctx);
      const connection = await getPool().getConnection();
      try {
        await connection.beginTransaction();
        const [contacts] = await connection.execute(
          `SELECT contact_id FROM megadesk_conversation_contacts WHERE contact_id = ? AND client_id = ? LIMIT 1 FOR UPDATE`,
          [input.contactId, ctx.tenantId],
        ) as any[];
        if (!contacts.length) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado." });
        if (input.crmClientId) {
          const [crm] = await connection.execute(
            `SELECT crm_client_id FROM megadesk_crm_clients WHERE crm_client_id = ? AND client_id = ? AND lifecycle_state = 'active' LIMIT 1`,
            [input.crmClientId, ctx.tenantId],
          ) as any[];
          if (!crm.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Cliente indisponível para vínculo." });
        }
        const [updated] = await connection.execute(
          `UPDATE megadesk_conversation_contacts SET crm_client_id = ?, updated_at = NOW() WHERE contact_id = ? AND client_id = ?`,
          [input.crmClientId, input.contactId, ctx.tenantId],
        ) as any[];
        if (!updated.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado." });
        await connection.commit(); return { ok: true, crmClientId: input.crmClientId };
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }),

  linkTicket: megadeskProcedure.input(z.object({ conversationId: id, chamadoId: id }))
    .mutation(async ({ input, ctx }) => {
      requireConversationAccess(ctx);
      const connection = await getPool().getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          `SELECT c.contact_id FROM megadesk_domain_conversations c
           JOIN megadesk_domain_chamados t ON t.chamado_id = ? AND t.client_id = c.client_id
           WHERE c.conversation_id = ? AND c.client_id = ? LIMIT 1 FOR UPDATE`,
          [input.chamadoId, input.conversationId, ctx.tenantId],
        ) as any[];
        if (!rows.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Chamado ou atendimento divergente." });
        await connection.execute(
          `INSERT INTO megadesk_conversation_tickets
           (link_id, client_id, conversation_id, chamado_id, contact_id, linked_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [`link-${randomUUID()}`, ctx.tenantId, input.conversationId, input.chamadoId, rows[0].contact_id, ctx.operationalUserId],
        );
        await attendanceEvent(connection, ctx.tenantId, input.conversationId, "ticket_linked", ctx.operationalUserId,
          { chamadoId: input.chamadoId });
        await connection.commit(); return { ok: true };
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }),
});
