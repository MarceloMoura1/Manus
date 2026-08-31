import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "./db";
import { createCrmClient, getCrmClientById } from "./db-crm";
import { crmRouter } from "./routers-crm";

const enabled = process.env.RUN_CRM_LIFECYCLE_AUDIT === "1";
const tenantA = "lifecycle-audit-tenant-a";
const tenantB = "lifecycle-audit-tenant-b";
const created: string[] = [];

function caller(tenantId: string, role: "admin" | "manager" | "agent" | "viewer") {
  return crmRouter.createCaller({ tenantId, operationalUserId: `${tenantId}-${role}`, operationalUserRole: role,
    operationalPermissions: ["clients", "erp"], userEmail: `${role}@example.invalid`, req: { headers: {} } } as never);
}

async function newClient(tenantId: string, label: string) {
  const result = await createCrmClient(tenantId, { customerType: "company", companyName: label, status: "lead", origin: "outro" });
  created.push(result.crmClientId);
  return result.crmClientId;
}

describe.skipIf(!enabled)("CRM lifecycle on isolated disposable MySQL", () => {
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL ?? "mysql://invalid/invalid");
    const approved = (url.port === "3318" && url.pathname === "/megadesk_test_crm_lifecycle_0015_audit")
      || (url.port === "3319" && url.pathname === "/megadesk_test_crm_lifecycle_0015_restore");
    if (url.hostname !== "127.0.0.1" || !approved) {
      throw new Error("Lifecycle audit requires an explicitly approved disposable database.");
    }
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.execute("DELETE FROM wa_conversations WHERE client_id IN (?, ?)", [tenantA, tenantB]);
    await pool.execute("DELETE FROM erp_financial_entries WHERE client_id IN (?, ?)", [tenantA, tenantB]);
    await pool.execute("DELETE FROM erp_financial_categories WHERE client_id IN (?, ?)", [tenantA, tenantB]);
    await pool.execute("DELETE FROM erp_sale_orders WHERE client_id IN (?, ?)", [tenantA, tenantB]);
    await pool.execute("DELETE FROM megadesk_domain_chamados WHERE clientId IN (?, ?)", [tenantA, tenantB]);
    await pool.execute("DELETE FROM megadesk_domain_conversations WHERE client_id IN (?, ?)", [tenantA, tenantB]);
    await pool.execute("DELETE FROM megadesk_domain_audit_logs WHERE client_id IN (?, ?) AND origin = 'crm_clients'", [tenantA, tenantB]);
    await pool.execute("DELETE FROM megadesk_crm_timeline WHERE client_id IN (?, ?)", [tenantA, tenantB]);
    await pool.execute("DELETE FROM megadesk_conversation_contacts WHERE client_id IN (?, ?)", [tenantA, tenantB]);
    await pool.execute("DELETE FROM megadesk_crm_clients WHERE client_id IN (?, ?)", [tenantA, tenantB]);
  });

  it("applies state transitions, restoration and optimistic concurrency", async () => {
    const id = await newClient(tenantA, "Lifecycle transitions");
    const admin = caller(tenantA, "admin");
    const [first, second] = await Promise.allSettled([
      admin.changeLifecycle({ crmClientId: id, action: "deactivate", expectedVersion: 1 }),
      admin.changeLifecycle({ crmClientId: id, action: "archive", expectedVersion: 1 }),
    ]);
    expect([first.status, second.status].filter(status => status === "fulfilled")).toHaveLength(1);
    expect([first.status, second.status].filter(status => status === "rejected")).toHaveLength(1);
    const current = await getCrmClientById(id, tenantA);
    if (current?.lifecycleState !== "archived") {
      await admin.changeLifecycle({ crmClientId: id, action: "archive", expectedVersion: current!.lifecycleVersion });
    }
    const archived = await getCrmClientById(id, tenantA);
    expect(archived?.lifecycleState).toBe("archived");
    await admin.changeLifecycle({ crmClientId: id, action: "restore", expectedVersion: archived!.lifecycleVersion });
    expect((await getCrmClientById(id, tenantA))?.lifecycleState).toBe("inactive");
    const [audit] = await getPool().execute(`SELECT COUNT(*) total,
      COALESCE(SUM(CAST(metadata_json AS CHAR) LIKE '%@%'),0) emails,
      COALESCE(SUM(CAST(metadata_json AS CHAR) LIKE '%cpf%'),0) cpfKeys,
      COALESCE(SUM(CAST(metadata_json AS CHAR) LIKE '%email%'),0) emailKeys
      FROM megadesk_domain_audit_logs WHERE client_id=? AND origin='crm_clients'`, [tenantA]) as any[];
    expect(Number(audit[0].total)).toBeGreaterThan(0);
    expect([audit[0].emails, audit[0].cpfKeys, audit[0].emailKeys].map(Number)).toEqual([0, 0, 0]);
  });

  it("enforces tenant and role boundaries", async () => {
    const id = await newClient(tenantA, "Role boundaries");
    await expect(caller(tenantB, "admin").changeLifecycle({ crmClientId: id, action: "deactivate", expectedVersion: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(tenantA, "agent").changeLifecycle({ crmClientId: id, action: "deactivate", expectedVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller(tenantA, "manager").changeLifecycle({ crmClientId: id, action: "deactivate", expectedVersion: 1 });
    await expect(caller(tenantA, "manager").deletePermanently({ crmClientId: id, expectedVersion: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("hides archived clients from defaults and preserves them in the archived filter", async () => {
    const id = await newClient(tenantA, "Archived filter");
    await caller(tenantA, "admin").changeLifecycle({ crmClientId: id, action: "archive", expectedVersion: 1 });
    expect((await caller(tenantA, "admin").list({ lifecycle: "active" })).clients.some(client => client.crmClientId === id)).toBe(false);
    expect((await caller(tenantA, "admin").list({ lifecycle: "archived" })).clients.some(client => client.crmClientId === id)).toBe(true);
  });

  it("deletes only a dependency-free client and blocks every real dependency without collateral writes", async () => {
    const deletable = await newClient(tenantA, "Disposable deletion");
    await caller(tenantA, "admin").deletePermanently({ crmClientId: deletable, expectedVersion: 1 });
    expect(await getCrmClientById(deletable, tenantA)).toBeNull();

    const pool = getPool();
    const dependencies = [
      { name: "contacts", insert: (id: string) => pool.execute(`INSERT INTO megadesk_conversation_contacts (contact_id,client_id,display_name,channel,provider,external_identity,crm_client_id) VALUES (CONCAT('contact-',?),?,'Synthetic','test','test',CONCAT('external-',?),?)`, [id, tenantA, id, id]), count: (id: string) => pool.execute("SELECT COUNT(*) total FROM megadesk_conversation_contacts WHERE client_id=? AND crm_client_id=?", [tenantA, id]) },
      { name: "conversations", insert: (id: string) => pool.execute(`INSERT INTO megadesk_domain_conversations (conversation_id,client_id,crm_client_id,customer_name,phone,company,last_message,time_label,messages_json) VALUES (CONCAT('conversation-',?),?,?,'Synthetic','5511999999999','Synthetic','Synthetic','now','[]')`, [id, tenantA, id]), count: (id: string) => pool.execute("SELECT COUNT(*) total FROM megadesk_domain_conversations WHERE client_id=? AND crm_client_id=?", [tenantA, id]) },
      { name: "tickets", insert: (id: string) => pool.execute(`INSERT INTO megadesk_domain_chamados (chamadoId,clientId,chamadoNumber,customerId,title) VALUES (CONCAT('ticket-',?),?,100000 + FLOOR(RAND()*899999),?,'Synthetic')`, [id, tenantA, id]), count: (id: string) => pool.execute("SELECT COUNT(*) total FROM megadesk_domain_chamados WHERE clientId=? AND customerId=?", [tenantA, id]) },
      { name: "timeline", insert: (id: string) => pool.execute(`INSERT INTO megadesk_crm_timeline (timeline_id,crm_client_id,client_id,entry_type,description,author) VALUES (CONCAT('timeline-',?),?,?,'note','Synthetic','Audit')`, [id, id, tenantA]), count: (id: string) => pool.execute("SELECT COUNT(*) total FROM megadesk_crm_timeline WHERE client_id=? AND crm_client_id=?", [tenantA, id]) },
      { name: "sale_orders", insert: (id: string) => pool.execute(`INSERT INTO erp_sale_orders (public_id,client_id,order_number,crm_client_id,customer_name_snapshot,created_by) VALUES (UUID(),?,CONCAT('AUD-',LEFT(?,8)),?,'Synthetic','audit')`, [tenantA, id, id]), count: (id: string) => pool.execute("SELECT COUNT(*) total FROM erp_sale_orders WHERE client_id=? AND crm_client_id=?", [tenantA, id]) },
      { name: "finance", insert: async (id: string) => { await pool.execute(`INSERT IGNORE INTO erp_financial_categories (public_id,client_id,name,direction) VALUES ('lifecycle-fin-category',?,'Lifecycle audit','both')`, [tenantA]); await pool.execute(`INSERT INTO erp_financial_entries (public_id,client_id,document_number,direction,description,amount_cents,due_date,issue_date,category_id,crm_client_id,source_type,created_by) SELECT UUID(),?,CONCAT('AUD-',LEFT(?,8)),'receivable','Synthetic',100,CURRENT_DATE,CURRENT_DATE,id,?,'manual','audit' FROM erp_financial_categories WHERE client_id=? AND public_id='lifecycle-fin-category'`, [tenantA, id, id, tenantA]); }, count: (id: string) => pool.execute("SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND crm_client_id=?", [tenantA, id]) },
      { name: "whatsapp_conversations", insert: (id: string) => pool.execute(`INSERT INTO wa_conversations (id,client_id,account_id,customer_phone,crm_client_id) VALUES (CONCAT('wa-conversation-',?),?,'synthetic-account','0000000000000',?)`, [id, tenantA, id]), count: (id: string) => pool.execute("SELECT COUNT(*) total FROM wa_conversations WHERE client_id=? AND crm_client_id=?", [tenantA, id]) },
    ];
    for (const dependency of dependencies) {
      const blocked = await newClient(tenantA, `Blocked ${dependency.name}`);
      await dependency.insert(blocked);
      const [before] = await dependency.count(blocked) as any[];
      await expect(caller(tenantA, "admin").deletePermanently({ crmClientId: blocked, expectedVersion: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await getCrmClientById(blocked, tenantA)).not.toBeNull();
      const [after] = await dependency.count(blocked) as any[];
      expect(after[0].total, dependency.name).toBe(before[0].total);
    }
    const [wa] = await getPool().execute("SELECT (SELECT COUNT(*) FROM wa_accounts) accounts, (SELECT COUNT(*) FROM wa_conversations) conversations, (SELECT COUNT(*) FROM wa_messages) messages") as any[];
    expect(wa[0]).toMatchObject({ accounts: 0, conversations: 1, messages: 0 });
  });
});
