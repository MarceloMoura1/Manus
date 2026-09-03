import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import { users, megadeskDomainCustomers, megadeskDomainTickets, megadeskDomainConversations, megadeskDomainChamados, megadeskDomainChamadoSequence } from "../drizzle/schema";
import { getTestDatabaseUrl } from "./test-integration-gates";

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
export let inMemoryState: MegaDeskStructuredState | null = null;

export const REQUIRED_MAIN_TABLES = [
  "admin_credentials", "evolution_failed_messages", "evolution_queue_config",
  "evolution_queue_metrics", "evolution_retry_history", "megaadmin_credentials",
  "megadesk_company_settings", "megadesk_crm_clients", "megadesk_domain_audit_logs",
  "megadesk_domain_backups", "megadesk_domain_bot_scripts", "megadesk_domain_chamado_activities",
  "megadesk_domain_chamado_attachments", "megadesk_domain_chamado_collaborators",
  "megadesk_domain_chamado_sequence", "megadesk_domain_chamados",
  "megadesk_domain_client_users", "megadesk_domain_clients", "megadesk_domain_conversations",
  "megadesk_domain_customers", "megadesk_domain_metrics", "megadesk_domain_operational_records",
  "megadesk_domain_tickets", "megadesk_notifications", "megadesk_user_settings",
  "megadesk_user_shortcuts", "megadesk_whatsapp_config", "users", "wa_accounts",
  "wa_conversations", "wa_messages",
	"megadesk_ticket_statuses", "megadesk_crm_timeline", "megadesk_domain_conversations_messages",
	"megadesk_evolution_sessions", "megadesk_domain_ia_conversations",
	"megadesk_domain_ia_conversation_history", "megadesk_ia_token_usage",
	"megadesk_tenant_provisioning_requests", "megadesk_operational_sessions",
	"erp_products", "erp_stock_balances", "erp_stock_movements",
] as const;

export const REQUIRED_MAIN_COLUMNS = {
	megadesk_domain_clients: ["client_id", "tenant_database_name", "status", "access_released"],
	megadesk_domain_client_users: ["user_id", "client_id", "email", "status"],
	megadesk_domain_bot_scripts: ["script_id", "client_id", "description", "system_prompt"],
	megadesk_whatsapp_config: ["configId", "clientId", "phoneNumberId", "accessToken", "connectionStatus"],
	megadesk_evolution_sessions: ["client_id", "instance_name", "status"],
	megadesk_domain_conversations_messages: ["message_id", "conversation_id", "status"],
	megadesk_ia_token_usage: ["id", "client_id", "created_at"],
	megadesk_tenant_provisioning_requests: ["idempotency_key", "payload_hash", "client_id"],
	megadesk_operational_sessions: ["id", "token_hash", "user_id", "client_id", "expires_at", "revoked_at"],
	erp_products: ["id", "public_id", "client_id", "sku", "cost_price_cents", "minimum_stock", "active"],
	erp_stock_balances: ["client_id", "product_id", "quantity", "version"],
	erp_stock_movements: ["public_id", "client_id", "product_id", "type", "quantity", "idempotency_key", "payload_hash", "reversal_of"],
} as const;

export async function verifyMainSchema(pool: Pick<mysql.Pool, "execute"> = getPool()): Promise<void> {
  const [rows] = await pool.execute(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
  );
  const present = new Set((rows as Array<{ tableName: string }>).map((row) => row.tableName));
  const missing = REQUIRED_MAIN_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(`SCHEMA_MAIN_NOT_READY: execute as migrations canônicas; tabelas ausentes: ${missing.join(", ")}`);
  }
	const [columnRows] = await pool.execute(
		"SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
	);
	const presentColumns = new Set((columnRows as Array<{ tableName: string; columnName: string }>).map((row) => `${row.tableName}.${row.columnName}`));
	const missingColumns = Object.entries(REQUIRED_MAIN_COLUMNS).flatMap(([table, columns]) =>
		columns.filter((column) => !presentColumns.has(`${table}.${column}`)).map((column) => `${table}.${column}`)
	);
	if (missingColumns.length > 0) {
		throw new Error(`SCHEMA_MAIN_NOT_READY: execute as migrations canônicas; colunas ausentes: ${missingColumns.join(", ")}`);
	}
}

