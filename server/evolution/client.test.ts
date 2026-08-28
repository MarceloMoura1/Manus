import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvolutionApiError, evoCreateInstance, evoGetMediaBase64, evoSendAttachment, normalizeEvolutionRecipient, sanitizeEvolutionErrorDetail } from "./client";

beforeEach(() => {
  vi.stubEnv("EVOLUTION_API_URL", "http://evolution.test");
  vi.stubEnv("EVOLUTION_API_KEY", "test-api-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("normalizeEvolutionRecipient", () => {
  it("normaliza celular brasileiro local com DDD", () => {
    expect(normalizeEvolutionRecipient("(41) 99548-4515")).toBe("5541995484515");
  });

  it("preserva número internacional já normalizado", () => {
    expect(normalizeEvolutionRecipient("+55 41 99548-4515")).toBe("5541995484515");
  });

  it("restaura o nono dígito de celular brasileiro retornado pelo WhatsApp", () => {
    expect(normalizeEvolutionRecipient("554195484515")).toBe("5541995484515");
  });

  it("rejeita destinatário incompleto", () => {
    expect(() => normalizeEvolutionRecipient("12345")).toThrow("Número de WhatsApp inválido.");
  });
});

describe("Evolution API errors", () => {
  it("preserva status e mensagem para reconhecer uma instância existente", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 403,
      response: { message: ["The instance already exists"] },
    }), { status: 403 })));

    const error = await evoCreateInstance("tenant-1").catch(value => value);
    expect(error).toBeInstanceOf(EvolutionApiError);
    expect(error).toMatchObject({ status: 403, path: "/instance/create" });
    expect(error.message).toContain("already exists");
    expect(error).not.toHaveProperty("responseBody");
  });

  it("redacts credentials, sensitive queries and complete numbers with a hard size limit", () => {
    const safe = sanitizeEvolutionErrorDetail(`Authorization: Bearer-secret token=abc123 cookie=session-x https://user:pass@example.test/path?apiKey=raw 5541995484515 ${"x".repeat(500)}`);
    expect(safe).not.toContain("Bearer-secret");
    expect(safe).not.toContain("abc123");
    expect(safe).not.toContain("session-x");
    expect(safe).not.toContain("user:pass");
    expect(safe).not.toContain("5541995484515");
    expect(safe.length).toBeLessThanOrEqual(240);
  });
});

describe("evoSendAttachment", () => {
  it.each([
    ["image", "/message/sendMedia/tenant-1", "media"],
    ["video", "/message/sendMedia/tenant-1", "media"],
    ["document", "/message/sendMedia/tenant-1", "media"],
    ["audio", "/message/sendWhatsAppAudio/tenant-1", "audio"],
    ["sticker", "/message/sendSticker/tenant-1", "sticker"],
  ] as const)("envia %s pelo endpoint correto", async (kind, path, contentField) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: { id: "msg-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await evoSendAttachment({
      instanceName: "tenant-1", number: "(41) 99548-4515", kind,
      dataUrl: "data:image/png;base64,AQ==", mimeType: "image/png",
      fileName: "arquivo.png", caption: "Legenda",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://evolution.test${path}`);
    expect(JSON.parse(String(init.body))).toMatchObject({
      number: "5541995484515", [contentField]: "AQ==",
    });
    if (kind === "audio") expect(JSON.parse(String(init.body))).toMatchObject({ encoding: true });
  });

  it("remove parâmetros de codec da Data URI de áudio", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: { id: "audio-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await evoSendAttachment({
      instanceName: "tenant-1", number: "5541995484515", kind: "audio",
      dataUrl: "data:audio/webm;codecs=opus;base64,AQ==", mimeType: "audio/webm;codecs=opus",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ audio: "AQ==", encoding: true });
  });
});

describe("evoGetMediaBase64", () => {
  it("solicita o download usando a mensagem completa do webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      base64: "AQ==", mimetype: "image/jpeg", fileName: "foto.jpg",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const message = { key: { id: "incoming-1" }, message: { imageMessage: { directPath: "/media" } } };
    await expect(evoGetMediaBase64("tenant-1", message)).resolves.toEqual({
      base64: "AQ==", mimetype: "image/jpeg", fileName: "foto.jpg",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://evolution.test/chat/getBase64FromMediaMessage/tenant-1");
    expect(JSON.parse(String(init.body))).toEqual({ message, convertToMp4: false });
  });
});
