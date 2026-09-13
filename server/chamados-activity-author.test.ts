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
    chamadosDb.registerActivity.mockResolvedValue({ id: "activity-1" });
    chamadosDb.addActivityToChamado.mockResolvedValue(undefined);
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
    expect(chamadosDb.registerActivity).toHaveBeenCalledWith(
      chamadoId,
      "tenant-a",
      "Contato registrado",
      "Marcelo Moura",
      "note",
    );
  });

  it("ignores a browser-supplied author and uses the canonical operational user", async () => {
    await callerFor("tenant-a", "operator-a").addActivity({
      chamadoId,
      description: "Encaminhamento registrado",
      attendant: "Outro usuário",
    });

    expect(chamadosDb.addActivityToChamado).toHaveBeenCalledWith(
      chamadoId,
      "tenant-a",
      "Encaminhamento registrado",
      "Marcelo Moura",
    );
  });

  it("never resolves an author from another tenant", async () => {
    await expect(callerFor("tenant-b", "operator-a").registerActivity({
      chamadoId,
      description: "Tentativa entre tenants",
      actionType: "note",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(chamadosDb.getActiveClientUser).toHaveBeenCalledWith("tenant-b", "operator-a");
    expect(chamadosDb.registerActivity).not.toHaveBeenCalled();
  });
});
