import { beforeEach, describe, expect, it, vi } from "vitest";

const webhookMocks = vi.hoisted(() => ({ poolExecute: vi.fn(), getConnection: vi.fn(), upsertSession: vi.fn() }));
vi.mock("../db", () => ({ getPool: () => ({ execute: webhookMocks.poolExecute, getConnection: webhookMocks.getConnection }) }));
vi.mock("./config", () => ({ getEvolutionWebhookSecret: () => "webhook-secret" }));
vi.mock("./session-store", () => ({ upsertSession: webhookMocks.upsertSession, instanceNameFor: (clientId: string) => `megadesk-${clientId}` }));

import { evolutionPhoneCandidates, handleEvolutionWebhook, normalizeEvolutionEvent, parseEvolutionIncomingMessage } from "./webhook";

function responseDouble() {
  const response: any = { statusCode: 200, body: undefined };
  response.status = vi.fn((code: number) => { response.statusCode = code; return response; });
  response.json = vi.fn((body: unknown) => { response.body = body; return response; });
  response.send = vi.fn(() => response);
  return response;
}

describe("Evolution webhook normalization", () => {
  it("normaliza o evento real com ponto", () => {
    expect(normalizeEvolutionEvent("messages.upsert")).toBe("MESSAGES_UPSERT");
  });

  it("associa número brasileiro canônico e legado sem 55", () => {
    expect(evolutionPhoneCandidates({ remoteJid: "5541995484515@s.whatsapp.net" }))
      .toEqual(["5541995484515", "41995484515"]);
  });

  it("canonicaliza JID brasileiro sem o nono dígito", () => {
    expect(evolutionPhoneCandidates({ remoteJid: "554195484515@s.whatsapp.net" }))
      .toEqual(["5541995484515", "554195484515", "41995484515"]);
  });

  it("prefere remoteJidAlt telefônico quando o principal é LID", () => {
    expect(evolutionPhoneCandidates({
      remoteJid: "123456789012345@lid",
      remoteJidAlt: "5541995484515@s.whatsapp.net",
    })).toEqual(["5541995484515", "41995484515"]);
  });

  it("não adivinha telefone a partir de LID sem mapping telefônico", () => {
    expect(evolutionPhoneCandidates({ remoteJid: "123456789012345@lid" })).toEqual([]);
  });

  it("ignora grupos", () => {
    expect(evolutionPhoneCandidates({ remoteJid: "12345@g.us" })).toEqual([]);
  });
});

describe("Evolution incoming content", () => {
  it.each([
    ["imageMessage", "image", "image/png", "Imagem"],
    ["videoMessage", "video", "video/mp4", "Vídeo"],
    ["audioMessage", "audio", "audio/ogg", "Áudio"],
    ["stickerMessage", "sticker", "image/webp", "Figurinha"],
    ["documentMessage", "document", "application/pdf", "Documento"],
  ] as const)("preserva %s em base64", (node, type, mimetype, label) => {
    const parsed = parseEvolutionIncomingMessage({
      message: { [node]: { mimetype, base64: "AQ==", fileName: "arquivo.bin" } },
    });
    expect(parsed).toMatchObject({
      text: `[${label}]`,
      payload: { type, mimeType: mimetype, mediaData: `data:${mimetype};base64,AQ==` },
    });
  });

  it("preserva a legenda da imagem", () => {
    expect(parseEvolutionIncomingMessage({
      message: { imageMessage: { mimetype: "image/png", base64: "AQ==", caption: "Foto do pedido" } },
    })).toMatchObject({ text: "Foto do pedido", payload: { type: "image" } });
  });

  it("lê o base64 no caminho emitido pela Evolution 2.3.7", () => {
    expect(parseEvolutionIncomingMessage({
      message: { imageMessage: { mimetype: "image/jpeg" }, base64: "AQ==" },
    })).toMatchObject({ payload: { mediaData: "data:image/jpeg;base64,AQ==" } });
  });

  it("converte contato em cartão acionável", () => {
    expect(parseEvolutionIncomingMessage({
      message: { contactMessage: { displayName: "Gerente", vcard: "BEGIN:VCARD\nTEL:+5541999999999\nEND:VCARD" } },
    })).toMatchObject({
      text: "[Contato]",
      payload: { type: "contact", contact: { name: "Gerente", vcard: "BEGIN:VCARD\nTEL:+5541999999999\nEND:VCARD" } },
    });
  });
});

