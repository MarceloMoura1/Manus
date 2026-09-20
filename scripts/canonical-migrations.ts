import { MAIN_MIGRATIONS_DIR, TENANT_MIGRATIONS_DIR, applyCanonicalMigrations, validateCanonicalMigrationFolder } from "../server/_core/canonical-migrations";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} é obrigatória.`);
  return value;
}

function databaseNameFromUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "mysql:") throw new Error("Somente URLs mysql: são aceitas.");
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (!name) throw new Error("A URL deve apontar para um banco explícito.");
  return name;
}

function runtimeMainDatabaseUrl(): string {
  // The updater launches this process through Node's --env-file using the
  // canonical RuntimeConfigRoot. DATABASE_URL is the established runtime
  // setting; MAIN_DATABASE_URL remains accepted for explicitly isolated jobs.
  return process.env.DATABASE_URL || process.env.MAIN_DATABASE_URL || required("DATABASE_URL");
}

async function verifyRuntimeMainConnection(): Promise<void> {
  const url = runtimeMainDatabaseUrl();
  const expectedDatabase = databaseNameFromUrl(url);
  if (expectedDatabase !== "megadesk_local") throw new Error("Runtime config nao aponta para o MAIN esperado.");
  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool(url);
  try {
    const [rows] = await pool.query<Array<{ databaseName: string | null }>>("SELECT DATABASE() AS databaseName");
    if (rows.length !== 1 || rows[0].databaseName !== expectedDatabase) throw new Error("Conexao runtime nao confirmou o MAIN esperado.");
  } finally {
    await pool.end();
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "check-main") {
    validateCanonicalMigrationFolder(MAIN_MIGRATIONS_DIR);
    return;
  }
  if (command === "check-tenant") {
    validateCanonicalMigrationFolder(TENANT_MIGRATIONS_DIR);
    return;
  }
  if (command === "apply-main") {
    if (required("ALLOW_MAIN_MIGRATION") !== "1") throw new Error("ALLOW_MAIN_MIGRATION deve ser exatamente 1.");
    const url = runtimeMainDatabaseUrl();
    if (databaseNameFromUrl(url) !== "megadesk_local") throw new Error("Migration MAIN exige megadesk_local.");
    await applyCanonicalMigrations(url, MAIN_MIGRATIONS_DIR);
    return;
  }
  if (command === "verify-main-runtime") {
    await verifyRuntimeMainConnection();
    return;
  }
  if (command === "apply-tenant") {
    throw new Error("TENANT_PHYSICAL_ISOLATION_NOT_OPERATIONAL: migrations tenant não podem ser aplicadas nesta fase.");
  }
  throw new Error("Comando inválido. Use check-main, check-tenant ou apply-main.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Falha na operação de migration.");
  process.exitCode = 1;
});
