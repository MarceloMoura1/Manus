import { describe, expect, it, vi } from "vitest";
import { loadOutboundConversation, resolveOutboundRecipient, safeOutboundProviderMessage } from "./outbound-recipient";

describe("resolveOutboundRecipient", () => {
  it.each([
    ["5541995484515", "5541995484515"],
    ["(41) 99548-4515", "5541995484515"],
    ["+55 41 99548-4515", "5541995484515"],
    ["554195484515", "5541995484515"],
    ["+1 415 555 2671", "14155552671"],
  ])("normaliza destinatário %s", (conversationPhone, expected) => {
    expect(resolveOutboundRecipient({ conversationPhone })).toBe(expected);
  });

  it("prefere WhatsApp e telefone do CRM ao telefone da conversa", () => {
    expect(resolveOutboundRecipient({ crmWhatsapp: "+55 11 99999-1111", crmPhone: "+55 21 99999-2222", conversationPhone: "+55 31 99999-3333" }))
      .toBe("5511999991111");
  });

  it("aceita remoteJid telefônico", () => {
    expect(resolveOutboundRecipient({ remoteJid: "5541995484515@s.whatsapp.net" })).toBe("5541995484515");
  });

  it("usa telefone alternativo ou mapping quando o principal é LID", () => {
    expect(resolveOutboundRecipient({ remoteJid: "123456789012345@lid", remoteJidAlt: "5541995484515@s.whatsapp.net" })).toBe("5541995484515");
    expect(resolveOutboundRecipient({ remoteJid: "123456789012345@lid", mappedLidPhone: "+55 41 99548-4515" })).toBe("5541995484515");
  });

  it.each(["", "123", "lid123456789", "123456789012345@lid", "123@g.us"])("recusa destinatário inseguro %s", conversationPhone => {
    expect(() => resolveOutboundRecipient({ conversationPhone })).toThrow("destinatário de WhatsApp seguro");
  });
});

describe("loadOutboundConversation", () => {
  it("consulta banco autoritativo com isolamento por tenant", async () => {
    const execute = vi.fn().mockResolvedValue([[{
      conversationId: "conversation-a", clientId: "tenant-a", conversationPhone: "5541995484515",
      crmWhatsapp: null, crmPhone: null,
    }], []]);
    await expect(loadOutboundConversation({ execute }, "tenant-a", "conversation-a")).resolves.toMatchObject({ conversationId: "conversation-a", clientId: "tenant-a" });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("c.client_id = ?"), ["conversation-a", "tenant-a"]);
  });

  it("não encontra conversa de outro tenant", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    await expect(loadOutboundConversation({ execute }, "tenant-b", "conversation-a")).resolves.toBeNull();
  });
});

describe("safeOutboundProviderMessage", () => {
  it.each([
    [400, "rejeitou"], [422, "rejeitou"], [401, "autenticação"], [403, "autenticação"],
    [404, "instância"], [500, "indisponível"],
  ])("traduz HTTP %i sem vazar payload", (status, expected) => {
    expect(safeOutboundProviderMessage(Object.assign(new Error("telefone e token secretos"), { status }))).toContain(expected);
  });
  it("traduz timeout e indisponibilidade de rede", () => {
    expect(safeOutboundProviderMessage(new DOMException("timed out", "TimeoutError"))).toContain("indisponível");
    expect(safeOutboundProviderMessage(new Error("ECONNREFUSED"))).toContain("indisponível");
  });
});
