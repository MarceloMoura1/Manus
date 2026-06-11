/**
 * Script de Debug - Verificar Resposta da API
 */

const BASE_URL = 'http://localhost:3000';
const TRPC_URL = `${BASE_URL}/api/trpc`;

async function debugAPI() {
  console.log('🔍 Debugando resposta da API tRPC...\n');

  try {
    const response = await fetch(`${TRPC_URL}/chamados.create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        json: {
          customerName: 'Teste Debug',
          company: 'Empresa Teste',
          title: 'Título Teste',
          observations: 'Observações teste',
          priority: 'media',
        },
      }),
    });

    console.log('📊 Status HTTP:', response.status);
    console.log('📋 Headers:');
    for (const [key, value] of response.headers.entries()) {
      console.log(`   ${key}: ${value}`);
    }

    const data = await response.json();
    console.log('\n📦 Resposta JSON (completa):');
    console.log(JSON.stringify(data, null, 2));

    console.log('\n🔍 Estrutura da resposta:');
    console.log('   data:', typeof data);
    console.log('   data.result:', typeof data.result);
    console.log('   data.result?.data:', typeof data.result?.data);
    console.log('   data.result?.data?.chamado:', typeof data.result?.data?.chamado);
    
    if (data.error) {
      console.log('\n❌ Erro na resposta:');
      console.log('   Código:', data.error.code);
      console.log('   Mensagem:', data.error.message);
      console.log('   Dados:', data.error.data);
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

debugAPI();
