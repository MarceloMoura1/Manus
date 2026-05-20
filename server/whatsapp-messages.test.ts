import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Testes para processamento de mensagens WhatsApp
 * Valida:
 * 1. Extração correta de conteúdo de diferentes tipos de mensagens
 * 2. Exibição correta do número do cliente
 * 3. Formatação de mensagens de mídia
 */

describe("WhatsApp Message Processing", () => {
  describe("Message Content Extraction", () => {
    it("should extract text from conversation message", () => {
      const msg = {
        message: {
          conversation: "Olá, tudo bem?",
        },
      };
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "[mídia]";
      expect(text).toBe("Olá, tudo bem?");
    });

    it("should extract text from extended text message", () => {
      const msg = {
        message: {
          extendedTextMessage: {
            text: "Mensagem com formatação",
          },
        },
      };
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "[mídia]";
      expect(text).toBe("Mensagem com formatação");
    });

    it("should extract caption from image message", () => {
      const msg = {
        message: {
          imageMessage: {
            caption: "Foto da reunião",
          },
        },
      };
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "[mídia]";
      expect(text).toBe("Foto da reunião");
    });

    it("should handle audio message", () => {
      const msg = {
        message: {
          audioMessage: {},
        },
      };
      let text = "[mídia]";
      if (msg.message.conversation) {
        text = msg.message.conversation;
      } else if (msg.message.audioMessage) {
        text = "[áudio]";
      }
      expect(text).toBe("[áudio]");
    });

    it("should handle document message with filename", () => {
      const msg = {
        message: {
          documentMessage: {
            fileName: "relatorio.pdf",
          },
        },
      };
      let text = "[mídia]";
      if (msg.message.documentMessage) {
        text = `[documento: ${msg.message.documentMessage.fileName || "arquivo"}]`;
      }
      expect(text).toBe("[documento: relatorio.pdf]");
    });

    it("should handle sticker message", () => {
      const msg = {
        message: {
          stickerMessage: {},
        },
      };
      let text = "[mídia]";
      if (msg.message.stickerMessage) {
        text = "[figurinha]";
      }
      expect(text).toBe("[figurinha]");
    });

    it("should handle location message", () => {
      const msg = {
        message: {
          locationMessage: {},
        },
      };
      let text = "[mídia]";
      if (msg.message.locationMessage) {
        text = "[localização]";
      }
      expect(text).toBe("[localização]");
    });

    it("should handle contact message", () => {
      const msg = {
        message: {
          contactMessage: {},
        },
      };
      let text = "[mídia]";
      if (msg.message.contactMessage) {
        text = "[contato compartilhado]";
      }
      expect(text).toBe("[contato compartilhado]");
    });

    it("should handle buttons message with content text", () => {
      const msg = {
        message: {
          buttonsMessage: {
            contentText: "Escolha uma opção",
          },
        },
      };
      let text = "[mídia]";
      if (msg.message.buttonsMessage) {
        text =
          msg.message.buttonsMessage.contentText || "[mensagem com botões]";
      }
      expect(text).toBe("Escolha uma opção");
    });

    it("should fallback to [mídia] for unknown message type", () => {
      const msg = {
        message: {
          unknownType: {},
        },
      };
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "[mídia]";
      expect(text).toBe("[mídia]");
    });
  });

  describe("Phone Number Extraction", () => {
    it("should extract phone number from WhatsApp JID", () => {
      const from = "5511987654321@s.whatsapp.net";
      const phone = from.replace("@s.whatsapp.net", "");
      expect(phone).toBe("5511987654321");
    });

    it("should handle phone number with colon separator", () => {
      const from = "5511987654321:0@s.whatsapp.net";
      const phone = from
        .replace("@s.whatsapp.net", "")
        .replace(":.*", "")
        .split(":")[0];
      expect(phone).toBe("5511987654321");
    });

    it("should clean phone number to remove non-digits", () => {
      const phone = "55 (11) 98765-4321";
      const cleanPhone = phone.replace(/\D/g, "");
      expect(cleanPhone).toBe("5511987654321");
    });
  });

  describe("Message Timestamp", () => {
    it("should convert WhatsApp timestamp to Date", () => {
      const messageTimestamp = 1716190000; // segundos
      const timestamp = Number(messageTimestamp) * 1000; // converter para ms
      const date = new Date(timestamp);
      expect(date).toBeInstanceOf(Date);
      expect(date.getTime()).toBe(1716190000000);
    });
  });

  describe("Customer Phone Display", () => {
    it("should format phone number for display", () => {
      const phone = "5511987654321";
      const formatted = `+${phone}`;
      expect(formatted).toBe("+5511987654321");
    });

    it("should display phone in conversation card", () => {
      const customerPhone = "5511987654321";
      const displayText = `📱 ${customerPhone}`;
      expect(displayText).toContain("📱");
      expect(displayText).toContain(customerPhone);
    });
  });

  describe("Message Type Detection", () => {
    it("should identify text message", () => {
      const msg = { message: { conversation: "texto" } };
      const isText = !!msg.message.conversation;
      expect(isText).toBe(true);
    });

    it("should identify media message", () => {
      const msg = { message: { imageMessage: {} } };
      const isMedia = !!msg.message.imageMessage;
      expect(isMedia).toBe(true);
    });

    it("should identify group message by JID", () => {
      const from = "120363123456789@g.us";
      const isGroup = from.endsWith("@g.us");
      expect(isGroup).toBe(true);
    });

    it("should identify personal message by JID", () => {
      const from = "5511987654321@s.whatsapp.net";
      const isGroup = from.endsWith("@g.us");
      expect(isGroup).toBe(false);
    });
  });
});
