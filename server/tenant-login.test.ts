import { describe, expect, it } from "vitest";
import { resolveTenantLogin, type LoginTenant } from "./_core/tenant-login";

function tenant(clientId: string, overrides: Partial<LoginTenant> = {}): LoginTenant {
  return { clientId, status: "active", accessReleased: true, users: [{ id: `user-${clientId}`, email: "same@example.invalid", status: "active" }], ...overrides };
}

describe("tenant-scoped login resolution", () => {
  it("selects the explicit tenant when the same email exists in two tenants", () => {
    const tenants = [tenant("company-a"), tenant("company-b")];
    expect(resolveTenantLogin(tenants, " COMPANY-B ", " SAME@EXAMPLE.INVALID ")?.tenant.clientId).toBe("company-b");
  });

  it("never falls back to the first tenant for an absent or ambiguous company identity", () => {
    expect(resolveTenantLogin([tenant("company-a"), tenant("company-b")], "missing", "same@example.invalid")).toBeNull();
    expect(resolveTenantLogin([tenant("duplicate"), tenant("DUPLICATE")], "duplicate", "same@example.invalid")).toBeNull();
  });

  it.each([
    { status: "paused" as const, accessReleased: true, userStatus: "active" as const },
    { status: "active" as const, accessReleased: false, userStatus: "active" as const },
    { status: "active" as const, accessReleased: true, userStatus: "blocked" as const },
  ])("fails closed for tenant/user state %#", ({ status, accessReleased, userStatus }) => {
    const target = tenant("company-a", { status, accessReleased, users: [{ id: "user-a", email: "same@example.invalid", status: userStatus }] });
    expect(resolveTenantLogin([target], "company-a", "same@example.invalid")).toBeNull();
  });
});
