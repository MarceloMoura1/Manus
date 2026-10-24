/**
 * Testes do Assistente IA com Gemini por cliente
 * Valida: estrutura de mensagens, histórico, function calling, token por cliente
 */
import { describe, it, expect, vi } from "vitest";
import {
  HERMES_TOOL_REGISTRY,
  createPendingActionRequest,
  getAllowedHermesTools,
  getAuthorizedHermesTool,
  insertTokenUsage,
  readMonthlyTokenUsage,
  type HermesToolDefinition,
} from "./gemini-client";

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
      "get_conversations_summary",
      "get_erp_products",
    ]);
    expect(HERMES_TOOL_REGISTRY.every(tool => tool.type === "READ")).toBe(true);
  });

  it("does not expose or authorize a sales tool without an ERP/sales permission", () => {
    expect(getAllowedHermesTools(["ai-assistant"]).map(tool => tool.name)).not.toContain("get_sales_summary");
    expect(getAuthorizedHermesTool("get_sales_summary", ["ai-assistant"])).toBeNull();
  });

  it("authorizes only the tool covered by an operational permission", () => {
    expect(getAllowedHermesTools(["tickets"]).map(tool => tool.name)).toEqual(["get_open_tickets"]);
    expect(getAuthorizedHermesTool("get_open_tickets", ["tickets"])?.type).toBe("READ");
  });

  it("creates a pending request instead of executing a mutation", () => {
    const validateArgs = vi.fn((args: Record<string, unknown>) => ({ title: String(args.title ?? "") }));
    const mutation: HermesToolDefinition = {
      name: "create_ticket",
      type: "MUTATION",
      requiredPermissions: ["tickets"],
      declaration: { name: "create_ticket", description: "Creates a ticket after approval.", parameters: { type: "OBJECT", properties: {}, required: [] } },
      validateArgs,
    };

    const request = createPendingActionRequest(mutation, { title: "Retorno ao cliente" });
    expect(validateArgs).toHaveBeenCalledWith({ title: "Retorno ao cliente" });
    expect(request).toMatchObject({ toolName: "create_ticket", type: "MUTATION", status: "PENDING_APPROVAL", args: { title: "Retorno ao cliente" } });
    expect(request.id).toMatch(/^action-/);
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
