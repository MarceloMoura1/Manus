import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";
import type { TicketActivityMetadata, TicketFieldChange } from "../shared/chamados-activity";

export type CanonicalTicketActor = {
  userId: string;
  userName: string;
};

export type TicketMutationMode = "status" | "edit" | "forward";

export type TicketDomainUpdate = {
  customerId?: string;
  customerName?: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerCNPJ?: string | null;
  company?: string;
  title?: string;
  observations?: string;
  status?: "open" | "in_progress" | "waiting" | "closed";
  priority?: "baixa" | "media" | "alta" | "critica";
  assignedTo?: string | null;
  assignedToUserId?: string | null;
  forwardObservation?: string;
};

type TicketRow = RowDataPacket & {
  chamadoId: string;
  clientId: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerCNPJ: string | null;
  company: string | null;
  title: string | null;
  observations: string | null;
  status: "open" | "in_progress" | "waiting" | "closed";
  priority: "baixa" | "media" | "alta" | "critica";
  assignedTo: string | null;
  assignedToUserId: string | null;
};

type CollaboratorRow = RowDataPacket & { userId: string; userName: string };

const statusLabel: Record<string, string> = {
  open: "Aberto",
  in_progress: "Em Progresso",
  waiting: "Aguardando",
  closed: "Fechado",
};

function snapshot(value: string | null | undefined, max = 2_000): string | null {
  if (value == null) return null;
  return value.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, max);
}

function assertActor(actor: CanonicalTicketActor): CanonicalTicketActor {
  const userId = snapshot(actor.userId, 80);
  const userName = snapshot(actor.userName, 180);
  if (!userId || !userName) throw new Error("CANONICAL_TICKET_ACTOR_REQUIRED");
  return { userId, userName };
}

function normalizeIds(ids: readonly string[]): string[] {
  const unique = [...new Set(ids.map(id => id.trim()))];
  if (unique.some(id => !/^[A-Za-z0-9_-]{1,80}$/.test(id))) throw new Error("INVALID_COLLABORATOR_ID");
  return unique;
}

