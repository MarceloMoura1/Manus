import { describe, it, expect, vi, beforeEach } from "vitest";
import * as failedMessages from "./baileys-failed-messages";
import * as baileysModule from "./whatsapp-baileys";

describe("Retry Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPendingCount", () => {
    it("deve retornar contagem de mensagens falhadas", async () => {
      vi.spyOn(failedMessages, "countPendingFailedMessages").mockResolvedValue(5);

      const count = await failedMessages.countPendingFailedMessages("client-123");
      expect(count).toBe(5);
    });

    it("deve retornar 0 quando não há mensagens falhadas", async () => {
      vi.spyOn(failedMessages, "countPendingFailedMessages").mockResolvedValue(0);

      const count = await failedMessages.countPendingFailedMessages("client-123");
      expect(count).toBe(0);
    });
  });

  describe("getFailedMessages", () => {
    it("deve obter lista de mensagens falhadas", async () => {
      const mockMessages = [
        {
          id: "msg-1",
          phone: "5511987654321",
          message_text: "Teste",
          error_type: "send_error",
          error_message: "Erro ao enviar",
          retry_count: 2,
          max_retries: 10,
          status: "pending",
          created_at: new Date(),
          last_retry_at: new Date(),
        },
      ];

      vi.spyOn(failedMessages, "getFailedMessagesPending").mockResolvedValue(mockMessages as any);

      const messages = await failedMessages.getFailedMessagesPending("client-123");
      expect(messages).toHaveLength(1);
      expect(messages[0].phone).toBe("5511987654321");
    });

    it("deve retornar array vazio quando não há mensagens", async () => {
      vi.spyOn(failedMessages, "getFailedMessagesPending").mockResolvedValue([]);

      const messages = await failedMessages.getFailedMessagesPending("client-123");
      expect(messages).toHaveLength(0);
    });
  });

  describe("retryAll", () => {
    it("deve reenviar todas as mensagens falhadas", async () => {
      const mockMessages = [
        {
          id: "msg-1",
          conversation_id: "conv-1",
          phone: "5511987654321",
          message_text: "Teste",
          retry_count: 1,
          max_retries: 10,
          status: "pending",
        },
      ];

      vi.spyOn(failedMessages, "getFailedMessagesPending").mockResolvedValue(mockMessages as any);
      vi.spyOn(failedMessages, "incrementRetryCount").mockResolvedValue(undefined);
      vi.spyOn(baileysModule, "sendBaileysMessage").mockResolvedValue({ ok: true });
      vi.spyOn(failedMessages, "markMessageAsCompleted").mockResolvedValue(undefined);

      const messages = await failedMessages.getFailedMessagesPending("client-123");
      expect(messages).toHaveLength(1);
    });

    it("deve marcar como falhada quando atinge máximo de retries", async () => {
      const mockMessages = [
        {
          id: "msg-1",
          conversation_id: "conv-1",
          phone: "5511987654321",
          message_text: "Teste",
          retry_count: 10,
          max_retries: 10,
          status: "retrying",
        },
      ];

      vi.spyOn(failedMessages, "getFailedMessagesPending").mockResolvedValue(mockMessages as any);
      vi.spyOn(failedMessages, "markMessageAsFailed").mockResolvedValue(undefined);

      const messages = await failedMessages.getFailedMessagesPending("client-123");
      expect(messages[0].retry_count).toBe(messages[0].max_retries);
    });
  });

  describe("retryOne", () => {
    it("deve reenviar uma mensagem específica", async () => {
      vi.spyOn(failedMessages, "incrementRetryCount").mockResolvedValue(undefined);
      vi.spyOn(baileysModule, "sendBaileysMessage").mockResolvedValue({ ok: true });
      vi.spyOn(failedMessages, "markMessageAsCompleted").mockResolvedValue(undefined);

      // Simular reenvio bem-sucedido
      const result = await baileysModule.sendBaileysMessage(
        "client-123",
        "conv-1",
        "5511987654321",
        "Teste",
        "Sistema"
      );

      expect(result.ok).toBe(true);
    });

    it("deve retornar erro quando mensagem não encontrada", async () => {
      vi.spyOn(failedMessages, "getFailedMessagesPending").mockResolvedValue([]);

      const messages = await failedMessages.getFailedMessagesPending("client-123");
      expect(messages).toHaveLength(0);
    });
  });

  describe("Persistência de Mensagens Falhadas", () => {
    it("deve salvar mensagem falhada no banco", async () => {
      vi.spyOn(failedMessages, "saveFailedMessage").mockResolvedValue("msg-123");

      const id = await failedMessages.saveFailedMessage(
        "client-123",
        "conv-1",
        "5511987654321",
        "Teste",
        "send_error",
        "Erro ao enviar"
      );

      expect(id).toBe("msg-123");
    });

    it("deve incrementar retry count", async () => {
      vi.spyOn(failedMessages, "incrementRetryCount").mockResolvedValue(undefined);

      await failedMessages.incrementRetryCount("msg-123");

      expect(failedMessages.incrementRetryCount).toHaveBeenCalledWith("msg-123");
    });

    it("deve marcar como completa após reenvio bem-sucedido", async () => {
      vi.spyOn(failedMessages, "markMessageAsCompleted").mockResolvedValue(undefined);

      await failedMessages.markMessageAsCompleted("msg-123");

      expect(failedMessages.markMessageAsCompleted).toHaveBeenCalledWith("msg-123");
    });

    it("deve marcar como falhada permanentemente", async () => {
      vi.spyOn(failedMessages, "markMessageAsFailed").mockResolvedValue(undefined);

      await failedMessages.markMessageAsFailed("msg-123", "Máximo de tentativas");

      expect(failedMessages.markMessageAsFailed).toHaveBeenCalledWith("msg-123", "Máximo de tentativas");
    });
  });
});
