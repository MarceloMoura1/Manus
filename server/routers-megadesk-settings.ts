/**
 * tRPC router para configurações do MegaDesk (acesso restrito a admin do cliente)
 * Abas: Geral, Chamados (status), Equipe, Backup
 */
import { z } from "zod";
import { router, megadeskProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "./db";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { syncClientDataToDb, syncTeamUsersToDb, validateSyncIntegrity, getSyncedClientData } from "./sync-megadesk";
import { getAiTokenUsageSummary } from "./modules/ai-usage/ai-usage.service";

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
  /**
   * Resumo consolidado do cockpit operacional para a tela inicial (Centro de Comando)
   */
  getOperationalCockpit: megadeskProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantId || "main";
    let pool: any = null;
    try {
      pool = getPool();
    } catch {
      // Sem banco de dados disponível (ex: testes)
    }

    const result = {
      atendimento: {
        totalAbertas: 0,
        emTriagemBot: 0,
        emAtendimentoHumano: 0,
        filaEspera: 0,
        cargaPorAtendente: [] as Array<{ operador: string; conversas: number }>,
      },
      chamados: {
        totalAtivos: 0,
        criticosUrgentes: 0,
        novosAbertos: 0,
        emAndamento: 0,
        aguardandoCliente: 0,
      },
      rastreamentos: {
        ativos: 0,
      },
      crm: {
        leadsAtivos: 0,
        oportunidadesAbertas: 0,
        valorPipelineEstimado: 0,
      },
      atividadesRecentes: [] as Array<{
        id: string;
        tipo: "chamado" | "conversa" | "crm" | "assistente";
        titulo: string;
        descricao: string;
        timestamp: number;
      }>,
      iaTokens: null as {
        total_limit: number;
        total_used: number;
        remaining_tokens: number;
        percent_used: number;
        cycle_renewal_date: string;
        days_remaining: number;
      } | null,
    };

    if (!pool) {
      return result;
    }

    // 1. Atendimento (Conversas WhatsApp)
    try {
      const [convSummary] = (await pool.execute(
        `SELECT
           COUNT(*) AS totalAbertas,
           SUM(CASE WHEN status = 'bot' THEN 1 ELSE 0 END) AS emTriagemBot,
           SUM(CASE WHEN status <> 'bot' AND (assigned_user_id IS NOT NULL OR assigned_user_name IS NOT NULL) THEN 1 ELSE 0 END) AS emAtendimentoHumano,
           SUM(CASE WHEN status <> 'bot' AND assigned_user_id IS NULL AND assigned_user_name IS NULL THEN 1 ELSE 0 END) AS filaEspera
         FROM megadesk_domain_conversations
        WHERE client_id = ? AND status <> 'closed'`,
        [tenantId]
      )) as any[];

      const [operatorLoad] = (await pool.execute(
        `SELECT
           COALESCE(assigned_user_name, assigned_user_id, 'Sem atendente') AS operador,
           COUNT(*) AS conversasAtivas
         FROM megadesk_domain_conversations
        WHERE client_id = ? AND status <> 'closed' AND (assigned_user_id IS NOT NULL OR assigned_user_name IS NOT NULL)
        GROUP BY operador
        ORDER BY conversasAtivas DESC
        LIMIT 5`,
        [tenantId]
      )) as any[];

      result.atendimento = {
        totalAbertas: Number(convSummary?.[0]?.totalAbertas || 0),
        emTriagemBot: Number(convSummary?.[0]?.emTriagemBot || 0),
        emAtendimentoHumano: Number(convSummary?.[0]?.emAtendimentoHumano || 0),
        filaEspera: Number(convSummary?.[0]?.filaEspera || 0),
        cargaPorAtendente: (operatorLoad || []).map((op: any) => ({
          operador: String(op.operador),
          conversas: Number(op.conversasAtivas || 0),
        })),
      };
    } catch {
      // Ignora falha individual de consulta
    }

    // 2. Chamados (Tickets)
    try {
      const [ticketsSummary] = (await pool.execute(
        `SELECT
           COUNT(*) AS totalAtivos,
           SUM(CASE WHEN LOWER(priority) IN ('critica', 'crítica', 'urgent', 'urgente', 'alta', 'high') THEN 1 ELSE 0 END) AS criticos,
           SUM(CASE WHEN LOWER(status) IN ('open', 'aberto') THEN 1 ELSE 0 END) AS novosAbertos,
           SUM(CASE WHEN LOWER(status) IN ('in_progress', 'em_andamento', 'andamento') THEN 1 ELSE 0 END) AS emAndamento,
           SUM(CASE WHEN LOWER(status) IN ('waiting', 'aguardando') THEN 1 ELSE 0 END) AS aguardando
         FROM megadesk_domain_chamados
        WHERE clientId = ? AND LOWER(status) NOT IN ('closed', 'fechado', 'resolvido', 'concluido', 'concluído')`,
        [tenantId]
      )) as any[];

      result.chamados = {
        totalAtivos: Number(ticketsSummary?.[0]?.totalAtivos || 0),
        criticosUrgentes: Number(ticketsSummary?.[0]?.criticos || 0),
        novosAbertos: Number(ticketsSummary?.[0]?.novosAbertos || 0),
        emAndamento: Number(ticketsSummary?.[0]?.emAndamento || 0),
        aguardandoCliente: Number(ticketsSummary?.[0]?.aguardando || 0),
      };
    } catch {
      // Ignora falha individual de consulta
    }

    // 3. Rastreamentos Operacionais
    try {
      const [trackingRows] = (await pool.execute(
        `SELECT COUNT(*) AS total
         FROM megadesk_domain_operational_records
        WHERE client_id = ?
          AND record_type = 'tracking'
          AND (status IS NULL OR LOWER(status) NOT IN ('delivered', 'entregue', 'closed', 'fechado', 'finalizado', 'concluido', 'concluído'))`,
        [tenantId]
      )) as any[];
      result.rastreamentos = {
        ativos: Number(trackingRows?.[0]?.total || 0),
      };
    } catch {
      // Ignora falha individual de consulta
    }

    // 4. CRM & Vendas (Leads & Oportunidades/Orçamentos)
    try {
      const [leadsRows] = (await pool.execute(
        `SELECT COUNT(*) AS totalLeads
         FROM megadesk_crm_clients
        WHERE client_id = ? AND status = 'lead' AND (lifecycle_state IS NULL OR lifecycle_state <> 'archived')`,
        [tenantId]
      )) as any[];

      const [oppsRows] = (await pool.execute(
        `SELECT COUNT(*) AS totalOportunidades, COALESCE(SUM(estimated_value), 0) AS valorTotal
         FROM megadesk_crm_opportunities
        WHERE client_id = ? AND status = 'open'`,
        [tenantId]
      )) as any[];

      result.crm = {
        leadsAtivos: Number(leadsRows?.[0]?.totalLeads || 0),
        oportunidadesAbertas: Number(oppsRows?.[0]?.totalOportunidades || 0),
        valorPipelineEstimado: Number(oppsRows?.[0]?.valorTotal || 0),
      };
    } catch {
      // Ignora falha individual de consulta
    }

    // 5. Linha do Tempo de Atividades Recentes do Tenant
    try {
      const rawEvents: Array<{
        id: string;
        tipo: "chamado" | "conversa" | "crm" | "assistente";
        titulo: string;
        descricao: string;
        timestamp: number;
      }> = [];

      // Atividades recentes de chamados
      try {
        const [chamadosRecentes] = (await pool.execute(
          `SELECT chamadoId, chamadoNumber, title, status, priority, updatedAt, createdAt
           FROM megadesk_domain_chamados
          WHERE clientId = ?
          ORDER BY updatedAt DESC
          LIMIT 4`,
          [tenantId]
        )) as any[];
        for (const c of (chamadosRecentes || [])) {
          const d = new Date(c.updatedAt || c.createdAt || Date.now());
          const statusLabel = c.status === "open" ? "Aberto" : c.status === "in_progress" ? "Em andamento" : c.status === "waiting" ? "Aguardando" : c.status === "closed" ? "Fechado" : String(c.status);
          rawEvents.push({
            id: `ticket-${c.chamadoId}`,
            tipo: "chamado",
            titulo: `Chamado #${c.chamadoNumber}: ${c.title || "Sem título"}`,
            descricao: `Status: ${statusLabel} • Prioridade: ${c.priority || "média"}`,
            timestamp: isNaN(d.getTime()) ? Date.now() : d.getTime(),
          });
        }
      } catch {}

      // Atividades recentes de conversas
      try {
        const [convsRecentes] = (await pool.execute(
          `SELECT conversation_id, customer_name, phone, status, last_message, updated_at, created_at
           FROM megadesk_domain_conversations
          WHERE client_id = ?
          ORDER BY updated_at DESC
          LIMIT 4`,
          [tenantId]
        )) as any[];
        for (const conv of (convsRecentes || [])) {
          const d = new Date(conv.updated_at || conv.created_at || Date.now());
          rawEvents.push({
            id: `conv-${conv.conversation_id}`,
            tipo: "conversa",
            titulo: `Conversa com ${conv.customer_name || conv.phone || "Cliente"}`,
            descricao: conv.last_message ? String(conv.last_message).slice(0, 70) : `Status: ${conv.status}`,
            timestamp: isNaN(d.getTime()) ? Date.now() : d.getTime(),
          });
        }
      } catch {}

      // Atividades recentes de CRM
      try {
        const [crmRecentes] = (await pool.execute(
          `SELECT id, public_id, title, status, value_cents, updated_at, created_at
           FROM megadesk_crm_opportunities
          WHERE client_id = ?
          ORDER BY updated_at DESC
          LIMIT 4`,
          [tenantId]
        )) as any[];
        for (const opp of (crmRecentes || [])) {
          const d = new Date(opp.updated_at || opp.created_at || Date.now());
          const valorFormatado = opp.value_cents ? (opp.value_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null;
          rawEvents.push({
            id: `crm-${opp.id || opp.public_id}`,
            tipo: "crm",
            titulo: `Oportunidade: ${opp.title || "Sem título"}`,
            descricao: valorFormatado ? `${opp.status} • ${valorFormatado}` : `Status: ${opp.status}`,
            timestamp: isNaN(d.getTime()) ? Date.now() : d.getTime(),
          });
        }
      } catch {}

      // Atividades recentes de IA
      try {
        const [iaRecentes] = (await pool.execute(
          `SELECT id, feature_source, total_tokens, created_at
           FROM megadesk_ai_token_usage
          WHERE tenant_id = ?
          ORDER BY created_at DESC
          LIMIT 4`,
          [tenantId]
        )) as any[];
        for (const ia of (iaRecentes || [])) {
          const d = new Date(ia.created_at || Date.now());
          const sourceLabel = ia.feature_source === "whatsapp_bot" ? "Triagem WhatsApp" : ia.feature_source === "assistant_chat" ? "Assistente IA" : ia.feature_source === "voice_shortcut" ? "Voz" : "Automação";
          rawEvents.push({
            id: `ia-${ia.id}`,
            tipo: "assistente",
            titulo: `Execução de IA • ${sourceLabel}`,
            descricao: `${ia.total_tokens || 0} tokens processados`,
            timestamp: isNaN(d.getTime()) ? Date.now() : d.getTime(),
          });
        }
      } catch {}

      rawEvents.sort((a, b) => b.timestamp - a.timestamp);
      result.atividadesRecentes = rawEvents.slice(0, 6);
    } catch {
      // Ignora falha na consolidação de atividades
    }

    // 5. Cota e Consumo de Tokens de IA (para perfil admin)
    try {
      const isAdmin = ctx.user?.role === "admin" || (ctx as any).operationalUserRole === "admin";
      if (isAdmin) {
        const usage = await getAiTokenUsageSummary(tenantId, pool);
        result.iaTokens = usage.summary;
      }
    } catch {
      // Ignora falha individual de consulta
    }

    return result;
  }),
  // ════════════════════════════════════════════════════════════════════════════
  // ABA GERAL — Dados da empresa
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Buscar configurações da empresa do cliente
   */
  getCompanySettings: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
      
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
  saveCompanySettings: megadeskProcedure
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
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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
  listTicketStatuses: megadeskProcedure
    .input(z.object({ clientId: z.string().min(1), userRole: z.string() }))
    .query(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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
  createTicketStatus: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        name: z.string().min(1).max(120),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#3b82f6"),
        order: z.number().int().optional().default(0),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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
  updateTicketStatus: megadeskProcedure
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
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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
  deleteTicketStatus: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        statusId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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
   * Consulta direta à tabela canônica megadesk_domain_client_users para sincronização instantânea
   */
  listTeamUsers: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
      const pool = getPool();
      const [rows] = (await pool.execute(
        "SELECT user_id AS userId, name, email, role, status, permissions_json AS permissionsJson FROM megadesk_domain_client_users WHERE client_id = ? ORDER BY created_at ASC, user_id ASC",
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
        };
      });
    }),

  /**
   * Adicionar usuário à equipe
   */
  addTeamUser: megadeskProcedure
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
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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

      const { syncMegaDeskUserToMemory } = await import("./routers");
      await syncMegaDeskUserToMemory(
        input.clientId,
        {
          id: userId,
          name: input.name,
          email: input.email.toLowerCase(),
          role: input.role,
          status: "active",
          permissions,
          passwordHash,
        },
        "upsert"
      );

      return { success: true, userId };
    }),

  /**
   * Remover usuário da equipe
   */
  removeTeamUser: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        targetUserId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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

      const { syncMegaDeskUserToMemory } = await import("./routers");
      await syncMegaDeskUserToMemory(
        input.clientId,
        {
          id: input.targetUserId,
          status: "blocked",
        },
        "upsert"
      );

      return { success: true };
    }),

  /**
   * Atualizar permissões de um usuário
   */
  updateTeamUserPermissions: megadeskProcedure
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
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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

      const { syncMegaDeskUserToMemory } = await import("./routers");
      await syncMegaDeskUserToMemory(
        input.clientId,
        {
          id: input.targetUserId,
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
        },
        "upsert"
      );

      return { success: true };
    }),

  /**
   * Redefinir senha de um usuário
   */
  resetTeamUserPassword: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        targetUserId: z.string().min(1),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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

      const { syncMegaDeskUserToMemory } = await import("./routers");
      await syncMegaDeskUserToMemory(
        input.clientId,
        {
          id: input.targetUserId,
          passwordHash,
        },
        "upsert"
      );

      return { success: true };
    }),

  /**
   * Atualizar dados completos do usuário da equipe (nome, e-mail com validação, cargo, status, senha e permissões)
   */
  updateTeamUser: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        targetUserId: z.string().min(1),
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
        "SELECT user_id, name, email, role, status FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?",
        [input.targetUserId, input.clientId]
      )) as any[];
      if ((existing as any[]).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      // Validação de unicidade do e-mail
      if (input.email) {
        const cleanEmail = input.email.trim().toLowerCase();
        const [dupRows] = (await pool.execute(
          "SELECT user_id FROM megadesk_domain_client_users WHERE email = ? AND client_id = ? AND user_id <> ?",
          [cleanEmail, input.clientId, input.targetUserId]
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
          [input.clientId, input.targetUserId]
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
        values.push(input.targetUserId, input.clientId);
        await pool.execute(
          `UPDATE megadesk_domain_client_users SET ${updates.join(", ")} WHERE user_id = ? AND client_id = ?`,
          values
        );
      }

      if (input.name !== undefined && input.name.trim()) {
        try {
          await pool.execute(
            "UPDATE erp_sale_orders SET seller_name_snapshot = ? WHERE client_id = ? AND (seller_user_id = ? OR seller_name_snapshot = ?)",
            [input.name.trim(), input.clientId, input.targetUserId, existing[0].name || input.name.trim()]
          );
        } catch (err) {
          console.warn("[updateTeamUser] Falha ao sincronizar seller_name_snapshot em erp_sale_orders:", err);
        }
      }

      const { syncMegaDeskUserToMemory } = await import("./routers");
      let passwordHash: string | undefined = undefined;
      if (input.password && input.password.trim().length >= 6) {
        passwordHash = await bcrypt.hash(input.password.trim(), 10);
      }
      await syncMegaDeskUserToMemory(
        input.clientId,
        {
          id: input.targetUserId,
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.email !== undefined ? { email: input.email.trim().toLowerCase() } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
          ...(passwordHash !== undefined ? { passwordHash } : {}),
        },
        "upsert"
      );

      return { success: true };
    }),

  /**
   * Excluir definitivamente o usuário da equipe
   */
  deleteTeamUser: megadeskProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        userRole: z.string(),
        targetUserId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
      const pool = getPool();

      const [rows] = (await pool.execute(
        "SELECT user_id, role, name, email FROM megadesk_domain_client_users WHERE user_id = ? AND client_id = ?",
        [input.targetUserId, input.clientId]
      )) as any[];
      if ((rows as any[]).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      }

      if (rows[0].role === "admin") {
        const [adminRows] = (await pool.execute(
          "SELECT COUNT(*) AS total FROM megadesk_domain_client_users WHERE client_id = ? AND role = 'admin' AND user_id <> ?",
          [input.clientId, input.targetUserId]
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
        [input.targetUserId, input.clientId]
      );

      const { syncMegaDeskUserToMemory } = await import("./routers");
      await syncMegaDeskUserToMemory(input.clientId, { id: input.targetUserId }, "delete");

      return { success: true, removedUserId: input.targetUserId };
    }),

  /**
   * Obter informações do cliente (para exibir limite de usuários)
   */
  getClientInfo: megadeskProcedure
    .input(z.object({ clientId: z.string().min(1), userRole: z.string() }))
    .query(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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
  exportClientData: megadeskProcedure
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
    .mutation(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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
  getDataStats: megadeskProcedure
    .input(z.object({ clientId: z.string().min(1), userRole: z.string() }))
    .query(async ({ input, ctx }) => {
      requireClientAdmin(ctx.operationalUserRole);
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
