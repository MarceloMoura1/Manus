import { describe, expect, it } from "vitest";

import { evolutionPhoneCandidates, normalizeEvolutionEvent, parseEvolutionIncomingMessage } from "./webhook";

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
