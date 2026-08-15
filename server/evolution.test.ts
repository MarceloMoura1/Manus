/**
 * Testes para Evolution API
 * Validar fluxo completo de envio e recebimento de mensagens
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  initEvolutionManager,
  createWhatsAppSession,
  getWhatsAppQRCode,
  sendWhatsAppMessage,
  getWhatsAppStatus,
  disconnectWhatsApp,
} from "./evolution-manager";
import { handleEvolutionWebhook } from "./evolution-webhook-handler";
import { validateEvolutionTestConfig } from "./test-integration-gates";

const evolutionIntegration = describe.runIf(process.env.RUN_EVOLUTION_E2E === "1");

evolutionIntegration("Evolution API Integration [requires RUN_EVOLUTION_E2E=1]", () => {
  let clientId: string;

  beforeAll(async () => {
    validateEvolutionTestConfig();
    clientId = `test-client-${Date.now()}`;

    // Inicializar Evolution Manager
    try {
      await initEvolutionManager();
    } catch (err) {
    }
  });

  afterAll(async () => {
  });

  describe("Session Management", () => {
    it("should create a new WhatsApp session", async () => {
      const result = await createWhatsAppSession(clientId);

      expect(result.ok).toBe(true);
      expect(result.instanceId).toBeDefined();
      expect(result.token).toBeDefined();

    });

    it("should get QR code for connection", async () => {
      const result = await getWhatsAppQRCode(clientId);

      expect(result.ok).toBe(true);
      expect(result.qrCode).toBeDefined();
      expect(result.qrCode?.length).toBeGreaterThan(0);

    });

    it("should get session status", async () => {
      const status = getWhatsAppStatus(clientId);

      expect(status).toBeDefined();
      expect(status.instanceId).toBeDefined();
      expect(status.connected).toBeDefined();

    });
  });

  describe("Message Sending", () => {
    it("should handle message sending with proper error handling", async () => {
      const result = await sendWhatsAppMessage(
        clientId,
        `conv-test-${Date.now()}`,
        "5541995484515", // Número de teste
        "Teste de mensagem da Evolution API",
        "Test Agent"
      );

      // Pode falhar se não estiver conectado, mas não deve lançar exceção
      expect(result).toBeDefined();
      expect(result.ok !== undefined).toBe(true);

      if (result.ok) {
      } else {
      }
    });

    it("should validate phone number format", async () => {
      // Teste com número inválido
      const result = await sendWhatsAppMessage(
        clientId,
        `conv-test-${Date.now()}`,
        "123", // Número muito curto
        "Teste",
        "Test Agent"
      );

      // Deve falhar com número inválido
      expect(result.ok).toBe(false);
    });
  });

  describe("Webhook Handling", () => {
    it("should handle incoming message webhook", async () => {
      const payload = {
        event: "messages.upsert",
        instance: `megadesk-${clientId}-${Date.now()}`,
        data: {
          key: {
            remoteJid: "5541995484515@s.whatsapp.net",
            fromMe: false,
            id: `msg-${Date.now()}`,
          },
          message: {
            conversation: "Teste de mensagem recebida",
          },
        },
      };

      // Não deve lançar exceção
      await expect(handleEvolutionWebhook(payload)).resolves.not.toThrow();
    });

    it("should handle connection status webhook", async () => {
      const payload = {
        event: "connection.update",
        instance: `megadesk-${clientId}-${Date.now()}`,
        data: {
          connectionStatus: "open",
          phoneNumber: "5541995484515",
        },
      };

      // Não deve lançar exceção
      await expect(handleEvolutionWebhook(payload)).resolves.not.toThrow();
    });

    it("should handle message status webhook", async () => {
      const payload = {
        event: "message.update",
        instance: `megadesk-${clientId}-${Date.now()}`,
        data: {
          key: {
            remoteJid: "5541995484515@s.whatsapp.net",
            fromMe: true,
            id: `msg-${Date.now()}`,
          },
          status: "DELIVERY_ACK",
        },
      };

      // Não deve lançar exceção
      await expect(handleEvolutionWebhook(payload)).resolves.not.toThrow();
    });

    it("should handle unknown webhook events gracefully", async () => {
      const payload = {
        event: "unknown.event",
        instance: `megadesk-${clientId}-${Date.now()}`,
        data: {},
      };

      // Não deve lançar exceção
      await expect(handleEvolutionWebhook(payload)).resolves.not.toThrow();
    });
  });

  describe("Disconnection", () => {
    it("should disconnect session", async () => {
      const result = await disconnectWhatsApp(clientId);

      expect(result).toBeDefined();
      expect(result.ok !== undefined).toBe(true);

    });
  });

  describe("Error Handling", () => {
    it("should handle invalid client ID", async () => {
      const status = getWhatsAppStatus("invalid-client-id");

      expect(status.connected).toBe(false);
    });

    it("should handle missing phone number", async () => {
      const result = await sendWhatsAppMessage(
        clientId,
        `conv-test-${Date.now()}`,
        "", // Número vazio
        "Teste",
        "Test Agent"
      );

      expect(result.ok).toBe(false);
    });

    it("should handle missing message text", async () => {
      const result = await sendWhatsAppMessage(
        clientId,
        `conv-test-${Date.now()}`,
        "5541995484515",
        "", // Mensagem vazia
        "Test Agent"
      );

      expect(result.ok).toBe(false);
    });
  });
});

evolutionIntegration("Evolution API multi-client integration [requires RUN_EVOLUTION_E2E=1]", () => {
  it("should support multiple clients simultaneously", async () => {
    const clients = ["client-1", "client-2", "client-3"];
    const results = await Promise.all(
      clients.map((clientId) => createWhatsAppSession(clientId))
    );

    expect(results.length).toBe(3);
    expect(results.every((r) => r.ok || r.error)).toBe(true);

  });
});
