import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { users, megadeskDomainCustomers, megadeskDomainTickets, megadeskDomainConversations, megadeskDomainChamados } from "../drizzle/schema";

type Database = ReturnType<typeof drizzle>;
type UpsertUserInput = {
  openId: string;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  role?: "admin" | "user";
  lastSignedIn?: Date | null;
};

export type MegaDeskStructuredState = {
  clients: any[];
  conversations: any[];
  tickets: any[];
  botScripts: any[];
  operationalRecords: any[];
  auditLogs: any[];
};

let cachedDb: Database | null = null;
let cachedPool: mysql.Pool | null = null;
let inMemoryState: MegaDeskStructuredState | null = null;

export function getDb(): Database {
  if (!cachedDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não configurada.");
    cachedDb = drizzle(getPool() as any);
  }
  return cachedDb;
}

export function getPool() {
  if (!cachedPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não configurada.");
    cachedPool = mysql.createPool(url);
  }
  return cachedPool;
}

export async function getUserByOpenId(openId: string) {
  const rows = await getDb().select().from(users).where(eq(users.openId, openId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUser(input: UpsertUserInput) {
  const now = new Date();
  await getDb().insert(users).values({
    openId: input.openId,
    name: input.name ?? "Usuário MegaDesk",
    email: input.email ?? null,
    loginMethod: input.loginMethod ?? null,
    role: input.role ?? "user",
    lastSignedIn: input.lastSignedIn ?? now,
  }).onDuplicateKeyUpdate({
    set: {
      name: input.name ?? "Usuário MegaDesk",
      email: input.email ?? null,
      loginMethod: input.loginMethod ?? null,
      lastSignedIn: input.lastSignedIn ?? now,
      updatedAt: now,
    },
  });
}

// Customer/Client Helpers
export async function getConversationsByClientId(clientId: string) {
  const rows = await getDb()
    .select()
    .from(megadeskDomainConversations)
    .where(eq(megadeskDomainConversations.clientId, clientId));
  return rows;
}

export async function searchCustomerByPhone(phone: string) {
  const rows = await getDb()
    .select()
    .from(megadeskDomainCustomers)
    .where(eq(megadeskDomainCustomers.phone, phone))
    .limit(1);
  return rows[0] ?? null;
}

export async function createCustomer(input: {
  customerId: string;
  clientId: string;
  name: string;
  phone: string;
  company: string;
  email?: string;
}) {
  await getDb().insert(megadeskDomainCustomers).values({
    customerId: input.customerId,
    clientId: input.clientId,
    name: input.name,
    phone: input.phone,
    company: input.company,
    email: input.email ?? null,
    status: "active",
  });
  return input;
}

export async function createTicket(input: {
  ticketId: string;
  clientId: string;
  company: string;
  customer: string;
  problem: string;
  category: string;
  description: string;
}) {
  const chamadoNumber = Math.floor(Math.random() * 10000) + 1;
  const chamadoId = `chamado-${Date.now()}`;
  
  await getDb().insert(megadeskDomainChamados).values({
    chamadoId: chamadoId,
    clientId: input.clientId,
    chamadoNumber: chamadoNumber,
    customerId: input.customer,
    customerName: input.customer,
    company: input.company,
    title: input.problem,
    observations: input.description,
    status: "open",
    priority: "media",
  });
  return { ...input, chamadoId, chamadoNumber };
}

export async function createConversation(input: {
  conversationId: string;
  clientId: string;
  customerName: string;
  phone: string;
  company: string;
  lastMessage?: string;
  messages?: any[];
}) {
  const now = new Date();
  await getDb().insert(megadeskDomainConversations).values({
    conversationId: input.conversationId,
    clientId: input.clientId,
    customerName: input.customerName,
    phone: input.phone,
    company: input.company,
    status: "open",
    lastMessage: input.lastMessage ?? "Conversa iniciada",
    timeLabel: now.toLocaleString("pt-BR"),
    messagesJson: JSON.stringify(input.messages ?? []),
  });
  return input;
}

function cloneState(state: MegaDeskStructuredState): MegaDeskStructuredState {
  return structuredClone(state);
}

async function ensureStructuredTables() {
  const pool = getPool();
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_clients (
    client_id VARCHAR(80) PRIMARY KEY,
    internal_id VARCHAR(80) NOT NULL,
    tenant_database_name VARCHAR(120) NOT NULL UNIQUE,
    company VARCHAR(255) NOT NULL,
    contact VARCHAR(180) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    plan VARCHAR(120) NOT NULL,
    status ENUM('active','setup','paused') NOT NULL DEFAULT 'setup',
    access_released BOOLEAN NOT NULL DEFAULT FALSE,
    api_token VARCHAR(255) NOT NULL,
    modules_json LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_client_users (
    user_id VARCHAR(80) PRIMARY KEY,
    client_id VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role ENUM('admin','manager','agent','viewer') NOT NULL DEFAULT 'viewer',
    status ENUM('active','blocked') NOT NULL DEFAULT 'blocked',
    permissions_json LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_mdu_client (client_id)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_conversations (
    conversation_id VARCHAR(80) PRIMARY KEY,
    client_id VARCHAR(80) NOT NULL,
    customer_name VARCHAR(180) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    company VARCHAR(255) NOT NULL,
    status ENUM('open','bot','closed') NOT NULL DEFAULT 'open',
    last_message TEXT NOT NULL,
    time_label VARCHAR(80) NOT NULL,
    messages_json LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_mdc_client (client_id)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_tickets (
    ticket_id VARCHAR(80) PRIMARY KEY,
    client_id VARCHAR(80) NOT NULL,
    company VARCHAR(255) NOT NULL,
    customer VARCHAR(180) NOT NULL,
    problem VARCHAR(255) NOT NULL,
    category VARCHAR(120) NOT NULL,
    status ENUM('open','in_progress','waiting','closed') NOT NULL DEFAULT 'open',
    created_label VARCHAR(80) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_mdt_client (client_id)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_bot_scripts (
    script_id VARCHAR(80) PRIMARY KEY,
    client_id VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT NOT NULL,
    initial_message TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_mdbs_client (client_id)
  )`);
  try {
    await pool.execute("ALTER TABLE megadesk_domain_bot_scripts ADD COLUMN client_id VARCHAR(80) NOT NULL DEFAULT 'cliente-demo-001'");
  } catch (error: any) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
  try {
    await pool.execute("ALTER TABLE megadesk_domain_bot_scripts ADD INDEX idx_mdbs_client (client_id)");
  } catch (error: any) {
    if (error?.code !== "ER_DUP_KEYNAME") throw error;
  }
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_operational_records (
    record_id VARCHAR(80) PRIMARY KEY,
    client_id VARCHAR(80) NOT NULL,
    tenant_database_name VARCHAR(120) NOT NULL,
    record_type ENUM('conversation','ticket','tracking','erp') NOT NULL,
    owner_phone VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(80) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mdor_client (client_id),
    INDEX idx_mdor_tenant (tenant_database_name)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_audit_logs (
    audit_id VARCHAR(100) PRIMARY KEY,
    platform ENUM('MegaAdmin','MegaDesk') NOT NULL,
    action VARCHAR(255) NOT NULL,
    client_id VARCHAR(80),
    success BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mdal_client (client_id)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_metrics (
    metric_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(80) NOT NULL,
    metric_type VARCHAR(80) NOT NULL,
    amount INT NOT NULL DEFAULT 1,
    source VARCHAR(80) NOT NULL DEFAULT 'system',
    metadata_json LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mdm_client (client_id)
  )`);
}

async function countClients(pool: mysql.Pool) {
  const [rows] = await pool.execute("SELECT COUNT(*) AS total FROM megadesk_domain_clients");
  return Number((rows as Array<{ total: number }>)[0]?.total ?? 0);
}

export async function seedMegaDeskStructuredState(defaultState: MegaDeskStructuredState) {
  try {
    await ensureStructuredTables();
    const pool = getPool();
    if (await countClients(pool) > 0) return;
    await saveMegaDeskStructuredState(defaultState);
  } catch (error) {
    if (!inMemoryState) inMemoryState = cloneState(defaultState);
    console.warn("[MegaDesk Sync] Banco indisponível; usando fallback em memória para testes/desenvolvimento.", error);
  }
}

export async function loadMegaDeskStructuredState(defaultState: MegaDeskStructuredState): Promise<MegaDeskStructuredState> {
  if (!process.env.DATABASE_URL) {
    if (!inMemoryState) inMemoryState = cloneState(defaultState);
    return inMemoryState;
  }
  try {
    await seedMegaDeskStructuredState(defaultState);
    const pool = getPool();
    const [clientRows] = await pool.execute("SELECT * FROM megadesk_domain_clients ORDER BY created_at ASC");
    const [userRows] = await pool.execute("SELECT * FROM megadesk_domain_client_users ORDER BY created_at ASC");
    const [conversationRows] = await pool.execute("SELECT * FROM megadesk_domain_conversations ORDER BY created_at DESC");
    const [ticketRows] = await pool.execute("SELECT * FROM megadesk_domain_tickets ORDER BY created_at DESC");
    const [scriptRows] = await pool.execute("SELECT * FROM megadesk_domain_bot_scripts ORDER BY created_at ASC");
    const [recordRows] = await pool.execute("SELECT * FROM megadesk_domain_operational_records ORDER BY created_at DESC LIMIT 100");
    const [auditRows] = await pool.execute("SELECT * FROM megadesk_domain_audit_logs ORDER BY created_at DESC LIMIT 100");

    const usersByClient = new Map<string, any[]>();
    for (const row of userRows as any[]) {
      const list = usersByClient.get(row.client_id) ?? [];
      list.push({ id: row.user_id, name: row.name, email: row.email, role: row.role, status: row.status, permissions: JSON.parse(row.permissions_json || "[]") });
      usersByClient.set(row.client_id, list);
    }

    const loadedState = {
      clients: (clientRows as any[]).map((row) => ({ id: row.internal_id, clientId: row.client_id, tenantDatabaseName: row.tenant_database_name, company: row.company, contact: row.contact, phone: row.phone, plan: row.plan, status: row.status, accessReleased: Boolean(row.access_released), apiToken: row.api_token, modules: JSON.parse(row.modules_json || "[]"), users: usersByClient.get(row.client_id) ?? [] })),
      conversations: (conversationRows as any[]).map((row) => ({ id: row.conversation_id, clientId: row.client_id, name: row.customer_name, phone: row.phone, company: row.company, status: row.status, lastMessage: row.last_message, time: row.time_label, messages: JSON.parse(row.messages_json || "[]") })),
      tickets: (ticketRows as any[]).map((row) => ({ id: row.ticket_id, clientId: row.client_id, company: row.company, customer: row.customer, problem: row.problem, category: row.category, status: row.status, createdAt: row.created_label, description: row.description })),
      botScripts: (scriptRows as any[]).map((row) => ({ id: row.script_id, clientId: row.client_id, name: row.name, description: row.description, initialMessage: row.initial_message, active: Boolean(row.active) })),
      operationalRecords: (recordRows as any[]).map((row) => ({ id: row.record_id, clientId: row.client_id, tenantDatabaseName: row.tenant_database_name, type: row.record_type, ownerPhone: row.owner_phone, title: row.title, status: row.status, payload: JSON.parse(row.payload_json || "{}"), createdAt: row.created_at?.toISOString?.() ?? String(row.created_at) })),
      auditLogs: (auditRows as any[]).map((row) => ({ id: row.audit_id, platform: row.platform, action: row.action, clientId: row.client_id ?? undefined, success: Boolean(row.success), createdAt: row.created_at?.toISOString?.() ?? String(row.created_at) })),
    };
    // ATUALIZAR inMemoryState COM DADOS DO BANCO (SEMPRE SINCRONIZADO)
    inMemoryState = loadedState;
    return loadedState;
  } catch (error) {
    console.warn("[MegaDesk Sync] Falha ao carregar persistência estruturada; tentando usar fallback em memória.", error);
    // SE HOUVER ERRO, RETORNAR ESTADO EM MEMÓRIA (QUE FOI SINCRONIZADO ANTERIORMENTE)
    if (inMemoryState) return inMemoryState;
    // ÚLTIMO RECURSO: USAR ESTADO PADRÃO
    inMemoryState = cloneState(defaultState);
    return inMemoryState;
  }
}

export async function saveMegaDeskStructuredState(state: MegaDeskStructuredState): Promise<void> {
  inMemoryState = state;
  if (!process.env.DATABASE_URL) return;
  try {
    await ensureStructuredTables();
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // Salva os hashes de senha existentes ANTES de apagar os usuários
      const [existingHashRows] = await connection.execute("SELECT user_id, password_hash FROM megadesk_domain_client_users WHERE password_hash IS NOT NULL");
      const passwordHashMap = new Map<string, string>();
      for (const row of existingHashRows as any[]) {
        if (row.password_hash) passwordHashMap.set(row.user_id, row.password_hash);
      }

      await connection.execute("DELETE FROM megadesk_domain_conversations");
      await connection.execute("DELETE FROM megadesk_domain_tickets");
      await connection.execute("DELETE FROM megadesk_domain_bot_scripts");
      await connection.execute("DELETE FROM megadesk_domain_operational_records");
      await connection.execute("DELETE FROM megadesk_domain_audit_logs");
      await connection.execute("DELETE FROM megadesk_domain_metrics");

      for (const client of state.clients) {
        await connection.execute("INSERT INTO megadesk_domain_clients (client_id, internal_id, tenant_database_name, company, contact, phone, plan, status, access_released, api_token, modules_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE company=VALUES(company), contact=VALUES(contact), phone=VALUES(phone), plan=VALUES(plan), status=VALUES(status), access_released=VALUES(access_released), api_token=VALUES(api_token), modules_json=VALUES(modules_json)", [client.clientId, client.id, client.tenantDatabaseName, client.company, client.contact, client.phone, client.plan, client.status, client.accessReleased ? 1 : 0, client.apiToken, JSON.stringify(client.modules ?? [])]);
        for (const user of client.users ?? []) {
          const passwordHash = (user as any).passwordHash ?? null;
          await connection.execute("INSERT INTO megadesk_domain_client_users (user_id, client_id, name, email, role, status, permissions_json, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), role=VALUES(role), status=VALUES(status), permissions_json=VALUES(permissions_json), password_hash=VALUES(password_hash)", [user.id, client.clientId, user.name, user.email, user.role, user.status, JSON.stringify(user.permissions ?? []), passwordHash]);
        }
      }
      for (const conversation of state.conversations) {
        await connection.execute("INSERT INTO megadesk_domain_conversations (conversation_id, client_id, customer_name, phone, company, status, last_message, time_label, messages_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [conversation.id, conversation.clientId, conversation.name, conversation.phone, conversation.company, conversation.status, conversation.lastMessage, conversation.time, JSON.stringify(conversation.messages ?? [])]);
      }
      for (const ticket of state.tickets) {
        const ticketNumber = Math.floor(Math.random() * 10000) + 1;
        await connection.execute("INSERT INTO megadesk_domain_tickets (ticket_id, client_id, company, customer, problem, category, status, created_label, description, ticket_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [ticket.id, ticket.clientId, ticket.company, ticket.customer, ticket.problem, ticket.category, ticket.status, ticket.createdAt, ticket.description, ticketNumber]);
      }
      for (const script of state.botScripts) {
        const scriptClientId = script.clientId ?? state.clients[0]?.clientId ?? "cliente-demo-001";
        await connection.execute("INSERT INTO megadesk_domain_bot_scripts (script_id, client_id, name, description, initial_message, active) VALUES (?, ?, ?, ?, ?, ?)", [script.id, scriptClientId, script.name, script.description, script.initialMessage, script.active ? 1 : 0]);
      }
      for (const record of state.operationalRecords) {
        await connection.execute("INSERT INTO megadesk_domain_operational_records (record_id, client_id, tenant_database_name, record_type, owner_phone, title, status, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [record.id, record.clientId, record.tenantDatabaseName, record.type, record.ownerPhone, record.title, record.status, JSON.stringify(record.payload ?? {})]);
      }
      for (let index = 0; index < state.auditLogs.length; index += 1) {
        const audit = state.auditLogs[index];
        await connection.execute("INSERT INTO megadesk_domain_audit_logs (audit_id, platform, action, client_id, success) VALUES (?, ?, ?, ?, ?)", [`${audit.id}-${index}`, audit.platform, audit.action, audit.clientId ?? null, audit.success ? 1 : 0]);
      }
      for (const client of state.clients) {
        await connection.execute("INSERT INTO megadesk_domain_metrics (client_id, metric_type, amount, source, metadata_json) VALUES (?, ?, ?, ?, ?)", [client.clientId, "conversations", state.conversations.filter((conversation) => conversation.clientId === client.clientId).length, "sync", JSON.stringify({ tenantDatabaseName: client.tenantDatabaseName })]);
        await connection.execute("INSERT INTO megadesk_domain_metrics (client_id, metric_type, amount, source, metadata_json) VALUES (?, ?, ?, ?, ?)", [client.clientId, "tickets", state.tickets.filter((ticket) => ticket.clientId === client.clientId).length, "sync", JSON.stringify({ tenantDatabaseName: client.tenantDatabaseName })]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.warn("[MegaDesk Sync] Não foi possível persistir tabelas estruturadas; mantendo cache em memória.", error);
  }
}

export async function recordMegaDeskMetric(clientId: string, metricType: string, amount = 1, metadata: Record<string, unknown> = {}, source = "runtime") {
  if (!process.env.DATABASE_URL) return;
  try {
    await ensureStructuredTables();
    await getPool().execute("INSERT INTO megadesk_domain_metrics (client_id, metric_type, amount, source, metadata_json) VALUES (?, ?, ?, ?, ?)", [clientId, metricType, amount, source, JSON.stringify(metadata)]);
  } catch (error) {
    console.warn("[MegaDesk Sync] Falha ao registrar métrica estruturada.", error);
  }
}

export async function validateMegaDeskClientToken(clientId: string, apiToken: string) {
  if (!process.env.DATABASE_URL) return null;
  try {
    await ensureStructuredTables();
    const [rows] = await getPool().execute(
      "SELECT client_id, company, tenant_database_name, api_token, access_released, status FROM megadesk_domain_clients WHERE client_id = ? LIMIT 1",
      [clientId],
    );
    const client = (rows as any[])[0];
    if (!client || client.api_token !== apiToken || !Boolean(client.access_released) || client.status !== "active") return null;
    return { clientId: client.client_id, company: client.company, tenantDatabaseName: client.tenant_database_name };
  } catch (error) {
    console.warn("[MegaDesk Sync] Falha ao validar token estruturado do cliente.", error);
    return null;
  }
}

export async function readMegaDeskTenantObservability(clientId: string) {
  if (!process.env.DATABASE_URL) return { metrics: [], auditLogs: [], botScripts: [] };
  try {
    await ensureStructuredTables();
    const [metricRows] = await getPool().execute(
      "SELECT metric_type, amount, source, metadata_json, created_at FROM megadesk_domain_metrics WHERE client_id = ? ORDER BY metric_id DESC LIMIT 50",
      [clientId],
    );
    const [auditRows] = await getPool().execute(
      "SELECT platform, action, success, created_at FROM megadesk_domain_audit_logs WHERE client_id = ? ORDER BY audit_id DESC LIMIT 50",
      [clientId],
    );
    const [scriptRows] = await getPool().execute(
      "SELECT script_id, name, description, initial_message, active FROM megadesk_domain_bot_scripts WHERE client_id = ? ORDER BY script_id DESC LIMIT 50",
      [clientId],
    );
    return {
      metrics: (metricRows as any[]).map((row) => ({ metricType: row.metric_type, amount: Number(row.amount), source: row.source, metadata: JSON.parse(row.metadata_json || "{}"), createdAt: row.created_at })),
      auditLogs: (auditRows as any[]).map((row) => ({ sourcePlatform: row.platform, action: row.action, success: Boolean(row.success), createdAt: row.created_at })),
      botScripts: (scriptRows as any[]).map((row) => ({ id: row.script_id, name: row.name, description: row.description, initialMessage: row.initial_message, active: Boolean(row.active) })),
    };
  } catch (error) {
    console.warn("[MegaDesk Sync] Falha ao consultar observabilidade por tenant.", error);
    return { metrics: [], auditLogs: [], botScripts: [] };
  }
}

export async function updateConversationStatus(conversationId: string, status: "open" | "bot" | "closed") {
  const now = new Date();
  await getDb().update(megadeskDomainConversations)
    .set({ status, updatedAt: now })
    .where(eq(megadeskDomainConversations.conversationId, conversationId));
}

export async function updateCustomer(input: {
  customerId: string;
  name?: string;
  company?: string;
}) {
  const now = new Date();
  const updates: any = { updatedAt: now };
  if (input.name) updates.name = input.name;
  if (input.company) updates.company = input.company;
  
  await getDb().update(megadeskDomainCustomers)
    .set(updates)
    .where(eq(megadeskDomainCustomers.customerId, input.customerId));
}
