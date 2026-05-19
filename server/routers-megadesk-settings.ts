/**
 * tRPC router para configurações do MegaDesk (acesso restrito a admin do cliente)
 * Abas: Geral, Chamados (status), Equipe, Backup
 */
import { z } from "zod";
import { router, publicProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "./db";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { syncClientDataToDb, syncTeamUsersToDb, validateSyncIntegrity, getSyncedClientData } from "./sync-megadesk";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Verifica se o usuário é admin do cliente (role === 'admin' no MegaDesk)
 * O role vem da sessão megadesk_session_v1 e é passado como parâmetro
 */
function requireClientAdmin(userRole: string | undefined) {
  if (userRole !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Apenas administradores podem acessar as configurações avançadas.",
    });
  }
}

// ─── Permissões disponíveis ────────────────────────────────────────────────────
export const AVAILABLE_PERMISSIONS = [
  { key: "active-attendance", label: "Atendimento Ativo" },
  { key: "conversations", label: "Conversas" },
  { key: "tickets", label: "Chamados" },
  { key: "tracking", label: "Rastreamento" },
  { key: "erp", label: "ERP" },
  { key: "clients", label: "Clientes" },
  { key: "bot-config", label: "Configurar Bot" },
  { key: "ai-assistant", label: "Assistente IA" },
] as const;

