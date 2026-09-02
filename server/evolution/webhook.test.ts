import { beforeEach, describe, expect, it, vi } from "vitest";

const webhookMocks = vi.hoisted(() => ({ poolExecute: vi.fn(), getConnection: vi.fn(), upsertSession: vi.fn() }));
vi.mock("../db", () => ({ getPool: () => ({ execute: webhookMocks.poolExecute, getConnection: webhookMocks.getConnection }) }));
vi.mock("./config", () => ({ getEvolutionWebhookSecret: () => "webhook-secret" }));
vi.mock("./session-store", () => ({ upsertSession: webhookMocks.upsertSession, instanceNameFor: (clientId: string) => `megadesk-${clientId}` }));

import { canonicalEvolutionReceiptStatus, evolutionPhoneCandidates, extractEvolutionProviderName, extractEvolutionQuotedExternalMessageId, handleEvolutionWebhook, normalizeEvolutionEvent, parseEvolutionIncomingMessage, parseEvolutionMessageStatusUpdates, saveIncomingMessage, selectInboundContactName } from "./webhook";

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

  it("mapeia somente receipts reais da Evolution para estados canônicos", () => {
    expect(canonicalEvolutionReceiptStatus("SERVER_ACK")).toBe("sent");
    expect(canonicalEvolutionReceiptStatus("DELIVERY_ACK")).toBe("delivered");
    expect(canonicalEvolutionReceiptStatus("READ")).toBe("read");
    expect(canonicalEvolutionReceiptStatus("PLAYED")).toBe("played");
    expect(canonicalEvolutionReceiptStatus("ERROR")).toBe("failed");
    expect(canonicalEvolutionReceiptStatus("UNKNOWN")).toBeNull();
    expect(parseEvolutionMessageStatusUpdates([
      { keyId: "provider-delivered", status: "DELIVERY_ACK" },
      { key: { id: "provider-read" }, update: { status: "READ" } },
      { messageId: "provider-played", update: { status: "PLAYED" } },
      { id: "provider-failed", status: "ERROR" },
    ])).toEqual([
      { externalMessageId: "provider-delivered", status: "delivered" },
      { externalMessageId: "provider-read", status: "read" },
      { externalMessageId: "provider-played", status: "played" },
      { externalMessageId: "provider-failed", status: "failed" },
    ]);
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
  it("audita o pushName do payload real e preserva nomes manuais/ERP", () => {
    expect(extractEvolutionProviderName({ pushName: " Maria   dos Santos " })).toBe("Maria dos Santos");
    expect(selectInboundContactName(null, "Maria dos Santos", "5511999999999")).toBe("Maria dos Santos");
    expect(selectInboundContactName("Contato sem nome", "Maria dos Santos", "5511999999999")).toBe("Maria dos Santos");
    expect(selectInboundContactName("Maria Santos", "Maria dos Santos do Rosario", "5511999999999")).toBe("Maria Santos");
    expect(selectInboundContactName("Cliente ERP", "Nome WhatsApp", "5511999999999")).toBe("Cliente ERP");
    expect(selectInboundContactName(null, "", "5511999999999")).toBe("Contato sem nome");
  });

  it("reads quoted stanzaId from the prepared Evolution context", () => {
    expect(extractEvolutionQuotedExternalMessageId({
      contextInfo: { stanzaId: "original-prepared", participant: "5541999999999@s.whatsapp.net" },
      message: { conversation: "Resposta" },
    })).toBe("original-prepared");
    expect(extractEvolutionQuotedExternalMessageId({
      message: { extendedTextMessage: { text: "Resposta", contextInfo: { stanzaId: "original-raw" } } },
    })).toBe("original-raw");
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

  it("persists an outbound MESSAGES_UPDATE receipt without touching inbound rows", async () => {
    webhookMocks.poolExecute
      .mockResolvedValueOnce([[{ clientId: "tenant-a" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = responseDouble();
    await handleEvolutionWebhook({ headers: { "x-megadesk-webhook-secret": "webhook-secret" }, body: {
      event: "messages.update", instance: "megadesk-tenant-a", data: { keyId: "provider-read", status: "READ" },
    } } as any, res);
    expect(res.statusCode).toBe(200);
    const [sql, values] = webhookMocks.poolExecute.mock.calls[1];
    expect(String(sql)).toContain("external_message_id = ? AND direction = 'outbound'");
    expect(String(sql)).toContain("WHEN status = 'read' AND ? <> 'played' THEN status");
    expect(String(sql)).toContain("WHEN status = 'delivered' AND ? IN ('pending', 'sent') THEN status");
    expect(values).toEqual(["read", "read", "read", "read", "read", "tenant-a", "megadesk-tenant-a", "provider-read"]);
  });

  it("returns 200 for a duplicate without appending it again", async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[{ acquired: 1 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ contact_id: "contact-a" }]])
        .mockResolvedValueOnce([[{ conversation_id: "conv-a", messages_json: "[]", customer_name: "Cliente" }]])
        .mockRejectedValueOnce({ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry for key 'uq_mdcm_external'" })
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
        .mockResolvedValueOnce([[{ acquired: 1 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ contact_id: "contact-a" }]])
        .mockResolvedValueOnce([[{ conversation_id: "conv-a", messages_json: "[]", customer_name: "Cliente" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ messages_json: "[]" }]])
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
    const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn().mockResolvedValueOnce([[{ acquired: 1 }]]).mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValueOnce([{}]) };
    webhookMocks.poolExecute.mockResolvedValueOnce([[{ clientId: "tenant-a" }]]);
    webhookMocks.getConnection.mockResolvedValueOnce(connection);
    const res = responseDouble();
    await handleEvolutionWebhook({ headers: { "x-megadesk-webhook-secret": "webhook-secret" }, body: { event: "MESSAGES_UPSERT", instance: "megadesk-tenant-a", data: { messages: [{ key: { id: "external-b", remoteJid: "5541995484515@s.whatsapp.net", fromMe: false }, message: { conversation: "Olá" } }] } } } as any, res);
    expect(res.statusCode).toBe(503);
  });
});

describe("Evolution inbound attendance lifecycle", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(["open", "bot"])("appends an inbound message to an existing %s attendance", async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[{ acquired: 1 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ contact_id: "contact-a" }]])
        .mockResolvedValueOnce([[{ conversation_id: "conv-active", messages_json: "[]", customer_name: "Known" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ messages_json: "[]" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{}]),
    };
    webhookMocks.getConnection.mockResolvedValue(connection);
    await expect(saveIncomingMessage("tenant-a", "instance-a", "event-a", ["5541999999999"], "Known", "Oi", new Date()))
      .resolves.toBe("persisted");
    const sql = connection.execute.mock.calls.map(call => String(call[0])).join("\n");
    expect(sql).toContain("status IN ('open', 'bot')");
    expect(sql).not.toContain("INSERT INTO megadesk_domain_conversations\n          (");
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("links an inbound quoted message only inside the same tenant and attendance", async () => {
    const providerReference = { key: { id: "event-reply", remoteJid: "5541999999999@s.whatsapp.net", fromMe: false }, message: { conversation: "Resposta" } };
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[{ acquired: 1 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ contact_id: "contact-a" }]])
        .mockResolvedValueOnce([[{ conversation_id: "conv-active", messages_json: "[]", customer_name: "Known" }]])
        .mockResolvedValueOnce([[{ message_id: "original-a" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ messages_json: "[]" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{}]),
    };
    webhookMocks.getConnection.mockResolvedValue(connection);
    await expect(saveIncomingMessage("tenant-a", "instance-a", "event-reply", ["5541999999999"], "Known", "Resposta", new Date(), {}, {
      quotedExternalMessageId: "original-external", providerMessageReference: providerReference,
    })).resolves.toBe("persisted");
    const lookup = connection.execute.mock.calls.find(call => String(call[0]).includes("conversation_id = ? AND provider = 'evolution'"));
    expect(lookup?.[1]).toEqual(["tenant-a", "conv-active", "instance-a", "original-external"]);
    const insert = connection.execute.mock.calls.find(call => String(call[0]).includes("INSERT INTO megadesk_domain_conversations_messages"));
    expect(insert?.[1][7]).toBe("original-a");
    expect(insert?.[1][8]).toContain("event-reply");
  });

  it("creates a new unassigned bot attendance when only closed history exists", async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[{ acquired: 1 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ contact_id: "contact-a" }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ messages_json: "[]" }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValue([{}]),
    };
    webhookMocks.getConnection.mockResolvedValue(connection);
    await expect(saveIncomingMessage("tenant-a", "instance-a", "event-new", ["5541999999999"], "Known", "Nova", new Date()))
      .resolves.toBe("persisted");
    const insert = connection.execute.mock.calls.find(call => String(call[0]).includes("INSERT INTO megadesk_domain_conversations\n"));
    expect(insert).toBeTruthy();
    expect(String(insert?.[0])).toContain("'bot'");
    expect(insert?.[1][1]).toBe("tenant-a");
    expect(insert?.[1][2]).toMatch(/^CV-/);
    expect(String(insert?.[1][0])).toMatch(/^conv-/);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("deduplicates before creating contacts or attendances, scoped by tenant and integration", async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn()
        .mockResolvedValueOnce([[{ acquired: 1 }]])
        .mockResolvedValueOnce([[{ message_id: "event-a" }]])
        .mockResolvedValueOnce([{}]),
    };
    webhookMocks.getConnection.mockResolvedValue(connection);
    await expect(saveIncomingMessage("tenant-a", "instance-a", "event-a", ["5541999999999"], "", "Oi", new Date()))
      .resolves.toBe("duplicate");
    expect(connection.execute.mock.calls[1][1]).toEqual(["tenant-a", "instance-a", "event-a"]);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("acquires the canonical phone lock before opening the transaction", async () => {
    const order: string[] = [];
    const connection = {
      beginTransaction: vi.fn(async () => { order.push("transaction"); }), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("GET_LOCK")) { order.push("lock"); return [[{ acquired: 1 }]]; }
        if (sql.includes("external_message_id")) return [[{ message_id: "duplicate" }]];
        return [{}];
      }),
    };
    webhookMocks.getConnection.mockResolvedValue(connection);
    await saveIncomingMessage("tenant-a", "instance-a", "event-a", ["5541999999999"], "", "Oi", new Date());
    expect(order).toEqual(["lock", "transaction"]);
  });
});
