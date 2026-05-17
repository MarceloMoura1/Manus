import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { users, megadeskDomainCustomers, megadeskDomainTickets, megadeskDomainConversations, megadeskDomainChamados, megadeskDomainChamadoSequence } from "../drizzle/schema";

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
  // Esta funcao nao eh mais usada - usar createChamado de db-chamados.ts em vez disso
  // Mantida para compatibilidade com codigo legado
  const chamadoNumber = Math.floor(Math.random() * 10000) + 1;
  return { ...input, chamadoId: `chamado-${Date.now()}`, chamadoNumber };
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
    "ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS email VARCHAR(255)",
    "ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS cnpj VARCHAR(20)",
    "ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS max_users INT NOT NULL DEFAULT 5",
    "ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS status_type ENUM('active','test') NOT NULL DEFAULT 'test'",
    "ALTER TABLE megadesk_domain_clients ADD COLUMN IF NOT EXISTS integrations_json LONGTEXT NOT NULL",
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
    await pool.execute("ALTER TABLE megadesk_domain_client_users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)");
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
      // IMPORTANTE: Deletar clientes que foram removidos em memória (evita que reapareçam após reiniciar)
      // Primeiro, obter lista de client_ids que ainda existem em memória
      const clientIdsToKeep = state.clients.map((c) => c.clientId);
      if (clientIdsToKeep.length > 0) {
        // Deletar usuários de clientes que não existem mais
        const placeholders = clientIdsToKeep.map(() => "?").join(",");
        await connection.execute(`DELETE FROM megadesk_domain_client_users WHERE client_id NOT IN (${placeholders})`, clientIdsToKeep);
        // Deletar clientes que não existem mais
        await connection.execute(`DELETE FROM megadesk_domain_clients WHERE client_id NOT IN (${placeholders})`, clientIdsToKeep);
      } else {
        // Se não há clientes em memória, deletar todos
        await connection.execute("DELETE FROM megadesk_domain_client_users");
        await connection.execute("DELETE FROM megadesk_domain_clients");
      }

      for (const client of state.clients) {
        await connection.execute("INSERT INTO megadesk_domain_clients (client_id, internal_id, tenant_database_name, company, contact, email, phone, cnpj, plan, max_users, status, status_type, access_released, api_token, modules_json, integrations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE company=VALUES(company), contact=VALUES(contact), email=VALUES(email), phone=VALUES(phone), cnpj=VALUES(cnpj), plan=VALUES(plan), max_users=VALUES(max_users), status=VALUES(status), status_type=VALUES(status_type), access_released=VALUES(access_released), api_token=VALUES(api_token), modules_json=VALUES(modules_json), integrations_json=VALUES(integrations_json)", [client.clientId, client.id, client.tenantDatabaseName, client.company, client.contact, client.email || "", client.phone, client.cnpj || "", client.plan, client.maxUsers || 5, client.status, client.statusType || "test", client.accessReleased ? 1 : 0, client.apiToken, JSON.stringify(client.modules ?? []), JSON.stringify(client.integrations ?? {})]);
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
        await connection.execute("INSERT INTO megadesk_domain_conversations (conversation_id, client_id, customer_name, phone, company, status, last_message, time_label, messages_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [conversation.id, conversation.clientId, conversation.name, conversation.phone, conversation.company, conversation.status, conversation.lastMessage, conversation.time, JSON.stringify(conversation.messages ?? [])]);
      }
      // Tickets/Chamados são criados via createTicket, não via saveMegaDeskStructuredState
      // Pular inserção de tickets aqui para evitar conflito com tabela megadesk_domain_chamados
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

      // CAMADA 3: Verificação de integridade pós-save
      // Detecta usuários ativos sem hash e loga alerta para investigação imediata
      const [orphanRows] = await connection.execute(
        "SELECT user_id, email, client_id FROM megadesk_domain_client_users WHERE (password_hash IS NULL OR password_hash = '') AND status = 'active' LIMIT 10"
      );
      const orphans = orphanRows as any[];
      if (orphans.length > 0) {
        console.error(
          `[MegaDesk CRITICAL] ${orphans.length} usuário(s) ativo(s) sem passwordHash após save:`,
          orphans.map((r: any) => `${r.email} (${r.client_id})`).join(", ")
        );
        // Auto-corrigir: definir senha padrão para usuários sem hash
        const defaultHash = await import("bcryptjs").then((m) => m.hash("123456", 12));
        for (const orphan of orphans) {
          await connection.execute(
            "UPDATE megadesk_domain_client_users SET password_hash = ? WHERE user_id = ? AND (password_hash IS NULL OR password_hash = '')",
            [defaultHash, orphan.user_id]
          );
          console.warn(`[MegaDesk] Senha padrão restaurada automaticamente para: ${orphan.email}`);
        }
      }
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


/**
 * Criar backup automático de todos os dados de clientes
 */
export async function createMegaDeskBackup(state: MegaDeskStructuredState) {
  if (!process.env.DATABASE_URL) return null;
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
  if (!process.env.DATABASE_URL) return [];
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
  if (!process.env.DATABASE_URL) return null;
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
  if (!process.env.DATABASE_URL) return 0;
  try {
    await ensureStructuredTables();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const [result] = await getPool().execute(
      `DELETE FROM megadesk_domain_backups WHERE backup_date < ?`,
      [cutoffDate.toISOString().split('T')[0]]
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
  if (!process.env.DATABASE_URL) return null;
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

/**
 * Deletar cliente diretamente do banco de dados de forma garantida.
 * Esta função deve ser chamada ANTES de remover o cliente da memória,
 * garantindo que mesmo que persistSyncState() falhe, o cliente já foi
 * removido do banco e não reaparecerá após reinicialização do servidor.
 */
export async function deleteClientFromDb(clientId: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await ensureStructuredTables();
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // Deletar usuários do cliente primeiro (FK constraint)
      await connection.execute(
        "DELETE FROM megadesk_domain_client_users WHERE client_id = ?",
        [clientId]
      );
      // Deletar o cliente
      await connection.execute(
        "DELETE FROM megadesk_domain_clients WHERE client_id = ?",
        [clientId]
      );
      await connection.commit();
      console.log(`[MegaDesk] Cliente ${clientId} deletado do banco com sucesso.`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`[MegaDesk] Erro ao deletar cliente ${clientId} do banco:`, error);
    throw error; // Propagar erro para que a procedure possa tratar
  }
}
