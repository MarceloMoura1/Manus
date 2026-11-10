import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks
const mockEvoSendText = vi.fn();
vi.mock("../../evolution/client", () => ({
  evoSendText: (...args: any[]) => mockEvoSendText(...args),
}));

vi.mock("../../evolution/session-store", () => ({
  instanceNameFor: (id: string) => `megadesk-${id}`,
}));

const mockSendTextMessage = vi.fn();
vi.mock("../whatsapp/meta/graph-api", () => ({
  sendTextMessage: (...args: any[]) => mockSendTextMessage(...args),
}));

const mockListWaAccounts = vi.fn();
vi.mock("../whatsapp/repositories/whatsapp.repo", () => ({
  listWaAccounts: (...args: any[]) => mockListWaAccounts(...args),
}));

const mockEmitOperationalTenantEvent = vi.fn();
vi.mock("../whatsapp/socket/whatsapp.socket", () => ({
  emitOperationalTenantEvent: (...args: any[]) => mockEmitOperationalTenantEvent(...args),
}));

const mockPoolExecute = vi.fn();
vi.mock("../../db", () => ({
  getPool: () => ({
    execute: (...args: any[]) => mockPoolExecute(...args),
  }),
  validateMegaDeskClientToken: vi.fn().mockImplementation((clientId, token) => {
    if (token === "valid-token") return Promise.resolve({ clientId, company: "Test Co" });
    return Promise.resolve(null);
  }),
}));

import { BotDispatcherService } from "./bot-dispatcher.service";
import {
  handleTypebotWebhook,
  handleGetProducts,
  handleGetTickets,
  handleCreateOrUpdateLead,
  queryErpProducts,
  queryTicketsByPhone,
  saveLead,
} from "./bot.router";
import { executeHermesErpAction } from "../../hermes-erp-actions";

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: undefined,
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((data: unknown) => {
    res.body = data;
    return res;
  });
  return res;
}

describe("BotDispatcherService", () => {
  let dispatcher: BotDispatcherService;

  beforeEach(() => {
    vi.clearAllMocks();
    dispatcher = new BotDispatcherService();
  });

  it("deve enviar mensagem com sucesso via Evolution API", async () => {
    mockEvoSendText.mockResolvedValueOnce({ key: { id: "msg-123" } });

    await dispatcher.sendMessage("tenant-1", "+55 (41) 99999-8888", "Olá do bot!", "evolution");

    expect(mockEvoSendText).toHaveBeenCalledWith(
      "megadesk-tenant-1",
      "5541999998888",
      "Olá do bot!"
    );
  });

  it("deve enviar mensagem via Meta Cloud API quando houver conta ativa", async () => {
    mockListWaAccounts.mockResolvedValueOnce([
      {
        id: "acc-1",
        status: "active",
        phoneNumberId: "phone-id-123",
        accessToken: "token-abc",
      },
    ]);
    mockSendTextMessage.mockResolvedValueOnce({ messages: [{ id: "meta-msg-1" }] });

    await dispatcher.sendMessage("tenant-1", "5541999998888", "Mensagem oficial", "meta_cloud");

    expect(mockSendTextMessage).toHaveBeenCalledWith(
      "phone-id-123",
      "token-abc",
      "5541999998888",
      "Mensagem oficial"
    );
  });

  it("deve rejeitar se tenantId ou toPhone forem inválidos", async () => {
    await expect(dispatcher.sendMessage("", "5541999998888", "Teste", "evolution")).rejects.toThrow(
      "tenantId é obrigatório"
    );
    await expect(dispatcher.sendMessage("tenant-1", "", "Teste", "evolution")).rejects.toThrow(
      "toPhone é obrigatório"
    );
    await expect(dispatcher.sendMessage("tenant-1", "5541999998888", "", "evolution")).rejects.toThrow(
      "text não pode ser vazio"
    );
  });

  it("deve falhar para provedor não suportado", async () => {
    await expect(
      dispatcher.sendMessage("tenant-1", "5541999998888", "Teste", "unsupported" as any)
    ).rejects.toThrow("Provedor não suportado");
  });
});

