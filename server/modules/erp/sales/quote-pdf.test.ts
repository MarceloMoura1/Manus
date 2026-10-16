import { describe, expect, it } from "vitest";
import { renderQuotePdf, type QuotePdfInput } from "./quote-pdf";

const source: QuotePdfInput = {
  company: { name: "MegaDesk Comércio", email: "vendas@example.test", phone: "(11) 99999-0000", address: "Rua Exemplo, 100" },
  quote: {
    number: "O-1024",
    issuedOn: "2026-10-16",
    customerName: "Cliente de Teste",
    commercialStatus: "negotiation",
    paymentTerms: "50% na aprovação e 50% na entrega.",
    notes: "Valores sujeitos à disponibilidade dos itens.",
    items: [{ description: "Produto profissional", sku: "SKU-001", quantity: "2", unit: "un", unitPriceCents: 12500, discountCents: 500, lineTotalCents: 24500 }],
    subtotalCents: 25000,
    discountCents: 500,
    freightCents: 1000,
    chargesCents: 0,
    totalCents: 25500,
  },
};

describe("quote PDF renderer", () => {
  it("renders a self-contained professional quote from the supplied snapshot", () => {
    const pdf = renderQuotePdf(source);
    expect(pdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
    expect(pdf.toString("latin1")).toContain("O-1024");
    expect(pdf.toString("latin1")).toContain("Cliente de Teste");
    expect(pdf.toString("latin1")).toContain("MegaDesk Comércio");
    expect(pdf.toString("latin1")).toContain("R$ 255,00");
    expect(pdf.toString("latin1")).toContain("%%EOF");
  });

  it("escapes customer-controlled PDF syntax instead of injecting operators", () => {
    const pdf = renderQuotePdf({ ...source, quote: { ...source.quote, customerName: "Cliente ) Tj /F1 99 Tf (" } });
    const body = pdf.toString("latin1");
    expect(body).toContain("Cliente \\) Tj /F1 99 Tf \\(");
    expect(body).not.toContain("(Cliente ) Tj /F1 99 Tf () Tj");
  });

  it("creates additional pages for long quotes without changing totals", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ ...source.quote.items[0], description: `Produto ${index + 1}`, sku: `SKU-${index + 1}` }));
    const pdf = renderQuotePdf({ ...source, quote: { ...source.quote, items } }).toString("latin1");
    expect(pdf).toContain("/Count 2");
    expect(pdf).toContain("Página 2 de 2");
    expect(pdf).toContain("R$ 255,00");
  });

  it("rejects incomplete or unsafe financial snapshots", () => {
    expect(() => renderQuotePdf({ ...source, quote: { ...source.quote, items: [] } })).toThrow("QUOTE_PDF_INVALID_ITEMS");
    expect(() => renderQuotePdf({ ...source, quote: { ...source.quote, totalCents: Number.NaN } })).toThrow("QUOTE_PDF_INVALID_MONEY");
  });
});
