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
});
