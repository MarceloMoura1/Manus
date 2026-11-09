import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("../../db", () => ({
  getPool: () => ({
    execute: mocks.execute,
  }),
}));

import { teamRouter } from "./team.router";

function createTeamCaller(role: "admin" | "manager" | "agent" | "viewer") {
  return teamRouter.createCaller({
    tenantId: "client-test-123",
    userEmail: `${role}@example.com`,
    operationalUserId: `user-${role}`,
    operationalUserRole: role,
    operationalPermissions: [],
    user: null,
    req: { headers: {} },
    res: {},
  } as never);
}

describe("Team Router (server/modules/team/team.router.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("RBAC Authorization", () => {
    it.each(["manager", "agent", "viewer"] as const)(
      "denies access for %s role",
      async (role) => {
        const caller = createTeamCaller(role);
        await expect(caller.listUsers({ clientId: "client-test-123" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          caller.addUser({
            clientId: "client-test-123",
            name: "Novo Usuário",
            email: "novo@example.com",
            password: "password123",
          })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(mocks.execute).not.toHaveBeenCalled();
      }
    );
  });

  describe("listUsers", () => {
    it("fetches team users directly from canonical table megadesk_domain_client_users", async () => {
      const mockUsers = [
        {
          userId: "user-1",
          name: "Admin Master",
          email: "admin@empresa.com",
          role: "admin",
          status: "active",
          permissionsJson: JSON.stringify(["home", "settings"]),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mocks.execute.mockResolvedValueOnce([mockUsers, []]);

      const caller = createTeamCaller("admin");
      const result = await caller.listUsers({ clientId: "client-test-123" });

      expect(mocks.execute).toHaveBeenCalledTimes(1);
      const [sql, params] = mocks.execute.mock.calls[0];
      expect(sql).toContain("FROM megadesk_domain_client_users WHERE client_id = ?");
      expect(params).toEqual(["client-test-123"]);

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe("user-1");
      expect(result[0].name).toBe("Admin Master");
      expect(result[0].permissions).toEqual(["home", "settings"]);
    });
  });

  describe("addUser", () => {
    it("validates user limits and prevents duplicate email", async () => {
      // 1. client max_users = 2
      mocks.execute.mockResolvedValueOnce([[{ max_users: 2 }], []]);
      // 2. count active = 1
      mocks.execute.mockResolvedValueOnce([[{ total: 1 }], []]);
      // 3. check existing email -> duplicate!
      mocks.execute.mockResolvedValueOnce([[{ user_id: "existing-user" }], []]);

      const caller = createTeamCaller("admin");
      await expect(
        caller.addUser({
          clientId: "client-test-123",
          name: "Duplicado",
          email: "dup@example.com",
          password: "password123",
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("inserts new user with hashed password and active status", async () => {
      // 1. client max_users = 5
      mocks.execute.mockResolvedValueOnce([[{ max_users: 5 }], []]);
      // 2. count active = 1
      mocks.execute.mockResolvedValueOnce([[{ total: 1 }], []]);
      // 3. check existing email -> not found
      mocks.execute.mockResolvedValueOnce([[], []]);
      // 4. insert
      mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const caller = createTeamCaller("admin");
      const res = await caller.addUser({
        clientId: "client-test-123",
        name: "Novo Colaborador",
        email: "novo@example.com",
        password: "secretpassword",
        role: "agent",
      });

      expect(res.success).toBe(true);
      expect(res.userId).toMatch(/^user-/);

      const [insertSql, insertParams] = mocks.execute.mock.calls[3];
      expect(insertSql).toContain("INSERT INTO megadesk_domain_client_users");
      expect(insertParams[1]).toBe("client-test-123");
      expect(insertParams[2]).toBe("Novo Colaborador");
      expect(insertParams[3]).toBe("novo@example.com");
      expect(insertParams[5]).toBe("active");
    });
  });

  describe("updateUser", () => {
    it("validates email conflict when updating email", async () => {
      // 1. find user
      mocks.execute.mockResolvedValueOnce([[{ user_id: "user-target", email: "old@example.com", role: "agent", status: "active" }], []]);
      // 2. check duplicate
      mocks.execute.mockResolvedValueOnce([[{ user_id: "other-user" }], []]);

      const caller = createTeamCaller("admin");
      await expect(
        caller.updateUser({
          clientId: "client-test-123",
          userId: "user-target",
          email: "taken@example.com",
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("prevents blocking the only active admin", async () => {
      // 1. find user (is admin)
      mocks.execute.mockResolvedValueOnce([[{ user_id: "admin-1", email: "admin@example.com", role: "admin", status: "active" }], []]);
      // 2. check remaining admins -> 0 remaining
      mocks.execute.mockResolvedValueOnce([[{ total: 0 }], []]);

      const caller = createTeamCaller("admin");
      await expect(
        caller.updateUser({
          clientId: "client-test-123",
          userId: "admin-1",
          status: "blocked",
        })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("successfully updates fields and hashes new password if provided", async () => {
      // 1. find user
      mocks.execute.mockResolvedValueOnce([[{ user_id: "user-1", email: "user1@example.com", role: "agent", status: "active" }], []]);
      // 2. check duplicate email -> empty
      mocks.execute.mockResolvedValueOnce([[], []]);
      // 3. update query
      mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const caller = createTeamCaller("admin");
      const res = await caller.updateUser({
        clientId: "client-test-123",
        userId: "user-1",
        name: "Novo Nome",
        email: "novoemail@example.com",
        password: "novasenha123",
      });

      expect(res.success).toBe(true);
      const [updateSql, updateParams] = mocks.execute.mock.calls[2];
      expect(updateSql).toContain("UPDATE megadesk_domain_client_users SET");
      expect(updateSql).toContain("name = ?");
      expect(updateSql).toContain("email = ?");
      expect(updateSql).toContain("password_hash = ?");
      expect(updateParams).toContain("Novo Nome");
      expect(updateParams).toContain("novoemail@example.com");
    });
  });

  describe("deleteUser", () => {
    it("prevents deleting the only active admin", async () => {
      // 1. find user
      mocks.execute.mockResolvedValueOnce([[{ user_id: "admin-1", role: "admin", name: "Master", email: "admin@example.com" }], []]);
      // 2. count remaining admins
      mocks.execute.mockResolvedValueOnce([[{ total: 0 }], []]);

      const caller = createTeamCaller("admin");
      await expect(
        caller.deleteUser({
          clientId: "client-test-123",
          userId: "admin-1",
        })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("deletes user from canonical table when allowed", async () => {
      // 1. find user
      mocks.execute.mockResolvedValueOnce([[{ user_id: "agent-1", role: "agent", name: "Atendente", email: "agent@example.com" }], []]);
      // 2. delete
      mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const caller = createTeamCaller("admin");
      const res = await caller.deleteUser({
        clientId: "client-test-123",
        userId: "agent-1",
      });

      expect(res.success).toBe(true);
      expect(res.removedUserId).toBe("agent-1");
      const [deleteSql, deleteParams] = mocks.execute.mock.calls[1];
      expect(deleteSql).toContain("DELETE FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?");
      expect(deleteParams).toEqual(["agent-1", "client-test-123"]);
    });
  });
});
