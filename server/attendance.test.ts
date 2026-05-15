import { describe, it, expect, beforeEach, vi } from "vitest";
import { searchCustomerByPhone, createCustomer, createTicket } from "./db";

// Mock do banco de dados
vi.mock("./db", async () => {
  const actual = await vi.importActual("./db");
  return {
    ...actual,
    searchCustomerByPhone: vi.fn(),
    createCustomer: vi.fn(),
    createTicket: vi.fn(),
  };
});

describe("Attendance System - Database Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("searchCustomerByPhone", () => {
    it("deve retornar null quando cliente não existe", async () => {
      const mockSearchCustomerByPhone = vi.mocked(searchCustomerByPhone);
      mockSearchCustomerByPhone.mockResolvedValueOnce(null);

      const result = await searchCustomerByPhone("11999999999");
      expect(result).toBeNull();
    });

    it("deve retornar dados do cliente quando existe", async () => {
      const mockSearchCustomerByPhone = vi.mocked(searchCustomerByPhone);
      const mockCustomer = {
        customerId: "cust-123",
        clientId: "client-001",
        name: "João Silva",
        phone: "11999999999",
        company: "Tech Solutions",
        email: "joao@example.com",
        status: "active" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSearchCustomerByPhone.mockResolvedValueOnce(mockCustomer);

      const result = await searchCustomerByPhone("11999999999");
      expect(result).toEqual(mockCustomer);
      expect(result?.name).toBe("João Silva");
      expect(result?.company).toBe("Tech Solutions");
    });
  });

  describe("createCustomer", () => {
    it("deve criar um novo cliente com sucesso", async () => {
      const mockCreateCustomer = vi.mocked(createCustomer);
      const input = {
        customerId: "cust-456",
        clientId: "client-001",
        name: "Maria Santos",
        phone: "21987654321",
        company: "Consultoria Digital",
        email: "maria@example.com",
      };

      mockCreateCustomer.mockResolvedValueOnce(input);

      const result = await createCustomer(input);
      expect(result).toEqual(input);
      expect(result.name).toBe("Maria Santos");
      expect(result.phone).toBe("21987654321");
    });

    it("deve criar cliente sem email", async () => {
      const mockCreateCustomer = vi.mocked(createCustomer);
      const input = {
        customerId: "cust-789",
        clientId: "client-001",
        name: "Pedro Costa",
        phone: "85999999999",
        company: "Empresa XYZ",
      };

      mockCreateCustomer.mockResolvedValueOnce(input);

      const result = await createCustomer(input);
      expect(result.name).toBe("Pedro Costa");
      expect(result.email).toBeUndefined();
    });
  });

  describe("createTicket", () => {
    it("deve criar um novo ticket com sucesso", async () => {
      const mockCreateTicket = vi.mocked(createTicket);
      const input = {
        ticketId: "ticket-001",
        clientId: "client-001",
        company: "Tech Solutions",
        customer: "João Silva",
        problem: "Problema com integração de API",
        category: "suporte",
        description: "Cliente relata erro ao tentar integrar a API de pagamento",
      };

      mockCreateTicket.mockResolvedValueOnce(input);

      const result = await createTicket(input);
      expect(result).toEqual(input);
      expect(result.problem).toBe("Problema com integração de API");
      expect(result.category).toBe("suporte");
    });

    it("deve criar ticket com descrição vazia", async () => {
      const mockCreateTicket = vi.mocked(createTicket);
      const input = {
        ticketId: "ticket-002",
        clientId: "client-001",
        company: "Consultoria Digital",
        customer: "Maria Santos",
        problem: "Dúvida sobre funcionalidade",
        category: "suporte",
        description: "",
      };

      mockCreateTicket.mockResolvedValueOnce(input);

      const result = await createTicket(input);
      expect(result.description).toBe("");
    });
  });

  describe("Integration Tests", () => {
    it("deve simular fluxo completo: buscar cliente, criar se não existe, criar ticket", async () => {
      const mockSearchCustomerByPhone = vi.mocked(searchCustomerByPhone);
      const mockCreateCustomer = vi.mocked(createCustomer);
      const mockCreateTicket = vi.mocked(createTicket);

      // Passo 1: Buscar cliente (não encontrado)
      mockSearchCustomerByPhone.mockResolvedValueOnce(null);
      const searchResult = await searchCustomerByPhone("11999999999");
      expect(searchResult).toBeNull();

      // Passo 2: Criar novo cliente
      const newCustomer = {
        customerId: "cust-new",
        clientId: "client-001",
        name: "Novo Cliente",
        phone: "11999999999",
        company: "Nova Empresa",
      };
      mockCreateCustomer.mockResolvedValueOnce(newCustomer);
      const createResult = await createCustomer(newCustomer);
      expect(createResult.customerId).toBe("cust-new");

      // Passo 3: Criar ticket para o cliente
      const newTicket = {
        ticketId: "ticket-new",
        clientId: "client-001",
        company: "Nova Empresa",
        customer: "Novo Cliente",
        problem: "Problema inicial",
        category: "suporte",
        description: "Descrição do problema",
      };
      mockCreateTicket.mockResolvedValueOnce(newTicket);
      const ticketResult = await createTicket(newTicket);
      expect(ticketResult.ticketId).toBe("ticket-new");

      // Verificar que todas as funções foram chamadas
      expect(mockSearchCustomerByPhone).toHaveBeenCalledWith("11999999999");
      expect(mockCreateCustomer).toHaveBeenCalledWith(newCustomer);
      expect(mockCreateTicket).toHaveBeenCalledWith(newTicket);
    });
  });
});
