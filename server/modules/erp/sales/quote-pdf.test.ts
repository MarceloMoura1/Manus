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

  describe("automotive vector PDF engine (Option B)", () => {
    const automotiveSource: QuotePdfInput = {
      company: {
        name: "Low Garage Oficina Especializada",
        email: "contato@lowgarage.test",
        phone: "(11) 98765-4321",
        address: "Av. Automotiva, 500 - Galpão 3",
      },
      template: {
        name: "Low Garage Automotivo",
        niche: "automotive",
      },
      quote: {
        number: "ORC-042",
        issuedOn: "2026-10-21",
        customerName: "Oficina Low Garage Cliente",
        customerPhone: "(11) 98765-4321",
        customerAddress: "Av. Automotiva",
        customerAddressNumber: "100",
        commercialStatus: "draft",
        paymentTerms: "30 dias no boleto",
        notes: "Entregar peças limpas",
        serviceMetadata: {
          brandModel: "Nissan 350Z Drift",
          plate: "DFT-3500",
          year: "2008",
          color: "Cinza",
          km: "85000",
          entryDate: "2026-10-20",
          exitDate: "2026-10-25",
        },
        items: [
          {
            description: "Troca Pastilhas Cerâmica Brembo",
            sku: "BRM-01",
            quantity: "1",
            unit: "serv",
            unitPriceCents: 50000,
            discountCents: 0,
            lineTotalCents: 50000,
          },
          {
            description: "Óleo Sintético 5W40 Motul",
            sku: "MOT-5W40",
            quantity: "5",
            unit: "l",
            unitPriceCents: 4000,
            discountCents: 0,
            lineTotalCents: 20000,
          },
        ],
        subtotalCents: 50000,
        chargesCents: 15000,
        freightCents: 5000,
        discountCents: 0,
        totalCents: 70000,
      },
    };

    it("renders vector PDF with automotive header, 2-column client/vehicle grid, and red total bar without raster image", () => {
      const pdf = renderQuotePdf(automotiveSource);
      expect(pdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
      const latin1 = pdf.toString("latin1");

      // Validar cabeçalho automotivo e monograma LG
      expect(latin1).toContain("Low Garage Oficina Especializada");
      expect(latin1).toContain("LG");
      expect(latin1).toContain("ORC-042");
      expect(latin1).toContain("OR\xC7AMENTO / ORDEM DE SERVI\xC7O");

      // Validar Grid 2 Colunas: Cliente e Veículo
      expect(latin1).toContain("DADOS DO CLIENTE");
      expect(latin1).toContain("Oficina Low Garage Cliente");
      expect(latin1).toContain("DADOS DO VE\xCDCULO / OBJETO");
      expect(latin1).toContain("Nissan 350Z Drift");
      expect(latin1).toContain("DFT-3500");
      expect(latin1).toContain("85000 km");

      // Validar itens e classificação de tipo
      expect(latin1).toContain("Troca Pastilhas Cer\xE2mica Brembo");
      expect(latin1).toContain("Servi\xE7o");
      expect(latin1).toContain("Pe\xE7a");

      // Validar totais e tarja vermelha
      expect(latin1).toContain("TOTAL GERAL");
      expect(latin1).toContain("R$ 700,00");
      expect(latin1).toContain("Assinatura do Cliente");
      expect(latin1).toContain("Documento emitido via MegaDesk");

      // Não deve conter XObject raster de fundo
      expect(latin1).not.toContain("/BgImg");
    });

    it("paginates multi-item automotive quotes gracefully with compact header on subsequent pages", () => {
      const manyItems = Array.from({ length: 25 }, (_, i) => ({
        description: `Serviço Automotivo Extenso Número ${i + 1}`,
        sku: `SRV-${i + 1}`,
        quantity: "1",
        unit: "serv",
        unitPriceCents: 2000,
        discountCents: 0,
        lineTotalCents: 2000,
      }));

      const multiPageSource = {
        ...automotiveSource,
        quote: {
          ...automotiveSource.quote,
          items: manyItems,
          totalCents: 50000,
        },
      };

      const pdf = renderQuotePdf(multiPageSource);
      const latin1 = pdf.toString("latin1");
      expect(latin1).toContain("/Count ");
      expect(latin1).toContain("P\xE1gina 2 de ");
      expect(latin1).toContain("TOTAL GERAL");
    });
  });
});
