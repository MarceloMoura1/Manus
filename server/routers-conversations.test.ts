import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("./db", () => ({ getPool: () => ({ execute: mocks.execute, getConnection: mocks.getConnection }) }));

import { conversationsRouter } from "./routers-conversations";

function context(userId = "user-a", tenantId = "tenant-a", role = "agent", permissions = ["conversations"]) {
  return { tenantId, operationalUserId: userId, operationalUserRole: role,
    operationalPermissions: permissions, userEmail: `${userId}@example.invalid`, req: { headers: {} } } as any;
}

function connection(sequence: unknown[]) {
  return { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    execute: vi.fn().mockImplementation(() => Promise.resolve(sequence.shift())) };
}

describe("Conversations authorization, filters and lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives tenant, pagination and all/mine/waiting filters exclusively on the backend", async () => {
    mocks.execute.mockResolvedValue([[]]);
    await conversationsRouter.createCaller(context()).list({ viewMode: "mine", status: "active", search: "CV-1", limit: 20, offset: 5 });
    const [sql, values] = mocks.execute.mock.calls[0];
    expect(sql).toContain("c.client_id = ?");
    expect(sql).toContain("c.status = 'open' AND c.assigned_user_id IS NOT NULL");
    expect(sql).toContain("u.client_id = c.client_id");
    expect(sql).toContain("JSON_CONTAINS(u.permissions_json");
    expect(sql).toContain("c.assigned_user_id = ?");
    expect(sql).toContain("LIMIT 20 OFFSET 5");
    expect(values[0]).toBe("tenant-a");
    expect(values).toContain("user-a");
    expect(values).not.toContain("tenant-b");

    mocks.execute.mockClear().mockResolvedValue([[]]);
    await conversationsRouter.createCaller(context()).list({ viewMode: "waiting", status: "active", search: "", limit: 30, offset: 0 });
    expect(mocks.execute.mock.calls[0][0]).toContain("c.status = 'bot' AND c.assigned_user_id IS NULL");

    mocks.execute.mockClear().mockResolvedValue([[]]);
    await conversationsRouter.createCaller(context()).list({ viewMode: "mine", status: "closed", search: "", limit: 30, offset: 0 });
    expect(mocks.execute.mock.calls[0][0]).toContain("c.status = 'closed'");
    expect(mocks.execute.mock.calls[0][0]).not.toContain("c.assigned_user_id = ?");
  });

  it("counts the same disjoint open, mine, bot and closed inboxes used by listing", async () => {
    mocks.execute.mockResolvedValue([[{ active: 3, mine: 1, waiting: 2, closed: 4 }]]);
    const result = await conversationsRouter.createCaller(context()).counts();
    const [sql, values] = mocks.execute.mock.calls[0];
    expect(sql).toContain("c.status = 'open' AND c.assigned_user_id IS NOT NULL");
    expect(sql).toContain("u.client_id = c.client_id");
    expect(sql).toContain("c.status = 'open' AND c.assigned_user_id = ?");
    expect(sql).toContain("c.status = 'bot' AND c.assigned_user_id IS NULL");
    expect(sql).toContain("c.status = 'closed'");
    expect(values).toEqual(["user-a", "tenant-a"]);
    expect(result).toEqual({ active: 3, mine: 1, waiting: 2, closed: 4 });
  });

  it.each([
    ["viewer", ["conversations"]],
    ["agent", []],
  ])("refuses an ineligible role or missing permission", async (role, permissions) => {
    await expect(conversationsRouter.createCaller(context("user-a", "tenant-a", role as string, permissions as string[])).counts())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("transfers within the tenant, records the event and uses optimistic ownership", async () => {
    mocks.execute.mockResolvedValueOnce([[{ user_id: "user-b", name: "B" }]]);
    const db = connection([
      [[{ assigned_user_id: "user-a" }]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mocks.getConnection.mockResolvedValue(db);
    const result = await conversationsRouter.createCaller(context()).transfer({
      conversationId: "conv-a", targetUserId: "user-b", expectedAssignedUserId: "user-a",
    });
    expect(result).toMatchObject({ assignedUserId: "user-b" });
    expect(db.execute.mock.calls[1][0]).toContain("assigned_user_id <=> ?");
    expect(db.execute.mock.calls[1][1]).toEqual(expect.arrayContaining(["tenant-a", "user-a"]));
    expect(db.execute.mock.calls[2][1][5]).toContain('"fromUserId":"user-a"');
    expect(db.commit).toHaveBeenCalledOnce();
  });

  it("rejects stale concurrent transfer and never writes the new owner", async () => {
    mocks.execute.mockResolvedValueOnce([[{ user_id: "user-b", name: "B" }]]);
    const db = connection([[[{ assigned_user_id: "user-c" }]]]);
    mocks.getConnection.mockResolvedValue(db);
    await expect(conversationsRouter.createCaller(context()).transfer({
      conversationId: "conv-a", targetUserId: "user-b", expectedAssignedUserId: "user-a",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.rollback).toHaveBeenCalledOnce();
  });

  it("blocks manual reopen when another active attendance has the same canonical key", async () => {
    mocks.execute.mockResolvedValueOnce([[{ user_id: "user-a", name: "A" }]]);
    const db = connection([
      [[{ conversation_id: "closed-a", requested_active_key: "key-a" }]],
      [[{ conversation_id: "open-a" }]],
    ]);
    mocks.getConnection.mockResolvedValue(db);
    await expect(conversationsRouter.createCaller(context()).reopen({ conversationId: "closed-a" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.rollback).toHaveBeenCalledOnce();
  });

  it("reads the canonical contact name and free-text company without conflating the CRM company", async () => {
    mocks.execute.mockResolvedValue([[]]);
    await conversationsRouter.createCaller(context()).list({ viewMode: "all", status: "active", search: "", limit: 30, offset: 0 });
    const sql = mocks.execute.mock.calls[0][0] as string;
    expect(sql).toContain("LEFT JOIN megadesk_conversation_contacts contact");
    expect(sql).toContain("contact.contact_id = c.contact_id AND contact.client_id = c.client_id");
    expect(sql).toContain("contact.company_text AS companyText");
    expect(sql).toContain("crm.company_name AS companyName");
    expect(sql).toContain("crm.crm_client_id AS crmClientId");
    expect(sql).toContain("crm.crm_client_id = contact.crm_client_id");
  });

  it("lists tenant-scoped person, company and legacy CRM candidates with bounded pagination", async () => {
    mocks.execute.mockResolvedValue([[{ id: "crm-a", name: "Empresa A", document: "1234", customerType: "company" }]]);
    const result = await conversationsRouter.createCaller(context()).companyCandidates({ search: "Empresa", limit: 10, offset: 20 });
    const [sql, values] = mocks.execute.mock.calls[0];
    expect(sql).toContain("client_id = ?");
    expect(sql).toContain("company_name LIKE ? OR responsible_name LIKE ? OR cpf_cnpj LIKE ?");
    expect(sql).toContain("phone LIKE ? OR whatsapp LIKE ?");
    expect(sql).toContain("LIMIT 10 OFFSET 20");
    expect(values).toEqual(["tenant-a", "%Empresa%", "%Empresa%", "%Empresa%", "%Empresa%", "%%", "%%", "%%"]);
    expect(result).toMatchObject({ hasMore: false, items: [{ id: "crm-a" }] });
  });

  it.each(["", "   ", "a", " a "])("returns no broad CRM listing for an invalid search term (%j)", async search => {
    const result = await conversationsRouter.createCaller(context()).companyCandidates({ search, limit: 10, offset: 0 });
    expect(result).toEqual({ items: [], hasMore: false });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("resolves exact normalized phone candidates in the authenticated tenant", async () => {
    mocks.execute.mockResolvedValue([[{ id: "crm-p", name: "Pessoa", customerType: "person" }]]);
    const result = await conversationsRouter.createCaller(context()).phoneCandidates({ phone: "(11) 99999-9999" });
    const [sql, values] = mocks.execute.mock.calls[0];
    expect(sql).toContain("client_id = ? AND lifecycle_state = 'active' AND (phone = ? OR whatsapp = ?)");
    expect(values[0]).toBe("tenant-a");
    expect(values[1]).toBe(values[2]);
    expect(result.items).toHaveLength(1);
  });

  it("reads tickets only through explicit links or the contact's canonical CRM company", async () => {
    mocks.execute.mockResolvedValue([[]]);
    await conversationsRouter.createCaller(context()).linkedTickets({ conversationId: "conv-a" });
    const [sql, values] = mocks.execute.mock.calls[0];
    expect(sql).toContain("megadesk_conversation_tickets l");
    expect(sql).toContain("t.customerId = contact.crm_client_id");
    expect(sql).not.toMatch(/phone|company_text|customer_name|LIKE/i);
    expect(values).toEqual(["tenant-a", "conv-a"]);
  });

  it("reads historical messages tenant-scoped without lifecycle writes", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ id: "conv-old", publicCode: "CV-9", messagesJson: "[]" }]])
      .mockResolvedValueOnce([[{ id: "msg-1", text: "Histórico", mediaReference: null }]]);
    const result = await conversationsRouter.createCaller(context()).historyDetail({ conversationId: "conv-old" });
    expect(mocks.execute.mock.calls).toHaveLength(2);
    expect(mocks.execute.mock.calls[0][1]).toEqual(["tenant-a", "conv-old"]);
    expect(mocks.execute.mock.calls[1][1]).toEqual(["tenant-a", "conv-old"]);
    expect(mocks.execute.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql as string))).toBe(true);
    expect(result.messages).toHaveLength(1);
  });

  it("links and unlinks only the canonical contact CRM id while preserving contact fields", async () => {
    const linked = connection([
      [[{ contact_id: "contact-a" }]],
      [[{ crm_client_id: "crm-a" }]],
      [{ affectedRows: 1 }],
    ]);
    mocks.getConnection.mockResolvedValueOnce(linked);
    await conversationsRouter.createCaller(context()).linkCrm({ contactId: "contact-a", crmClientId: "crm-a" });
    const [writeSql, writeValues] = linked.execute.mock.calls[2];
    expect(writeSql).toContain("SET crm_client_id = ?, updated_at = NOW()");
    expect(writeSql).not.toMatch(/display_name|canonical_phone|company_text|megadesk_domain_conversations/i);
    expect(writeValues).toEqual(["crm-a", "contact-a", "tenant-a"]);
    expect(linked.commit).toHaveBeenCalledOnce();

    const unlinked = connection([[[{ contact_id: "contact-a" }]], [{ affectedRows: 1 }]]);
    mocks.getConnection.mockResolvedValueOnce(unlinked);
    await conversationsRouter.createCaller(context()).linkCrm({ contactId: "contact-a", crmClientId: null });
    expect(unlinked.execute.mock.calls[1][1]).toEqual([null, "contact-a", "tenant-a"]);
    expect(unlinked.execute).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing or cross-tenant CRM candidate without updating the contact", async () => {
    const db = connection([[[{ contact_id: "contact-a" }]], [[]]]);
    mocks.getConnection.mockResolvedValue(db);
    await expect(conversationsRouter.createCaller(context()).linkCrm({ contactId: "contact-a", crmClientId: "crm-b" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.rollback).toHaveBeenCalledOnce();
  });

  it("updates only provided contact fields in the authenticated tenant and returns the canonical contact", async () => {
    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ contactId: "contact-a", displayName: "Maria", companyText: "Árvore Ltda", canonicalPhone: "5511999999999", crmClientId: "crm-a" }]]);
    const result = await conversationsRouter.createCaller(context()).updateContact({
      contactId: "contact-a", displayName: "  Maria  ", companyText: "  Árvore Ltda  ",
    });
    const [writeSql, values] = mocks.execute.mock.calls[0];
    expect(writeSql).toContain("UPDATE megadesk_conversation_contacts");
    expect(writeSql).toContain("display_name = ?");
    expect(writeSql).toContain("company_text = ?");
    expect(writeSql).not.toMatch(/canonical_phone|crm_client_id|wa_/i);
    expect(values).toEqual(["Maria", "Árvore Ltda", "contact-a", "tenant-a"]);
    expect(result).toMatchObject({ displayName: "Maria", companyText: "Árvore Ltda", canonicalPhone: "5511999999999", crmClientId: "crm-a" });
    expect(mocks.execute.mock.calls[1][1]).toEqual(["contact-a", "tenant-a"]);
  });

  it.each([
    ["empty", "   ", null],
    ["null", null, null],
    ["limit", "x".repeat(255), "x".repeat(255)],
  ])("normalizes companyText %s without changing the name", async (_case, companyText, expected) => {
    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ contactId: "contact-a", displayName: "Original", companyText: expected, canonicalPhone: "5511", crmClientId: "crm-a" }]]);
    await conversationsRouter.createCaller(context()).updateContact({ contactId: "contact-a", companyText });
    const [sql, values] = mocks.execute.mock.calls[0];
    expect(sql).toContain("company_text = ?");
    expect(sql).not.toContain("display_name = ?");
    expect(values).toEqual([expected, "contact-a", "tenant-a"]);
  });

  it("preserves companyText when omitted and rejects values above 255 characters", async () => {
    mocks.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ contactId: "contact-a", displayName: "Novo", companyText: "Preservada", canonicalPhone: "5511", crmClientId: "crm-a" }]]);
    await conversationsRouter.createCaller(context()).updateContact({ contactId: "contact-a", displayName: "Novo" });
    expect(mocks.execute.mock.calls[0][0]).not.toContain("company_text = ?");
    await expect(conversationsRouter.createCaller(context()).updateContact({ contactId: "contact-a", companyText: "x".repeat(256) }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(conversationsRouter.createCaller(context()).updateContact({ contactId: "contact-a", companyText: "<b>Empresa</b>" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(conversationsRouter.createCaller(context()).updateContact({ contactId: "contact-a", companyText: '{"name":"Empresa"}' }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("blocks cross-tenant contacts and callers without conversation permission", async () => {
    mocks.execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(conversationsRouter.createCaller(context()).updateContact({ contactId: "contact-b", displayName: "Outro" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.execute.mock.calls[0][1]).toEqual(["Outro", "contact-b", "tenant-a"]);
    mocks.execute.mockClear();
    await expect(conversationsRouter.createCaller(context("user-a", "tenant-a", "agent", [])).updateContact({ contactId: "contact-a", displayName: "Novo" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
