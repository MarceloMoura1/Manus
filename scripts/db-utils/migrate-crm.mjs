import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não configurada.");
  process.exit(1);
}

const pool = mysql.createPool(url);

const sql = `
CREATE TABLE IF NOT EXISTS \`megadesk_crm_clients\` (
  \`crm_client_id\` varchar(80) NOT NULL,
  \`client_id\` varchar(80) NOT NULL,
  \`company_name\` varchar(255) NOT NULL,
  \`responsible_name\` varchar(180) NOT NULL DEFAULT '',
  \`cpf_cnpj\` varchar(20) NOT NULL DEFAULT '',
  \`phone\` varchar(40) NOT NULL DEFAULT '',
  \`whatsapp\` varchar(40) NOT NULL DEFAULT '',
  \`email\` varchar(255) NOT NULL DEFAULT '',
  \`address\` varchar(255) NOT NULL DEFAULT '',
  \`city\` varchar(120) NOT NULL DEFAULT '',
  \`state\` varchar(2) NOT NULL DEFAULT '',
  \`cep\` varchar(10) NOT NULL DEFAULT '',
  \`status\` enum('lead','ativo','inativo','cancelado','inadimplente') NOT NULL DEFAULT 'lead',
  \`origin\` enum('whatsapp','instagram','facebook','site','indicacao','outro') NOT NULL DEFAULT 'outro',
  \`internal_responsible\` varchar(180) NOT NULL DEFAULT '',
  \`tags\` text,
  \`observations\` text,
  \`last_interaction_at\` timestamp NULL,
  \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`crm_client_id\`),
  INDEX \`idx_mcc_client\` (\`client_id\`),
  INDEX \`idx_mcc_status\` (\`status\`),
  INDEX \`idx_mcc_company\` (\`company_name\`),
  INDEX \`idx_mcc_phone\` (\`phone\`)
)
`;

try {
  const conn = await pool.getConnection();
  await conn.execute(sql);
  conn.release();
  console.log("✅ Tabela megadesk_crm_clients criada com sucesso!");
} catch (err) {
  console.error("❌ Erro ao criar tabela:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
