/**
 * seed-admin.ts
 * Cria o administrador mestre do MegaDesk (MegaAdmin).
 * Tabela: megaadmin_credentials
 *
 * Uso:
 *   npx tsx seed-admin.ts
 */
import { bootstrapAdmin } from "./seed-admin.mjs";

bootstrapAdmin().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "MegaAdmin bootstrap failed.");
  process.exitCode = 1;
});
