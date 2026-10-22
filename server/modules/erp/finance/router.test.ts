import { describe, expect, it } from "vitest";
import { financeRouter } from "./router";

const sourcePublicId = "11111111-1111-4111-8111-111111111111";
const categoryPublicId = "22222222-2222-4222-8222-222222222222";

function context(role: "admin" | "manager" | "agent" | "viewer", permissions: string[]) {
  return {
    tenantId: "tenant-session",
    operationalUserId: `user-${role}`,
    operationalUserRole: role,
    operationalPermissions: permissions,
    operationalSessionId: `session-${role}`,
    userEmail: `${role}@example.invalid`,
    req: { headers: {} },
    res: {},
    user: null,
  } as never;
}

describe("finance ERP authorization", () => {
  it("blocks the legacy fromSale endpoint when the session lacks ERP permission", async () => {
    await expect(
      financeRouter.createCaller(context("admin", ["clients"])).fromSale({
        sourcePublicId,
        dueDate: "2026-10-31",
        categoryPublicId,
        financialAccountPublicId: null,
        notes: null,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Acesso ao módulo ERP indisponível.",
    });
  });

  it("keeps viewer access read-only even when ERP permission is present", async () => {
    await expect(
      financeRouter.createCaller(context("viewer", ["erp"])).fromSale({
        sourcePublicId,
        dueDate: "2026-10-31",
        categoryPublicId,
        financialAccountPublicId: null,
        notes: null,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
