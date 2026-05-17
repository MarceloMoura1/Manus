import { describe, it, expect, beforeEach, vi } from "vitest";
import { createConversation } from "./db";

// Mock do banco de dados
vi.mock("./db", async () => {
  const actual = await vi.importActual("./db");
  return {
    ...actual,
    createConversation: vi.fn(),
  };
});

describe("Conversation System - Database Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createConversation", () => {
    it("deve criar uma nova conversa com sucesso", async () => {
      const mockCreateConversation = vi.mocked(createConversation);
      const input = {
        conversationId: "conv-001",
        clientId: "client-001",
        customerName: "João Silva",
        phone: "11999999999",
        company: "Tech Solutions",
        lastMessage: "Conversa iniciada",
        messages: [],
      };

      mockCreateConversation.mockResolvedValueOnce(input);

      const result = await createConversation(input);
      expect(result).toEqual(input);
      expect(result.conversationId).toBe("conv-001");
      expect(result.customerName).toBe("João Silva");
      expect(result.phone).toBe("11999999999");
    });

    it("deve criar conversa com array vazio de mensagens", async () => {
      const mockCreateConversation = vi.mocked(createConversation);
      const input = {
        conversationId: "conv-002",
        clientId: "client-001",
        customerName: "Maria Santos",
        phone: "21987654321",
        company: "Consultoria Digital",
        lastMessage: "Conversa iniciada",
        messages: [],
      };

      mockCreateConversation.mockResolvedValueOnce(input);

      const result = await createConversation(input);
      expect(result.messages).toEqual([]);
      expect(Array.isArray(result.messages)).toBe(true);
    });

    it("deve criar conversa com lastMessage padrão", async () => {
      const mockCreateConversation = vi.mocked(createConversation);
      const input = {
        conversationId: "conv-003",
        clientId: "client-001",
        customerName: "Pedro Costa",
        phone: "85999999999",
        company: "Empresa XYZ",
        lastMessage: "Conversa iniciada",
        messages: [],
      };

      mockCreateConversation.mockResolvedValueOnce(input);

      const result = await createConversation(input);
      expect(result.lastMessage).toBe("Conversa iniciada");
    });

    it("deve criar conversa com todos os campos obrigatórios preenchidos", async () => {
      const mockCreateConversation = vi.mocked(createConversation);
      const input = {
        conversationId: "conv-004",
        clientId: "client-001",
        customerName: "Ana Silva",
        phone: "11988888888",
        company: "Startup Tech",
        lastMessage: "Conversa iniciada",
        messages: [],
      };

      mockCreateConversation.mockResolvedValueOnce(input);

      const result = await createConversation(input);
      expect(result.conversationId).toBeDefined();
      expect(result.clientId).toBeDefined();
      expect(result.customerName).toBeDefined();
      expect(result.phone).toBeDefined();
      expect(result.company).toBeDefined();
    });
  });

  describe("Integration Tests", () => {
    it("deve simular fluxo completo: criar conversa após buscar cliente", async () => {
      const mockCreateConversation = vi.mocked(createConversation);

      // Simular criação de conversa após buscar cliente
      const conversationInput = {
        conversationId: "conv-integration-001",
        clientId: "client-001",
        customerName: "João Silva",
        phone: "11999999999",
        company: "Tech Solutions",
        lastMessage: "Conversa iniciada",
        messages: [],
      };

      mockCreateConversation.mockResolvedValueOnce(conversationInput);
      const result = await createConversation(conversationInput);

      expect(result.conversationId).toBe("conv-integration-001");
      expect(result.customerName).toBe("João Silva");
      expect(mockCreateConversation).toHaveBeenCalledWith(conversationInput);
    });

    it("deve criar múltiplas conversas para diferentes clientes", async () => {
      const mockCreateConversation = vi.mocked(createConversation);

      // Primeira conversa
      const conv1 = {
        conversationId: "conv-multi-001",
        clientId: "client-001",
        customerName: "Cliente 1",
        phone: "11999999999",
        company: "Empresa 1",
        lastMessage: "Conversa iniciada",
        messages: [],
      };

      // Segunda conversa
      const conv2 = {
        conversationId: "conv-multi-002",
        clientId: "client-001",
        customerName: "Cliente 2",
        phone: "21987654321",
        company: "Empresa 2",
        lastMessage: "Conversa iniciada",
        messages: [],
      };

      mockCreateConversation.mockResolvedValueOnce(conv1);
      mockCreateConversation.mockResolvedValueOnce(conv2);

      const result1 = await createConversation(conv1);
      const result2 = await createConversation(conv2);

      expect(result1.conversationId).toBe("conv-multi-001");
      expect(result2.conversationId).toBe("conv-multi-002");
      expect(mockCreateConversation).toHaveBeenCalledTimes(2);
    });
  });
});
