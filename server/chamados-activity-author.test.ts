import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "./_core/trpc";
import { chamadosRouter } from "./routers-chamados";

const chamadoId = "11111111-1111-4111-8111-111111111111";

const chamadosDb = vi.hoisted(() => ({
  createChamado: vi.fn(),
  getChamadoWithActivities: vi.fn(),
  listChamados: vi.fn(),
  countChamados: vi.fn(),
  getStatusCounts: vi.fn(),
  createChamadoWithActivity: vi.fn(),
  updateChamadoWithActivity: vi.fn(),
  updateChamado: vi.fn(),
  addActivityToChamado: vi.fn(),
  editActivity: vi.fn(),
  getCollaborators: vi.fn(),
  addCollaborator: vi.fn(),
  removeCollaborator: vi.fn(),
  updateCollaborators: vi.fn(),
  registerActivity: vi.fn(),
  addAttachment: vi.fn(),
  getAttachments: vi.fn(),
  updateCollaboratorsWithActivities: vi.fn(),
  registerManualTicketActivity: vi.fn(),
  uploadTicketAttachment: vi.fn(),
  listTicketAttachments: vi.fn(),
  logicallyRemoveTicketAttachment: vi.fn(),
  getCustomerChamadoHistory: vi.fn(),
  getActiveClientUser: vi.fn(),
}));

vi.mock("./db-chamados", () => chamadosDb);
vi.mock("./db-crm", () => ({
  getCrmClientById: vi.fn(),
  listCrmClients: vi.fn(),
}));

const createCaller = createCallerFactory(chamadosRouter);

function callerFor(tenantId: string, operationalUserId: string) {
  return createCaller({
    user: { id: "browser-user", name: "Atendente" },
    tenantId,
    operationalUserId,
    operationalUserRole: "agent",
    userEmail: "atendente@example.invalid",
    req: {} as any,
    res: {} as any,
  });
}

describe("chamados activity author", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadosDb.getActiveClientUser.mockImplementation(async (tenantId: string, userId: string) => (
      tenantId === "tenant-a" && userId === "operator-a"
        ? { userId: "operator-a", userName: "Marcelo Moura" }
        : null
    ));
    chamadosDb.registerManualTicketActivity.mockResolvedValue({ id: "activity-1" });
    chamadosDb.logicallyRemoveTicketAttachment.mockResolvedValue({ logicallyRemoved: true, state: "pending_delete", reused: false });
    chamadosDb.getChamadoWithActivities.mockResolvedValue({
      id: chamadoId,
      collaborators: [],
      activities: [],
    });
  });

  it("persists the real tenant-scoped operational author for registered activities", async () => {
    await callerFor("tenant-a", "operator-a").registerActivity({
      chamadoId,
      description: "Contato registrado",
      actionType: "note",
    });

    expect(chamadosDb.getActiveClientUser).toHaveBeenCalledWith("tenant-a", "operator-a");
    expect(chamadosDb.registerManualTicketActivity).toHaveBeenCalledWith({
      chamadoId,
      clientId: "tenant-a",
      description: "Contato registrado",
      actor: { userId: "operator-a", userName: "Marcelo Moura" },
    });
  });

  it("ignores a browser-supplied author and uses the canonical operational user", async () => {
    await callerFor("tenant-a", "operator-a").addActivity({
      chamadoId,
      description: "Encaminhamento registrado",
      attendant: "Outro usuário",
    });

    expect(chamadosDb.registerManualTicketActivity).toHaveBeenCalledWith({
      chamadoId,
      clientId: "tenant-a",
      description: "Encaminhamento registrado",
      actor: { userId: "operator-a", userName: "Marcelo Moura" },
    });
  });

  it("never resolves an author from another tenant", async () => {
    await expect(callerFor("tenant-b", "operator-a").registerActivity({
      chamadoId,
      description: "Tentativa entre tenants",
      actionType: "note",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(chamadosDb.getActiveClientUser).toHaveBeenCalledWith("tenant-b", "operator-a");
    expect(chamadosDb.registerManualTicketActivity).not.toHaveBeenCalled();
  });

  it("uses the canonical tenant-scoped actor for logical attachment removal", async () => {
    await expect(callerFor("tenant-a", "operator-a").removeAttachment({ chamadoId, attachmentId: "22222222-2222-4222-8222-222222222222" }))
      .resolves.toMatchObject({ logicallyRemoved: true, state: "pending_delete", reused: false });
    expect(chamadosDb.logicallyRemoveTicketAttachment).toHaveBeenCalledWith({
      chamadoId,
      attachmentId: "22222222-2222-4222-8222-222222222222",
      clientId: "tenant-a",
      actor: { userId: "operator-a", userName: "Marcelo Moura" },
    });
  });
});
