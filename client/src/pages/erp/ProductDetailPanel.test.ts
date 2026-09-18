import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ProductDetailView,
  type ProductDetail,
  type ProductSupplierItem,
  type ProductAuditItem,
} from "./ProductDetailPanel";

const baseProduct: ProductDetail = {
  publicId: "prod-pub-uuid-1111",
  name: "Mouse Ergonômico Wireless",
  sku: "MOU-ERG-001",
  barcode: "0012345678905",
  description: "Mouse sem fio anatômico com sensor óptico de alta precisão.",
  category: "Periféricos",
  categoryRelational: {
    publicId: "cat-pub-uuid-2222",
    name: "Acessórios de Informática",
    slug: "acessorios-informatica",
  },
  brand: {
    publicId: "brand-pub-uuid-3333",
    name: "TechGear",
    slug: "techgear",
  },
  unit: "unit",
  costPriceCents: 4500, // R$ 45,00
  salePriceCents: 9990, // R$ 99,90
  minimumStock: "5",
  quantity: "24",
  active: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-10T15:30:00.000Z",
  variants: [
    {
      publicId: "var-pub-uuid-101",
      productPublicId: "prod-pub-uuid-1111",
      productName: "Mouse Ergonômico Wireless",
      sku: "MOU-ERG-BLK",
      barcode: "0012345678912",
      name: "Preto Fosco",
      costPriceCents: 4500,
      salePriceCents: 9990,
      effectivePriceCents: 9990,
      active: true,
      attributes: [
        {
          typePublicId: "attr-pub-1",
          typeName: "Cor",
          typeSlug: "cor",
          valuePublicId: "val-pub-1",
          valueName: "Preto",
          valueSlug: "preto",
        },
      ],
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    {
      publicId: "var-pub-uuid-102",
      productPublicId: "prod-pub-uuid-1111",
      productName: "Mouse Ergonômico Wireless",
      sku: "MOU-ERG-WHT",
      barcode: null,
      name: "Branco Neve",
      costPriceCents: 0,
      salePriceCents: 10990,
      effectivePriceCents: 10990,
      active: false,
      attributes: [
        {
          typePublicId: "attr-pub-1",
          typeName: "Cor",
          typeSlug: "cor",
          valuePublicId: "val-pub-2",
          valueName: "Branco",
          valueSlug: "branco",
        },
      ],
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  ],
  preferredSupplier: {
    publicId: "supp-pub-uuid-4444",
    supplierId: 999, // Internal numeric ID that MUST NOT leak into the DOM
    supplierPublicId: "supplier-partner-uuid-5555",
    supplierLegalName: "Tech Imports Distribuidora Ltda",
    supplierTradeName: "Tech Imports",
    supplierProductCode: "TI-MOU-01",
    costPriceCents: 4200,
    isPreferred: true,
    active: true,
  },
};

const mockSuppliers: ProductSupplierItem[] = [
  {
    publicId: "assoc-pub-uuid-1",
    supplierPublicId: "supplier-partner-uuid-5555",
    supplierLegalName: "Tech Imports Distribuidora Ltda",
    supplierTradeName: "Tech Imports",
    supplierProductCode: "TI-MOU-01",
    costPriceCents: 4200,
    isPreferred: true,
    active: true,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  },
  {
    publicId: "assoc-pub-uuid-2",
    supplierPublicId: "supplier-partner-uuid-6666",
    supplierLegalName: "Global Hardware Corp",
    supplierTradeName: null,
    supplierProductCode: "GH-8871",
    costPriceCents: 4600,
    isPreferred: false,
    active: false,
    createdAt: "2026-09-02T14:00:00.000Z",
    updatedAt: "2026-09-02T14:00:00.000Z",
  },
];

const mockAuditHistory: ProductAuditItem[] = [
  {
    publicId: "audit-pub-uuid-1",
    productPublicId: "prod-pub-uuid-1111",
    entityType: "product",
    entityPublicId: "prod-pub-uuid-1111",
    action: "product_created",
    summary: "Criação do produto",
    actor: {
      userId: "user-internal-id-42", // Must not leak
      name: "Carlos Operador",
      role: "admin",
    },
    changes: {
      name: { before: null, after: "Mouse Ergonômico Wireless" },
      salePriceCents: { before: null, after: 9990 },
      barcode: { before: null, after: "0012345678905" },
    },
    metadata: null,
    createdAt: "2026-09-01T10:00:00.000Z",
  },
  {
    publicId: "audit-pub-uuid-2",
    productPublicId: "prod-pub-uuid-1111",
    entityType: "product",
    entityPublicId: "prod-pub-uuid-1111",
    action: "product_updated",
    summary: "Atualização de preço de venda",
    actor: {
      userId: "user-internal-id-99",
      name: "Mariana Gerente",
      role: "manager",
    },
    changes: {
      salePriceCents: { before: 8990, after: 9990 },
    },
    metadata: null,
    createdAt: "2026-09-10T15:30:00.000Z",
  },
];

describe("ProductDetailPanel — P1-A9 Premium UI Integration", () => {
  // -------------------------------------------------------------------------
  // 1. Abertura da ficha a partir de produto
  // -------------------------------------------------------------------------
  it("1. renderiza dados gerais ao abrir a ficha a partir de um produto", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("Mouse Ergonômico Wireless");
    expect(markup).toContain("MOU-ERG-001");
    expect(markup).toContain("Geral");
    expect(markup).toContain("Preço de Venda");
  });

  // -------------------------------------------------------------------------
  // 2. Loading
  // -------------------------------------------------------------------------
  it("2. renderiza estado de loading neutro e amigável", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        isLoading: true,
      })
    );

    expect(markup).toContain("Carregando produto...");
    expect(markup).toContain("Carregando dados da ficha do produto...");
    expect(markup).not.toContain("Mouse Ergonômico");
  });

  // -------------------------------------------------------------------------
  // 3. Erro
  // -------------------------------------------------------------------------
  it("3. renderiza estado de erro sanitizado com opção de retry", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        error: { message: "Falha de conexão com o servidor" },
        onRetry: () => {},
      })
    );

    expect(markup).toContain("Erro ao carregar produto");
    expect(markup).toContain("Falha de conexão com o servidor");
    expect(markup).toContain("Tentar novamente");
  });

  // -------------------------------------------------------------------------
  // 4. Produto sem categoria relacional (legado/ausente)
  // -------------------------------------------------------------------------
  it("4. renderiza produto sem categoria relacional de forma neutra preservando categoria legada", () => {
    const legacyProduct: ProductDetail = {
      ...baseProduct,
      categoryRelational: null,
      category: "Periféricos Antigos",
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: legacyProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("Periféricos Antigos");
    expect(markup).toContain("(legada)");
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain("[object Object]");
  });

  it("4b. renderiza produto sem nenhuma categoria (nem legada, nem relacional)", () => {
    const uncategorizedProduct: ProductDetail = {
      ...baseProduct,
      categoryRelational: null,
      category: null,
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: uncategorizedProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("Nenhuma categoria vinculada");
    expect(markup).not.toContain("undefined");
  });

  // -------------------------------------------------------------------------
  // 5. Produto com categoria relacional
  // -------------------------------------------------------------------------
  it("5. renderiza produto com categoria relacional e slug", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("Acessórios de Informática");
    expect(markup).toContain("acessorios-informatica");
  });

  // -------------------------------------------------------------------------
  // 6. Produto sem marca
  // -------------------------------------------------------------------------
  it("6. renderiza produto sem marca de forma neutra e determinística", () => {
    const noBrandProduct: ProductDetail = {
      ...baseProduct,
      brand: null,
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: noBrandProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("Nenhuma marca vinculada");
    expect(markup).not.toContain("undefined");
  });

  // -------------------------------------------------------------------------
  // 7. Produto com marca
  // -------------------------------------------------------------------------
  it("7. renderiza produto com marca e slug", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("TechGear");
    expect(markup).toContain("techgear");
  });

  // -------------------------------------------------------------------------
  // 8. Zero variantes
  // -------------------------------------------------------------------------
  it("8. renderiza empty state apropriado quando não existem variantes", () => {
    const productNoVariants: ProductDetail = {
      ...baseProduct,
      variants: [],
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: productNoVariants,
        currentTab: "variants",
      })
    );

    expect(markup).toContain("Nenhuma variante cadastrada para este produto");
    expect(markup).toContain("Produtos simples não possuem variantes");
  });

  // -------------------------------------------------------------------------
  // 9. Múltiplas variantes
  // -------------------------------------------------------------------------
  it("9. renderiza tabela com múltiplas variantes exibindo SKUs, nomes e atributos", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "variants",
      })
    );

    expect(markup).toContain("MOU-ERG-BLK");
    expect(markup).toContain("Preto Fosco");
    expect(markup).toContain("Cor: Preto");
    expect(markup).toContain("MOU-ERG-WHT");
    expect(markup).toContain("Branco Neve");
    expect(markup).toContain("Cor: Branco");
  });

  // -------------------------------------------------------------------------
  // 10. Barcode com zero à esquerda preservado
  // -------------------------------------------------------------------------
  it("10. preserva rigorosamente zeros à esquerda no código de barras", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("0012345678905");

    const variantsMarkup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "variants",
      })
    );

    expect(variantsMarkup).toContain("0012345678912");
  });

  // -------------------------------------------------------------------------
  // 11. Variante sem barcode
  // -------------------------------------------------------------------------
  it("11. renderiza variante sem barcode de forma neutra com traço", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "variants",
      })
    );

    expect(markup).toContain("—");
    expect(markup).not.toContain("null");
    expect(markup).not.toContain("undefined");
  });

  // -------------------------------------------------------------------------
  // 12. Variante sem custo
  // -------------------------------------------------------------------------
  it("12. renderiza variante sem custo monetário formatado corretamente em R$ 0,00", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "variants",
      })
    );

    expect(markup).toContain("0,00");
    expect(markup).toMatch(/R\$\s*0,00/);
  });

  // -------------------------------------------------------------------------
  // 13. Fornecedor preferencial
  // -------------------------------------------------------------------------
  it("13. destaca visualmente o fornecedor preferencial tanto na visão geral quanto na aba de fornecedores", () => {
    const generalMarkup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
      })
    );

    expect(generalMarkup).toContain("Fornecedor Preferencial");
    expect(generalMarkup).toContain("Tech Imports Distribuidora Ltda");

    const suppliersMarkup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "suppliers",
        suppliersState: {
          items: mockSuppliers,
          isLoading: false,
        },
      })
    );

    expect(suppliersMarkup).toContain("Preferencial");
    expect(suppliersMarkup).toContain("Tech Imports Distribuidora Ltda");
  });

  // -------------------------------------------------------------------------
  // 14. Ausência de fornecedor preferencial
  // -------------------------------------------------------------------------
  it("14. renderiza neutro quando não há fornecedor preferencial", () => {
    const noPreferredProduct: ProductDetail = {
      ...baseProduct,
      preferredSupplier: null,
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: noPreferredProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("Nenhum fornecedor preferencial definido");
  });

  // -------------------------------------------------------------------------
  // 15. Histórico vazio
  // -------------------------------------------------------------------------
  it("15. renderiza empty state apropriado quando não há registros no histórico", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "history",
        historyState: {
          items: [],
          isLoading: false,
        },
      })
    );

    expect(markup).toContain("Nenhum registro de auditoria encontrado");
  });

  // -------------------------------------------------------------------------
  // 16. Histórico com eventos
  // -------------------------------------------------------------------------
  it("16. renderiza histórico cronológico de eventos com ações e descrições", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "history",
        historyState: {
          items: mockAuditHistory,
          isLoading: false,
        },
      })
    );

    expect(markup).toContain("Criação do produto");
    expect(markup).toContain("Atualização de preço de venda");
  });

  // -------------------------------------------------------------------------
  // 17. Renderização de actor snapshot
  // -------------------------------------------------------------------------
  it("17. renderiza autor do evento com nome e perfil/cargo", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "history",
        historyState: {
          items: mockAuditHistory,
          isLoading: false,
        },
      })
    );

    expect(markup).toContain("Carlos Operador");
    expect(markup).toContain("(admin)");
    expect(markup).toContain("Mariana Gerente");
    expect(markup).toContain("(manager)");
  });

  // -------------------------------------------------------------------------
  // 18. Diff de auditoria
  // -------------------------------------------------------------------------
  it("18. renderiza diff de auditoria estruturado detalhando campos alterados", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "history",
        historyState: {
          items: mockAuditHistory,
          isLoading: false,
        },
      })
    );

    expect(markup).toContain("Preço de venda");
    expect(markup).toContain("89,90");
    expect(markup).toContain("99,90");
  });

  // -------------------------------------------------------------------------
  // 19. Produto inativo
  // -------------------------------------------------------------------------
  it("19. renderiza badge de status inativo quando active for falso", () => {
    const inactiveProduct: ProductDetail = {
      ...baseProduct,
      active: false,
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: inactiveProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("Inativo");
  });

  // -------------------------------------------------------------------------
  // 20. Ausência de vazamento de IDs internos
  // -------------------------------------------------------------------------
  it("20. garante ausência absoluta de vazamento de IDs numéricos internos no DOM", () => {
    const markupGeneral = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
      })
    );
    const markupSuppliers = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "suppliers",
        suppliersState: {
          items: mockSuppliers,
          isLoading: false,
        },
      })
    );
    const markupHistory = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "history",
        historyState: {
          items: mockAuditHistory,
          isLoading: false,
        },
      })
    );

    // Supplier internal numeric ID 999 must not be present in markup
    expect(markupGeneral).not.toContain("999");
    expect(markupSuppliers).not.toContain("999");

    // Actor internal numeric ID must not be present in markup
    expect(markupHistory).not.toContain("user-internal-id-42");
    expect(markupHistory).not.toContain("user-internal-id-99");
  });

  // -------------------------------------------------------------------------
  // Not Found State
  // -------------------------------------------------------------------------
  it("renderiza estado NOT_FOUND com tratamento amigável quando produto for nulo", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: null,
        isLoading: false,
      })
    );

    expect(markup).toContain("Produto não encontrado");
    expect(markup).toContain("Voltar para a listagem");
  });
});

