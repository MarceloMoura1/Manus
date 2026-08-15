import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const mocks = vi.hoisted(() => ({
  resolveAccount: vi.fn(),
  processIncoming: vi.fn(),
  processStatus: vi.fn(),
}));

vi.mock("../repositories/whatsapp.repo", () => ({ getWaAccountByPhoneNumberId: mocks.resolveAccount }));
vi.mock("./message.processor", () => ({
  processIncomingMessage: mocks.processIncoming,
  processMessageStatus: mocks.processStatus,
}));

import { handleWebhookEvent, type WebhookRequest } from "./webhook.handler";

const validBody = {
  object: "whatsapp_business_account",
  entry: [{ id: "business", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "0000", phone_number_id: "phone-1" },
    messages: [{ from: "customer", id: "message-1", timestamp: "1700000000", type: "text", text: { body: "hello" } }],
    statuses: [{ id: "outbound-1", recipient_id: "customer", status: "delivered", timestamp: "1700000001" }],
  } }] }],
};

function request(body: unknown, signatureIsValid = true): WebhookRequest {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = signatureIsValid
    ? `sha256=${createHmac("sha256", "test-secret").update(rawBody).digest("hex")}`
    : "sha256=invalid";
  return { body, rawBody, headers: { "x-hub-signature-256": signature } } as WebhookRequest;
}

function response() {
  const result = { statusCode: 0, body: undefined as unknown };
  return {
    result,
    res: {
      status(code: number) { result.statusCode = code; return this; },
      json(body: unknown) { result.body = body; return this; },
    },
  };
}

describe("Meta webhook handler", () => {
  beforeEach(() => {
    process.env.META_APP_SECRET = "test-secret";
    mocks.resolveAccount.mockResolvedValue({ id: "account-1", clientId: "tenant-a" });
    mocks.processIncoming.mockResolvedValue(undefined);
    mocks.processStatus.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.clearAllMocks(); delete process.env.META_APP_SECRET; });

  it("validates and processes a supported event with authoritative tenant", async () => {
    const { res, result } = response();
    await handleWebhookEvent(request(validBody), res as never);
    expect(result.statusCode).toBe(200);
    expect(mocks.processIncoming).toHaveBeenCalledWith(expect.objectContaining({ clientId: "tenant-a" }), expect.anything(), undefined);
    expect(mocks.processStatus).toHaveBeenCalledWith("tenant-a", expect.objectContaining({ id: "outbound-1" }));
  });

  it("rejects a supported invalid event before success", async () => {
    const invalid = structuredClone(validBody);
    Reflect.deleteProperty(invalid.entry[0].changes[0].value.messages[0], "text");
    const { res, result } = response();
    await handleWebhookEvent(request(invalid), res as never);
    expect(result.statusCode).toBe(400);
    expect(mocks.resolveAccount).not.toHaveBeenCalled();
  });

  it("explicitly ignores a structurally valid unknown event", async () => {
    const { res, result } = response();
    await handleWebhookEvent(request({ object: "other_product", entry: [] }), res as never);
    expect(result).toEqual({ statusCode: 200, body: { status: "ignored" } });
  });

  it("rejects invalid signatures", async () => {
    const { res, result } = response();
    await handleWebhookEvent(request(validBody, false), res as never);
    expect(result.statusCode).toBe(401);
  });

  it("fails closed when secret configuration is absent", async () => {
    delete process.env.META_APP_SECRET;
    const { res, result } = response();
    await handleWebhookEvent(request(validBody), res as never);
    expect(result.statusCode).toBe(503);
  });

  it("does not process an ambiguous account resolution", async () => {
    mocks.resolveAccount.mockRejectedValue(new Error("WA_ACCOUNT_RESOLUTION_AMBIGUOUS"));
    const { res, result } = response();
    await handleWebhookEvent(request(validBody), res as never);
    expect(result.statusCode).toBe(200);
    expect(mocks.processIncoming).not.toHaveBeenCalled();
    expect(mocks.processStatus).not.toHaveBeenCalled();
  });
});
