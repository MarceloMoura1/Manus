import mysql from "mysql2/promise";

throw new Error("LEGACY_MIGRATION_SCRIPT_DISABLED: use pnpm db:migrate:main.");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não configurada");
  process.exit(1);
}

const pool = mysql.createPool(url);

async function migrate() {
  const conn = await pool.getConnection();
  try {
    console.log("Criando tabela megadesk_company_settings...");
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS megadesk_company_settings (
        setting_id VARCHAR(80) NOT NULL PRIMARY KEY,
        client_id VARCHAR(80) NOT NULL,
        company_name VARCHAR(255) NOT NULL DEFAULT '',
        logo_url TEXT,
        email VARCHAR(255) NOT NULL DEFAULT '',
        phone VARCHAR(40) NOT NULL DEFAULT '',
        whatsapp VARCHAR(40) NOT NULL DEFAULT '',
        address VARCHAR(255) NOT NULL DEFAULT '',
        business_hours TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_mcs_client_id (client_id),
        KEY idx_mcs_client (client_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("✅ Tabela megadesk_company_settings criada com sucesso!");
  } catch (err) {
    console.error("Erro:", err.message);
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate();
