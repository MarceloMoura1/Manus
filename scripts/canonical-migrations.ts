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
  // Production is loaded from the canonical RuntimeConfigRoot. This path never
  // consumes rehearsal input.
  return process.env.DATABASE_URL || process.env.MAIN_DATABASE_URL || required("DATABASE_URL");
}

type MigrationTarget = { url: string; database: string; disposable: boolean };

function resolveMigrationTarget(): MigrationTarget {
  const disposableUrl = process.env.MEGADESK_DISPOSABLE_MIGRATION_TARGET_URL;
  if (!disposableUrl) {
    const url = runtimeMainDatabaseUrl();
    return { url, database: databaseNameFromUrl(url), disposable: false };
  }
  if (process.env.MEGADESK_DISPOSABLE_MIGRATION !== "1") throw new Error("Target descartavel exige opt-in explicito.");
  const database = databaseNameFromUrl(disposableUrl);
  if (!/^megadesk_test_[a-z0-9_]+$/.test(database)) throw new Error("Target descartavel exige banco megadesk_test_ explicito.");
  if (process.env.MEGADESK_MIGRATION_EXPECTED_DATABASE !== database) throw new Error("Identidade do target descartavel nao foi confirmada.");
  return { url: disposableUrl, database, disposable: true };
}

async function verifyMigrationConnection(target: MigrationTarget): Promise<void> {
  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool(target.url);
  try {
    const [rows] = await pool.query<Array<{ databaseName: string | null }>>("SELECT DATABASE() AS databaseName");
    if (rows.length !== 1 || rows[0].databaseName !== target.database) throw new Error("Conexao nao confirmou o banco alvo esperado.");
  } finally {
    await pool.end();
  }
}

async function verifyRuntimeMainConnection(): Promise<void> {
  const target = resolveMigrationTarget();
  if (target.disposable || target.database !== "megadesk_local") throw new Error("Runtime config nao aponta para o MAIN esperado.");
  await verifyMigrationConnection(target);
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
    const target = resolveMigrationTarget();
    if (!target.disposable && target.database !== "megadesk_local") throw new Error("Migration MAIN de producao exige megadesk_local.");
    await applyCanonicalMigrations(target.url, MAIN_MIGRATIONS_DIR);
    return;
  }
  if (command === "verify-main-runtime") {
    await verifyRuntimeMainConnection();
    return;
  }
  if (command === "verify-main-target") {
    const target = resolveMigrationTarget();
    if (!target.disposable) throw new Error("Verificacao de target exige modo descartavel explicito.");
    await verifyMigrationConnection(target);
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