describe("ProductDetailPanel — P1-A9 Adversarial Hardening Suite", () => {
  // A1: Zero Value Semantics
  it("A1. formata valores numéricos zero corretamente sem confundir com ausência", () => {
    const zeroProduct: ProductDetail = {
      ...baseProduct,
      salePriceCents: 0,
      costPriceCents: 0,
      quantity: "0",
      minimumStock: "0",
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: zeroProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("0,00");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).toContain("Margem não calculável");
  });

  // A2: All-Zeros Barcode
  it("A2. preserva código de barras composto exclusivamente por zeros", () => {
    const allZerosProduct: ProductDetail = {
      ...baseProduct,
      barcode: "0000000000000",
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: allZerosProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("0000000000000");
  });

  // A3: Whitespace/Empty Barcode
  it("A3. exibe traço neutro quando o código de barras for vazio ou somente espaços", () => {
    const emptyBarcodeProduct: ProductDetail = {
      ...baseProduct,
      barcode: "   ",
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: emptyBarcodeProduct,
        currentTab: "general",
      })
    );

    expect(markup).toContain("—");
  });

  // A4: Sanitized Technical Error
  it("A4. sanitiza rigorosamente erros técnicos de SQL, tabela ou stack trace", () => {
    const technicalError = {
      message: "SELECT * FROM erp_products WHERE client_id = 'xxx' SQLSTATE[23000] at repository.ts:123",
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        error: technicalError,
        onRetry: () => {},
      })
    );

    expect(markup).toContain("Não foi possível carregar os dados devido a uma falha interna");
    expect(markup).not.toContain("SELECT");
    expect(markup).not.toContain("erp_products");
    expect(markup).not.toContain("SQLSTATE");
    expect(markup).not.toContain("repository.ts");
    expect(markup).toContain("Tentar novamente");
  });

  // A5: NOT_FOUND classification by tRPC Code
  it("A5. classifica NOT_FOUND por código tRPC mesmo com mensagem genérica", () => {
    const trpcNotFoundError = {
      data: { code: "NOT_FOUND" },
      message: "Resource does not exist",
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: null,
        error: trpcNotFoundError,
      })
    );

    expect(markup).toContain("Produto não encontrado");
    expect(markup).toContain("Voltar para a listagem");
    expect(markup).not.toContain("Erro ao carregar produto");
  });

  // A6: Unknown Audit Fields & Deep Types
  it("A6. processa com segurança campos de auditoria desconhecidos ou estruturas aninhadas", () => {
    const customAuditHistory: ProductAuditItem[] = [
      {
        publicId: "audit-pub-adv-1",
        productPublicId: "prod-pub-uuid-1111",
        entityType: "product",
        entityPublicId: "prod-pub-uuid-1111",
        action: "custom_future_action",
        summary: "Ação futura desconhecida",
        actor: {
          userId: "user-internal-id-42",
          name: "Auditor Externo",
          role: "auditor",
        },
        changes: {
          ncmTaxCode: { before: null, after: "8471.60.52" },
          isImported: { before: false, after: true },
          numericValue: { before: 10, after: 0 },
          unknownObject: { before: null, after: { fiscalGroup: "ICMS_ST" } },
        },
        metadata: null,
        createdAt: "2026-09-15T12:00:00.000Z",
      },
    ];

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "history",
        historyState: {
          items: customAuditHistory,
          isLoading: false,
        },
      })
    );

    expect(markup).toContain("Ação futura desconhecida");
    expect(markup).toContain("8471.60.52");
    expect(markup).toContain("Ativo");
    expect(markup).toContain("ICMS_ST");
    expect(markup).not.toContain("[object Object]");
    expect(markup).not.toContain("user-internal-id-42");
  });

  // A7: Inactive Supplier Association
  it("A7. distingue visualmente associação de fornecedor inativa de ativa", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "suppliers",
        suppliersState: {
          items: mockSuppliers,
          isLoading: false,
        },
      })
    );

    expect(markup).toContain("Inativo");
    expect(markup).toContain("Global Hardware Corp");
  });

  // A8: Static Scan for Type Safety & No Casts
  it("A8. confirma estaticamente ausência total de 'as unknown as' e 'as any' em ProductDetailPanel.tsx", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ProductDetailPanel.tsx"),
      "utf8"
    );

    expect(source).not.toContain("as unknown as");
    expect(source).not.toContain("as any");
  });

  // A9: Request Switching Isolation
  it("A9. garante isolamento estrito na transição entre produtos durante loading do novo produto", () => {
    // Quando produto B é selecionado e seu loading inicia, dados do produto A não são renderizados
    const markupLoadingB = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: null,
        isLoading: true,
      })
    );

    expect(markupLoadingB).toContain("Carregando produto...");
    expect(markupLoadingB).not.toContain("Mouse Ergonômico");
    expect(markupLoadingB).not.toContain("MOU-ERG-001");
  });

  // A10: Product Images Section renders gallery UI — migration tech text MUST NOT be visible
  it("A10. renderiza seção de Imagens do Produto sem texto técnico de migration exposto", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
        canWrite: true,
      })
    );

    expect(markup).toContain("Imagens do Produto");
    expect(markup).toContain("data-testid=\"product-images-section\"");
    expect(markup).toContain("Galeria de Imagens");
    expect(markup).toContain("Principal");
    // Texto técnico de migration NÃO deve estar exposto ao usuário final
    expect(markup).not.toContain("Migration 0030");
    expect(markup).not.toContain("P1_GALLERY_SCHEMA_GAP=YES");
    expect(markup).not.toContain("0030_robust_umar");
  });

  // A11: Upload and Zoom Controls Presence when canWrite is true
  it("A11. disponibiliza controles de upload e zoom da foto quando canWrite é true", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
        canWrite: true,
      })
    );

    expect(markup).toContain("data-testid=\"upload-product-image-btn\"");
    expect(markup).toContain("data-testid=\"zoom-product-image-btn\"");
  });

  // A12: Read-only mode hides upload and modification buttons
  it("A12. oculta botões de adicionar e substituir imagem quando canWrite é false (modo somente leitura)", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
        canWrite: false,
      })
    );

    expect(markup).toContain("Imagens do Produto");
    expect(markup).toContain("data-testid=\"product-images-section\"");
    expect(markup).not.toContain("data-testid=\"upload-product-image-btn\"");
    expect(markup).not.toContain("data-testid=\"gallery-add-placeholder\"");
  });

  // A13: Gallery Thumbnail Strip rendering
  it("A13. renderiza a faixa de miniaturas da galeria e o indicador da foto principal", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: baseProduct,
        currentTab: "general",
        canWrite: true,
      })
    );

    expect(markup).toContain("data-testid=\"gallery-thumbnails-strip\"");
    expect(markup).toContain("data-testid=\"gallery-thumb-primary\"");
    expect(markup).toContain("Principal");
  });
});

