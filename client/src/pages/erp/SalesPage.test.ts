import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/erp/SalesPage.tsx", "utf8");

describe("ERP Vendas B+C interface", () => {
  it("uses the approved six-stage timeline as the wide detail focal point", () => {
    for (const stage of [
      '"created"',
      '"confirmed"',
      '"separation"',
      '"shipped"',
      '"received"',
      '"completed"',
    ]) {
      expect(source).toContain(stage);
    }
    expect(source).toContain("Timeline das etapas da venda");
    expect(source).toContain("grid-cols-6");
    expect(source).toContain('min-w-[640px] grid-cols-6 sm:min-w-0');
    expect(source).toContain("overflow-x-auto");
  });

  it("keeps payment independent from the operational stage", () => {
    expect(source).toContain("Pendente");
    expect(source).toContain("Pagamento parcial");
    expect(source).toContain("Pago");
    expect(source).toContain("paymentStatus");
    expect(source).toContain("currentStage");
  });

  it("states the approved no-reservation stock behavior", () => {
    expect(source).toContain("A confirmação não reserva estoque");
    expect(source).toContain("Sem reserva. O saldo permanece disponível até o envio.");
    expect(source).not.toContain("Reserva ativa");
    expect(source).not.toContain("Reserva registrada");
  });

  it("renders real list, expanded product, wide detail and historical states", () => {
    expect(source).toContain("Lista de vendas");
    expect(source).toContain("ExpandedProducts");
    expect(source).toContain("SaleDetailPanel");
    expect(source).toContain("Endereço histórico não registrado");
    expect(source).toContain("Parte do histórico é anterior à timeline auditada");
    expect(source).toContain("productMediaUrl");
  });

  it("exposes Delivery D manual private document controls without fiscal emission", () => {
    expect(source).not.toContain("Emitir nota fiscal");
    expect(source).toContain("Anexar documento");
    expect(source).toContain("Declaração de conteúdo");
    expect(source).toContain("Documentos privados da venda");
    expect(source).toContain("downloadUrl");
  });

  it("includes loading, empty, error, denied and responsive compositions", () => {
    expect(source).toContain("Carregando vendas");
    expect(source).toContain("Nenhuma venda encontrada");
    expect(source).toContain("Não foi possível carregar as vendas");
    expect(source).toContain("Seu perfil não tem acesso");
    expect(source).toContain("xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]");
    expect(source).toContain("sm:max-w-[min(96vw,1440px)]");
  });

  it("keeps customer and catalog searches incremental and variants on demand", () => {
    expect(source).toContain("Nenhum cadastro é carregado antes da busca");
    expect(source).toContain("Digite ao menos {SALES_LOOKUP_MIN_LENGTH} caracteres");
    expect(source).toContain("expandedCatalogProductId");
    expect(source).toContain("variações aparecem somente quando você abrir o resultado");
  });

  it("uses direct BRL inputs, one primary address and a guided financial check", () => {
    expect(source).toContain("<MoneyInput");
    expect(source).not.toContain('step="0.01"');
    expect(source).toContain("Usar outro endereço de cobrança");
    expect(source).toContain("Esta venda pode ser confirmada?");
    expect(source).toContain("Nova categoria a receber");
    expect(source).toContain("Nova conta");
  });
});
