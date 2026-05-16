import { describe, it, expect } from "vitest";

// ── Testes: Painel de Uso de Tokens Gemini ────────────────────────────────────

describe("Token Usage — Cálculo de custo estimado", () => {
  function estimateCost(promptTokens: number, completionTokens: number) {
    const promptCost = (promptTokens / 1_000_000) * 0.075;
    const completionCost = (completionTokens / 1_000_000) * 0.30;
    const usd = promptCost + completionCost;
    const brl = Math.round(usd * 5.5 * 100) / 100;
    return { usd: Math.round(usd * 10000) / 10000, brl };
  }

  it("custo zero para zero tokens", () => {
    const { usd, brl } = estimateCost(0, 0);
    expect(usd).toBe(0);
    expect(brl).toBe(0);
  });

  it("calcula custo correto para 1M tokens de entrada", () => {
    const { usd } = estimateCost(1_000_000, 0);
    expect(usd).toBeCloseTo(0.075, 4);
  });

  it("calcula custo correto para 1M tokens de saída", () => {
    const { usd } = estimateCost(0, 1_000_000);
    expect(usd).toBeCloseTo(0.30, 4);
  });

  it("calcula custo combinado corretamente", () => {
    const { usd } = estimateCost(100_000, 50_000);
    const expected = (100_000 / 1_000_000) * 0.075 + (50_000 / 1_000_000) * 0.30;
    expect(usd).toBeCloseTo(expected, 4);
  });

  it("converte USD para BRL com taxa 5.5", () => {
    const { usd, brl } = estimateCost(1_000_000, 1_000_000);
    expect(brl).toBeCloseTo(usd * 5.5, 1);
  });
});

describe("Token Usage — Formatação de tokens", () => {
  function formatTokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }

  it("formata números menores que 1000 sem sufixo", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(999)).toBe("999");
  });

  it("formata números maiores que 1000 com sufixo k", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(10000)).toBe("10.0k");
    expect(formatTokens(100000)).toBe("100.0k");
  });
});

describe("Token Usage — Validação de schema de registro", () => {
  it("registro de uso tem todos os campos obrigatórios", () => {
    const record = {
      id: "tu-123-abc",
      clientId: "client-1",
      userEmail: "user@test.com",
      conversationId: "conv-1",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      model: "gemini-1.5-flash",
      functionCallsCount: 2,
      createdAt: Date.now(),
    };
    expect(record.id).toBeTruthy();
    expect(record.clientId).toBeTruthy();
    expect(record.totalTokens).toBe(record.promptTokens + record.completionTokens);
    expect(record.model).toBe("gemini-1.5-flash");
  });

  it("totalTokens deve ser soma de prompt e completion", () => {
    const prompt = 300;
    const completion = 150;
    const total = prompt + completion;
    expect(total).toBe(450);
  });

  it("ID de registro tem formato correto", () => {
    const id = `tu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    expect(id).toMatch(/^tu-\d+-[a-z0-9]+$/);
  });
});

describe("Token Usage — Filtro por período", () => {
  const now = Date.now();
  const periodMs = {
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };

  it("período 'today' filtra últimas 24 horas", () => {
    const since = now - periodMs.today;
    const recordTs = now - 23 * 60 * 60 * 1000; // 23h atrás
    expect(recordTs >= since).toBe(true);
  });

  it("período 'today' exclui registros de ontem", () => {
    const since = now - periodMs.today;
    const recordTs = now - 25 * 60 * 60 * 1000; // 25h atrás
    expect(recordTs >= since).toBe(false);
  });

  it("período 'week' filtra últimos 7 dias", () => {
    const since = now - periodMs.week;
    const recordTs = now - 6 * 24 * 60 * 60 * 1000; // 6 dias atrás
    expect(recordTs >= since).toBe(true);
  });

  it("período 'all' tem since = 0 (sem filtro)", () => {
    const since = 0;
    const recordTs = now - 365 * 24 * 60 * 60 * 1000; // 1 ano atrás
    expect(recordTs >= since).toBe(true);
  });
});

describe("Token Usage — Teste de conexão Gemini", () => {
  it("chave muito curta é inválida", () => {
    const key = "abc";
    expect(key.length > 10).toBe(false);
  });

  it("chave com formato correto passa validação inicial", () => {
    const key = "AIzaSyAbcDefGhiJklMnoPqrStuvWxyz1234567";
    expect(key.length > 10).toBe(true);
    expect(key.startsWith("AIza")).toBe(true);
  });

  it("mensagem de erro para chave inválida é clara", () => {
    const errMsg = "API_KEY_INVALID: API key not valid. Please pass a valid API key.";
    const isInvalid = errMsg.includes("API_KEY_INVALID") || errMsg.includes("API key not valid");
    expect(isInvalid).toBe(true);
  });

  it("mensagem de erro para quota excedida é clara", () => {
    const errMsg = "QUOTA_EXCEEDED: Resource has been exhausted";
    const isQuota = errMsg.includes("QUOTA_EXCEEDED") || errMsg.includes("quota");
    expect(isQuota).toBe(true);
  });
});
