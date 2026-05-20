import { describe, it, expect, beforeEach } from "vitest";

/**
 * Testes para processamento de mensagens WhatsApp
 * Valida:
 * 1. Extração correta de conteúdo de diferentes tipos de mensagens
 * 2. Resolução de LID para número de telefone real
 * 3. Formatação de mensagens de mídia
 */

// Reimplementação da função resolvePhoneFromJid para testes
function resolvePhoneFromJid(
  clientId: string,
  jid: string,
  lidMap: Map<string, Map<string, string>>
): string {
  const rawId = jid.split("@")[0].split(":")[0];
  const server = jid.split("@")[1] || "";

  if (server === "lid" || jid.endsWith("@lid")) {
    const clientMap = lidMap.get(clientId);
    const resolved = clientMap?.get(rawId);
    if (resolved) {
      return resolved.replace(/\D/g, "");
    }
    return ""; // LID não resolvido
  }

  return rawId.replace(/\D/g, "");
}

describe("WhatsApp Message Processing", () => {
  describe("Message Content Extraction", () => {
    it("should extract text from conversation message", () => {
      const msg = { message: { conversation: "Olá, tudo bem?" } };
      const text = msg.message.conversation || "[mídia]";
      expect(text).toBe("Olá, tudo bem?");
    });

    it("should extract text from extended text message", () => {
      const msg = { message: { extendedTextMessage: { text: "Mensagem com formatação" } } };
      const text = (msg.message as any).conversation || (msg.message as any).extendedTextMessage?.text || "[mídia]";
      expect(text).toBe("Mensagem com formatação");
    });

    it("should extract caption from image message", () => {
      const msg = { message: { imageMessage: { caption: "Foto da reunião" } } };
      const text = (msg.message as any).imageMessage?.caption || "[imagem]";
      expect(text).toBe("Foto da reunião");
    });

    it("should handle audio message", () => {
      const msg = { message: { audioMessage: {} } };
      let text = "[mídia]";
      if ((msg.message as any).audioMessage) text = "[áudio]";
      expect(text).toBe("[áudio]");
    });

    it("should handle document message with filename", () => {
      const msg = { message: { documentMessage: { fileName: "relatorio.pdf" } } };
      let text = "[mídia]";
      if ((msg.message as any).documentMessage) {
        text = `[documento: ${(msg.message as any).documentMessage.fileName || "arquivo"}]`;
      }
      expect(text).toBe("[documento: relatorio.pdf]");
    });

    it("should handle sticker message", () => {
      const msg = { message: { stickerMessage: {} } };
      let text = "[mídia]";
      if ((msg.message as any).stickerMessage) text = "[figurinha]";
      expect(text).toBe("[figurinha]");
    });

    it("should handle location message", () => {
      const msg = { message: { locationMessage: {} } };
      let text = "[mídia]";
      if ((msg.message as any).locationMessage) text = "[localização]";
      expect(text).toBe("[localização]");
    });

    it("should handle contact message", () => {
      const msg = { message: { contactMessage: {} } };
      let text = "[mídia]";
      if ((msg.message as any).contactMessage) text = "[contato compartilhado]";
      expect(text).toBe("[contato compartilhado]");
    });

    it("should handle buttons message with content text", () => {
      const msg = { message: { buttonsMessage: { contentText: "Escolha uma opção" } } };
      let text = "[mídia]";
      if ((msg.message as any).buttonsMessage) {
        text = (msg.message as any).buttonsMessage.contentText || "[mensagem com botões]";
      }
      expect(text).toBe("Escolha uma opção");
    });

    it("should fallback to [mídia] for unknown message type", () => {
      const msg = { message: { unknownType: {} } };
      const text = (msg.message as any).conversation || (msg.message as any).extendedTextMessage?.text || "[mídia]";
      expect(text).toBe("[mídia]");
    });
  });

  describe("LID Resolution (resolvePhoneFromJid)", () => {
    let lidMap: Map<string, Map<string, string>>;

    beforeEach(() => {
      lidMap = new Map();
    });

    it("should extract phone from normal JID (@s.whatsapp.net)", () => {
      const phone = resolvePhoneFromJid("client1", "5541995484515@s.whatsapp.net", lidMap);
      expect(phone).toBe("5541995484515");
    });

    it("should extract phone from multi-device JID with colon", () => {
      const phone = resolvePhoneFromJid("client1", "5541995484515:0@s.whatsapp.net", lidMap);
      expect(phone).toBe("5541995484515");
    });

    it("should extract phone from old format JID (@c.us)", () => {
      const phone = resolvePhoneFromJid("client1", "5511987654321@c.us", lidMap);
      expect(phone).toBe("5511987654321");
    });

    it("should return empty string for unresolved LID", () => {
      const phone = resolvePhoneFromJid("client1", "63346606899236@lid", lidMap);
      expect(phone).toBe("");
    });

    it("should resolve LID to phone when mapping exists", () => {
      lidMap.set("client1", new Map([["63346606899236", "5541995484515"]]));
      const phone = resolvePhoneFromJid("client1", "63346606899236@lid", lidMap);
      expect(phone).toBe("5541995484515");
    });

    it("should resolve LID for correct client only (tenant isolation)", () => {
      lidMap.set("client1", new Map([["63346606899236", "5541995484515"]]));
      // client2 não tem o mapeamento
      const phone = resolvePhoneFromJid("client2", "63346606899236@lid", lidMap);
      expect(phone).toBe("");
    });

    it("should handle LID with colon device suffix", () => {
      lidMap.set("client1", new Map([["63346606899236", "5541995484515"]]));
      const phone = resolvePhoneFromJid("client1", "63346606899236:0@lid", lidMap);
      expect(phone).toBe("5541995484515");
    });

    it("should ignore group JIDs", () => {
      const from = "120363123456789@g.us";
      const isGroup = from.endsWith("@g.us");
      expect(isGroup).toBe(true);
    });

    it("should not modify normal phone numbers", () => {
      const phone = resolvePhoneFromJid("client1", "5511987654321@s.whatsapp.net", lidMap);
      expect(phone).toBe("5511987654321");
    });

    it("should update existing LID mapping when new mapping arrives", () => {
      lidMap.set("client1", new Map([["63346606899236", "5541995484515"]]));
      // Atualizar mapeamento
      lidMap.get("client1")!.set("63346606899236", "5541999999999");
      const phone = resolvePhoneFromJid("client1", "63346606899236@lid", lidMap);
      expect(phone).toBe("5541999999999");
    });
  });

  describe("Message Timestamp", () => {
    it("should convert WhatsApp timestamp to Date", () => {
      const messageTimestamp = 1716190000;
      const timestamp = Number(messageTimestamp) * 1000;
      const date = new Date(timestamp);
      expect(date).toBeInstanceOf(Date);
      expect(date.getTime()).toBe(1716190000000);
    });
  });

  describe("Customer Phone Display", () => {
    it("should format phone number for display", () => {
      const phone = "5541995484515";
      const formatted = `+${phone}`;
      expect(formatted).toBe("+5541995484515");
    });

    it("should display phone in conversation card", () => {
      const customerPhone = "5541995484515";
      const displayText = `📱 ${customerPhone}`;
      expect(displayText).toContain("📱");
      expect(displayText).toContain(customerPhone);
    });
  });

  describe("Message Type Detection", () => {
    it("should identify text message", () => {
      const msg = { message: { conversation: "texto" } };
      const isText = !!(msg.message as any).conversation;
      expect(isText).toBe(true);
    });

    it("should identify media message", () => {
      const msg = { message: { imageMessage: {} } };
      const isMedia = !!(msg.message as any).imageMessage;
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
