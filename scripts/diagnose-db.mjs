#!/usr/bin/env node

/**
 * Script de Diagnóstico do Banco de Dados de Chamados
 * Verifica integridade, estrutura e dados persistidos
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import {
  megadeskDomainChamados,
  megadeskDomainChamadoActivities,
  megadeskDomainChamadoSequence,
  users,
} from '../drizzle/schema';
import { sql } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL não configurada');
  process.exit(1);
}

async function diagnose() {
  console.log('🔍 Iniciando diagnóstico do banco de dados...\n');

  try {
    // Conectar ao banco
    const connection = await mysql.createConnection(DATABASE_URL);
    const db = drizzle(connection);

    // 1. Verificar tabelas
    console.log('📋 1. VERIFICANDO TABELAS');
    console.log('=' .repeat(60));

    const tables = await connection.query(`
      SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME LIKE 'megadesk%'
      ORDER BY TABLE_NAME
    `);

    console.log(`Total de tabelas MegaDesk: ${tables[0].length}\n`);
    for (const table of tables[0]) {
      console.log(`  📊 ${table.TABLE_NAME}`);
      console.log(`     Registros: ${table.TABLE_ROWS}`);
      console.log(`     Tamanho: ${(table.DATA_LENGTH / 1024).toFixed(2)} KB\n`);
    }

    // 2. Verificar estrutura de chamados
    console.log('\n📐 2. ESTRUTURA DA TABELA megadesk_domain_chamados');
    console.log('=' .repeat(60));

    const chamadosSchema = await connection.query(`
      DESCRIBE megadesk_domain_chamados
    `);

    for (const col of chamadosSchema[0]) {
      console.log(`  ${col.Field.padEnd(20)} | ${col.Type.padEnd(20)} | ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
    }

    // 3. Contar registros por tabela
    console.log('\n📈 3. CONTAGEM DE REGISTROS');
    console.log('=' .repeat(60));

    const chamadosCount = await db.select({ count: sql`COUNT(*)` }).from(megadeskDomainChamados);
    const activitiesCount = await db.select({ count: sql`COUNT(*)` }).from(megadeskDomainChamadoActivities);
    const sequenceCount = await db.select({ count: sql`COUNT(*)` }).from(megadeskDomainChamadoSequence);

    console.log(`  Chamados: ${chamadosCount[0].count}`);
    console.log(`  Atividades: ${activitiesCount[0].count}`);
    console.log(`  Sequências: ${sequenceCount[0].count}\n`);

    // 4. Listar últimos 5 chamados
    console.log('\n📝 4. ÚLTIMOS 5 CHAMADOS');
    console.log('=' .repeat(60));

    const recentChamados = await db
      .select()
      .from(megadeskDomainChamados)
      .orderBy(sql`createdAt DESC`)
      .limit(5);

    if (recentChamados.length === 0) {
      console.log('  ⚠️  Nenhum chamado encontrado\n');
    } else {
      for (const chamado of recentChamados) {
        console.log(`\n  #${String(chamado.chamadoNumber).padStart(4, '0')} - ${chamado.title}`);
        console.log(`    Cliente: ${chamado.clientId}`);
        console.log(`    Status: ${chamado.status}`);
        console.log(`    Prioridade: ${chamado.priority}`);
        console.log(`    Criado em: ${chamado.createdAt.toLocaleString('pt-BR')}`);
        console.log(`    Atendente: ${chamado.assignedTo || 'Não atribuído'}`);
      }
    }

    // 5. Verificar atividades
    console.log('\n\n🔗 5. ATIVIDADES DOS ÚLTIMOS CHAMADOS');
    console.log('=' .repeat(60));

    for (const chamado of recentChamados.slice(0, 3)) {
      const activities = await db
        .select()
        .from(megadeskDomainChamadoActivities)
        .where(sql`chamadoId = ${chamado.chamadoId}`)
        .orderBy(sql`createdAt DESC`)
        .limit(3);

      console.log(`\n  Chamado #${String(chamado.chamadoNumber).padStart(4, '0')}:`);
      if (activities.length === 0) {
        console.log(`    ⚠️  Sem atividades`);
      } else {
        for (const activity of activities) {
          console.log(`    • ${activity.description}`);
          console.log(`      Atendente: ${activity.attendant} | ${activity.createdAt.toLocaleString('pt-BR')}`);
        }
      }
    }

    // 6. Verificar sequências
    console.log('\n\n🔢 6. SEQUÊNCIAS DE CHAMADOS');
    console.log('=' .repeat(60));

    const sequences = await db.select().from(megadeskDomainChamadoSequence);
    if (sequences.length === 0) {
      console.log('  ⚠️  Nenhuma sequência encontrada\n');
    } else {
      for (const seq of sequences) {
        console.log(`  Cliente ${seq.clientId}: Próximo chamado #${seq.nextChamadoNumber}\n`);
      }
    }

    // 7. Verificar integridade referencial
    console.log('\n🔐 7. INTEGRIDADE REFERENCIAL');
    console.log('=' .repeat(60));

    const orphanActivities = await connection.query(`
      SELECT COUNT(*) as count FROM megadesk_domain_chamado_activities a
      WHERE NOT EXISTS (
        SELECT 1 FROM megadesk_domain_chamados c 
        WHERE c.chamadoId = a.chamadoId
      )
    `);

    const orphanCount = orphanActivities[0][0].count;
    if (orphanCount === 0) {
      console.log('  ✅ Nenhuma atividade órfã encontrada\n');
    } else {
      console.log(`  ⚠️  ${orphanCount} atividades órfãs encontradas\n`);
    }

    // 8. Verificar índices
    console.log('\n📑 8. ÍNDICES');
    console.log('=' .repeat(60));

    const indexes = await connection.query(`
      SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'megadesk_domain_chamados'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `);

    const indexMap = new Map();
    for (const idx of indexes[0]) {
      if (!indexMap.has(idx.INDEX_NAME)) {
        indexMap.set(idx.INDEX_NAME, []);
      }
      indexMap.get(idx.INDEX_NAME).push(idx.COLUMN_NAME);
    }

    for (const [indexName, columns] of indexMap) {
      console.log(`  ${indexName}: ${columns.join(', ')}`);
    }

    // 9. Estatísticas de performance
    console.log('\n\n⚡ 9. ESTATÍSTICAS DE PERFORMANCE');
    console.log('=' .repeat(60));

    const stats = await connection.query(`
      SELECT 
        COUNT(*) as total_chamados,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as abertos,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as em_progresso,
        COUNT(CASE WHEN status = 'waiting' THEN 1 END) as aguardando,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as fechados
      FROM megadesk_domain_chamados
    `);

    const stat = stats[0][0];
    console.log(`  Total de chamados: ${stat.total_chamados}`);
    console.log(`  Abertos: ${stat.abertos}`);
    console.log(`  Em progresso: ${stat.em_progresso}`);
    console.log(`  Aguardando: ${stat.aguardando}`);
    console.log(`  Fechados: ${stat.fechados}\n`);

    // 10. Resumo de saúde
    console.log('\n✅ 10. RESUMO DE SAÚDE');
    console.log('=' .repeat(60));

    const health = {
      tabelas: tables[0].length > 0 ? '✅' : '❌',
      registros: chamadosCount[0].count > 0 ? '✅' : '⚠️ ',
      integridade: orphanCount === 0 ? '✅' : '❌',
      indices: indexMap.size > 0 ? '✅' : '⚠️ ',
    };

    console.log(`  Tabelas: ${health.tabelas}`);
    console.log(`  Registros: ${health.registros}`);
    console.log(`  Integridade: ${health.integridade}`);
    console.log(`  Índices: ${health.indices}\n`);

    await connection.end();
    console.log('✨ Diagnóstico concluído!\n');

  } catch (error) {
    console.error('❌ Erro durante diagnóstico:', error.message);
    process.exit(1);
  }
}

diagnose();
