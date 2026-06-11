/**
 * Script de Diagnóstico de Performance V2
 * Usa o cliente tRPC correto para medir performance
 */

import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

// Criar cliente tRPC
const trpc = createTRPCProxyClient({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/api/trpc',
      transformer: superjson,
      headers: {
        // Usar token de teste se necessário
        'Authorization': 'Bearer test-token',
      },
    }),
  ],
});

async function measureCall(label, fn) {
  const startTime = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - startTime;
    
    const statusColor = duration > 1000 ? colors.red : duration > 500 ? colors.yellow : colors.green;
    log(statusColor, `✓ ${label}: ${duration.toFixed(2)}ms`);
    return { success: true, duration, result };
  } catch (error) {
    const duration = performance.now() - startTime;
    log(colors.red, `✗ ${label}: ${error.message} (${duration.toFixed(2)}ms)`);
    return { success: false, duration, error: error.message };
  }
}

async function runDiagnostics() {
  log(colors.cyan, '\n═══════════════════════════════════════════════════════════');
  log(colors.cyan, '🔍 DIAGNÓSTICO DE PERFORMANCE V2 - MEGADESK');
  log(colors.cyan, '═══════════════════════════════════════════════════════════\n');

  const results = [];

  // Teste 1: Listar chamados (sem filtro)
  log(colors.blue, '📊 Teste 1: Listar Chamados (10 itens)');
  let result = await measureCall('chamados.list (10)', () =>
    trpc.chamados.list.query({
      limit: 10,
      offset: 0,
    })
  );
  results.push({ name: 'chamados.list (10)', ...result });

  // Teste 2: Listar chamados com paginação maior
  log(colors.blue, '\n📊 Teste 2: Listar Chamados (50 itens)');
  result = await measureCall('chamados.list (50)', () =>
    trpc.chamados.list.query({
      limit: 50,
      offset: 0,
    })
  );
  results.push({ name: 'chamados.list (50)', ...result });

  // Teste 3: Listar chamados com filtro
  log(colors.blue, '\n📊 Teste 3: Listar Chamados (com filtro)');
  result = await measureCall('chamados.list (filtro)', () =>
    trpc.chamados.list.query({
      status: 'open',
      limit: 10,
      offset: 0,
    })
  );
  results.push({ name: 'chamados.list (filtro)', ...result });

  // Teste 4: Criar chamado
  log(colors.blue, '\n📊 Teste 4: Criar Chamado');
  result = await measureCall('chamados.create', () =>
    trpc.chamados.create.mutate({
      customerName: 'Teste Performance',
      company: 'Empresa Teste',
      title: 'Teste de Performance',
      observations: 'Teste',
      priority: 'media',
    })
  );
  results.push({ name: 'chamados.create', ...result });

  // Teste 5: Obter detalhes
  if (result.success && result.result?.chamado?.id) {
    const chamadoId = result.result.chamado.id;
    log(colors.blue, '\n📊 Teste 5: Obter Detalhes de Chamado');
    result = await measureCall('chamados.getDetail', () =>
      trpc.chamados.getDetail.query({
        chamadoId,
      })
    );
    results.push({ name: 'chamados.getDetail', ...result });
  }

  // Resumo
  log(colors.cyan, '\n═══════════════════════════════════════════════════════════');
  log(colors.cyan, '📈 RESUMO DE PERFORMANCE');
  log(colors.cyan, '═══════════════════════════════════════════════════════════\n');

  const successResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);

  if (successResults.length > 0) {
    log(colors.green, `✓ Sucessos: ${successResults.length}/${results.length}`);
    
    const avgDuration = successResults.reduce((sum, r) => sum + r.duration, 0) / successResults.length;
    const maxDuration = Math.max(...successResults.map(r => r.duration));
    const minDuration = Math.min(...successResults.map(r => r.duration));

    log(colors.cyan, `  Tempo médio: ${avgDuration.toFixed(2)}ms`);
    log(colors.cyan, `  Tempo máximo: ${maxDuration.toFixed(2)}ms`);
    log(colors.cyan, `  Tempo mínimo: ${minDuration.toFixed(2)}ms`);
  }

  if (failedResults.length > 0) {
    log(colors.red, `\n✗ Falhas: ${failedResults.length}/${results.length}`);
    failedResults.forEach(r => {
      log(colors.red, `  - ${r.name}: ${r.error}`);
    });
  }

  // Análise
  log(colors.cyan, '\n═══════════════════════════════════════════════════════════');
  log(colors.cyan, '💡 ANÁLISE E RECOMENDAÇÕES');
  log(colors.cyan, '═══════════════════════════════════════════════════════════\n');

  const slowResults = successResults.filter(r => r.duration > 1000);
  const mediumResults = successResults.filter(r => r.duration > 500 && r.duration <= 1000);
  const fastResults = successResults.filter(r => r.duration <= 500);

  if (slowResults.length > 0) {
    log(colors.red, '🔴 APIs MUITO LENTAS (> 1000ms):');
    slowResults.forEach(r => {
      log(colors.red, `   - ${r.name}: ${r.duration.toFixed(2)}ms`);
      log(colors.red, `     → Implementar cache, paginação ou índices no banco`);
    });
  }

  if (mediumResults.length > 0) {
    log(colors.yellow, '\n🟡 APIs MODERADAMENTE LENTAS (500-1000ms):');
    mediumResults.forEach(r => {
      log(colors.yellow, `   - ${r.name}: ${r.duration.toFixed(2)}ms`);
      log(colors.yellow, `     → Considerar otimização`);
    });
  }

  if (fastResults.length > 0) {
    log(colors.green, '\n🟢 APIs RÁPIDAS (< 500ms):');
    fastResults.forEach(r => {
      log(colors.green, `   - ${r.name}: ${r.duration.toFixed(2)}ms`);
    });
  }

  log(colors.cyan, '\n═══════════════════════════════════════════════════════════\n');
}

runDiagnostics().catch(error => {
  log(colors.red, `❌ ERRO FATAL: ${error.message}`);
  console.error(error);
  process.exit(1);
});
