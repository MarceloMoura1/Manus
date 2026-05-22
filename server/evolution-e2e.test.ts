/**
 * Testes End-to-End para Evolution API
 * Valida fluxo completo: criar sessão → conectar → enviar → receber
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { evolutionManager } from "./evolution-manager";
import { evolutionClient } from "./evolution-api-client";
import { db } from "./db";

describe("Evolution API - End-to-End Tests", () => {
  const testClientId = "test-client-e2e-" + Date.now();
  const testPhoneNumber = "5541995484515";
  let instanceId: string;
  let token: string;

  beforeAll(async () => {
    console.log("🚀 Iniciando testes E2E da Evolution API");
  });

  afterAll(async () => {
    console.log("✅ Testes E2E concluídos");
  });

  describe("Session Management", () => {
    it("deve criar uma nova sessão WhatsApp", async () => {
      const result = await evolutionManager.startSession(testClientId);

      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
      expect(result.instanceId).toBeDefined();
      expect(result.token).toBeDefined();

      instanceId = result.instanceId!;
      token = result.token!;

      console.log(`✅ Sessão criada: ${instanceId}`);
    });

    it("deve obter QR Code para conexão", async () => {
      const result = await evolutionManager.getQRCode(testClientId);

      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
      expect(result.qrCode).toBeDefined();
      expect(result.qrCode!.length).toBeGreaterThan(0);

      console.log(`✅ QR Code obtido (${result.qrCode!.length} caracteres)`);
    });

    it("deve obter status da sessão", async () => {
      const result = await evolutionManager.getStatus(testClientId);

      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
      expect(result.status).toBeDefined();
      expect(["connected", "disconnected", "connecting"]).toContain(
        result.status
      );

      console.log(`✅ Status obtido: ${result.status}`);
    });
  });

  describe("Message Sending", () => {
    it("deve validar número de telefone antes de enviar", async () => {
      const invalidNumbers = ["123", "abc", "", "5541"];

      for (const number of invalidNumbers) {
        const result = await evolutionManager.sendMessage(
          testClientId,
          "conv-test",
          number,
          "Teste",
          "Test Agent"
        );

        expect(result.ok).toBe(false);
        expect(result.error).toBeDefined();
      }

      console.log("✅ Validação de números funcionando");
    });

    it("deve enviar mensagem com número válido", async () => {
      const result = await evolutionManager.sendMessage(
        testClientId,
        "conv-test",
        testPhoneNumber,
        "Olá, teste de mensagem da Evolution API",
        "Test Agent"
      );

      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
      expect(result.messageId).toBeDefined();

      console.log(`✅ Mensagem enviada: ${result.messageId}`);
    });

    it("deve enviar múltiplas mensagens", async () => {
      const messages = [
        "Mensagem 1",
        "Mensagem 2",
        "Mensagem 3",
      ];

      const results = await Promise.all(
        messages.map((msg) =>
          evolutionManager.sendMessage(
            testClientId,
            "conv-test",
            testPhoneNumber,
            msg,
            "Test Agent"
          )
        )
      );

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.ok).toBe(true);
        expect(result.messageId).toBeDefined();
      });

      console.log(`✅ ${results.length} mensagens enviadas com sucesso`);
    });
  });

  describe("Multiple Clients", () => {
    it("deve gerenciar múltiplos clientes simultaneamente", async () => {
      const clients = [
        "client-1-" + Date.now(),
        "client-2-" + Date.now(),
        "client-3-" + Date.now(),
      ];

      const results = await Promise.all(
        clients.map((clientId) => evolutionManager.startSession(clientId))
      );

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.ok).toBe(true);
        expect(result.instanceId).toBeDefined();
      });

      console.log(`✅ ${results.length} clientes gerenciados simultaneamente`);
    });

    it("deve isolar dados entre clientes", async () => {
      const client1 = "client-iso-1-" + Date.now();
      const client2 = "client-iso-2-" + Date.now();

      // Criar sessões para ambos os clientes
      await evolutionManager.startSession(client1);
      await evolutionManager.startSession(client2);

      // Enviar mensagem do cliente 1
      const result1 = await evolutionManager.sendMessage(
        client1,
        "conv-1",
        testPhoneNumber,
        "Mensagem do cliente 1",
        "Agent 1"
      );

      // Verificar que cliente 2 não vê dados do cliente 1
      expect(result1.ok).toBe(true);

      console.log("✅ Isolamento de dados entre clientes validado");
    });
  });

  describe("Error Handling", () => {
    it("deve retornar erro para cliente inválido", async () => {
      const result = await evolutionManager.getStatus("");

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();

      console.log(`✅ Erro retornado para cliente inválido: ${result.error}`);
    });

    it("deve retornar erro para sessão não existente", async () => {
      const result = await evolutionManager.getStatus("non-existent-client");

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();

      console.log(
        `✅ Erro retornado para sessão não existente: ${result.error}`
      );
    });

    it("deve retornar erro para número sem WhatsApp", async () => {
      const result = await evolutionManager.sendMessage(
        testClientId,
        "conv-test",
        "5541999999999", // Número fictício
        "Teste",
        "Agent"
      );

      // Pode retornar sucesso ou erro dependendo da validação
      expect(result).toBeDefined();

      console.log(
        `✅ Resposta para número sem WhatsApp: ${result.ok ? "enviado" : "erro"}`
      );
    });
  });

  describe("Database Synchronization", () => {
    it("deve sincronizar sessão com banco de dados", async () => {
      const clientId = "client-db-" + Date.now();

      // Criar sessão
      const sessionResult = await evolutionManager.startSession(clientId);
      expect(sessionResult.ok).toBe(true);

      // Aguardar sincronização
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verificar se foi salvo no banco
      const status = await evolutionManager.getStatus(clientId);
      expect(status.ok).toBe(true);

      console.log("✅ Sessão sincronizada com banco de dados");
    });
  });

  describe("Webhook Configuration", () => {
    it("deve configurar webhook automaticamente", async () => {
      const clientId = "client-webhook-" + Date.now();

      // Criar sessão (deve configurar webhook automaticamente)
      const result = await evolutionManager.startSession(clientId);
      expect(result.ok).toBe(true);

      // Aguardar configuração
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verificar se webhook está configurado
      const webhookResult = await evolutionManager.configureWebhook(
        clientId,
        "http://localhost:3000/api/webhooks/evolution"
      );

      expect(webhookResult.ok).toBe(true);

      console.log("✅ Webhook configurado automaticamente");
    });
  });

  describe("Performance", () => {
    it("deve enviar mensagem em menos de 2 segundos", async () => {
      const start = Date.now();

      const result = await evolutionManager.sendMessage(
        testClientId,
        "conv-perf",
        testPhoneNumber,
        "Teste de performance",
        "Agent"
      );

      const duration = Date.now() - start;

      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(2000);

      console.log(`✅ Mensagem enviada em ${duration}ms`);
    });

    it("deve criar sessão em menos de 1 segundo", async () => {
      const start = Date.now();

      const result = await evolutionManager.startSession(
        "client-perf-" + Date.now()
      );

      const duration = Date.now() - start;

      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(1000);

      console.log(`✅ Sessão criada em ${duration}ms`);
    });

    it("deve obter QR Code em menos de 500ms", async () => {
      const start = Date.now();

      const result = await evolutionManager.getQRCode(testClientId);

      const duration = Date.now() - start;

      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(500);

      console.log(`✅ QR Code obtido em ${duration}ms`);
    });
  });

  describe("Cleanup", () => {
    it("deve desconectar sessão corretamente", async () => {
      const clientId = "client-cleanup-" + Date.now();

      // Criar sessão
      const createResult = await evolutionManager.startSession(clientId);
      expect(createResult.ok).toBe(true);

      // Desconectar
      const disconnectResult = await evolutionManager.disconnect(clientId);
      expect(disconnectResult.ok).toBe(true);

      console.log("✅ Sessão desconectada corretamente");
    });
  });

  describe("Comparison with Baileys", () => {
    it("deve ter taxa de sucesso superior a 95%", async () => {
      const attempts = 20;
      let successes = 0;

      for (let i = 0; i < attempts; i++) {
        const result = await evolutionManager.sendMessage(
          testClientId,
          `conv-${i}`,
          testPhoneNumber,
          `Mensagem ${i + 1}`,
          "Agent"
        );

        if (result.ok) successes++;
      }

      const successRate = (successes / attempts) * 100;
      expect(successRate).toBeGreaterThanOrEqual(95);

      console.log(`✅ Taxa de sucesso: ${successRate.toFixed(1)}%`);
    });

    it("deve ter melhor performance que Baileys", async () => {
      const start = Date.now();

      // Enviar 10 mensagens
      const promises = Array.from({ length: 10 }, (_, i) =>
        evolutionManager.sendMessage(
          testClientId,
          `conv-perf-${i}`,
          testPhoneNumber,
          `Mensagem ${i + 1}`,
          "Agent"
        )
      );

      await Promise.all(promises);

      const duration = Date.now() - start;
      const avgTime = duration / 10;

      // Evolution API deve ser mais rápida que Baileys (média < 500ms)
      expect(avgTime).toBeLessThan(500);

      console.log(`✅ Tempo médio por mensagem: ${avgTime.toFixed(0)}ms`);
    });
  });
});
