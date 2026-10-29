import { createChamadoWithActivity, registerManualTicketActivity, updateChamadoWithActivity } from "./chamados-domain";
import { getActiveClientUser, getChamadoWithActivities } from "./db-chamados";
import { getCrmClientById, listCrmClients } from "./db-crm";
import type { HermesTicketActionType } from "./gemini-client";

export type HermesTicketAction = {
  actionType: HermesTicketActionType;
  args: Record<string, unknown>;
};

type CanonicalActor = { userId: string; userName: string };
type CrmCustomer = {
  crmClientId: string;
  lifecycleState: string;
  companyName: string;
  responsibleName: string;
  customerType: "person" | "company" | null;
  phone?: string | null;
  email?: string | null;
  cpfCnpj?: string | null;
};

export type HermesTicketActionDependencies = {
  getActiveClientUser: typeof getActiveClientUser;
  getChamadoWithActivities: typeof getChamadoWithActivities;
  getCrmClientById: typeof getCrmClientById;
  listCrmClients: typeof listCrmClients;
  createChamadoWithActivity: typeof createChamadoWithActivity;
  updateChamadoWithActivity: typeof updateChamadoWithActivity;
  registerManualTicketActivity: typeof registerManualTicketActivity;
};

const productionDependencies: HermesTicketActionDependencies = {
  getActiveClientUser,
  getChamadoWithActivities,
  getCrmClientById,
  listCrmClients,
  createChamadoWithActivity,
  updateChamadoWithActivity,
  registerManualTicketActivity,
};

function stringValue(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`HERMES_ACTION_INVALID_${key.toUpperCase()}`);
  return value.trim();
}

function resolveTicketRef(args: Record<string, unknown>): string {
  if (args.ticketNumber !== undefined && args.ticketNumber !== null && String(args.ticketNumber).trim()) {
    return String(args.ticketNumber).trim();
  }
  if (typeof args.ticketId === "string" && args.ticketId.trim()) {
    return args.ticketId.trim();
  }
  throw new Error("HERMES_ACTION_INVALID_TICKETID");
}

function exactCustomerMatch(reference: string, customers: CrmCustomer[]): CrmCustomer | null {
  const normalized = reference.trim().toLocaleLowerCase();
  const matches = customers.filter(customer =>
    customer.crmClientId === reference
    || customer.companyName.trim().toLocaleLowerCase() === normalized
    || customer.responsibleName.trim().toLocaleLowerCase() === normalized,
  );
  return matches.length === 1 ? matches[0] : null;
}

async function resolveCustomer(
  clientId: string,
  reference: string,
  dependencies: HermesTicketActionDependencies,
): Promise<CrmCustomer> {
  const direct = await dependencies.getCrmClientById(reference, clientId) as CrmCustomer | null;
  if (direct?.lifecycleState === "active") return direct;
  const candidates = await dependencies.listCrmClients(clientId, reference, "active") as CrmCustomer[];
  const matched = exactCustomerMatch(reference, candidates);
  if (!matched || matched.lifecycleState !== "active") {
    throw new Error("HERMES_ACTION_CUSTOMER_NOT_FOUND_OR_AMBIGUOUS");
  }
  return matched;
}

function canonicalCustomerName(customer: CrmCustomer): string {
  return customer.customerType === "company" && customer.responsibleName.trim()
    ? customer.responsibleName.trim()
    : customer.companyName.trim();
}

function toDomainPriority(priority?: string): "baixa" | "media" | "alta" | "critica" {
  if (!priority) return "media";
  const priorities = { low: "baixa", medium: "media", high: "alta", urgent: "critica" } as const;
  const mapped = priorities[priority as keyof typeof priorities];
  return mapped ?? "media";
}

function toDomainStatus(status: string): "open" | "in_progress" | "waiting" | "closed" {
  if (status === "resolved") return "closed";
  if (status === "pending") return "waiting";
  if (status === "open" || status === "in_progress" || status === "closed" || status === "waiting") return status;
  throw new Error("HERMES_ACTION_INVALID_STATUS");
}

