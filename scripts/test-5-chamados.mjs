#!/usr/bin/env node

/**
 * Script de Teste: Abrir 5 Chamados Reais
 * Testa a criação de chamados via API tRPC
 */

const API_URL = process.env.API_URL || 'http://localhost:3000/api/trpc';
const CLIENT_ID = process.env.CLIENT_ID || 'test-client-' + Date.now();

console.log('🚀 Iniciando teste de 5 chamados reais...\n');
console.log(`📍 API URL: ${API_URL}`);
console.log(`👤 Client ID: ${CLIENT_ID}\n`);

const chamadosData = [
  {
    customerId: 'cust-001',
    customerName: 'João Silva',
    company: 'Empresa XYZ Ltda',
    title: 'Sistema de login não funciona',
    observations: 'Erro 500 ao tentar fazer login. Afeta todos os usuários.',
    priority: 'critica',
  },
  {
    customerId: 'cust-002',
    customerName: 'Maria Santos',
    company: 'Consultoria ABC',
    title: 'Relatório de vendas com erro',
    observations: 'Números não batem com o período anterior',
    priority: 'alta',
  },
  {
    customerId: 'cust-003',
    customerName: 'Pedro Costa',
    company: 'Indústria DEF',
    title: 'Integração com sistema ERP',
    observations: 'Precisa conectar com SAP para sincronizar dados',
    priority: 'media',
  },
  {
    customerId: 'cust-001',
    customerName: 'João Silva',
    company: 'Empresa XYZ Ltda',
    title: 'Backup automático não está funcionando',
    observations: 'Última execução foi há 5 dias',
    priority: 'alta',
  },
  {
    customerId: 'cust-004',
    customerName: 'Ana Oliveira',
    company: 'Startup Tech',
    title: 'Configurar autenticação de dois fatores',
    observations: 'Implementar 2FA para aumentar segurança',
    priority: 'media',
  },
];

async function criarChamado(dados) {
  try {
    const response = await fetch(`${API_URL}/chamados.create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        json: {
          customerId: dados.customerId,
          customerName: dados.customerName,
          company: dados.company,
          title: dados.title,
          observations: dados.observations,
          priority: dados.priority,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Erro ao criar chamado: ${response.status}`);
      console.error(`   ${error}\n`);
      return null;
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`❌ Erro na requisição: ${error.message}\n`);
    return null;
  }
}

async function listarChamados() {
  try {
    const response = await fetch(`${API_URL}/chamados.list?json={"status":"total","limit":10,"offset":0}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`❌ Erro ao listar chamados: ${response.status}\n`);
      return null;
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`❌ Erro na requisição: ${error.message}\n`);
    return null;
  }
}

async function main() {
  console.log('📝 Criando 5 chamados...\n');

  const chamadosCriados = [];

  for (let i = 0; i < chamadosData.length; i++) {
    const dados = chamadosData[i];
    console.log(`[${i + 1}/5] Criando: ${dados.title}`);
    console.log(`    Cliente: ${dados.customerName} (${dados.company})`);
    console.log(`    Prioridade: ${dados.priority}`);

    const resultado = await criarChamado(dados);

    if (resultado) {
      chamadosCriados.push(resultado);
      console.log(`    ✅ Criado com sucesso\n`);
    } else {
      console.log(`    ⚠️  Falha ao criar\n`);
    }

    // Pequeno delay entre requisições
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n📊 Resumo da Criação:');
  console.log(`   Total criados: ${chamadosCriados.length}/5\n`);

  // Listar chamados criados
  console.log('📋 Listando chamados...\n');
  const listaResult = await listarChamados();

  if (listaResult && listaResult.result && listaResult.result.data) {
    const chamados = listaResult.result.data.json.chamados;
    console.log(`Total de chamados no sistema: ${chamados.length}\n`);

    if (chamados.length > 0) {
      console.log('Últimos 5 chamados:');
      for (let i = 0; i < Math.min(5, chamados.length); i++) {
        const c = chamados[i];
        console.log(`\n  #${String(c.number).padStart(4, '0')} - ${c.title}`);
        console.log(`    Cliente: ${c.customerName} (${c.company})`);
        console.log(`    Status: ${c.status}`);
        console.log(`    Prioridade: ${c.priority}`);
        console.log(`    Criado em: ${new Date(c.createdAt).toLocaleString('pt-BR')}`);
        console.log(`    Atividades: ${c.activities.length}`);
      }
    }
  }

  console.log('\n✨ Teste concluído!\n');
}

main().catch(console.error);
