import { z } from "zod";
import { router, megadeskProcedure } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../../db";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

function requireClientAdmin(userRole: string | undefined) {
  if (userRole !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Apenas administradores podem gerenciar a equipe da empresa.",
    });
  }
}

const defaultPermissionsByRole: Record<string, string[]> = {
  admin: ["home", "settings", "notifications", "active-attendance", "conversations", "tickets", "tracking", "erp", "clients", "bot-config", "ai-assistant"],
  manager: ["home", "settings", "notifications", "active-attendance", "conversations", "tickets", "tracking", "erp", "clients", "bot-config", "ai-assistant"],
  agent: ["home", "settings", "notifications", "active-attendance", "conversations", "tickets"],
  viewer: ["home", "settings", "notifications", "tickets"],
};

export const teamRouter = router({
  /**
   * Listar todos os usuários da empresa diretamente da tabela canônica megadesk_domain_client_users
   */
  listUsers: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
      const pool = getPool();
      const [rows] = (await pool.execute(
        "SELECT user_id AS userId, name, email, role, status, permissions_json AS permissionsJson, created_at AS createdAt, updated_at AS updatedAt FROM megadesk_domain_client_users WHERE client_id = ? ORDER BY created_at ASC, user_id ASC",
        [input.clientId]
      )) as any[];

      return (rows as any[]).map((u) => {
        let permissions: string[] = [];
        if (u.permissionsJson) {
          try {
            permissions = typeof u.permissionsJson === "string" ? JSON.parse(u.permissionsJson) : u.permissionsJson;
          } catch {
            permissions = [];
          }
        }
        return {
          userId: String(u.userId),
          name: String(u.name),
          email: String(u.email),
          role: u.role as "admin" | "manager" | "agent" | "viewer",
          status: u.status as "active" | "blocked",
          permissions,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        };
      });
    }),

  /**
   * Adicionar usuário à equipe da empresa
   */
  addUser: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string().optional(),
        name: z.string().min(2, "O nome deve ter no mínimo 2 caracteres").max(180),
        email: z.string().email("E-mail inválido"),
        password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres"),
        role: z.enum(["admin", "manager", "agent", "viewer"]).default("agent"),
        status: z.enum(["active", "blocked"]).default("active"),
        permissions: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
      const pool = getPool();
      const cleanEmail = input.email.trim().toLowerCase();

      // Verificar limite de usuários contratados pelo cliente
      const [clientRows] = (await pool.execute(
        "SELECT max_users FROM megadesk_domain_clients WHERE client_id = ?",
        [input.clientId]
      )) as any[];
      const maxUsers = Number((clientRows as any[])[0]?.max_users ?? 5);

      const [countRows] = (await pool.execute(
        "SELECT COUNT(*) as total FROM megadesk_domain_client_users WHERE client_id = ? AND status = 'active'",
        [input.clientId]
      )) as any[];
      const currentActiveCount = Number((countRows as any[])[0]?.total ?? 0);

      if (input.status === "active" && currentActiveCount >= maxUsers) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Limite de usuários ativos atingido (${maxUsers}). Aumente o limite no plano contratado.`,
        });
      }

      // Validação de unicidade do e-mail
      const [existingRows] = (await pool.execute(
        "SELECT user_id FROM megadesk_domain_client_users WHERE email = ? AND client_id = ?",
        [cleanEmail, input.clientId]
      )) as any[];
      if ((existingRows as any[]).length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Este e-mail já está cadastrado nesta empresa.",
        });
      }

      const userId = `user-${randomUUID()}`;
      const passwordHash = await bcrypt.hash(input.password, 10);
      const permissions = input.permissions ?? defaultPermissionsByRole[input.role] ?? [];

      await pool.execute(
        `INSERT INTO megadesk_domain_client_users
          (user_id, client_id, name, email, role, status, permissions_json, password_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, input.clientId, input.name.trim(), cleanEmail, input.role, input.status, JSON.stringify(permissions), passwordHash]
      );

      return { success: true, userId };
    }),

  /**
   * Atualizar usuário da equipe (nome, email, cargo, status, senha opcional, permissões)
   */
  updateUser: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string().optional(),
        userId: z.string().min(1),
        name: z.string().min(2, "O nome deve ter no mínimo 2 caracteres").max(180).optional(),
        email: z.string().email("E-mail inválido").optional(),
        role: z.enum(["admin", "manager", "agent", "viewer"]).optional(),
        status: z.enum(["active", "blocked"]).optional(),
        password: z.string().min(6, "A nova senha deve ter no mínimo 6 caracteres").optional().or(z.literal("")),
        permissions: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
      const pool = getPool();

      // Verificar existência do usuário na empresa
      const [existing] = (await pool.execute(
        "SELECT user_id, email, role, status FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?",
        [input.userId, input.clientId]
      )) as any[];
      if ((existing as any[]).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      // Validação de unicidade do e-mail ao atualizar
      if (input.email) {
        const cleanEmail = input.email.trim().toLowerCase();
        const [dupRows] = (await pool.execute(
          "SELECT user_id FROM megadesk_domain_client_users WHERE email = ? AND client_id = ? AND user_id <> ?",
          [cleanEmail, input.clientId, input.userId]
        )) as any[];
        if ((dupRows as any[]).length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Este e-mail já está sendo utilizado por outro usuário nesta empresa.",
          });
        }
      }

      // Impedir desativação do único admin ativo
      if (input.status === "blocked" && existing[0].role === "admin") {
        const [adminRows] = (await pool.execute(
          "SELECT COUNT(*) AS total FROM megadesk_domain_client_users WHERE client_id = ? AND role = 'admin' AND status = 'active' AND user_id <> ?",
          [input.clientId, input.userId]
        )) as any[];
        const remainingAdmins = Number((adminRows as any[])[0]?.total ?? 0);
        if (remainingAdmins === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A empresa precisa manter pelo menos um administrador ativo.",
          });
        }
      }

      const updates: string[] = [];
      const values: any[] = [];

      if (input.name !== undefined) {
        updates.push("name = ?");
        values.push(input.name.trim());
      }
      if (input.email !== undefined) {
        updates.push("email = ?");
        values.push(input.email.trim().toLowerCase());
      }
      if (input.role !== undefined) {
        updates.push("role = ?");
        values.push(input.role);
      }
      if (input.status !== undefined) {
        updates.push("status = ?");
        values.push(input.status);
      }
      if (input.permissions !== undefined) {
        updates.push("permissions_json = ?");
        values.push(JSON.stringify(input.permissions));
      }
      if (input.password && input.password.trim().length >= 6) {
        const passwordHash = await bcrypt.hash(input.password.trim(), 10);
        updates.push("password_hash = ?");
        values.push(passwordHash);
      }

      if (updates.length > 0) {
        values.push(input.userId, input.clientId);
        await pool.execute(
          `UPDATE megadesk_domain_client_users SET ${updates.join(", ")} WHERE user_id = ? AND client_id = ?`,
          values
        );
      }

      return { success: true };
    }),

  /**
   * Excluir usuário da equipe da empresa
   */
  deleteUser: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string().optional(),
        userId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
      const pool = getPool();

      const [rows] = (await pool.execute(
        "SELECT user_id, role, name, email FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?",
        [input.userId, input.clientId]
      )) as any[];
      if ((rows as any[]).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      // Proteger o único admin da empresa contra exclusão
      if (rows[0].role === "admin") {
        const [adminRows] = (await pool.execute(
          "SELECT COUNT(*) AS total FROM megadesk_domain_client_users WHERE client_id = ? AND role = 'admin' AND user_id <> ?",
          [input.clientId, input.userId]
        )) as any[];
        const remainingAdmins = Number((adminRows as any[])[0]?.total ?? 0);
        if (remainingAdmins === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Não é possível excluir o único administrador da empresa.",
          });
        }
      }

      await pool.execute(
        "DELETE FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?",
        [input.userId, input.clientId]
      );

      return { success: true, removedUserId: input.userId };
    }),

  /**
   * Redefinir senha de um usuário da equipe
   */
  resetPassword: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string().optional(),
        userId: z.string().min(1),
        newPassword: z.string().min(6, "A nova senha deve ter no mínimo 6 caracteres"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
      const pool = getPool();

      const [rows] = (await pool.execute(
        "SELECT user_id FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?",
        [input.userId, input.clientId]
      )) as any[];
      if ((rows as any[]).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      const passwordHash = await bcrypt.hash(input.newPassword.trim(), 10);
      await pool.execute(
        "UPDATE megadesk_domain_client_users SET password_hash = ? WHERE user_id = ? AND client_id = ?",
        [passwordHash, input.userId, input.clientId]
      );

      return { success: true };
    }),
});

