import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockEvoSendText = vi.fn();
const mockEvoSendAttachment = vi.fn();
vi.mock("../../evolution/client", () => ({
  evoSendText: (...args: any[]) => mockEvoSendText(...args),
  evoSendAttachment: (...args: any[]) => mockEvoSendAttachment(...args),
}));

vi.mock("../../evolution/session-store", () => ({
  instanceNameFor: (id: string) => `megadesk-${id}`,
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
  getLazyDb: () => ({}),
}));

const mockPgQuery = vi.fn();
vi.mock("./typebot-workspace.service", () => ({
  typebotWorkspaceService: {
    getPool: () => ({
      query: (...args: any[]) => mockPgQuery(...args),
    }),
  },
}));

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: any[]) => mockGenerateText(...args),
  tool: (config: any) => config,
  isStepCount: (count: number) => ({ type: "stepCount", count }),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => "mock-google-model",
}));

import {
  typebotMessageToText,
  typebotInputToText,
  mapChoiceAnswer,
  resolvePublishedTypebot,
  runTypebotTurn,
  __resetTypebotSessions,
} from "./typebot-runtime.service";
import {
  checkBotEligibility,
  deliverBotMessage,
  transferConversationToHuman,
} from "./bot-runtime";
import {
  dispatchBotConversationMessage,
  __resetCognitiveConversations,
} from "./bot-orchestrator";
import { processCognitiveBotMessage, ELEGANT_TRANSFER_MESSAGE } from "./bot-gemini-engine";