export async function executeHermesTicketAction(
  input: {
    clientId: string;
    actorUserId: string;
    action: HermesTicketAction;
    resolveAssignee: (reference: string) => Promise<{ userId: string; userName: string } | null>;
  },
  dependencies: HermesTicketActionDependencies = productionDependencies,
): Promise<{ success: true; message: string; entityId: string | number }> {
  const actor = await dependencies.getActiveClientUser(input.clientId, input.actorUserId) as CanonicalActor | null;
  if (!actor) throw new Error("HERMES_ACTION_ACTOR_NOT_ACTIVE");
  const args = input.action.args;

  if (input.action.actionType === "CREATE_TICKET") {
    const customerRef = typeof args.customer === "string" && args.customer.trim()
      ? args.customer.trim()
      : typeof args.clientNameOuId === "string" && args.clientNameOuId.trim()
      ? args.clientNameOuId.trim()
      : "";
    if (!customerRef) throw new Error("HERMES_ACTION_INVALID_CUSTOMER");
    const customer = await resolveCustomer(input.clientId, customerRef, dependencies);
    const title = stringValue(args, "title");
    const description = typeof args.description === "string" ? args.description.trim() : "";
    const priority = typeof args.priority === "string" && args.priority.trim() ? args.priority.trim() : "medium";
    const categoryName = typeof args.category === "string" && args.category.trim() ? args.category.trim() : "suporte";
    const category = `\n\nCategoria: ${categoryName}`;
    const chamado = await dependencies.createChamadoWithActivity({
      clientId: input.clientId,
      customerId: customer.crmClientId,
      customerName: canonicalCustomerName(customer),
      company: customer.companyName.trim(),
      title,
      observations: `${description}${category}`,
      priority: toDomainPriority(priority),
      assignedTo: actor.userName,
      assignedToUserId: actor.userId,
      customerPhone: customer.phone ?? null,
      customerEmail: customer.email ?? null,
      customerCNPJ: customer.cpfCnpj ?? null,
      actor,
    });
    return { success: true, message: `Chamado #${chamado.number} criado com sucesso.`, entityId: chamado.id };
  }

  const ticketRef = resolveTicketRef(args);
  const current = await dependencies.getChamadoWithActivities(ticketRef, input.clientId);
  if (!current) throw new Error("HERMES_ACTION_TICKET_NOT_FOUND");
  const chamadoId = current.id;

  if (input.action.actionType === "UPDATE_TICKET_STATUS") {
    const note = typeof args.resolutionNote === "string" && args.resolutionNote.trim()
      ? args.resolutionNote.trim()
      : typeof args.resolutionNotes === "string" && args.resolutionNotes.trim()
      ? args.resolutionNotes.trim()
      : "";
    const resolutionNotes = note
      ? `${current.observations?.trim() ? `${current.observations.trim()}\n\n` : ""}Resolução: ${note}`
      : undefined;
    const newStatus = stringValue(args, "newStatus");
    await dependencies.updateChamadoWithActivity({
      chamadoId,
      clientId: input.clientId,
      actor,
      mode: "status",
      updates: { status: toDomainStatus(newStatus), ...(resolutionNotes ? { observations: resolutionNotes } : {}) },
    });
    return { success: true, message: "Status do chamado atualizado com sucesso.", entityId: chamadoId };
  }

  if (input.action.actionType === "ASSIGN_TICKET") {
    const assigneeRef = typeof args.operatorName === "string" && args.operatorName.trim()
      ? args.operatorName.trim()
      : typeof args.operatorId === "string" && args.operatorId.trim()
      ? args.operatorId.trim()
      : typeof args.assigneeNameOuId === "string" && args.assigneeNameOuId.trim()
      ? args.assigneeNameOuId.trim()
      : "";
    if (!assigneeRef) throw new Error("HERMES_ACTION_INVALID_ASSIGNEE");
    const assignee = await input.resolveAssignee(assigneeRef);
    if (!assignee) throw new Error("HERMES_ACTION_ASSIGNEE_NOT_FOUND_OR_AMBIGUOUS");
    const activeAssignee = await dependencies.getActiveClientUser(input.clientId, assignee.userId) as CanonicalActor | null;
    if (!activeAssignee) throw new Error("HERMES_ACTION_ASSIGNEE_NOT_ACTIVE");
    const reason = typeof args.reason === "string" && args.reason.trim()
      ? args.reason.trim()
      : typeof args.transferReason === "string" && args.transferReason.trim()
      ? args.transferReason.trim()
      : "";
    await dependencies.updateChamadoWithActivity({
      chamadoId,
      clientId: input.clientId,
      actor,
      mode: "forward",
      updates: {
        assignedTo: activeAssignee.userName,
        assignedToUserId: activeAssignee.userId,
        ...(reason ? { forwardObservation: reason } : {}),
      },
    });
    return { success: true, message: `Chamado encaminhado para ${activeAssignee.userName}.`, entityId: chamadoId };
  }

  if (input.action.actionType === "ADD_TICKET_ACTIVITY") {
    const prefix = args.isInternal === true ? "[Nota interna] " : "";
    const activity = await dependencies.registerManualTicketActivity({
      chamadoId,
      clientId: input.clientId,
      description: `${prefix}${stringValue(args, "noteContent")}`,
      actor,
    });
    return { success: true, message: "Atividade registrada com sucesso.", entityId: activity.id };
  }

  throw new Error("HERMES_ACTION_TYPE_NOT_ALLOWED");
}