describe("ProductDetailPanel — fetch credentials & URL correctness (static source scan)", () => {
  it("CREDENTIALS_INCLUDE: todos os fetch de product-media usam credentials: include", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ProductDetailPanel.tsx"),
      "utf8"
    );

    const fetchBlocks = source.split("await fetch(").slice(1).map(block => block.slice(0, 400));
    expect(fetchBlocks.length).toBeGreaterThanOrEqual(5);
    for (const block of fetchBlocks) {
      expect(block, `fetch sem credentials: ${block.slice(0, 120)}`).toMatch(/credentials:\s*["']include["']/);
      expect(block, `fetch sem productMediaUrl: ${block.slice(0, 120)}`).toContain("productMediaUrl");
    }
  });

  it("TECHNICAL_MIGRATION_TEXT_REMOVED: texto técnico da migration 0030 não está no source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ProductDetailPanel.tsx"),
      "utf8"
    );
    expect(source).not.toContain("Migration 0030");
    expect(source).not.toContain("P1_GALLERY_SCHEMA_GAP=YES");
    expect(source).not.toContain("0030_robust_umar");
    expect(source).not.toContain("Galeria Multi-Imagem Ativa");
  });

  it("ATTEMPT_ID: header x-client-attempt-id está presente nos fetch de upload POST e PUT", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ProductDetailPanel.tsx"),
      "utf8"
    );
    const attemptIdCount = (source.match(/x-client-attempt-id/g) ?? []).length;
    expect(attemptIdCount).toBeGreaterThanOrEqual(2);
  });

  it("IMG_TAGS_USE_CROSS_ORIGIN: tags img da galeria usam crossOrigin use-credentials e productMediaUrl", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ProductDetailPanel.tsx"),
      "utf8"
    );
    const imgMatches = source.match(/<img[\s\S]*?src=\{productMediaUrl\([\s\S]*?\)\}[\s\S]*?\/>/g) ?? [];
    expect(imgMatches.length).toBeGreaterThanOrEqual(4);
    for (const img of imgMatches) {
      expect(img).toContain('crossOrigin="use-credentials"');
    }
  });
});

