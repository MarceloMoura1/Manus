export type MegaAdminUserResponse = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "agent" | "viewer";
  status: "active" | "blocked";
  permissions?: string[];
};

type MegaAdminUserWithPrivateFields = MegaAdminUserResponse & {
  passwordHash?: unknown;
};

/**
 * Produces the only user shape permitted in a MegaAdmin response.
 * Password hashes remain available to server-side persistence only.
 */
export function sanitizeMegaAdminUser(user: MegaAdminUserWithPrivateFields): MegaAdminUserResponse {
  const response: MegaAdminUserResponse = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
  };
  if (user.permissions !== undefined) response.permissions = [...user.permissions];
  return response;
}
