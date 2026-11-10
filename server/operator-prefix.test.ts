import { describe, expect, it } from "vitest";
import { formatOperatorWhatsAppMessage } from "./routers";

describe("formatOperatorWhatsAppMessage", () => {
  it("prefixes operator name in bold with double line breaks for WhatsApp", () => {
    const formatted = formatOperatorWhatsAppMessage("Marcelo Moura", "Boa tarde! Tudo bem?");
    expect(formatted).toBe("*Marcelo Moura*\n\nBoa tarde! Tudo bem?");
  });

  it("does not duplicate prefix if message is already prefixed with bold operator name", () => {
    const alreadyPrefixed = "*Marcelo Moura*\n\nBoa tarde!";
    expect(formatOperatorWhatsAppMessage("Marcelo Moura", alreadyPrefixed)).toBe("*Marcelo Moura*\n\nBoa tarde!");

    const singleLineBreak = "*Marcelo Moura*\nBoa tarde!";
    expect(formatOperatorWhatsAppMessage("Marcelo Moura", singleLineBreak)).toBe("*Marcelo Moura*\nBoa tarde!");
  });

  it("returns original text if operator name is empty or null", () => {
    expect(formatOperatorWhatsAppMessage(null, "Mensagem do bot")).toBe("Mensagem do bot");
    expect(formatOperatorWhatsAppMessage("", "Mensagem do bot")).toBe("Mensagem do bot");
    expect(formatOperatorWhatsAppMessage(undefined, "Mensagem do bot")).toBe("Mensagem do bot");
  });
});