export const megadeskSettingsRouter = router({
  // ════════════════════════════════════════════════════════════════════════════
  // ABA GERAL — Dados da empresa
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Buscar configurações da empresa do cliente
   */
  getCompanySettings: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
      })
    )
    .query(async ({ input }) => {
      requireClientAdmin(input.userRole);
      
      // Buscar dados sincronizados do cliente (sempre puxar dados mais recentes)
      const syncedData = await getSyncedClientData(input.clientId);
      if (syncedData && syncedData.companySettings) {
        const cs = syncedData.companySettings;
        return {
          settingId: cs.settingId,
          clientId: cs.clientId,
          companyName: cs.companyName || '',
          logoUrl: cs.logoUrl || '',
          email: cs.email || '',
          phone: cs.phone || '',
          whatsapp: cs.whatsapp || '',
          address: cs.address || '',
          businessHours: cs.businessHours || '',
        };
      }
      
      const pool = getPool();
      const [rows] = await pool.execute(
        "SELECT * FROM megadesk_company_settings WHERE client_id = ?",
        [input.clientId]
      ) as any;

      if (!rows || (rows as any[]).length === 0) return null;
      const row = (rows as any[])[0];
      return {
        settingId: row.id ?? row.setting_id,
        clientId: row.client_id,
        companyName: row.company_name ?? "",
        logoUrl: row.logo_url ?? "",
        email: row.email ?? row.primary_email ?? "",
        phone: row.phone ?? row.primary_phone ?? "",
        whatsapp: row.whatsapp ?? row.primary_whatsapp ?? "",
        address: row.address ?? "",
        businessHours: row.business_hours ?? "",
      };
    }),

  /**
   * Salvar configurações da empresa
   */
  saveCompanySettings: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        companyName: z.string().optional(),
        logoUrl: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        whatsapp: z.string().optional(),
        address: z.string().optional(),
        businessHours: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();

      // Verificar se já existe
      const [existing] = await pool.execute(
        "SELECT id FROM megadesk_company_settings WHERE client_id = ?",
        [input.clientId]
      ) as any;

      if ((existing as any[]).length > 0) {
        await pool.execute(
          `UPDATE megadesk_company_settings SET
            company_name = ?,
            logo_url = ?,
            email = ?,
            phone = ?,
            whatsapp = ?,
            address = ?,
            business_hours = ?,
            updated_at = NOW()
          WHERE client_id = ?`,
          [
            input.companyName ?? "",
            input.logoUrl ?? null,
            input.email ?? "",
            input.phone ?? "",
            input.whatsapp ?? "",
            input.address ?? "",
            input.businessHours ?? null,
            input.clientId,
          ]
        );
      } else {
        const settingId = randomUUID();
        await pool.execute(
          `INSERT INTO megadesk_company_settings
            (id, client_id, company_name, logo_url, email, phone, whatsapp, address, business_hours)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            settingId,
            input.clientId,
            input.companyName ?? "",
            input.logoUrl ?? null,
            input.email ?? "",
            input.phone ?? "",
            input.whatsapp ?? "",
            input.address ?? "",
            input.businessHours ?? null,
          ]
        );
      }

      return { success: true };
    }),

  // ════════════════════════════════════════════════════════════════════════════
  // ABA CHAMADOS — Status personalizados
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Listar status personalizados do cliente
   */
  listTicketStatuses: publicProcedure
    .input(z.object({ clientId: z.string().min(1), userRole: z.string() }))
    .query(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();
      const [rows] = await pool.execute(
        "SELECT * FROM megadesk_ticket_statuses WHERE client_id = ? ORDER BY `order` ASC",
        [input.clientId]
      ) as any;
      return (rows as any[]).map((r) => ({
        statusId: r.status_id,
        clientId: r.client_id,
        name: r.name,
        color: r.color,
        order: r.order,
        isDefault: Boolean(r.is_default),
      }));
    }),

  /**
   * Criar status personalizado
   */
  createTicketStatus: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        name: z.string().min(1).max(120),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#3b82f6"),
        order: z.number().int().optional().default(0),
      })
    )
    .mutation(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();
      const statusId = randomUUID();
      await pool.execute(
        "INSERT INTO megadesk_ticket_statuses (status_id, client_id, name, color, `order`, is_default) VALUES (?, ?, ?, ?, ?, false)",
        [statusId, input.clientId, input.name, input.color, input.order]
      );
      return { success: true, statusId };
    }),

  /**
   * Atualizar status personalizado
   */
  updateTicketStatus: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        statusId: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        order: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();
      const updates: string[] = [];
      const values: any[] = [];
      if (input.name !== undefined) { updates.push("name = ?"); values.push(input.name); }
      if (input.color !== undefined) { updates.push("color = ?"); values.push(input.color); }
      if (input.order !== undefined) { updates.push("`order` = ?"); values.push(input.order); }
      if (updates.length === 0) return { success: true };
      values.push(input.statusId, input.clientId);
      await pool.execute(
        `UPDATE megadesk_ticket_statuses SET ${updates.join(", ")} WHERE status_id = ? AND client_id = ?`,
        values
      );
      return { success: true };
    }),

  /**
   * Deletar status personalizado
   */
  deleteTicketStatus: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        statusId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();
      await pool.execute(
        "DELETE FROM megadesk_ticket_statuses WHERE status_id = ? AND client_id = ?",
        [input.statusId, input.clientId]
      );
      return { success: true };
    }),

  // ════════════════════════════════════════════════════════════════════════════
  // ABA EQUIPE — Gerenciamento de usuários internos
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Listar usuários do cliente (com permissões detalhadas)
   */
  listTeamUsers: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
      })
    )
    .query(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const { getSyncedClientData, validateSyncIntegrity } = await import('./sync-megadesk');
      const integrity = await validateSyncIntegrity(input.clientId);
      if (!integrity.isSynced) {
        console.warn(`[SYNC WARNING] Integridade comprometida para ${input.clientId}:`, integrity.issues);
      }
      const syncedData = await getSyncedClientData(input.clientId);
      return syncedData.users;
    }),

  /**
   * Adicionar usuário à equipe
   */
  addTeamUser: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        name: z.string().min(2).max(180),
        email: z.string().email(),
        password: z.string().min(6),
        role: z.enum(["admin", "manager", "agent", "viewer"]).default("agent"),
        permissions: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();

      // Verificar limite de usuários do cliente
      const [clientRows] = await pool.execute(
        "SELECT max_users FROM megadesk_domain_clients WHERE client_id = ?",
        [input.clientId]
      ) as any;
      const maxUsers = (clientRows as any[])[0]?.max_users ?? 5;

      const [countRows] = await pool.execute(
        "SELECT COUNT(*) as total FROM megadesk_domain_client_users WHERE client_id = ? AND status = 'active'",
        [input.clientId]
      ) as any;
      const currentCount = Number((countRows as any[])[0]?.total ?? 0);

      if (currentCount >= maxUsers) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Limite de usuários atingido (${maxUsers}). Contate o administrador do MegaAdmin para aumentar o limite.`,
        });
      }

      // Verificar se e-mail já existe
      const [existingRows] = await pool.execute(
        "SELECT user_id FROM megadesk_domain_client_users WHERE email = ? AND client_id = ?",
        [input.email.toLowerCase(), input.clientId]
      ) as any;
      if ((existingRows as any[]).length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Este e-mail já está cadastrado neste cliente.",
        });
      }

      const userId = `user-${randomUUID()}`;
      const passwordHash = await bcrypt.hash(input.password, 10);

      // Permissões padrão por role
      const defaultPermissions: Record<string, string[]> = {
        admin: ["home", "settings", "notifications", "active-attendance", "conversations", "tickets", "tracking", "erp", "clients", "bot-config", "ai-assistant"],
        manager: ["home", "settings", "notifications", "active-attendance", "conversations", "tickets", "tracking", "erp", "clients", "bot-config", "ai-assistant"],
        agent: ["home", "settings", "notifications", "active-attendance", "conversations", "tickets"],
        viewer: ["home", "settings", "notifications", "tickets"],
      };
      const permissions = input.permissions ?? defaultPermissions[input.role];

      await pool.execute(
        `INSERT INTO megadesk_domain_client_users
          (user_id, client_id, name, email, role, status, permissions_json, password_hash)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        [userId, input.clientId, input.name, input.email.toLowerCase(), input.role, JSON.stringify(permissions), passwordHash]
      );

      return { success: true, userId };
    }),

  /**
   * Remover usuário da equipe
   */
  removeTeamUser: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        targetUserId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();

      // Verificar que o usuário pertence ao cliente
      const [rows] = await pool.execute(
        "SELECT user_id, role FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?",
        [input.targetUserId, input.clientId]
      ) as any;
      if ((rows as any[]).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      // Bloquear em vez de deletar (preservar histórico)
      await pool.execute(
        "UPDATE megadesk_domain_client_users SET status = 'blocked' WHERE user_id = ? AND client_id = ?",
        [input.targetUserId, input.clientId]
      );

      return { success: true };
    }),

  /**
   * Atualizar permissões de um usuário
   */
  updateTeamUserPermissions: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        targetUserId: z.string().min(1),
        role: z.enum(["admin", "manager", "agent", "viewer"]).optional(),
        permissions: z.array(z.string()).optional(),
        status: z.enum(["active", "blocked"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();

      // Verificar que o usuário pertence ao cliente
      const [rows] = await pool.execute(
        "SELECT user_id FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?",
        [input.targetUserId, input.clientId]
      ) as any;
      if ((rows as any[]).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      const updates: string[] = [];
      const values: any[] = [];
      if (input.role !== undefined) { updates.push("role = ?"); values.push(input.role); }
      if (input.permissions !== undefined) { updates.push("permissions_json = ?"); values.push(JSON.stringify(input.permissions)); }
      if (input.status !== undefined) { updates.push("status = ?"); values.push(input.status); }
      if (updates.length === 0) return { success: true };

      values.push(input.targetUserId, input.clientId);
      await pool.execute(
        `UPDATE megadesk_domain_client_users SET ${updates.join(", ")} WHERE user_id = ? AND client_id = ?`,
        values
      );

      return { success: true };
    }),

  /**
   * Redefinir senha de um usuário
   */
  resetTeamUserPassword: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        targetUserId: z.string().min(1),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();

      // Verificar que o usuário pertence ao cliente
      const [rows] = await pool.execute(
        "SELECT user_id FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?",
        [input.targetUserId, input.clientId]
      ) as any;
      if ((rows as any[]).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      const passwordHash = await bcrypt.hash(input.newPassword, 10);
      await pool.execute(
        "UPDATE megadesk_domain_client_users SET password_hash = ? WHERE user_id = ? AND client_id = ?",
        [passwordHash, input.targetUserId, input.clientId]
      );

      return { success: true };
    }),

  /**
   * Obter informações do cliente (para exibir limite de usuários)
   */
  getClientInfo: publicProcedure
    .input(z.object({ clientId: z.string().min(1), userRole: z.string() }))
    .query(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();
      const [rows] = await pool.execute(
        "SELECT company, max_users, plan FROM megadesk_domain_clients WHERE client_id = ?",
        [input.clientId]
      ) as any;
      if ((rows as any[]).length === 0) return null;
      const r = (rows as any[])[0];
      return { company: r.company, maxUsers: r.max_users, plan: r.plan };
    }),

  // ════════════════════════════════════════════════════════════════════════════
  // ABA BACKUP — Exportação e restauração de dados
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Exportar dados do cliente (JSON)
   */
  exportClientData: publicProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        includeConversations: z.boolean().default(true),
        includeChamados: z.boolean().default(true),
        includeCustomers: z.boolean().default(true),
        includeBotScripts: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();
      const exportData: Record<string, any> = {
        exportedAt: new Date().toISOString(),
        clientId: input.clientId,
        version: "1.0",
      };

      if (input.includeCustomers) {
        const [rows] = await pool.execute(
          "SELECT * FROM megadesk_domain_customers WHERE client_id = ?",
          [input.clientId]
        ) as any;
        exportData.customers = rows;
      }

      if (input.includeChamados) {
        const [rows] = await pool.execute(
          "SELECT * FROM megadesk_domain_chamados WHERE client_id = ?",
          [input.clientId]
        ) as any;
        exportData.chamados = rows;
      }

      if (input.includeConversations) {
        const [rows] = await pool.execute(
          "SELECT conversation_id, client_id, customer_name, phone, company, status, last_message, time_label, created_at FROM megadesk_domain_conversations WHERE client_id = ?",
          [input.clientId]
        ) as any;
        exportData.conversations = rows;
      }

      if (input.includeBotScripts) {
        const [rows] = await pool.execute(
          "SELECT * FROM megadesk_domain_bot_scripts WHERE client_id = ?",
          [input.clientId]
        ) as any;
        exportData.botScripts = rows;
      }

      return { success: true, data: exportData };
    }),

  /**
   * Obter estatísticas de dados para a aba de backup
   */
  getDataStats: publicProcedure
    .input(z.object({ clientId: z.string().min(1), userRole: z.string() }))
    .query(async ({ input }) => {
      requireClientAdmin(input.userRole);
      const pool = getPool();

      const queries = [
        pool.execute("SELECT COUNT(*) as total FROM megadesk_domain_customers WHERE client_id = ?", [input.clientId]),
        pool.execute("SELECT COUNT(*) as total FROM megadesk_domain_chamados WHERE client_id = ?", [input.clientId]),
        pool.execute("SELECT COUNT(*) as total FROM megadesk_domain_conversations WHERE client_id = ?", [input.clientId]),
        pool.execute("SELECT COUNT(*) as total FROM megadesk_domain_bot_scripts WHERE client_id = ?", [input.clientId]),
        pool.execute("SELECT COUNT(*) as total FROM megadesk_crm_clients WHERE client_id = ?", [input.clientId]),
      ];

      const results = await Promise.all(queries);
      const [custRows, chamRows, convRows, botRows, crmRows] = results.map((r) => (r as any)[0]);

      return {
        customers: Number((custRows as any[])[0]?.total ?? 0),
        chamados: Number((chamRows as any[])[0]?.total ?? 0),
        conversations: Number((convRows as any[])[0]?.total ?? 0),
        botScripts: Number((botRows as any[])[0]?.total ?? 0),
        crmClients: Number((crmRows as any[])[0]?.total ?? 0),
      };
    }),
});
