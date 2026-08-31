import { beforeAll, describe, expect, it } from "vitest";
import { getPool } from "./db";
import { findDuplicateCrmClient, getCrmClientById } from "./db-crm";
import { crmRouter } from "./routers-crm";
import { conversationsRouter } from "./routers-conversations";

const enabled = process.env.RUN_CRM_NULL_AUDIT === "1";
const tenantA = "audit2-tenant-a";
const tenantB = "audit2-tenant-b";

function crmCaller(tenantId = tenantA) {
  return crmRouter.createCaller({ tenantId, operationalUserId: "audit-admin", operationalUserRole: "admin",
    operationalPermissions: ["clients", "conversations"], userEmail: "audit@example.invalid", req: { headers: {} } } as any);
}

function conversationsCaller(tenantId = tenantA) {
  return conversationsRouter.createCaller({ tenantId, operationalUserId: "audit-admin", operationalUserRole: "admin",
    operationalPermissions: ["clients", "conversations"], userEmail: "audit@example.invalid", req: { headers: {} } } as any);
}

describe.skipIf(!enabled)("CRM nullable fields on isolated disposable MySQL", () => {
  beforeAll(async () => {
    const configured = new URL(process.env.TEST_DATABASE_URL ?? "mysql://invalid/invalid");
    if (configured.hostname !== "127.0.0.1" || configured.port !== "3317" || configured.pathname !== "/megadesk_test_crm_null_edit_audit2") {
      throw new Error("CRM null audit requires its exact disposable database on 127.0.0.1:3317.");
    }
    const pool = getPool();
    await pool.execute("DROP TABLE IF EXISTS megadesk_conversation_contacts");
    await pool.execute("DROP TABLE IF EXISTS megadesk_crm_timeline");
    await pool.execute("DROP TABLE IF EXISTS megadesk_crm_clients");
    await pool.execute(`CREATE TABLE megadesk_crm_clients (
      crm_client_id VARCHAR(80) PRIMARY KEY, client_id VARCHAR(80) NOT NULL, customer_type ENUM('person','company') NULL,
      company_name VARCHAR(255) NOT NULL, responsible_name VARCHAR(180) NULL, cpf_cnpj VARCHAR(20) NULL,
      phone VARCHAR(40) NULL, whatsapp VARCHAR(40) NULL, email VARCHAR(255) NULL, address VARCHAR(255) NULL,
      city VARCHAR(120) NULL, state VARCHAR(2) NULL, cep VARCHAR(10) NULL,
      status ENUM('lead','ativo','inativo','cancelado','inadimplente') NULL,
      origin ENUM('whatsapp','instagram','facebook','site','indicacao','outro') NULL,
      internal_responsible VARCHAR(180) NULL, tags TEXT NULL, observations TEXT NULL, contacts_json TEXT NULL,
      last_interaction_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_mcc_tenant_document(client_id,cpf_cnpj), UNIQUE KEY uq_mcc_tenant_phone(client_id,phone),
      UNIQUE KEY uq_mcc_tenant_email(client_id,email), INDEX idx_mcc_client(client_id)
    )`);
    await pool.execute(`CREATE TABLE megadesk_crm_timeline (
      timeline_id VARCHAR(80) PRIMARY KEY, crm_client_id VARCHAR(80) NOT NULL, client_id VARCHAR(80) NOT NULL,
      entry_type VARCHAR(40) NOT NULL, description TEXT NOT NULL, author VARCHAR(255) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.execute(`CREATE TABLE megadesk_conversation_contacts (
      contact_id VARCHAR(80) PRIMARY KEY, client_id VARCHAR(80) NOT NULL, display_name VARCHAR(180) NOT NULL,
      canonical_phone VARCHAR(40) NULL, channel VARCHAR(30) NULL, provider VARCHAR(30) NULL,
      external_identity VARCHAR(120) NULL, crm_client_id VARCHAR(80) NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await pool.execute(`INSERT INTO megadesk_crm_clients
      (crm_client_id,client_id,customer_type,company_name,responsible_name,cpf_cnpj,phone,whatsapp,email,address,city,state,cep,status,origin,internal_responsible,tags,observations,contacts_json)
      VALUES
      ('legacy-person',?,'person','Nome Igual',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'ativo','outro',NULL,NULL,'preservar pessoa',NULL),
      ('legacy-company',?,'company','Nome Igual',NULL,NULL,'5511999990001',NULL,NULL,NULL,NULL,NULL,NULL,'lead','site',NULL,NULL,'preservar empresa',NULL),
      ('other-tenant',?,'company','Nome Igual',NULL,'11222333000181','5511999990001',NULL,NULL,NULL,NULL,NULL,NULL,'lead','outro',NULL,NULL,NULL,NULL)`,
      [tenantA, tenantA, tenantB]);
    await pool.execute(`INSERT INTO megadesk_conversation_contacts
      (contact_id,client_id,display_name,canonical_phone,channel,provider,external_identity)
      VALUES ('audit-contact',?,'Contato sintético','5511988880001','whatsapp','test','audit-external')`, [tenantA]);
  });

  it("reads legacy person/company nullable optionals and saves empty document/email", async () => {
    for (const id of ["legacy-person", "legacy-company"]) {
      const before = await getCrmClientById(id, tenantA);
      expect(before).toMatchObject({ cpfCnpj: null, email: null, responsibleName: null, contactsJson: null });
      await crmCaller().update({ crmClientId: id, data: { cpfCnpj: "", email: "", phone: "", whatsapp: "",
        responsibleName: "", address: "", city: "", state: "", cep: "", internalResponsible: "", observations: before!.observations ?? "" } });
      const after = await getCrmClientById(id, tenantA);
      expect(after).toMatchObject({ cpfCnpj: null, email: null, phone: null, observations: before!.observations });
    }
  });

  it("accepts valid optional identity values and rejects invalid document/email safely", async () => {
    await crmCaller().update({ crmClientId: "legacy-person", data: { cpfCnpj: "52998224725", email: "person@example.invalid" } });
    await expect(crmCaller().update({ crmClientId: "legacy-person", data: { cpfCnpj: "111" } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "CPF inválido." });
    await expect(crmCaller().update({ crmClientId: "legacy-person", data: { email: "invalid" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("creates a new client, blocks same-tenant duplicates and permits the identity in another tenant", async () => {
    const data = { customerType: "company" as const, companyName: "Novo sintético", responsibleName: "", cpfCnpj: "11222333000181",
      phone: "11988880001", whatsapp: "", email: "", address: "", city: "", state: "", cep: "", status: "lead" as const,
      origin: "outro" as const, internalResponsible: "", tags: "", observations: "", contacts: [] };
    const created = await crmCaller().create({ data });
    await expect(crmCaller().create({ data: { ...data, companyName: "Duplicado" } })).rejects.toMatchObject({ code: "CONFLICT" });
    const duplicate = await findDuplicateCrmClient(tenantA, data);
    expect(duplicate).toMatchObject({ crmClientId: created.crmClientId, companyName: "Novo sintético" });
    expect(await getCrmClientById("other-tenant", tenantB)).toMatchObject({ cpfCnpj: "11222333000181", phone: "5511999990001" });
    expect(await getCrmClientById("other-tenant", tenantA)).toBeNull();
  });

  it("keeps equal names selectable, tenant-scoped and links exactly the created CRM id", async () => {
    const candidates = await conversationsCaller().companyCandidates({ search: "Nome Igual", limit: 10, offset: 0 });
    expect(candidates.items.map(item => item.id)).toEqual(["legacy-company", "legacy-person"]);
    expect(candidates.items).toHaveLength(2);
    const created = await crmCaller().create({ data: { customerType: "person", companyName: "Vinculável", responsibleName: "", cpfCnpj: "",
      phone: "11977770001", whatsapp: "", email: "", address: "", city: "", state: "", cep: "", status: "lead", origin: "outro",
      internalResponsible: "", tags: "", observations: "", contacts: [] } });
    await conversationsCaller().linkCrm({ contactId: "audit-contact", crmClientId: created.crmClientId });
    const [rows] = await getPool().execute("SELECT crm_client_id AS crmClientId FROM megadesk_conversation_contacts WHERE contact_id='audit-contact' AND client_id=?", [tenantA]) as any[];
    expect(rows[0].crmClientId).toBe(created.crmClientId);
  });
});
