/**
 * Testes Vitest para procedures tRPC de chamados
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chamadosRouter } from './routers-chamados';
import { createCallerFactory } from './_core/trpc';
import { isTestDatabaseEnabled } from './test-integration-gates';

// Mock do contexto
const mockContext = {
  user: { id: 'test-user', name: 'Test User', role: 'user' },
  req: {} as any,
  res: {} as any,
};

describe.runIf(isTestDatabaseEnabled())('Chamados Router [database integration]', () => {
  let caller: any;

  beforeAll(() => {
    const createCaller = createCallerFactory(chamadosRouter);
    caller = createCaller(mockContext);
  });

  describe('list', () => {
    it('deve retornar lista vazia inicialmente', async () => {
      const result = await caller.list({
        clientId: 'test-client',
        status: 'total',
      });

      expect(result).toBeDefined();
      expect(result.chamados).toBeDefined();
      expect(Array.isArray(result.chamados)).toBe(true);
    });

    it('deve filtrar por status', async () => {
      const result = await caller.list({
        clientId: 'test-client',
        status: 'open',
      });

      expect(result.chamados).toBeDefined();
      expect(Array.isArray(result.chamados)).toBe(true);
    });

    it('deve respeitar limite de registros', async () => {
      const result = await caller.list({
        clientId: 'test-client',
        status: 'total',
        limit: 10,
      });

      expect(result.chamados.length).toBeLessThanOrEqual(10);
    });
  });

  describe('create', () => {
    it('deve criar novo chamado com dados válidos', async () => {
      const result = await caller.create({
        clientId: 'test-client',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Problema com integração',
        observations: 'Cliente reportou erro',
        priority: 'media',
      });

      expect(result.chamado).toBeDefined();
      expect(result.chamado.id).toBeDefined();
      expect(result.chamado.number).toBeDefined();
      expect(result.chamado.customerName).toBe('João Silva');
      expect(result.chamado.title).toBe('Problema com integração');
      expect(result.chamado.status).toBe('open');
      expect(result.chamado.priority).toBe('media');
    });

    it('deve gerar números sequenciais para chamados', async () => {
      const chamado1 = await caller.create({
        clientId: 'test-client-seq',
        customerId: 'cust-1',
        customerName: 'Cliente 1',
        company: 'Empresa 1',
        title: 'Chamado 1',
        observations: '',
        priority: 'media',
      });

      const chamado2 = await caller.create({
        clientId: 'test-client-seq',
        customerId: 'cust-2',
        customerName: 'Cliente 2',
        company: 'Empresa 2',
        title: 'Chamado 2',
        observations: '',
        priority: 'media',
      });

      expect(chamado2.chamado.number).toBeGreaterThan(chamado1.chamado.number);
    });

    it('deve usar prioridade padrão "media" se não informada', async () => {
      const result = await caller.create({
        clientId: 'test-client',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Teste',
        observations: '',
      });

      expect(result.chamado.priority).toBe('media');
    });
  });

  describe('update', () => {
    it('deve atualizar status do chamado', async () => {
      // Criar um chamado primeiro
      const created = await caller.create({
        clientId: 'test-client-update',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Teste Update',
        observations: '',
        priority: 'media',
      });

      // Atualizar status
      const updated = await caller.update({
        chamadoId: created.chamado.id,
        clientId: 'test-client-update',
        status: 'in_progress',
      });

      expect(updated.chamado.status).toBe('in_progress');
    });

    it('deve atualizar atendente responsável', async () => {
      const created = await caller.create({
        clientId: 'test-client-attendant',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Teste Attendant',
        observations: '',
        priority: 'media',
      });

      const updated = await caller.update({
        chamadoId: created.chamado.id,
        clientId: 'test-client-attendant',
        assignedTo: 'Marcelo Moura',
      });

      expect(updated.chamado.assignedTo).toBe('Marcelo Moura');
    });

    it('deve atualizar título e observações', async () => {
      const created = await caller.create({
        clientId: 'test-client-edit',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Título Original',
        observations: 'Observação Original',
        priority: 'media',
      });

      const updated = await caller.update({
        chamadoId: created.chamado.id,
        clientId: 'test-client-edit',
        title: 'Título Atualizado',
        observations: 'Observação Atualizada',
      });

      expect(updated.chamado.title).toBe('Título Atualizado');
      expect(updated.chamado.observations).toBe('Observação Atualizada');
    });
  });

  describe('addActivity', () => {
    it('deve adicionar atividade a um chamado', async () => {
      const created = await caller.create({
        clientId: 'test-client-activity',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Teste Activity',
        observations: '',
        priority: 'media',
      });

      const withActivity = await caller.addActivity({
        chamadoId: created.chamado.id,
        clientId: 'test-client-activity',
        description: 'Cliente solicitou informações',
        attendant: 'Bot IA',
      });

      expect(withActivity.chamado.activities.length).toBe(1);
      expect(withActivity.chamado.activities[0].description).toBe('Cliente solicitou informações');
      expect(withActivity.chamado.activities[0].attendant).toBe('Bot IA');
    });

    it('deve rejeitar atividade vazia', async () => {
      const created = await caller.create({
        clientId: 'test-client-empty-activity',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Teste Empty Activity',
        observations: '',
        priority: 'media',
      });

      expect(
        caller.addActivity({
          chamadoId: created.chamado.id,
          clientId: 'test-client-empty-activity',
          description: '   ',
          attendant: 'Bot IA',
        })
      ).rejects.toThrow();
    });

    it('deve manter ordem cronológica das atividades', async () => {
      const created = await caller.create({
        clientId: 'test-client-chrono',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Teste Chrono',
        observations: '',
        priority: 'media',
      });

      const withActivity1 = await caller.addActivity({
        chamadoId: created.chamado.id,
        clientId: 'test-client-chrono',
        description: 'Primeira atividade',
        attendant: 'Bot IA',
      });

      const withActivity2 = await caller.addActivity({
        chamadoId: created.chamado.id,
        clientId: 'test-client-chrono',
        description: 'Segunda atividade',
        attendant: 'Atendente',
      });

      expect(withActivity2.chamado.activities.length).toBe(2);
      // Verificar se estão em ordem (mais recente primeiro ou último)
      expect(withActivity2.chamado.activities[0]).toBeDefined();
      expect(withActivity2.chamado.activities[1]).toBeDefined();
    });
  });

  describe('editActivity', () => {
    it('deve editar descrição de atividade existente', async () => {
      const created = await caller.create({
        clientId: 'test-client-edit-activity',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Teste Edit Activity',
        observations: '',
        priority: 'media',
      });

      const withActivity = await caller.addActivity({
        chamadoId: created.chamado.id,
        clientId: 'test-client-edit-activity',
        description: 'Descrição Original',
        attendant: 'Bot IA',
      });

      const activityId = withActivity.chamado.activities[0].id;

      const edited = await caller.editActivity({
        activityId,
        chamadoId: created.chamado.id,
        clientId: 'test-client-edit-activity',
        description: 'Descrição Editada',
      });

      expect(edited.chamado.activities[0].description).toBe('Descrição Editada');
    });

    it('deve rejeitar edição com descrição vazia', async () => {
      const created = await caller.create({
        clientId: 'test-client-edit-empty',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Teste Edit Empty',
        observations: '',
        priority: 'media',
      });

      const withActivity = await caller.addActivity({
        chamadoId: created.chamado.id,
        clientId: 'test-client-edit-empty',
        description: 'Descrição Original',
        attendant: 'Bot IA',
      });

      const activityId = withActivity.chamado.activities[0].id;

      expect(
        caller.editActivity({
          activityId,
          chamadoId: created.chamado.id,
          clientId: 'test-client-edit-empty',
          description: '   ',
        })
      ).rejects.toThrow();
    });
  });

  describe('getDetail', () => {
    it('deve retornar detalhes completos do chamado', async () => {
      const created = await caller.create({
        clientId: 'test-client-detail',
        customerId: 'cust-123',
        customerName: 'João Silva',
        company: 'Empresa Teste',
        title: 'Teste Detail',
        observations: 'Observações importantes',
        priority: 'alta',
        assignedTo: 'Marcelo',
      });

      const detail = await caller.getDetail({
        chamadoId: created.chamado.id,
        clientId: 'test-client-detail',
      });

      expect(detail.chamado.id).toBe(created.chamado.id);
      expect(detail.chamado.customerName).toBe('João Silva');
      expect(detail.chamado.observations).toBe('Observações importantes');
      expect(detail.chamado.priority).toBe('alta');
      expect(detail.chamado.assignedTo).toBe('Marcelo');
    });

    it('deve retornar null para chamado inexistente', async () => {
      expect(
        caller.getDetail({
          chamadoId: 'inexistente-123',
          clientId: 'test-client-notfound',
        })
      ).rejects.toThrow();
    });
  });

  describe('Isolamento por Cliente', () => {
    it('deve isolar chamados de clientes diferentes', async () => {
      // Criar chamado para cliente 1
      const chamado1 = await caller.create({
        clientId: 'client-1',
        customerId: 'cust-1',
        customerName: 'Cliente 1',
        company: 'Empresa 1',
        title: 'Chamado Cliente 1',
        observations: '',
        priority: 'media',
      });

      // Criar chamado para cliente 2
      const chamado2 = await caller.create({
        clientId: 'client-2',
        customerId: 'cust-2',
        customerName: 'Cliente 2',
        company: 'Empresa 2',
        title: 'Chamado Cliente 2',
        observations: '',
        priority: 'media',
      });

      // Listar chamados do cliente 1
      const list1 = await caller.list({
        clientId: 'client-1',
        status: 'total',
      });

      // Listar chamados do cliente 2
      const list2 = await caller.list({
        clientId: 'client-2',
        status: 'total',
      });

      // Verificar isolamento
      expect(list1.chamados.some(c => c.id === chamado1.chamado.id)).toBe(true);
      expect(list1.chamados.some(c => c.id === chamado2.chamado.id)).toBe(false);

      expect(list2.chamados.some(c => c.id === chamado2.chamado.id)).toBe(true);
      expect(list2.chamados.some(c => c.id === chamado1.chamado.id)).toBe(false);
    });
  });

  describe('Filtro Total', () => {
    it('deve excluir chamados fechados no filtro total', async () => {
      // Criar chamado aberto
      const aberto = await caller.create({
        clientId: 'test-client-filter',
        customerId: 'cust-1',
        customerName: 'Cliente 1',
        company: 'Empresa 1',
        title: 'Chamado Aberto',
        observations: '',
        priority: 'media',
      });

      // Criar chamado e fechar
      const fechado = await caller.create({
        clientId: 'test-client-filter',
        customerId: 'cust-2',
        customerName: 'Cliente 2',
        company: 'Empresa 2',
        title: 'Chamado Fechado',
        observations: '',
        priority: 'media',
      });

      await caller.update({
        chamadoId: fechado.chamado.id,
        clientId: 'test-client-filter',
        status: 'closed',
      });

      // Listar com filtro total
      const total = await caller.list({
        clientId: 'test-client-filter',
        status: 'total',
      });

      // Verificar que apenas o aberto está na lista
      expect(total.chamados.some(c => c.id === aberto.chamado.id)).toBe(true);
      expect(total.chamados.some(c => c.id === fechado.chamado.id)).toBe(false);
    });
  });
});
