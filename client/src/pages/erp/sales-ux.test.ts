import { describe, expect, it } from "vitest";
import {
  activeSalesFilterCount,
  canRunSalesLookup,
  salesAddressesMatch,
  salesConfirmationRequirements,
  salesDraftProgress,
  salesPaginationItems,
  salesCsv,
  salesCsvCell,
  salesMetricPeriod,
  saleStockPresentation,
} from "./sales-ux";

const address = {
  recipientName: "Ana",
  postalCode: "01001-000",
  street: "Praça da Sé",
  number: "1",
  complement: "",
  district: "Sé",
  city: "São Paulo",
  state: "SP",
};

describe("sales UX state", () => {
  it("matches the metric label and query bounds to monthly, custom and complete periods", () => {
    const monthly = salesMetricPeriod("2026-10-01", "2026-10-31", "2026-10-01", "2026-10-31");
    expect(monthly).toEqual({ from: "2026-10-01", to: "2026-10-31", label: "Vendas no mês" });
    expect(salesMetricPeriod("2026-09-02", "2026-09-28", monthly.from, monthly.to)).toEqual({
      from: "2026-09-02", to: "2026-09-28", label: "Vendas de 02/09/2026 a 28/09/2026",
    });
    expect(salesMetricPeriod("", "", monthly.from, monthly.to)).toEqual({
      from: "1000-01-01", to: "9999-12-31", label: "Vendas em todo o período",
    });
    expect(salesMetricPeriod("2026-09-02", "", monthly.from, monthly.to)).toEqual({
      from: "2026-09-02", to: "9999-12-31", label: "Vendas desde 02/09/2026",
    });
    expect(salesMetricPeriod("", "2026-09-28", monthly.from, monthly.to)).toEqual({
      from: "1000-01-01", to: "2026-09-28", label: "Vendas até 28/09/2026",
    });
    expect(salesMetricPeriod(monthly.from, monthly.to, monthly.from, monthly.to).label).toBe("Vendas no mês");
  });

  it("encodes CSV with BOM, quoted delimiters and formula-safe user fields", () => {
    expect(salesCsv([["Cliente", "Vendedor"], [" =1+1", "+IMPORTDATA"], ["Árvore, \"Ltda\"\nFilial", "Ana"]]))
      .toBe('\uFEFF"Cliente";"Vendedor"\r\n"\t\' =1+1";"\t\'+IMPORTDATA"\r\n"Árvore, ""Ltda""\nFilial";"Ana"');
  });

  it.each([
    ["ASCII equals", "=1+1"], ["ASCII plus", "+IMPORTDATA"],
    ["ASCII minus", "-1+1"], ["ASCII at", "@SOMA(1,2)"],
    ["fullwidth equals", "＝1+1"], ["fullwidth plus", "＋1+1"],
    ["fullwidth minus", "－1+1"], ["fullwidth at", "＠SOMA(1,2)"],
    ["small equals", "﹦1+1"], ["small plus", "﹢1+1"],
    ["small hyphen", "﹣1+1"], ["mathematical minus", "−1+1"],
    ["superscript plus", "\u2060⁺1+1"],
    ["leading spaces and tab", " \t=1+1"],
    ["leading CRLF", "\r\n-COMANDO"],
    ["leading null", "\u0000@SOMA(1,2)"],
    ["leading BOM", "\uFEFF＋1+1"],
    ["leading zero-width mark", " \u200B＝1+1"],
    ["leading non-breaking space", "\u00A0﹢1+1"],
    ["control without formula", "\r\nCliente normal"],
  ])("prefixes %s as spreadsheet text without rewriting its content", (_case, raw) => {
    expect(salesCsvCell(raw)).toBe(`"\t'${raw.replaceAll('"', '""')}"`);
  });

  it("keeps ordinary names, accents, punctuation, delimiters and line breaks intact", () => {
    expect(salesCsvCell("  Cliente normal")).toBe('"  Cliente normal"');
    expect(salesCsvCell("Ana + Marcelo")).toBe('"Ana + Marcelo"');
    expect(salesCsvCell('Árvore, "Ltda"\r\nFilial')).toBe('"Árvore, ""Ltda""\r\nFilial"');
  });

  it("presents positive stock, zero stock and unknown balance without implying a reservation", () => {
    const base = { stockExitRecorded: false, currentStage: "confirmed" };
    expect(saleStockPresentation({ ...base, currentAvailable: "18.000" })).toEqual({
      availability: "Saldo disponível: 18",
      movement: "Baixa de estoque ainda não realizada",
    });
    expect(saleStockPresentation({ ...base, currentAvailable: "0.000" })).toEqual({
      availability: "Sem saldo disponível",
      movement: "Baixa de estoque ainda não realizada",
    });
    expect(saleStockPresentation({ ...base, currentAvailable: null }).availability).toBe("Saldo atual não verificável");
  });

  it("separates a recorded stock exit from current balance and historic uncertainty", () => {
    expect(saleStockPresentation({ currentAvailable: "8.000", stockExitRecorded: true, currentStage: "shipped" })).toEqual({
      availability: "Saldo disponível: 8",
      movement: "Baixa de estoque registrada",
    });
    expect(saleStockPresentation({ currentAvailable: "0.000", stockExitRecorded: false, currentStage: "completed" }).movement).toBe("Movimento histórico de baixa não encontrado");
  });

  it("does not query the entire customer or product catalog before intent", () => {
    expect(canRunSalesLookup("")).toBe(false);
    expect(canRunSalesLookup("a")).toBe(false);
    expect(canRunSalesLookup(" al ")).toBe(true);
  });

  it("keeps one address by default and detects an explicit billing exception", () => {
    expect(salesAddressesMatch(address, { ...address })).toBe(true);
    expect(salesAddressesMatch(address, { ...address, number: "2" })).toBe(false);
  });

  it("reports draft progress from real form data", () => {
    expect(
      salesDraftProgress({
        crmClientId: "crm-1",
        notes: "",
        expectedDate: "",
        shippingAddress: address,
        billingAddress: address,
        items: [
          {
            productPublicId: "product-1",
            quantity: "1.000",
            unitPriceCents: 100,
          },
        ],
      }).every(item => item.complete)
    ).toBe(true);
  });

  it("keeps confirmation blocked until category and expected account are resolved", () => {
    const requirements = salesConfirmationRequirements({
      hasCustomer: true,
      hasProducts: true,
      hasAddress: true,
      paymentMethod: "PIX",
      categoryPublicId: "",
      financialAccountPublicId: "",
      installmentCount: 1,
      firstDueDate: "2026-10-06",
    });
    expect(requirements.filter(item => !item.complete).map(item => item.key)).toEqual([
      "category",
      "account",
    ]);
  });

  it("counts visible and advanced filters consistently", () => {
    expect(
      activeSalesFilterCount({
        search: "Alfa",
        stage: "confirmed",
        paymentStatus: "all",
        paymentMethod: "PIX",
        sellerUserId: "all",
        customerId: "crm-1",
        from: "2026-10-01",
        to: "2026-10-31",
        defaultFrom: "2026-10-01",
        defaultTo: "2026-10-31",
      })
    ).toBe(4);
  });

  it("builds compact server-side pagination windows", () => {
    expect(salesPaginationItems(1, 3)).toEqual([1, 2, 3]);
    expect(salesPaginationItems(1, 13)).toEqual([1, 2, 3, 4, 5, "ellipsis-right", 13]);
    expect(salesPaginationItems(7, 13)).toEqual([1, "ellipsis-left", 6, 7, 8, "ellipsis-right", 13]);
    expect(salesPaginationItems(13, 13)).toEqual([1, "ellipsis-left", 9, 10, 11, 12, 13]);
  });
});
