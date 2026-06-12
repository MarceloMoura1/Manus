/**
 * seed-admin.ts
 * Cria o administrador mestre do MegaDesk (MegaAdmin).
 * Tabela: megaadmin_credentials
 *
 * Uso:
 *   npx tsx seed-admin.ts
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { megaadminCredentials } from "./drizzle/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const EMAIL    = process.env.ADMIN_EMAIL    ?? "marcelo.mouraadmpro@gmail.com";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "MegaDesk@123";
const NAME     = process.env.ADMIN_NAME     ?? "Marcelo Moura";

async function seedAdmin() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL não definida. Configure o .env");
    process.exit(1);
  }

  const pool = mysql.createPool(process.env.DATABASE_URL);
  const db = drizzle(pool);

  try {
    const existing = await db.select({ id: megaadminCredentials.id })
      .from(megaadminCredentials)
      .where(eq(megaadminCredentials.email, EMAIL.toLowerCase().trim()))
      .limit(1);

    const passwordHash = await bcrypt.hash(PASSWORD, 12);

    if (existing.length > 0) {
      await db.update(megaadminCredentials)
        .set({ passwordHash, name: NAME.trim(), active: 1 })
        .where(eq(megaadminCredentials.email, EMAIL.toLowerCase().trim()));
      console.log("✅ Admin atualizado!");
    } else {
      await (db.insert(megaadminCredentials) as any).values({
        email: EMAIL.toLowerCase().trim(),
        name: NAME.trim(),
        passwordHash,
        active: 1,
      });
      console.log("✅ Admin criado!");
    }

    console.log(`   Email: ${EMAIL}`);
    console.log(`   Senha: ${PASSWORD}`);
    console.log(`   URL:   http://localhost:3000/admin`);
    await pool.end();
  } catch (err: any) {
    console.error("❌ Erro:", err.message);
    process.exit(1);
  }
}

seedAdmin();
