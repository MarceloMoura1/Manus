/**
 * Gerenciador de Bancos de Dados por Tenant
 * Responsável por criar, gerenciar e rotear conexões para bancos de clientes isolados
 */

import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";

interface TenantDatabaseConfig {
  clientId: string;
  databaseName: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

interface TenantConnection {
  pool: mysql.Pool;
  db: ReturnType<typeof drizzle>;
  config: TenantDatabaseConfig;
}

// Cache de conexões por tenant
const tenantConnections = new Map<string, TenantConnection>();

/**
 * Gera nome de banco de dados seguro para o tenant
 */
export function generateTenantDatabaseName(clientId: string): string {
  // Formato: mdsk_[clientId]_[timestamp]
  // Exemplo: mdsk_cliente_001_1715000000
  const sanitized = clientId.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const timestamp = Math.floor(Date.now() / 1000);
  return `mdsk_${sanitized}_${timestamp}`.substring(0, 64); // MySQL limit
}

/**
 * Extrai credenciais do DATABASE_URL
 */
function parseDatabaseUrl(url: string) {
  const urlObj = new URL(url);
  return {
    host: urlObj.hostname || "localhost",
    port: parseInt(urlObj.port || "3306"),
    user: urlObj.username || "root",
    password: urlObj.password || "",
    database: urlObj.pathname?.slice(1) || "megadesk",
  };
}

/**
 * Cria um novo banco de dados para um tenant
 */
export async function createTenantDatabase(clientId: string): Promise<string> {
  try {
    const mainDbUrl = process.env.DATABASE_URL;
    if (!mainDbUrl) throw new Error("DATABASE_URL não configurada");

    const credentials = parseDatabaseUrl(mainDbUrl);
    const databaseName = generateTenantDatabaseName(clientId);

    // Conecta ao servidor MySQL (sem banco específico)
    const adminPool = mysql.createPool({
      host: credentials.host,
      port: credentials.port,
      user: credentials.user,
      password: credentials.password,
      waitForConnections: true,
      connectionLimit: 1,
      queueLimit: 0,
    });

    const connection = await adminPool.getConnection();

    try {
      // Cria o banco de dados
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );

      console.log(`✅ Banco de dados criado: ${databaseName}`);

      // Executa o schema no novo banco
      await initializeTenantSchema(databaseName, credentials);

      return databaseName;
    } finally {
      await connection.release();
      await adminPool.end();
    }
  } catch (error) {
    console.error("❌ Erro ao criar banco de dados do tenant:", error);
    throw error;
  }
}

/**
 * Inicializa o schema no banco de dados do tenant
 */
