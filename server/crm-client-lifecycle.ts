import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";

export type CrmLifecycleState = "active" | "inactive" | "archived";
export type CrmLifecycleAction = "deactivate" | "reactivate" | "archive" | "restore";

const DEPENDENCY_MESSAGE = "Este cliente possui histórico ou vínculos e não pode ser excluído. Arquive o cadastro para preservá-los.";

export class CrmLifecycleError extends Error {
  constructor(public readonly kind: "not_found" | "conflict" | "dependencies" | "invalid_state", message: string) {
    super(message);
  }
}

type ClientRow = RowDataPacket & {
  crm_client_id: string;
  lifecycle_state: CrmLifecycleState;
  pre_archive_state: "active" | "inactive" | null;
  lifecycle_version: number;
};

async function lockedClient(connection: PoolConnection, tenantId: string, crmClientId: string) {
  const [rows] = await connection.execute<ClientRow[]>(
    `SELECT crm_client_id, lifecycle_state, pre_archive_state, lifecycle_version
       FROM megadesk_crm_clients
      WHERE client_id = ? AND crm_client_id = ? FOR UPDATE`,
    [tenantId, crmClientId],
  );
  if (!rows[0]) throw new CrmLifecycleError("not_found", "Cliente não encontrado.");
  return rows[0];
}

async function audit(connection: PoolConnection, input: {
  tenantId: string;
  crmClientId: string;
  operatorUserId: string;
  operatorRole: string;
  action: string;
  from: CrmLifecycleState;
  to?: CrmLifecycleState;
}) {
  const operationId = randomUUID();
  await connection.execute(
    `INSERT INTO megadesk_domain_audit_logs
       (audit_id, platform, action, client_id, success, operation_id, operator_user_id,
        operator_role, origin, event_phase, metadata_json)
     VALUES (?, 'MegaDesk', ?, ?, 1, ?, ?, ?, 'crm_clients', 'success', ?)`,
    [
      `audit-${randomUUID()}`,
      input.action,
      input.tenantId,
      operationId,
      input.operatorUserId,
      input.operatorRole,
      JSON.stringify({ crmClientId: input.crmClientId, from: input.from, to: input.to ?? null }),
    ],
  );
}

export async function changeCrmClientLifecycle(input: {
  tenantId: string;
  crmClientId: string;
  action: CrmLifecycleAction;
  expectedVersion: number;
  operatorUserId: string;
  operatorRole: string;
}) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const current = await lockedClient(connection, input.tenantId, input.crmClientId);
    if (current.lifecycle_version !== input.expectedVersion) {
      throw new CrmLifecycleError("conflict", "O cliente foi alterado por outra pessoa. Atualize a página e tente novamente.");
    }

    let next: CrmLifecycleState;
    let preArchive: "active" | "inactive" | null = current.pre_archive_state;
    if (input.action === "deactivate" && current.lifecycle_state === "active") next = "inactive";
    else if (input.action === "reactivate" && current.lifecycle_state === "inactive") next = "active";
    else if (input.action === "archive" && current.lifecycle_state !== "archived") {
      next = "archived";
      preArchive = current.lifecycle_state;
    } else if (input.action === "restore" && current.lifecycle_state === "archived") {
      next = current.pre_archive_state === "active" ? "active" : "inactive";
      preArchive = null;
    } else {
      throw new CrmLifecycleError("invalid_state", "Esta ação não está disponível no estado atual do cliente.");
    }

    await connection.execute(
      `UPDATE megadesk_crm_clients
          SET lifecycle_state = ?, pre_archive_state = ?, lifecycle_changed_at = NOW(),
              archived_at = IF(? = 'archived', NOW(), NULL), lifecycle_version = lifecycle_version + 1
        WHERE client_id = ? AND crm_client_id = ? AND lifecycle_version = ?`,
      [next, preArchive, next, input.tenantId, input.crmClientId, input.expectedVersion],
    );
    await audit(connection, { ...input, action: `crm_client_${input.action}`, from: current.lifecycle_state, to: next });
    await connection.commit();
    return { state: next, version: input.expectedVersion + 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const dependencyQueries = [
  ["contacts", "SELECT COUNT(*) total FROM megadesk_conversation_contacts WHERE client_id = ? AND crm_client_id = ?"],
  ["conversations", "SELECT COUNT(*) total FROM megadesk_domain_conversations WHERE client_id = ? AND crm_client_id = ?"],
  ["tickets", "SELECT COUNT(*) total FROM megadesk_domain_chamados WHERE clientId = ? AND customerId = ?"],
  ["timeline", "SELECT COUNT(*) total FROM megadesk_crm_timeline WHERE client_id = ? AND crm_client_id = ?"],
  ["sale_orders", "SELECT COUNT(*) total FROM erp_sale_orders WHERE client_id = ? AND crm_client_id = ?"],
  ["finance", "SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id = ? AND crm_client_id = ?"],
  ["whatsapp_conversations", "SELECT COUNT(*) total FROM wa_conversations WHERE client_id = ? AND crm_client_id = ?"],
] as const;

export async function permanentlyDeleteCrmClient(input: {
  tenantId: string;
  crmClientId: string;
  expectedVersion: number;
  operatorUserId: string;
  operatorRole: string;
}) {
  const connection = await getPool().getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await connection.beginTransaction();
    const current = await lockedClient(connection, input.tenantId, input.crmClientId);
    if (current.lifecycle_version !== input.expectedVersion) {
      throw new CrmLifecycleError("conflict", "O cliente foi alterado por outra pessoa. Atualize a página e tente novamente.");
    }
    for (const [, sql] of dependencyQueries) {
      const [rows] = await connection.execute<RowDataPacket[]>(sql, [input.tenantId, input.crmClientId]);
      if (Number(rows[0]?.total ?? 0) > 0) throw new CrmLifecycleError("dependencies", DEPENDENCY_MESSAGE);
    }
    const [result] = await connection.execute(
      "DELETE FROM megadesk_crm_clients WHERE client_id = ? AND crm_client_id = ? AND lifecycle_version = ?",
      [input.tenantId, input.crmClientId, input.expectedVersion],
    );
    if ((result as { affectedRows?: number }).affectedRows !== 1) {
      throw new CrmLifecycleError("conflict", "O cliente foi alterado por outra pessoa. Atualize a página e tente novamente.");
    }
    await audit(connection, { ...input, action: "crm_client_deleted", from: current.lifecycle_state });
    await connection.commit();
    return { success: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
