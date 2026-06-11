/**
 * Script para criar tabelas de chamados no banco de dados
 */

import mysql from 'mysql2/promise';

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'megadesk',
};

async function createTables() {
  let connection;
  try {
    console.log('🔌 Conectando ao banco de dados...');
    connection = await mysql.createConnection(config);
    console.log('✅ Conectado!');

    // SQL para criar tabelas
    const sql = `
      -- Criar tabela de sequência de chamados
      CREATE TABLE IF NOT EXISTS \`megadesk_domain_chamado_sequence\` (
        \`clientId\` varchar(80) NOT NULL PRIMARY KEY,
        \`nextChamadoNumber\` int NOT NULL DEFAULT 1,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      -- Criar tabela de chamados
      CREATE TABLE IF NOT EXISTS \`megadesk_domain_chamados\` (
        \`chamadoId\` varchar(80) NOT NULL PRIMARY KEY,
        \`clientId\` varchar(80) NOT NULL,
        \`chamadoNumber\` int NOT NULL UNIQUE,
        \`customerId\` varchar(80) NOT NULL,
        \`customerName\` varchar(180) NOT NULL,
        \`company\` varchar(255) NOT NULL,
        \`title\` varchar(255) NOT NULL,
        \`observations\` text NOT NULL DEFAULT '',
        \`status\` enum('open','in_progress','waiting','closed') NOT NULL DEFAULT 'open',
        \`priority\` enum('baixa','media','alta','critica') NOT NULL DEFAULT 'media',
        \`assignedTo\` varchar(80),
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY \`idx_mdc_client\` (\`clientId\`),
        KEY \`idx_mdc_status\` (\`status\`),
        KEY \`idx_mdc_chamado_number\` (\`chamadoNumber\`),
        KEY \`idx_mdc_priority\` (\`priority\`),
        KEY \`idx_mdc_assigned_to\` (\`assignedTo\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      -- Criar tabela de atividades de chamados
      CREATE TABLE IF NOT EXISTS \`megadesk_domain_chamado_activities\` (
        \`activityId\` varchar(80) NOT NULL PRIMARY KEY,
        \`chamadoId\` varchar(80) NOT NULL,
        \`clientId\` varchar(80) NOT NULL,
        \`description\` text NOT NULL,
        \`attendant\` varchar(180) NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY \`idx_mdca_chamado\` (\`chamadoId\`),
        KEY \`idx_mdca_client\` (\`clientId\`),
        KEY \`idx_mdca_created\` (\`createdAt\`),
        CONSTRAINT \`fk_mdca_chamado\` FOREIGN KEY (\`chamadoId\`) REFERENCES \`megadesk_domain_chamados\` (\`chamadoId\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    // Executar cada comando SQL separadamente
    const commands = sql.split(';').filter(cmd => cmd.trim());
    
    for (const command of commands) {
      if (command.trim()) {
        console.log(`\n📝 Executando: ${command.substring(0, 50)}...`);
        try {
          await connection.execute(command);
          console.log('✅ Sucesso!');
        } catch (error) {
          if (error.code === 'ER_TABLE_EXISTS_ERROR') {
            console.log('⚠️  Tabela já existe');
          } else {
            console.error('❌ Erro:', error.message);
          }
        }
      }
    }

    console.log('\n✅ Tabelas criadas com sucesso!');

  } catch (error) {
    console.error('❌ Erro ao conectar ao banco de dados:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

createTables();
