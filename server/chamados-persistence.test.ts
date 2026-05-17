/**
 * Testes de Persistência de Chamados
 * Valida se os dados estão sendo salvos corretamente no banco
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createChamado,
  getChamadoWithActivities,
  listChamados,
  updateChamado,
  addActivityToChamado,
  editActivity,
  getNextChamadoNumber,
} from './db-chamados';

describe('Persistência de Chamados', () => {
  const testClientId = `test-client-${Date.now()}`;
  let createdChamadoId: string;

  describe('Sequência de Chamados', () => {
    it('deve retornar número 1 para primeiro chamado', async () => {
      const number = await getNextChamadoNumber(testClientId);
      expect(number).toBe(1);
    });

    it('deve retornar número 2 para segundo chamado', async () => {
      const number = await getNextChamadoNumber(testClientId);
      expect(number).toBe(2);
    });

    it('deve incrementar sequência corretamente', async () => {
      const n1 = await getNextChamadoNumber(testClientId);
      const n2 = await getNextChamadoNumber(testClientId);
      expect(n2).toBe(n1 + 1);
    });
  });

  describe('Criar Chamado', () => {
    it('deve criar chamado e retornar dados corretos', async () => {
      const chamado = await createChamado(
        testClientId,
        'cust-123',
        'João Silva',
        'Empresa XYZ',
        'Sistema não abre',
        'Erro ao fazer login',
        'alta'
      );

      createdChamadoId = chamado.id;

      expect(chamado).toMatchObject({
        customerName: 'João Silva',
        company: 'Empresa XYZ',
        title: 'Sistema não abre',
        observations: 'Erro ao fazer login',
        status: 'open',
        priority: 'alta',
      });
      expect(chamado.number).toBeGreaterThan(0);
      expect(chamado.id).toBeTruthy();
      expect(chamado.createdAt).toBeInstanceOf(Date);
    });

    it('deve ter atividades vazias ao criar', async () => {
      const chamado = await createChamado(
        testClientId,
        'cust-456',
        'Maria Santos',
        'Empresa ABC',
        'Relatório não funciona',
        'Não consegue gerar PDF',
        'media'
      );

      expect(chamado.activities).toEqual([]);
    });
  });

  describe('Obter Chamado com Atividades', () => {
    it('deve retornar chamado com dados persistidos', async () => {
      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);

      expect(chamado).not.toBeNull();
      expect(chamado?.id).toBe(createdChamadoId);
      expect(chamado?.customerName).toBe('João Silva');
      expect(chamado?.status).toBe('open');
    });

    it('deve retornar null para chamado inexistente', async () => {
      const chamado = await getChamadoWithActivities('inexistente', testClientId);
      expect(chamado).toBeNull();
    });

    it('deve retornar null para cliente diferente', async () => {
      const chamado = await getChamadoWithActivities(createdChamadoId, 'outro-cliente');
      expect(chamado).toBeNull();
    });
  });

  describe('Listar Chamados', () => {
    it('deve listar chamados do cliente', async () => {
      const chamados = await listChamados(testClientId);

      expect(Array.isArray(chamados)).toBe(true);
      expect(chamados.length).toBeGreaterThan(0);
      expect(chamados[0].id).toBeTruthy();
    });

    it('deve respeitar limite de registros', async () => {
      const chamados = await listChamados(testClientId, undefined, 1);
      expect(chamados.length).toBeLessThanOrEqual(1);
    });

    it('deve respeitar offset', async () => {
      const page1 = await listChamados(testClientId, undefined, 10, 0);
      const page2 = await listChamados(testClientId, undefined, 10, 10);

      if (page1.length > 0 && page2.length > 0) {
        expect(page1[0].id).not.toBe(page2[0].id);
      }
    });

    it('deve filtrar por status', async () => {
      const openChamados = await listChamados(testClientId, 'open');

      expect(Array.isArray(openChamados)).toBe(true);
      for (const chamado of openChamados) {
        expect(chamado.status).toBe('open');
      }
    });

    it('deve excluir fechados no filtro total', async () => {
      const totalChamados = await listChamados(testClientId, 'total');

      for (const chamado of totalChamados) {
        expect(chamado.status).not.toBe('closed');
      }
    });
  });

  describe('Atualizar Chamado', () => {
    it('deve atualizar título', async () => {
      await updateChamado(createdChamadoId, testClientId, {
        title: 'Novo título do chamado',
      });

      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);
      expect(chamado?.title).toBe('Novo título do chamado');
    });

    it('deve atualizar status', async () => {
      await updateChamado(createdChamadoId, testClientId, {
        status: 'in_progress',
      });

      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);
      expect(chamado?.status).toBe('in_progress');
    });

    it('deve atualizar observações', async () => {
      const novasObs = 'Observações atualizadas';
      await updateChamado(createdChamadoId, testClientId, {
        observations: novasObs,
      });

      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);
      expect(chamado?.observations).toBe(novasObs);
    });

    it('deve atualizar múltiplos campos', async () => {
      await updateChamado(createdChamadoId, testClientId, {
        status: 'waiting',
        observations: 'Aguardando resposta do cliente',
      });

      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);
      expect(chamado?.status).toBe('waiting');
      expect(chamado?.observations).toBe('Aguardando resposta do cliente');
    });
  });

  describe('Atividades de Chamados', () => {
    it('deve adicionar atividade ao chamado', async () => {
      await addActivityToChamado(
        createdChamadoId,
        testClientId,
        'Primeiro contato com cliente',
        'João Silva'
      );

      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);
      expect(chamado?.activities.length).toBeGreaterThan(0);
      expect(chamado?.activities[0].description).toBe('Primeiro contato com cliente');
      expect(chamado?.activities[0].attendant).toBe('João Silva');
    });

    it('deve adicionar múltiplas atividades', async () => {
      await addActivityToChamado(
        createdChamadoId,
        testClientId,
        'Segunda atividade',
        'Maria Santos'
      );

      await addActivityToChamado(
        createdChamadoId,
        testClientId,
        'Terceira atividade',
        'Pedro Costa'
      );

      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);
      expect(chamado?.activities.length).toBeGreaterThanOrEqual(3);
    });

    it('deve manter ordem cronológica reversa', async () => {
      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);

      if (chamado && chamado.activities.length > 1) {
        for (let i = 0; i < chamado.activities.length - 1; i++) {
          expect(chamado.activities[i].date.getTime()).toBeGreaterThanOrEqual(
            chamado.activities[i + 1].date.getTime()
          );
        }
      }
    });

    it('deve editar atividade existente', async () => {
      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);
      if (chamado && chamado.activities.length > 0) {
        const activityId = chamado.activities[0].id;
        const novaDescricao = 'Atividade editada com sucesso';

        await editActivity(activityId, createdChamadoId, testClientId, novaDescricao);

        const chamadoAtualizado = await getChamadoWithActivities(
          createdChamadoId,
          testClientId
        );
        const actividadeEditada = chamadoAtualizado?.activities.find(
          a => a.id === activityId
        );
        expect(actividadeEditada?.description).toBe(novaDescricao);
      }
    });
  });

  describe('Isolamento por Cliente', () => {
    it('não deve listar chamados de outro cliente', async () => {
      const outroClientId = `outro-cliente-${Date.now()}`;
      const chamados = await listChamados(outroClientId);
      expect(chamados.length).toBe(0);
    });

    it('não deve retornar chamado de outro cliente', async () => {
      const outroClientId = `outro-cliente-${Date.now()}`;
      const chamado = await getChamadoWithActivities(createdChamadoId, outroClientId);
      expect(chamado).toBeNull();
    });
  });

  describe('Integridade de Dados', () => {
    it('deve ter timestamps válidos', async () => {
      const chamado = await getChamadoWithActivities(createdChamadoId, testClientId);

      expect(chamado?.createdAt).toBeInstanceOf(Date);
      expect(chamado?.createdAt?.getTime()).toBeGreaterThan(0);

      if (chamado?.activities.length) {
        for (const activity of chamado.activities) {
          expect(activity.date).toBeInstanceOf(Date);
          expect(activity.date.getTime()).toBeGreaterThan(0);
        }
      }
    });

    it('deve manter dados após múltiplas operações', async () => {
      const original = await getChamadoWithActivities(createdChamadoId, testClientId);

      await updateChamado(createdChamadoId, testClientId, { status: 'closed' });
      await addActivityToChamado(
        createdChamadoId,
        testClientId,
        'Chamado fechado',
        'Admin'
      );

      const final = await getChamadoWithActivities(createdChamadoId, testClientId);

      expect(final?.id).toBe(original?.id);
      expect(final?.customerName).toBe(original?.customerName);
      expect(final?.status).toBe('closed');
      expect(final?.activities.length).toBeGreaterThan((original?.activities.length || 0));
    });
  });
});
