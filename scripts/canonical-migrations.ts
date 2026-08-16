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
    const url = required("MAIN_DATABASE_URL");
    databaseNameFromUrl(url);
    await applyCanonicalMigrations(url, MAIN_MIGRATIONS_DIR);
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
