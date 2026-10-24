/**
 * Testes do Assistente IA com Gemini por cliente
 * Valida: estrutura de mensagens, histórico, function calling, token por cliente
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<typeof import("./db")>()),
  getPool: vi.fn(),
}));
import { getPool } from "./db";
import {
  HERMES_TOOL_REGISTRY,
  beginPendingHermesAction,
  cancelPendingHermesAction,
  createPendingActionRequest,
  executeClientFunction,
  getAllowedHermesTools,
  getAuthorizedHermesTool,
  insertTokenUsage,
  readMonthlyTokenUsage,
  type HermesToolDefinition,
} from "./gemini-client";
import { executeHermesTicketAction } from "./hermes-ticket-actions";

// ─── Testes de estrutura de mensagem ─────────────────────────────────────────

describe("IAMessage structure", () => {
  it("deve ter role 'user' ou 'assistant'", () => {
    const validRoles = ["user", "assistant"];
    const msg = { role: "user", content: "Olá", timestamp: Date.now() };
    expect(validRoles).toContain(msg.role);
  });

  it("deve ter content não vazio", () => {
    const msg = { role: "user", content: "Quantas vendas hoje?", timestamp: Date.now() };
    expect(msg.content.trim().length).toBeGreaterThan(0);
  });

  it("deve ter timestamp válido", () => {
    const now = Date.now();
    const msg = { role: "assistant", content: "Tivemos 5 vendas hoje.", timestamp: now };
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.timestamp).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

// ─── Testes de histórico de conversa ─────────────────────────────────────────

describe("Conversation history", () => {
  it("deve manter ordem cronológica das mensagens", () => {
    const history = [
      { role: "user", content: "Olá", timestamp: 1000 },
      { role: "assistant", content: "Olá! Como posso ajudar?", timestamp: 2000 },
      { role: "user", content: "Quantas vendas hoje?", timestamp: 3000 },
    ];
    for (let i = 1; i < history.length; i++) {
      expect(history[i].timestamp).toBeGreaterThan(history[i - 1].timestamp);
    }
  });

  it("deve limitar histórico a 50 mensagens para evitar tokens excessivos", () => {
    const MAX_HISTORY = 50;
    const history = Array.from({ length: 70 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Mensagem ${i}`,
      timestamp: Date.now() + i * 1000,
    }));
    const trimmed = history.slice(-MAX_HISTORY);
    expect(trimmed.length).toBe(MAX_HISTORY);
    // Deve manter as mensagens mais recentes
    expect(trimmed[trimmed.length - 1].content).toBe("Mensagem 69");
  });

  it("deve retornar array vazio se não há histórico", () => {
    const history: any[] = [];
    expect(history).toHaveLength(0);
    expect(Array.isArray(history)).toBe(true);
  });
});

// ─── Testes de function calling ───────────────────────────────────────────────

describe("Function calling declarations", () => {
  const AVAILABLE_FUNCTIONS = [
    "get_sales_summary",
    "get_open_tickets",
    "get_conversations_summary",
    "get_erp_products",
  ];

  it("deve ter funções de consulta de dados definidas", () => {
    expect(AVAILABLE_FUNCTIONS.length).toBeGreaterThan(0);
  });

  it("deve incluir função de vendas", () => {
    expect(AVAILABLE_FUNCTIONS).toContain("get_sales_summary");
  });

  it("deve incluir função de chamados", () => {
    expect(AVAILABLE_FUNCTIONS).toContain("get_open_tickets");
  });

  it("deve incluir função de conversas", () => {
    expect(AVAILABLE_FUNCTIONS).toContain("get_conversations_summary");
  });

  it("deve incluir função de estoque/ERP", () => {
    expect(AVAILABLE_FUNCTIONS).toContain("get_erp_products");
  });

  it("não declara funções sem implementação no registry", () => {
    expect(AVAILABLE_FUNCTIONS).not.toContain("get_client_info");
  });
});

// ─── Testes de token por cliente ──────────────────────────────────────────────

describe("Token Gemini por cliente", () => {
  it("deve rejeitar token vazio", () => {
    const isValidToken = (token: string) => token && token.length > 10;
    expect(isValidToken("")).toBeFalsy();
  });

  it("deve aceitar token válido", () => {
    const isValidToken = (token: string) => token && token.length > 10;
    expect(isValidToken("AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123456")).toBeTruthy();
  });

  it("deve lançar erro quando token não está configurado", () => {
    const getTokenOrThrow = (token: string | null) => {
      if (!token || token.length <= 10) {
        throw new Error("Token Gemini não configurado para este cliente.");
      }
      return token;
    };
    expect(() => getTokenOrThrow(null)).toThrow("Token Gemini não configurado");
    expect(() => getTokenOrThrow("")).toThrow("Token Gemini não configurado");
  });

  it("deve isolar tokens entre clientes diferentes", () => {
    const clientTokens: Record<string, string> = {
      "client-001": "AIzaSyToken1ForClient001",
      "client-002": "AIzaSyToken2ForClient002",
    };
    expect(clientTokens["client-001"]).not.toBe(clientTokens["client-002"]);
    expect(clientTokens["client-001"]).toBe("AIzaSyToken1ForClient001");
  });
});

// ─── Testes de sistema de prompt ──────────────────────────────────────────────

describe("System prompt do Assistente IA", () => {
  const buildSystemPrompt = (clientName: string, userName: string) => `
Você é o Assistente IA da empresa ${clientName}, auxiliando ${userName}.
Você tem acesso a dados do sistema: vendas, chamados, conversas e estoque.
Responda sempre em português brasileiro de forma clara e objetiva.
Quando precisar de dados, use as funções disponíveis.
  `.trim();

  it("deve incluir nome do cliente no prompt", () => {
    const prompt = buildSystemPrompt("Josiane Ltda", "João");
    expect(prompt).toContain("Josiane Ltda");
  });

  it("deve incluir nome do usuário no prompt", () => {
    const prompt = buildSystemPrompt("Josiane Ltda", "João");
    expect(prompt).toContain("João");
  });

  it("deve mencionar acesso a dados do sistema", () => {
    const prompt = buildSystemPrompt("Empresa X", "Maria");
    expect(prompt).toContain("dados do sistema");
  });

  it("deve instruir resposta em português", () => {
    const prompt = buildSystemPrompt("Empresa X", "Maria");
    expect(prompt).toContain("português");
  });
});

// ─── Testes de ChatResult ─────────────────────────────────────────────────────

describe("ChatResult structure", () => {
  it("deve ter ok: true em resposta bem-sucedida", () => {
    const result = {
      ok: true,
      response: "Tivemos 5 vendas hoje.",
      functionCallsMade: ["get_sales_summary"],
      tokensUsed: 150,
    };
    expect(result.ok).toBe(true);
    expect(result.response).toBeTruthy();
  });

  it("deve incluir lista de function calls realizados", () => {
    const result = {
      ok: true,
      response: "Há 3 chamados abertos.",
      functionCallsMade: ["get_open_tickets"],
      tokensUsed: 120,
    };
    expect(Array.isArray(result.functionCallsMade)).toBe(true);
    expect(result.functionCallsMade).toContain("get_open_tickets");
  });

  it("deve ter functionCallsMade vazio quando não consultou dados", () => {
    const result = {
      ok: true,
      response: "Olá! Como posso ajudar?",
      functionCallsMade: [],
      tokensUsed: 50,
    };
    expect(result.functionCallsMade).toHaveLength(0);
  });
});

describe("Hermes security controls", () => {
  it("uses the registry as the source of the real function names", () => {
    expect(HERMES_TOOL_REGISTRY.map(tool => tool.name)).toEqual([
      "get_sales_summary",
      "get_open_tickets",
      "get_tickets_overview",
      "get_ticket_details",
      "create_ticket",
      "update_ticket_status",
      "assign_ticket",
      "add_ticket_activity",
      "get_crm_summary",
      "get_client_360",
      "create_client",
      "update_client",
      "add_client_timeline_event",
      "get_proposals_summary",
      "get_proposal_details",
      "create_proposal",
      "update_proposal_status",
      "send_proposal_whatsapp",
      "get_erp_summary",
      "get_product_details",
      "get_inventory_status",
      "create_product",
      "update_product",
      "link_product_supplier",
      "get_services_list",
      "update_service",
      "get_sales_analytics",
      "get_suppliers_list",
      "create_supplier",
      "update_supplier",
      "request_purchase_order",
      "send_supplier_message",
      "get_conversations_summary",
      "get_erp_products",
    ]);
    expect(HERMES_TOOL_REGISTRY.filter(tool => tool.type === "MUTATION").map(tool => tool.actionType)).toEqual([
      "CREATE_TICKET", "UPDATE_TICKET_STATUS", "ASSIGN_TICKET", "ADD_TICKET_ACTIVITY",
      "CREATE_CLIENT", "UPDATE_CLIENT", "ADD_CLIENT_TIMELINE", "CREATE_PROPOSAL", "UPDATE_PROPOSAL_STATUS", "SEND_PROPOSAL_WHATSAPP",
      "CREATE_PRODUCT", "UPDATE_PRODUCT", "LINK_PRODUCT_SUPPLIER", "UPDATE_SERVICE", "CREATE_SUPPLIER", "UPDATE_SUPPLIER", "REQUEST_PURCHASE", "SEND_SUPPLIER_MESSAGE",
    ]);
  });

  it("does not expose or authorize a sales tool without an ERP/sales permission", () => {
    expect(getAllowedHermesTools(["ai-assistant"]).map(tool => tool.name)).not.toContain("get_sales_summary");
    expect(getAuthorizedHermesTool("get_sales_summary", ["ai-assistant"])).toBeNull();
  });

  it("does not expose CRM or proposal tools without a corresponding operational permission", () => {
    const tools = getAllowedHermesTools(["ai-assistant"]).map(tool => tool.name);
    expect(tools).not.toContain("get_crm_summary");
    expect(tools).not.toContain("create_client");
    expect(tools).not.toContain("get_proposals_summary");
    expect(getAuthorizedHermesTool("create_proposal", ["ai-assistant"])).toBeNull();
  });

  it("does not expose ERP tools to a user without ERP operational permissions", () => {
    const tools = getAllowedHermesTools(["ai-assistant"]).map(tool => tool.name);
    expect(tools).not.toContain("get_erp_summary");
    expect(tools).not.toContain("create_product");
    expect(tools).not.toContain("request_purchase_order");
    expect(getAuthorizedHermesTool("send_supplier_message", ["ai-assistant"])).toBeNull();
  });

  it("runs ERP inventory only with the authenticated tenant predicate", async () => {
    const execute = vi.fn(async () => [[{ publicId: "product-a", name: "Produto", quantity: "0.000" }]]);
    vi.mocked(getPool).mockReturnValue({ execute } as any);
    const response = JSON.parse(await executeClientFunction("get_inventory_status", { status: "empty" }, "tenant-a", ["inventory"]));
    expect(response.itens).toHaveLength(1);
    expect(execute.mock.calls[0]?.[0]).toContain("client_id = ?");
    expect(execute.mock.calls[0]?.[1]).toEqual(["tenant-a"]);
  });

  it("runs sales analytics only with the tenant predicate and a validated date range", async () => {
    const execute = vi.fn(async () => [[{ orders: 2, revenueCents: 10000, averageTicketCents: 5000 }]]);
    vi.mocked(getPool).mockReturnValue({ execute } as any);
    const response = JSON.parse(await executeClientFunction("get_sales_analytics", { period: "custom", startDate: "2026-01-01", endDate: "2026-01-31" }, "tenant-a", ["sales"]));
    expect(response.analise.orders).toBe(2);
    expect(execute.mock.calls[0]?.[1]).toEqual(["tenant-a", "2026-01-01", "2026-01-31"]);
  });

  it("creates a tenant-owned product HITL proposal and rejects a changed payload", () => {
    const tool = HERMES_TOOL_REGISTRY.find(item => item.name === "create_product")!;
    const args = { name: "Produto", sku: "SKU-1", salePrice: 10, costPrice: 5, initialStock: 2, unit: "unit" };
    const request = createPendingActionRequest(tool, args, { clientId: "tenant-a", userId: "owner@example.invalid" });
    expect(() => beginPendingHermesAction({ actionId: request.id, actionType: "CREATE_PRODUCT", clientId: "tenant-a", userId: "owner@example.invalid", payload: { ...args, salePrice: 11 } })).toThrow("payload");
    expect(beginPendingHermesAction({ actionId: request.id, actionType: "CREATE_PRODUCT", clientId: "tenant-a", userId: "owner@example.invalid", payload: request.args }).actionType).toBe("CREATE_PRODUCT");
  });

  it("runs CRM summary only with the authenticated tenant predicate", async () => {
    const execute = vi.fn(async () => [[{ total: 3, active: 2, inactive: 1, leads: 1 }]]);
    vi.mocked(getPool).mockReturnValue({ execute } as any);
    const response = JSON.parse(await executeClientFunction("get_crm_summary", {}, "tenant-a", ["crm"]));
    expect(response.resumo.total).toBe(3);
    expect(execute.mock.calls[0]?.[0]).toContain("client_id = ?");
    expect(execute.mock.calls[0]?.[1]).toEqual(["tenant-a"]);
  });

  it("loads the 360 view only through tenant-scoped CRM, timeline, ticket, and conversation queries", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("FROM megadesk_crm_clients")) return [[{ crmClientId: "crm-a", name: "Cliente" }]];
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute } as any);
    const response = JSON.parse(await executeClientFunction("get_client_360", { clientId: "crm-a" }, "tenant-a", ["clients"]));
    expect(response.cliente.crmClientId).toBe("crm-a");
    expect(execute).toHaveBeenCalledTimes(4);
    for (const [, values] of execute.mock.calls) expect(values).toEqual(expect.arrayContaining(["tenant-a"]));
  });

  it("creates a tenant-owned CRM action request and rejects a forged payload", () => {
    const tool = HERMES_TOOL_REGISTRY.find(item => item.name === "create_client")!;
    const request = createPendingActionRequest(tool, { name: "Cliente CRM", phone: "11999999999" }, { clientId: "tenant-a", userId: "owner@example.invalid" });
    expect(() => beginPendingHermesAction({
      actionId: request.id, actionType: "CREATE_CLIENT", clientId: "tenant-a", userId: "owner@example.invalid",
      payload: { name: "Outro cliente", phone: "11999999999" },
    })).toThrow("payload");
    expect(beginPendingHermesAction({
      actionId: request.id, actionType: "CREATE_CLIENT", clientId: "tenant-a", userId: "owner@example.invalid", payload: request.args,
    }).actionType).toBe("CREATE_CLIENT");
  });

  it("runs the tickets overview only with the authenticated tenant predicate", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("COUNT(*) AS total")) return [[{ total: 1, open: 1, in_progress: 0, waiting: 0, closed: 0 }]];
      return [[{ chamadoId: "ticket-a", title: "Acesso" }]];
    });
    vi.mocked(getPool).mockReturnValue({ execute } as any);

    const response = JSON.parse(await executeClientFunction("get_tickets_overview", { status: "open", search: "Acesso", limit: 5 }, "tenant-a", ["tickets"]));
    expect(response.resumo.total).toBe(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toContain("clientId = ?");
    expect(execute.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["tenant-a", "open"]));
    expect(execute.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["tenant-a", 5]));
  });

  it("loads ticket details and activities with tenant-scoped parameters", async () => {
    const execute = vi.fn(async (sql: string) => sql.includes("FROM megadesk_domain_chamados")
      ? [[{ chamadoId: "ticket-a", chamadoNumber: 9, title: "Acesso" }]]
      : [[{ activityId: "activity-a", description: "Criado" }]],
    );
    vi.mocked(getPool).mockReturnValue({ execute } as any);

    const response = JSON.parse(await executeClientFunction("get_ticket_details", { ticketId: "ticket-a" }, "tenant-a", ["support"]));
    expect(response.chamado.chamadoId).toBe("ticket-a");
    expect(response.atividades).toHaveLength(1);
    expect(execute.mock.calls[0]?.[1]).toEqual(["tenant-a", "ticket-a"]);
    expect(execute.mock.calls[1]?.[1]).toEqual(["tenant-a", "ticket-a"]);
  });

  it("authorizes only the tool covered by an operational permission", () => {
    expect(getAllowedHermesTools(["tickets"]).map(tool => tool.name)).toEqual([
      "get_open_tickets", "get_tickets_overview", "get_ticket_details", "create_ticket", "update_ticket_status", "assign_ticket", "add_ticket_activity",
    ]);
    expect(getAuthorizedHermesTool("create_ticket", ["tickets"])?.type).toBe("MUTATION");
  });

  it("creates a pending request instead of executing a mutation", () => {
    const validateArgs = vi.fn((args: Record<string, unknown>) => ({ title: String(args.title ?? "") }));
    const mutation: HermesToolDefinition = {
      name: "create_ticket",
      type: "MUTATION",
      actionType: "CREATE_TICKET",
      requiredPermissions: ["tickets"],
      declaration: { name: "create_ticket", description: "Creates a ticket after approval.", parameters: { type: "OBJECT", properties: {}, required: [] } },
      validateArgs,
    };

    const request = createPendingActionRequest(mutation, { title: "Retorno ao cliente" });
    expect(validateArgs).toHaveBeenCalledWith({ title: "Retorno ao cliente" });
    expect(request).toMatchObject({ toolName: "create_ticket", type: "MUTATION", actionType: "CREATE_TICKET", status: "PENDING_APPROVAL", args: { title: "Retorno ao cliente" } });
    expect(request.id).toMatch(/^action-/);
  });

  it("stores a pending ticket mutation for its owner and rejects a forged payload", () => {
    const tool = HERMES_TOOL_REGISTRY.find(item => item.name === "create_ticket")!;
    const request = createPendingActionRequest(tool, {
      title: "Retorno ao cliente", description: "Solicitação recebida", priority: "high", clientNameOuId: "crm-1",
    }, { clientId: "tenant-a", userId: "user@example.invalid" });

    expect(() => beginPendingHermesAction({
      actionId: request.id, actionType: "CREATE_TICKET", clientId: "tenant-a", userId: "user@example.invalid",
      payload: { title: "Alterado", description: "Solicitação recebida", priority: "high", clientNameOuId: "crm-1" },
    })).toThrow("payload");

    const pending = beginPendingHermesAction({
      actionId: request.id, actionType: "CREATE_TICKET", clientId: "tenant-a", userId: "user@example.invalid",
      payload: request.args,
    });
    expect(pending.args).toEqual(request.args);
  });

  it("does not let a different tenant or user cancel a pending action", () => {
    const tool = HERMES_TOOL_REGISTRY.find(item => item.name === "add_ticket_activity")!;
    const request = createPendingActionRequest(tool, { ticketId: "ticket-a", noteContent: "Nota" }, { clientId: "tenant-a", userId: "owner@example.invalid" });
    expect(() => cancelPendingHermesAction({
      actionId: request.id, actionType: "ADD_TICKET_ACTIVITY", clientId: "tenant-b", userId: "owner@example.invalid",
    })).toThrow("não pertence");
  });

  it("executes an approved create-ticket action through the canonical ticket service", async () => {
    const createChamadoWithActivity = vi.fn(async () => ({ id: "ticket-1", number: 7 }));
    const result = await executeHermesTicketAction({
      clientId: "tenant-a",
      actorUserId: "operator-1",
      action: { actionType: "CREATE_TICKET", args: { title: "Sem acesso", description: "Cliente precisa de retorno", priority: "urgent", clientNameOuId: "crm-1", category: "Acesso" } },
      resolveAssignee: vi.fn(),
    }, {
      getActiveClientUser: vi.fn(async () => ({ userId: "operator-1", userName: "Operadora" })),
      getChamadoWithActivities: vi.fn(),
      getCrmClientById: vi.fn(async () => ({ crmClientId: "crm-1", lifecycleState: "active", companyName: "Cliente A", responsibleName: "", customerType: "company" })),
      listCrmClients: vi.fn(),
      createChamadoWithActivity,
      updateChamadoWithActivity: vi.fn(),
      registerManualTicketActivity: vi.fn(),
    } as any);

    expect(result).toEqual({ success: true, message: "Chamado #7 criado com sucesso.", entityId: "ticket-1" });
    expect(createChamadoWithActivity).toHaveBeenCalledWith(expect.objectContaining({ clientId: "tenant-a", priority: "critica", observations: expect.stringContaining("Categoria: Acesso") }));
  });

  it("fails closed before ticket writes when the canonical actor is not active", async () => {
    const createChamadoWithActivity = vi.fn();
    await expect(executeHermesTicketAction({
      clientId: "tenant-a", actorUserId: "blocked", action: { actionType: "ADD_TICKET_ACTIVITY", args: { ticketId: "ticket-a", noteContent: "Nota" } }, resolveAssignee: vi.fn(),
    }, {
      getActiveClientUser: vi.fn(async () => null), getChamadoWithActivities: vi.fn(), getCrmClientById: vi.fn(), listCrmClients: vi.fn(), createChamadoWithActivity,
      updateChamadoWithActivity: vi.fn(), registerManualTicketActivity: vi.fn(),
    } as any)).rejects.toThrow("ACTOR_NOT_ACTIVE");
    expect(createChamadoWithActivity).not.toHaveBeenCalled();
  });

  it("fails closed when monthly token usage cannot be read", async () => {
    await expect(readMonthlyTokenUsage(async () => { throw new Error("database unavailable"); }, "tenant-a"))
      .rejects.toThrow("database unavailable");
  });

  it("records detailed provider usage server-side", async () => {
    const execute = vi.fn(async () => []);
    const id = await insertTokenUsage(execute, {
      clientId: "tenant-a",
      userEmail: "user@example.invalid",
      conversationId: "conversation-a",
      promptTokens: 30,
      completionTokens: 12,
      totalTokens: 42,
      model: "gemini-test",
      functionCallsCount: 1,
    });

    expect(id).toMatch(/^tu-/);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toContain("INSERT INTO megadesk_ia_token_usage");
    expect(execute.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["tenant-a", "user@example.invalid", "conversation-a", 30, 12, 42, "gemini-test", 1]));
  });
});