describe("Evolution webhook HTTP contract", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid payload and 404 for an unknown instance", async () => {
    let res = responseDouble();
    await handleEvolutionWebhook({ headers: { "x-megadesk-webhook-secret": "webhook-secret" }, body: {} } as any, res);
    expect(res.statusCode).toBe(400);
    webhookMocks.poolExecute.mockResolvedValueOnce([[]]);
    res = responseDouble();
    await handleEvolutionWebhook({ headers: { "x-megadesk-webhook-secret": "webhook-secret" }, body: { event: "MESSAGES_UPSERT", instance: "unknown", data: {} } } as any, res);
    expect(res.statusCode).toBe(404);
  });

  it("returns 204 for an authenticated unsupported event", async () => {
    webhookMocks.poolExecute.mockResolvedValueOnce([[{ clientId: "tenant-a" }]]);
    const res = responseDouble();
    await handleEvolutionWebhook({ headers: { "x-megadesk-webhook-secret": "webhook-secret" }, body: { event: "PRESENCE_UPDATE", instance: "megadesk-tenant-a", data: {} } } as any, res);
    expect(res.statusCode).toBe(204);
    expect(res.json).not.toHaveBeenCalledWith({ ok: true });
  });

  it("returns 200 for a duplicate without appending it again", async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([[{ conversation_id: "conv-a", messages_json: "[]", customer_name: "Cliente" }]])
        .mockResolvedValueOnce([{ affectedRows: 0 }])
        .mockResolvedValueOnce([{}]),
    };
    webhookMocks.poolExecute.mockResolvedValueOnce([[{ clientId: "tenant-a" }]]);
    webhookMocks.getConnection.mockResolvedValueOnce(connection);
    const res = responseDouble();
    await handleEvolutionWebhook({ headers: { "x-megadesk-webhook-secret": "webhook-secret" }, body: { event: "MESSAGES_UPSERT", instance: "megadesk-tenant-a", data: { messages: [{ key: { id: "external-a", remoteJid: "5541995484515@s.whatsapp.net", fromMe: false }, message: { conversation: "Olá" } }] } } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("returns 200 after a supported event is persisted", async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([[{ conversation_id: "conv-a", messages_json: "[]", customer_name: "Cliente" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{}]),
    };
    webhookMocks.poolExecute.mockResolvedValueOnce([[{ clientId: "tenant-a" }]]);
    webhookMocks.getConnection.mockResolvedValueOnce(connection);
    const res = responseDouble();
    await handleEvolutionWebhook({ headers: { "x-megadesk-webhook-secret": "webhook-secret" }, body: { event: "MESSAGES_UPSERT", instance: "megadesk-tenant-a", data: { messages: [{ key: { id: "external-c", remoteJid: "5541995484515@s.whatsapp.net", fromMe: false }, message: { conversation: "Olá" } }] } } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("returns 503 when persistence fails so the provider can retry", async () => {
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn().mockResolvedValueOnce([{}]).mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValueOnce([{}]) };
    webhookMocks.poolExecute.mockResolvedValueOnce([[{ clientId: "tenant-a" }]]);
    webhookMocks.getConnection.mockResolvedValueOnce(connection);
    const res = responseDouble();
    await handleEvolutionWebhook({ headers: { "x-megadesk-webhook-secret": "webhook-secret" }, body: { event: "MESSAGES_UPSERT", instance: "megadesk-tenant-a", data: { messages: [{ key: { id: "external-b", remoteJid: "5541995484515@s.whatsapp.net", fromMe: false }, message: { conversation: "Olá" } }] } } } as any, res);
    expect(res.statusCode).toBe(503);
  });
});
