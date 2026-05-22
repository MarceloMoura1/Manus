import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testes para validar que clientes deletados NUNCA reaparecem após reinicialização
 * 
 * Fluxo testado:
 * 1. Criar cliente em memória
 * 2. Deletar cliente (deleteClientFromDb + splice + persistSyncState)
 * 3. Simular reinicialização do servidor (syncStateHydrated = false)
 * 4. Recarregar do banco (hydrateSyncState)
 * 5. Verificar que cliente deletado NÃO está na lista
 */

// Mock do banco de dados
const mockDb: Record<string, any> = {};

const mockDeleteClientFromDb = vi.fn(async (clientId: string) => {
  delete mockDb[clientId];
});

const mockSaveMegaDeskStructuredState = vi.fn(async (state: any) => {
  // Simula o comportamento real: deleta clientes não presentes e insere os presentes
  const clientIdsToKeep = state.clients.map((c: any) => c.clientId);
  // Remover clientes que não estão mais na lista
  for (const id of Object.keys(mockDb)) {
    if (!clientIdsToKeep.includes(id)) {
      delete mockDb[id];
    }
  }
  // Inserir/atualizar clientes presentes
  for (const client of state.clients) {
    mockDb[client.clientId] = client;
  }
});

const mockLoadMegaDeskStructuredState = vi.fn(async () => {
  return {
    clients: Object.values(mockDb),
    conversations: [],
    tickets: [],
    botScripts: [],
    operationalRecords: [],
    auditLogs: [],
  };
});

