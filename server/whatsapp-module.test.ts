/**
 * Testes unitários do módulo WhatsApp
 * Cobre validators, types e lógica de isolamento multiempresa.
 */
import { describe, it, expect } from "vitest";
import {
  createWaAccountSchema,
  updateWaAccountSchema,
  deleteWaAccountSchema,
  listConversationsSchema,
  getConversationSchema,
  updateConversationSchema,
  markReadSchema,
  listMessagesSchema,
  sendTextSchema,
  sendMediaSchema,
  sendTemplateSchema,
  oauthCallbackSchema,
  webhookVerifySchema,
} from "./modules/whatsapp/validators";

// ─── Validators ────────────────────────────────────────────────────────────────

describe("WhatsApp Validators", () => {
  describe("createWaAccountSchema", () => {
    it("aceita dados válidos", () => {
      const result = createWaAccountSchema.safeParse({
        clientId: "client-123",
        displayName: "Meu WhatsApp",
        phoneNumberId: "12345678901",
        businessAccountId: "98765432101",
        accessToken: "EAABwzLixnjYBO...",
      });
      expect(result.success).toBe(true);
    });

    it("rejeita clientId vazio", () => {
      const result = createWaAccountSchema.safeParse({
        clientId: "",
        displayName: "Meu WhatsApp",
        phoneNumberId: "12345678901",
        businessAccountId: "98765432101",
        accessToken: "EAABwzLixnjYBO...",
      });
      expect(result.success).toBe(false);
    });

    it("rejeita displayName muito longo", () => {
      const result = createWaAccountSchema.safeParse({
        clientId: "client-123",
        displayName: "A".repeat(181),
        phoneNumberId: "12345678901",
        businessAccountId: "98765432101",
        accessToken: "EAABwzLixnjYBO...",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateWaAccountSchema", () => {
    it("aceita atualização parcial", () => {
      const result = updateWaAccountSchema.safeParse({
        clientId: "client-123",
        accountId: "acc-456",
        displayName: "Novo Nome",
      });
      expect(result.success).toBe(true);
    });

    it("aceita atualização de status", () => {
      const result = updateWaAccountSchema.safeParse({
        clientId: "client-123",
        accountId: "acc-456",
        status: "inactive",
      });
      expect(result.success).toBe(true);
    });

    it("rejeita status inválido", () => {
      const result = updateWaAccountSchema.safeParse({
        clientId: "client-123",
        accountId: "acc-456",
        status: "unknown",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("deleteWaAccountSchema", () => {
    it("aceita dados válidos", () => {
      const result = deleteWaAccountSchema.safeParse({
        clientId: "client-123",
        accountId: "acc-456",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("listConversationsSchema", () => {
    it("aceita filtros opcionais", () => {
      const result = listConversationsSchema.safeParse({
        clientId: "client-123",
        status: "open",
        search: "João",
        limit: 20,
        offset: 0,
      });
      expect(result.success).toBe(true);
    });

    it("aplica defaults para limit e offset", () => {
      const result = listConversationsSchema.safeParse({
        clientId: "client-123",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
        expect(result.data.offset).toBe(0);
      }
    });

    it("rejeita limit acima de 100", () => {
      const result = listConversationsSchema.safeParse({
        clientId: "client-123",
        limit: 101,
      });
      expect(result.success).toBe(false);
    });

    it("rejeita status inválido", () => {
      const result = listConversationsSchema.safeParse({
        clientId: "client-123",
        status: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("sendTextSchema", () => {
    it("aceita mensagem de texto válida", () => {
      const result = sendTextSchema.safeParse({
        clientId: "client-123",
        conversationId: "conv-456",
        text: "Olá, como posso ajudar?",
      });
      expect(result.success).toBe(true);
    });

    it("rejeita texto vazio", () => {
      const result = sendTextSchema.safeParse({
        clientId: "client-123",
        conversationId: "conv-456",
        text: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejeita texto acima de 4096 caracteres", () => {
      const result = sendTextSchema.safeParse({
        clientId: "client-123",
        conversationId: "conv-456",
        text: "A".repeat(4097),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("sendMediaSchema", () => {
    it("aceita envio de imagem válido", () => {
      const result = sendMediaSchema.safeParse({
        clientId: "client-123",
        conversationId: "conv-456",
        type: "image",
        mediaUrl: "https://example.com/image.jpg",
        caption: "Foto do produto",
      });
      expect(result.success).toBe(true);
    });

    it("rejeita URL inválida", () => {
      const result = sendMediaSchema.safeParse({
        clientId: "client-123",
        conversationId: "conv-456",
        type: "image",
        mediaUrl: "not-a-url",
      });
      expect(result.success).toBe(false);
    });

    it("rejeita tipo de mídia inválido", () => {
      const result = sendMediaSchema.safeParse({
        clientId: "client-123",
        conversationId: "conv-456",
        type: "gif",
        mediaUrl: "https://example.com/file.gif",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("sendTemplateSchema", () => {
    it("aceita template válido com languageCode padrão", () => {
      const result = sendTemplateSchema.safeParse({
        clientId: "client-123",
        conversationId: "conv-456",
        templateName: "hello_world",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.languageCode).toBe("pt_BR");
      }
    });
  });

  describe("oauthCallbackSchema", () => {
    it("aceita callback OAuth válido", () => {
      const result = oauthCallbackSchema.safeParse({
        clientId: "client-123",
        code: "oauth-code-abc123",
        displayName: "Meu WhatsApp",
      });
      expect(result.success).toBe(true);
    });

    it("aplica displayName padrão", () => {
      const result = oauthCallbackSchema.safeParse({
        clientId: "client-123",
        code: "oauth-code-abc123",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe("Meu WhatsApp");
      }
    });
  });

  describe("webhookVerifySchema", () => {
    it("aceita verificação de webhook válida", () => {
      const result = webhookVerifySchema.safeParse({
        "hub.mode": "subscribe",
        "hub.verify_token": "my-verify-token",
        "hub.challenge": "challenge-string",
      });
      expect(result.success).toBe(true);
    });

    it("rejeita hub.mode diferente de subscribe", () => {
      const result = webhookVerifySchema.safeParse({
        "hub.mode": "unsubscribe",
        "hub.verify_token": "my-verify-token",
        "hub.challenge": "challenge-string",
      });
      expect(result.success).toBe(false);
    });
  });
});

// ─── Isolamento multiempresa ───────────────────────────────────────────────────

describe("WhatsApp Module — Isolamento multiempresa", () => {
  it("clientId é obrigatório em todos os schemas de listagem", () => {
    const schemas = [
      listConversationsSchema,
      getConversationSchema,
      markReadSchema,
      listMessagesSchema,
    ];
    for (const schema of schemas) {
      const result = (schema as any).safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const hasClientIdError = result.error.issues.some(
          (i: any) => i.path.includes("clientId")
        );
        expect(hasClientIdError).toBe(true);
      }
    }
  });

  it("clientId é obrigatório em todos os schemas de mutação", () => {
    const schemas = [
      createWaAccountSchema,
      deleteWaAccountSchema,
      updateConversationSchema,
    ];
    for (const schema of schemas) {
      const result = (schema as any).safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const hasClientIdError = result.error.issues.some(
          (i: any) => i.path.includes("clientId")
        );
        expect(hasClientIdError).toBe(true);
      }
    }
  });
});
