/**
 * seed-admin.mjs
 * Cria o administrador mestre do MegaDesk.
 *
 * Uso:
 *   ADMIN_EMAIL=seu@email.com ADMIN_PASSWORD=suaSenha node seed-admin.mjs
 *
 * Se as variáveis não forem definidas, usa valores dos argumentos de linha de comando.
 */
import { drizzle } from "drizzle-orm/mysql2";
import { megaadminCredentials } from "./drizzle/schema.js";
import bcrypt from "bcryptjs";

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL não definida no ambiente.");
  process.exit(1);
}

const db = drizzle(process.env.DATABASE_URL);

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || process.argv[2];
  const password = process.env.ADMIN_PASSWORD || process.argv[3];
  const name = process.env.ADMIN_NAME || "Administrador";

  if (!email || !password) {
    console.error("❌ Informe email e senha:");
    console.error("   ADMIN_EMAIL=eu@email.com ADMIN_PASSWORD=MinhaSenha node seed-admin.mjs");
    console.error("   ou: node seed-admin.mjs eu@email.com MinhaSenha");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌ A senha deve ter pelo menos 8 caracteres.");
    process.exit(1);
  }

  try {
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
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      console.error("❌ Já existe um admin com esse email.");
    } else {
      console.error("❌ Erro:", error.message);
    }
    process.exit(1);
  }
}

seedAdmin();
