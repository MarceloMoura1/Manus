export type LoginTenant = {
  clientId: string;
  status: "provisioning" | "active" | "setup" | "failed" | "paused";
  accessReleased: boolean;
  users: Array<{ id: string; email: string; status: "active" | "blocked" }>;
};

export function normalizeCompanyIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveTenantLogin<T extends LoginTenant>(tenants: readonly T[], companyId: string, email: string): { tenant: T; user: T["users"][number] } | null {
  const normalizedCompanyId = normalizeCompanyIdentifier(companyId);
  const normalizedEmail = email.trim().toLowerCase();
  const matches = tenants.filter((tenant) => tenant.clientId.toLowerCase() === normalizedCompanyId);
  if (matches.length !== 1) return null;
  const tenant = matches[0];
  if (tenant.status !== "active" || !tenant.accessReleased) return null;
  const users = tenant.users.filter((user) => user.email.trim().toLowerCase() === normalizedEmail);
  if (users.length !== 1 || users[0].status !== "active") return null;
  return { tenant, user: users[0] };
}
