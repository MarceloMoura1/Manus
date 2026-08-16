/**
 * seed-admin.mjs
 * Cria o administrador mestre do MegaDesk (MegaAdmin).
 * Tabela: megaadmin_credentials
 *
 * Uso:
 *   node seed-admin.mjs
 *   ou com variáveis customizadas:
 *   ADMIN_EMAIL=outro@email.com ADMIN_PASSWORD=outraSenha node seed-admin.mjs
 */
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { pathToFileURL } from "node:url";

export function validateLocalDatabaseUrl(value) {
  if (!value) throw new Error("DATABASE_URL is required.");
  const parsed = new URL(value);
  if (parsed.protocol !== "mysql:") throw new Error("DATABASE_URL must use mysql:.");
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("Bootstrap is restricted to the authorized local database.");
  if ((parsed.port || "3306") !== "3308" || decodeURIComponent(parsed.pathname.slice(1)) !== "megadesk_local") {
    throw new Error("Bootstrap is restricted to 127.0.0.1:3308/megadesk_local.");
  }
  return value;
}

export function validateAdminInput(environment) {
  const email = environment.ADMIN_EMAIL?.trim().toLowerCase();
  const password = environment.ADMIN_PASSWORD;
  const name = environment.ADMIN_NAME?.trim() || "Administrador";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ADMIN_EMAIL is required and must be valid.");
  if (!password) throw new Error("ADMIN_PASSWORD is required.");
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error("ADMIN_PASSWORD must have at least 12 characters, upper/lowercase letters, a number and a symbol.");
  }
  return { email, password, name };
}

export async function bootstrapAdmin(environment = process.env) {
  const databaseUrl = validateLocalDatabaseUrl(environment.DATABASE_URL);
  const { email, password, name } = validateAdminInput(environment);
  const passwordHash = await bcrypt.hash(password, 12);
  const pool = mysql.createPool(databaseUrl);
  try {
    await pool.execute(
      `INSERT INTO megaadmin_credentials (email, name, password_hash, active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), active = 1`,
      [email, name, passwordHash],
    );
  } finally {
    await pool.end();
  }
  console.log("MegaAdmin bootstrap completed for exactly one account.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  bootstrapAdmin().catch((error) => {
    console.error(error instanceof Error ? error.message : "MegaAdmin bootstrap failed.");
    process.exitCode = 1;
  });
}
