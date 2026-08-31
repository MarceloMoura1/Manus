import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "./db";
import { createCrmClient, getCrmClientById, listCrmClients, updateCrmClient } from "./db-crm";
import { crmRouter } from "./routers-crm";

const runPhysical = process.env.RUN_DATABASE_INTEGRATION === "1";
const tenantA = `crm-test-a-${randomUUID()}`;
const tenantB = `crm-test-b-${randomUUID()}`;
let publicId = "";

function caller(tenantId: string, role: "admin" | "manager" | "agent" | "viewer", permissions = ["clients"]) {
  return crmRouter.createCaller({
    tenantId,
    operationalUserId: `${tenantId}-${role}`,
    operationalUserRole: role,
    operationalPermissions: permissions,
    userEmail: `${role}@example.invalid`,
    req: { headers: {} },
  } as any);
}

function clientData(suffix: string) {
  return {
    customerType: "company" as const,
    companyName: `Cliente ${suffix}`,
    responsibleName: `Responsável ${suffix}`,
    cpfCnpj: "",
    phone: `1199000${suffix.padStart(4, "0")}`,
    whatsapp: `1199000${suffix.padStart(4, "0")}`,
    email: `cliente-${suffix}@example.invalid`,
    address: `Rua ${suffix}, 10`,
    city: "São Paulo",
    state: "SP",
    cep: "01001000",
    status: "ativo" as const,
    origin: "site" as const,
    internalResponsible: "Gestor",
    tags: "físico",
    observations: "Validação física",
    contacts: [{ phone: `1188000${suffix.padStart(4, "0")}`, whatsapp: "", description: "Contato adicional" }],
  };
}

