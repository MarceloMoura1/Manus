import { describe, expect, it } from "vitest";
import { resolveTenantLoginCandidates, type LoginTenant } from "./_core/tenant-login";

function tenant(clientId: string, overrides: Partial<LoginTenant> = {}): LoginTenant {
  return { clientId, status: "active", accessReleased: true, users: [{ id: `user-${clientId}`, email: "same@example.invalid", status: "active" }], ...overrides };
}

describe("credential-based tenant login resolution", () => {
  it("returns every eligible tenant candidate for password verification", () => {
    const tenants = [tenant("company-a"), tenant("company-b")];
    expect(resolveTenantLoginCandidates(tenants, " SAME@EXAMPLE.INVALID ")).toHaveLength(2);
  });

  it("returns no candidate for an unknown email", () => {
    expect(resolveTenantLoginCandidates([tenant("company-a")], "missing@example.invalid")).toHaveLength(0);
  });

  it.each([
    { status: "paused" as const, accessReleased: true, userStatus: "active" as const },
    { status: "active" as const, accessReleased: false, userStatus: "active" as const },
    { status: "active" as const, accessReleased: true, userStatus: "blocked" as const },
  ])("fails closed for tenant/user state %#", ({ status, accessReleased, userStatus }) => {
    const target = tenant("company-a", { status, accessReleased, users: [{ id: "user-a", email: "same@example.invalid", status: userStatus }] });
    expect(resolveTenantLoginCandidates([target], "same@example.invalid")).toHaveLength(0);
  });
});
