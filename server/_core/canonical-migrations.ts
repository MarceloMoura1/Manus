import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const MAIN_MIGRATIONS_DIR = resolve(process.cwd(), "drizzle/main-migrations");
export const TENANT_MIGRATIONS_DIR = resolve(process.cwd(), "drizzle/tenant-migrations");

export const REQUIRED_RUNTIME_MAIN_TABLES = [
  "megadesk_ticket_statuses", "megadesk_crm_timeline", "megadesk_domain_conversations_messages",
  "megadesk_evolution_sessions", "megadesk_domain_ia_conversations",
  "megadesk_domain_ia_conversation_history", "megadesk_ia_token_usage",
  "megadesk_operational_sessions",
  "erp_products", "erp_stock_balances", "erp_stock_movements", "erp_suppliers",
] as const;

export const REQUIRED_RUNTIME_COLUMNS: Record<string, readonly string[]> = {
  megadesk_whatsapp_config: ["configId", "clientId", "phoneNumberId", "accessToken", "connectionStatus"],
  megadesk_domain_bot_scripts: ["script_id", "client_id", "description", "system_prompt"],
  megadesk_domain_conversations_messages: ["message_id", "conversation_id", "status"],
  megadesk_evolution_sessions: ["client_id", "instance_name", "status"],
  megadesk_ia_token_usage: ["id", "client_id", "created_at"],
  megadesk_operational_sessions: ["id", "token_hash", "user_id", "client_id", "expires_at", "revoked_at"],
  erp_products: ["id", "public_id", "client_id", "sku", "cost_price_cents", "minimum_stock", "active"],
  erp_suppliers: ["id", "public_id", "client_id", "legal_name", "person_type", "tax_id", "active", "created_by", "updated_by"],
  erp_stock_balances: ["client_id", "product_id", "quantity", "version"],
  erp_stock_movements: ["public_id", "client_id", "product_id", "type", "quantity", "idempotency_key", "payload_hash", "reversal_of"],
};

function validateStrongCanonicalContract(folder: string, sqlFiles: string[], entries: Array<{ idx?: number; tag?: string }>): void {
  const expected = new Set(entries.map((entry) => `${entry.tag}.sql`));
  const orphan = sqlFiles.filter((file) => !expected.has(file));
  if (orphan.length) throw new Error(`Migration SQL órfã: ${orphan.join(", ")}`);
  entries.forEach((entry, index) => {
    if (entry.idx !== index || !entry.tag) throw new Error("Journal canônico fora de sequência.");
    const snapshot = resolve(folder, `meta/${entry.tag.slice(0, 4)}_snapshot.json`);
    if (!existsSync(snapshot)) throw new Error(`Snapshot esperado ausente: ${snapshot}`);
  });
  const combinedSql = sqlFiles.map((file) => readFileSync(resolve(folder, file), "utf8")).join("\n");
  if (/^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im.test(combinedSql) || /^\s*ALTER\s+TABLE[\s\S]*?\bDROP\b/im.test(combinedSql)) {
    throw new Error("Operação destrutiva proibida na baseline canônica.");
  }
  const matches = [...combinedSql.matchAll(/CREATE\s+TABLE\s+`([^`]+)`\s*\(([\s\S]*?)\);/gi)];
  const names = matches.map((match) => match[1]);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length) throw new Error(`Tabela duplicada: ${[...new Set(duplicates)].join(", ")}`);
  for (const match of matches) if (!/PRIMARY KEY/i.test(match[2])) throw new Error(`Baseline sem primary key: ${match[1]}`);
  const finalTag = entries.at(-1)?.tag;
  if (!finalTag) throw new Error("Journal sem migration final.");
  const snapshot = JSON.parse(readFileSync(resolve(folder, `meta/${finalTag.slice(0, 4)}_snapshot.json`), "utf8")) as { tables?: Record<string, { name?: string }> };
  const snapshotNames = Object.values(snapshot.tables ?? {}).map((table) => table.name).filter((name): name is string => Boolean(name));
  for (const name of names) if (!snapshotNames.includes(name)) throw new Error(`Snapshot divergente; tabela SQL ausente: ${name}`);
  for (const name of snapshotNames) if (!names.includes(name)) throw new Error(`Snapshot divergente; tabela sem SQL: ${name}`);
  if (resolve(folder) !== MAIN_MIGRATIONS_DIR) return;
  for (const table of REQUIRED_RUNTIME_MAIN_TABLES) if (!names.includes(table)) throw new Error(`Tabela runtime omitida: ${table}`);
  for (const [table, columns] of Object.entries(REQUIRED_RUNTIME_COLUMNS)) {
    const definition = matches.find((match) => match[1] === table)?.[2] ?? "";
    for (const column of columns) if (!definition.includes(`\`${column}\``)) throw new Error(`Coluna runtime omitida: ${table}.${column}`);
  }
  if (/CREATE\s+TABLE\s+`?evolution_api/i.test(combinedSql)) throw new Error("Evolution externa não pertence à baseline main.");
  for (const queueTable of ["evolution_failed_messages", "evolution_queue_config", "evolution_queue_metrics", "evolution_retry_history"]) {
    if (names.filter((name) => name === queueTable).length !== 1) throw new Error(`Fila Evolution interna inválida: ${queueTable}`);
  }
  for (const configFile of ["drizzle.config.ts", "drizzle.main.config.ts"]) {
    if (/migrations-backup|drizzle\/meta|LEGACY/i.test(readFileSync(resolve(process.cwd(), configFile), "utf8"))) throw new Error(`Config aponta para cadeia legacy: ${configFile}`);
  }
}

export function validateTenantDatabaseName(databaseName: string): string {
  if (!/^mdsk_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(databaseName)) {
    throw new Error("Nome de banco tenant inválido: esperado mdsk_<identificador>.");
  }
  return databaseName;
}

export function validateCanonicalMigrationFolder(folder: string): string[] {
  const journal = resolve(folder, "meta/_journal.json");
  if (!existsSync(journal)) throw new Error("Journal canônico ausente.");
  const parsed = JSON.parse(readFileSync(journal, "utf8")) as { entries?: Array<{ tag?: string }> };
  const entries = parsed.entries ?? [];
  if (entries.length === 0) throw new Error("Journal canônico não contém baseline.");
  const sqlFiles = readdirSync(folder).filter((name) => name.endsWith(".sql"));
  for (const entry of entries) {
    const expected = `${entry.tag}.sql`;
    if (!sqlFiles.includes(expected)) throw new Error(`Migration esperada ausente: ${expected}`);
  }
  validateStrongCanonicalContract(folder, sqlFiles, entries);
  return sqlFiles.sort();
}

export async function applyCanonicalMigrations(databaseUrl: string, folder: string): Promise<void> {
  validateCanonicalMigrationFolder(folder);
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!databaseName) throw new Error("Migration exige banco explícito.");
  if (resolve(folder) === MAIN_MIGRATIONS_DIR && /^mdsk_/i.test(databaseName)) throw new Error("Baseline main não pode ser aplicada a banco tenant.");
  if (resolve(folder) === TENANT_MIGRATIONS_DIR) validateTenantDatabaseName(databaseName);
  const [{ drizzle }, { migrate }, mysql] = await Promise.all([
    import("drizzle-orm/mysql2"),
    import("drizzle-orm/mysql2/migrator"),
    import("mysql2/promise"),
  ]);
  const pool = mysql.createPool(databaseUrl);
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}