function getConfiguredDatabaseUrl(): string {
  if (process.env.RUN_DATABASE_INTEGRATION === "1") return getTestDatabaseUrl();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  return url;
}

function hasConfiguredDatabase(): boolean {
  return process.env.RUN_DATABASE_INTEGRATION === "1" || Boolean(process.env.DATABASE_URL);
}

function hasExplicitInMemoryStorage(): boolean {
  return process.env.NODE_ENV === "test" && process.env.MEGADESK_STORAGE_MODE === "memory";
}

function assertStorageConfigured(): void {
  if (!hasConfiguredDatabase() && !hasExplicitInMemoryStorage()) {
    throw new Error("MEGADESK_STORAGE_NOT_CONFIGURED: configure DATABASE_URL ou, exclusivamente em testes, MEGADESK_STORAGE_MODE=memory.");
  }
}

export function getDb(): Database {
  if (!cachedDb) {
    cachedDb = drizzle(getPool() as any);
  }
  return cachedDb;
}

export function getPool() {
  if (!cachedPool) {
    cachedPool = mysql.createPool(getConfiguredDatabaseUrl());
  }
  return cachedPool;
}

export async function getUserByOpenId(openId: string) {
  const rows = await getDb().select().from(users).where(eq(users.openId, openId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUser(input: UpsertUserInput) {
  const now = new Date().toISOString().slice(0,19).replace('T',' ');
  await (getDb().insert(users) as any).values({
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
  // Seleciona apenas os campos necessários para a lista (sem messagesJson para evitar [Max Depth])
  const rows = await getDb()
    .select({
      conversationId: megadeskDomainConversations.conversationId,
      clientId: megadeskDomainConversations.clientId,
      crmClientId: megadeskDomainConversations.crmClientId,
      customerName: megadeskDomainConversations.customerName,
      phone: megadeskDomainConversations.phone,
      company: megadeskDomainConversations.company,
      status: megadeskDomainConversations.status,
      assignedUserId: megadeskDomainConversations.assignedUserId,
      assignedUserName: megadeskDomainConversations.assignedUserName,
      unreadCount: megadeskDomainConversations.unreadCount,
      iaActive: megadeskDomainConversations.iaActive,
      lastMessageFrom: megadeskDomainConversations.lastMessageFrom,
      lastMessage: megadeskDomainConversations.lastMessage,
      timeLabel: megadeskDomainConversations.timeLabel,
      createdAt: megadeskDomainConversations.createdAt,
      updatedAt: megadeskDomainConversations.updatedAt,
    })
    .from(megadeskDomainConversations)
    .where(eq(megadeskDomainConversations.clientId, clientId));
  return rows;
}

export async function searchCustomerByPhone(phone: string, clientId: string) {
  const rows = await getDb()
    .select()
    .from(megadeskDomainCustomers)
    .where(and(eq(megadeskDomainCustomers.phone, phone), eq(megadeskDomainCustomers.clientId, clientId)))
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
  await (getDb().insert(megadeskDomainCustomers) as any).values({
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
  // Esta funcao nao eh mais usada - usar createChamado de db-chamados.ts em vez disso
  // Mantida para compatibilidade com codigo legado
  const chamadoNumber = Math.floor(Math.random() * 10000) + 1;
  return { ...input, chamadoId: `chamado-${Date.now()}`, chamadoNumber };
}

export async function createConversation(input: {
  conversationId: string;
  clientId: string;
  crmClientId?: string;
  customerName: string;
  phone: string;
  company: string;
  lastMessage?: string;
  messages?: any[];
  /** Status inicial: 'bot' para mensagens WhatsApp, 'open' para atendimentos internos */
  status?: "open" | "bot" | "closed";
}) {
  await (getDb().insert(megadeskDomainConversations) as any).values({
    conversationId: input.conversationId,
    clientId: input.clientId,
    crmClientId: input.crmClientId ?? null,
    customerName: input.customerName,
    phone: input.phone,
    company: input.company,
    status: input.status ?? "bot",  // padrão BOT: primeiro atendimento é sempre automático
    lastMessage: input.lastMessage ?? "Conversa iniciada",
    timeLabel: new Date().toLocaleString("pt-BR"),
    messagesJson: JSON.stringify(input.messages ?? []),
  });
  return input;
}

function cloneState(state: MegaDeskStructuredState): MegaDeskStructuredState {
  return structuredClone(state);
}

export async function cacheStateAfterSuccessfulPersistence(state: MegaDeskStructuredState, persist: () => Promise<void>): Promise<void> {
  await persist();
  inMemoryState = cloneState(state);
}

async function ensureStructuredTables() {
  await verifyMainSchema();
  return;
  // Código histórico abaixo é deliberadamente inalcançável e será removido
  // depois que a baseline canônica for validada em um MySQL descartável.
  const pool = getPool();
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_clients (
    client_id VARCHAR(80) PRIMARY KEY,
    internal_id VARCHAR(80) NOT NULL,
    tenant_database_name VARCHAR(120) NOT NULL UNIQUE,
    company VARCHAR(255) NOT NULL,
    contact VARCHAR(180) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(40) NOT NULL,
    cnpj VARCHAR(20),
    plan VARCHAR(120) NOT NULL,
    max_users INT NOT NULL DEFAULT 5,
    status ENUM('active','setup','paused') NOT NULL DEFAULT 'setup',
    status_type ENUM('active','test') NOT NULL DEFAULT 'test',
    access_released BOOLEAN NOT NULL DEFAULT FALSE,
    api_token VARCHAR(255) NOT NULL,
    modules_json LONGTEXT NOT NULL,
    integrations_json LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  // Migrações de colunas: cada ALTER TABLE em sua própria chamada execute()
  // (MySQL2 não permite múltiplos statements em uma única execute())
  const migrations = [
    "ALTER TABLE megadesk_domain_clients ADD COLUMN email VARCHAR(255)",
    "ALTER TABLE megadesk_domain_clients ADD COLUMN cnpj VARCHAR(20)",
    "ALTER TABLE megadesk_domain_clients ADD COLUMN max_users INT NOT NULL DEFAULT 5",
    "ALTER TABLE megadesk_domain_clients ADD COLUMN status_type ENUM('active','test') NOT NULL DEFAULT 'test'",
    "ALTER TABLE megadesk_domain_clients ADD COLUMN integrations_json LONGTEXT NOT NULL",
  ];
  for (const migration of migrations) {
    try {
      await pool.execute(migration);
    } catch (err: any) {
      // Ignorar erros de coluna já existente
      if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_client_users (
    user_id VARCHAR(80) PRIMARY KEY,
    client_id VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role ENUM('admin','manager','agent','viewer') NOT NULL DEFAULT 'viewer',
    status ENUM('active','blocked') NOT NULL DEFAULT 'blocked',
    permissions_json LONGTEXT NOT NULL,
    password_hash VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_mdu_client (client_id)
  )`);
  // Migração: adicionar password_hash se não existir (tabelas já criadas anteriormente)
  try {
    await pool.execute("ALTER TABLE megadesk_domain_client_users ADD COLUMN password_hash VARCHAR(255)");
  } catch (err: any) {
    if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
  }
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
  await pool.execute(`CREATE TABLE IF NOT EXISTS megadesk_domain_backups (
    backup_id VARCHAR(80) PRIMARY KEY,
    backup_date DATE NOT NULL,
    backup_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clients_json LONGTEXT NOT NULL,
    conversations_json LONGTEXT NOT NULL,
    tickets_json LONGTEXT NOT NULL,
    bot_scripts_json LONGTEXT NOT NULL,
    operational_records_json LONGTEXT NOT NULL,
    audit_logs_json LONGTEXT NOT NULL,
    total_clients INT NOT NULL DEFAULT 0,
    total_conversations INT NOT NULL DEFAULT 0,
    total_tickets INT NOT NULL DEFAULT 0,
    status ENUM('success','failed','partial') NOT NULL DEFAULT 'success',
    error_message TEXT,
    retention_days INT NOT NULL DEFAULT 30,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mdb_date (backup_date),
    INDEX idx_mdb_timestamp (backup_timestamp)
  )`);

}

async function countClients(pool: mysql.Pool) {
  const [rows] = await pool.execute("SELECT COUNT(*) AS total FROM megadesk_domain_clients");
  return Number((rows as Array<{ total: number }>)[0]?.total ?? 0);
}

export async function seedMegaDeskStructuredState(defaultState: MegaDeskStructuredState) {
  await verifyMainSchema();
  const pool = getPool();
  if (await countClients(pool) > 0) return;
  await saveMegaDeskStructuredState(defaultState);
}

export async function loadMegaDeskStructuredState(defaultState: MegaDeskStructuredState): Promise<MegaDeskStructuredState> {
  if (!hasConfiguredDatabase()) {
    assertStorageConfigured();
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
      // IMPORTANTE: incluir passwordHash para que persistSyncState não sobrescreva com null
      list.push({ id: row.user_id, name: row.name, email: row.email, role: row.role, status: row.status, permissions: JSON.parse(row.permissions_json || "[]"), passwordHash: row.password_hash ?? null });
      usersByClient.set(row.client_id, list);
    }

    const loadedState = {
      clients: (clientRows as any[]).map((row) => ({ id: row.internal_id, clientId: row.client_id, tenantDatabaseName: row.tenant_database_name, company: row.company, contact: row.contact, email: row.email || "", phone: row.phone, cnpj: row.cnpj || "", plan: row.plan, maxUsers: row.max_users || 5, status: row.status, statusType: row.status_type || "test", accessReleased: Boolean(row.access_released), apiToken: row.api_token, modules: JSON.parse(row.modules_json || "[]"), integrations: JSON.parse(row.integrations_json || "{}"), users: usersByClient.get(row.client_id) ?? [] })),
      conversations: (conversationRows as any[]).map((row) => ({ id: row.conversation_id, clientId: row.client_id, name: row.customer_name, phone: row.phone, company: row.company, status: row.status, lastMessage: row.last_message, time: row.time_label, messages: JSON.parse(row.messages_json || "[]") })),
      tickets: (ticketRows as any[]).map((row) => ({ id: row.ticket_id, clientId: row.client_id, company: row.company, customer: row.customer, problem: row.problem, category: row.category, status: row.status, createdAt: row.created_label, description: row.description })),
      botScripts: (scriptRows as any[]).map((row) => ({ id: row.script_id, clientId: row.client_id, name: row.name, description: row.description, initialMessage: row.initial_message, active: Boolean(row.active) })),
      operationalRecords: (recordRows as any[]).map((row) => ({ id: row.record_id, clientId: row.client_id, tenantDatabaseName: row.tenant_database_name, type: row.record_type, ownerPhone: row.owner_phone, title: row.title, status: row.status, payload: JSON.parse(row.payload_json || "{}"), createdAt: row.created_at?.toISOString?.() ?? String(row.created_at) })),
      auditLogs: (auditRows as any[]).map((row) => ({ id: row.audit_id, platform: row.platform, action: row.action, clientId: row.client_id ?? undefined, success: row.success == null ? null : Boolean(row.success), eventPhase: row.event_phase === "intent" || row.event_phase === "success" || row.event_phase === "failure" ? row.event_phase : null, createdAt: row.created_at?.toISOString?.() ?? String(row.created_at) })),
    };
    // ATUALIZAR inMemoryState COM DADOS DO BANCO (SEMPRE SINCRONIZADO)
    inMemoryState = loadedState;
    return loadedState;
  } catch (error) {
    throw error;
  }
}

/**
 * A global-state sync may update conversation summaries, but message payloads
 * remain owned by the canonical message writer after a conversation exists.
 */
export async function upsertConversationStateSnapshot(
  connection: Pick<mysql.PoolConnection, "execute">,
  conversation: MegaDeskStructuredState["conversations"][number],
): Promise<void> {
  await connection.execute(
    "INSERT INTO megadesk_domain_conversations (conversation_id, client_id, customer_name, phone, company, status, last_message, time_label, messages_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE customer_name=VALUES(customer_name), phone=VALUES(phone), company=VALUES(company), status=VALUES(status), last_message=VALUES(last_message), time_label=VALUES(time_label)",
    [conversation.id, conversation.clientId, conversation.name, conversation.phone, conversation.company, conversation.status,
      conversation.lastMessage, conversation.time, JSON.stringify(conversation.messages ?? [])],
  );
}

export async function saveMegaDeskStructuredState(state: MegaDeskStructuredState): Promise<void> {
  if (!hasConfiguredDatabase()) {
    assertStorageConfigured();
    inMemoryState = cloneState(state);
    return;
  }
  await verifyMainSchema();
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

      // PRESERVAR conversas do Baileys (prefixo 'conv-baileys-') — elas são gerenciadas diretamente pelo Baileys
      // Deletar apenas conversas legadas (sem prefixo 'conv-baileys-')
      // Sincronização normal é somente upsert. Ausência em memória nunca implica exclusão.

      for (const client of state.clients) {
        await connection.execute("INSERT INTO megadesk_domain_clients (client_id, internal_id, tenant_database_name, company, contact, email, phone, cnpj, plan, max_users, status, status_type, access_released, api_token, modules_json, integrations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE company=VALUES(company), contact=VALUES(contact), email=VALUES(email), phone=VALUES(phone), cnpj=VALUES(cnpj), plan=VALUES(plan), max_users=VALUES(max_users), status=VALUES(status), status_type=VALUES(status_type), access_released=VALUES(access_released), api_token=VALUES(api_token), modules_json=VALUES(modules_json), integrations_json=VALUES(integrations_json)", [client.clientId, client.id, client.tenantDatabaseName, client.company, client.contact, client.email || null, client.phone, client.cnpj || null, client.plan, client.maxUsers || 5, client.status, client.statusType || "test", client.accessReleased ? 1 : 0, client.apiToken, JSON.stringify(client.modules ?? []), JSON.stringify(client.integrations ?? {})]);
        for (const user of client.users ?? []) {
          // CAMADA 1: Prioridade do hash: (1) hash em memória, (2) hash salvo no banco, (3) null
          // Isso garante que um restart do servidor nunca apague o hash existente no banco
          const memHash = (user as any).passwordHash ?? null;
          const dbHash = passwordHashMap.get(user.id) ?? null;
          const passwordHash = memHash ?? dbHash;
          // CAMADA 2: ON DUPLICATE KEY UPDATE usa COALESCE para nunca sobrescrever hash existente com null
          // Se o novo valor for null, mantém o valor atual do banco
          await connection.execute(
            "INSERT INTO megadesk_domain_client_users (user_id, client_id, name, email, role, status, permissions_json, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), role=VALUES(role), status=VALUES(status), permissions_json=VALUES(permissions_json), password_hash=COALESCE(VALUES(password_hash), password_hash)",
            [user.id, client.clientId, user.name, user.email, user.role, user.status, JSON.stringify(user.permissions ?? []), passwordHash]
          );
        }
      }
      for (const conversation of state.conversations) {
        // Pular conversas do Baileys (prefixo 'conv-baileys-') — elas são gerenciadas diretamente pelo Baileys
        // e não devem ser sobrescritas pelo estado em memória (que pode estar desatualizado)
        if (conversation.id && String(conversation.id).startsWith('conv-baileys-')) continue;
        await upsertConversationStateSnapshot(connection, conversation);
      }
      // Tickets/Chamados são criados via createTicket, não via saveMegaDeskStructuredState
      // Pular inserção de tickets aqui para evitar conflito com tabela megadesk_domain_chamados
      for (const script of state.botScripts) {
        const scriptClientId = script.clientId ?? state.clients[0]?.clientId ?? "cliente-demo-001";
		if (typeof script.systemPrompt !== "string" || !script.systemPrompt.trim()) {
			throw new Error("SYSTEM_PROMPT_REQUIRED: use o repositório canônico de bot scripts.");
		}
        await connection.execute("INSERT INTO megadesk_domain_bot_scripts (script_id, client_id, name, description, system_prompt, initial_message, active) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE client_id=VALUES(client_id), name=VALUES(name), description=VALUES(description), system_prompt=VALUES(system_prompt), initial_message=VALUES(initial_message), active=VALUES(active)", [script.id, scriptClientId, script.name, script.description, script.systemPrompt, script.initialMessage, script.active ? 1 : 0]);
      }
      for (const record of state.operationalRecords) {
        await connection.execute("INSERT INTO megadesk_domain_operational_records (record_id, client_id, tenant_database_name, record_type, owner_phone, title, status, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title=VALUES(title), status=VALUES(status), payload_json=VALUES(payload_json)", [record.id, record.clientId, record.tenantDatabaseName, record.type, record.ownerPhone, record.title, record.status, JSON.stringify(record.payload ?? {})]);
      }
      for (const audit of state.auditLogs) {
        await connection.execute("INSERT INTO megadesk_domain_audit_logs (audit_id, platform, action, client_id, success) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE action=VALUES(action), success=VALUES(success)", [audit.id, audit.platform, audit.action, audit.clientId ?? null, audit.success == null ? null : audit.success ? 1 : 0]);
      }
      for (const client of state.clients) {
        await connection.execute("INSERT INTO megadesk_domain_metrics (client_id, metric_type, amount, source, metadata_json) VALUES (?, ?, ?, ?, ?)", [client.clientId, "conversations", state.conversations.filter((conversation) => conversation.clientId === client.clientId).length, "sync", JSON.stringify({ tenantDatabaseName: client.tenantDatabaseName })]);
        await connection.execute("INSERT INTO megadesk_domain_metrics (client_id, metric_type, amount, source, metadata_json) VALUES (?, ?, ?, ?, ?)", [client.clientId, "tickets", state.tickets.filter((ticket) => ticket.clientId === client.clientId).length, "sync", JSON.stringify({ tenantDatabaseName: client.tenantDatabaseName })]);
      }
      // CAMADA 3: Verificação de integridade antes do commit
      // Detecta usuários ativos sem hash e loga alerta para investigação imediata
      const [orphanRows] = await connection.execute(
        "SELECT user_id FROM megadesk_domain_client_users WHERE (password_hash IS NULL OR password_hash = '') AND status = 'active' LIMIT 10"
      );
      const orphans = orphanRows as any[];
      if (orphans.length > 0) {
        console.error(
          `[MegaDesk CRITICAL] ${orphans.length} usuário(s) ativo(s) sem passwordHash após save.`
        );
        // Auto-corrigir: bloquear usuários sem hash (devem redefinir senha)
        for (const orphan of orphans) {
          await connection.execute(
            "UPDATE megadesk_domain_client_users SET status = 'blocked' WHERE user_id = ? AND (password_hash IS NULL OR password_hash = '')",
            [orphan.user_id]
          );
          console.warn("[MegaDesk] Usuário bloqueado por ausência de senha; redefinição administrativa necessária.");
        }
      }
      await cacheStateAfterSuccessfulPersistence(state, () => connection.commit());
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
}

export async function recordMegaDeskMetric(clientId: string, metricType: string, amount = 1, metadata: Record<string, unknown> = {}, source = "runtime") {
  if (!hasConfiguredDatabase()) return;
  try {
    await ensureStructuredTables();
    await getPool().execute("INSERT INTO megadesk_domain_metrics (client_id, metric_type, amount, source, metadata_json) VALUES (?, ?, ?, ?, ?)", [clientId, metricType, amount, source, JSON.stringify(metadata)]);
  } catch (error) {
    console.warn("[MegaDesk Sync] Falha ao registrar métrica estruturada.", error);
  }
}

export async function validateMegaDeskClientToken(clientId: string, apiToken: string) {
  if (!hasConfiguredDatabase()) return null;
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
  if (!hasConfiguredDatabase()) return { metrics: [], auditLogs: [], botScripts: [] };
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
      auditLogs: (auditRows as any[]).map((row) => ({ sourcePlatform: row.platform, action: row.action, success: row.success == null ? null : Boolean(row.success), createdAt: row.created_at })),
      botScripts: (scriptRows as any[]).map((row) => ({ id: row.script_id, name: row.name, description: row.description, initialMessage: row.initial_message, active: Boolean(row.active) })),
    };
  } catch (error) {
    console.warn("[MegaDesk Sync] Falha ao consultar observabilidade por tenant.", error);
    return { metrics: [], auditLogs: [], botScripts: [] };
  }
}

export async function updateConversationStatus(clientId: string, conversationId: string, status: "open" | "bot" | "closed") {
  const now = new Date().toISOString().slice(0,19).replace('T',' ');
  await getDb().update(megadeskDomainConversations)
    .set({ status, updatedAt: now })
    .where(and(eq(megadeskDomainConversations.conversationId, conversationId), eq(megadeskDomainConversations.clientId, clientId)));
}

export async function updateCustomer(input: {
  customerId: string;
  clientId: string;
  name?: string;
  company?: string;
}) {
  const now = new Date().toISOString().slice(0,19).replace('T',' ');
  const updates: any = { updatedAt: now };
  if (input.name) updates.name = input.name;
  if (input.company) updates.company = input.company;
  
  await getDb().update(megadeskDomainCustomers)
    .set(updates)
    .where(and(
      eq(megadeskDomainCustomers.customerId, input.customerId),
      eq(megadeskDomainCustomers.clientId, input.clientId)
    ));
}


/**
 * Criar backup automático de todos os dados de clientes
 */
export async function createMegaDeskBackup(state: MegaDeskStructuredState) {
  if (!hasConfiguredDatabase()) return null;
  try {
    await ensureStructuredTables();
    const pool = getPool();
    const backupId = `backup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const backupDate = new Date().toISOString().split('T')[0];
    
    const connection = await pool.getConnection();
    try {
      await connection.execute(
        `INSERT INTO megadesk_domain_backups (
          backup_id, backup_date, clients_json, conversations_json, tickets_json, 
          bot_scripts_json, operational_records_json, audit_logs_json, 
          total_clients, total_conversations, total_tickets, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          backupId,
          backupDate,
          JSON.stringify(state.clients),
          JSON.stringify(state.conversations),
          JSON.stringify(state.tickets),
          JSON.stringify(state.botScripts),
          JSON.stringify(state.operationalRecords),
          JSON.stringify(state.auditLogs),
          state.clients.length,
          state.conversations.length,
          state.tickets.length,
          'success'
        ]
      );
      connection.release();
      console.log(`[MegaDesk Backup] Backup criado com sucesso: ${backupId}`);
      return backupId;
    } catch (error) {
      connection.release();
      console.error(`[MegaDesk Backup] Erro ao criar backup:`, error);
      throw error;
    }
  } catch (error) {
    console.warn("[MegaDesk Backup] Falha ao criar backup estruturado.", error);
    return null;
  }
}

/**
 * Listar backups disponíveis
 */
export async function listMegaDeskBackups(limit = 30) {
  if (!hasConfiguredDatabase()) return [];
  try {
    await ensureStructuredTables();
    const [rows] = await getPool().execute(
      `SELECT backup_id, backup_date, backup_timestamp, total_clients, total_conversations, 
              total_tickets, status, created_at FROM megadesk_domain_backups 
       ORDER BY backup_timestamp DESC LIMIT ?`,
      [limit]
    );
    return (rows as any[]).map(row => ({
      backupId: row.backup_id,
      backupDate: row.backup_date,
      backupTimestamp: row.backup_timestamp,
      totalClients: row.total_clients,
      totalConversations: row.total_conversations,
      totalTickets: row.total_tickets,
      status: row.status,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.warn("[MegaDesk Backup] Falha ao listar backups.", error);
    return [];
  }
}

/**
 * Recuperar dados de um backup específico
 */
export async function restoreMegaDeskBackup(backupId: string): Promise<MegaDeskStructuredState | null> {
  if (!hasConfiguredDatabase()) return null;
  try {
    await ensureStructuredTables();
    const [rows] = await getPool().execute(
      `SELECT clients_json, conversations_json, tickets_json, bot_scripts_json, 
              operational_records_json, audit_logs_json FROM megadesk_domain_backups 
       WHERE backup_id = ? LIMIT 1`,
      [backupId]
    );
    
    const backup = (rows as any[])[0];
    if (!backup) return null;

    return {
      clients: JSON.parse(backup.clients_json || '[]'),
      conversations: JSON.parse(backup.conversations_json || '[]'),
      tickets: JSON.parse(backup.tickets_json || '[]'),
      botScripts: JSON.parse(backup.bot_scripts_json || '[]'),
      operationalRecords: JSON.parse(backup.operational_records_json || '[]'),
      auditLogs: JSON.parse(backup.audit_logs_json || '[]')
    };
  } catch (error) {
    console.warn("[MegaDesk Backup] Falha ao restaurar backup.", error);
    return null;
  }
}

/**
 * Aplicar backup restaurado ao estado em memória e banco de dados
 */
export async function applyMegaDeskBackup(backupId: string) {
  const restoredState = await restoreMegaDeskBackup(backupId);
  if (!restoredState) return false;

  try {
    // Atualizar estado em memória
    inMemoryState = restoredState;
    
    // Persistir no banco
    await saveMegaDeskStructuredState(restoredState);
    
    console.log(`[MegaDesk Backup] Backup ${backupId} aplicado com sucesso`);
    return true;
  } catch (error) {
    console.error(`[MegaDesk Backup] Erro ao aplicar backup:`, error);
    return false;
  }
}

/**
 * Limpar backups antigos (retenção de 30 dias por padrão)
 */
export async function cleanupOldBackups(retentionDays = 30) {
  if (!hasConfiguredDatabase()) return 0;
  try {
    await ensureStructuredTables();
    const cutoffDateObj = new Date();
    cutoffDateObj.setDate(cutoffDateObj.getDate() - retentionDays);
    const cutoffDate = cutoffDateObj.toISOString().split('T')[0];
    
    const [result] = await getPool().execute(
      `DELETE FROM megadesk_domain_backups WHERE backup_date < ?`,
      [cutoffDate]
    );
    
    const deletedCount = (result as any).affectedRows || 0;
    console.log(`[MegaDesk Backup] ${deletedCount} backups antigos removidos`);
    return deletedCount;
  } catch (error) {
    console.warn("[MegaDesk Backup] Falha ao limpar backups antigos.", error);
    return 0;
  }
}

/**
 * Obter informações de um backup específico
 */
export async function getMegaDeskBackupInfo(backupId: string) {
  if (!hasConfiguredDatabase()) return null;
  try {
    await ensureStructuredTables();
    const [rows] = await getPool().execute(
      `SELECT backup_id, backup_date, backup_timestamp, total_clients, total_conversations, 
              total_tickets, status, error_message, created_at FROM megadesk_domain_backups 
       WHERE backup_id = ? LIMIT 1`,
      [backupId]
    );
    
    const backup = (rows as any[])[0];
    if (!backup) return null;

    return {
      backupId: backup.backup_id,
      backupDate: backup.backup_date,
      backupTimestamp: backup.backup_timestamp,
      totalClients: backup.total_clients,
      totalConversations: backup.total_conversations,
      totalTickets: backup.total_tickets,
      status: backup.status,
      errorMessage: backup.error_message,
      createdAt: backup.created_at
    };
  } catch (error) {
    console.warn("[MegaDesk Backup] Falha ao obter informações do backup.", error);
    return null;
  }
}

/** Exclusão física do registro principal está bloqueada pelo servidor. */
export async function deleteClientFromDb(_clientId: string): Promise<never> {
  throw new Error("Exclusão física de tenant bloqueada: use a quarentena recuperável.");
}

/** Defers DATABASE_URL access until the first actual database operation. */
export function createLazyDatabase<T extends object>(initialize: () => T): T {
  let instance: T | undefined;
  const getInstance = () => (instance ??= initialize());
  return new Proxy(Object.create(null) as T, {
    get(_target, property) {
      if (typeof property === "symbol") return undefined;
      const database = getInstance();
      const value = Reflect.get(database, property);
      return typeof value === "function" ? value.bind(database) : value;
    },
  });
}

/** Defers DATABASE_URL access until the first actual database operation. */
export function getLazyDb(): Database {
  return createLazyDatabase(getDb);
}
