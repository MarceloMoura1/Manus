/**
 * seed-admin.ts
 * Cria o administrador mestre do MegaDesk.
 *
 * Uso:
 *   ADMIN_EMAIL=seu@email.com ADMIN_PASSWORD=suaSenha npx tsx seed-admin.ts
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { megaadminCredentials } from "./drizzle/schema";
import bcrypt from "bcryptjs";

async function seedAdmin() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ DATABASE_URL não configurada. Defina no .env");
    process.exit(1);
  }

  const email = process.env.ADMIN_EMAIL || process.argv[2];
  const password = process.env.ADMIN_PASSWORD || process.argv[3];
  const name = process.env.ADMIN_NAME || "Administrador";

  if (!email || !password) {
    console.error("❌ Informe email e senha:");
    console.error("   ADMIN_EMAIL=eu@email.com ADMIN_PASSWORD=MinhaSenha npx tsx seed-admin.ts");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌ A senha deve ter pelo menos 8 caracteres.");
    process.exit(1);
  }

  try {
    const pool = mysql.createPool(dbUrl);
    const db = drizzle(pool);
    const passwordHash = await bcrypt.hash(password, 12);

    await db.insert(megaadminCredentials).values({
      email: email.toLowerCase().trim(),
      name: name.trim(),
      passwordHash,
      active: true,
    });

    console.log("✅ Admin criado com sucesso!");
    console.log(`   Email: ${email}`);
    console.log(`   Acesse: /admin`);
    await pool.end();
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      console.error("❌ Já existe um admin com esse email.");
    } else {
      console.error("❌ Erro:", error.message);
    }
    process.exit(1);
  }
}

seedAdmin();
