import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminProcedure } from "./_core/trpc";
import { COOKIE_NAME, normalizeModuleNamesToBackend, normalizeModuleNamesToAdmin } from "@shared/const";
import { loadMegaDeskStructuredState, saveMegaDeskStructuredState, recordMegaDeskMetric, readMegaDeskTenantObservability, type MegaDeskStructuredState, getDb, getPool, createMegaDeskBackup, listMegaDeskBackups, getMegaDeskBackupInfo, applyMegaDeskBackup, deleteClientFromDb } from "./db";
import bcrypt from "bcryptjs";
import { adminCredentials, megadeskDomainClientUsers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { MEGAADMIN_COOKIE } from "./_core/context";
import { getSessionCookieOptions } from "./_core/cookies";
import { createNewTenant, releaseTenantAccess, pauseTenantAccess, getTenantInfo, deleteTenant, listAllTenants } from "./_core/tenant-operations";
import { chamadosRouter } from "./routers-chamados";
import { crmRouter } from "./routers-crm";
import { whatsappRouter as whatsappModuleRouter } from "./modules/whatsapp/whatsapp.router";
import { whatsappRouter } from "./routers-whatsapp";
import { companyRouter } from "./routers-company";
import { ticketStatusesRouter } from "./routers-ticket-statuses";
import { botScriptsRouter } from "./routers-bot-scripts";
import { notificationsRouter } from "./routers-notifications";
import { megadeskSettingsRouter } from "./routers-megadesk-settings";

type TicketStatus = "open" | "in_progress" | "waiting" | "closed";
type ConversationStatus = "open" | "bot" | "closed";
type ClientStatus = "active" | "setup" | "paused";
type OperationalRecordType = "conversation" | "ticket" | "tracking" | "erp";

type ClientIntegrations = {
  geminiKey?: string;
  geminiQuotaMensal?: number; // 0 = ilimitado
  trackingToken?: string;
  trackingUser?: string;
  trackingPassword?: string;
  trackingContract?: string;
  n8nUrl?: string;
  n8nToken?: string;
  erpNotes?: string;
};
type MegaClient = {
  id: string;
  clientId: string;
  tenantDatabaseName: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  cnpj: string;
  plan: string;
  maxUsers: number;
  statusType: "active" | "test";
  status: ClientStatus;
  accessReleased: boolean;
  apiToken: string;
  modules: string[];
  integrations: ClientIntegrations;
  users: Array<{ id: string; name: string; email: string; role: "admin" | "manager" | "agent" | "viewer"; status: "active" | "blocked"; permissions?: string[]; passwordHash?: string }>;
};

type Conversation = {
  id: string;
  clientId: string;
  name: string;
  phone: string;
  company: string;
  status: ConversationStatus;
  lastMessage: string;
  time: string;
  messages: Array<{ from: "customer" | "agent" | "bot"; text: string; time: string }>;
  assignedUserId?: string | null;
  assignedUserName?: string;
  iaActive?: boolean;
  unreadCount?: number;
  lastMessageFrom?: "customer" | "agent" | "bot";
  createdAt?: string;
};

type TicketRecord = {
  id: string;
  clientId: string;
  company: string;
  customer: string;
  problem: string;
  category: string;
  status: TicketStatus;
  createdAt: string;
  description: string;
};

type OperationalRecord = {
  id: string;
  clientId: string;
  tenantDatabaseName: string;
  type: OperationalRecordType;
  ownerPhone: string;
  title: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

// Módulos configuráveis disponíveis para cada cliente
const defaultModules: string[] = [];

const clients: MegaClient[] = [];

const conversations: Conversation[] = [];

const tickets: TicketRecord[] = [];

const botScripts: Array<{ id: string; clientId: string; name: string; description: string; initialMessage: string; active: boolean }> = [];

const operationalRecords: OperationalRecord[] = [];
const auditLogs: Array<{ id: string; platform: "MegaAdmin" | "MegaDesk"; action: string; clientId?: string; success: boolean; createdAt: string }> = [];

const defaultSyncState: MegaDeskStructuredState = { clients, conversations, tickets, botScripts, operationalRecords, auditLogs };
let syncStateHydrated = false;

async function hydrateSyncState() {
  if (syncStateHydrated) return;
  const state = await loadMegaDeskStructuredState(defaultSyncState);
  clients.splice(0, clients.length, ...(state.clients as MegaClient[]));
  conversations.splice(0, conversations.length, ...(state.conversations as Conversation[]));
  tickets.splice(0, tickets.length, ...(state.tickets as TicketRecord[]));
  botScripts.splice(0, botScripts.length, ...(state.botScripts as typeof botScripts));
  operationalRecords.splice(0, operationalRecords.length, ...(state.operationalRecords as OperationalRecord[]));
  auditLogs.splice(0, auditLogs.length, ...(state.auditLogs as typeof auditLogs));
  syncStateHydrated = true;
}

async function persistSyncState() {
  await saveMegaDeskStructuredState({ clients, conversations, tickets, botScripts, operationalRecords, auditLogs });
}

function nowLabel() {
  return new Date().toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function audit(platform: "MegaAdmin" | "MegaDesk", action: string, clientId: string | undefined, success = true) {
  auditLogs.unshift({ id: `audit-${Date.now()}-${auditLogs.length}`, platform, action, clientId, success, createdAt: new Date().toISOString() });
  if (auditLogs.length > 30) auditLogs.pop();
}

function tokenHint(token: string) {
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function getClientOrThrow(clientId: string) {
  const client = clients.find((item) => item.clientId === clientId);
  if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado no MegaAdmin." });
  return client;
}

function getDefaultReleasedClient() {
  return clients.find((client) => client.accessReleased && client.status === "active") ?? clients[0];
}

function getReleasedClientOrThrow(clientId?: string, requiredModule?: string) {
  const client = clientId
    ? getClientOrThrow(clientId)
    : requiredModule
      ? (clients.find((item) => item.accessReleased && item.status === "active" && item.modules.includes(requiredModule)) ?? getDefaultReleasedClient())
      : getDefaultReleasedClient();
  if (!client.accessReleased || client.status !== "active") {
    audit("MegaDesk", "Acesso negado por cliente bloqueado no MegaAdmin", client.clientId, false);
    throw new TRPCError({ code: "FORBIDDEN", message: "Cliente sem acesso ativo liberado no MegaAdmin." });
  }
  if (requiredModule && !client.modules.includes(requiredModule)) {
    audit("MegaDesk", `Módulo não liberado pelo MegaAdmin: ${requiredModule}`, client.clientId, false);
    throw new TRPCError({ code: "FORBIDDEN", message: `Módulo ${requiredModule} não está liberado para este cliente no MegaAdmin.` });
  }
  return client;
}

// Módulos configuráveis da MegaDesk (controlados pelo MegaAdmin por usuário)
// home, settings, notifications são SEMPRE ativos — não aparecem como permissão configurável
const CONFIGURABLE_MODULES = [
  "active-attendance",
  "conversations",
  "tickets",
  "tracking",
  "erp",
  "bot-config",
  "ai-assistant",
] as const;

function rolePermissions(role: MegaClient["users"][number]["role"]) {
  // home, settings e notifications são sempre ativos para qualquer usuário
  const base = ["home", "settings", "notifications"];
  const all = [...base, ...CONFIGURABLE_MODULES];
  const map: Record<MegaClient["users"][number]["role"], string[]> = {
    admin: all,
    manager: all,
    agent: [...base, "active-attendance", "conversations", "tickets"],
    viewer: [...base, "tickets"],
  };
  return map[role];
}

// Resolve permissões finais do usuário, respeitando customizações e módulos do cliente
function resolveUserPermissions(user: MegaClient["users"][number], clientModules?: string[]) {
  const base = ["home", "settings", "notifications"];
  
  // CORREÇÃO: Se o usuário tem permissões customizadas, usar APENAS as customizadas
  // Não misturar com permissões da role
  let finalPerms: string[];
  
  if (user.permissions && user.permissions.length > 0) {
    // Permissões customizadas: normalizar para formato backend (hífen)
    const normalizedCustomPerms = normalizeModuleNamesToBackend(user.permissions);
    finalPerms = [...base, ...normalizedCustomPerms];
  } else {
    // Sem customizações: usar permissões da role
    finalPerms = rolePermissions(user.role);
  }
  
  // CORREÇÃO: Filtrar por módulos do cliente (respeitar o que foi liberado)
  if (clientModules && clientModules.length > 0) {
    // Normalizar módulos do cliente para formato backend (hífen)
    const normalizedModules = normalizeModuleNamesToBackend(clientModules);
    
    // Filtra permissões para apenas as que correspondem a módulos ativados
    const filteredPerms = finalPerms.filter(perm => {
      // Base permissions sempre incluídas
      if (base.includes(perm)) return true;
      // Permissões que correspondem a módulos ativados
      return normalizedModules.includes(perm);
    });
    
    return Array.from(new Set(filteredPerms));
  }
  
  return Array.from(new Set(finalPerms));
}

function assertClientUserPermission(client: MegaClient, permission: string, userEmail?: string) {
  const activeUsers = client.users.map((user) => ({ ...user, permissions: resolveUserPermissions(user, client.modules) })).filter((user) => user.status === "active");
  const user = userEmail ? activeUsers.find((item) => item.email === userEmail) : activeUsers.find((item) => item.permissions.includes(permission));
  if (!user) {
    audit("MegaDesk", `Permissão negada para ${permission}`, client.clientId, false);
    throw new TRPCError({ code: "FORBIDDEN", message: "Usuário sem permissão ativa para executar esta ação neste cliente." });
  }
  if (!user.permissions.includes(permission)) {
    audit("MegaDesk", `Usuário ${user.email} sem permissão ${permission}`, client.clientId, false);
    throw new TRPCError({ code: "FORBIDDEN", message: `Usuário ${user.email} não possui a permissão ${permission}.` });
  }
  return user;
}

function sanitizeClient(client: MegaClient) {
  return { ...client, apiToken: undefined, tokenHint: tokenHint(client.apiToken), users: client.users.map((user) => ({ ...user, permissions: resolveUserPermissions(user, client.modules) })) };
}

export const appRouter = router({
  chamados: chamadosRouter,
  crm: crmRouter,
  whatsapp: whatsappRouter,
  company: companyRouter,
  ticketStatuses: ticketStatusesRouter,
  megadeskSettings: megadeskSettingsRouter,
  botScripts: botScriptsRouter,
  notifications: notificationsRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ({ user: ctx.user })),
    logout: publicProcedure.mutation(({ ctx }) => {
      // Limpar o cookie de sessão para encerrar a sessão administrativa
      ctx.res.clearCookie(COOKIE_NAME, { path: "/" });
      return { ok: true };
    }),
  }),
  megaadmin: router({
    loginAdmin: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const rows = await getDb().select().from(adminCredentials).where(eq(adminCredentials.email, input.email.toLowerCase().trim())).limit(1);
        const cred = rows[0];
        if (!cred || !cred.active) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha incorretos." });
        }
        const valid = await bcrypt.compare(input.password, cred.passwordHash);
        if (!valid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha incorretos." });
        }
        // Gerar JWT próprio do MegaAdmin
        const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "fallback");
        const token = await new SignJWT({ sub: cred.email, name: cred.name, role: "admin", type: "megaadmin" })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("8h")
          .sign(secret);
        const cookieOpts = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(MEGAADMIN_COOKIE, token, { ...cookieOpts, maxAge: 8 * 60 * 60 * 1000 });
        // Also return the token so the frontend can store it in localStorage
        return { ok: true, name: cred.name, email: cred.email, token };
      }),
    logoutAdmin: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(MEGAADMIN_COOKIE, { path: "/" });
      // LIMPAR TODOS OS ARRAYS EM MEMÓRIA PARA FORÇAR RECARREGAMENTO DO BANCO
      clients.splice(0, clients.length);
      conversations.splice(0, conversations.length);
      tickets.splice(0, tickets.length);
      botScripts.splice(0, botScripts.length);
      operationalRecords.splice(0, operationalRecords.length);
      auditLogs.splice(0, auditLogs.length);
      syncStateHydrated = false; // Reset para recarregar dados na próxima requisição
      return { ok: true };
    }),
    // ─── Gestão de Administradores ──────────────────────────────────────────
    listAdmins: adminProcedure.query(async () => {
      const rows = await getDb().select({
        id: adminCredentials.id,
        email: adminCredentials.email,
        name: adminCredentials.name,
        active: adminCredentials.active,
        createdAt: adminCredentials.createdAt,
      }).from(adminCredentials).orderBy(adminCredentials.id);
      return { admins: rows };
    }),
    createAdmin: adminProcedure
      .input(z.object({
        email: z.string().email(),
        name: z.string().min(2),
        password: z.string().min(6),
      }))
      .mutation(async ({ input }) => {
        const existing = await getDb().select({ id: adminCredentials.id }).from(adminCredentials).where(eq(adminCredentials.email, input.email.toLowerCase().trim())).limit(1);
        if (existing.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Já existe um administrador com este e-mail." });
        }
        const passwordHash = await bcrypt.hash(input.password, 12);
        await getDb().insert(adminCredentials).values({
          email: input.email.toLowerCase().trim(),
          name: input.name.trim(),
          passwordHash,
          active: true,
        });
        return { ok: true };
      }),
    updateAdmin: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        name: z.string().min(2).optional(),
        password: z.string().min(6).optional(),
        active: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const rows = await getDb().select().from(adminCredentials).where(eq(adminCredentials.id, input.id)).limit(1);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Administrador não encontrado." });
        // Não permite desativar o próprio usuário logado
        if (input.active === false && rows[0].email === ctx.user.email) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode desativar sua própria conta." });
        }
        const updates: Partial<typeof adminCredentials.$inferInsert> = {};
        if (input.name) updates.name = input.name.trim();
        if (input.password) updates.passwordHash = await bcrypt.hash(input.password, 12);
        if (input.active !== undefined) updates.active = input.active;
        if (Object.keys(updates).length > 0) {
          await getDb().update(adminCredentials).set(updates).where(eq(adminCredentials.id, input.id));
        }
        return { ok: true };
      }),
    deleteAdmin: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const rows = await getDb().select().from(adminCredentials).where(eq(adminCredentials.id, input.id)).limit(1);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Administrador não encontrado." });
        // Não permite excluir o próprio usuário logado
        if (rows[0].email === ctx.user.email) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode excluir sua própria conta." });
        }
        // Garante que sempre haja pelo menos 1 admin ativo
        const allAdmins = await getDb().select({ id: adminCredentials.id }).from(adminCredentials).where(eq(adminCredentials.active, true));
        if (allAdmins.length <= 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Deve existir pelo menos um administrador ativo." });
        }
        await getDb().delete(adminCredentials).where(eq(adminCredentials.id, input.id));
        return { ok: true };
      }),
    summary: adminProcedure.query(async () => {
      await hydrateSyncState();
      // Calcula status IA de cada cliente de forma eficiente
      const { getClientIAStatus } = await import("./gemini-client");
      const iaStatusMap: Record<string, "ativa" | "inativa" | "quota_atingida"> = {};
      await Promise.all(clients.map(async (client) => {
        try {
          const s = await getClientIAStatus(client.clientId);
          iaStatusMap[client.clientId] = s.status;
        } catch {
          iaStatusMap[client.clientId] = "inativa";
        }
      }));
      return {
      platform: "MegaAdmin",
      description: "Painel interno para administrar clientes, liberar acesso, módulos e tokens consumidos pela MegaDesk.",
      clients: clients.map((client) => ({ ...sanitizeClient(client), iaStatus: iaStatusMap[client.clientId] ?? "inativa" })),
      totals: {
        clients: clients.length,
        released: clients.filter((client) => client.accessReleased).length,
        paused: clients.filter((client) => client.status === "paused").length,
        conversations: conversations.length,
        tickets: tickets.length,
      },
      auditLogs,
      operationalRecords: operationalRecords.slice(0, 10),
    };
    }),
    createClient: adminProcedure.input(z.object({
      company: z.string().min(2),
      contact: z.string().min(2),
      email: z.string().email(),
      phone: z.string().min(8),
      cnpj: z.string().default(""),
      plan: z.string().min(2),
      maxUsers: z.number().int().min(1).default(5),
      statusType: z.enum(["active", "test"]).default("test"),
    })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const idNumber = clients.length + 1;
      const clientId = `cliente-${String(idNumber).padStart(3, "0")}`;
      const token = `mdsk_live_${clientId}_${Math.random().toString(16).slice(2, 10)}`;
      // Gerar hash de senha padrão para o usuário inicial
      const defaultPasswordHash = await bcrypt.hash("123456", 12);
      const client: MegaClient = {
        id: `client-${String(idNumber).padStart(3, "0")}`,
        clientId,
        tenantDatabaseName: `tenant_${clientId.replaceAll("-", "_")}`,
        company: input.company,
        contact: input.contact,
        email: input.email,
        phone: input.phone,
        cnpj: input.cnpj,
        plan: input.plan,
        maxUsers: input.maxUsers,
        statusType: input.statusType,
        status: input.statusType === "active" ? "active" : "setup",
        accessReleased: input.statusType === "active",
        apiToken: token,
        modules: [],
        integrations: {},
        users: [{ id: `user-${Date.now()}`, name: input.contact, email: input.email, role: "admin", status: input.statusType === "active" ? "active" : "blocked", permissions: rolePermissions("admin"), passwordHash: defaultPasswordHash }],
      };
      clients.push(client);
      audit("MegaAdmin", "Cliente criado e aguardando liberação", client.clientId);
      await persistSyncState();
      
      // Sincronizar usuário inicial para a tabela megadeskDomainClientUsers
      const initialUser = client.users[0];
      const connection = await getPool().getConnection();
      try {
        await connection.execute(
          "INSERT INTO megadesk_domain_client_users (user_id, client_id, name, email, role, status, permissions_json, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [initialUser.id, client.clientId, initialUser.name, initialUser.email.toLowerCase().trim(), initialUser.role, initialUser.status, JSON.stringify(initialUser.permissions ?? []), initialUser.passwordHash]
        );
      } catch (err: any) {
        // Se o usuário já existe, apenas atualizar
        if (err.code !== "ER_DUP_ENTRY") throw err;
      } finally {
        connection.release();
      }
      
      await recordMegaDeskMetric(client.clientId, "client_created", 1, { platform: "MegaAdmin" });
      return { ok: true, client: sanitizeClient(client), integrationToken: token };
    }),
    updateClientInfo: adminProcedure.input(z.object({
      clientId: z.string(),
      company: z.string().min(2).optional(),
      contact: z.string().min(2).optional(),
      email: z.string().email().or(z.literal("")).optional(),
      phone: z.string().min(8).optional(),
      cnpj: z.string().optional(),
      plan: z.string().min(2).optional(),
      maxUsers: z.number().int().min(1).optional(),
      statusType: z.enum(["active", "test"]).optional(),
    })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      if (input.company) client.company = input.company;
      if (input.contact) client.contact = input.contact;
      if (input.email !== undefined) client.email = input.email;
      if (input.phone) client.phone = input.phone;
      if (input.cnpj !== undefined) client.cnpj = input.cnpj;
      if (input.plan) client.plan = input.plan;
      if (input.maxUsers !== undefined) client.maxUsers = input.maxUsers;
      if (input.statusType) client.statusType = input.statusType;
      audit("MegaAdmin", `Informações do cliente atualizadas: ${client.company}`, client.clientId);
      await persistSyncState();
      return { ok: true, client: sanitizeClient(client) };
    }),
    saveClientIntegrations: adminProcedure.input(z.object({
      clientId: z.string(),
      integrations: z.object({
        geminiKey: z.string().optional(),
        geminiQuotaMensal: z.number().int().min(0).optional(), // 0 = ilimitado
        trackingToken: z.string().optional(),
        trackingUser: z.string().optional(),
        trackingPassword: z.string().optional(),
        trackingContract: z.string().optional(),
        n8nUrl: z.string().optional(),
        n8nToken: z.string().optional(),
        erpNotes: z.string().optional(),
      }),
    })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      client.integrations = { ...client.integrations, ...input.integrations };
      audit("MegaAdmin", "Integrações de API atualizadas", client.clientId);
      await persistSyncState();
      return { ok: true };
    }),
    testIntegration: adminProcedure.input(z.object({
      clientId: z.string(),
      type: z.enum(["gemini", "tracking", "n8n"]),
      // Permite testar com o valor atual do formulário sem precisar salvar antes
      geminiKeyOverride: z.string().optional(),
    })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      const intg = client.integrations;
      let success = false;
      let message = "";
      if (input.type === "gemini") {
        // Prioridade: override do formulário > banco direto > memória em cache
        let geminiKey = input.geminiKeyOverride?.trim() || intg.geminiKey;
        // Se não há override e a memória está vazia, busca diretamente do banco
        if (!geminiKey) {
          const { getClientGeminiToken } = await import("./gemini-client");
          const dbKey = await getClientGeminiToken(input.clientId);
          if (dbKey) {
            geminiKey = dbKey;
            // Atualiza a memória em cache para evitar nova consulta
            client.integrations = { ...client.integrations, geminiKey: dbKey };
          }
        }
        if (!geminiKey) { message = "Chave da API Gemini não configurada."; }
        else if (geminiKey.length <= 10) { message = "Chave inválida ou muito curta."; }
        else {
          const { testGeminiConnection } = await import("./gemini-client");
          const testResult = await testGeminiConnection(geminiKey);
          success = testResult.ok;
          message = testResult.message;
          // Se o teste passou e o token era do formulário, salva automaticamente
          if (success && input.geminiKeyOverride?.trim()) {
            client.integrations = { ...client.integrations, geminiKey: input.geminiKeyOverride.trim() };
            await persistSyncState();
          }
        }
      } else if (input.type === "tracking") {
        if (!intg.trackingToken) { message = "Token de rastreio não configurado."; }
        else { success = intg.trackingToken.length > 5; message = success ? "Token de rastreio validado com sucesso." : "Token inválido."; }
      } else if (input.type === "n8n") {
        if (!intg.n8nUrl || !intg.n8nToken) { message = "URL ou token do n8n não configurados."; }
        else { success = intg.n8nUrl.startsWith("http") && intg.n8nToken.length > 5; message = success ? "Conexão com n8n validada com sucesso." : "URL ou token inválidos."; }
      }
      if (success) {
        audit("MegaAdmin", `Integração ${input.type} testada com sucesso`, client.clientId);
        await persistSyncState();
      }
      return { ok: success, message };
    }),
    resetUserPassword: adminProcedure.input(z.object({
      clientId: z.string(),
      userId: z.string(),
      newPassword: z.string().min(6),
    })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      const user = client.users.find((u) => u.id === input.userId);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      // Grava o hash da senha na tabela do banco
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      const existing = await getDb().select({ userId: megadeskDomainClientUsers.userId }).from(megadeskDomainClientUsers).where(eq(megadeskDomainClientUsers.userId, user.id)).limit(1);
      if (existing.length > 0) {
        await getDb().update(megadeskDomainClientUsers).set({ passwordHash }).where(eq(megadeskDomainClientUsers.userId, user.id));
      } else {
        // Usar conexão direta ao banco para evitar conflitos de campo
        const connection = await getPool().getConnection();
        try {
          await connection.execute(
            "INSERT INTO megadesk_domain_client_users (user_id, client_id, name, email, role, status, permissions_json, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [user.id, client.clientId, user.name, user.email.toLowerCase().trim(), user.role, user.status, JSON.stringify(user.permissions ?? []), passwordHash]
          );
        } finally {
          connection.release();
        }
      }
      audit("MegaAdmin", `Senha redefinida para usuário: ${user.email}`, client.clientId);
      await persistSyncState();
      return { ok: true, message: `Senha redefinida para ${user.name}.` };
    }),
    updateClientAccess: adminProcedure.input(z.object({ clientId: z.string(), status: z.enum(["active", "setup", "paused"]), accessReleased: z.boolean() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      client.status = input.status;
      client.accessReleased = input.accessReleased;
      client.users = client.users.map((user) => ({ ...user, status: input.accessReleased ? "active" : "blocked" }));
      audit("MegaAdmin", `Acesso ${input.accessReleased ? "liberado" : "bloqueado"}`, client.clientId);
      await persistSyncState();
      await recordMegaDeskMetric(client.clientId, input.accessReleased ? "access_released" : "access_blocked", 1, { platform: "MegaAdmin", status: input.status });
      return { ok: true, client: sanitizeClient(client) };
    }),
    addClientUser: adminProcedure.input(z.object({ clientId: z.string(), name: z.string().min(2), email: z.string().email(), role: z.enum(["admin", "manager", "agent", "viewer"]).default("agent") })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      if (client.users.length >= client.maxUsers) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Limite de usuários atingido (${client.maxUsers}). Aumente o limite nos dados do cliente.` });
      }
      // Gerar hash de senha padrão (123456) para sincronização com MegaDesk
      const defaultPasswordHash = await bcrypt.hash("123456", 12);
      const user = { id: `user-${Date.now()}`, name: input.name, email: input.email, role: input.role, status: client.accessReleased ? "active" as const : "blocked" as const, permissions: rolePermissions(input.role), passwordHash: defaultPasswordHash };
      client.users.push(user);
      audit("MegaAdmin", `Usuário criado: ${input.email}`, client.clientId);
      await persistSyncState();
      
      // Sincronizar usuário imediatamente para a tabela megadeskDomainClientUsers
      const connection = await getPool().getConnection();
      try {
        await connection.execute(
          "INSERT INTO megadesk_domain_client_users (user_id, client_id, name, email, role, status, permissions_json, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [user.id, client.clientId, user.name, user.email.toLowerCase().trim(), user.role, user.status, JSON.stringify(user.permissions ?? []), user.passwordHash]
        );
      } catch (err: any) {
        // Se o usuário já existe, apenas atualizar
        if (err.code !== "ER_DUP_ENTRY") throw err;
      } finally {
        connection.release();
      }
      
      return { ok: true, user };
    }),
    updateClientUser: adminProcedure.input(z.object({ clientId: z.string(), userId: z.string(), role: z.enum(["admin", "manager", "agent", "viewer"]).optional(), status: z.enum(["active", "blocked"]).optional() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      const user = client.users.find((item) => item.id === input.userId);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado para este cliente." });
      if (input.role) {
        user.role = input.role;
        user.permissions = rolePermissions(input.role);
      }
      if (input.status) user.status = input.status;
      audit("MegaAdmin", `Usuário atualizado: ${user.email}`, client.clientId);
      await persistSyncState();
      return { ok: true, user };
    }),
    updateUserInfo: adminProcedure.input(z.object({ clientId: z.string(), userId: z.string(), name: z.string().min(1), email: z.string().email() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      const user = client.users.find((item) => item.id === input.userId);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado para este cliente." });
      user.name = input.name;
      user.email = input.email;
      audit("MegaAdmin", `Informações do usuário atualizadas: ${input.email}`, client.clientId);
      await persistSyncState();
      return { ok: true, user };
    }),
    removeClientUser: adminProcedure.input(z.object({ clientId: z.string(), userId: z.string() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      const user = client.users.find((item) => item.id === input.userId);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado para este cliente." });
      if (client.users.length === 1) throw new TRPCError({ code: "BAD_REQUEST", message: "O cliente precisa manter pelo menos um usuário administrativo." });
      client.users = client.users.filter((item) => item.id !== input.userId);
      audit("MegaAdmin", `Usuário removido: ${user.email}`, client.clientId);
      await persistSyncState();
      return { ok: true, removedUserId: input.userId };
    }),
    toggleModule: adminProcedure.input(z.object({ clientId: z.string(), module: z.string(), enabled: z.boolean() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      client.modules = input.enabled ? Array.from(new Set([...client.modules, input.module])) : client.modules.filter((module) => module !== input.module);
      audit("MegaAdmin", `${input.enabled ? "Módulo habilitado" : "Módulo removido"}: ${input.module}`, client.clientId);
      await persistSyncState();
      await recordMegaDeskMetric(client.clientId, input.enabled ? "module_enabled" : "module_disabled", 1, { module: input.module });
      return { ok: true, modules: client.modules };
    }),
    rotateToken: adminProcedure.input(z.object({ clientId: z.string() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      client.apiToken = `mdsk_live_${client.clientId}_${Math.random().toString(16).slice(2, 14)}`;
      audit("MegaAdmin", "Token de integração rotacionado", client.clientId);
      await persistSyncState();
      return { ok: true, clientId: client.clientId, integrationToken: client.apiToken, tokenHint: tokenHint(client.apiToken) };
    }),
    tenantObservability: adminProcedure.input(z.object({ clientId: z.string().min(3) })).query(async ({ input }) => {
      // Sempre re-hidrata do banco para garantir dados frescos (integrações, token Gemini, etc.)
      syncStateHydrated = false;
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      const { getClientIAStatus } = await import("./gemini-client");
      const iaStatus = await getClientIAStatus(client.clientId);
      return { client: sanitizeClient(client), observability: await readMegaDeskTenantObservability(client.clientId), iaStatus };
    }),
    pushOperationalRecord: adminProcedure.input(z.object({ clientId: z.string(), type: z.enum(["conversation", "ticket", "tracking", "erp"]), ownerPhone: z.string().min(8), title: z.string().min(2), status: z.string().min(2), payload: z.record(z.string(), z.unknown()).default({}) })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      const record: OperationalRecord = { id: `op-${Date.now()}`, clientId: client.clientId, tenantDatabaseName: client.tenantDatabaseName, type: input.type, ownerPhone: input.ownerPhone, title: input.title, status: input.status, payload: input.payload, createdAt: new Date().toISOString() };
      operationalRecords.unshift(record);
      if (input.type === "conversation") {
        const newConv = { id: `conv-${Date.now()}`, clientId: client.clientId, name: client.contact, phone: input.ownerPhone, company: client.company, status: "open" as ConversationStatus, lastMessage: input.title, time: nowLabel(), messages: [{ from: "customer" as const, text: input.title, time: nowLabel() }], createdAt: new Date().toISOString(), lastMessageFrom: "customer" as const, unreadCount: 1 };
        conversations.unshift(newConv);
        try {
          const { getSocketIO } = await import("./modules/whatsapp/socket/whatsapp.socket");
          const io = getSocketIO();
          if (io) io.to(`client:${client.clientId}`).emit("conversation:new", { conversation: newConv });
        } catch {}
      }
      if (input.type === "ticket") {
        tickets.unshift({ id: `MD-${String(tickets.length + 1).padStart(4, "0")}`, clientId: client.clientId, company: client.company, customer: client.contact, problem: input.title, category: "🛠️ Suporte", status: "open", createdAt: nowLabel(), description: String(input.payload.description ?? input.title) });
      }
      audit("MegaAdmin", `Registro operacional sincronizado: ${input.type}`, client.clientId);
      await persistSyncState();
      return { ok: true, record };
    }),
    updateUserPermissions: adminProcedure.input(z.object({
      clientId: z.string(),
      userId: z.string(),
      permissions: z.array(z.string()),
    })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      const user = client.users.find((u) => u.id === input.userId);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado neste cliente." });
      }
      // CORREÇÃO: Normalizar permissões recebidas do MegaAdmin (underscore → hífen)
      const normalizedPermissions = normalizeModuleNamesToBackend(input.permissions);
      user.permissions = normalizedPermissions;
      audit("MegaAdmin", `Permissões atualizadas para usuário ${user.email}`, client.clientId);
      await persistSyncState();
      // Retornar permissões resolvidas (sem misturar com role)
      const resolvedPermissions = resolveUserPermissions(user, client.modules);
      return { ok: true, user: { ...user, permissions: resolvedPermissions } };
    }),
    deleteClient: adminProcedure
      .input(z.object({ clientId: z.string() }))
      .mutation(async ({ input }) => {
        await hydrateSyncState();
        const clientIndex = clients.findIndex((c) => c.clientId === input.clientId);
        if (clientIndex === -1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        }
        const client = clients[clientIndex];
        // Não permite excluir cliente com usuários ativos
        const activeUsers = client.users.filter((u) => u.status === "active");
        if (activeUsers.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Não é possível excluir cliente com ${activeUsers.length} usuário(s) ativo(s). Desative todos os usuários primeiro.`,
          });
        }
        // PASSO 1: Deletar diretamente do banco ANTES de remover da memória
        // Isso garante que mesmo se persistSyncState() falhar, o cliente não reaparecerá
        await deleteClientFromDb(input.clientId);
        // PASSO 2: Remover da memória
        clients.splice(clientIndex, 1);
        audit("MegaAdmin", `Cliente ${client.company} (${input.clientId}) excluído`, undefined);
        // PASSO 3: Sincronizar estado completo (conversas, tickets, etc.)
        await persistSyncState();
        return { ok: true, message: `Cliente ${client.company} foi excluído com sucesso.` };
      }),
    // Backup Management
    createBackup: adminProcedure.mutation(async () => {
      await hydrateSyncState();
      const state: MegaDeskStructuredState = { clients, conversations, tickets, botScripts, operationalRecords, auditLogs };
      const backupId = await createMegaDeskBackup(state);
      if (!backupId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao criar backup" });
      audit("MegaAdmin", "Backup manual criado", undefined);
      return { ok: true, backupId };
    }),
    listBackups: adminProcedure.query(async () => {
      const backups = await listMegaDeskBackups(50);
      return { backups };
    }),
    getBackupInfo: adminProcedure.input(z.object({ backupId: z.string() })).query(async ({ input }) => {
      const info = await getMegaDeskBackupInfo(input.backupId);
      if (!info) throw new TRPCError({ code: "NOT_FOUND", message: "Backup não encontrado" });
      return info;
    }),
    restoreBackup: adminProcedure.input(z.object({ backupId: z.string() })).mutation(async ({ input }) => {
      const success = await applyMegaDeskBackup(input.backupId);
      if (!success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao restaurar backup" });
      audit("MegaAdmin", `Backup ${input.backupId} restaurado`, undefined);
      return { ok: true, message: "Backup restaurado com sucesso" };
    }),
  }),
  megadesk: router({
    overview: publicProcedure.input(z.object({ clientId: z.string().optional(), userEmail: z.string().email() })).query(async ({ input }) => {
      await hydrateSyncState();
      const client = getReleasedClientOrThrow(input.clientId);
      // Busca o usuário ativo — sem exigir nenhuma permissão específica, apenas que esteja ativo
      const activeUsers = client.users
        .map((user) => ({ ...user, permissions: resolveUserPermissions(user, client.modules) }))
        .filter((user) => user.status === "active");
      const activeUser = activeUsers.find((u) => u.email.toLowerCase() === input.userEmail.toLowerCase());
      if (!activeUser) {
        audit("MegaDesk", `Acesso negado: usuário não encontrado ou inativo (${input.userEmail})`, client.clientId, false);
        throw new TRPCError({ code: "FORBIDDEN", message: "Usuário sem acesso ativo neste cliente." });
      }
      const visibleConversations = conversations.filter((conversation) => conversation.clientId === client.clientId);
      const visibleTickets = tickets.filter((ticket) => ticket.clientId === client.clientId);
      return {
        tenant: { nome: client.company, plano: client.plan, status: client.status, tokenFonte: "MegaAdmin", clientId: client.clientId, tenantDatabaseName: client.tenantDatabaseName, accessReleased: client.accessReleased },
        indicadores: { conversasAbertas: visibleConversations.filter((conversation) => conversation.status === "open").length, chamadosAbertos: visibleTickets.filter((ticket) => ticket.status !== "closed").length, tempoMedio: "4m 12s", resolucaoBot: "62%" },
        tickets: visibleTickets,
        conversas: visibleConversations,
        botScripts: botScripts.filter((script) => script.clientId === client.clientId),
        modulos: client.modules,
        activeUser: { email: activeUser.email, role: activeUser.role, permissions: activeUser.permissions },
      };
    }),
    validateToken: publicProcedure.input(z.object({ token: z.string().min(12), clientId: z.string().min(3), userEmail: z.string().email() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getClientOrThrow(input.clientId);
      if (client.apiToken !== input.token) {
        audit("MegaDesk", "Validação de token recusada", input.clientId, false);
        await persistSyncState();
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Token inválido para este cliente." });
      }
      if (!client.accessReleased || client.status !== "active") {
        audit("MegaDesk", "Cliente bloqueado na validação", input.clientId, false);
        await persistSyncState();
        throw new TRPCError({ code: "FORBIDDEN", message: "Cliente sem acesso liberado no MegaAdmin." });
      }
      // Verifica apenas que o usuário existe e está ativo — sem exigir permissão específica
      const activeUsers = client.users
        .map((u) => ({ ...u, permissions: resolveUserPermissions(u, client.modules) }))
        .filter((u) => u.status === "active");
      const user = activeUsers.find((u) => u.email.toLowerCase() === input.userEmail.toLowerCase());
      if (!user) {
        audit("MegaDesk", `Validação negada: usuário inativo (${input.userEmail})`, input.clientId, false);
        throw new TRPCError({ code: "FORBIDDEN", message: "Usuário sem acesso ativo neste cliente." });
      }
      audit("MegaDesk", "Token validado com sucesso", input.clientId);
      await persistSyncState();
      return { ok: true, clientId: input.clientId, tenantDatabaseName: client.tenantDatabaseName, modules: client.modules, user: { email: user.email, role: user.role, permissions: user.permissions }, tokenHint: tokenHint(input.token), message: "Token validado no backend sincronizado MegaAdmin → MegaDesk para este cliente." };
    }),
    sendMessage: publicProcedure.input(z.object({ conversationId: z.string(), message: z.string().min(1), userEmail: z.string().email() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const conversation = conversations.find((item) => item.id === input.conversationId);
      if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada." });
      const client = getReleasedClientOrThrow(conversation.clientId, "Atendimento WhatsApp");
      assertClientUserPermission(client, "send_messages", input.userEmail);
      const time = nowLabel();
      conversation.messages.push({ from: "agent", text: input.message, time });
      conversation.lastMessage = input.message;
      conversation.time = time;
      audit("MegaDesk", "Mensagem enviada e sincronizada", conversation.clientId);
      await persistSyncState();
      await recordMegaDeskMetric(conversation.clientId, "message_sent", 1, { conversationId: input.conversationId });
      return { ok: true, conversationId: input.conversationId, message: input.message, sentAt: new Date().toISOString() };
    }),
    updateTicketStatus: publicProcedure.input(z.object({ ticketId: z.string(), status: z.enum(["open", "in_progress", "waiting", "closed"]), userEmail: z.string().email() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const ticket = tickets.find((item) => item.id === input.ticketId);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Chamado não encontrado." });
      const client = getReleasedClientOrThrow(ticket.clientId, "Chamados");
      assertClientUserPermission(client, "manage_tickets", input.userEmail);
      ticket.status = input.status;
      audit("MegaDesk", `Status do chamado atualizado para ${input.status}`, ticket.clientId);
      await persistSyncState();
      await recordMegaDeskMetric(ticket.clientId, "ticket_status_updated", 1, { ticketId: input.ticketId, status: input.status });
      return { ok: true, ticketId: input.ticketId, status: input.status, updatedAt: new Date().toISOString() };
    }),
    saveBotScript: publicProcedure.input(z.object({ clientId: z.string().optional(), name: z.string().min(2), initialMessage: z.string().min(3), userEmail: z.string().email() })).mutation(async ({ input }) => {
      await hydrateSyncState();
      const client = getReleasedClientOrThrow(input.clientId, "Bot de triagem");
      assertClientUserPermission(client, "manage_bot", input.userEmail);
      const script = { id: `script-${Date.now()}`, clientId: client.clientId, name: input.name, description: "Roteiro criado pela interface MegaDesk", initialMessage: input.initialMessage, active: false };
      botScripts.push(script);
      audit("MegaDesk", "Roteiro de bot criado", client.clientId);
      await persistSyncState();
      return { ok: true, script };
    }),
    tenantObservability: publicProcedure.input(z.object({ clientId: z.string().optional(), userEmail: z.string().email() })).query(async ({ input }) => {
      await hydrateSyncState();
      const client = getReleasedClientOrThrow(input.clientId);
      // Verifica apenas que o usuário existe e está ativo
      const activeUsers = client.users
        .map((u) => ({ ...u, permissions: resolveUserPermissions(u, client.modules) }))
        .filter((u) => u.status === "active");
      const user = activeUsers.find((u) => u.email.toLowerCase() === input.userEmail.toLowerCase());
      if (!user) throw new TRPCError({ code: "FORBIDDEN", message: "Usuário sem acesso ativo neste cliente." });
      return { clientId: client.clientId, tenantDatabaseName: client.tenantDatabaseName, user: { email: user.email, role: user.role }, observability: await readMegaDeskTenantObservability(client.clientId) };
    }),
    /**
     * Autentica um usuário da MegaDesk pelo e-mail.
     * Valida que:
     *   1. O e-mail existe em algum cliente cadastrado no MegaAdmin.
     *   2. O usuário está com status "active".
     *   3. O cliente do usuário tem accessReleased=true e status="active".
     * Retorna dados da sessão que são armazenados no localStorage do browser.
     */
    searchCustomerByCompany: publicProcedure
      .input(z.object({ company: z.string().min(1), clientId: z.string().min(1) }))
      .query(async ({ input }) => {
        try {
          const { getPool } = await import("./db");
          const pool = getPool();
          
          // Buscar clientes por nome da empresa, filtrado por clientId (isolamento multiempresa)
          const [rows] = await pool.execute(
            `SELECT crm_client_id as id, company_name as company, responsible_name as name, phone, whatsapp, email
             FROM megadesk_crm_clients
             WHERE client_id = ? AND company_name LIKE ?
             ORDER BY company_name ASC
             LIMIT 10`,
            [input.clientId, `%${input.company}%`]
          ) as any[];
          
          if (rows && (rows as any[]).length > 0) {
            return (rows as any[]).map((crm: any) => ({
              id: crm.id,
              company: crm.company,
              name: crm.name,
              phone: crm.phone,
              whatsapp: crm.whatsapp,
              email: crm.email,
            }));
          }
          
          return [];
        } catch (error) {
          console.error("Erro ao buscar cliente por empresa:", error);
          return [];
        }
      }),
    searchCustomer: publicProcedure
      .input(z.object({ phone: z.string().min(1), clientId: z.string().min(1) }))
      .mutation(async ({ input }) => {
        try {
          const { searchCustomerByPhone } = await import("./db");
          const { getPool } = await import("./db");

          // 1º: Buscar na tabela de contatos de conversas (megadesk_domain_customers)
          const customer = await searchCustomerByPhone(input.phone, input.clientId);
          if (customer) {
            return {
              found: true,
              source: "contacts" as const,
              id: customer.customerId,
              name: customer.name,
              company: customer.company,
              phone: customer.phone,
            };
          }

          // 2º: Buscar na tabela de Clientes CRM (megadesk_crm_clients)
          // Normaliza o telefone removendo caracteres não numéricos para comparação
          const phoneDigits = input.phone.replace(/\D/g, "");
          const pool = getPool();
          const [crmRows] = await pool.execute(
            `SELECT crm_client_id, company_name, responsible_name, phone, whatsapp, email, contacts_json
             FROM megadesk_crm_clients
             WHERE client_id = ?
               AND (
                 REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '()', '') LIKE ?
                 OR REPLACE(REPLACE(REPLACE(whatsapp, '-', ''), ' ', ''), '()', '') LIKE ?
                 OR contacts_json LIKE ?
               )
             LIMIT 1`,
            [input.clientId, `%${phoneDigits}%`, `%${phoneDigits}%`, `%${phoneDigits}%`]
          ) as any[];

          if (crmRows && (crmRows as any[]).length > 0) {
            const crm = (crmRows as any[])[0];
            return {
              found: true,
              source: "crm" as const,
              id: crm.crm_client_id,
              name: crm.responsible_name || crm.company_name,
              company: crm.company_name,
              phone: crm.phone || input.phone,
              whatsapp: crm.whatsapp || "",
              email: crm.email || "",
              crmClientId: crm.crm_client_id,
            };
          }

          return { found: false };
        } catch (error) {
          console.error("Erro ao buscar cliente:", error);
          return { found: false };
        }
      }),
    createCustomer: publicProcedure
      .input(z.object({ phone: z.string().min(1), name: z.string().min(1), company: z.string().min(1), clientId: z.string().min(1) }))
      .mutation(async ({ input }) => {
        try {
          const { createCustomer: createCustomerDb } = await import("./db");
          await hydrateSyncState();
          const client = getReleasedClientOrThrow(input.clientId);
          if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum cliente configurado" });
          
          const customerId = `cust-${Date.now()}`;
          await createCustomerDb({
            customerId,
            clientId: client.clientId,
            name: input.name,
            phone: input.phone,
            company: input.company,
          });
          
          const conversationId = `conv-${Date.now()}`;
          const newConversation: Conversation = {
            id: conversationId,
            clientId: client.clientId,
            name: input.name,
            phone: input.phone,
            company: input.company,
            status: "open",
            lastMessage: "Conversa iniciada",
            time: new Date().toLocaleTimeString('pt-BR'),
            messages: [{ from: "customer", text: "Olá, gostaria de atendimento", time: new Date().toLocaleTimeString('pt-BR') }],
          };
          conversations.push(newConversation);
          audit("MegaDesk", `Cliente criado: ${input.name}`, client.clientId);
          await persistSyncState();
          return { id: customerId, name: input.name, company: input.company, phone: input.phone };
        } catch (error) {
          console.error("Erro ao criar cliente:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro ao criar cliente" });
        }
      }),
    createTicket: publicProcedure
      .input(z.object({ customerId: z.string(), phone: z.string(), title: z.string().min(1), observation: z.string().optional(), company: z.string(), customer: z.string(), clientId: z.string().min(1) }))
      .mutation(async ({ input }) => {
        try {
          const { createChamado } = await import("./db-chamados");
          await hydrateSyncState();
          const client = getReleasedClientOrThrow(input.clientId);
          if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum cliente configurado" });
          
          // Usar createChamado do db-chamados.ts que persiste corretamente no banco
          const chamado = await createChamado(
            client.clientId,
            input.customerId || `cust-${Date.now()}`,
            input.customer,
            input.company,
            input.title,
            input.observation || "",
            "media"
          );
          
          audit("MegaDesk", `Chamado criado via Atendimento Ativo: ${input.title}`, client.clientId);
          return { ok: true, ticketId: chamado.id, title: input.title, chamadoNumber: chamado.number };
        } catch (error) {
          console.error("Erro ao criar chamado:", error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error("Detalhes do erro:", errorMessage);
          console.error("Stack:", error instanceof Error ? error.stack : "N/A");
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Erro ao criar chamado: ${errorMessage}` });
        }
      }),
    createConversation: publicProcedure
      .input(z.object({ customerId: z.string(), customerName: z.string(), phone: z.string(), company: z.string(), clientId: z.string().min(1), fromCrm: z.boolean().optional(), crmClientId: z.string().optional() }))
      .mutation(async ({ input }) => {
        try {
          const { createConversation: createConversationDb, createCustomer: createCustomerDb, searchCustomerByPhone } = await import("./db");
          await hydrateSyncState();
          const client = getReleasedClientOrThrow(input.clientId);
          if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum cliente configurado" });

          // Se veio do CRM, garantir que o contato existe em megadesk_domain_customers
          // Busca por telefone OU por customerId para evitar duplicata
          if (input.fromCrm) {
            const existing = await searchCustomerByPhone(input.phone, client.clientId);
            if (!existing) {
              const customerId = input.customerId || `cust-${Date.now()}`;
              try {
                await createCustomerDb({
                  customerId,
                  clientId: client.clientId,
                  name: input.customerName,
                  phone: input.phone,
                  company: input.company,
                });
              } catch (insertErr: any) {
                // Ignorar erro de chave duplicada — o cliente já existe com outro telefone ou id
                if (insertErr?.cause?.code !== 'ER_DUP_ENTRY' && insertErr?.code !== 'ER_DUP_ENTRY') {
                  throw insertErr;
                }
                // Cliente já existe, continuar normalmente
              }
            }
          }
          
          const conversationId = `conv-${Date.now()}`;
          await createConversationDb({
            conversationId,
            clientId: client.clientId,
            crmClientId: input.crmClientId ?? undefined,
            customerName: input.customerName,
            phone: input.phone,
            company: input.company,
            lastMessage: "Conversa iniciada",
            messages: [],
          });
          
          const newConversation: any = {
            id: conversationId,
            clientId: client.clientId,
            name: input.customerName,
            phone: input.phone,
            company: input.company,
            status: "open" as const,
            lastMessage: "Conversa iniciada",
            time: new Date().toLocaleString('pt-BR'),
            messages: [],
          };
          conversations.push(newConversation);
          audit("MegaDesk", `Conversa iniciada com ${input.customerName}`, client.clientId);
          // Não chamar persistSyncState() aqui — a conversa já foi salva diretamente no banco
          // via createConversationDb acima. persistSyncState faz DELETE+INSERT em massa e é muito lento.
          return { ok: true, conversationId };
        } catch (error) {
          console.error("Erro ao criar conversa:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro ao criar conversa" });
        }
      }),
    getConversations: publicProcedure
      .input(z.object({ clientId: z.string().min(1) }))
      .query(async ({ input }) => {
        try {
          await hydrateSyncState();
          const client = getReleasedClientOrThrow(input.clientId);
          if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum cliente configurado" });
          
          // Retornar conversas do cliente
          const clientConversations = conversations.filter(c => c.clientId === client.clientId);
          return clientConversations.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            company: c.company,
            status: c.status,
            lastMessage: c.lastMessage,
            timestamp: c.time,
          }));
        } catch (error) {
          console.error("Erro ao buscar conversas:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro ao buscar conversas" });
        }
      }),
    closeConversation: publicProcedure
      .input(z.object({ conversationId: z.string(), clientId: z.string().min(1) }))
      .mutation(async ({ input }) => {
        try {
          const { updateConversationStatus } = await import("./db");
          await hydrateSyncState();
          const client = getReleasedClientOrThrow(input.clientId);
          if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum cliente configurado" });
          
          // Verifica que a conversa pertence ao cliente antes de encerrar
          const conv = conversations.find(c => c.id === input.conversationId);
          if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada." });
          if (conv.clientId !== client.clientId) throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado: conversa não pertence a este cliente." });
          
          await updateConversationStatus(input.conversationId, "closed");
          conv.status = "closed";
          
          audit("MegaDesk", `Conversa encerrada: ${input.conversationId}`, client.clientId);
          await persistSyncState();
          return { ok: true };
        } catch (error) {
          console.error("Erro ao encerrar conversa:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro ao encerrar conversa" });
        }
      }),
    getActiveUsers: publicProcedure
      .input(z.object({ clientId: z.string().min(1) }))
      .query(async ({ input }) => {
        try {
          await hydrateSyncState();
          const client = getReleasedClientOrThrow(input.clientId);
          if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum cliente configurado" });
          
          // Retornar todos os usuários ativos do cliente
          const activeUsers = client.users
            .filter(u => u.status === "active")
            .map(u => ({
              id: u.id,
              name: u.name,
              email: u.email,
              role: u.role,
            }));
          
          return activeUsers;
        } catch (error) {
          console.error("Erro ao buscar usuários ativos:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro ao buscar usuários ativos" });
        }
      }),
    updateCustomerInfo: publicProcedure
      .input(z.object({ customerId: z.string(), name: z.string().optional(), company: z.string().optional(), clientId: z.string().min(1) }))
      .mutation(async ({ input }) => {
        try {
          const { updateCustomer } = await import("./db");
          await hydrateSyncState();
          const client = getReleasedClientOrThrow(input.clientId);
          if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum cliente configurado" });
          
          if (!input.name && !input.company) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Forneça pelo menos um campo para atualizar" });
          }
          
          await updateCustomer({
            customerId: input.customerId,
            clientId: client.clientId,
            name: input.name,
            company: input.company,
          });
          
          const conversation = conversations.find(c => c.id === input.customerId);
          if (conversation) {
            if (input.name) conversation.name = input.name;
            if (input.company) conversation.company = input.company;
          }
          
          audit("MegaDesk", `Cliente atualizado: ${input.customerId}`, client.clientId);
          await persistSyncState();
          return { ok: true, customerId: input.customerId };
        } catch (error) {
          console.error("Erro ao atualizar cliente:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Erro ao atualizar cliente" });
        }
      }),
    getClientUsers: publicProcedure
      .input(z.object({ clientId: z.string().optional() }))
      .query(async ({ input }) => {
        await hydrateSyncState();
        const client = getReleasedClientOrThrow(input.clientId);
        // Retornar apenas usuários ativos do cliente
        const activeUsers = client.users
          .filter((u) => u.status === "active")
          .map((u) => ({
            userId: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            status: u.status,
          }));
        return activeUsers;
      }),
    loginByEmail: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await hydrateSyncState();
        const email = input.email.trim().toLowerCase();

        // Busca o usuário em todos os clientes
        for (const client of clients) {
          const user = client.users.find((u) => u.email.toLowerCase() === email);
          if (!user) continue;

          // Usuário encontrado — verifica se está ativo
          if (user.status !== "active") {
            audit("MegaDesk", `Login negado: usuário bloqueado (${email})`, client.clientId, false);
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Seu acesso está bloqueado. Entre em contato com o administrador.",
            });
          }

          // Verifica se o cliente tem acesso liberado
          if (!client.accessReleased || client.status !== "active") {
            audit("MegaDesk", `Login negado: cliente sem acesso liberado (${email})`, client.clientId, false);
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Sua empresa ainda não tem acesso liberado na plataforma. Aguarde a ativação pelo administrador.",
            });
          }

          // Verifica a senha no banco de dados
          const credRows = await getDb()
            .select({ passwordHash: megadeskDomainClientUsers.passwordHash })
            .from(megadeskDomainClientUsers)
            .where(eq(megadeskDomainClientUsers.userId, user.id))
            .limit(1);
          const cred = credRows[0];
          if (!cred || !cred.passwordHash) {
            audit("MegaDesk", `Login negado: senha não configurada (${email})`, client.clientId, false);
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Senha de acesso não configurada. Solicite ao administrador que defina sua senha.",
            });
          }
          const valid = await bcrypt.compare(input.password, cred.passwordHash);
          if (!valid) {
            audit("MegaDesk", `Login negado: senha incorreta (${email})`, client.clientId, false);
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Senha incorreta. Tente novamente ou solicite a redefinição ao administrador.",
            });
          }

          const permissions = resolveUserPermissions(user, client.modules);
          audit("MegaDesk", `Login realizado: ${email}`, client.clientId);
          await persistSyncState();

          return {
            ok: true,
            session: {
              userEmail: user.email,
              userName: user.name,
              userRole: user.role,
              permissions,
              clientId: client.clientId,
              company: client.company,
              plan: client.plan,
              modules: client.modules,
            },
          };
        }

        // E-mail não encontrado em nenhum cliente
        audit("MegaDesk", `Login negado: e-mail não cadastrado (${email})`, undefined, false);
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "E-mail não encontrado. Verifique se você foi cadastrado pelo administrador.",
        });
      }),
    refreshSession: publicProcedure
      .input(z.object({ userEmail: z.string().email() }))
      .mutation(async ({ input }) => {
        await hydrateSyncState();
        const email = input.userEmail.trim().toLowerCase();

        // Busca o usuário em todos os clientes
        for (const client of clients) {
          const user = client.users.find((u) => u.email.toLowerCase() === email);
          if (!user) continue;

          // Verifica se o usuário ainda está ativo
          if (user.status !== "active") {
            audit("MegaDesk", `Refresh negado: usuário bloqueado (${email})`, client.clientId, false);
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Seu acesso está bloqueado. Entre em contato com o administrador.",
            });
          }

          // Verifica se o cliente ainda tem acesso liberado
          if (!client.accessReleased || client.status !== "active") {
            audit("MegaDesk", `Refresh negado: cliente sem acesso liberado (${email})`, client.clientId, false);
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Sua empresa ainda não tem acesso liberado na plataforma.",
            });
          }

          // Renova a sessão com permissões atualizadas (respeitando módulos do cliente)
          const permissions = resolveUserPermissions(user, client.modules);
          audit("MegaDesk", `Sessão renovada: ${email}`, client.clientId);
          await persistSyncState();

          return {
            ok: true,
            session: {
              userEmail: user.email,
              userName: user.name,
              userRole: user.role,
              permissions,
              clientId: client.clientId,
              company: client.company,
              plan: client.plan,
              modules: client.modules,
            },
          };
        }

        // E-mail não encontrado
        audit("MegaDesk", `Refresh negado: e-mail não encontrado (${email})`, undefined, false);
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sessão expirada. Faça login novamente.",
        });
      }),
  }),
  assistant: router({
    chat: publicProcedure
      .input(z.object({
        messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
        platform: z.enum(["megaadmin", "megadesk"]).optional(),
        url: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { generateAIResponse, getSystemPromptForPlatform, detectPlatformFromContext } = await import("./_core/gemini");
        
        const platform = input.platform || (input.url ? await detectPlatformFromContext(input.url) : "megadesk");
        const systemPrompt = getSystemPromptForPlatform(platform);
        
        try {
          const response = await generateAIResponse(input.messages, systemPrompt);
          return { ok: true, response, platform };
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Erro ao gerar resposta IA: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
          });
        }
      }),

    // ── Chat IA por cliente (usa token Gemini do cliente, histórico no banco) ──
    clientChat: publicProcedure
      .input(z.object({
        clientId: z.string().min(1),
        userId: z.string().min(1),
        message: z.string().min(1).max(4000),
      }))
      .mutation(async ({ input }) => {
        const { chatWithClientGemini, loadConversationHistory } = await import("./gemini-client");
        const history = await loadConversationHistory(input.clientId, input.userId);
        try {
          const result = await chatWithClientGemini(
            input.clientId,
            input.userId,
            input.message,
            history
          );
          return result;
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Erro desconhecido";
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
        }
      }),

    // ── Carrega histórico de conversa do usuário ──
    getHistory: publicProcedure
      .input(z.object({
        clientId: z.string().min(1),
        userId: z.string().min(1),
      }))
      .query(async ({ input }) => {
        const { loadConversationHistory } = await import("./gemini-client");
        const history = await loadConversationHistory(input.clientId, input.userId);
        return { ok: true, history };
      }),

    // ── Limpa histórico de conversa do usuário ──
    clearHistory: publicProcedure
      .input(z.object({
        clientId: z.string().min(1),
        userId: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const pool = getPool();
        await pool.execute(
          "DELETE FROM megadesk_domain_ia_conversation_history WHERE client_id = ? AND user_id = ?",
          [input.clientId, input.userId]
        );
        return { ok: true };
      }),

        // ── Verifica se o cliente tem token Gemini configurado ──
    checkGeminiConfig: publicProcedure
      .input(z.object({ clientId: z.string().min(1) }))
      .query(async ({ input }) => {
        const { getClientGeminiToken } = await import("./gemini-client");
        const token = await getClientGeminiToken(input.clientId);
        return { configured: !!token && token.length > 10 };
      }),
  }),

  // ════════════════════════════════════════════════════════════════════════════════
  // ROUTER: tokenUsage — Rastreio de uso de tokens Gemini por cliente
  // ════════════════════════════════════════════════════════════════════════════════
  tokenUsage: router({
    // Registra uso de tokens após uma conversa com IA
    record: publicProcedure
      .input(z.object({
        clientId: z.string().min(1),
        userEmail: z.string().default(""),
        conversationId: z.string().default(""),
        promptTokens: z.number().int().min(0).default(0),
        completionTokens: z.number().int().min(0).default(0),
        totalTokens: z.number().int().min(0).default(0),
        model: z.string().default("gemini-1.5-flash"),
        functionCallsCount: z.number().int().min(0).default(0),
      }))
      .mutation(async ({ input }) => {
        const pool = getPool();
        const id = `tu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await pool.execute(
          `INSERT INTO megadesk_ia_token_usage
           (id, client_id, user_email, conversation_id, prompt_tokens, completion_tokens, total_tokens, model, function_calls_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, input.clientId, input.userEmail, input.conversationId,
           input.promptTokens, input.completionTokens, input.totalTokens,
           input.model, input.functionCallsCount, Date.now()]
        );
        return { ok: true, id };
      }),

    // Retorna resumo de uso de tokens por cliente (para MegaAdmin)
    getSummary: adminProcedure
      .input(z.object({
        clientId: z.string().min(1),
        period: z.enum(["today", "week", "month", "all"]).default("month"),
      }))
      .query(async ({ input }) => {
        const pool = getPool();
        const now = Date.now();
        const periodMs: Record<string, number> = {
          today: 24 * 60 * 60 * 1000,
          week: 7 * 24 * 60 * 60 * 1000,
          month: 30 * 24 * 60 * 60 * 1000,
          all: now, // desde o início
        };
        const since = input.period === "all" ? 0 : now - periodMs[input.period];

        // Totais do período
        const [totals] = await pool.execute(
          `SELECT
             COUNT(*) as total_calls,
             COALESCE(SUM(total_tokens), 0) as total_tokens,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens,
             COALESCE(SUM(function_calls_count), 0) as function_calls,
             COUNT(DISTINCT user_email) as unique_users,
             COUNT(DISTINCT conversation_id) as total_conversations
           FROM megadesk_ia_token_usage
           WHERE client_id = ? AND created_at >= ?`,
          [input.clientId, since]
        ) as any;

        // Uso por dia (últimos 30 dias)
        const [dailyUsage] = await pool.execute(
          `SELECT
             DATE(FROM_UNIXTIME(created_at / 1000)) as day,
             SUM(total_tokens) as tokens,
             COUNT(*) as calls
           FROM megadesk_ia_token_usage
           WHERE client_id = ? AND created_at >= ?
           GROUP BY DATE(FROM_UNIXTIME(created_at / 1000))
           ORDER BY day DESC
           LIMIT 30`,
          [input.clientId, now - 30 * 24 * 60 * 60 * 1000]
        ) as any;

        // Top usuários por consumo
        const [topUsers] = await pool.execute(
          `SELECT
             user_email,
             SUM(total_tokens) as total_tokens,
             COUNT(*) as calls
           FROM megadesk_ia_token_usage
           WHERE client_id = ? AND created_at >= ?
           GROUP BY user_email
           ORDER BY total_tokens DESC
           LIMIT 10`,
          [input.clientId, since]
        ) as any;

        const summary = (totals as any[])[0] ?? {};
        // Custo estimado: Gemini 1.5 Flash = ~$0.075 por 1M tokens de entrada, $0.30 por 1M de saída
        const promptCost = (Number(summary.prompt_tokens ?? 0) / 1_000_000) * 0.075;
        const completionCost = (Number(summary.completion_tokens ?? 0) / 1_000_000) * 0.30;
        const estimatedCostUSD = promptCost + completionCost;

        return {
          period: input.period,
          totalCalls: Number(summary.total_calls ?? 0),
          totalTokens: Number(summary.total_tokens ?? 0),
          promptTokens: Number(summary.prompt_tokens ?? 0),
          completionTokens: Number(summary.completion_tokens ?? 0),
          functionCalls: Number(summary.function_calls ?? 0),
          uniqueUsers: Number(summary.unique_users ?? 0),
          totalConversations: Number(summary.total_conversations ?? 0),
          estimatedCostUSD: Math.round(estimatedCostUSD * 10000) / 10000,
          estimatedCostBRL: Math.round(estimatedCostUSD * 5.5 * 100) / 100, // cotacao aproximada
          dailyUsage: (dailyUsage as any[]).map((d) => ({
            day: d.day,
            tokens: Number(d.tokens),
            calls: Number(d.calls),
          })),
          topUsers: (topUsers as any[]).map((u) => ({
            email: u.user_email,
            tokens: Number(u.total_tokens),
            calls: Number(u.calls),
          })),
        };
      }),

    // Histórico detalhado de uso (para MegaAdmin)
    getHistory: adminProcedure
      .input(z.object({
        clientId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        const pool = getPool();
        const [rows] = await pool.execute(
          `SELECT id, user_email, conversation_id, prompt_tokens, completion_tokens,
                  total_tokens, model, function_calls_count, created_at
           FROM megadesk_ia_token_usage
           WHERE client_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
          [input.clientId, input.limit, input.offset]
        ) as any;
        const [countRows] = await pool.execute(
          "SELECT COUNT(*) as total FROM megadesk_ia_token_usage WHERE client_id = ?",
          [input.clientId]
        ) as any;
        return {
          items: (rows as any[]).map((r) => ({
            id: r.id,
            userEmail: r.user_email,
            conversationId: r.conversation_id,
            promptTokens: Number(r.prompt_tokens),
            completionTokens: Number(r.completion_tokens),
            totalTokens: Number(r.total_tokens),
            model: r.model,
            functionCallsCount: Number(r.function_calls_count),
            createdAt: Number(r.created_at),
          })),
          total: Number((countRows as any[])[0]?.total ?? 0),
        };
      }),
  }),
  conversations: router({
    list: publicProcedure
      .input(z.object({
        clientId: z.string(),
        viewMode: z.enum(["all", "mine", "specific"]).optional(),
        assignedUserId: z.string().nullable().optional(),
      }))
      .query(({ input }) => {
        let clientConversations = conversations.filter((c) => c.clientId === input.clientId);
        // Filtrar por modo de visualização
        if (input.viewMode === "mine" && input.assignedUserId) {
          clientConversations = clientConversations.filter((c) => c.assignedUserId === input.assignedUserId);
        } else if (input.viewMode === "specific" && input.assignedUserId) {
          clientConversations = clientConversations.filter((c) => c.assignedUserId === input.assignedUserId);
        }
        return clientConversations.map((c) => ({
          id: c.id,
          customerName: c.name,
          customerPhone: c.phone,
          companyName: c.company,
          lastMessage: c.lastMessage,
          lastMessageAt: c.createdAt ? new Date(c.createdAt) : new Date(),
          unreadCount: c.unreadCount ?? 0,
          status: (c.status === "closed" ? "closed" : c.status === "bot" ? "pending" : "open") as "open" | "pending" | "closed",
          assignedUserId: c.assignedUserId ?? null,
          assignedUserName: c.assignedUserName,
          iaActive: c.iaActive ?? false,
          lastMessageFrom: c.lastMessageFrom,
          createdAt: c.createdAt,
        }));
      }),
    close: publicProcedure
      .input(z.object({ conversationId: z.string(), clientId: z.string() }))
      .mutation(({ input }) => {
        const conv = conversations.find((c) => c.id === input.conversationId && c.clientId === input.clientId);
        if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa nao encontrada" });
        conv.status = "closed";
        persistSyncState().catch(console.error);
        // Emitir evento Socket.IO
        try {
          const { getSocketIO } = require("../modules/whatsapp/socket/whatsapp.socket");
          const io = getSocketIO();
          if (io) io.to(`client:${input.clientId}`).emit("conversation:closed", { conversationId: input.conversationId, clientId: input.clientId });
        } catch {}
        return { ok: true };
      }),
    assign: publicProcedure
      .input(z.object({ conversationId: z.string(), userId: z.string(), userName: z.string().optional(), clientId: z.string() }))
      .mutation(({ input }) => {
        const conv = conversations.find((c) => c.id === input.conversationId && c.clientId === input.clientId);
        if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa nao encontrada" });
        // Buscar nome do usuário se não foi passado
        const client = clients.find((c) => c.clientId === input.clientId);
        const user = client?.users.find((u) => u.id === input.userId);
        conv.assignedUserId = input.userId;
        conv.assignedUserName = input.userName ?? user?.name;
        persistSyncState().catch(console.error);
        // Emitir evento Socket.IO
        try {
          const { getSocketIO } = require("../modules/whatsapp/socket/whatsapp.socket");
          const io = getSocketIO();
          if (io) io.to(`client:${input.clientId}`).emit("conversation:assigned", { conversationId: input.conversationId, assignedUserId: conv.assignedUserId, assignedUserName: conv.assignedUserName, clientId: input.clientId });
        } catch {}
        return { ok: true };
      }),
    reopen: publicProcedure
      .input(z.object({ conversationId: z.string(), clientId: z.string() }))
      .mutation(({ input }) => {
        const conv = conversations.find((c) => c.id === input.conversationId && c.clientId === input.clientId);
        if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa nao encontrada" });
        conv.status = "open";
        persistSyncState().catch(console.error);
        try {
          const { getSocketIO } = require("../modules/whatsapp/socket/whatsapp.socket");
          const io = getSocketIO();
          if (io) io.to(`client:${input.clientId}`).emit("conversation:reopened", { conversationId: input.conversationId, clientId: input.clientId });
        } catch {}
        return { ok: true };
      }),
  }),
  users: router({
    list: publicProcedure
      .input(z.object({ clientId: z.string() }))
      .query(({ input }) => {
        const client = clients.find((c) => c.clientId === input.clientId);
        if (!client) return [];
        return client.users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
        }));
      }),
  }),
});
export type AppRouter = typeof appRouter;