describe.skipIf(!runPhysical)("CRM MySQL tenant isolation", () => {
  beforeAll(async () => {
    const result = await createCrmClient(tenantA, {
      companyName: "Cliente físico isolado",
      responsibleName: "Responsável",
      cpfCnpj: "",
      phone: "",
      whatsapp: "",
      email: "",
      address: "",
      city: "",
      state: "",
      cep: "",
      status: "lead",
      origin: "outro",
      internalResponsible: "",
      tags: "",
      observations: "",
      contacts: [],
    });
    publicId = result.crmClientId;
  });

  afterAll(async () => {
    if (!runPhysical) return;
    await getPool().execute(
      "DELETE FROM megadesk_domain_conversations WHERE client_id IN (?, ?)",
      [tenantA, tenantB],
    );
    await getPool().execute(
      "DELETE FROM megadesk_domain_chamados WHERE clientId IN (?, ?)",
      [tenantA, tenantB],
    );
    await getPool().execute(
      "DELETE FROM megadesk_crm_timeline WHERE client_id IN (?, ?)",
      [tenantA, tenantB],
    );
    await getPool().execute(
      "DELETE FROM megadesk_crm_clients WHERE client_id IN (?, ?)",
      [tenantA, tenantB],
    );
  });

  it("uses a public commercial ID without exposing the tenant", async () => {
    expect(publicId).toMatch(/^crm-[0-9a-f-]{36}$/);
    const own = await getCrmClientById(publicId, tenantA);
    expect(own?.companyName).toBe("Cliente físico isolado");
    expect(await getCrmClientById(publicId, tenantB)).toBeNull();
  });

  it("keeps list and update tenant-aware", async () => {
    expect(await listCrmClients(tenantB)).toEqual([]);
    await expect(updateCrmClient(publicId, tenantB, { companyName: "Cross tenant" })).rejects.toThrow("Cliente não encontrado ou sem permissão.");
    expect((await getCrmClientById(publicId, tenantA))?.companyName).toBe("Cliente físico isolado");
  });

  it("enforces the admin/manager versus agent/viewer matrix physically", async () => {
    for (const role of ["admin", "manager"] as const) {
      const result = await caller(tenantA, role).list({});
      expect(result.clients.some((client) => client.crmClientId === publicId)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(tenantA);
    }
    for (const role of ["agent", "viewer"] as const) {
      await expect(caller(tenantA, role).list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(tenantA, role, ["clients"]).create({ data: clientData(`blocked-${role}`) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("creates and edits only inside the session tenant", async () => {
    const adminCreated = await caller(tenantA, "admin").create({ data: clientData("101") });
    const managerCreated = await caller(tenantA, "manager").create({ data: clientData("102") });
    await caller(tenantA, "manager").update({ crmClientId: adminCreated.crmClientId, data: { companyName: "Cliente editado fisicamente" } });
    expect((await getCrmClientById(adminCreated.crmClientId, tenantA))?.companyName).toBe("Cliente editado fisicamente");
    expect(await getCrmClientById(managerCreated.crmClientId, tenantB)).toBeNull();
    await expect(caller(tenantB, "admin").getById({ crmClientId: adminCreated.crmClientId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(tenantB, "admin").update({ crmClientId: adminCreated.crmClientId, data: { companyName: "Cross tenant" } })).rejects.toThrow("Cliente não encontrado.");
  });

  it("rejects a forged public tenant field", async () => {
    await expect(caller(tenantA, "admin").list({ clientId: tenantB } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps contacts, address, status and timeline isolated", async () => {
    const own = await getCrmClientById(publicId, tenantA);
    expect(own?.address).toBe("");
    expect(own?.status).toBe("lead");
    await caller(tenantA, "admin").addTimelineEntry({ crmClientId: publicId, description: "Nota física", type: "note" });
    const timeline = await caller(tenantA, "manager").getTimeline({ crmClientId: publicId });
    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]).toMatchObject({ description: "Nota física", author: "admin@example.invalid" });
    await expect(caller(tenantB, "admin").getTimeline({ crmClientId: publicId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("imports and exports CSV data without tenant or internal IDs", async () => {
    const data = clientData("201");
    const imported = await caller(tenantA, "manager").importCsv({ rows: [{
      companyName: data.companyName,
      responsibleName: data.responsibleName,
      cpfCnpj: data.cpfCnpj,
      phone: data.phone,
      whatsapp: data.whatsapp,
      email: data.email,
      address: data.address,
      city: data.city,
      state: data.state,
      cep: data.cep,
      status: data.status,
      origin: data.origin,
      observations: data.observations,
    }] });
    expect(imported).toMatchObject({ imported: 1, errors: 0 });
    const exported = await caller(tenantA, "admin").exportCsv();
    expect(exported.rows.some((row) => row.companyName === "Cliente 201")).toBe(true);
    expect(JSON.stringify(exported)).not.toContain(tenantA);
    expect(JSON.stringify(exported)).not.toContain("crmClientId");
    expect(JSON.stringify(exported)).not.toContain("clientId");
  });

  it("enforces duplicate constraints per tenant while allowing the same identity across tenants", async () => {
    const shared = clientData("301");
    await createCrmClient(tenantA, shared);
    await expect(createCrmClient(tenantA, { ...shared, companyName: "Duplicado" })).rejects.toBeTruthy();
    const otherTenant = await createCrmClient(tenantB, shared);
    expect((await getCrmClientById(otherTenant.crmClientId, tenantB))?.phone).toBe("5511990000301");
  });

  it("returns only canonical conversation and ticket links", async () => {
    const pool = getPool();
    await pool.execute(
      `INSERT INTO megadesk_conversation_contacts
       (contact_id,client_id,display_name,canonical_phone,channel,provider,external_identity,crm_client_id)
       VALUES (?,?,'Canonical contact','550000000001','whatsapp','test',?,?)`,
      [`contact-direct-${tenantA}`, tenantA, `external-${tenantA}`, publicId],
    );
    await pool.execute(
      `INSERT INTO megadesk_domain_conversations
       (conversation_id, client_id, contact_id, crm_client_id, customer_name, phone, company, status, last_message, time_label, messages_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', '', '', '[]'), (?, ?, NULL, NULL, ?, ?, ?, 'open', '', '', '[]'), (?, ?, NULL, NULL, ?, ?, ?, 'open', '', '', '[]')`,
      [
        `conv-direct-${tenantA}`, tenantA, `contact-direct-${tenantA}`, publicId, "Direto", "550000000001", "Direto",
        `conv-legacy-${tenantA}`, tenantA, "Cliente físico isolado", "", "Cliente físico isolado",
        `conv-other-${tenantB}`, tenantB, "Cliente físico isolado", "", "Cliente físico isolado",
      ],
    );
    await pool.execute(
      `INSERT INTO megadesk_domain_chamados
       (chamadoId, clientId, chamadoNumber, customerId, customerName, company, title)
       VALUES (?, ?, 901, ?, ?, ?, 'Direto'), (?, ?, 902, NULL, ?, ?, 'Legado'), (?, ?, 903, NULL, ?, ?, 'Outro tenant')`,
      [
        `ticket-direct-${tenantA}`, tenantA, publicId, "Direto", "Direto",
        `ticket-legacy-${tenantA}`, tenantA, "Cliente físico isolado", "Cliente físico isolado",
        `ticket-other-${tenantB}`, tenantB, "Cliente físico isolado", "Cliente físico isolado",
      ],
    );
    const conversations = await caller(tenantA, "admin").getConversas({ crmClientId: publicId });
    expect(conversations.conversas.map((item) => item.id)).toEqual([`conv-direct-${tenantA}`]);
    expect(conversations.conversas.map((item) => item.id)).not.toContain(`conv-other-${tenantB}`);
    const tickets = await caller(tenantA, "admin").getChamados({ crmClientId: publicId });
    expect(tickets.chamados.map((item) => item.id)).toEqual([`ticket-direct-${tenantA}`]);
    expect(tickets.chamados.map((item) => item.id)).not.toContain(`ticket-other-${tenantB}`);
  });

  it("keeps physical deletion unavailable", () => {
    expect((crmRouter as any)._def.procedures.delete).toBeUndefined();
  });
});
