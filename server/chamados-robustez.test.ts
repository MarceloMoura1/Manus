/**
 * Testes de Robustez para Sistema de Chamados
 * Valida validações, sanitização, retry logic e isolamento de tenant
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createChamado,
  getChamadoWithActivities,
  listChamados,
  updateChamado,
  addActivityToChamado,
  editActivity,
  getNextChamadoNumber,
} from './db-chamados';
import { isTestDatabaseEnabled } from './test-integration-gates';
const databaseIntegration = describe.runIf(isTestDatabaseEnabled());

databaseIntegration('Robustez - Validações de Input [database integration]', () => {
  const testClientId = `test-client-${Date.now()}`;

  it('deve rejeitar customerName vazio', async () => {
    expect(async () => {
      await createChamado(testClientId, 'cust-1', '', 'Company', 'Title', '');
    }).rejects.toThrow('customerName não pode estar vazio');
  });

  it('deve rejeitar company vazio', async () => {
    expect(async () => {
      await createChamado(testClientId, 'cust-1', 'John', '', 'Title', '');
    }).rejects.toThrow('company não pode estar vazio');
  });

  it('deve rejeitar title vazio', async () => {
    expect(async () => {
      await createChamado(testClientId, 'cust-1', 'John', 'Company', '', '');
    }).rejects.toThrow('title não pode estar vazio');
  });

  it('deve rejeitar priority inválida', async () => {
    expect(async () => {
      await createChamado(
        testClientId,
        'cust-1',
        'John',
        'Company',
        'Title',
        '',
        'invalida' as any
      );
    }).rejects.toThrow('Prioridade inválida');
  });

  it('deve rejeitar clientId vazio', async () => {
    expect(async () => {
      await createChamado('', 'cust-1', 'John', 'Company', 'Title', '');
    }).rejects.toThrow('clientId não pode estar vazio');
  });

  it('deve rejeitar chamadoId vazio em getChamadoWithActivities', async () => {
    expect(async () => {
      await getChamadoWithActivities('', testClientId);
    }).rejects.toThrow('chamadoId não pode estar vazio');
  });

  it('deve rejeitar description vazia em addActivityToChamado', async () => {
    expect(async () => {
      await addActivityToChamado('chamado-id', testClientId, '', 'attendant');
    }).rejects.toThrow('description não pode estar vazia');
  });

  it('deve rejeitar attendant vazio em addActivityToChamado', async () => {
    expect(async () => {
      await addActivityToChamado('chamado-id', testClientId, 'description', '');
    }).rejects.toThrow('attendant não pode estar vazio');
  });
});

databaseIntegration('Robustez - Sanitização de Strings [database integration]', () => {
  const testClientId = `test-client-${Date.now()}`;

  it('deve sanitizar strings com caracteres de controle', async () => {
    const chamado = await createChamado(
      testClientId,
      'cust-1',
      'John\x00\x01\x02Silva',
      'Company\x1FName',
      'Title\x7F',
      'Obs'
    );

    expect(chamado.customerName).not.toContain('\x00');
    expect(chamado.customerName).not.toContain('\x01');
    expect(chamado.company).not.toContain('\x1F');
    expect(chamado.title).not.toContain('\x7F');
  });

  it('deve truncar strings muito longas', async () => {
    const longString = 'a'.repeat(1000);
    const chamado = await createChamado(
      testClientId,
      'cust-1',
      longString,
      'Company',
      'Title',
      ''
    );

    expect(chamado.customerName.length).toBeLessThanOrEqual(500);
  });

  it('deve truncar observações muito longas', async () => {
    const longObs = 'a'.repeat(3000);
    const chamado = await createChamado(
      testClientId,
      'cust-1',
      'John',
      'Company',
      'Title',
      longObs
    );

    expect(chamado.observations.length).toBeLessThanOrEqual(2000);
  });

  it('deve remover espaços em branco extras', async () => {
    const chamado = await createChamado(
      testClientId,
      'cust-1',
      '  John  Silva  ',
      '  Company  ',
      '  Title  ',
      ''
    );

    expect(chamado.customerName).toBe('John  Silva');
    expect(chamado.company).toBe('Company');
    expect(chamado.title).toBe('Title');
  });
});

databaseIntegration('Robustez - Validação de Status e Prioridade [database integration]', () => {
  const testClientId = `test-client-${Date.now()}`;

  it('deve aceitar status válidos', async () => {
    const validStatuses = ['open', 'in_progress', 'waiting', 'closed'];
    
    for (const status of validStatuses) {
      expect(async () => {
        await updateChamado('chamado-id', testClientId, { status });
      }).not.toThrow();
    }
  });

  it('deve rejeitar status inválidos', async () => {
    expect(async () => {
      await updateChamado('chamado-id', testClientId, { status: 'invalid' as any });
    }).rejects.toThrow();
  });

  it('deve aceitar prioridades válidas', async () => {
    const validPriorities = ['baixa', 'media', 'alta', 'critica'];
    
    for (const priority of validPriorities) {
      const chamado = await createChamado(
        testClientId,
        'cust-1',
        'John',
        'Company',
        'Title',
        '',
        priority as any
      );
      expect(chamado.priority).toBe(priority);
    }
  });
});

databaseIntegration('Robustez - Isolamento de Tenant [database integration]', () => {
  const clientId1 = `client-1-${Date.now()}`;
  const clientId2 = `client-2-${Date.now()}`;

  it('deve isolar chamados por cliente', async () => {
    // Criar chamado para cliente 1
    const chamado1 = await createChamado(
      clientId1,
      'cust-1',
      'John',
      'Company1',
      'Title1',
      ''
    );

    // Criar chamado para cliente 2
    const chamado2 = await createChamado(
      clientId2,
      'cust-2',
      'Jane',
      'Company2',
      'Title2',
      ''
    );

    // Listar chamados do cliente 1
    const list1 = await listChamados(clientId1);
    expect(list1.some(c => c.id === chamado1.id)).toBe(true);
    expect(list1.some(c => c.id === chamado2.id)).toBe(false);

    // Listar chamados do cliente 2
    const list2 = await listChamados(clientId2);
    expect(list2.some(c => c.id === chamado2.id)).toBe(true);
    expect(list2.some(c => c.id === chamado1.id)).toBe(false);
  });

  it('deve rejeitar acesso a chamado de outro cliente', async () => {
    const chamado = await createChamado(
      clientId1,
      'cust-1',
      'John',
      'Company',
      'Title',
      ''
    );

    // Tentar acessar com cliente 2
    const result = await getChamadoWithActivities(chamado.id, clientId2);
    expect(result).toBeNull();
  });

  it('deve rejeitar atualização de chamado de outro cliente', async () => {
    const chamado = await createChamado(
      clientId1,
      'cust-1',
      'John',
      'Company',
      'Title',
      ''
    );

    // Tentar atualizar com cliente 2 (deve não fazer nada)
    await updateChamado(chamado.id, clientId2, { status: 'closed' });

    // Verificar que não foi atualizado
    const updated = await getChamadoWithActivities(chamado.id, clientId1);
    expect(updated?.status).toBe('open');
  });
});

databaseIntegration('Robustez - Sequência de Números [database integration]', () => {
  const testClientId = `test-client-seq-${Date.now()}`;

  it('deve gerar números sequenciais únicos', async () => {
    const chamados = [];
    
    for (let i = 0; i < 5; i++) {
      const chamado = await createChamado(
        testClientId,
        `cust-${i}`,
        `John${i}`,
        `Company${i}`,
        `Title${i}`,
        ''
      );
      chamados.push(chamado);
    }

    // Verificar que números são sequenciais
    const numbers = chamados.map(c => c.number).sort((a, b) => a - b);
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBe(numbers[i - 1] + 1);
    }
  });

  it('deve ter números únicos por cliente', async () => {
    const clientId1 = `client-unique-1-${Date.now()}`;
    const clientId2 = `client-unique-2-${Date.now()}`;

    const chamado1 = await createChamado(clientId1, 'cust-1', 'John', 'Company', 'Title', '');
    const chamado2 = await createChamado(clientId2, 'cust-2', 'Jane', 'Company', 'Title', '');

    // Ambos devem começar em 1
    expect(chamado1.number).toBe(1);
    expect(chamado2.number).toBe(1);
  });
});

databaseIntegration('Robustez - Atividades [database integration]', () => {
  const testClientId = `test-client-activities-${Date.now()}`;

  it('deve adicionar atividades com sanitização', async () => {
    const chamado = await createChamado(
      testClientId,
      'cust-1',
      'John',
      'Company',
      'Title',
      ''
    );

    await addActivityToChamado(
      chamado.id,
      testClientId,
      'Description\x00with\x1Fcontrol\x7Fchars',
      'Attendant\x00Name'
    );

    const updated = await getChamadoWithActivities(chamado.id, testClientId);
    expect(updated?.activities.length).toBe(1);
    expect(updated?.activities[0].description).not.toContain('\x00');
    expect(updated?.activities[0].attendant).not.toContain('\x00');
  });

  it('deve rejeitar edição de atividade com description vazia', async () => {
    expect(async () => {
      await editActivity('activity-id', 'chamado-id', testClientId, '');
    }).rejects.toThrow('description não pode estar vazia');
  });

  it('deve rejeitar edição de atividade de outro cliente', async () => {
    const chamado = await createChamado(
      testClientId,
      'cust-1',
      'John',
      'Company',
      'Title',
      ''
    );

    await addActivityToChamado(chamado.id, testClientId, 'Description', 'Attendant');

    const updated = await getChamadoWithActivities(chamado.id, testClientId);
    const activityId = updated?.activities[0].id;

    // Tentar editar com outro cliente
    expect(async () => {
      await editActivity(activityId!, chamado.id, `other-client-${Date.now()}`, 'New description');
    }).rejects.toThrow('Atividade não encontrada');
  });
});

databaseIntegration('Robustez - Paginação [database integration]', () => {
  const testClientId = `test-client-pagination-${Date.now()}`;

  it('deve validar limit entre 1 e 100', async () => {
    expect(async () => {
      await listChamados(testClientId, undefined, 0, 0);
    }).rejects.toThrow('limit deve estar entre 1 e 100');

    expect(async () => {
      await listChamados(testClientId, undefined, 101, 0);
    }).rejects.toThrow('limit deve estar entre 1 e 100');
  });

  it('deve validar offset não negativo', async () => {
    expect(async () => {
      await listChamados(testClientId, undefined, 10, -1);
    }).rejects.toThrow('offset não pode ser negativo');
  });

  it('deve respeitar limit e offset', async () => {
    // Criar 5 chamados
    for (let i = 0; i < 5; i++) {
      await createChamado(
        testClientId,
        `cust-${i}`,
        `John${i}`,
        `Company${i}`,
        `Title${i}`,
        ''
      );
    }

    // Listar com limit 2, offset 0
    const page1 = await listChamados(testClientId, undefined, 2, 0);
    expect(page1.length).toBeLessThanOrEqual(2);

    // Listar com limit 2, offset 2
    const page2 = await listChamados(testClientId, undefined, 2, 2);
    expect(page2.length).toBeLessThanOrEqual(2);
  });
});

databaseIntegration('Robustez - Filtros de Status [database integration]', () => {
  const testClientId = `test-client-filters-${Date.now()}`;

  it('deve filtrar por status específico', async () => {
    // Criar chamados com diferentes status
    const chamado1 = await createChamado(testClientId, 'cust-1', 'John', 'Company', 'Title1', '');
    const chamado2 = await createChamado(testClientId, 'cust-2', 'Jane', 'Company', 'Title2', '');

    // Atualizar um para closed
    await updateChamado(chamado2.id, testClientId, { status: 'closed' });

    // Filtrar por open
    const openChamados = await listChamados(testClientId, 'open');
    expect(openChamados.some(c => c.id === chamado1.id)).toBe(true);
    expect(openChamados.some(c => c.id === chamado2.id)).toBe(false);

    // Filtrar por closed
    const closedChamados = await listChamados(testClientId, 'closed');
    expect(closedChamados.some(c => c.id === chamado2.id)).toBe(true);

    // Filtrar por total (exclui closed)
    const totalChamados = await listChamados(testClientId, 'total');
    expect(totalChamados.some(c => c.id === chamado1.id)).toBe(true);
    expect(totalChamados.some(c => c.id === chamado2.id)).toBe(false);
  });
});
