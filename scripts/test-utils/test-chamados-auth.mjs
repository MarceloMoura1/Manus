/**
 * Script de Teste - Abertura de 5 Chamados com Autenticação
 * 
 * Este script testa a funcionalidade de criar chamados através da API tRPC
 * Inclui autenticação OAuth e simula 5 cenários diferentes
 */

// Configuração
const BASE_URL = 'http://localhost:3000';
const TRPC_URL = `${BASE_URL}/api/trpc`;

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
 * Fazer requisição tRPC com autenticação
 */
async function fazerRequisicaoTRPC(procedurePath, input, cookies = '') {
  try {
    const response = await fetch(`${TRPC_URL}/${procedurePath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
      },
      body: JSON.stringify({
        json: input,
      }),
    });

    const data = await response.json();
    return { response, data };
  } catch (error) {
    throw error;
  }
}

/**
 * Fazer login e obter cookies
 */
async function fazerLogin() {
  console.log('\n🔐 Tentando fazer login...');

  try {
    // Tentar fazer login com credenciais de teste
    // Nota: Isso depende de como o servidor está configurado
    const response = await fetch(`${BASE_URL}/api/trpc/auth.login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        json: {
          email: 'test@example.com',
          password: 'password123',
        },
      }),
    });

    const data = await response.json();
    
    if (response.ok && data.result && data.result.data) {
      console.log('✅ Login bem-sucedido');
      
      // Extrair cookies da resposta
      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        console.log('✅ Cookie obtido');
        return setCookieHeader;
      }
    } else {
      console.log('⚠️  Login falhou, tentando com autenticação de teste');
      // Tentar sem login (pode funcionar em modo teste)
      return '';
    }
  } catch (error) {
    console.error('❌ Erro ao fazer login:', error.message);
    return '';
  }
}

/**
 * Criar chamado
 */
async function criarChamado(chamado, cookies) {
  console.log(`\n📝 Teste ${chamado.id}: Criando chamado para ${chamado.customerName}`);
  console.log(`   Empresa: ${chamado.company}`);
  console.log(`   Título: ${chamado.title}`);
  console.log(`   Prioridade: ${chamado.priority}`);

  try {
    const { response, data } = await fazerRequisicaoTRPC('chamados.create', {
      customerName: chamado.customerName,
      company: chamado.company,
      title: chamado.title,
      observations: chamado.observations,
      priority: chamado.priority,
    }, cookies);

    console.log(`   Status HTTP: ${response.status}`);

    if (response.ok && data.result && data.result.data && data.result.data.json) {
      const chamado = data.result.data.json.chamado;
      console.log(`   ✅ SUCESSO! Chamado criado`);
      console.log(`   ID: ${chamado.id}`);
      console.log(`   Número: ${chamado.number}`);
      return { success: true, chamado };
    } else if (data.error) {
      console.error(`   ❌ ERRO: ${data.error.message}`);
      console.error(`   Código: ${data.error.code}`);
      if (data.error.data) {
        console.error(`   Detalhes: ${JSON.stringify(data.error.data)}`);
      }
      return { success: false, error: data.error };
    } else {
      console.error(`   ❌ ERRO: Resposta inesperada`);
      console.error(`   Resposta: ${JSON.stringify(data)}`);
      return { success: false, error: data };
    }
  } catch (error) {
    console.error(`   ❌ ERRO DE CONEXÃO: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
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
  console.log(`🌐 URL: ${BASE_URL}`);

  // Fazer login
  const cookies = await fazerLogin();

  const resultados = [];
  let sucessos = 0;
  let falhas = 0;

  // Executar testes sequencialmente
  for (const chamado of chamadosTest) {
    const resultado = await criarChamado(chamado, cookies);
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
        console.log(`   ${i + 1}. Chamado #${r.chamado.number} - ${chamadosTest[i].title}`);
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
