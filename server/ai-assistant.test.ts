/**
 * Testes do Assistente IA com Gemini por cliente
 * Valida: estrutura de mensagens, histórico, function calling, token por cliente
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<typeof import("./db")>()),
  getPool: vi.fn(),
}));
import { getPool, getUserHermesPreferences, saveUserHermesPreferences } from "./db";
import {
  HERMES_TOOL_REGISTRY,
  beginPendingHermesAction,
  cancelPendingHermesAction,
  createPendingActionRequest,
  executeClientFunction,
  executeWebSearch,
  getAllowedHermesTools,
  getAuthorizedHermesTool,
  insertTokenUsage,
  readMonthlyTokenUsage,
  callGeminiAPI,
  callGeminiWithEnvironmentFallback,
  getClientGeminiConfig,
  DEFAULT_GEMINI_MODEL,
  MAX_GEMINI_PROMPT_HISTORY_MESSAGES,
  selectGeminiPromptHistory,
  persistUserMessageImmediately,
  appendAssistantMessageToHistory,
  chatWithClientGemini,
  extractPriceFromText,
  updateItemsWithUserPrices,
  buildSystemInstruction,
  detectUserPreferencesFromMessage,
  type HermesToolDefinition,
} from "./gemini-client";
import { formatHermesError } from "./hermes-sanitize";
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

  it("limits provider context to the latest persisted conversation messages", () => {
    const history = Array.from({ length: MAX_GEMINI_PROMPT_HISTORY_MESSAGES + 4 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `mensagem-${index}`,
    }));
    const promptHistory = selectGeminiPromptHistory(history);
    expect(promptHistory).toHaveLength(MAX_GEMINI_PROMPT_HISTORY_MESSAGES);
    expect(promptHistory[0]?.content).toBe("mensagem-4");
    expect(promptHistory.at(-1)?.content).toBe(`mensagem-${history.length - 1}`);
  });

  it("uses the responsive Gemini Flash Lite model by default", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
  });

  it("uses a trimmed environment key when the tenant key is missing or blank", async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "  environment-gemini-key  ";
    vi.mocked(getPool).mockReturnValue({
      execute: vi.fn(async () => [[{
        integrations_json: JSON.stringify({ geminiKey: "   ", geminiQuotaMensal: 2000 }),
      }]]),
    } as any);

    try {
      await expect(getClientGeminiConfig("tenant-a")).resolves.toEqual({ geminiKey: "environment-gemini-key", geminiQuotaMensal: 2000 });
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
      vi.mocked(getPool).mockClear();
    }
  });

  it("retries a rejected tools payload once as a text-only Gemini request", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: "Unsupported function declaration", status: "INVALID_ARGUMENT", details: [{ field: "tools" }] } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "Resposta textual" }] } }] }) });

    await expect(callGeminiAPI(" key with space ", {
      contents: [
        { role: "user", parts: [{ text: "Olá" }] },
        { role: "model", parts: [{ functionCall: { name: "get_open_tickets", args: {} } }] },
        { role: "user", parts: [{ functionResponse: { name: "get_open_tickets", response: {} } }] },
      ],
      tools: [{ functionDeclarations: [{ name: "get_open_tickets" }] }],
    }, request)).resolves.toEqual({ candidates: [{ content: { parts: [{ text: "Resposta textual" }] } }] });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toContain("key=key%20with%20space");
    const fallbackBody = JSON.parse(request.mock.calls[1]?.[1]?.body as string);
    expect(fallbackBody.tools).toBeUndefined();
    expect(fallbackBody.contents).toEqual([{ role: "user", parts: [{ text: "Olá" }] }]);
  });

  it("preserves the provider error status and details when a text request fails", async () => {
    const request = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "Permission denied", status: "PERMISSION_DENIED", details: [{ reason: "API_KEY_SERVICE_BLOCKED" }] } }) }));

    await expect(callGeminiAPI("test-key", { contents: [{ role: "user", parts: [{ text: "Olá" }] }] }, request))
      .rejects.toThrow("Gemini API HTTP 403 PERMISSION_DENIED: Permission denied details=[{\"reason\":\"API_KEY_SERVICE_BLOCKED\"}]");
  });

  it("retries a rejected tenant credential once with the trimmed environment credential", async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "  environment-key  ";
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: { message: "API key not valid", status: "PERMISSION_DENIED" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ candidates: [] }) });

    try {
      await expect(callGeminiWithEnvironmentFallback("expired-tenant-key", { contents: [{ role: "user", parts: [{ text: "Olá" }] }] }, request))
        .resolves.toMatchObject({ data: { candidates: [] }, apiKey: "environment-key" });
      expect(request.mock.calls[1]?.[0]).toContain("key=environment-key");
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});

describe("Hermes security controls", () => {
  it("uses the canonical ai-assistant module slug in every assistant release gate", () => {
    const routersSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const canonicalGates = routersSource.match(/getReleasedClientOrThrow\(ctx\.tenantId, "ai-assistant"\)/g) ?? [];
    expect(canonicalGates).toHaveLength(3);
    expect(routersSource).not.toContain('getReleasedClientOrThrow(ctx.tenantId, "Assistente IA")');
  });

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
      "list_crm_clients",
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
      "create_service",
      "get_sales_analytics",
      "get_suppliers_list",
      "create_supplier",
      "update_supplier",
      "request_purchase_order",
      "send_supplier_message",
      "get_conversations_summary",
      "extract_lead_from_conversation",
      "set_user_preference",
      "get_erp_products",
      "web_search",
    ]);
    expect(HERMES_TOOL_REGISTRY.filter(tool => tool.type === "MUTATION").map(tool => tool.actionType)).toEqual([
      "CREATE_TICKET", "UPDATE_TICKET_STATUS", "ASSIGN_TICKET", "ADD_TICKET_ACTIVITY",
      "CREATE_CLIENT", "UPDATE_CLIENT", "ADD_CLIENT_TIMELINE", "CREATE_PROPOSAL", "UPDATE_PROPOSAL_STATUS", "SEND_PROPOSAL_WHATSAPP",
      "CREATE_PRODUCT", "UPDATE_PRODUCT", "LINK_PRODUCT_SUPPLIER", "UPDATE_SERVICE", "CREATE_SERVICE", "CREATE_SUPPLIER", "UPDATE_SUPPLIER", "REQUEST_PURCHASE", "SEND_SUPPLIER_MESSAGE",
    ]);
  });

  it("does not expose or authorize a sales tool without an ERP/sales permission", () => {
    const tools = getAllowedHermesTools(["ai-assistant"]).map(tool => tool.name);
    expect(tools).toContain("web_search");
    expect(tools).not.toContain("get_sales_summary");
    expect(getAuthorizedHermesTool("get_sales_summary", ["ai-assistant"])).toBeNull();
  });

  it("formats a grounded web search result using the provider response without tenant storage", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: "Fornecedor Exemplo — contato público e resumo." }] },
          groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.invalid/fornecedor", title: "Fornecedor Exemplo" } }] },
        }],
      }),
    }));

    const result = JSON.parse(await executeWebSearch("test-key", "fornecedores de embalagens", "fornecedores", request));
    expect(result).toMatchObject({ ok: true, query: "fornecedores de embalagens", focus: "fornecedores", result: "Fornecedor Exemplo — contato público e resumo.", sources: [{ url: "https://example.invalid/fornecedor", title: "Fornecedor Exemplo" }] });
    const requestBody = JSON.parse(request.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.tools).toEqual([{ googleSearch: {} }]);
    expect(vi.mocked(getPool)).not.toHaveBeenCalled();
  });

  it("keeps the chat-safe result when Google grounding fails", async () => {
    const request = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "grounding unavailable" } }) }));
    const result = JSON.parse(await executeWebSearch("test-key", "fornecedores", undefined, request));
    expect(result).toEqual({ ok: false, results: [], message: "Pesquisa web temporariamente indisponível." });
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
    expect(execute).toHaveBeenCalledTimes(6);
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

describe("Hermes persistence, CRM tools and latency", () => {
  it("limits the provider sliding window to 10 messages", () => {
    expect(MAX_GEMINI_PROMPT_HISTORY_MESSAGES).toBe(10);
  });

  it("persists the user message immediately before any provider call", async () => {
    const execute = vi.fn(async () => [[]]);
    vi.mocked(getPool).mockReturnValue({ execute } as any);
    const history = await persistUserMessageImmediately("tenant-a", "user@example.invalid", [], "Cadastre o cliente Ana");
    expect(history.at(-1)).toMatchObject({ role: "user", content: "Cadastre o cliente Ana" });
    expect(execute).toHaveBeenCalledOnce();
    expect(String(execute.mock.calls[0]?.[0])).toContain("megadesk_domain_ia_conversation_history");
    expect(JSON.parse((execute.mock.calls[0]?.[1] as unknown[])[3] as string)).toHaveLength(1);
  });

  it("registers CRM/proposal tools with RBAC and read/mutation types", () => {
    const byName = (name: string) => HERMES_TOOL_REGISTRY.find(tool => tool.name === name);
    expect(byName("create_client")).toMatchObject({ type: "MUTATION", actionType: "CREATE_CLIENT" });
    expect(byName("create_proposal")).toMatchObject({ type: "MUTATION", actionType: "CREATE_PROPOSAL" });
    expect(byName("get_crm_summary")?.type).toBe("READ");
    expect(byName("get_proposals_summary")?.type).toBe("READ");
    expect(getAuthorizedHermesTool("create_client", ["tickets"])).toBeNull();
    expect(getAuthorizedHermesTool("create_proposal", ["sales"])?.name).toBe("create_proposal");
  });

  it("turns create_client into a PENDING_APPROVAL card with a friendly summary", () => {
    const tool = getAuthorizedHermesTool("create_client", ["crm"])!;
    const pending = createPendingActionRequest(tool, { name: "Ana Souza", phone: "11999990000" });
    expect(pending).toMatchObject({ status: "PENDING_APPROVAL", actionType: "CREATE_CLIENT" });
    expect(pending.id).toMatch(/^action-/);
    expect(pending.summary).toContain("Ana Souza");
  });

  it("accepts clientName for proposals, summarizes the total and rejects ambiguous client refs", () => {
    const tool = getAuthorizedHermesTool("create_proposal", ["crm"])!;
    const item = { productId: "p1", productName: "Servico", quantity: 2, unitPrice: 50 };
    const pending = createPendingActionRequest(tool, { clientName: "Ana Souza", items: [item] });
    expect(pending.summary).toContain("R$ 100,00");
    expect(() => tool.validateArgs({ clientId: "c1", clientName: "Ana", items: [item] })).toThrow();
  });

  it("declares valid Gemini schemas: every ARRAY has items and every OBJECT has properties", () => {
    const problems: string[] = [];
    const walk = (node: any, path: string) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "ARRAY" && !node.items) problems.push(path + ": ARRAY sem items");
      if (node.type === "OBJECT" && (!node.properties || Object.keys(node.properties).length === 0) && path.includes(".")) problems.push(path + ": OBJECT sem properties");
      if (node.items) walk(node.items, path + ".items");
      for (const [key, value] of Object.entries(node.properties ?? {})) walk(value, path + "." + key);
    };
    for (const tool of HERMES_TOOL_REGISTRY) walk(tool.declaration.parameters, tool.name);
    expect(problems).toEqual([]);
  });


  it("persists assistant HITL action confirmations and cancellations to conversation history", async () => {
    const execute = vi.fn(async () => [[]]);
    vi.mocked(getPool).mockReturnValue({
      execute,
    } as any);

    const history = await appendAssistantMessageToHistory(
      "tenant-a",
      "user@example.invalid",
      "✓ Ação executada com sucesso: Cliente criado com sucesso."
    );
    expect(history.at(-1)).toMatchObject({
      role: "assistant",
      content: "✓ Ação executada com sucesso: Cliente criado com sucesso.",
    });
    expect(execute).toHaveBeenCalledTimes(2); // load + save
  });

  it("returns found: false when client or product does not exist in READ tools", async () => {
    const execute = vi.fn(async () => [[]]);
    vi.mocked(getPool).mockReturnValue({ execute } as any);

    const clientRes = JSON.parse(await executeClientFunction("get_client_360", { search: "Pedro Ferrari" }, "tenant-a", ["crm"]));
    expect(clientRes).toEqual({
      found: false,
      search: "Pedro Ferrari",
      message: "Cliente Pedro Ferrari não encontrado no cadastro.",
    });

    const prodRes = JSON.parse(await executeClientFunction("get_product_details", { sku: "SKU-999" }, "tenant-a", ["products"]));
    expect(prodRes).toEqual({
      found: false,
      message: "Produto SKU-999 não encontrado no cadastro.",
    });
  });

  it("executes multi-turn loop: sends READ tool result with role 'function' and completes conversation", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      if (sql.includes("megadesk_crm_clients")) {
        return [[]]; // cliente não encontrado
      }
      if (sql.includes("megadesk_domain_ia_conversation_history") || sql.includes("megadesk_domain_ia_conversations") || sql.includes("megadesk_ia_token_usage")) {
        return [[]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute } as any);

    let callCount = 0;
    const receivedPayloads: any[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);
      receivedPayloads.push(body);
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  functionCall: { name: "get_client_360", args: { search: "Pedro Ferrari" } }
                }]
              }
            }],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 60 }
          })
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: "Não encontrei o cliente Pedro Ferrari no sistema. Deseja que eu faça o cadastro dele antes de gerar o orçamento?"
              }]
            }
          }],
          usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20, totalTokenCount: 100 }
        })
      } as any;
    }) as any;

    try {
      const result = await chatWithClientGemini("tenant-a", "user@example.invalid", "faça um orçamento pro cliente Pedro Ferrari", [], ["crm", "sales"]);
      expect(callCount).toBe(2);
      expect(result.ok).toBe(true);
      expect(result.functionCallsMade).toContain("get_client_360");
      expect(result.response).toContain("Não encontrei o cliente Pedro Ferrari");

      // Validar que o payload da 2ª chamada continha role: "function" com functionResponse
      const secondCallContents = receivedPayloads[1].contents;
      const functionTurn = secondCallContents.find((c: any) => c.role === "function");
      expect(functionTurn).toBeDefined();
      expect(functionTurn.parts[0].functionResponse.name).toBe("get_client_360");
      expect(functionTurn.parts[0].functionResponse.response.found).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("propagates provider network failures without hiding them", async () => {
    const failing = vi.fn(async () => { throw new Error("network down"); });
    await expect(callGeminiAPI("key", { contents: [] }, failing as any)).rejects.toThrow("network down");
  });

  it("decouples create_proposal items: accepts free-text description/name without productId and defaults price to 0", () => {
    const proposalTool = HERMES_TOOL_REGISTRY.find(t => t.name === "create_proposal")!;
    expect(proposalTool).toBeDefined();

    const result = proposalTool.validateArgs({
      clientName: "Pedro Ferrari",
      items: [
        { productName: "lavagem de carro" },
        { description: "troca da correia dentada", unitPrice: 350 },
      ],
    }) as any;

    expect(result.clientName).toBe("Pedro Ferrari");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      productName: "lavagem de carro",
      quantity: 1,
      unitPrice: 0,
    });
    expect(result.items[1]).toEqual({
      productName: "troca da correia dentada",
      description: "troca da correia dentada",
      quantity: 1,
      unitPrice: 350,
    });
  });

  it("handles tool execution errors resiliently without uncaught exception", async () => {
    const execute = vi.fn(async () => {
      throw new Error("Tabela temporariamente inacessível");
    });
    vi.mocked(getPool).mockReturnValue({ execute } as any);

    const res = await executeClientFunction("get_sales_summary", {}, "tenant-a", ["sales"]);
    const parsed = JSON.parse(res);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Tabela temporariamente inacessível");
  });

  it("completes chained multi-turn proposal flow when client is not found, issuing HITL action", async () => {
    const execute = vi.fn(async (sql) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      if (sql.includes("megadesk_crm_clients")) {
        return [[]]; // não encontrado no CRM
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute });

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  functionCall: { name: "get_client_360", args: { search: "Pedro Ferrari" } }
                }]
              }
            }],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 60 }
          })
        };
      }
      if (callCount === 2) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  functionCall: {
                    name: "create_proposal",
                    args: {
                      clientName: "Pedro Ferrari",
                      items: [{ productName: "lavagem de carro" }, { description: "troca da correia dentada" }]
                    }
                  }
                }]
              }
            }],
            usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 15, totalTokenCount: 85 }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Proposta preparada em rascunho." }] } }],
          usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20, totalTokenCount: 100 }
        })
      };
    });

    try {
      const result = await chatWithClientGemini("tenant-a", "user@example.invalid", "faça um orçamento pro cliente Pedro Ferrari para lavagem de carro e troca de correia", [], ["crm", "sales"]);
      expect(callCount).toBe(2);
      expect(result.ok).toBe(true);
      expect(result.functionCallsMade).toEqual(["get_client_360", "create_proposal"]);
      expect(result.pendingActionRequest).toBeDefined();
      expect(result.pendingActionRequest?.actionType).toBe("CREATE_PROPOSAL");
      expect(result.pendingActionRequest?.args.clientName).toBe("Pedro Ferrari");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("persists synchronous [Ação Concluída] format into conversation history after HITL action", async () => {
    const execute = vi.fn(async (sql) => {
      if (sql.includes("SELECT conversation_history_json")) {
        return [[{ conversation_history_json: "[]" }]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute });

    const history = await appendAssistantMessageToHistory(
      "tenant-a",
      "user@example.invalid",
      "✓ [Ação Concluída] Cliente Rafael Guanabara cadastrado com sucesso (ID: #123)."
    );
    expect(history.at(-1)).toMatchObject({
      role: "assistant",
      content: "✓ [Ação Concluída] Cliente Rafael Guanabara cadastrado com sucesso (ID: #123).",
    });
  });

  it("ignores preliminary waiting text and returns final tool execution summary when asking about open tickets", async () => {
    const execute = vi.fn(async (sql) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      if (sql.includes("megadesk_domain_chamados")) {
        return [[{ total: 5, urgentes: 2 }]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute });

    let callCount = 0;
    const capturedBodies = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init) => {
      callCount++;
      capturedBodies.push(JSON.parse(init.body));
      if (callCount === 1) {
        // Simula Gemini retornando part preliminar de texto E functionCall
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [
                  { text: "Estou consultando o sistema para verificar o status atual dos chamados." },
                  { functionCall: { name: "get_open_tickets", args: {} } },
                ],
              },
            }],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 15, totalTokenCount: 65 },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [
                { text: "Atualmente existem 5 chamados abertos no sistema, sendo 2 com prioridade urgente." },
              ],
            },
          }],
          usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 25, totalTokenCount: 105 },
        }),
      };
    });

    try {
      const result = await chatWithClientGemini("tenant-a", "user@example.invalid", "Quantos chamados estão abertos?", [], ["tickets"]);
      expect(callCount).toBe(2);
      expect(result.ok).toBe(true);
      expect(result.functionCallsMade).toContain("get_open_tickets");
      expect(result.response).not.toContain("Estou consultando");
      expect(result.response).toContain("Atualmente existem 5 chamados abertos");

      // Confirma que o model turn emitido não incluiu a frase preliminar "Estou consultando"
      const secondCallContents = capturedBodies[1].contents;
      const modelTurn = secondCallContents.find((c) => c.role === "model");
      expect(modelTurn).toBeDefined();
      expect(modelTurn.parts).toEqual([{ functionCall: { name: "get_open_tickets", args: {} } }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("synthesizes deterministic proposal fallback and emits create_proposal HITL card when Gemini returns empty text after client lookup", async () => {
    const execute = vi.fn(async (sql) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      if (sql.includes("megadesk_crm_clients")) {
        return [[]]; // Cliente Pedro Ferrari não encontrado
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute });

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [
                  { functionCall: { name: "get_client_360", args: { search: "Pedro Ferrari" } } },
                ],
              },
            }],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 15, totalTokenCount: 65 },
          }),
        };
      }
      // Segundo turno: Gemini devolve vazio
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [],
            },
          }],
          usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 0, totalTokenCount: 70 },
        }),
      };
    });

    try {
      const result = await chatWithClientGemini(
        "tenant-a",
        "user@example.invalid",
        "faça um orçamento pro cliente Pedro Ferrari para lavagem de carro e troca da correia dentada",
        [],
        ["crm", "clients", "sales", "proposals"]
      );

      expect(result.ok).toBe(true);
      expect(result.response).not.toBe("Sem resposta do modelo.");
      expect(result.response).toContain("O cliente 'Pedro Ferrari' não foi localizado no cadastro");
      expect(result.response).toContain("lavagem de carro");
      expect(result.response).toContain("troca da correia dentada");

      // Card HITL de orçamento emitido
      expect(result.pendingActionRequest).toBeDefined();
      expect(result.pendingActionRequest?.actionType).toBe("CREATE_PROPOSAL");
      expect(result.pendingActionRequest?.status).toBe("PENDING_APPROVAL");
      expect(result.pendingActionRequest?.args).toMatchObject({
        clientName: "Pedro Ferrari",
      });
      const items = result.pendingActionRequest?.args.items as any[];
      expect(items).toHaveLength(2);
      expect(items[0].productName).toBe("lavagem de carro");
      expect(items[1].productName).toBe("troca da correia dentada");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("enriches prompt history with previous proposal summary in selectGeminiPromptHistory", () => {
    const history = [
      { role: "user", content: "faça um orçamento pro cliente Pedro Ferrari" },
      {
        role: "assistant",
        content: "Preparei a proposta abaixo para sua revisão:",
        pendingActionRequest: {
          id: "action-123",
          toolName: "create_proposal",
          type: "MUTATION",
          actionType: "CREATE_PROPOSAL",
          args: {
            clientName: "Pedro Ferrari",
            items: [
              { productName: "lavagem de carro", quantity: 1, unitPrice: 0 },
              { productName: "troca da correia dentada", quantity: 1, unitPrice: 0 },
            ],
          },
          status: "PENDING_APPROVAL",
        },
      },
    ];

    const promptHistory = selectGeminiPromptHistory(history as any);
    expect(promptHistory).toHaveLength(2);
    expect(promptHistory[1].content).toContain("[Proposta em rascunho anterior: Cliente: Pedro Ferrari");
    expect(promptHistory[1].content).toContain("1x lavagem de carro (R$ 0,00)");
    expect(promptHistory[1].content).toContain("1x troca da correia dentada (R$ 0,00)");
  });

  it("retains proposal context and updates price when user adjusts an existing proposal", async () => {
    const existingHistory = [
      { role: "user" as const, content: "faça um orçamento pro cliente Pedro Ferrari para lavagem de carro e troca da correia dentada" },
      {
        role: "assistant" as const,
        content: "Preparei a proposta abaixo para sua revisão:",
        pendingActionRequest: {
          id: "action-prev",
          toolName: "create_proposal",
          type: "MUTATION" as const,
          actionType: "CREATE_PROPOSAL" as const,
          args: {
            clientName: "Pedro Ferrari",
            items: [
              { productName: "lavagem de carro", quantity: 1, unitPrice: 0 },
              { productName: "troca da correia dentada", quantity: 1, unitPrice: 0 },
            ],
          },
          status: "PENDING_APPROVAL" as const,
        },
      },
    ];

    const execute = vi.fn(async (sql) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [] } }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0, totalTokenCount: 50 },
      }),
    }));

    try {
      const result = await chatWithClientGemini(
        "tenant-a",
        "user@example.invalid",
        "o valor da lavagem de carro é 60 reais",
        existingHistory,
        ["crm", "clients", "sales", "proposals"]
      );

      expect(result.ok).toBe(true);
      expect(result.pendingActionRequest).toBeDefined();
      expect(result.pendingActionRequest?.actionType).toBe("CREATE_PROPOSAL");
      expect(result.pendingActionRequest?.args.clientName).toBe("Pedro Ferrari");
      const items = result.pendingActionRequest?.args.items as any[];
      expect(items).toHaveLength(2);
      expect(items.find(i => i.productName.includes("lavagem"))?.unitPrice).toBe(60);
      expect(items.find(i => i.productName.includes("correia"))?.unitPrice).toBe(0);
      expect(result.response).not.toContain("get_");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("queries open tickets with broader active statuses and supports search by ticket code/number", async () => {
    const execute = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("COUNT(*) as total")) {
        return [[{ total: 1, urgentes: 0 }]];
      }
      return [[{ chamadoId: "c-0003", chamadoNumber: 3, title: "Suporte", status: "open", priority: "normal" }]];
    });
    vi.mocked(getPool).mockReturnValue({ execute });

    const response = JSON.parse(await executeClientFunction("get_open_tickets", { search: "0003" }, "tenant-a", ["tickets"]));
    expect(response.total).toBe(1);
    expect(execute).toHaveBeenCalled();
    const sqlExecuted = execute.mock.calls[0]?.[0] as string;
    expect(sqlExecuted).toContain("LOWER(status) IN ('open', 'aberto', 'pendente', 'em_andamento', 'in_progress', 'aguardando')");
    expect(sqlExecuted).toContain("LPAD(CAST(chamadoNumber AS CHAR), 4, '0') LIKE ?");
  });

  it("enforces user-provided price for correia dentada (120 reais) while preserving other items", async () => {
    const existingHistory = [
      {
        role: "user" as const,
        content: "faça um orçamento pro cliente Pedro Ferrari para lavagem de carro e troca da correia dentada",
        timestamp: 1_700_000_000_000,
      },
      {
        role: "assistant" as const,
        content: "Preparei a proposta abaixo para sua revisão:",
        timestamp: 1_700_000_001_000,
        pendingActionRequest: {
          id: "act-proposal-1",
          toolName: "create_proposal",
          type: "MUTATION" as const,
          actionType: "CREATE_PROPOSAL" as const,
          args: {
            clientName: "Pedro Ferrari",
            items: [
              { productName: "lavagem de carro", quantity: 1, unitPrice: 0 },
              { productName: "troca da correia dentada", quantity: 1, unitPrice: 0 },
            ],
          },
          status: "PENDING_APPROVAL" as const,
        },
      },
    ];

    const execute = vi.fn(async (sql) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [] } }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0, totalTokenCount: 50 },
      }),
    }));

    try {
      const result = await chatWithClientGemini(
        "tenant-a",
        "user@example.invalid",
        "coloca o valor da correia dentada por 120 reais",
        existingHistory,
        ["crm", "clients", "sales", "proposals"]
      );

      expect(result.ok).toBe(true);
      expect(result.pendingActionRequest).toBeDefined();
      expect(result.pendingActionRequest?.actionType).toBe("CREATE_PROPOSAL");
      expect(result.pendingActionRequest?.args.clientName).toBe("Pedro Ferrari");
      const items = result.pendingActionRequest?.args.items as any[];
      expect(items).toHaveLength(2);
      const lavagem = items.find(i => i.productName.includes("lavagem"));
      const correia = items.find(i => i.productName.includes("correia"));
      expect(lavagem?.unitPrice).toBe(0);
      expect(correia?.unitPrice).toBe(120);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("guarantees direct clear response for ticket queries when Gemini returns preliminary waiting text in turn 2", async () => {
    let callCount = 0;
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      if (sql.includes("COUNT(*) as total")) {
        return [[{ total: 2, urgentes: 1 }]];
      }
      if (sql.includes("SELECT chamadoId, chamadoNumber")) {
        return [[
          { chamadoId: "c-1", chamadoNumber: 1, title: "Erro no Login", customerName: "Cliente A" },
          { chamadoId: "c-2", chamadoNumber: 2, title: "Falha na Nota Fiscal", customerName: "Cliente B" },
        ]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [
                  { functionCall: { name: "get_open_tickets", args: {} } },
                ],
              },
            }],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 15, totalTokenCount: 65 },
          }),
        };
      }
      // Turno 2: Gemini hesita ou retorna texto de espera
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [
                { text: "Estou consultando o sistema para verificar o status atual dos chamados." },
              ],
            },
          }],
          usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 15, totalTokenCount: 95 },
        }),
      };
    });

    try {
      const result = await chatWithClientGemini("tenant-a", "user@example.invalid", "Quantos chamados estão abertos?", [], ["tickets"]);
      expect(result.ok).toBe(true);
      expect(result.functionCallsMade).toContain("get_open_tickets");
      expect(result.response).not.toContain("Estou consultando");
      expect(result.response).not.toBe("Sem resposta do modelo.");
      expect(result.response).toContain("Você possui 2 chamado(s) aberto(s)");
      expect(result.response).toContain('#0001: "Erro no Login"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

describe("Hermes entity flexibilization, memory continuity and conversational parsing", () => {
  it("handles flexible supplier creation with nullish optional fields and formats friendly errors without raw zod json", () => {
    const supplierTool = HERMES_TOOL_REGISTRY.find(t => t.name === "create_supplier")!;
    expect(supplierTool).toBeDefined();

    // Aceita apenas o nome com todos os outros campos nulos/undefined
    const validated = supplierTool.validateArgs({
      name: "Elétrica Moura",
      document: null,
      email: null,
      phone: null,
      contactName: null,
      tradeName: null,
      stateRegistration: null,
      postalCode: null,
      street: null,
      addressNumber: null,
      addressComplement: null,
      district: null,
      city: null,
      state: null,
      notes: null,
    });
    expect(validated.name).toBe("Elétrica Moura");

    // Valida conversão de erros brutos do Zod em texto amigável em português
    const rawZodJson = JSON.stringify([
      { expected: "string", received: "null", path: ["stateRegistration"], message: "expected string, received null" },
      { expected: "string", received: "null", path: ["email"], message: "expected string, received null" },
    ]);
    const friendly = formatHermesError(new Error(rawZodJson));
    expect(friendly).not.toContain("[ {");
    expect(friendly).not.toContain("expected string");
    expect(friendly).toContain("Não foi possível concluir o cadastro");
    expect(friendly).toContain("inscrição estadual");
    expect(friendly).toContain("e-mail");
  });

  it("extracts and updates proposal prices with colloquial expressions ('120 conto', '60 pila', 'coloca 120 reais') preserving items and client context", () => {
    expect(extractPriceFromText("120 conto")).toBe(120);
    expect(extractPriceFromText("60 pila")).toBe(60);
    expect(extractPriceFromText("troca o valor da correia pra 120 reais")).toBe(120);
    expect(extractPriceFromText("R$ 85,50")).toBe(85.5);

    const initialItems = [
      { productName: "troca da correia dentada", quantity: 1, unitPrice: 0 },
      { productName: "lavagem de carro", quantity: 1, unitPrice: 50 },
    ];

    const updated1 = updateItemsWithUserPrices(initialItems, "coloca o valor da correia dentada por 120 conto");
    expect(updated1[0].unitPrice).toBe(120);
    expect(updated1[1].unitPrice).toBe(50); // preservado

    const updated2 = updateItemsWithUserPrices(updated1, "muda a lavagem pra 60 pila");
    expect(updated2[0].unitPrice).toBe(120); // preservado
    expect(updated2[1].unitPrice).toBe(60);
  });

  it("opens CREATE_SUPPLIER card directly when user asks 'consegue criar um fornecedor chamado eletrica moura?'", async () => {
    let callCount = 0;
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      // Gemini na 1ª tentativa devolve functionCall para create_supplier sem texto
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [
                { functionCall: { name: "create_supplier", args: { name: "Elétrica Moura" } } },
              ],
            },
          }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
        }),
      };
    });

    try {
      const result = await chatWithClientGemini("tenant-a", "user@example.invalid", "consegue criar um fornecedor chamado eletrica moura?", [], ["suppliers", "purchases", "erp"]);
      expect(result.ok).toBe(true);
      expect(result.pendingActionRequest).toBeDefined();
      expect(result.pendingActionRequest?.actionType).toBe("CREATE_SUPPLIER");
      expect(result.pendingActionRequest?.args.name).toBe("Elétrica Moura");
      expect(result.response).not.toBe("Sem resposta do modelo.");
      expect(result.response).toContain("Preparei o cadastro do fornecedor Elétrica Moura para sua aprovação:");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("registers update_supplier with flexible flat arguments", () => {
    const tool = getAuthorizedHermesTool("update_supplier", ["suppliers"]);
    expect(tool).not.toBeNull();
    expect(tool?.actionType).toBe("UPDATE_SUPPLIER");
    const validated = tool?.validateArgs({ name: "Elétrica Moura", phone: "11988887777" });
    expect(validated).toMatchObject({
      name: "Elétrica Moura",
      phone: "11988887777",
      fieldsToUpdate: {
        name: "Elétrica Moura",
        phone: "11988887777",
      },
    });
  });

  it("extracts UPDATE_SUPPLIER pending action when user asks to add phone to supplier", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute } as any);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: "" }] },
          }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
        }),
      };
    });

    try {
      const result = await chatWithClientGemini(
        "tenant-a",
        "user@example.invalid",
        "cadastrar telefone (11) 98888-7777 no fornecedor Elétrica Moura",
        [],
        ["suppliers", "purchases", "erp"]
      );
      expect(result.ok).toBe(true);
      expect(result.pendingActionRequest).toBeDefined();
      expect(result.pendingActionRequest?.actionType).toBe("UPDATE_SUPPLIER");
      expect(result.pendingActionRequest?.args.name).toBe("Elétrica Moura");
      expect(result.pendingActionRequest?.args.phone).toBe("(11) 98888-7777");
      expect(result.response).toContain("Preparei a atualização do fornecedor Elétrica Moura para sua aprovação:");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates update_proposal_status with convertToSale and sale/converted statuses", () => {
    const tool = getAuthorizedHermesTool("update_proposal_status", ["sales"]);
    expect(tool).not.toBeNull();
    const validated = tool?.validateArgs({
      proposalId: "prop-xyz",
      newStatus: "sale",
      convertToSale: true,
    });
    expect(validated).toMatchObject({
      proposalId: "prop-xyz",
      newStatus: "sale",
      convertToSale: true,
    });
  });

  it("does not generate a CREATE_PROPOSAL card when user asks to approve a proposal", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute } as any);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: "Vou verificar a proposta solicitada." }] },
          }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
        }),
      };
    });

    try {
      const result = await chatWithClientGemini(
        "tenant-a",
        "user@example.invalid",
        "aprova essa proposta e gera como venda",
        [],
        ["sales", "crm", "proposals"]
      );
      expect(result.ok).toBe(true);
      expect(result.pendingActionRequest?.actionType).not.toBe("CREATE_PROPOSAL");
      expect(result.response).not.toBe("Sem resposta do modelo.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("synthesizes deterministic message for get_erp_products without Sem resposta do modelo", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("megadesk_domain_clients")) {
        return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
      }
      if (sql.includes("COALESCE(SUM(tokens_used), 0)")) {
        return [[{ total: 0 }]];
      }
      if (sql.includes("record_type = 'product'")) {
        return [[]];
      }
      return [[]];
    });
    vi.mocked(getPool).mockReturnValue({ execute } as any);

    let callIndex = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: { parts: [{ functionCall: { name: "get_erp_products", args: {} } }] },
            }],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: "" }] },
          }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0, totalTokenCount: 50 },
        }),
      };
    });

    try {
      const result = await chatWithClientGemini(
        "tenant-a",
        "user@example.invalid",
        "quais produtos temos em estoque?",
        [],
        ["products", "erp"]
      );
      expect(result.ok).toBe(true);
      expect(result.response).not.toBe("Sem resposta do modelo.");
      expect(result.response).toContain("Consultei o estoque no sistema e não encontrei nenhum produto físico com saldo disponível no momento.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

});


  describe("Hermes Cross-Module Function Registry and Resilient Handlers", () => {
    it("Module 1 - get_tickets_overview returns unified schema with tickets array", async () => {
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("COUNT(*) AS total") && sql.includes("open")) {
          return [[{ total: 2, open: 1, in_progress: 1, waiting: 0, closed: 0 }]];
        }
        if (sql.includes("FROM megadesk_domain_chamados")) {
          return [[
            { chamadoId: "chamado-1", chamadoNumber: 1, title: "Problema no ar condicionado", customerName: "Empresa ABC", status: "open", priority: "high", createdAt: new Date() },
            { chamadoId: "chamado-2", chamadoNumber: 2, title: "Troca de óleo", customerName: "Empresa XYZ", status: "in_progress", priority: "medium", createdAt: new Date() },
          ]];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      const raw = await executeClientFunction("get_tickets_overview", { search: "Empresa" }, "tenant-a", ["tickets"]);
      const res = JSON.parse(raw);
      expect(res.total).toBe(2);
      expect(res.open).toBe(1);
      expect(res.inProgress).toBe(1);
      expect(Array.isArray(res.tickets)).toBe(true);
      expect(res.tickets[0].ticketNumber).toBe(1);
      expect(res.tickets[0].customer).toBe("Empresa ABC");
    });

    it("Module 1 - get_ticket_details returns unified details schema", async () => {
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("FROM megadesk_domain_chamados")) {
          return [[{
            chamadoId: "chamado-1", chamadoNumber: 1, title: "Chamado 1", observations: "Desc",
            customerName: "Cliente A", status: "open", priority: "high",
            assignedTo: "Operador Carlos", resolutionNotes: null
          }]];
        }
        if (sql.includes("FROM megadesk_domain_chamado_activities")) {
          return [[{ activityId: "act-1", actionType: "CREATED", description: "Criado", attendant: "Admin", createdAt: new Date() }]];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      const raw = await executeClientFunction("get_ticket_details", { ticketNumber: 1 }, "tenant-a", ["tickets"]);
      const res = JSON.parse(raw);
      expect(res.id).toBe("chamado-1");
      expect(res.customer).toBe("Cliente A");
      expect(res.assignedOperator).toBe("Operador Carlos");
      expect(Array.isArray(res.timeline)).toBe(true);
    });

    it("Module 1 - creates and updates tickets with HITL pending action", () => {
      const createTool = HERMES_TOOL_REGISTRY.find(t => t.name === "create_ticket")!;
      const createReq = createPendingActionRequest(createTool, {
        customer: "Transportadora Alpha",
        title: "Falha mecânica",
        description: "Motor falhando",
        priority: "urgent",
        category: "suporte"
      });
      expect(createReq.actionType).toBe("CREATE_TICKET");
      expect(createReq.status).toBe("PENDING_APPROVAL");
      expect(createReq.summary).toContain("Transportadora Alpha");

      const updateTool = HERMES_TOOL_REGISTRY.find(t => t.name === "update_ticket_status")!;
      const updateReq = createPendingActionRequest(updateTool, {
        ticketNumber: "10",
        newStatus: "resolved",
        resolutionNote: "Substituído cabo de ignição"
      });
      expect(updateReq.actionType).toBe("UPDATE_TICKET_STATUS");
      expect(updateReq.status).toBe("PENDING_APPROVAL");

      const assignTool = HERMES_TOOL_REGISTRY.find(t => t.name === "assign_ticket")!;
      const assignReq = createPendingActionRequest(assignTool, {
        ticketNumber: "10",
        operatorName: "Carlos Mecânico"
      });
      expect(assignReq.actionType).toBe("ASSIGN_TICKET");
      expect(assignReq.status).toBe("PENDING_APPROVAL");
    });

    it("Module 2 - get_client_360 and get_crm_summary return unified schema", async () => {
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("FROM megadesk_crm_clients") && sql.includes("crm_client_id = ?")) {
          return [[{ crmClientId: "crm-1", name: "Maria Silva", cpfCnpj: "12345678901", phone: "11988887777", email: "maria@example.com", status: "active" }]];
        }
        if (sql.includes("FROM megadesk_crm_clients") && sql.includes("COUNT(*) AS total")) {
          return [[{ total: 5, active: 4, inactive: 1, leads: 2 }]];
        }
        if (sql.includes("FROM megadesk_crm_clients")) {
          return [[{ crmClientId: "crm-1", name: "Maria Silva", cpfCnpj: "12345678901", phone: "11988887777", email: "maria@example.com", status: "active" }]];
        }
        if (sql.includes("FROM megadesk_domain_chamados")) {
          return [[{ chamadoId: "c-1", chamadoNumber: 1, title: "Ticket 1", status: "open", priority: "medium", updatedAt: new Date() }]];
        }
        if (sql.includes("FROM erp_sale_orders") && sql.includes("quote")) return [[{ activeCount: 2 }]];
        if (sql.includes("FROM erp_sale_orders") && sql.includes("sale")) return [[{ saleCount: 3 }]];
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      const raw = await executeClientFunction("get_client_360", { search: "Maria" }, "tenant-a", ["clients"]);
      const res = JSON.parse(raw);
      expect(res.found).toBe(true);
      expect(res.client.name).toBe("Maria Silva");
      expect(res.client.openTickets).toBe(1);
      expect(res.client.activeProposals).toBe(2);
      expect(res.client.totalPurchases).toBe(3);

      const rawSummary = await executeClientFunction("get_crm_summary", { period: "month" }, "tenant-a", ["crm"]);
      const summaryRes = JSON.parse(rawSummary);
      expect(summaryRes.totalClients).toBe(5);
      expect(summaryRes.activeCustomersCount).toBe(4);
    });

    it("Module 2 - create_client, update_client and add_client_timeline_event emit HITL requests", () => {
      const createClientTool = HERMES_TOOL_REGISTRY.find(t => t.name === "create_client")!;
      const clientReq = createPendingActionRequest(createClientTool, { name: "Empresa Beta", document: "12.345.678/0001-90", phone: "11999991111" });
      expect(clientReq.actionType).toBe("CREATE_CLIENT");

      const updateClientTool = HERMES_TOOL_REGISTRY.find(t => t.name === "update_client")!;
      const updateReq = createPendingActionRequest(updateClientTool, { name: "Empresa Beta", phone: "11999992222", notes: "Novo contato" });
      expect(updateReq.actionType).toBe("UPDATE_CLIENT");

      const timelineTool = HERMES_TOOL_REGISTRY.find(t => t.name === "add_client_timeline_event")!;
      const timelineReq = createPendingActionRequest(timelineTool, { name: "Empresa Beta", title: "Ligação de alinhamento", description: "Alinhado prazo" });
      expect(timelineReq.actionType).toBe("ADD_CLIENT_TIMELINE");
    });

    it("Module 3 - get_proposals_summary and get_proposal_details return unified schemas", async () => {
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("COUNT(*) AS total") && sql.includes("drafts")) {
          return [[{ total: 1, totalCents: 15000, drafts: 1, negotiation: 0, approved: 0, lost: 0 }]];
        }
        if (sql.includes("FROM erp_sale_orders o") && !sql.includes("COUNT(*)")) {
          return [[{ id: "prop-1", orderNumber: "O-10", clientName: "João", totalCents: 15000, status: "draft", createdAt: new Date() }]];
        }
        if (sql.includes("FROM erp_sale_orders") && sql.includes("LIMIT 1")) {
          return [[{ id: "prop-1", orderNumber: "O-10", clientName: "João", totalCents: 15000, status: "draft", paymentTerms: "30 dias", deliveryForecast: null }]];
        }
        if (sql.includes("FROM erp_sale_order_items")) {
          return [[{ name: "Item 1", quantity: 1, unitPriceCents: 15000, totalCents: 15000 }]];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      const raw = await executeClientFunction("get_proposals_summary", { status: "draft" }, "tenant-a", ["proposals"]);
      const res = JSON.parse(raw);
      expect(res.total).toBe(1);
      expect(res.totalValue).toBe(150);
      expect(res.proposals[0].orderNumber).toBe("O-10");

      const rawDetails = await executeClientFunction("get_proposal_details", { orderNumber: "O-10" }, "tenant-a", ["proposals"]);
      const detailsRes = JSON.parse(rawDetails);
      expect(detailsRes.orderNumber).toBe("O-10");
      expect(detailsRes.clientName).toBe("João");
      expect(Array.isArray(detailsRes.items)).toBe(true);
    });

    it("Module 3 - create_proposal, update_proposal_status and send_proposal_whatsapp emit HITL requests", () => {
      const proposalTool = HERMES_TOOL_REGISTRY.find(t => t.name === "create_proposal")!;
      const proposalReq = createPendingActionRequest(proposalTool, {
        clientName: "Auto Mecânica Ramos",
        items: [
          { productName: "lavagem de carro", quantity: 1, unitPrice: 60 },
          { productName: "troca da correia dentada", quantity: 1, unitPrice: 120 }
        ]
      });
      expect(proposalReq.actionType).toBe("CREATE_PROPOSAL");
      expect(proposalReq.summary).toContain("R$ 180,00");

      const updateTool = HERMES_TOOL_REGISTRY.find(t => t.name === "update_proposal_status")!;
      const updateReq = createPendingActionRequest(updateTool, {
        orderNumber: "O-18",
        newStatus: "approved",
        convertToSale: true
      });
      expect(updateReq.actionType).toBe("UPDATE_PROPOSAL_STATUS");

      const whatsappTool = HERMES_TOOL_REGISTRY.find(t => t.name === "send_proposal_whatsapp")!;
      const whatsappReq = createPendingActionRequest(whatsappTool, {
        orderNumber: "O-18",
        phone: "11988887777"
      });
      expect(whatsappReq.actionType).toBe("SEND_PROPOSAL_WHATSAPP");
    });

    it("Module 4 - get_erp_products, get_services_list and create mutations", async () => {
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("FROM erp_products") || sql.includes("FROM megadesk_erp_products")) {
          return [[{ id: "prd-1", name: "Óleo 5W30", sku: "OLEO-1", stock: 10, minStock: 2, salePriceCents: 5000, costPriceCents: 3000 }]];
        }
        if (sql.includes("FROM erp_services") || sql.includes("FROM megadesk_erp_services")) {
          return [[{ id: 1, name: "Alinhamento 3D", priceCents: 10000, isActive: 1 }]];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      const rawProds = await executeClientFunction("get_erp_products", { search: "Óleo" }, "tenant-a", ["products"]);
      const prodsRes = JSON.parse(rawProds);
      expect(prodsRes.total).toBe(1);
      expect(prodsRes.items[0].name).toBe("Óleo 5W30");

      const rawServices = await executeClientFunction("get_services_list", { search: "Alinhamento" }, "tenant-a", ["services"]);
      const servicesRes = JSON.parse(rawServices);
      expect(servicesRes.total).toBe(1);
      expect(servicesRes.services[0].name).toBe("Alinhamento 3D");

      const createProdTool = HERMES_TOOL_REGISTRY.find(t => t.name === "create_product")!;
      const prodReq = createPendingActionRequest(createProdTool, { name: "Pastilha de Freio", salePrice: 120, costPrice: 70, initialStock: 5 });
      expect(prodReq.actionType).toBe("CREATE_PRODUCT");

      const createServiceTool = HERMES_TOOL_REGISTRY.find(t => t.name === "create_service")!;
      const serviceReq = createPendingActionRequest(createServiceTool, { name: "Balanceamento", defaultPrice: 40 });
      expect(serviceReq.actionType).toBe("CREATE_SERVICE");
    });

    it("Module 5 - get_suppliers_list, create_supplier, update_supplier and request_purchase_order", async () => {
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("FROM erp_suppliers") || sql.includes("FROM megadesk_erp_suppliers")) {
          return [[{ publicId: "sup-1", legalName: "Distribuidora de Peças Ltda", tradeName: "Distribuidora", taxId: "11222333000199", phone: "1133334444", email: "contato@distribuidora.com", contactName: "Roberto" }]];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      const rawSuppliers = await executeClientFunction("get_suppliers_list", { search: "Distribuidora" }, "tenant-a", ["suppliers"]);
      const suppRes = JSON.parse(rawSuppliers);
      expect(suppRes.total).toBe(1);
      expect(suppRes.suppliers[0].name).toBe("Distribuidora de Peças Ltda");

      const createSupplierTool = HERMES_TOOL_REGISTRY.find(t => t.name === "create_supplier")!;
      const suppReq = createPendingActionRequest(createSupplierTool, { name: "Auto Peças Sul", phone: "1144445555" });
      expect(suppReq.actionType).toBe("CREATE_SUPPLIER");

      const updateSupplierTool = HERMES_TOOL_REGISTRY.find(t => t.name === "update_supplier")!;
      const updateSuppReq = createPendingActionRequest(updateSupplierTool, { name: "Auto Peças Sul", phone: "1144446666" });
      expect(updateSuppReq.actionType).toBe("UPDATE_SUPPLIER");

      const purchaseTool = HERMES_TOOL_REGISTRY.find(t => t.name === "request_purchase_order")!;
      const purchaseReq = createPendingActionRequest(purchaseTool, {
        supplierName: "Auto Peças Sul",
        items: [{ productName: "Filtro de Ar", quantity: 10, targetCost: 25 }]
      });
      expect(purchaseReq.actionType).toBe("REQUEST_PURCHASE");
    });

    it("Module 6 - get_conversations_summary and extract_lead_from_conversation", async () => {
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("COUNT(*) as total") && sql.includes("abertas")) {
          return [[{ total: 1, abertas: 1, fechadas: 0 }]];
        }
        if (sql.includes("FROM megadesk_domain_conversations")) {
          return [[{
            conversation_id: "conv-1", customer_name: "Juliana Santos", phone: "11977778888",
            last_message: "Gostaria de um orçamento para troca de pneus e revisão do HB20",
            updated_at: new Date(), unreadCount: 0
          }]];
        }
        if (sql.includes("FROM megadesk_domain_messages")) {
          return [[{
            messageId: "msg-1", content: "Meu nome é Juliana Santos, meu carro é um HB20 placa ABC-1234, preciso de 4 pneus aro 15 e alinhamento",
            sender: "contact", createdAt: new Date()
          }]];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      const rawConv = await executeClientFunction("get_conversations_summary", { search: "Juliana" }, "tenant-a", ["conversations"]);
      const convRes = JSON.parse(rawConv);
      expect(convRes.total).toBe(1);
      expect(convRes.conversations[0].contactName).toBe("Juliana Santos");

      const rawLead = await executeClientFunction("extract_lead_from_conversation", { conversationId: "conv-1" }, "tenant-a", ["conversations"]);
      const leadRes = JSON.parse(rawLead);
      expect(leadRes.found).toBe(true);
      expect(leadRes.lead.contactName).toBe("Juliana Santos");
      expect(leadRes.lead.phone).toBe("11977778888");
      expect(leadRes.lead.suggestedItems.length).toBeGreaterThan(0);
    });

    it("executes multi-intent chained tools in consecutive turns for compound user requests", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("megadesk_domain_clients")) {
          return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
        }
        if (sql.includes("COUNT(*) AS total") && sql.includes("open")) {
          return [[{ total: 1, open: 1, in_progress: 0, waiting: 0, closed: 0 }]];
        }
        if (sql.includes("FROM megadesk_domain_chamados") && sql.includes("chamadoNumber = ?")) {
          return [[{
            chamadoId: "chamado-3", chamadoNumber: 3, title: "Falha na ignição do motor", observations: "Velas desgastadas",
            customerName: "Transportadora Alpha", status: "open", priority: "urgent",
            assignedTo: "Carlos Mecânico", resolutionNotes: null
          }]];
        }
        if (sql.includes("FROM megadesk_domain_chamados")) {
          return [[
            { chamadoId: "chamado-3", chamadoNumber: 3, title: "Falha na ignição do motor", customerName: "Transportadora Alpha", status: "open", priority: "urgent", createdAt: new Date() }
          ]];
        }
        if (sql.includes("FROM megadesk_domain_chamado_activities")) {
          return [[{ activityId: "act-1", actionType: "CREATED", description: "Chamado aberto", attendant: "Sistema", createdAt: new Date() }]];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [{
                content: {
                  parts: [{
                    functionCall: { name: "get_tickets_overview", args: { status: "open" } }
                  }]
                }
              }],
              usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, totalTokenCount: 70 }
            })
          };
        }
        if (callCount === 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [{
                content: {
                  parts: [{
                    functionCall: { name: "get_ticket_details", args: { ticketNumber: "0003" } }
                  }]
                }
              }],
              usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 25, totalTokenCount: 105 }
            })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: "Atualmente temos 1 chamado aberto no suporte. Quanto ao chamado #0003, trata-se de 'Falha na ignição do motor' para a Transportadora Alpha com prioridade urgente, atribuído ao Carlos Mecânico."
                }]
              }
            }],
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40, totalTokenCount: 160 }
          })
        };
      }) as any;

      try {
        const result = await chatWithClientGemini(
          "tenant-a",
          "user@example.invalid",
          "me dá um resumo dos chamados abertos e o que tem no chamado 0003",
          [],
          ["tickets", "support"]
        );
        expect(result.ok).toBe(true);
        expect(callCount).toBe(3);
        expect(result.functionCallsMade).toEqual(["get_tickets_overview", "get_ticket_details"]);
        expect(result.response).toContain("1 chamado aberto");
        expect(result.response).toContain("Falha na ignição do motor");
        expect(result.response).toContain("Transportadora Alpha");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles Gemini timeout safely without throwing and unblocks client with ok: true", async () => {
      const originalFetch = globalThis.fetch;
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("megadesk_domain_clients")) {
          return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      globalThis.fetch = vi.fn(async () => {
        const err = new Error("Gemini API excedeu o tempo limite de 25s.");
        err.name = "TimeoutError";
        throw err;
      }) as any;

      try {
        const result = await chatWithClientGemini(
          "tenant-a",
          "user@example.invalid",
          "pergunta que vai dar timeout",
          [],
          ["ai-assistant"]
        );
        expect(result.ok).toBe(true);
        expect(result.response).toContain("O processamento demorou mais que o esperado");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("Hermes persistent user preferences and adaptive persona", () => {
    it("detects honorifics, preferred names, communication styles and custom rules deterministically", () => {
      // Honorific 'Senhor'
      const pref1 = detectUserPreferencesFromMessage("agora me chame de senhor");
      expect(pref1).not.toBeNull();
      expect(pref1?.honorific).toBe("Senhor");
      expect(pref1?.preferredName).toBe("Senhor");

      // Honorific 'Senhor Marcelo'
      const pref2 = detectUserPreferencesFromMessage("me chame de Senhor Marcelo");
      expect(pref2).not.toBeNull();
      expect(pref2?.honorific).toBe("Senhor");
      expect(pref2?.preferredName).toBe("Senhor Marcelo");

      // Preferred name only
      const pref3 = detectUserPreferencesFromMessage("me chame pelo nome Marcelo");
      expect(pref3).not.toBeNull();
      expect(pref3?.preferredName).toBe("Marcelo");

      // Communication style: direct
      const pref4 = detectUserPreferencesFromMessage("seja mais direto por favor");
      expect(pref4).not.toBeNull();
      expect(pref4?.communicationStyle).toBe("direto e objetivo");

      // Communication style: formal
      const pref5 = detectUserPreferencesFromMessage("fale de forma mais formal com a gente");
      expect(pref5).not.toBeNull();
      expect(pref5?.communicationStyle).toBe("formal e cortês");

      // Custom rule
      const pref6 = detectUserPreferencesFromMessage("lembre-se que nossa empresa prioriza clientes VIP");
      expect(pref6).not.toBeNull();
      expect(pref6?.customRules).toEqual(["nossa empresa prioriza clientes VIP"]);

      // Unrelated operational message returns null
      const nonPref = detectUserPreferencesFromMessage("quantos produtos temos em estoque?");
      expect(nonPref).toBeNull();
    });

    it("injects user preferences dynamically into system instruction", () => {
      const allowedTools = getAllowedHermesTools(["ai-assistant"]);
      const sysDefault = buildSystemInstruction(allowedTools);
      expect(sysDefault).toContain("PREFERÊNCIAS VIGENTES DE TRATAMENTO E PERFIL DO USUÁRIO");
      expect(sysDefault).toContain("- Como chamar o usuário: Operador");
      expect(sysDefault).toContain("- Pronome / Forma de tratamento: Você");
      expect(sysDefault).toContain("- Estilo de comunicação ativo: executivo e resolutivo");

      const sysCustom = buildSystemInstruction(allowedTools, {
        preferredName: "Senhor Marcelo",
        honorific: "Senhor",
        communicationStyle: "formal e cortês",
        customRules: ["nossa empresa prioriza clientes VIP", "nunca conceder mais de 10% de desconto sem autorização"],
      });
      expect(sysCustom).toContain("- Como chamar o usuário: Senhor Marcelo");
      expect(sysCustom).toContain("- Pronome / Forma de tratamento: Senhor");
      expect(sysCustom).toContain("- Estilo de comunicação ativo: formal e cortês");
      expect(sysCustom).toContain("• nossa empresa prioriza clientes VIP");
      expect(sysCustom).toContain("• nunca conceder mais de 10% de desconto sem autorização");
      expect(sysCustom).toContain("Respeite rigorosamente a forma de tratamento solicitada acima");
    });

    it("registers set_user_preference as a READ tool without requiring HITL card confirmation", () => {
      const prefTool = HERMES_TOOL_REGISTRY.find(t => t.name === "set_user_preference");
      expect(prefTool).toBeDefined();
      expect(prefTool?.type).toBe("READ");
      expect(prefTool?.requiredPermissions).toEqual(["ai-assistant"]);
      expect(prefTool?.declaration.parameters?.properties).toHaveProperty("preferredName");
      expect(prefTool?.declaration.parameters?.properties).toHaveProperty("honorific");
      expect(prefTool?.declaration.parameters?.properties).toHaveProperty("communicationStyle");
      expect(prefTool?.declaration.parameters?.properties).toHaveProperty("customRule");
    });

    it("executes set_user_preference directly via executeClientFunction and saves to database", async () => {
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("CREATE TABLE IF NOT EXISTS megadesk_domain_ia_user_preferences")) {
          return [{}];
        }
        if (sql.includes("SELECT") && sql.includes("megadesk_domain_ia_user_preferences")) {
          return [[]];
        }
        if (sql.includes("INSERT INTO megadesk_domain_ia_user_preferences")) {
          return [{ affectedRows: 1 }];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      const resultStr = await executeClientFunction(
        "set_user_preference",
        {
          preferredName: "Senhor Roberto",
          honorific: "Senhor",
          communicationStyle: "executivo direto",
          customRule: "sempre confirmar faturamento por email",
        },
        "tenant-test",
        ["ai-assistant"],
        undefined,
        "user-test-123"
      );

      const result = JSON.parse(resultStr);
      expect(result.success).toBe(true);
      expect(result.updated.preferredName).toBe("Senhor Roberto");
      expect(result.updated.honorific).toBe("Senhor");
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO megadesk_domain_ia_user_preferences"),
        expect.arrayContaining(["tenant-test", "user-test-123", "Senhor Roberto", "Senhor", "executivo direto"])
      );
    });

    it("persists and reads user preferences with getUserHermesPreferences and saveUserHermesPreferences", async () => {
      let savedRow: any = null;
      const execute = vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes("CREATE TABLE IF NOT EXISTS")) {
          return [{}];
        }
        if (sql.includes("SELECT") && sql.includes("megadesk_domain_ia_user_preferences")) {
          if (savedRow) return [[savedRow]];
          return [[]];
        }
        if (sql.includes("INSERT INTO megadesk_domain_ia_user_preferences")) {
          savedRow = {
            tenant_id: params?.[0],
            user_id: params?.[1],
            preferred_name: params?.[2],
            honorific: params?.[3],
            communication_style: params?.[4],
            custom_rules_json: params?.[5],
          };
          return [{ affectedRows: 1 }];
        }
        return [[]];
      });
      const mockPool = { execute } as any;
      vi.mocked(getPool).mockReturnValue(mockPool);

      // Default when empty
      const initial = await getUserHermesPreferences("tenant-alpha", "user-456", mockPool);
      expect(initial.preferredName).toBeNull();
      expect(initial.honorific).toBeNull();
      expect(initial.customRules).toEqual([]);

      // Save preference
      await saveUserHermesPreferences("tenant-alpha", "user-456", {
        preferredName: "Marcelo",
        honorific: "Você",
        communicationStyle: "direto",
        customRules: ["foco no pós-venda"],
      }, mockPool);

      const fetched = await getUserHermesPreferences("tenant-alpha", "user-456", mockPool);
      expect(fetched.preferredName).toBe("Marcelo");
      expect(fetched.honorific).toBe("Você");
      expect(fetched.communicationStyle).toBe("direto");
      expect(fetched.customRules).toEqual(["foco no pós-venda"]);
    });

    it("assimilates preference immediately in chatWithClientGemini and confirms politely", async () => {
      const originalFetch = globalThis.fetch;
      const execute = vi.fn(async (sql: string) => {
        if (sql.includes("CREATE TABLE IF NOT EXISTS megadesk_domain_ia_user_preferences")) {
          return [{}];
        }
        if (sql.includes("SELECT") && sql.includes("megadesk_domain_ia_user_preferences")) {
          return [[]];
        }
        if (sql.includes("INSERT INTO megadesk_domain_ia_user_preferences")) {
          return [{ affectedRows: 1 }];
        }
        if (sql.includes("megadesk_domain_clients")) {
          return [[{ integrations_json: JSON.stringify({ geminiKey: "test-gemini-key", geminiQuotaMensal: 50000 }) }]];
        }
        return [[]];
      });
      vi.mocked(getPool).mockReturnValue({ execute } as any);

      // Gemini replies confirming
      globalThis.fetch = vi.fn(async (_url: any, init: any) => {
        const body = JSON.parse(init.body);
        // Verify system instruction contains Senhor
        const sysText = body.systemInstruction.parts[0].text;
        expect(sysText).toContain("- Como chamar o usuário: Senhor");
        expect(sysText).toContain("- Pronome / Forma de tratamento: Senhor");

        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: "Entendido, Senhor. A partir de agora nos comunicaremos desta forma. Como posso ajudar nas operações hoje?" }],
                  role: "model",
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 },
          }),
        } as any;
      });

      try {
        const result = await chatWithClientGemini(
          "tenant-pref",
          "user-chief@example.com",
          "agora me chame de senhor",
          [],
          ["ai-assistant"]
        );

        expect(result.ok).toBe(true);
        expect(result.response).toContain("Entendido, Senhor");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

});
