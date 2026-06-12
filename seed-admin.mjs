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
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { megaadminCredentials } from "./drizzle/schema.js";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL não definida no ambiente.");
  console.error("   cp .env.example .env  →  edite DATABASE_URL");
  process.exit(1);
}

// Credenciais padrão do MegaAdmin (podem ser sobrescritas por env vars)
const EMAIL    = process.env.ADMIN_EMAIL    ?? "marcelo.mouraadmpro@gmail.com";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "MegaDesk@123";
const NAME     = process.env.ADMIN_NAME     ?? "Marcelo Moura";

async function seedAdmin() {
  const pool = await mysql.createPool(process.env.DATABASE_URL);
  const db = drizzle(pool);

  try {
    // Verificar se já existe
    const existing = await db.select({ id: megaadminCredentials.id })
      .from(megaadminCredentials)
      .where(eq(megaadminCredentials.email, EMAIL.toLowerCase().trim()))
      .limit(1);

    const passwordHash = await bcrypt.hash(PASSWORD, 12);

    if (existing.length > 0) {
      // Atualizar senha se já existir
      await db.update(megaadminCredentials)
        .set({ passwordHash, name: NAME.trim(), active: 1 })
        .where(eq(megaadminCredentials.email, EMAIL.toLowerCase().trim()));
      console.log("✅ Admin atualizado com sucesso!");
    } else {
      // Criar novo
      await db.insert(megaadminCredentials).values({
        email: EMAIL.toLowerCase().trim(),
        name: NAME.trim(),
        passwordHash,
        active: 1,
      });
      console.log("✅ Admin criado com sucesso!");
    }

    console.log(`   Email: ${EMAIL}`);
    console.log(`   Senha: ${PASSWORD}`);
    console.log(`   Acesse: https://admin.megadesk.online`);
    console.log(`   Local:  http://localhost:3000/admin`);
  } catch (err) {
    console.error("❌ Erro:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedAdmin();
