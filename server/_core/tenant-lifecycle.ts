import { nanoid } from "nanoid";
import { getPool } from "../db";

export const TENANT_QUARANTINE_REASONS = ["non_payment", "customer_request", "policy_violation", "contract_termination", "security", "controlled_other"] as const;
export type TenantQuarantineReason = typeof TENANT_QUARANTINE_REASONS[number];
type Executor = { execute(sql: string, params?: unknown[]): Promise<unknown> };
export type LifecycleTransaction = Executor & { commit(): Promise<void>; rollback(): Promise<void>; release(): void };
export type LifecycleDependencies = { begin(): Promise<LifecycleTransaction> };
const defaultDependencies: LifecycleDependencies = { async begin() { const connection = await getPool().getConnection(); await connection.beginTransaction(); return connection as unknown as LifecycleTransaction; } };
function rowsOf(result: unknown): any[] { return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : []; }

export async function quarantineTenant(input: { clientId: string; operatorId: string; reason: TenantQuarantineReason }, dependencies: LifecycleDependencies = defaultDependencies) {
  const tx = await dependencies.begin();
  try {
    const tenant = rowsOf(await tx.execute("SELECT client_id, status, tenant_database_name FROM megadesk_domain_clients WHERE client_id = ? FOR UPDATE", [input.clientId]))[0];
    if (!tenant) throw new Error("Tenant não encontrado.");
    await tx.execute("UPDATE megadesk_domain_clients SET status = 'paused', access_released = 0 WHERE client_id = ?", [input.clientId]);
    await tx.execute("UPDATE megadesk_domain_client_users SET status = 'blocked' WHERE client_id = ?", [input.clientId]);
    const action = `tenant_quarantined;operator=${input.operatorId};reason=${input.reason};from=${tenant.status};to=paused`;
    await tx.execute("INSERT INTO megadesk_domain_audit_logs (audit_id, platform, action, client_id, success) VALUES (?, 'MegaAdmin', ?, ?, 1)", [`audit-${nanoid(20)}`, action, input.clientId]);
    await tx.commit();
    return { clientId: input.clientId, status: "paused" as const, accessReleased: false, databaseName: tenant.tenant_database_name };
  } catch (error) { await tx.rollback(); throw error; } finally { tx.release(); }
}

export async function reactivateTenant(input: { clientId: string; operatorId: string }, dependencies: LifecycleDependencies = defaultDependencies) {
  const tx = await dependencies.begin();
  try {
    const tenant = rowsOf(await tx.execute("SELECT client_id, status FROM megadesk_domain_clients WHERE client_id = ? FOR UPDATE", [input.clientId]))[0];
    if (!tenant) throw new Error("Tenant não encontrado.");
    await tx.execute("UPDATE megadesk_domain_clients SET status = 'active', access_released = 0 WHERE client_id = ?", [input.clientId]);
    await tx.execute("INSERT INTO megadesk_domain_audit_logs (audit_id, platform, action, client_id, success) VALUES (?, 'MegaAdmin', ?, ?, 1)", [`audit-${nanoid(20)}`, `tenant_reactivated;operator=${input.operatorId};from=${tenant.status};to=active`, input.clientId]);
    await tx.commit();
    return { clientId: input.clientId, status: "active" as const, accessReleased: false };
  } catch (error) { await tx.rollback(); throw error; } finally { tx.release(); }
}

export async function releaseTenantOperationalAccess(input: { clientId: string; operatorId: string }, dependencies: LifecycleDependencies = defaultDependencies) {
  const tx = await dependencies.begin();
  try {
    const tenant = rowsOf(await tx.execute("SELECT client_id, status FROM megadesk_domain_clients WHERE client_id = ? FOR UPDATE", [input.clientId]))[0];
    if (!tenant) throw new Error("Tenant não encontrado.");
    if (tenant.status !== "active") throw new Error("Tenant deve ser reativado antes da liberação de acesso.");
    await tx.execute("UPDATE megadesk_domain_clients SET access_released = 1 WHERE client_id = ? AND status = 'active'", [input.clientId]);
    await tx.execute("INSERT INTO megadesk_domain_audit_logs (audit_id, platform, action, client_id, success) VALUES (?, 'MegaAdmin', ?, ?, 1)", [`audit-${nanoid(20)}`, `tenant_access_released;operator=${input.operatorId}`, input.clientId]);
    await tx.commit();
    return { clientId: input.clientId, status: "active" as const, accessReleased: true };
  } catch (error) { await tx.rollback(); throw error; } finally { tx.release(); }
}

export async function validateOperationalAccess(input: { clientId: string; userEmail: string }, executor: Executor = getPool()): Promise<{ userId: string; role: string }> {
  const rows = rowsOf(await executor.execute(`SELECT u.user_id, u.role FROM megadesk_domain_clients c INNER JOIN megadesk_domain_client_users u ON u.client_id = c.client_id WHERE c.client_id = ? AND c.status = 'active' AND c.access_released = 1 AND u.email = ? AND u.status = 'active' LIMIT 1`, [input.clientId, input.userEmail.trim().toLowerCase()]));
  if (!rows[0]) throw new Error("OPERATIONAL_ACCESS_DENIED");
  return { userId: rows[0].user_id, role: rows[0].role };
}

export async function deleteTenant(): Promise<never> { throw new Error("Exclusão de tenant indisponível: use o lifecycle explícito."); }

export async function deleteTestTenant(
  input: { clientId: string; operatorId: string },
  dependencies: LifecycleDependencies = defaultDependencies
) {
  const tx = await dependencies.begin();
  try {
    const tenant = rowsOf(
      await tx.execute(
        "SELECT client_id, company, status, status_type, tenant_database_name FROM megadesk_domain_clients WHERE client_id = ? FOR UPDATE",
        [input.clientId]
      )
    )[0];
    if (!tenant) throw new Error("Tenant não encontrado.");

    const isTestTenant =
      tenant.status_type === "test" ||
      String(tenant.company || "").startsWith("Synthetic Gate 02B");
    if (!isTestTenant) {
      throw new Error("Exclusão definitiva permitida apenas para clientes de teste ou sintéticos.");
    }

    const colRows = rowsOf(
      await tx.execute(
        `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND COLUMN_NAME IN ('client_id', 'clientId')
         ORDER BY TABLE_NAME ASC`
      )
    );

    const childTables = colRows.filter((r) => r.TABLE_NAME !== "megadesk_domain_clients");
    await tx.execute("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const row of childTables) {
        const tableName = String(row.TABLE_NAME || "");
        const colName = String(row.COLUMN_NAME || "");
        if (!/^[A-Za-z0-9_]+$/.test(tableName) || !/^[A-Za-z0-9_]+$/.test(colName)) continue;
        await tx.execute(`DELETE FROM \`${tableName}\` WHERE \`${colName}\` = ?`, [input.clientId]);
      }
      await tx.execute("DELETE FROM megadesk_domain_clients WHERE client_id = ?", [input.clientId]);
    } finally {
      await tx.execute("SET FOREIGN_KEY_CHECKS = 1");
    }

    await tx.commit();
    return { clientId: input.clientId, company: String(tenant.company || ""), deleted: true as const };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}