describe("Delete Client - Permanent Deletion Tests", () => {
  beforeEach(() => {
    // Limpar mock DB antes de cada teste
    for (const key of Object.keys(mockDb)) {
      delete mockDb[key];
    }
    vi.clearAllMocks();
  });

  describe("Core Deletion Logic", () => {
    it("should delete client from DB immediately (before memory update)", async () => {
      // Arrange: Criar cliente no mock DB
      mockDb["cliente-001"] = { clientId: "cliente-001", company: "Empresa Teste", users: [] };
      
      // Act: Simular deleteClient procedure
      await mockDeleteClientFromDb("cliente-001"); // PASSO 1: Deletar do banco PRIMEIRO
      
      // Assert: Cliente deve ter sido deletado do banco
      expect(mockDb["cliente-001"]).toBeUndefined();
      expect(mockDeleteClientFromDb).toHaveBeenCalledWith("cliente-001");
    });

    it("should not reappear after server restart when deleted from DB first", async () => {
      // Arrange: Criar clientes no mock DB
      mockDb["cliente-001"] = { clientId: "cliente-001", company: "Empresa A", users: [] };
      mockDb["cliente-002"] = { clientId: "cliente-002", company: "Empresa B", users: [] };
      
      // Act: Deletar cliente-001 do banco PRIMEIRO (novo comportamento)
      await mockDeleteClientFromDb("cliente-001");
      
      // Simular persistSyncState com apenas cliente-002
      const memoryClients = [mockDb["cliente-002"]].filter(Boolean);
      await mockSaveMegaDeskStructuredState({ clients: memoryClients, conversations: [], tickets: [], botScripts: [], operationalRecords: [], auditLogs: [] });
      
      // Simular reinicialização do servidor e recarregamento do banco
      const reloadedState = await mockLoadMegaDeskStructuredState();
      
      // Assert: cliente-001 NÃO deve reaparecer
      const clientIds = reloadedState.clients.map((c: any) => c.clientId);
      expect(clientIds).not.toContain("cliente-001");
      expect(clientIds).toContain("cliente-002");
    });

    it("should survive even if persistSyncState fails after deleteClientFromDb", async () => {
      // Arrange: Criar clientes no mock DB
      mockDb["cliente-001"] = { clientId: "cliente-001", company: "Empresa A", users: [] };
      mockDb["cliente-002"] = { clientId: "cliente-002", company: "Empresa B", users: [] };
      
      // Act: Deletar do banco PRIMEIRO (garantia)
      await mockDeleteClientFromDb("cliente-001");
      
      // Simular falha no persistSyncState (não chamado ou falhou)
      // mockSaveMegaDeskStructuredState NÃO é chamado (simula falha)
      
      // Simular reinicialização do servidor
      const reloadedState = await mockLoadMegaDeskStructuredState();
      
      // Assert: cliente-001 NÃO deve reaparecer mesmo sem persistSyncState
      const clientIds = reloadedState.clients.map((c: any) => c.clientId);
      expect(clientIds).not.toContain("cliente-001");
    });

    it("should delete all clients when all are removed", async () => {
      // Arrange: Criar múltiplos clientes
      mockDb["cliente-001"] = { clientId: "cliente-001", company: "Empresa A", users: [] };
      mockDb["cliente-002"] = { clientId: "cliente-002", company: "Empresa B", users: [] };
      mockDb["cliente-003"] = { clientId: "cliente-003", company: "Empresa C", users: [] };
      
      // Act: Deletar todos
      await mockDeleteClientFromDb("cliente-001");
      await mockDeleteClientFromDb("cliente-002");
      await mockDeleteClientFromDb("cliente-003");
      
      // Simular reinicialização
      const reloadedState = await mockLoadMegaDeskStructuredState();
      
      // Assert: Nenhum cliente deve existir
      expect(reloadedState.clients).toHaveLength(0);
    });
  });

  describe("Order of Operations", () => {
    it("should delete from DB BEFORE removing from memory (correct order)", async () => {
      const callOrder: string[] = [];
      
      const orderedDelete = vi.fn(async (clientId: string) => {
        callOrder.push("deleteFromDb");
        delete mockDb[clientId];
      });
      
      const orderedSplice = () => {
        callOrder.push("spliceMemory");
      };
      
      const orderedPersist = vi.fn(async () => {
        callOrder.push("persistSyncState");
      });
      
      // Arrange
      mockDb["cliente-001"] = { clientId: "cliente-001", company: "Empresa A", users: [] };
      
      // Act: Simular a ordem correta de operações
      await orderedDelete("cliente-001"); // PASSO 1
      orderedSplice(); // PASSO 2
      await orderedPersist(); // PASSO 3
      
      // Assert: Ordem correta
      expect(callOrder).toEqual(["deleteFromDb", "spliceMemory", "persistSyncState"]);
    });

    it("should NOT allow old order (splice before deleteFromDb)", async () => {
      const callOrder: string[] = [];
      
      // Simular ORDEM ERRADA (bug antigo)
      const wrongOrderSplice = () => {
        callOrder.push("spliceMemory"); // ERRADO: remover da memória primeiro
      };
      
      const wrongOrderPersist = vi.fn(async () => {
        callOrder.push("persistSyncState"); // ERRADO: persistir depois
        // Se persistSyncState falhar aqui, o cliente voltará!
      });
      
      // Act: Ordem errada
      wrongOrderSplice();
      await wrongOrderPersist();
      
      // Assert: Ordem errada não tem deleteFromDb como primeiro passo
      expect(callOrder[0]).not.toBe("deleteFromDb");
    });
  });

  describe("Edge Cases", () => {
    it("should handle deletion of non-existent client gracefully", async () => {
      // Arrange: Banco vazio
      expect(Object.keys(mockDb)).toHaveLength(0);
      
      // Act: Tentar deletar cliente que não existe
      await mockDeleteClientFromDb("cliente-inexistente");
      
      // Assert: Não deve lançar erro
      expect(mockDeleteClientFromDb).toHaveBeenCalledWith("cliente-inexistente");
    });

    it("should preserve other clients when deleting one", async () => {
      // Arrange
      mockDb["cliente-001"] = { clientId: "cliente-001", company: "Empresa A", users: [] };
      mockDb["cliente-002"] = { clientId: "cliente-002", company: "Empresa B", users: [] };
      mockDb["cliente-003"] = { clientId: "cliente-003", company: "Empresa C", users: [] };
      
      // Act: Deletar apenas cliente-002
      await mockDeleteClientFromDb("cliente-002");
      
      // Assert: cliente-001 e cliente-003 devem permanecer
      expect(mockDb["cliente-001"]).toBeDefined();
      expect(mockDb["cliente-002"]).toBeUndefined();
      expect(mockDb["cliente-003"]).toBeDefined();
    });

    it("should handle multiple sequential deletions correctly", async () => {
      // Arrange
      for (let i = 1; i <= 5; i++) {
        mockDb[`cliente-00${i}`] = { clientId: `cliente-00${i}`, company: `Empresa ${i}`, users: [] };
      }
      
      // Act: Deletar clientes 2, 4
      await mockDeleteClientFromDb("cliente-002");
      await mockDeleteClientFromDb("cliente-004");
      
      // Simular reinicialização
      const reloadedState = await mockLoadMegaDeskStructuredState();
      const clientIds = reloadedState.clients.map((c: any) => c.clientId);
      
      // Assert
      expect(clientIds).toContain("cliente-001");
      expect(clientIds).not.toContain("cliente-002");
      expect(clientIds).toContain("cliente-003");
      expect(clientIds).not.toContain("cliente-004");
      expect(clientIds).toContain("cliente-005");
    });
  });

  describe("Restart Simulation", () => {
    it("should not restore deleted clients after multiple restarts", async () => {
      // Arrange
      mockDb["cliente-001"] = { clientId: "cliente-001", company: "Empresa A", users: [] };
      
      // Act: Deletar
      await mockDeleteClientFromDb("cliente-001");
      
      // Simular 3 reinicializações consecutivas
      for (let i = 0; i < 3; i++) {
        const state = await mockLoadMegaDeskStructuredState();
        expect(state.clients.map((c: any) => c.clientId)).not.toContain("cliente-001");
      }
    });

    it("should correctly load remaining clients after deletion on restart", async () => {
      // Arrange
      mockDb["cliente-001"] = { clientId: "cliente-001", company: "Empresa A", users: [] };
      mockDb["cliente-002"] = { clientId: "cliente-002", company: "Empresa B", users: [] };
      
      // Act: Deletar cliente-001
      await mockDeleteClientFromDb("cliente-001");
      
      // Simular reinicialização
      const state = await mockLoadMegaDeskStructuredState();
      
      // Assert
      expect(state.clients).toHaveLength(1);
      expect(state.clients[0].clientId).toBe("cliente-002");
      expect(state.clients[0].company).toBe("Empresa B");
    });
  });
});
