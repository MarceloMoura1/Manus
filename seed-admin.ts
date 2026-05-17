import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { adminCredentials } from "./drizzle/schema";
import bcrypt from "bcryptjs";

async function seedAdmin() {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL não configurada. Verifique as variáveis de ambiente.");
    }

    const pool = mysql.createPool(url);
    const db = drizzle(pool);

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
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao criar admin:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

seedAdmin();
