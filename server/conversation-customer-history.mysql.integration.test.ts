import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { conversationsRouter } from "./routers-conversations";

const physical = describe.runIf(process.env.RUN_DATABASE_INTEGRATION === "1");
const tenantA = "audit-customer-history-a";
const tenantB = "audit-customer-history-b";

function caller(tenantId = tenantA) {
  return conversationsRouter.createCaller({ tenantId, operationalUserId: "audit-agent", operationalUserRole: "agent",
    operationalPermissions: ["conversations"], userEmail: "agent@example.invalid", req: { headers: {} } } as any);
}

async function rows(sql: string, values: unknown[] = []) {
  const [result] = await getPool().execute<RowDataPacket[]>(sql, values);
  return result;
}

async function reset() {
  const pool = getPool();
  await pool.execute("DELETE FROM megadesk_conversation_tickets WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_conversations_messages WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_chamados WHERE clientId IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_conversations WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_conversation_contacts WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_clients WHERE client_id IN (?,?)", [tenantA, tenantB]);
}

physical.sequential("canonical customer, tickets and read-only history", () => {
  beforeAll(async () => {
    await reset();
    const pool = getPool();
    await pool.execute(
      `INSERT INTO megadesk_domain_clients
       (client_id,internal_id,tenant_database_name,company,contact,email,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json)
       VALUES (?, 'audit-customer-a', 'audit_customer_a', 'Synthetic A', 'Synthetic', 'a@example.invalid', '0001', 'audit', 'active', 'test', 1, 'token-a', '[]', '{}'),
              (?, 'audit-customer-b', 'audit_customer_b', 'Synthetic B', 'Synthetic', 'b@example.invalid', '0002', 'audit', 'active', 'test', 1, 'token-b', '[]', '{}')`,
      [tenantA, tenantB],
    );
    await pool.execute(
      `INSERT INTO megadesk_crm_clients (crm_client_id,client_id,company_name,cpf_cnpj,customer_type) VALUES
       ('crm-company-a',?,'Alpha Company','11111111000111','company'),
       ('crm-person-a',?,'Alpha Person','11111111111','person'),
       ('crm-company-b',?,'Beta Company','22222222000122','company')`,
      [tenantA, tenantA, tenantB],
    );
    await pool.execute(
      `INSERT INTO megadesk_conversation_contacts
       (contact_id,client_id,display_name,company_text,canonical_phone,channel,provider,external_identity)
       VALUES ('contact-a',?,'Synthetic Contact','Free Company','5511999990001','whatsapp','evolution','5511999990001')`, [tenantA],
    );
    await pool.execute(
      `INSERT INTO megadesk_domain_conversations
       (conversation_id,client_id,public_code,contact_id,origin,channel,provider,customer_name,phone,company,status,last_message,time_label,messages_json)
       VALUES ('conv-current',?,'CV-CURRENT','contact-a','inbound','whatsapp','evolution','Synthetic Contact','5511999990001','','open','Current','','[]'),
              ('conv-old',?,'CV-OLD','contact-a','inbound','whatsapp','evolution','Synthetic Contact','5511999990001','','closed','Old','','[]')`,
      [tenantA, tenantA],
    );
    await pool.execute(
      `INSERT INTO megadesk_domain_conversations_messages
       (message_id,conversation_id,client_id,sender,message,timestamp,direction,message_type,status)
       VALUES ('history-message','conv-old',?,'customer','Historical text',NOW(),'inbound','text','received')`, [tenantA],
    );
    await pool.execute(
      `INSERT INTO megadesk_domain_chamados
       (chamadoId,clientId,chamadoNumber,customerId,customerName,title,status)
       VALUES ('ticket-crm',?,1,'crm-company-a','Alpha Company','Canonical CRM','open'),
              ('ticket-explicit',?,2,NULL,'Synthetic Contact','Explicit link','open'),
              ('ticket-unrelated',?,3,'crm-person-a','Alpha Person','Unrelated','open')`,
      [tenantA, tenantA, tenantA],
    );
    await pool.execute(
      `INSERT INTO megadesk_conversation_tickets
       (link_id,client_id,conversation_id,chamado_id,contact_id,linked_by_user_id)
       VALUES ('link-explicit',?,'conv-current','ticket-explicit','contact-a','audit-agent')`, [tenantA],
    );
  });

  afterAll(async () => { await reset(); await getPool().end(); });

  it("returns only company candidates from the authenticated tenant", async () => {
    const result = await caller().companyCandidates({ search: "Alpha", limit: 10, offset: 0 });
    expect(result.items.map(item => item.id)).toEqual(["crm-company-a"]);
    expect((await caller(tenantB).companyCandidates({ search: "Alpha", limit: 10, offset: 0 })).items).toEqual([]);
  });

  it("links exactly once while preserving identity and free company, and rejects invalid companies", async () => {
    await caller().linkCrm({ contactId: "contact-a", crmClientId: "crm-company-a" });
    expect((await rows("SELECT display_name,company_text,canonical_phone,crm_client_id FROM megadesk_conversation_contacts WHERE contact_id='contact-a'"))[0])
      .toMatchObject({ display_name: "Synthetic Contact", company_text: "Free Company", canonical_phone: "5511999990001", crm_client_id: "crm-company-a" });
    await expect(caller().linkCrm({ contactId: "contact-a", crmClientId: "crm-person-a" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().linkCrm({ contactId: "contact-a", crmClientId: "crm-company-b" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("finds tickets through canonical CRM id and the explicit link only", async () => {
    const tickets = await caller().linkedTickets({ conversationId: "conv-current" });
    expect(tickets.map(ticket => ticket.id).sort()).toEqual(["ticket-crm", "ticket-explicit"]);
  });

  it("reads prior normalized history without changing conversation or message rows", async () => {
    const before = await rows("SELECT conversation_id,status,last_message,messages_json FROM megadesk_domain_conversations WHERE client_id=? ORDER BY conversation_id", [tenantA]);
    const messageBefore = await rows("SELECT message_id,message,direction FROM megadesk_domain_conversations_messages WHERE client_id=?", [tenantA]);
    const detail = await caller().historyDetail({ conversationId: "conv-old" });
    expect(detail.conversation).toMatchObject({ id: "conv-old", publicCode: "CV-OLD", status: "closed" });
    expect(detail.messages).toMatchObject([{ id: "history-message", text: "Historical text", direction: "inbound" }]);
    expect(await rows("SELECT conversation_id,status,last_message,messages_json FROM megadesk_domain_conversations WHERE client_id=? ORDER BY conversation_id", [tenantA])).toEqual(before);
    expect(await rows("SELECT message_id,message,direction FROM megadesk_domain_conversations_messages WHERE client_id=?", [tenantA])).toEqual(messageBefore);
  });

  it("unlinks only crm_client_id and immediately removes the CRM-derived ticket", async () => {
    await caller().linkCrm({ contactId: "contact-a", crmClientId: null });
    expect((await rows("SELECT display_name,company_text,canonical_phone,crm_client_id FROM megadesk_conversation_contacts WHERE contact_id='contact-a'"))[0])
      .toMatchObject({ display_name: "Synthetic Contact", company_text: "Free Company", canonical_phone: "5511999990001", crm_client_id: null });
    expect((await caller().linkedTickets({ conversationId: "conv-current" })).map(ticket => ticket.id)).toEqual(["ticket-explicit"]);
  });
});
