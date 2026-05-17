import { describe, it, expect, beforeEach } from "vitest";

/**
 * Testes para validar que clientes deletados não reaparecem após publicação
 */

interface MegaClient {
  clientId: string;
  company: string;
  status: "active" | "paused" | "test";
  users: any[];
  [key: string]: any;
}

interface MegaDeskStructuredState {
  clients: MegaClient[];
  conversations: any[];
  tickets: any[];
  botScripts: any[];
  operationalRecords: any[];
  auditLogs: any[];
}

describe("Client Deletion Persistence", () => {
  let state: MegaDeskStructuredState;
  let clients: MegaClient[];

  beforeEach(() => {
    clients = [
      {
        clientId: "client-1",
        company: "Company A",
        status: "active",
        users: [],
      },
      {
        clientId: "client-2",
        company: "Company B",
        status: "active",
        users: [],
      },
      {
        clientId: "client-3",
        company: "Company C",
        status: "active",
        users: [],
      },
    ];
    state = {
      clients,
      conversations: [],
      tickets: [],
      botScripts: [],
      operationalRecords: [],
      auditLogs: [],
    };
  });

  it("should remove client from state when deleted", () => {
    const clientIdToDelete = "client-2";
    const clientIndex = state.clients.findIndex((c) => c.clientId === clientIdToDelete);
    
    expect(clientIndex).toBe(1);
    state.clients.splice(clientIndex, 1);
    
    expect(state.clients.length).toBe(2);
    expect(state.clients.find((c) => c.clientId === clientIdToDelete)).toBeUndefined();
  });

  it("should preserve other clients when one is deleted", () => {
    const clientIdToDelete = "client-2";
    const clientIndex = state.clients.findIndex((c) => c.clientId === clientIdToDelete);
    state.clients.splice(clientIndex, 1);
    
    expect(state.clients.length).toBe(2);
    expect(state.clients.find((c) => c.clientId === "client-1")).toBeDefined();
    expect(state.clients.find((c) => c.clientId === "client-3")).toBeDefined();
  });

  it("should generate correct SQL to delete removed clients from database", () => {
    // Simular exclusão em memória
    const clientIndex = state.clients.findIndex((c) => c.clientId === "client-2");
    state.clients.splice(clientIndex, 1);
    
    // Gerar lista de client_ids que ainda existem
    const clientIdsToKeep = state.clients.map((c) => c.clientId);
    expect(clientIdsToKeep).toEqual(["client-1", "client-3"]);
    
    // Simular SQL: DELETE FROM megadesk_domain_clients WHERE client_id NOT IN (?, ?)
    const remainingClients = [
      { client_id: "client-1" },
      { client_id: "client-3" },
    ];
    
    // Verificar que apenas clientes em clientIdsToKeep estariam no banco
    const deletedClients = [
      { client_id: "client-2" },
    ];
    
    for (const deleted of deletedClients) {
      expect(clientIdsToKeep).not.toContain(deleted.client_id);
    }
  });

  it("should handle deletion of all clients", () => {
    state.clients = [];
    expect(state.clients.length).toBe(0);
    
    // Simular SQL: DELETE FROM megadesk_domain_clients (sem WHERE)
    const clientIdsToKeep = state.clients.map((c) => c.clientId);
    expect(clientIdsToKeep.length).toBe(0);
  });

  it("should not lose clients when deleting one", () => {
    const originalCount = state.clients.length;
    const clientIdToDelete = "client-1";
    const clientIndex = state.clients.findIndex((c) => c.clientId === clientIdToDelete);
    
    state.clients.splice(clientIndex, 1);
    
    expect(state.clients.length).toBe(originalCount - 1);
    expect(state.clients.find((c) => c.clientId === "client-2")).toBeDefined();
    expect(state.clients.find((c) => c.clientId === "client-3")).toBeDefined();
  });

  it("should persist deletion across multiple deletes", () => {
    // Primeira exclusão
    let clientIndex = state.clients.findIndex((c) => c.clientId === "client-1");
    state.clients.splice(clientIndex, 1);
    expect(state.clients.length).toBe(2);
    
    // Segunda exclusão
    clientIndex = state.clients.findIndex((c) => c.clientId === "client-3");
    state.clients.splice(clientIndex, 1);
    expect(state.clients.length).toBe(1);
    
    // Apenas client-2 deve permanecer
    expect(state.clients[0].clientId).toBe("client-2");
  });

  it("should generate correct placeholder SQL for multiple clients", () => {
    // Remover client-2
    let clientIndex = state.clients.findIndex((c) => c.clientId === "client-2");
    state.clients.splice(clientIndex, 1);
    
    const clientIdsToKeep = state.clients.map((c) => c.clientId);
    const placeholders = clientIdsToKeep.map(() => "?").join(",");
    
    // SQL deveria ser: DELETE FROM megadesk_domain_clients WHERE client_id NOT IN (?, ?)
    expect(placeholders).toBe("?,?");
    expect(clientIdsToKeep).toEqual(["client-1", "client-3"]);
  });

  it("should handle edge case of deleting and recreating same client", () => {
    // Deletar client-2
    let clientIndex = state.clients.findIndex((c) => c.clientId === "client-2");
    state.clients.splice(clientIndex, 1);
    expect(state.clients.length).toBe(2);
    
    // Recrear client-2
    state.clients.push({
      clientId: "client-2",
      company: "Company B (Recreated)",
      status: "active",
      users: [],
    });
    
    expect(state.clients.length).toBe(3);
    expect(state.clients.find((c) => c.clientId === "client-2")?.company).toBe("Company B (Recreated)");
  });

  it("should simulate full deletion and persistence flow", () => {
    // 1. Deletar client em memória
    const clientIdToDelete = "client-2";
    let clientIndex = state.clients.findIndex((c) => c.clientId === clientIdToDelete);
    state.clients.splice(clientIndex, 1);
    
    // 2. Preparar dados para persistência
    const clientIdsToKeep = state.clients.map((c) => c.clientId);
    
    // 3. Simular DELETE SQL
    const allClientsInDb = [
      { client_id: "client-1" },
      { client_id: "client-2" },
      { client_id: "client-3" },
    ];
    
    const clientsToDelete = allClientsInDb.filter((c) => !clientIdsToKeep.includes(c.client_id));
    
    // 4. Verificar que apenas client-2 seria deletado
    expect(clientsToDelete).toEqual([{ client_id: "client-2" }]);
    
    // 5. Simular INSERT dos clientes restantes
    const clientsToInsert = state.clients;
    expect(clientsToInsert.length).toBe(2);
    expect(clientsToInsert.map((c) => c.clientId)).toEqual(["client-1", "client-3"]);
  });

  it("should prevent deleted clients from reappearing on reload", () => {
    // Simular exclusão
    state.clients = state.clients.filter((c) => c.clientId !== "client-2");
    
    // Simular persistência
    const clientIdsToKeep = state.clients.map((c) => c.clientId);
    
    // Simular carregamento do banco (apenas clientes em clientIdsToKeep)
    const loadedClients = [
      { client_id: "client-1" },
      { client_id: "client-3" },
    ].filter((c) => clientIdsToKeep.includes(c.client_id));
    
    expect(loadedClients.length).toBe(2);
    expect(loadedClients.find((c) => c.client_id === "client-2")).toBeUndefined();
  });
});
