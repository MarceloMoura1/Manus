import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));
vi.mock("./db", () => ({ getPool: () => ({ getConnection: async () => mocks }) }));

import { changeCrmClientLifecycle, permanentlyDeleteCrmClient } from "./crm-client-lifecycle";

const input = { tenantId: "tenant-a", crmClientId: "crm-a", expectedVersion: 1, operatorUserId: "user-a", operatorRole: "admin" };

function row(state: "active" | "inactive" | "archived" = "active", version = 1, pre: "active" | "inactive" | null = null) {
  return { crm_client_id: "crm-a", lifecycle_state: state, pre_archive_state: pre, lifecycle_version: version };
}

describe("CRM lifecycle transactions", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    ["deactivate", "active", "inactive"],
    ["reactivate", "inactive", "active"],
    ["archive", "active", "archived"],
    ["restore", "archived", "inactive"],
  ] as const)("applies %s inside the locked tenant row", async (action, from, to) => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE")) return [[row(from, 1, action === "restore" ? "inactive" : null)], []];
      if (sql.includes("UPDATE megadesk_crm_clients")) return [{ affectedRows: 1 }, []];
      return [{ affectedRows: 1 }, []];
    });
    await expect(changeCrmClientLifecycle({ ...input, action })).resolves.toEqual({ state: to, version: 2 });
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.rollback).not.toHaveBeenCalled();
    const auditCall = mocks.execute.mock.calls.find(([sql]) => String(sql).includes("megadesk_domain_audit_logs"));
    expect(JSON.stringify(auditCall)).not.toContain("example.invalid");
  });

  it("rejects stale versions and rolls back", async () => {
    mocks.execute.mockResolvedValueOnce([[row("active", 2)], []]);
    await expect(changeCrmClientLifecycle({ ...input, action: "deactivate" })).rejects.toMatchObject({ kind: "conflict" });
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it.each([0, 1, 2, 3, 4, 5, 6])("blocks deletion when dependency category %i exists", async dependencyIndex => {
    let dependency = 0;
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE")) return [[row()], []];
      if (sql.includes("COUNT(*) total")) return [[{ total: dependency++ === dependencyIndex ? 1 : 0 }], []];
      return [{ affectedRows: 1 }, []];
    });
    await expect(permanentlyDeleteCrmClient(input)).rejects.toMatchObject({ kind: "dependencies" });
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM megadesk_crm_clients"))).toBe(false);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it("deletes only the dependency-free tenant row and audits the technical id", async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE")) return [[row()], []];
      if (sql.includes("COUNT(*) total")) return [[{ total: 0 }], []];
      return [{ affectedRows: 1 }, []];
    });
    await expect(permanentlyDeleteCrmClient(input)).resolves.toEqual({ success: true });
    const deletion = mocks.execute.mock.calls.find(([sql]) => String(sql).startsWith("DELETE FROM megadesk_crm_clients"));
    expect(deletion?.[1]).toEqual(["tenant-a", "crm-a", 1]);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });
});
