import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "./_core/trpc";
import { chamadosRouter } from "./routers-chamados";

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
  updateCollaboratorsWithActivities: vi.fn(),
  registerActivity: vi.fn(),
  registerManualTicketActivity: vi.fn(),
  addAttachment: vi.fn(),
  getAttachments: vi.fn(),
  uploadTicketAttachment: vi.fn(),
  listTicketAttachments: vi.fn(),
  getCustomerChamadoHistory: vi.fn(),
  getActiveClientUser: vi.fn(),
}));

vi.mock("./db-chamados", () => chamadosDb);

const createCaller = createCallerFactory(chamadosRouter);

function makeContext() {
  return {
    user: null as any,
    tenantId: "tenant-listing",
    operationalUserId: "operator-marcelo",
    operationalUserRole: "agent",
    userEmail: "marcelo@example.invalid",
    req: {} as any,
    res: {} as any,
  };
}

describe("chamados listing contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadosDb.updateChamadoWithActivity.mockImplementation(async (input: any) => chamadosDb.updateChamado(input.chamadoId, input.clientId, input.updates));
    chamadosDb.listChamados.mockResolvedValue([{ id: "ticket-1", number: 42 }]);
    chamadosDb.countChamados.mockResolvedValue(41);
    chamadosDb.getStatusCounts.mockResolvedValue({ total: 41, open: 16, in_progress: 10, waiting: 9, closed: 6 });
  });

  it("delegates scope, search and sort to the backend before pagination", async () => {
    const result = await createCaller(makeContext()).list({
      status: "open",
      limit: 20,
      offset: 40,
      scope: "mine",
      search: "Empresa Exemplo",
      sortBy: "priority",
      sortDirection: "asc",
    });

    expect(chamadosDb.listChamados).toHaveBeenCalledWith(
      "tenant-listing",
      "open",
      20,
      40,
      {
        scope: "mine",
        operationalUserId: "operator-marcelo",
        search: "Empresa Exemplo",
        sortBy: "priority",
        sortDirection: "asc",
      },
    );
    expect(chamadosDb.countChamados).toHaveBeenCalledWith(
      "tenant-listing",
      "open",
      {
        scope: "mine",
        operationalUserId: "operator-marcelo",
        search: "Empresa Exemplo",
      },
    );
    expect(result).toMatchObject({ total: 41, limit: 20, offset: 40 });
  });

  it("gets the five-card aggregate for the same canonical scope", async () => {
    const counts = await createCaller(makeContext()).getStatusCounts({ scope: "mine" });

    expect(chamadosDb.getStatusCounts).toHaveBeenCalledWith(
      "tenant-listing",
      "mine",
      "operator-marcelo",
    );
    expect(counts).toEqual({ total: 41, open: 16, in_progress: 10, waiting: 9, closed: 6 });
  });

  it("updates the display snapshot and canonical assignee together during a transfer", async () => {
    chamadosDb.getActiveClientUser.mockResolvedValue({ userId: "operator-cristiano", userName: "Cristiano Costa" });
    chamadosDb.getChamadoWithActivities.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });

    await createCaller(makeContext()).update({
      chamadoId: "11111111-1111-4111-8111-111111111111",
      assignedToUserId: "operator-cristiano",
    });

    expect(chamadosDb.updateChamado).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "tenant-listing",
      { assignedTo: "Cristiano Costa", assignedToUserId: "operator-cristiano" },
    );
  });
});