describe("Bot Orchestrator & Typebot Runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetTypebotSessions();
    __resetCognitiveConversations();
  });

  describe("typebotMessageToText & typebotInputToText", () => {
    it("converte markdown simples para WhatsApp format", () => {
      const msg = {
        type: "text",
        content: {
          type: "markdown",
          markdown: "Olá! **Bem-vindo** ao _MegaDesk_.",
        },
      };
      expect(typebotMessageToText(msg)).toBe("Olá! *Bem-vindo* ao _MegaDesk_.");
    });

    it("converte richText em texto plano", () => {
      const msg = {
        type: "text",
        content: {
          richText: [
            {
              type: "p",
              children: [
                { text: "Olá ", bold: false },
                { text: "cliente!", bold: true },
              ],
            },
          ],
        },
      };
      expect(typebotMessageToText(msg)).toBe("Olá *cliente!*");
    });

    it("converte choice input em opções numeradas com instrução", () => {
      const input = {
        type: "choice input",
        items: [{ content: "Vendas" }, { content: "Suporte" }, { content: "Financeiro" }],
      };
      expect(typebotInputToText(input)).toBe(
        "1. Vendas\n2. Suporte\n3. Financeiro\n\n_Responda com o número ou o texto da opção._"
      );
    });

    it("mapeia resposta de escolha por número ou texto", () => {
      const input = {
        type: "choice input",
        items: [{ content: "Falar com Atendente" }, { content: "Tirar Dúvidas" }],
      };
      expect(mapChoiceAnswer(input, "1")).toBe("Falar com Atendente");
      expect(mapChoiceAnswer(input, "2")).toBe("Tirar Dúvidas");
      expect(mapChoiceAnswer(input, "falar com atendente")).toBe("Falar com Atendente");
      expect(mapChoiceAnswer(input, "tirar duvidas")).toBe("Tirar Dúvidas");
      expect(mapChoiceAnswer(input, "outra coisa")).toBe("outra coisa");
    });
  });

  describe("resolvePublishedTypebot", () => {
    it("retorna o Typebot publicado mais recente do tenant", async () => {
      mockPgQuery.mockResolvedValueOnce({
        rows: [
          {
            typebotId: "tb-123",
            publicId: "atendimento-padrao-123",
            name: "Atendimento Padrão",
          },
        ],
      });

      const res = await resolvePublishedTypebot("tenant-alfa");
      expect(res).toEqual({
        typebotId: "tb-123",
        publicId: "atendimento-padrao-123",
        name: "Atendimento Padrão",
      });
      expect(mockPgQuery).toHaveBeenCalledWith(expect.any(String), ["tenant-alfa"]);
    });

    it("retorna null se não houver Typebot publicado", async () => {
      mockPgQuery.mockResolvedValueOnce({ rows: [] });
      const res = await resolvePublishedTypebot("tenant-sem-bot");
      expect(res).toBeNull();
    });
  });

  describe("checkBotEligibility", () => {
    it("retorna eligible: true quando conversa está com status bot e assigned_user_id bot_system", async () => {
      mockPoolExecute.mockResolvedValueOnce([
        [
          {
            status: "bot",
            assigned_user_id: "bot_system",
            bot_suspended_at: null,
          },
        ],
      ]);

      const res = await checkBotEligibility("tenant-1", "conv-1");
      expect(res).toEqual({ eligible: true });
    });

    it("retorna eligible: false quando conversa está atribuída a humano", async () => {
      mockPoolExecute.mockResolvedValueOnce([
        [
          {
            status: "bot",
            assigned_user_id: null, // Fila aguardando
            bot_suspended_at: null,
          },
        ],
      ]);

      const res = await checkBotEligibility("tenant-1", "conv-1");
      expect(res.eligible).toBe(false);
      expect((res as any).reason).toContain("fila humana");
    });

    it("retorna eligible: false quando bot está com suspensão de 24h", async () => {
      const future = new Date(Date.now() + 3600000).toISOString();
      mockPoolExecute.mockResolvedValueOnce([
        [
          {
            status: "bot",
            assigned_user_id: "bot_system",
            bot_suspended_at: future,
          },
        ],
      ]);

      const res = await checkBotEligibility("tenant-1", "conv-1");
      expect(res.eligible).toBe(false);
      expect((res as any).reason).toContain("trava 24h");
    });
  });

  describe("deliverBotMessage", () => {
    it("dispara via Evolution e salva no banco de dados", async () => {
      mockPoolExecute
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // insert message
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // update conversation

      await deliverBotMessage({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        phone: "5541999998888",
        text: "Olá! Como posso ajudar?",
      });

      expect(mockEvoSendText).toHaveBeenCalledWith(
        "megadesk-tenant-1",
        "5541999998888",
        "Olá! Como posso ajudar?"
      );
      expect(mockEmitOperationalTenantEvent).toHaveBeenCalledWith(
        "tenant-1",
        "conversation:message",
        expect.objectContaining({ conversationId: "conv-1" })
      );
    });

    it("dispara mídia via Evolution API e registra mensagem de mídia", async () => {
      mockPoolExecute
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // insert message
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // update conversation

      await deliverBotMessage({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        phone: "5541999998888",
        media: {
          type: "image",
          url: "https://app.megadesk.online/api/typebot-media/public/img.png",
          caption: "Veja nossa foto",
        },
      });

      expect(mockEvoSendAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceName: "megadesk-tenant-1",
          number: "5541999998888",
          kind: "image",
          caption: "Veja nossa foto",
        })
      );
    });
  });

  describe("transferConversationToHuman", () => {
    it("atualiza conversa para aguardando humano com trava de 24h", async () => {
      mockPoolExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await transferConversationToHuman({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        phone: "5541999998888",
        reason: "Cliente pediu atendente",
      });

      expect(mockPoolExecute).toHaveBeenCalledWith(
        expect.stringContaining("bot_suspended_at = DATE_ADD(NOW(), INTERVAL 24 HOUR)"),
        ["conv-1", "tenant-1"]
      );
      expect(mockEmitOperationalTenantEvent).toHaveBeenCalledWith(
        "tenant-1",
        "wa:transfer_to_human",
        expect.objectContaining({
          conversationId: "conv-1",
          status: "AGUARDANDO_HUMANO",
        })
      );
    });
  });

  describe("dispatchBotConversationMessage", () => {
    it("executa Typebot quando publicado e envia mensagens", async () => {
      // 1. Elegibilidade
      mockPoolExecute.mockResolvedValueOnce([
        [{ status: "bot", assigned_user_id: "bot_system", bot_suspended_at: null }],
      ]);
      // 2. Typebot publicado
      mockPgQuery.mockResolvedValueOnce({
        rows: [{ typebotId: "tb-1", publicId: "pub-1", name: "Atendimento Padrão" }],
      });

      // Mock global fetch para Typebot viewer startChat
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            sessionId: "sess-1",
            messages: [
              {
                type: "text",
                content: { type: "markdown", markdown: "Bem-vindo ao MegaDesk!" },
              },
            ],
          }),
      } as any);

      // Entregas da mensagem
      mockPoolExecute
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      try {
        await dispatchBotConversationMessage({
          tenantId: "tenant-1",
          conversationId: "conv-1",
          phone: "5541999998888",
          text: "Oi",
          customerName: "Carlos",
        });

        expect(mockEvoSendText).toHaveBeenCalledWith(
          "megadesk-tenant-1",
          "5541999998888",
          "Bem-vindo ao MegaDesk!"
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("faz fallback para Gemini quando nenhum Typebot publicado", async () => {
      // 1. Elegibilidade no orchestrator
      mockPoolExecute.mockResolvedValueOnce([
        [{ status: "bot", assigned_user_id: "bot_system", bot_suspended_at: null }],
      ]);
      // 2. Sem Typebot publicado
      mockPgQuery.mockResolvedValueOnce({ rows: [] });

      // 3. Fallback Gemini: elegibilidade interna
      mockPoolExecute.mockResolvedValueOnce([
        [{ status: "bot", assigned_user_id: "bot_system", bot_suspended_at: null }],
      ]);
      // 4. Company name
      mockPoolExecute.mockResolvedValueOnce([[{ company: "Empresa Teste" }]]);
      // 5. Histórico de mensagens
      mockPoolExecute.mockResolvedValueOnce([[]]);

      // Gemini AI generateText
      mockGenerateText.mockResolvedValueOnce({
        text: "Olá! Sou o assistente da Empresa Teste.",
      });

      // Entrega da mensagem
      mockPoolExecute
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      process.env.GEMINI_API_KEY = "dummy-key";

      await dispatchBotConversationMessage({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        phone: "5541999998888",
        text: "Qual o horário?",
      });

      expect(mockEvoSendText).toHaveBeenCalledWith(
        "megadesk-tenant-1",
        "5541999998888",
        "Olá! Sou o assistente da Empresa Teste."
      );
    });

    it("aciona transição cognitiva Gemini quando Typebot finaliza sem mensagens de retorno", async () => {
      // 1. Elegibilidade
      mockPoolExecute.mockResolvedValueOnce([
        [{ status: "bot", assigned_user_id: "bot_system", bot_suspended_at: null }],
      ]);
      // 2. Typebot publicado
      mockPgQuery.mockResolvedValueOnce({
        rows: [{ typebotId: "tb-1", publicId: "pub-1", name: "Atendimento Padrão" }],
      });

      // Typebot startChat retorna flowEnded=true e sem messages (absorveu dúvida em text input)
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify({ sessionId: "sess-1", messages: [] }),
      } as any);

      // Gemini AI fallback
      mockPoolExecute.mockResolvedValueOnce([
        [{ status: "bot", assigned_user_id: "bot_system", bot_suspended_at: null }],
      ]);
      mockPoolExecute.mockResolvedValueOnce([[{ company: "MegaDesk AI" }]]);
      mockPoolExecute.mockResolvedValueOnce([[]]);
      mockGenerateText.mockResolvedValueOnce({
        text: "Temos o servidor Dell PowerEdge em estoque com garantia de 3 anos!",
      });
      mockPoolExecute
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      process.env.GEMINI_API_KEY = "dummy-key";

      try {
        await dispatchBotConversationMessage({
          tenantId: "tenant-1",
          conversationId: "conv-1",
          phone: "5541999998888",
          text: "Vocês vendem servidor Dell?",
          customerName: "Carlos",
        });

        expect(mockEvoSendText).toHaveBeenCalledWith(
          "megadesk-tenant-1",
          "5541999998888",
          "Temos o servidor Dell PowerEdge em estoque com garantia de 3 anos!"
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe("processCognitiveBotMessage - Política de Transbordo Elegante", () => {
    it("aciona transbordo elegante quando a IA não gera texto final", async () => {
      // 1. Elegibilidade
      mockPoolExecute.mockResolvedValueOnce([
        [{ status: "bot", assigned_user_id: "bot_system", bot_suspended_at: null }],
      ]);
      // 2. Empresa
      mockPoolExecute.mockResolvedValueOnce([[{ company: "FaYerS Company LTDA" }]]);
      // 3. Histórico
      mockPoolExecute.mockResolvedValueOnce([[]]);

      // IA retorna texto vazio
      mockGenerateText.mockResolvedValueOnce({ text: "" });

      // Transbordo humano + entrega da mensagem
      mockPoolExecute
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // transferConversationToHuman UPDATE
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // deliverBotMessage INSERT
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // deliverBotMessage UPDATE

      process.env.GEMINI_API_KEY = "test-key";

      const outcome = await processCognitiveBotMessage({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        phone: "5541999998888",
        text: "qual o valor da correia dentada?",
      });

      expect(outcome.replied).toBe(true);
      expect(outcome.transferredToHuman).toBe(true);
      expect(outcome.replyText).toBe(ELEGANT_TRANSFER_MESSAGE);

      expect(mockEvoSendText).toHaveBeenCalledWith(
        "megadesk-tenant-1",
        "5541999998888",
        ELEGANT_TRANSFER_MESSAGE
      );
    });

    it("aciona transbordo elegante de contingência em caso de erro na IA", async () => {
      // 1. Elegibilidade
      mockPoolExecute.mockResolvedValueOnce([
        [{ status: "bot", assigned_user_id: "bot_system", bot_suspended_at: null }],
      ]);
      // 2. Empresa
      mockPoolExecute.mockResolvedValueOnce([[{ company: "FaYerS Company LTDA" }]]);
      // 3. Histórico
      mockPoolExecute.mockResolvedValueOnce([[]]);

      // IA lança exceção (ex: timeout ou quota excedida)
      mockGenerateText.mockRejectedValueOnce(new Error("Gemini API rate limit exceeded"));

      // Contingência: transbordo humano + entrega da mensagem elegante
      mockPoolExecute
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // transferConversationToHuman UPDATE
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // deliverBotMessage INSERT
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // deliverBotMessage UPDATE

      process.env.GEMINI_API_KEY = "test-key";

      const outcome = await processCognitiveBotMessage({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        phone: "5541999998888",
        text: "preciso de cotação de filtro de óleo",
      });

      expect(outcome.replied).toBe(true);
      expect(outcome.transferredToHuman).toBe(true);
      expect(outcome.replyText).toBe(ELEGANT_TRANSFER_MESSAGE);

      expect(mockEvoSendText).toHaveBeenCalledWith(
        "megadesk-tenant-1",
        "5541999998888",
        ELEGANT_TRANSFER_MESSAGE
      );
    });
  });
});