async function withTransaction<T>(
  operation: (connection: PoolConnection) => Promise<T>,
  pool: Pool = getPool(),
): Promise<T> {
  const connection = await pool.getConnection();
  let started = false;
  try {
    await connection.beginTransaction();
    started = true;
    const result = await operation(connection);
    await connection.commit();
    started = false;
    return result;
  } catch (error) {
    if (started) await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function ticketForUpdate(connection: PoolConnection, clientId: string, chamadoId: string): Promise<TicketRow | null> {
  const [rows] = await connection.execute<TicketRow[]>(
    `SELECT chamadoId, clientId, customerId, customerName, customer_phone AS customerPhone, customer_email AS customerEmail, customer_cnpj AS customerCNPJ, company, title, observations, status, priority, assignedTo, assigned_to_user_id AS assignedToUserId
     FROM megadesk_domain_chamados
     WHERE clientId=? AND chamadoId=? LIMIT 1 FOR UPDATE`,
    [clientId, chamadoId],
  );
  return rows[0] ?? null;
}

async function insertEvent(
  connection: PoolConnection,
  input: {
    chamadoId: string;
    clientId: string;
    actor: CanonicalTicketActor;
    actionType: TicketActivityMetadata["eventType"];
    description: string;
    metadata: TicketActivityMetadata;
  },
): Promise<string> {
  const actor = assertActor(input.actor);
  const activityId = randomUUID();
  await connection.execute(
    `INSERT INTO megadesk_domain_chamado_activities
     (activity_id, chamado_id, client_id, description, attendant, actor_user_id, action_type, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      activityId,
      input.chamadoId,
      input.clientId,
      snapshot(input.description, 2_000) || "Atividade do chamado.",
      actor.userName,
      actor.userId,
      input.actionType,
      JSON.stringify(input.metadata),
    ],
  );
  return activityId;
}

function buildEditChanges(current: TicketRow, next: TicketDomainUpdate): TicketFieldChange[] {
  const changes: TicketFieldChange[] = [];
  if (next.customerId !== undefined && next.customerId !== current.customerId) {
    changes.push({
      field: "customer",
      from: snapshot(current.company || current.customerName, 255),
      to: snapshot(next.company || next.customerName, 255),
      fromId: current.customerId,
      toId: next.customerId,
    });
  }
  if (next.title !== undefined && next.title !== (current.title ?? "")) {
    changes.push({ field: "title", from: current.title, to: next.title });
  }
  if (next.observations !== undefined && next.observations !== (current.observations ?? "")) {
    changes.push({ field: "observations", from: current.observations, to: next.observations });
  }
  if (next.priority !== undefined && next.priority !== current.priority) {
    changes.push({ field: "priority", from: current.priority, to: next.priority });
  }
  return changes;
}

function changedAssignments(current: TicketRow, next: TicketDomainUpdate): Array<[string, unknown]> {
  const assignments: Array<[string, unknown]> = [];
  const fields: Array<[keyof TicketDomainUpdate, string, unknown]> = [
    ["customerId", "customerId", next.customerId],
    ["customerName", "customerName", next.customerName],
    ["customerPhone", "customer_phone", next.customerPhone],
    ["customerEmail", "customer_email", next.customerEmail],
    ["customerCNPJ", "customer_cnpj", next.customerCNPJ],
    ["company", "company", next.company],
    ["title", "title", next.title],
    ["observations", "observations", next.observations],
    ["status", "status", next.status],
    ["priority", "priority", next.priority],
    ["assignedTo", "assignedTo", next.assignedTo],
    ["assignedToUserId", "assigned_to_user_id", next.assignedToUserId],
  ];
  for (const [key, column, value] of fields) {
    if (value === undefined) continue;
    const currentValue = (current as Record<string, unknown>)[key];
    if (currentValue !== value) assignments.push([column, value]);
  }
  return assignments;
}

export async function createChamadoWithActivity(
  input: {
    clientId: string;
    customerId: string;
    customerName: string;
    company: string;
    title: string;
    observations: string;
    priority: "baixa" | "media" | "alta" | "critica";
    assignedTo?: string;
    assignedToUserId?: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    customerCNPJ?: string | null;
    actor: CanonicalTicketActor;
  },
  pool: Pool = getPool(),
): Promise<{ id: string; number: number }> {
  const actor = assertActor(input.actor);
  return withTransaction(async connection => {
    await connection.execute(
      `INSERT INTO megadesk_domain_chamado_sequence (clientId, nextChamadoNumber, createdAt, updatedAt)
       VALUES (?, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE nextChamadoNumber=nextChamadoNumber`,
      [input.clientId],
    );
    const [sequenceRows] = await connection.execute<Array<RowDataPacket & { nextChamadoNumber: number }>>(
      "SELECT nextChamadoNumber FROM megadesk_domain_chamado_sequence WHERE clientId=? FOR UPDATE",
      [input.clientId],
    );
    const number = Number(sequenceRows[0]?.nextChamadoNumber);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("INVALID_CHAMADO_SEQUENCE");
    await connection.execute(
      "UPDATE megadesk_domain_chamado_sequence SET nextChamadoNumber=?, updatedAt=NOW() WHERE clientId=?",
      [number + 1, input.clientId],
    );
    const chamadoId = randomUUID();
    await connection.execute(
      `INSERT INTO megadesk_domain_chamados
       (chamadoId, clientId, chamadoNumber, customerId, customerName, customer_phone, customer_email, customer_cnpj, company, title, observations, status, priority, assignedTo, assigned_to_user_id, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NOW(), NOW())`,
      [
        chamadoId,
        input.clientId,
        number,
        input.customerId,
        input.customerName,
        input.customerPhone ?? null,
        input.customerEmail ?? null,
        input.customerCNPJ ?? null,
        input.company,
        input.title,
        input.observations,
        input.priority,
        input.assignedTo ?? actor.userName,
        input.assignedToUserId ?? actor.userId,
      ],
    );
    await insertEvent(connection, {
      chamadoId,
      clientId: input.clientId,
      actor,
      actionType: "ticket_created",
      description: `${actor.userName} criou o chamado.`,
      metadata: { eventType: "ticket_created" },
    });
    return { id: chamadoId, number };
  }, pool);
}

export async function updateChamadoWithActivity(
  input: {
    chamadoId: string;
    clientId: string;
    actor: CanonicalTicketActor;
    mode: TicketMutationMode;
    updates: TicketDomainUpdate;
  },
  pool: Pool = getPool(),
): Promise<{ changed: boolean; eventCreated: boolean }> {
  const actor = assertActor(input.actor);
  return withTransaction(async connection => {
    const current = await ticketForUpdate(connection, input.clientId, input.chamadoId);
    if (!current) throw new Error("CHAMADO_NOT_FOUND");
    const assignments = changedAssignments(current, input.updates);
    if (assignments.length === 0) return { changed: false, eventCreated: false };
    await connection.execute(
      `UPDATE megadesk_domain_chamados SET ${assignments.map(([column]) => `\`${column}\`=?`).join(", ")}, updatedAt=NOW()
       WHERE clientId=? AND chamadoId=?`,
      [...assignments.map(([, value]) => value), input.clientId, input.chamadoId],
    );

    const editChanges = buildEditChanges(current, input.updates);
    const insertEditEvent = async () => {
      if (!editChanges.length) return false;
      await insertEvent(connection, {
        chamadoId: input.chamadoId,
        clientId: input.clientId,
        actor,
        actionType: "ticket_edited",
        description: `${actor.userName} editou o chamado.`,
        metadata: { eventType: "ticket_edited", changes: editChanges },
      });
      return true;
    };

    if (input.mode === "status" && input.updates.status !== undefined && input.updates.status !== current.status) {
      await insertEvent(connection, {
        chamadoId: input.chamadoId,
        clientId: input.clientId,
        actor,
        actionType: "status_changed",
        description: `${actor.userName} alterou o status de ${statusLabel[current.status]} para ${statusLabel[input.updates.status]}.`,
        metadata: { eventType: "status_changed", fromStatus: current.status, toStatus: input.updates.status },
      });
      await insertEditEvent();
      return { changed: true, eventCreated: true };
    }

    if (input.mode === "forward" && input.updates.assignedToUserId && input.updates.assignedToUserId !== current.assignedToUserId) {
      const toAssigneeName = snapshot(input.updates.assignedTo, 180);
      if (!toAssigneeName) throw new Error("FORWARD_ASSIGNEE_REQUIRED");
      await insertEvent(connection, {
        chamadoId: input.chamadoId,
        clientId: input.clientId,
        actor,
        actionType: "ticket_forwarded",
        description: `${actor.userName} encaminhou o chamado para ${toAssigneeName}.`,
        metadata: {
          eventType: "ticket_forwarded",
          fromAssigneeId: current.assignedToUserId,
          fromAssigneeName: current.assignedTo,
          toAssigneeId: input.updates.assignedToUserId,
          toAssigneeName,
          ...(snapshot(input.updates.forwardObservation, 2_000) ? { observation: snapshot(input.updates.forwardObservation, 2_000)! } : {}),
        },
      });
      await insertEditEvent();
      return { changed: true, eventCreated: true };
    }

    if (input.mode === "edit") {
      if (await insertEditEvent()) {
        return { changed: true, eventCreated: true };
      }
    }
    return { changed: true, eventCreated: false };
  }, pool);
}

export async function updateCollaboratorsWithActivities(
  input: { chamadoId: string; clientId: string; collaboratorIds: readonly string[]; actor: CanonicalTicketActor },
  pool: Pool = getPool(),
): Promise<{ added: number; removed: number }> {
  const actor = assertActor(input.actor);
  const collaboratorIds = normalizeIds(input.collaboratorIds);
  return withTransaction(async connection => {
    const ticket = await ticketForUpdate(connection, input.clientId, input.chamadoId);
    if (!ticket) throw new Error("CHAMADO_NOT_FOUND");
    const [currentRows] = await connection.execute<CollaboratorRow[]>(
      `SELECT user_id AS userId, user_name AS userName FROM megadesk_domain_chamado_collaborators
       WHERE client_id=? AND chamado_id=? FOR UPDATE`,
      [input.clientId, input.chamadoId],
    );
    const currentById = new Map(currentRows.map(row => [row.userId, row]));
    let canonical: CollaboratorRow[] = [];
    if (collaboratorIds.length) {
      const placeholders = collaboratorIds.map(() => "?").join(", ");
      const [users] = await connection.execute<CollaboratorRow[]>(
        `SELECT user_id AS userId, name AS userName FROM megadesk_domain_client_users
         WHERE client_id=? AND status='active' AND user_id IN (${placeholders})`,
        [input.clientId, ...collaboratorIds],
      );
      if (users.length !== collaboratorIds.length) throw new Error("INVALID_TENANT_COLLABORATOR");
      canonical = users.sort((a, b) => collaboratorIds.indexOf(a.userId) - collaboratorIds.indexOf(b.userId));
    }
    const nextById = new Map(canonical.map(row => [row.userId, row]));
    const removed = currentRows.filter(row => !nextById.has(row.userId));
    const added = canonical.filter(row => !currentById.has(row.userId));
    if (!removed.length && !added.length) return { added: 0, removed: 0 };

    await connection.execute(
      "DELETE FROM megadesk_domain_chamado_collaborators WHERE client_id=? AND chamado_id=?",
      [input.clientId, input.chamadoId],
    );
    for (const collaborator of canonical) {
      await connection.execute(
        `INSERT INTO megadesk_domain_chamado_collaborators
         (collaborator_id, chamado_id, client_id, user_id, user_name, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [randomUUID(), input.chamadoId, input.clientId, collaborator.userId, collaborator.userName],
      );
    }
    for (const collaborator of removed) {
      await insertEvent(connection, {
        chamadoId: input.chamadoId,
        clientId: input.clientId,
        actor,
        actionType: "collaborator_removed",
        description: `${actor.userName} removeu ${collaborator.userName} dos colaboradores.`,
        metadata: { eventType: "collaborator_removed", collaboratorId: collaborator.userId, collaboratorName: collaborator.userName },
      });
    }
    for (const collaborator of added) {
      await insertEvent(connection, {
        chamadoId: input.chamadoId,
        clientId: input.clientId,
        actor,
        actionType: "collaborator_added",
        description: `${actor.userName} adicionou ${collaborator.userName} como colaborador.`,
        metadata: { eventType: "collaborator_added", collaboratorId: collaborator.userId, collaboratorName: collaborator.userName },
      });
    }
    return { added: added.length, removed: removed.length };
  }, pool);
}

export async function registerManualTicketActivity(
  input: { chamadoId: string; clientId: string; description: string; actor: CanonicalTicketActor },
  pool: Pool = getPool(),
): Promise<{ id: string }> {
  const actor = assertActor(input.actor);
  const description = snapshot(input.description, 2_000);
  if (!description) throw new Error("ACTIVITY_DESCRIPTION_REQUIRED");
  return withTransaction(async connection => {
    const ticket = await ticketForUpdate(connection, input.clientId, input.chamadoId);
    if (!ticket) throw new Error("CHAMADO_NOT_FOUND");
    const id = await insertEvent(connection, {
      chamadoId: input.chamadoId,
      clientId: input.clientId,
      actor,
      actionType: "manual_activity",
      description,
      metadata: { eventType: "manual_activity" },
    });
    return { id };
  }, pool);
}

export type TicketAttachmentReservation = {
  attachmentId: string;
  storageKey: string;
  state: "staged" | "active" | "pending_delete" | "deleted" | "legacy";
  existingActive: boolean;
};

export async function reserveTicketAttachment(
  input: {
    chamadoId: string;
    clientId: string;
    actor: CanonicalTicketActor;
    clientAttemptId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    sha256: string;
    storageKey: string;
  },
  pool: Pool = getPool(),
): Promise<TicketAttachmentReservation> {
  const actor = assertActor(input.actor);
  return withTransaction(async connection => {
    const ticket = await ticketForUpdate(connection, input.clientId, input.chamadoId);
    if (!ticket) throw new Error("CHAMADO_NOT_FOUND");
    const attachmentId = randomUUID();
    await connection.execute(
      `INSERT INTO megadesk_domain_chamado_attachments
       (attachment_id, chamado_id, client_id, file_name, file_url, storage_key, file_size, mime_type, uploaded_by, uploaded_by_user_id, sha256, client_attempt_id, attachment_state, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'staged', NOW())
       ON DUPLICATE KEY UPDATE attachment_id=attachment_id`,
      [attachmentId, input.chamadoId, input.clientId, input.fileName, input.storageKey, input.fileSize, input.mimeType, actor.userName, actor.userId, input.sha256, input.clientAttemptId],
    );
    const [rows] = await connection.execute<Array<RowDataPacket & TicketAttachmentReservation & { chamadoId: string; clientId: string; sha256: string | null }>>(
      `SELECT attachment_id AS attachmentId, storage_key AS storageKey, attachment_state AS state, chamado_id AS chamadoId, client_id AS clientId, sha256
       FROM megadesk_domain_chamado_attachments WHERE client_id=? AND client_attempt_id=? LIMIT 1 FOR UPDATE`,
      [input.clientId, input.clientAttemptId],
    );
    const existing = rows[0];
    if (!existing || existing.chamadoId !== input.chamadoId || existing.sha256 !== input.sha256) throw new Error("ATTACHMENT_ATTEMPT_CONFLICT");
    return { attachmentId: existing.attachmentId, storageKey: existing.storageKey, state: existing.state, existingActive: existing.state === "active" };
  }, pool);
}

export async function activateTicketAttachment(
  input: {
    attachmentId: string;
    chamadoId: string;
    clientId: string;
    actor: CanonicalTicketActor;
    fileName: string;
    fileSize: number;
    mimeType: string;
    sha256: string;
  },
  pool: Pool = getPool(),
): Promise<void> {
  const actor = assertActor(input.actor);
  await withTransaction(async connection => {
    const ticket = await ticketForUpdate(connection, input.clientId, input.chamadoId);
    if (!ticket) throw new Error("CHAMADO_NOT_FOUND");
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE megadesk_domain_chamado_attachments
       SET attachment_state='active'
       WHERE attachment_id=? AND chamado_id=? AND client_id=? AND attachment_state='staged'`,
      [input.attachmentId, input.chamadoId, input.clientId],
    );
    if (result.affectedRows === 0) {
      const [rows] = await connection.execute<Array<RowDataPacket & { state: string }>>(
        "SELECT attachment_state AS state FROM megadesk_domain_chamado_attachments WHERE attachment_id=? AND chamado_id=? AND client_id=? LIMIT 1 FOR UPDATE",
        [input.attachmentId, input.chamadoId, input.clientId],
      );
      if (rows[0]?.state === "active") return;
      throw new Error("ATTACHMENT_NOT_STAGED");
    }
    await insertEvent(connection, {
      chamadoId: input.chamadoId,
      clientId: input.clientId,
      actor,
      actionType: "attachment_added",
      description: `${actor.userName} anexou ${input.fileName}.`,
      metadata: {
        eventType: "attachment_added",
        attachmentId: input.attachmentId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.fileSize,
        sha256: input.sha256,
      },
    });
  }, pool);
}

export async function markTicketAttachmentPendingDelete(
  attachmentId: string,
  clientId: string,
  pool: Pool = getPool(),
): Promise<void> {
  await pool.execute(
    `UPDATE megadesk_domain_chamado_attachments
     SET attachment_state='pending_delete'
     WHERE attachment_id=? AND client_id=? AND attachment_state='staged'`,
    [attachmentId, clientId],
  );
}

export async function logicallyRemoveTicketAttachment(
  input: {
    attachmentId: string;
    chamadoId: string;
    clientId: string;
    actor: CanonicalTicketActor;
  },
  pool: Pool = getPool(),
): Promise<{ logicallyRemoved: true; state: "pending_delete" | "deleted"; reused: boolean }> {
  const actor = assertActor(input.actor);
  return withTransaction(async connection => {
    const ticket = await ticketForUpdate(connection, input.clientId, input.chamadoId);
    if (!ticket) throw new Error("ATTACHMENT_NOT_FOUND");
    const [rows] = await connection.execute<Array<RowDataPacket & {
      state: "legacy" | "staged" | "active" | "pending_delete" | "deleted";
      fileName: string;
      mimeType: string | null;
      fileSize: number | null;
      sha256: string | null;
    }>>(
      `SELECT attachment_state AS state, file_name AS fileName, mime_type AS mimeType,
              file_size AS fileSize, sha256
       FROM megadesk_domain_chamado_attachments
       WHERE attachment_id=? AND chamado_id=? AND client_id=? LIMIT 1 FOR UPDATE`,
      [input.attachmentId, input.chamadoId, input.clientId],
    );
    const attachment = rows[0];
    if (!attachment) throw new Error("ATTACHMENT_NOT_FOUND");
    if (attachment.state === "pending_delete" || attachment.state === "deleted") {
      return { logicallyRemoved: true, state: attachment.state, reused: true };
    }
    if (attachment.state !== "active" || !attachment.mimeType || attachment.fileSize == null) {
      throw new Error("ATTACHMENT_NOT_REMOVABLE");
    }
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE megadesk_domain_chamado_attachments
       SET attachment_state='pending_delete', pending_delete_at=NOW()
       WHERE attachment_id=? AND chamado_id=? AND client_id=? AND attachment_state='active'`,
      [input.attachmentId, input.chamadoId, input.clientId],
    );
    if (result.affectedRows !== 1) throw new Error("ATTACHMENT_REMOVE_CONFLICT");
    await insertEvent(connection, {
      chamadoId: input.chamadoId,
      clientId: input.clientId,
      actor,
      actionType: "attachment_removed",
      description: `${actor.userName} removeu logicamente ${attachment.fileName}.`,
      metadata: {
        eventType: "attachment_removed",
        attachmentId: input.attachmentId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: Number(attachment.fileSize),
        ...(attachment.sha256 ? { sha256: attachment.sha256 } : {}),
      },
    });
    return { logicallyRemoved: true, state: "pending_delete", reused: false };
  }, pool);
}

export { withTransaction as withChamadoTransaction };
