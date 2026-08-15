import { describe, expect, it } from "vitest";
import { metaWebhookPayloadSchema } from "./index";

const validPayload = {
  object: "whatsapp_business_account",
  entry: [{
    id: "business-1",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "5500000000000", phone_number_id: "phone-1" },
        messages: [{
          from: "5500000000001",
          id: "message-1",
          timestamp: "1700000000",
          type: "text",
          text: { body: "mensagem fictícia" },
        }],
      },
    }],
  }],
};

describe("Meta webhook payload validation", () => {
  it("aceita um payload de mensagem válido", () => {
    expect(metaWebhookPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejeita evento sem identificador obrigatório do número", () => {
    const invalid = structuredClone(validPayload);
    Reflect.deleteProperty(invalid.entry[0].changes[0].value.metadata, "phone_number_id");
    expect(metaWebhookPayloadSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejeita payload desconhecido sem acessar propriedades internas", () => {
    expect(metaWebhookPayloadSchema.safeParse({ object: "unknown", entry: [{}] }).success).toBe(false);
  });
});
