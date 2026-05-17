/**
 * Helpers para gerenciar timeline de chamados
 * Funções testáveis para lógica de tickets
 */

export type TicketActivity = {
  id: string;
  date: Date;
  description: string;
  attendant: string;
};

export type Ticket = {
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

/**
 * Adiciona uma nova atividade ao chamado
 */
export function addActivityToTicket(
  ticket: Ticket,
  description: string,
  attendant: string
): Ticket {
  if (!description.trim()) {
    throw new Error('Descrição da atividade não pode estar vazia');
  }

  const newActivity: TicketActivity = {
    id: `activity-${Date.now()}`,
    date: new Date(),
    description,
    attendant,
  };

  return {
    ...ticket,
    activities: [...ticket.activities, newActivity],
  };
}

/**
 * Edita uma atividade existente
 */
export function editActivity(
  ticket: Ticket,
  activityId: string,
  newDescription: string
): Ticket {
  if (!newDescription.trim()) {
    throw new Error('Descrição da atividade não pode estar vazia');
  }

  const activity = ticket.activities.find(a => a.id === activityId);
  if (!activity) {
    throw new Error(`Atividade ${activityId} não encontrada`);
  }

  return {
    ...ticket,
    activities: ticket.activities.map(a =>
      a.id === activityId ? { ...a, description: newDescription } : a
    ),
  };
}

/**
 * Muda o status do chamado
 */
export function changeTicketStatus(
  ticket: Ticket,
  newStatus: string
): Ticket {
  const validStatuses = ['open', 'in_progress', 'waiting', 'closed'];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Status inválido: ${newStatus}`);
  }

  return {
    ...ticket,
    status: newStatus,
  };
}

/**
 * Muda o atendente responsável
 */
export function changeTicketAttendant(
  ticket: Ticket,
  newAttendant: string
): Ticket {
  if (!newAttendant.trim()) {
    throw new Error('Nome do atendente não pode estar vazio');
  }

  return {
    ...ticket,
    assignedTo: newAttendant,
  };
}

/**
 * Ordena atividades cronologicamente
 */
export function sortActivitiesChronologically(
  activities: TicketActivity[]
): TicketActivity[] {
  return [...activities].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

/**
 * Filtra atividades por atendente
 */
export function filterActivitiesByAttendant(
  activities: TicketActivity[],
  attendant: string
): TicketActivity[] {
  return activities.filter(a => a.attendant === attendant);
}

/**
 * Valida se um chamado tem atividades válidas
 */
export function validateTicketActivities(ticket: Ticket): boolean {
  return ticket.activities.every(
    a =>
      a.id &&
      a.date instanceof Date &&
      !isNaN(a.date.getTime()) &&
      a.description.trim().length > 0 &&
      a.attendant.trim().length > 0
  );
}

/**
 * Obtém estatísticas da timeline
 */
export function getTimelineStats(ticket: Ticket) {
  return {
    totalActivities: ticket.activities.length,
    firstActivity: ticket.activities.length > 0 ? ticket.activities[0] : null,
    lastActivity: ticket.activities.length > 0 ? ticket.activities[ticket.activities.length - 1] : null,
    attendants: [...new Set(ticket.activities.map(a => a.attendant))],
    dateRange: {
      start: ticket.activities.length > 0 ? ticket.activities[0].date : null,
      end: ticket.activities.length > 0 ? ticket.activities[ticket.activities.length - 1].date : null,
    },
  };
}
