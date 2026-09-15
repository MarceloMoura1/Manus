import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { updateChamadoWithActivity, updateCollaboratorsWithActivities } from "./chamados-domain";

const actor = { userId: "operator-a", userName: "Marcelo Moura" };
const ticket = {
  chamadoId: "ticket-1",
  clientId: "tenant-a",
  customerId: "customer-a",
  customerName: "Ana Cliente",
  customerPhone: null,
  customerEmail: null,
  customerCNPJ: null,
  company: "Empresa A",
  title: "Título anterior",
  observations: "Observação anterior",
  status: "open",
  priority: "media",
  assignedTo: "Suporte",
  assignedToUserId: "support",
};

function memoryPool(options: {
  current?: Record<string, unknown>;
  collaborators?: Array<{ userId: string; userName: string }>;
  users?: Array<{ userId: string; userName: string }>;
} = {}) {
  const events: Array<{ actionType: string; metadata: unknown; actorUserId: string; attendant: string; clientId: string }> = [];
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM megadesk_domain_chamados")) return [[options.current ?? ticket]];
      if (sql.includes("FROM megadesk_domain_chamado_collaborators")) return [options.collaborators ?? []];
      if (sql.includes("FROM megadesk_domain_client_users")) return [options.users ?? []];
      if (sql.includes("INSERT INTO megadesk_domain_chamado_activities")) {
        events.push({
          actionType: String(params[6]),
          metadata: JSON.parse(String(params[7])),
          attendant: String(params[4]),
          actorUserId: String(params[5]),
          clientId: String(params[2]),
        });
      }
      return [{ affectedRows: 1 }];
    }),
  };
  return {
    events,
    connection,
    pool: { getConnection: vi.fn(async () => connection) } as unknown as Pool,
  };
}

describe("chamados domain activity audit", () => {
  it("records one status event with the canonical tenant actor", async () => {
    const memory = memoryPool();

    await updateChamadoWithActivity({ chamadoId: "ticket-1", clientId: "tenant-a", actor, mode: "status", updates: { status: "in_progress" } }, memory.pool);

    expect(memory.events).toEqual([expect.objectContaining({
      actionType: "status_changed",
      metadata: { eventType: "status_changed", fromStatus: "open", toStatus: "in_progress" },
      attendant: "Marcelo Moura",
      actorUserId: "operator-a",
      clientId: "tenant-a",
    })]);
  });

  it("audits a changed observation alongside status without duplicating status in the edit event", async () => {
    const memory = memoryPool();

    await updateChamadoWithActivity({ chamadoId: "ticket-1", clientId: "tenant-a", actor, mode: "status", updates: { status: "closed", observations: "Resolução registrada" } }, memory.pool);

    expect(memory.events.map(event => event.actionType)).toEqual(["status_changed", "ticket_edited"]);
    expect(memory.events[1]?.metadata).toEqual({
      eventType: "ticket_edited",
      changes: [{ field: "observations", from: "Observação anterior", to: "Resolução registrada" }],
    });
  });

  it("records only the status event when the accompanying observation is unchanged", async () => {
    const memory = memoryPool();

    await updateChamadoWithActivity({ chamadoId: "ticket-1", clientId: "tenant-a", actor, mode: "status", updates: { status: "closed", observations: "Observação anterior" } }, memory.pool);

    expect(memory.events.map(event => event.actionType)).toEqual(["status_changed"]);
  });

  it("groups a multi-field edit into one event with customer and priority snapshots", async () => {
    const memory = memoryPool();

    await updateChamadoWithActivity({
      chamadoId: "ticket-1",
      clientId: "tenant-a",
      actor,
      mode: "edit",
      updates: { customerId: "customer-b", customerName: "Bia Cliente", company: "Empresa B", title: "Novo título", observations: "Nova observação", priority: "alta" },
    }, memory.pool);

    expect(memory.events.map(event => event.actionType)).toEqual(["ticket_edited"]);
    expect(memory.events[0]?.metadata).toEqual({
      eventType: "ticket_edited",
      changes: [
        { field: "customer", from: "Empresa A", to: "Empresa B", fromId: "customer-a", toId: "customer-b" },
        { field: "title", from: "Título anterior", to: "Novo título" },
        { field: "observations", from: "Observação anterior", to: "Nova observação" },
        { field: "priority", from: "media", to: "alta" },
      ],
    });
  });

  it("records forwarding and additional changed fields as separate, non-duplicated events", async () => {
    const memory = memoryPool();

    await updateChamadoWithActivity({
      chamadoId: "ticket-1",
      clientId: "tenant-a",
      actor,
      mode: "forward",
      updates: { assignedToUserId: "finance", assignedTo: "Financeiro", title: "Título financeiro" },
    }, memory.pool);

    expect(memory.events.map(event => event.actionType)).toEqual(["ticket_forwarded", "ticket_edited"]);
    expect(memory.events[0]?.metadata).toMatchObject({ eventType: "ticket_forwarded", fromAssigneeId: "support", fromAssigneeName: "Suporte", toAssigneeId: "finance", toAssigneeName: "Financeiro" });
    expect(memory.events[1]?.metadata).toEqual({ eventType: "ticket_edited", changes: [{ field: "title", from: "Título anterior", to: "Título financeiro" }] });
  });

  it("records collaborator snapshots for removals and additions", async () => {
    const memory = memoryPool({
      collaborators: [{ userId: "old-user", userName: "João Silva" }],
      users: [{ userId: "new-user", userName: "Ana Souza" }],
    });

    await updateCollaboratorsWithActivities({ chamadoId: "ticket-1", clientId: "tenant-a", collaboratorIds: ["new-user"], actor }, memory.pool);

    expect(memory.events.map(event => event.actionType)).toEqual(["collaborator_removed", "collaborator_added"]);
    expect(memory.events.map(event => event.metadata)).toEqual([
      { eventType: "collaborator_removed", collaboratorId: "old-user", collaboratorName: "João Silva" },
      { eventType: "collaborator_added", collaboratorId: "new-user", collaboratorName: "Ana Souza" },
    ]);
  });
});
