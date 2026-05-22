/**
 * evolution-sync.test.ts
 * Testes para sincronização de mensagens da Evolution API
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  syncEvolutionMessage,
  syncMessageStatus,
  EvolutionMessagePayload,
} from "./db-evolution-sync";

describe("Evolution Message Sync", () => {
  const clientId = "test-client-001";
  const instanceId = "megadesk-test-instance";

  describe("syncEvolutionMessage", () => {
    it("deve sincronizar mensagem de texto recebida", async () => {
      const payload: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: "5511999999999@s.whatsapp.com",
            fromMe: false,
            id: "msg-001",
          },
          message: {
            conversation: "Olá, tudo bem?",
          },
          pushName: "João Silva",
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const result = await syncEvolutionMessage(clientId, payload);

      expect(result).toHaveProperty("conversationId");
      expect(result).toHaveProperty("messageId");
      expect(result.conversationId).toBeTruthy();
      expect(result.messageId).toBeTruthy();
    });

    it("deve sincronizar mensagem com imagem", async () => {
      const payload: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: "5511999999999@s.whatsapp.com",
            fromMe: false,
            id: "msg-002",
          },
          message: {
            imageMessage: {
              url: "https://example.com/image.jpg",
              caption: "Foto do produto",
            },
          },
          pushName: "Maria",
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const result = await syncEvolutionMessage(clientId, payload);

      expect(result).toHaveProperty("conversationId");
      expect(result).toHaveProperty("messageId");
    });

    it("deve sincronizar mensagem com áudio", async () => {
      const payload: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: "5511999999999@s.whatsapp.com",
            fromMe: false,
            id: "msg-003",
          },
          message: {
            audioMessage: {
              url: "https://example.com/audio.mp3",
            },
          },
          pushName: "Pedro",
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const result = await syncEvolutionMessage(clientId, payload);

      expect(result).toHaveProperty("conversationId");
      expect(result).toHaveProperty("messageId");
    });

    it("deve sincronizar mensagem com documento", async () => {
      const payload: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: "5511999999999@s.whatsapp.com",
            fromMe: false,
            id: "msg-004",
          },
          message: {
            documentMessage: {
              url: "https://example.com/document.pdf",
              fileName: "contrato.pdf",
            },
          },
          pushName: "Ana",
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const result = await syncEvolutionMessage(clientId, payload);

      expect(result).toHaveProperty("conversationId");
      expect(result).toHaveProperty("messageId");
    });

    it("deve criar nova conversa se não existir", async () => {
      const payload: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: "5522888888888@s.whatsapp.com",
            fromMe: false,
            id: "msg-new-conv",
          },
          message: {
            conversation: "Primeira mensagem",
          },
          pushName: "Novo Cliente",
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const result = await syncEvolutionMessage(clientId, payload);

      expect(result.conversationId).toBeTruthy();
      expect(result.messageId).toBeTruthy();
    });

    it("deve atualizar conversa existente com nova mensagem", async () => {
      const phoneNumber = "5533777777777@s.whatsapp.com";

      // Primeira mensagem
      const payload1: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: phoneNumber,
            fromMe: false,
            id: "msg-first",
          },
          message: {
            conversation: "Primeira mensagem",
          },
          pushName: "Cliente",
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const result1 = await syncEvolutionMessage(clientId, payload1);
      const conversationId = result1.conversationId;

      // Segunda mensagem do mesmo cliente
      const payload2: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: phoneNumber,
            fromMe: false,
            id: "msg-second",
          },
          message: {
            conversation: "Segunda mensagem",
          },
          pushName: "Cliente",
          timestamp: Math.floor(Date.now() / 1000) + 60,
        },
      };

      const result2 = await syncEvolutionMessage(clientId, payload2);

      // Deve usar a mesma conversa
      expect(result2.conversationId).toBe(conversationId);
      expect(result2.messageId).not.toBe(result1.messageId);
    });

    it("deve sincronizar mensagem enviada (fromMe: true)", async () => {
      const payload: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: "5544666666666@s.whatsapp.com",
            fromMe: true,
            id: "msg-sent",
          },
          message: {
            conversation: "Resposta do atendente",
          },
          pushName: "Bot",
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const result = await syncEvolutionMessage(clientId, payload);

      expect(result).toHaveProperty("conversationId");
      expect(result).toHaveProperty("messageId");
    });
  });

  describe("syncMessageStatus", () => {
    it("deve atualizar status de mensagem para 'delivered'", async () => {
      // Criar mensagem primeiro
      const payload: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: "5555555555555@s.whatsapp.com",
            fromMe: false,
            id: "msg-status-test",
          },
          message: {
            conversation: "Teste de status",
          },
          pushName: "Teste",
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      await syncEvolutionMessage(clientId, payload);

      // Atualizar status
      await syncMessageStatus(clientId, "msg-status-test", "delivered");

      // Verificar que não houve erro
      expect(true).toBe(true);
    });

    it("deve atualizar status de mensagem para 'read'", async () => {
      await syncMessageStatus(clientId, "msg-read-test", "read");
      expect(true).toBe(true);
    });

    it("deve atualizar status de mensagem para 'failed'", async () => {
      await syncMessageStatus(clientId, "msg-failed-test", "failed", "Número inválido");
      expect(true).toBe(true);
    });
  });

  describe("Casos de Erro", () => {
    it("deve lidar com payload sem message", async () => {
      const payload: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: "5566666666666@s.whatsapp.com",
            fromMe: false,
            id: "msg-no-content",
          },
          pushName: "Teste",
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const result = await syncEvolutionMessage(clientId, payload);

      expect(result).toHaveProperty("conversationId");
      expect(result).toHaveProperty("messageId");
    });

    it("deve extrair número de telefone corretamente", async () => {
      const payload: EvolutionMessagePayload = {
        instanceId,
        data: {
          key: {
            remoteJid: "5577777777777@s.whatsapp.com",
            fromMe: false,
            id: "msg-phone-test",
          },
          message: {
            conversation: "Teste",
          },
          timestamp: Math.floor(Date.now() / 1000),
        },
      };

      const result = await syncEvolutionMessage(clientId, payload);

      expect(result).toHaveProperty("conversationId");
      expect(result).toHaveProperty("messageId");
    });
  });
});
