/**
 * Script de Teste - Abertura de 5 Chamados Diferentes
 * 
 * Este script testa a funcionalidade de criar chamados através da API tRPC
 * Simula 5 cenários diferentes de criação de chamado
 */

// Usar fetch nativo do Node.js 18+

// Configuração
const BASE_URL = 'http://localhost:3000/api/trpc';
const CLIENT_ID = 'test-client-' + Date.now();

// Dados de teste para 5 chamados diferentes
const chamadosTest = [
  {
    id: 1,
    customerName: 'João Silva',
    company: 'Empresa XYZ Ltda',
    title: 'Sistema de login não funciona',
    observations: 'Erro 500 ao tentar fazer login. Afeta todos os usuários.',
    priority: 'critica',
  },
  {
    id: 2,
    customerName: 'Maria Santos',
    company: 'Consultoria ABC',
    title: 'Relatório de vendas com erro',
    observations: 'Números não batem com o período anterior',
    priority: 'alta',
  },
  {
    id: 3,
    customerName: 'Pedro Costa',
    company: 'Indústria DEF',
    title: 'Integração com sistema ERP',
    observations: 'Precisa conectar com SAP para sincronizar dados',
    priority: 'media',
  },
  {
    id: 4,
    customerName: 'João Silva',
    company: 'Empresa XYZ Ltda',
    title: 'Backup automático não está funcionando',
    observations: 'Última execução foi há 5 dias',
    priority: 'alta',
  },
  {
    id: 5,
    customerName: 'Ana Oliveira',
    company: 'Startup Tech',
    title: 'Configurar autenticação de dois fatores',
    observations: 'Implementar 2FA para aumentar segurança',
    priority: 'media',
  },
];

/**
 * Fazer requisição para criar chamado
 */
async function criarChamado(chamado) {
  console.log(`\n📝 Teste ${chamado.id}: Criando chamado para ${chamado.customerName}`);
  console.log(`   Empresa: ${chamado.company}`);
  console.log(`   Título: ${chamado.title}`);
  console.log(`   Prioridade: ${chamado.priority}`);

  try {
    const response = await fetch(`${BASE_URL}/chamados.create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        json: {
          customerName: chamado.customerName,
          company: chamado.company,
          title: chamado.title,
          observations: chamado.observations,
          priority: chamado.priority,
        },
      }),
    });

    const data = await response.json();

    if (response.ok && data.result && data.result.data) {
      console.log(`   ✅ SUCESSO! Chamado criado com ID: ${data.result.data.chamado.id}`);
      console.log(`   Número do chamado: ${data.result.data.chamado.chamadoNumber}`);
      return { success: true, chamado: data.result.data.chamado };
    } else if (data.error) {
      console.error(`   ❌ ERRO: ${data.error.message}`);
      console.error(`   Código: ${data.error.code}`);
      if (data.error.data) {
        console.error(`   Detalhes: ${JSON.stringify(data.error.data)}`);
      }
      return { success: false, error: data.error };
    } else {
      console.error(`   ❌ ERRO: Resposta inesperada`);
      console.error(`   Status: ${response.status}`);
      console.error(`   Resposta: ${JSON.stringify(data)}`);
      return { success: false, error: data };
    }
  } catch (error) {
    console.error(`   ❌ ERRO DE CONEXÃO: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Executar testes
 */
async function executarTestes() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 TESTE DE ABERTURA DE CHAMADOS - 5 CENÁRIOS DIFERENTES');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n⏱️  Iniciando testes em ${new Date().toLocaleString('pt-BR')}`);
  console.log(`🔑 Client ID: ${CLIENT_ID}`);

  const resultados = [];
  let sucessos = 0;
  let falhas = 0;

  // Executar testes sequencialmente
  for (const chamado of chamadosTest) {
    const resultado = await criarChamado(chamado);
    resultados.push(resultado);

    if (resultado.success) {
      sucessos++;
    } else {
      falhas++;
    }

    // Aguardar 500ms entre requisições
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Resumo dos testes
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 RESUMO DOS TESTES');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`✅ Sucessos: ${sucessos}/${chamadosTest.length}`);
  console.log(`❌ Falhas: ${falhas}/${chamadosTest.length}`);
  console.log(`📈 Taxa de sucesso: ${((sucessos / chamadosTest.length) * 100).toFixed(1)}%`);

  // Detalhes dos sucessos
  if (sucessos > 0) {
    console.log('\n✅ CHAMADOS CRIADOS COM SUCESSO:');
    resultados.forEach((r, i) => {
      if (r.success) {
        console.log(`   ${i + 1}. Chamado #${r.chamado.chamadoNumber} - ${chamadosTest[i].title}`);
      }
    });
  }

  // Detalhes das falhas
  if (falhas > 0) {
    console.log('\n❌ CHAMADOS COM ERRO:');
    resultados.forEach((r, i) => {
      if (!r.success) {
        console.log(`   ${i + 1}. ${chamadosTest[i].title}`);
        console.log(`      Erro: ${r.error.message || r.error}`);
      }
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`⏱️  Testes finalizados em ${new Date().toLocaleString('pt-BR')}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  return { sucessos, falhas, resultados };
}

// Executar
executarTestes().catch(error => {
  console.error('❌ ERRO FATAL:', error);
  process.exit(1);
});
