import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.TIDB_HOST,
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE,
});

try {
  const connection = await pool.getConnection();
  const [rows] = await connection.execute("SHOW TABLES LIKE 'megadesk_domain_chamados'");
  connection.release();
  
  if (rows.length > 0) {
    console.log("✅ Tabela megadesk_domain_chamados EXISTE no banco de dados");
  } else {
    console.log("❌ Tabela megadesk_domain_chamados NÃO EXISTE no banco de dados");
  }
  process.exit(0);
} catch (err) {
  console.error("❌ Erro ao verificar tabela:", err.message);
  process.exit(1);
}
