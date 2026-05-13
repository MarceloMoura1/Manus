import { drizzle } from "drizzle-orm/mysql2";
import { adminCredentials } from "./drizzle/schema.js";
import bcrypt from "bcryptjs";

const db = drizzle(process.env.DATABASE_URL);

async function seedAdmin() {
  try {
    const email = "marcelo.mouraadmpro@gmail.com";
    const name = "Marcelo Moura";
    const password = "123456";

    // Hash da senha
    const passwordHash = await bcrypt.hash(password, 12);

    // Inserir admin
    await db.insert(adminCredentials).values({
      email: email.toLowerCase().trim(),
      name: name.trim(),
      passwordHash,
      active: true,
    });

    console.log("✅ Admin mestre criado com sucesso!");
    console.log(`📧 Email: ${email}`);
    console.log(`🔐 Senha: ${password}`);
    console.log(`✨ Você pode fazer login em: /admin`);
  } catch (error) {
    console.error("❌ Erro ao criar admin:", error.message);
    process.exit(1);
  }
}

seedAdmin();
