/**
 * Script de Diagnóstico de Performance
 * Mede o tempo de resposta das APIs e identifica gargalos
 */

const BASE_URL = 'http://localhost:3000/api/trpc';

// Cores para output
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

async function measureAPI(procedurePath, input, label, isQuery = false) {
  const startTime = performance.now();
  
  try {
    // Queries usam GET, mutations usam POST
    const method = isQuery ? 'GET' : 'POST';
    const url = isQuery 
      ? `${BASE_URL}/${procedurePath}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${BASE_URL}/${procedurePath}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      ...(method === 'POST' && {
        body: JSON.stringify({
          json: input,
        }),
      }),
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    const data = await response.json();
    
    if (response.ok) {
      const statusColor = duration > 1000 ? colors.red : duration > 500 ? colors.yellow : colors.green;
      log(statusColor, `✓ ${label}: ${duration.toFixed(2)}ms`);
      return { success: true, duration, data };
    } else {
      log(colors.red, `✗ ${label}: ERRO ${response.status} - ${duration.toFixed(2)}ms`);
      return { success: false, duration, error: data.error };
    }
  } catch (error) {
    const endTime = performance.now();
    const duration = endTime - startTime;
    log(colors.red, `✗ ${label}: ERRO DE CONEXÃO - ${duration.toFixed(2)}ms`);
    return { success: false, duration, error: error.message };
  }
}

async function runDiagnostics() {
  log(colors.cyan, '\n═══════════════════════════════════════════════════════════');
  log(colors.cyan, '🔍 DIAGNÓSTICO DE PERFORMANCE - MEGADESK');
  log(colors.cyan, '═══════════════════════════════════════════════════════════\n');

  const results = [];

  // Teste 1: Listar chamados (sem filtro)
  log(colors.blue, '📊 Teste 1: Listar Chamados (sem filtro)');
  let result = await measureAPI('chamados.list', {
    limit: 10,
    offset: 0,
  }, 'chamados.list (10 itens)', true);
  results.push({ name: 'chamados.list (10)', ...result });

  // Teste 2: Listar chamados com paginação maior
  log(colors.blue, '\n📊 Teste 2: Listar Chamados (50 itens)');
  result = await measureAPI('chamados.list', {
    limit: 50,
    offset: 0,
  }, 'chamados.list (50 itens)', true);
  results.push({ name: 'chamados.list (50)', ...result });

  // Teste 3: Listar chamados com filtro de status
  log(colors.blue, '\n📊 Teste 3: Listar Chamados (com filtro)');
  result = await measureAPI('chamados.list', {
    status: 'open',
    limit: 10,
    offset: 0,
  }, 'chamados.list (filtro: open)', true);
  results.push({ name: 'chamados.list (filtro)', ...result });

  // Teste 4: Criar chamado
  log(colors.blue, '\n📊 Teste 4: Criar Chamado');
  result = await measureAPI('chamados.create', {
    customerName: 'Teste Performance',
    company: 'Empresa Teste',
    title: 'Teste de Performance',
    observations: 'Teste',
    priority: 'media',
  }, 'chamados.create', false);
  results.push({ name: 'chamados.create', ...result });

  // Teste 5: Obter detalhes de chamado
  if (result.success && result.data.result?.data?.json?.chamado?.id) {
    const chamadoId = result.data.result.data.json.chamado.id;
    log(colors.blue, '\n📊 Teste 5: Obter Detalhes de Chamado');
    result = await measureAPI('chamados.getDetail', {
      chamadoId,
    }, 'chamados.getDetail', true);
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

  // Recomendações
  log(colors.cyan, '\n═══════════════════════════════════════════════════════════');
  log(colors.cyan, '💡 RECOMENDAÇÕES');
  log(colors.cyan, '═══════════════════════════════════════════════════════════\n');

  const slowResults = successResults.filter(r => r.duration > 1000);
  const mediumResults = successResults.filter(r => r.duration > 500 && r.duration <= 1000);

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

  if (slowResults.length === 0 && mediumResults.length === 0) {
    log(colors.green, '🟢 TODAS AS APIs ESTÃO RÁPIDAS (< 500ms)');
  }

  log(colors.cyan, '\n═══════════════════════════════════════════════════════════\n');
}

runDiagnostics().catch(error => {
  log(colors.red, `❌ ERRO FATAL: ${error.message}`);
  process.exit(1);
});
