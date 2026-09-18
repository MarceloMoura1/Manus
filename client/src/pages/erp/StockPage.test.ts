import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canReverseStockMovement,
  movementReferenceLabel,
  movementStatus,
  movementTypeLabel,
  normalizeStockQuantityInput,
  prioritizeStockAttention,
  projectStockBalancePreview,
  signedMovementQuantity,
  stockAttentionLevel,
  stockShortageToMinimum,
  stockSummaryValues,
  stockUnitLabel,
  stockUnitShortLabel,
} from "./StockPage";

const stockSource = fs.readFileSync(path.resolve(process.cwd(), "client/src/pages/erp/StockPage.tsx"), "utf8");
const workspaceSource = fs.readFileSync(path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"), "utf8");
const repositorySource = fs.readFileSync(path.resolve(process.cwd(), "server/modules/erp/repository.ts"), "utf8");
const serviceSource = fs.readFileSync(path.resolve(process.cwd(), "server/modules/erp/service.ts"), "utf8");

describe("ERP Estoque — painel operacional", () => {
  it("1. calcula os quatro indicadores com a semântica apresentada", () => {
    expect(stockSummaryValues({ availableProducts: 8, lowProducts: 2, emptyProducts: 4, costValueCents: 247500 })).toEqual({
      available: 8,
      low: 2,
      empty: 4,
      value: expect.stringMatching(/2\.475,00/),
    });
    expect(stockSource).toContain("Baseado no custo atual cadastrado");
  });

  it("2. oferece empty state explicativo quando nenhum produto exige atenção", () => {
    expect(stockSource).toContain("Tudo certo com o estoque");
    expect(stockSource).toContain("Nenhum produto está abaixo do nível mínimo neste momento.");
  });

  it("3. classifica saldo zero separadamente como sem estoque", () => {
    expect(stockAttentionLevel("0.000", "5.000")).toBe("empty");
  });

  it("4. classifica estoque baixo somente quando o saldo é positivo e não supera o mínimo", () => {
    expect(stockAttentionLevel("0.001", "5.000")).toBe("low");
    expect(stockAttentionLevel("5.000", "5.000")).toBe("low");
    expect(stockAttentionLevel("5.001", "5.000")).toBe("normal");
  });

  it("4b. prioriza zerados, mantém baixos e elimina produtos saudáveis da atenção", () => {
    const empty = { publicId: "empty", name: "Sem saldo", sku: "E-1", unit: "unit", quantity: "0.000", minimumStock: "5.000" };
    const low = { publicId: "low", name: "Baixo", sku: "L-1", unit: "unit", quantity: "3.000", minimumStock: "5.000" };
    const healthy = { publicId: "healthy", name: "Saudável", sku: "H-1", unit: "unit", quantity: "20.000", minimumStock: "5.000" };
    expect(prioritizeStockAttention([healthy, empty], [healthy, low]).map(product => product.publicId)).toEqual(["empty", "low"]);
    expect(stockShortageToMinimum(low.quantity, low.minimumStock)).toBe("2.000");
  });

  it("5. apresenta todas as unidades controladas com rótulos legíveis", () => {
    expect([["unit", "Unidade", "un"], ["kg", "Quilograma", "kg"], ["liter", "Litro", "L"], ["meter", "Metro", "m"]].map(([unit]) => [stockUnitLabel(unit), stockUnitShortLabel(unit)])).toEqual([
      ["Unidade", "un"], ["Quilograma", "kg"], ["Litro", "L"], ["Metro", "m"],
    ]);
  });

  it.each([
    ["sale_out", "Baixa de venda"],
    ["purchase_in", "Recebimento de compra"],
    ["adjustment_in", "Ajuste de entrada"],
    ["adjustment_out", "Ajuste de saída"],
    ["manual_in", "Entrada manual"],
    ["manual_out", "Saída manual"],
    ["reversal", "Movimentação de reversão"],
    ["initial", "Saldo inicial"],
  ])("6-10. humaniza o tipo técnico %s", (technical, human) => {
    expect(movementTypeLabel(technical)).toBe(human);
    expect(movementTypeLabel(technical)).not.toBe(technical);
  });

  it("11. sinaliza entradas explicitamente com +", () => {
    expect(signedMovementQuantity({ direction: "in", quantity: "25.000", unit: "unit" })).toBe("+25 un");
  });

  it("12. sinaliza saídas explicitamente com o sinal de menos", () => {
    expect(signedMovementQuantity({ direction: "out", quantity: "12.500", unit: "kg" })).toBe("−12,5 kg");
  });

  it("13. mantém saldo anterior e posterior juntos na tabela e nos detalhes", () => {
    expect(stockSource).toContain("formatStockQuantity(item.previousBalance)");
    expect(stockSource).toContain("formatStockQuantity(item.resultingBalance)");
    expect(stockSource).toContain("formatStockQuantity(detail.previousBalance)");
    expect(stockSource).toContain("formatStockQuantity(detail.resultingBalance)");
  });

  it("14. envia busca, produto e tipo para a consulta e reinicia a página ao filtrar", () => {
    expect(stockSource).toContain("productPublicId: productFilter || undefined");
    expect(stockSource).toContain('type: typeFilter === "all" ? undefined : typeFilter');
    expect(stockSource).toContain("setPage(1)");
  });

  it("15. preserva período inclusivo do início ao fim do dia", () => {
    expect(stockSource).toContain('T00:00:00.000Z');
    expect(stockSource).toContain('T23:59:59.999Z');
  });

  it("16. preserva paginação e opções de quantidade por página", () => {
    expect(stockSource).toContain("<Pagination page={page}");
    expect(stockSource).toContain('<option value="10">10 por página</option>');
    expect(stockSource).toContain('<option value="50">50 por página</option>');
  });

  it("17. detalhes explicam produto, tipo, saldo, motivo, origem e responsável", () => {
    for (const label of ["Detalhes da movimentação", "Produto", "Movimentação", "Saldo", "Motivo", "Origem", "Responsável"]) {
      expect(stockSource).toContain(label);
    }
    expect(movementReferenceLabel("purchase")).toBe("Compra");
    expect(movementReferenceLabel(null)).toBe("Sem referência externa");
  });

  it("18. só oferece reversão isolada aos tipos permitidos pelo backend", () => {
    expect(canReverseStockMovement({ type: "manual_in", reversed: false })).toBe(true);
    expect(canReverseStockMovement({ type: "adjustment_out", reversed: false })).toBe(true);
    expect(canReverseStockMovement({ type: "purchase_in", reversed: false })).toBe(false);
    expect(canReverseStockMovement({ type: "sale_out", reversed: false })).toBe(false);
    expect(canReverseStockMovement({ type: "reversal", reversed: false })).toBe(false);
    expect(canReverseStockMovement({ type: "manual_out", reversed: true })).toBe(false);
    expect(stockSource).toContain("movimentação compensatória e não apaga o histórico original");
  });

  it("19. diferencia confirmada, revertida e movimentação compensatória", () => {
    expect(movementStatus({ type: "manual_in", reversed: false }).label).toBe("Confirmada");
    expect(movementStatus({ type: "manual_in", reversed: true }).label).toBe("Revertida");
    expect(movementStatus({ type: "reversal", reversed: false }).label).toBe("Reversão confirmada");
  });

  it("20. nova movimentação mantém apenas operações manuais e idempotência", () => {
    for (const type of ["manual_in", "manual_out", "adjustment_in", "adjustment_out"]) {
      expect(stockSource).toContain(`value="${type}"`);
    }
    expect(stockSource).toContain("crypto.randomUUID()");
    expect(stockSource).toContain("trpc.erp.stock.move.useMutation");
    expect(normalizeStockQuantityInput(" 1,250 ")).toBe("1.250");
  });

  it("21. prévia calcula entradas, saídas e insuficiência sem ponto flutuante", () => {
    expect(projectStockBalancePreview("25.000", "10", "manual_in")).toEqual({ current: "25.000", change: "+10.000", resulting: "35.000", insufficient: false });
    expect(projectStockBalancePreview("25.000", "5", "manual_out")).toEqual({ current: "25.000", change: "−5.000", resulting: "20.000", insufficient: false });
    expect(projectStockBalancePreview("0.002", "0.001", "adjustment_out")?.resulting).toBe("0.001");
    expect(projectStockBalancePreview("1", "2", "manual_out")).toMatchObject({ resulting: null, insufficient: true });
  });

  it("22-23. possui tratamentos explícitos para light e dark mode", () => {
    expect(stockSource).toContain("bg-white");
    expect(stockSource).toContain("dark:bg-slate-950");
    expect(stockSource).toContain("dark:text-slate-100");
    expect(stockSource).toContain("focus-visible:ring-2");
  });

  it("24. integra a nova página sem alterar a implementação aprovada de Produtos", () => {
    expect(workspaceSource).toContain('import { StockPage } from "./StockPage"');
    expect(workspaceSource).toContain("<StockPage/>");
    expect(workspaceSource).toContain("function Products()");
  });

  it("25. mantém a rota Estoque e os demais destinos principais do ERP", () => {
    for (const route of ["products", "stock", "suppliers", "purchases", "sales", "finance", "fiscal", "reports"]) {
      expect(workspaceSource).toContain(`id:\"${route}\" as const`);
    }
  });

  it("mantém a unidade no contrato público e em todas as consultas de movimentação", () => {
    expect(serviceSource).toContain("unit: row.unit");
    expect((repositorySource.match(/p\.unit/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((serviceSource.match(/p\.unit/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("preserva isolamento por tenant e bloqueios de reversão do domínio", () => {
    expect(repositorySource).toContain('const conditions = ["m.client_id=?"]');
    expect(serviceSource).toContain('original.type === "purchase_in"');
    expect(serviceSource).toContain('original.type === "sale_out"');
    expect(serviceSource).toContain("ALREADY_REVERSED");
  });

  it("oferece responsividade sem ocultar dados críticos", () => {
    expect(stockSource).toContain("sm:flex-row");
    expect(stockSource).toContain("xl:grid-cols-[130px_minmax(190px,1.15fr)");
    expect(stockSource).toContain('data-testid="stock-movement-ledger"');
    expect(stockSource).not.toMatch(/\{item\.type\}/);
  });

  it("V2 substitui a composição rejeitada por painel, listas priorizadas, toolbar e ledger", () => {
    expect(stockSource).toContain('data-testid="stock-overview-panel"');
    expect(stockSource).toContain('data-testid="stock-attention-columns"');
    expect(stockSource).toContain('data-testid="stock-attention-empty-list"');
    expect(stockSource).toContain('data-testid="stock-attention-low-list"');
    expect(stockSource).toContain('data-testid="stock-filter-toolbar"');
    expect(stockSource).toContain('data-testid="stock-filter-drawer"');
    expect(stockSource).not.toContain("<table");
    expect(stockSource).not.toContain("stock-metric-available");
  });

  it("V2 usa filtros progressivos com chips removíveis em vez de uma parede permanente", () => {
    expect(stockSource).toContain("showPeriodFilters");
    expect(stockSource).toContain("showMoreFilters");
    expect(stockSource).toContain("Filtros ativos:");
    expect(stockSource).toContain("Limpar tudo");
  });

  it("V2 apresenta formulário em três etapas e ação final explícita", () => {
    expect(stockSource).toContain("1. Movimentação");
    expect(stockSource).toContain("2. Efeito no saldo");
    expect(stockSource).toContain("3. Motivo");
    expect(stockSource).toContain("Saldo após movimentação");
    expect(stockSource).toContain("Registrar movimentação");
  });
});