async function initializeTenantSchema(
  databaseName: string,
  credentials: ReturnType<typeof parseDatabaseUrl>
): Promise<void> {
  const pool = mysql.createPool({
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    password: credentials.password,
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
  });

  const connection = await pool.getConnection();

  try {
    // SQL para criar tabelas do tenant
    const schema = `
      CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(80) PRIMARY KEY,
        customer_name VARCHAR(180) NOT NULL,
        phone VARCHAR(40) NOT NULL,
        status ENUM('open', 'bot', 'closed') NOT NULL DEFAULT 'open',
        channel VARCHAR(40) NOT NULL DEFAULT 'whatsapp',
        last_message LONGTEXT NOT NULL,
        messages LONGTEXT NOT NULL,
        assigned_agent VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_conversations_status (status),
        INDEX idx_conversations_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS tickets (
        id VARCHAR(80) PRIMARY KEY,
        ticket_code VARCHAR(40) NOT NULL UNIQUE,
        customer_name VARCHAR(180) NOT NULL,
        category ENUM('venda', 'suporte', 'financeiro', 'reclamacao', 'duvida', 'agendamento', 'pos_venda') NOT NULL,
        status ENUM('aberto', 'em_progresso', 'aguardando_cliente', 'resolvido') NOT NULL DEFAULT 'aberto',
        summary LONGTEXT NOT NULL,
        description LONGTEXT NOT NULL,
        assigned_agent VARCHAR(255),
        priority ENUM('baixa', 'media', 'alta', 'urgente') NOT NULL DEFAULT 'media',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tickets_status (status),
        INDEX idx_tickets_category (category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS bot_scripts (
        id VARCHAR(80) PRIMARY KEY,
        name VARCHAR(180) NOT NULL,
        description LONGTEXT NOT NULL,
        initial_message LONGTEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT FALSE,
        training_data LONGTEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bot_scripts_active (active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS operational_records (
        id VARCHAR(80) PRIMARY KEY,
        type ENUM('conversation', 'ticket', 'tracking', 'erp') NOT NULL,
        owner_phone VARCHAR(40) NOT NULL,
        title VARCHAR(255) NOT NULL,
        status VARCHAR(80) NOT NULL,
        payload LONGTEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_operational_records_type (type),
        INDEX idx_operational_records_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(80) PRIMARY KEY,
        name VARCHAR(180) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        role ENUM('admin', 'manager', 'agent', 'viewer') NOT NULL DEFAULT 'viewer',
        status ENUM('active', 'blocked') NOT NULL DEFAULT 'blocked',
        permissions LONGTEXT,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_users_email (email),
        INDEX idx_users_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS integrations (
        id VARCHAR(80) PRIMARY KEY,
        type VARCHAR(80) NOT NULL,
        name VARCHAR(180) NOT NULL,
        credentials LONGTEXT,
        active BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_integrations_type (type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(100) PRIMARY KEY,
        action VARCHAR(255) NOT NULL,
        user_id VARCHAR(80),
        user_email VARCHAR(255),
        details LONGTEXT,
        success BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_logs_user (user_id),
        INDEX idx_audit_logs_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    // Executa cada comando SQL
    const statements = schema.split(";").filter((s) => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await connection.query(statement);
      }
    }

    console.log(`✅ Schema inicializado em: ${databaseName}`);
  } finally {
    await connection.release();
    await pool.end();
  }
}

/**
 * Obtém conexão para um tenant (cria se não existir)
 */
export async function getTenantConnection(clientId: string, databaseName: string): Promise<TenantConnection> {
  // Verifica cache
  if (tenantConnections.has(clientId)) {
    return tenantConnections.get(clientId)!;
  }

  try {
    const mainDbUrl = process.env.DATABASE_URL;
    if (!mainDbUrl) throw new Error("DATABASE_URL não configurada");

    const credentials = parseDatabaseUrl(mainDbUrl);

    // Cria pool para o banco do tenant
    const pool = mysql.createPool({
      host: credentials.host,
      port: credentials.port,
      user: credentials.user,
      password: credentials.password,
      database: databaseName,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 10,
    });

    const db = drizzle(pool);

    const connection: TenantConnection = {
      pool,
      db,
      config: {
        clientId,
        databaseName,
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password,
      },
    };

    // Armazena em cache
    tenantConnections.set(clientId, connection);

    return connection;
  } catch (error) {
    console.error(`❌ Erro ao conectar ao banco do tenant ${clientId}:`, error);
    throw error;
  }
}

/**
 * Limpa cache de conexões (útil para testes)
 */
export function clearTenantConnections(): void {
  tenantConnections.forEach((conn) => {
    conn.pool.end().catch((err) => console.error("Erro ao fechar pool:", err));
  });
  tenantConnections.clear();
}

/**
 * Lista todos os bancos de dados de tenants
 */
export async function listTenantDatabases(): Promise<string[]> {
  try {
    const mainDbUrl = process.env.DATABASE_URL;
    if (!mainDbUrl) throw new Error("DATABASE_URL não configurada");

    const credentials = parseDatabaseUrl(mainDbUrl);
    const adminPool = mysql.createPool({
      host: credentials.host,
      port: credentials.port,
      user: credentials.user,
      password: credentials.password,
      waitForConnections: true,
      connectionLimit: 1,
      queueLimit: 0,
    });

    const connection = await adminPool.getConnection();

    try {
      const [rows] = await connection.query(
        "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME LIKE 'mdsk_%'"
      );
      const databases = (rows as any[]).map((row) => row.SCHEMA_NAME);
      return databases;
    } finally {
      await connection.release();
      await adminPool.end();
    }
  } catch (error) {
    console.error("❌ Erro ao listar bancos de dados:", error);
    return [];
  }
}

/**
 * Deleta banco de dados de um tenant (com cuidado!)
 */
export async function deleteTenantDatabase(databaseName: string): Promise<void> {
  try {
    const mainDbUrl = process.env.DATABASE_URL;
    if (!mainDbUrl) throw new Error("DATABASE_URL não configurada");

    const credentials = parseDatabaseUrl(mainDbUrl);
    const adminPool = mysql.createPool({
      host: credentials.host,
      port: credentials.port,
      user: credentials.user,
      password: credentials.password,
      waitForConnections: true,
      connectionLimit: 1,
      queueLimit: 0,
    });

    const connection = await adminPool.getConnection();

    try {
      await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      console.log(`✅ Banco de dados deletado: ${databaseName}`);

      // Remove do cache
      for (const [clientId, conn] of tenantConnections.entries()) {
        if (conn.config.databaseName === databaseName) {
          await conn.pool.end();
          tenantConnections.delete(clientId);
        }
      }
    } finally {
      await connection.release();
      await adminPool.end();
    }
  } catch (error) {
    console.error("❌ Erro ao deletar banco de dados:", error);
    throw error;
  }
}