describe("Bot Router Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handleTypebotWebhook - deve processar transfer_to_human e silenciar bot", async () => {
    mockPoolExecute
      .mockResolvedValueOnce([[{ conversation_id: "conv-123" }]]) // busca conversa por telefone
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // update silenciando bot

    const req: any = {
      headers: {},
      query: {},
      body: {
        action: "transfer_to_human",
        clientId: "tenant-1",
        phone: "5541999998888",
        reason: "Cliente solicitou suporte humano",
      },
    };
    const res = createMockResponse();

    await handleTypebotWebhook(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      action: "transfer_to_human",
      status: "waiting_human",
      conversationId: "conv-123",
    });

    expect(mockEmitOperationalTenantEvent).toHaveBeenCalledWith(
      "tenant-1",
      "wa:transfer_to_human",
      expect.objectContaining({
        conversationId: "conv-123",
        status: "AGUARDANDO_HUMANO",
      })
    );
  });

  it("handleGetProducts - deve retornar produtos e estoque no formato esperado", async () => {
    mockPoolExecute.mockResolvedValueOnce([
      [
        { name: "Teclado Mecânico", price: "250.00", stock_quantity: 15 },
        { name: "Mouse Sem Fio", price: "120.50", stock_quantity: 0 },
      ],
    ]);

    const req: any = {
      headers: { "x-tenant-id": "tenant-1" },
      query: { search: "Teclado" },
      body: {},
    };
    const res = createMockResponse();

    await handleGetProducts(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      { name: "Teclado Mecânico", price: 250, inStock: true },
      { name: "Mouse Sem Fio", price: 120.5, inStock: false },
    ]);
  });

  it("handleGetTickets - deve retornar últimos chamados com status formatado", async () => {
    mockPoolExecute.mockResolvedValueOnce([
      [
        {
          id: "chamado-uuid-1",
          number: 104,
          title: "Sem conexão com internet",
          status: "in_progress",
          createdAt: "2026-11-10T02:00:00.000Z",
        },
      ],
    ]);

    const req: any = {
      headers: {},
      query: { clientId: "tenant-1", phone: "41999998888" },
      body: {},
    };
    const res = createMockResponse();

    await handleGetTickets(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      {
        id: "chamado-uuid-1",
        number: 104,
        title: "Sem conexão com internet",
        status: "Em Andamento",
        statusRaw: "in_progress",
        createdAt: "2026-11-10T02:00:00.000Z",
      },
    ]);
  });

  it("handleCreateOrUpdateLead - deve criar novo lead no CRM", async () => {
    mockPoolExecute
      .mockResolvedValueOnce([[]]) // nenhum lead existente
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // insert novo lead

    const req: any = {
      headers: {},
      query: {},
      body: {
        clientId: "tenant-1",
        name: "João Silva",
        phone: "41988887777",
        email: "joao@exemplo.com",
        notes: "Interessado no plano Pro",
      },
    };
    const res = createMockResponse();

    await handleCreateOrUpdateLead(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      action: "created",
      lead: {
        name: "João Silva",
        phone: "41988887777",
        email: "joao@exemplo.com",
      },
    });
  });

  it("queryErpProducts - deve buscar produtos formatados", async () => {
    mockPoolExecute.mockResolvedValueOnce([
      [
        { name: "Cabo de Rede Cat6", price: "45.00", stock_quantity: 10 },
      ],
    ]);

    const res = await queryErpProducts("tenant-1", "Cabo");
    expect(res).toEqual([
      { name: "Cabo de Rede Cat6", price: 45, inStock: true },
    ]);
  });

  it("queryTicketsByPhone - deve retornar chamados formatados", async () => {
    mockPoolExecute.mockResolvedValueOnce([
      [
        {
          id: "ticket-1",
          number: 101,
          title: "Sem internet",
          status: "open",
          createdAt: new Date("2026-11-10T00:00:00.000Z"),
        },
      ],
    ]);

    const res = await queryTicketsByPhone("tenant-1", "41999998888");
    expect(res).toHaveLength(1);
    expect(res[0].title).toBe("Sem internet");
    expect(res[0].status).toBe("Aberto");
  });

  it("saveLead - deve atualizar lead se já existir por telefone", async () => {
    mockPoolExecute
      .mockResolvedValueOnce([[{ crm_client_id: "lead-existing-1" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await saveLead("tenant-1", {
      name: "Maria Santos",
      phone: "41999991111",
      email: "maria@empresa.com",
    });

    expect(res.ok).toBe(true);
    expect(res.action).toBe("updated");
    expect(res.lead.crmClientId).toBe("lead-existing-1");
  });

  it("BotDispatcherService.sendTextMessage - deve enviar via Evolution quando provider for evolution", async () => {
    mockListWaAccounts.mockResolvedValueOnce([{ provider: "evolution", instance_name: "megadesk-tenant-1" }]);
    mockEvoSendText.mockResolvedValueOnce({ key: { id: "msg-123" } });

    const dispatcher = new BotDispatcherService();
    await dispatcher.sendTextMessage({
      tenantId: "tenant-1",
      to: "5541999998888",
      text: "Olá!",
    });

    expect(mockEvoSendText).toHaveBeenCalledWith("megadesk-tenant-1", "5541999998888", "Olá!");
  });

  it("executeHermesErpAction - SEND_WHATSAPP_OUTBOUND deve disparar mensagens e registrar conversa", async () => {
    mockListWaAccounts.mockResolvedValue([{ provider: "evolution", instance_name: "megadesk-tenant-1" }]);
    mockEvoSendText.mockResolvedValue({ key: { id: "msg-123" } });
    mockPoolExecute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await executeHermesErpAction({
      tenantId: "tenant-1",
      userId: "user-1",
      userName: "Marcelo",
      role: "admin",
      action: {
        actionType: "SEND_WHATSAPP_OUTBOUND",
        args: {
          recipients: [{ name: "Fornecedor Alfa", phone: "5541999990001" }],
          message: "Prezado, solicitamos cotação de cabos.",
          category: "Cotação",
        },
      },
    });

    expect(res.success).toBe(true);
    expect(res.message).toContain("fornecedores");
    expect(mockEvoSendText).toHaveBeenCalledWith(
      "megadesk-tenant-1",
      "5541999990001",
      "Prezado, solicitamos cotação de cabos."
    );
  });
});
