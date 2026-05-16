import { describe, it, expect, beforeEach } from 'vitest';

type TicketActivity = {
  id: string;
  date: number; // timestamp em millisegundos
  description: string;
  attendant: string;
  actionType?: string;
};

type Ticket = {
  id: string;
  number: number;
  customerName: string;
  company: string;
  title: string;
  observations: string;
  status: string;
  phone: string;
  priority?: string;
  assignedTo?: string;
  createdAt: Date;
  activities: TicketActivity[];
};

describe('Tickets Timeline', () => {
  let mockTickets: Ticket[] = [];

  beforeEach(() => {
    mockTickets = [
      {
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
          { id: 'a1', date: new Date('2026-05-01').getTime(), description: 'Cliente solicitou orçamento de 10 peças.', attendant: 'Bot IA' },
          { id: 'a2', date: new Date('2026-05-05').getTime(), description: 'Cliente gostaria de ver sobre desconto', attendant: 'Atendente' },
          { id: 'a3', date: new Date('2026-05-10').getTime(), description: 'Cliente gostaria de fechar orçamento.', attendant: 'Bot IA' },
        ],
      },
    ];
  });

  it('deve criar um chamado com atividades iniciais', () => {
    const ticket = mockTickets[0];
    expect(ticket).toBeDefined();
    expect(ticket.activities).toHaveLength(3);
    expect(ticket.activities[0].description).toBe('Cliente solicitou orçamento de 10 peças.');
  });

  it('deve adicionar uma nova atividade ao chamado', () => {
    const ticket = mockTickets[0];
    const newActivity: TicketActivity = {
      id: 'a4',
      date: new Date('2026-05-15'),
      description: 'Cliente fez o pagamento do pedido',
      attendant: 'Marcelo Moura',
    };

    ticket.activities.push(newActivity);

    expect(ticket.activities).toHaveLength(4);
    expect(ticket.activities[3].description).toBe('Cliente fez o pagamento do pedido');
  });

  it('deve editar uma atividade existente', () => {
    const ticket = mockTickets[0];
    const activityId = 'a2';
    const newText = 'Cliente solicitou desconto especial de 15%';

    const updatedActivities = ticket.activities.map(a =>
      a.id === activityId ? { ...a, description: newText } : a
    );

    expect(updatedActivities[1].description).toBe('Cliente solicitou desconto especial de 15%');
  });

  it('deve ordenar atividades cronologicamente', () => {
    const ticket = mockTickets[0];
    const sorted = [...ticket.activities].sort((a, b) =>
      a.date - b.date
    );

    expect(sorted[0].date).toBeLessThanOrEqual(sorted[1].date);
    expect(sorted[1].date).toBeLessThanOrEqual(sorted[2].date);
  });

  it('deve mudar o status do chamado', () => {
    const ticket = mockTickets[0];
    const oldStatus = ticket.status;
    ticket.status = 'in_progress';

    expect(ticket.status).not.toBe(oldStatus);
    expect(ticket.status).toBe('in_progress');
  });

  it('deve mudar o atendente responsável', () => {
    const ticket = mockTickets[0];
    const oldAttendant = ticket.assignedTo;
    ticket.assignedTo = 'Marcelo Moura';

    expect(ticket.assignedTo).not.toBe(oldAttendant);
    expect(ticket.assignedTo).toBe('Marcelo Moura');
  });

  it('deve filtrar atividades por atendente', () => {
    const ticket = mockTickets[0];
    const botActivities = ticket.activities.filter(a => a.attendant === 'Bot IA');

    expect(botActivities).toHaveLength(2);
    expect(botActivities.every(a => a.attendant === 'Bot IA')).toBe(true);
  });

  it('deve contar total de atividades em um chamado', () => {
    const ticket = mockTickets[0];
    const totalActivities = ticket.activities.length;

    expect(totalActivities).toBe(3);
  });

  it('deve validar que cada atividade tem data válida', () => {
    const ticket = mockTickets[0];
    const allValid = ticket.activities.every(a => typeof a.date === 'number' && !isNaN(a.date));

    expect(allValid).toBe(true);
  });

  it('deve validar que cada atividade tem descrição não vazia', () => {
    const ticket = mockTickets[0];
    const allValid = ticket.activities.every(a => a.description.trim().length > 0);

    expect(allValid).toBe(true);
  });
});
