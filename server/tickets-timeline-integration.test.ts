import { describe, it, expect, beforeEach } from 'vitest';
import {
  addActivityToTicket,
  editActivity,
  changeTicketStatus,
  changeTicketAttendant,
  sortActivitiesChronologically,
  filterActivitiesByAttendant,
  validateTicketActivities,
  getTimelineStats,
  type Ticket,
  type TicketActivity,
} from './tickets-helpers';

describe('Tickets Timeline Integration', () => {
  let mockTicket: Ticket;

  beforeEach(() => {
    mockTicket = {
      id: '1',
      number: 1,
      customerName: 'João Silva',
      company: 'Empresa A',
      title: 'Orçamento de peças de carro',
      observations: 'Cliente solicitou orçamento',
      status: 'open',
      phone: '11999999999',
      priority: 'media',
      assignedTo: 'Bot IA',
      createdAt: new Date('2026-05-01'),
      activities: [
        {
          id: 'a1',
          date: new Date('2026-05-01'),
          description: 'Cliente solicitou orçamento de 10 peças.',
          attendant: 'Bot IA',
        },
        {
          id: 'a2',
          date: new Date('2026-05-05'),
          description: 'Cliente gostaria de ver sobre desconto',
          attendant: 'Atendente',
        },
        {
          id: 'a3',
          date: new Date('2026-05-10'),
          description: 'Cliente gostaria de fechar orçamento.',
          attendant: 'Bot IA',
        },
      ],
    };
  });

  describe('addActivityToTicket', () => {
    it('deve adicionar uma nova atividade ao chamado', () => {
      const updated = addActivityToTicket(
        mockTicket,
        'Cliente fez o pagamento',
        'Marcelo Moura'
      );

      expect(updated.activities).toHaveLength(4);
      expect(updated.activities[3].description).toBe('Cliente fez o pagamento');
      expect(updated.activities[3].attendant).toBe('Marcelo Moura');
    });

    it('deve lançar erro se descrição estiver vazia', () => {
      expect(() => addActivityToTicket(mockTicket, '', 'Atendente')).toThrow(
        'Descrição da atividade não pode estar vazia'
      );
    });

    it('deve lançar erro se descrição for apenas espaços', () => {
      expect(() => addActivityToTicket(mockTicket, '   ', 'Atendente')).toThrow(
        'Descrição da atividade não pode estar vazia'
      );
    });


  });

  describe('editActivity', () => {
    it('deve editar uma atividade existente', () => {
      const updated = editActivity(mockTicket, 'a2', 'Cliente pediu desconto de 20%');

      expect(updated.activities[1].description).toBe('Cliente pediu desconto de 20%');
    });

    it('deve lançar erro se atividade não existir', () => {
      expect(() => editActivity(mockTicket, 'inexistente', 'Nova descrição')).toThrow(
        'Atividade inexistente não encontrada'
      );
    });

    it('deve lançar erro se nova descrição estiver vazia', () => {
      expect(() => editActivity(mockTicket, 'a2', '')).toThrow(
        'Descrição da atividade não pode estar vazia'
      );
    });

    it('deve preservar outras atividades ao editar', () => {
      const updated = editActivity(mockTicket, 'a2', 'Nova descrição');

      expect(updated.activities[0].description).toBe('Cliente solicitou orçamento de 10 peças.');
      expect(updated.activities[2].description).toBe('Cliente gostaria de fechar orçamento.');
    });
  });

  describe('changeTicketStatus', () => {
    it('deve mudar o status do chamado', () => {
      const updated = changeTicketStatus(mockTicket, 'in_progress');

      expect(updated.status).toBe('in_progress');
    });

    it('deve aceitar todos os status válidos', () => {
      const statuses = ['open', 'in_progress', 'waiting', 'closed'];

      statuses.forEach(status => {
        const updated = changeTicketStatus(mockTicket, status);
        expect(updated.status).toBe(status);
      });
    });

    it('deve lançar erro para status inválido', () => {
      expect(() => changeTicketStatus(mockTicket, 'invalido')).toThrow(
        'Status inválido: invalido'
      );
    });
  });

  describe('changeTicketAttendant', () => {
    it('deve mudar o atendente responsável', () => {
      const updated = changeTicketAttendant(mockTicket, 'Marcelo Moura');

      expect(updated.assignedTo).toBe('Marcelo Moura');
    });

    it('deve lançar erro se atendente estiver vazio', () => {
      expect(() => changeTicketAttendant(mockTicket, '')).toThrow(
        'Nome do atendente não pode estar vazio'
      );
    });

    it('deve lançar erro se atendente for apenas espaços', () => {
      expect(() => changeTicketAttendant(mockTicket, '   ')).toThrow(
        'Nome do atendente não pode estar vazio'
      );
    });
  });

  describe('sortActivitiesChronologically', () => {
    it('deve ordenar atividades por data', () => {
      const unsorted = [
        { id: '3', date: new Date('2026-05-10'), description: 'Terceira', attendant: 'Bot' },
        { id: '1', date: new Date('2026-05-01'), description: 'Primeira', attendant: 'Bot' },
        { id: '2', date: new Date('2026-05-05'), description: 'Segunda', attendant: 'Bot' },
      ];

      const sorted = sortActivitiesChronologically(unsorted);

      expect(sorted[0].id).toBe('1');
      expect(sorted[1].id).toBe('2');
      expect(sorted[2].id).toBe('3');
    });

    it('deve não modificar array original', () => {
      const original = [...mockTicket.activities];
      sortActivitiesChronologically(mockTicket.activities);

      expect(mockTicket.activities).toEqual(original);
    });
  });

  describe('filterActivitiesByAttendant', () => {
    it('deve filtrar atividades por atendente', () => {
      const botActivities = filterActivitiesByAttendant(mockTicket.activities, 'Bot IA');

      expect(botActivities).toHaveLength(2);
      expect(botActivities.every(a => a.attendant === 'Bot IA')).toBe(true);
    });

    it('deve retornar lista vazia se nenhuma atividade corresponder', () => {
      const filtered = filterActivitiesByAttendant(mockTicket.activities, 'Inexistente');

      expect(filtered).toHaveLength(0);
    });
  });

  describe('validateTicketActivities', () => {
    it('deve validar atividades corretas', () => {
      const isValid = validateTicketActivities(mockTicket);

      expect(isValid).toBe(true);
    });

    it('deve rejeitar atividade sem ID', () => {
      mockTicket.activities[0] = { ...mockTicket.activities[0], id: '' };

      expect(validateTicketActivities(mockTicket)).toBe(false);
    });

    it('deve rejeitar atividade com data inválida', () => {
      mockTicket.activities[0] = { ...mockTicket.activities[0], date: new Date('invalid') };

      expect(validateTicketActivities(mockTicket)).toBe(false);
    });

    it('deve rejeitar atividade com descrição vazia', () => {
      mockTicket.activities[0] = { ...mockTicket.activities[0], description: '' };

      expect(validateTicketActivities(mockTicket)).toBe(false);
    });

    it('deve rejeitar atividade com atendente vazio', () => {
      mockTicket.activities[0] = { ...mockTicket.activities[0], attendant: '' };

      expect(validateTicketActivities(mockTicket)).toBe(false);
    });
  });

  describe('getTimelineStats', () => {
    it('deve retornar estatísticas corretas', () => {
      const stats = getTimelineStats(mockTicket);

      expect(stats.totalActivities).toBe(3);
      expect(stats.firstActivity?.id).toBe('a1');
      expect(stats.lastActivity?.id).toBe('a3');
      expect(stats.attendants).toContain('Bot IA');
      expect(stats.attendants).toContain('Atendente');
    });

    it('deve listar atendentes únicos', () => {
      const stats = getTimelineStats(mockTicket);

      expect(stats.attendants).toHaveLength(2);
      expect(new Set(stats.attendants).size).toBe(stats.attendants.length);
    });

    it('deve retornar null para tickets sem atividades', () => {
      const emptyTicket = { ...mockTicket, activities: [] };
      const stats = getTimelineStats(emptyTicket);

      expect(stats.totalActivities).toBe(0);
      expect(stats.firstActivity).toBeNull();
      expect(stats.lastActivity).toBeNull();
    });

    it('deve calcular intervalo de datas correto', () => {
      const stats = getTimelineStats(mockTicket);

      expect(stats.dateRange.start?.getTime()).toBeLessThanOrEqual(
        stats.dateRange.end?.getTime() || 0
      );
    });
  });

  describe('Fluxo completo de timeline', () => {
    it('deve adicionar, editar e validar atividades', () => {
      let ticket = mockTicket;

      // Adicionar atividade
      ticket = addActivityToTicket(ticket, 'Pedido enviado', 'Marcelo Moura');
      expect(ticket.activities).toHaveLength(4);

      // Editar atividade
      ticket = editActivity(ticket, ticket.activities[3].id, 'Pedido enviado com sucesso');
      expect(ticket.activities[3].description).toBe('Pedido enviado com sucesso');

      // Mudar status
      ticket = changeTicketStatus(ticket, 'in_progress');
      expect(ticket.status).toBe('in_progress');

      // Mudar atendente
      ticket = changeTicketAttendant(ticket, 'Marcelo Moura');
      expect(ticket.assignedTo).toBe('Marcelo Moura');

      // Validar
      expect(validateTicketActivities(ticket)).toBe(true);

      // Obter estatísticas
      const stats = getTimelineStats(ticket);
      expect(stats.totalActivities).toBe(4);
    });
  });
});
