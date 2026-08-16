export type LoginTenant = {
  clientId: string;
  status: "provisioning" | "active" | "setup" | "failed" | "paused";
  accessReleased: boolean;
  users: Array<{ id: string; email: string; status: "active" | "blocked" }>;
};

export function resolveTenantLoginCandidates<T extends LoginTenant>(tenants: readonly T[], email: string): Array<{ tenant: T; user: T["users"][number] }> {
  const normalizedEmail = email.trim().toLowerCase();
  return tenants.flatMap((tenant) => {
    if (tenant.status !== "active" || !tenant.accessReleased) return [];
    return tenant.users
      .filter((user) => user.status === "active" && user.email.trim().toLowerCase() === normalizedEmail)
      .map((user) => ({ tenant, user }));
  });
}