describe("ERPWorkspace — Products view mode correctness (static source scan)", () => {
  it("LIST_MODE_HAS_NO_PRODUCT_CARD_STRIP: não existe seção de Destaques do catálogo condicionada a viewMode=table", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"),
      "utf8"
    );
    expect(source).not.toContain('viewMode === "table" && query.data?.items.length');
    expect(source).not.toContain('aria-label="Destaques do catálogo"');
  });

  it("CATALOG_VISUAL_HAS_CARDS: cards de catálogo visual estão condicionados a viewMode=cards", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"),
      "utf8"
    );
    expect(source).toContain('viewMode === "cards"');
    expect(source).toContain('data-testid="catalog-visual-grid"');
    expect(source).toContain('data-testid="product-catalog-card"');
  });

  it("FORM_UPLOAD_CREDENTIALS: fetch de upload no ERPWorkspace usa credentials: include e productMediaUrl", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"),
      "utf8"
    );
    expect(source).toContain('credentials: "include"');
    expect(source).toContain('"x-client-attempt-id"');
    expect(source).toContain('productMediaUrl(`/api/products/${product.publicId}/image`)');
  });

  it("PRODUCT_THUMBNAIL_USES_CROSS_ORIGIN: ProductThumbnail usa crossOrigin use-credentials", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"),
      "utf8"
    );
    expect(source).toContain('crossOrigin="use-credentials"');
  });

  it("PRIMARY_CHANGE_UPDATES_PARENT & NO_RELOAD: ERPWorkspace wires onProductMediaChanged and bumps mediaVersions", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const workspaceSource = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"),
      "utf8"
    );
    const panelSource = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ProductDetailPanel.tsx"),
      "utf8"
    );

    // ProductDetailPanel accepts onProductMediaChanged and triggers it
    expect(panelSource).toContain("onProductMediaChanged?: (productPublicId: string) => void");
    expect(panelSource).toContain("onProductMediaChanged?.(productPublicId)");

    // ERPWorkspace connects onProductMediaChanged to bump mediaVersions and invalidate/refetch
    expect(workspaceSource).toContain("onProductMediaChanged={(pubId) => {");
    expect(workspaceSource).toContain("setMediaVersions");
    expect(workspaceSource).toContain("utils.erp.products.list.invalidate()");

    // ProductThumbnail uses resolved version based on mediaVersions or product.updatedAt
    expect(workspaceSource).toContain("const resolvedVersion = version || (product.updatedAt ? new Date(product.updatedAt).getTime() : 0)");
    expect(workspaceSource).toContain("v=${resolvedVersion}");
  });

  it("CATALOG_AND_LIST_SHARE_CANONICAL_PRIMARY: tanto lista quanto catalogo usam ProductThumbnail com version", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const workspaceSource = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"),
      "utf8"
    );

    // Card do catálogo visual passa mediaVersions
    expect(workspaceSource).toMatch(/data-testid="product-catalog-card"[\s\S]*?<ProductThumbnail[\s\S]*?version=\{mediaVersions\[product\.publicId\]\}/);

    // Linha da tabela de lista passa mediaVersions
    expect(workspaceSource).toMatch(/<td className="p-3 font-medium">[\s\S]*?<ProductThumbnail[\s\S]*?version=\{mediaVersions\[product\.publicId\]\}/);
  });
});
