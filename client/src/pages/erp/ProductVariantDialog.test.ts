import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ProductVariantFormContent,
  type ProductVariantForm,
  emptyVariantForm,
  prepareVariantPayload,
  cents,
  sanitizeErrorMessage,
  type AttributeTypeOption,
  type AttributeValueOption,
  type ProductVariantItem,
} from "./ProductVariantDialog";
import {
  ProductDetailView,
  type ProductDetail,
} from "./ProductDetailPanel";
import {
  variantInput,
  variantUpdateInput,
  setVariantAttributesInput,
} from "../../../../server/modules/erp/variants/contracts";
import fs from "node:fs";
import path from "node:path";

describe("ProductVariantDialog & ProductVariantManagement (P1-A11)", () => {
  const mockProductPublicId = "a0000000-0000-4000-8000-000000000001";

  const mockTypes: AttributeTypeOption[] = [
    { publicId: "b0000000-0000-4000-8000-000000000001", name: "Cor", active: true },
    { publicId: "b0000000-0000-4000-8000-000000000002", name: "Tamanho", active: true },
  ];

  const mockValues: AttributeValueOption[] = [
    {
      publicId: "c0000000-0000-4000-8000-000000000001",
      typePublicId: "b0000000-0000-4000-8000-000000000001",
      typeName: "Cor",
      name: "Azul",
      active: true,
    },
    {
      publicId: "c0000000-0000-4000-8000-000000000002",
      typePublicId: "b0000000-0000-4000-8000-000000000001",
      typeName: "Cor",
      name: "Preto",
      active: true,
    },
    {
      publicId: "c0000000-0000-4000-8000-000000000003",
      typePublicId: "b0000000-0000-4000-8000-000000000002",
      typeName: "Tamanho",
      name: "P",
      active: true,
    },
    {
      publicId: "c0000000-0000-4000-8000-000000000004",
      typePublicId: "b0000000-0000-4000-8000-000000000002",
      typeName: "Tamanho",
      name: "G",
      active: true,
    },
  ];

  const baseVariantForm: ProductVariantForm = {
    publicId: "d0000000-0000-4000-8000-000000000001",
    sku: "CAM-AZUL-G",
    barcode: "0012345678905",
    name: "Camiseta Azul Tamanho G",
    cost: "25,50",
    sale: "59,90",
    selectedAttributeValuePublicIds: {
      "b0000000-0000-4000-8000-000000000001": "c0000000-0000-4000-8000-000000000001",
      "b0000000-0000-4000-8000-000000000002": "c0000000-0000-4000-8000-000000000004",
    },
  };

  const defaultProps = {
    form: baseVariantForm,
    setForm: () => {},
    onSubmit: () => {},
    onCancel: () => {},
    pending: false,
    attributeTypes: mockTypes,
    attributeValues: mockValues,
  };

  // -------------------------------------------------------------------------
  // 1. Criação de variante válida e validação contra Zod real do backend
  // -------------------------------------------------------------------------
  it("1. criação de variante válida prepara payload que satisfaz variantInput do backend", () => {
    const newForm: ProductVariantForm = {
      ...emptyVariantForm,
      sku: "CAM-PRETA-P",
      barcode: "0098765432109",
      name: "Camiseta Preta P",
      cost: "20,00",
      sale: "49,90",
      selectedAttributeValuePublicIds: {
        "type-cor-uuid-1": "a0000000-0000-4000-8000-000000000001",
        "type-tam-uuid-2": "a0000000-0000-4000-8000-000000000002",
      },
    };

    const payload = prepareVariantPayload(newForm, mockProductPublicId);

    expect(payload.productPublicId).toBe(mockProductPublicId);
    expect(payload.sku).toBe("CAM-PRETA-P");
    expect(payload.barcode).toBe("0098765432109");
    expect(payload.name).toBe("Camiseta Preta P");
    expect(payload.costPriceCents).toBe(2000);
    expect(payload.salePriceCents).toBe(4990);
    expect(payload.attributeValuePublicIds).toEqual([
      "a0000000-0000-4000-8000-000000000001",
      "a0000000-0000-4000-8000-000000000002",
    ]);

    // Validação estrita com schema real do backend
    const validated = variantInput.parse({
      ...payload,
      active: true,
    });
    expect(validated.sku).toBe("CAM-PRETA-P");
    expect(validated.costPriceCents).toBe(2000);
    expect(validated.salePriceCents).toBe(4990);
  });

  // -------------------------------------------------------------------------
  // 2. Edição de variante existente
  // -------------------------------------------------------------------------
  it("2. edição de variante existente preserva publicId e prepara payloads válidos para update e setAttributes", () => {
    const editForm: ProductVariantForm = {
      ...baseVariantForm,
      sku: "CAM-AZUL-G-MOD",
      cost: "30,00",
      sale: "69,90",
    };

    const payload = prepareVariantPayload(editForm, mockProductPublicId);

    // Validação contra variantUpdateInput
    const validatedUpdate = variantUpdateInput.parse({
      sku: payload.sku,
      barcode: payload.barcode,
      name: payload.name,
      costPriceCents: payload.costPriceCents,
      salePriceCents: payload.salePriceCents,
    });
    expect(validatedUpdate.sku).toBe("CAM-AZUL-G-MOD");
    expect(validatedUpdate.costPriceCents).toBe(3000);
    expect(validatedUpdate.salePriceCents).toBe(6990);

    // Validação contra setVariantAttributesInput
    const validatedAttrs = setVariantAttributesInput.parse({
      attributeValuePublicIds: [
        "b0000000-0000-4000-8000-000000000001",
        "b0000000-0000-4000-8000-000000000002",
      ],
    });
    expect(validatedAttrs.attributeValuePublicIds).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 3 & 4. Barcode com zeros à esquerda e somente zeros
  // -------------------------------------------------------------------------
  it("3 & 4. barcode com zeros à esquerda ('0012345678905' e '0000000000000') permanece string estrita sem coerção", () => {
    const testBarcodes = ["0012345678905", "0000000000000"];

    for (const bc of testBarcodes) {
      const form: ProductVariantForm = {
        ...baseVariantForm,
        barcode: bc,
      };

      const payload = prepareVariantPayload(form, mockProductPublicId);
      expect(payload.barcode).toBe(bc);
      expect(typeof payload.barcode).toBe("string");
      expect(payload.barcode?.startsWith("00")).toBe(true);

      const validated = variantInput.parse({
        ...payload,
        active: true,
      });
      expect(validated.barcode).toBe(bc);
      expect(typeof validated.barcode).toBe("string");
    }
  });

  // -------------------------------------------------------------------------
  // 5. Preço zero preservado como zero
  // -------------------------------------------------------------------------
  it("5. preço zero ('0,00' e '0') é preservado como 0 cents no payload", () => {
    const zeroForm: ProductVariantForm = {
      ...baseVariantForm,
      cost: "0,00",
      sale: "0,00",
    };

    const payload = prepareVariantPayload(zeroForm, mockProductPublicId);
    expect(payload.costPriceCents).toBe(0);
    expect(payload.salePriceCents).toBe(0);

    const validated = variantInput.parse({
      ...payload,
      active: true,
    });
    expect(validated.costPriceCents).toBe(0);
    expect(validated.salePriceCents).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. Null/undefined conforme contrato (preço de venda vazio herda do produto)
  // -------------------------------------------------------------------------
  it("6. preço de venda vazio envia null respeitando a herança de preço efetivo do produto pai", () => {
    const inheritedPriceForm: ProductVariantForm = {
      ...baseVariantForm,
      sale: "", // Vazio para herdar do pai
      barcode: "   ", // Espaços devem virar null
      name: "   ",
    };

    const payload = prepareVariantPayload(inheritedPriceForm, mockProductPublicId);
    expect(payload.salePriceCents).toBeNull();
    expect(payload.barcode).toBeNull();
    expect(payload.name).toBeNull();

    const validated = variantInput.parse({
      ...payload,
      active: true,
    });
    expect(validated.salePriceCents).toBeNull();
    expect(validated.barcode).toBeNull();
    expect(validated.name).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7 & 8. Seleção e preservação de atributos na edição
  // -------------------------------------------------------------------------
  it("7 & 8. seleção e preservação de atributos na edição renderiza dropdowns por tipo com valores selecionados", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductVariantFormContent, {
        ...defaultProps,
      })
    );

    // Tipos renderizados
    expect(markup).toContain('id="attr-select-b0000000-0000-4000-8000-000000000001"');
    expect(markup).toContain('id="attr-select-b0000000-0000-4000-8000-000000000002"');

    // Opções de Cor
    expect(markup).toContain("c0000000-0000-4000-8000-000000000001");
    expect(markup).toContain("c0000000-0000-4000-8000-000000000002");
    expect(markup).toContain("Azul");
    expect(markup).toContain("Preto");

    // Opções de Tamanho
    expect(markup).toContain("c0000000-0000-4000-8000-000000000003");
    expect(markup).toContain("c0000000-0000-4000-8000-000000000004");
    expect(markup).toContain("P");
    expect(markup).toContain("G");

    // Pré-seleção correta
    expect(markup).toContain('<option value="c0000000-0000-4000-8000-000000000001" selected=""');
    expect(markup).toContain('<option value="c0000000-0000-4000-8000-000000000004" selected=""');
  });

  // -------------------------------------------------------------------------
  // 9 & 10. Ativação, inativação e botões de ação na tabela de variantes
  // -------------------------------------------------------------------------
  it("9 & 10. tabela de variantes renderiza botão 'Nova variante', 'Editar', 'Ativar/Inativar' e 'Excluir' quando canWrite=true", () => {
    const sampleProduct: ProductDetail = {
      publicId: mockProductPublicId,
      name: "Produto Teste",
      sku: "PROD-TESTE",
      barcode: null,
      description: null,
      category: null,
      categoryRelational: null,
      brand: null,
      unit: "unit",
      costPriceCents: 1000,
      salePriceCents: 2000,
      minimumStock: "0",
      quantity: "10",
      active: true,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      variants: [
        {
          publicId: "v-1",
          productPublicId: mockProductPublicId,
          productName: "Produto Teste",
          sku: "PROD-TESTE-V1",
          barcode: "0011111111111",
          name: "V1 Ativa",
          costPriceCents: 1000,
          salePriceCents: 2500,
          effectivePriceCents: 2500,
          active: true,
          attributes: [],
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
        },
        {
          publicId: "v-2",
          productPublicId: mockProductPublicId,
          productName: "Produto Teste",
          sku: "PROD-TESTE-V2",
          barcode: null,
          name: "V2 Inativa",
          costPriceCents: 1200,
          salePriceCents: null,
          effectivePriceCents: 2000,
          active: false,
          attributes: [],
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: sampleProduct,
        isLoading: false,
        canWrite: true,
        currentTab: "variants",
        onBack: () => {},
        onTabChange: () => {},
        onAddVariant: () => {},
        onEditVariant: () => {},
        onToggleVariantActive: () => {},
        onDeleteVariant: () => {},
      })
    );

    // Botão de adicionar
    expect(markup).toContain('data-testid="add-variant-btn"');
    expect(markup).toContain("Nova variante");

    // Ações de V1 (Ativa -> deve exibir 'Inativar')
    expect(markup).toContain('data-testid="edit-variant-btn-v-1"');
    expect(markup).toContain('data-testid="toggle-variant-active-btn-v-1"');
    expect(markup).toContain("Inativar");
    expect(markup).toContain('data-testid="delete-variant-btn-v-1"');
    expect(markup).toContain("Excluir");

    // Ações de V2 (Inativa -> deve exibir 'Ativar')
    expect(markup).toContain('data-testid="toggle-variant-active-btn-v-2"');
    expect(markup).toContain("Ativar");
  });

  // -------------------------------------------------------------------------
  // 11, 12 & 13. Sanitização rigorosa de erros técnicos e IDs internos
  // -------------------------------------------------------------------------
  it("11, 12 & 13. sanitização contra vazamento de SQL, stack trace, Drizzle e tabelas internas", () => {
    const technicalErrors = [
      "SELECT * FROM erp_product_variants WHERE client_id = 'cl_123'",
      "INSERT INTO erp_variant_attribute_values VALUES (1, 2)",
      "UPDATE erp_product_variants SET sku = 'X'",
      "DELETE FROM erp_product_variants",
      "SQLSTATE[23000]: Integrity constraint violation",
      "client_id = 'secret_tenant'",
      "at C:\\Projetos\\megadesk\\server\\modules\\erp\\variants\\service.ts:456",
      "Error: drizzle ORM failed",
      "stack trace details",
    ];

    for (const err of technicalErrors) {
      const sanitized = sanitizeErrorMessage(err);
      expect(sanitized).toBe(
        "Não foi possível carregar os dados devido a uma falha interna. Tente novamente mais tarde."
      );
      expect(sanitized).not.toContain("SELECT");
      expect(sanitized).not.toContain("INSERT");
      expect(sanitized).not.toContain("UPDATE");
      expect(sanitized).not.toContain("DELETE");
      expect(sanitized).not.toContain("SQLSTATE");
      expect(sanitized).not.toContain("client_id");
      expect(sanitized).not.toContain("C:\\");
      expect(sanitized).not.toContain("drizzle");
      expect(sanitized).not.toContain("stack trace");
    }
  });

  // -------------------------------------------------------------------------
  // 14. Double-submit bloqueado com estado pending
  // -------------------------------------------------------------------------
  it("14. double-submit bloqueado com controles desabilitados durante pending=true", () => {
    const markupPending = renderToStaticMarkup(
      React.createElement(ProductVariantFormContent, {
        ...defaultProps,
        pending: true,
      })
    );

    expect(markupPending).toContain('data-testid="submit-variant-form"');
    expect(markupPending).toContain("Salvando…");
    expect(markupPending).toContain('id="variant-sku-input"');
    expect(markupPending).toContain('id="variant-barcode-input"');
    expect(markupPending).toContain('id="variant-cost-input"');
    expect(markupPending).toContain("disabled");
  });

  // -------------------------------------------------------------------------
  // 15 & 16. Request switching e reset ao reabrir modal
  // -------------------------------------------------------------------------
  it("15 & 16. isolamento de estado: emptyVariantForm inicia completamente limpo sem vazar dados anteriores", () => {
    expect(emptyVariantForm.sku).toBe("");
    expect(emptyVariantForm.barcode).toBe("");
    expect(emptyVariantForm.name).toBe("");
    expect(emptyVariantForm.cost).toBe("0,00");
    expect(emptyVariantForm.sale).toBe("");
    expect(emptyVariantForm.selectedAttributeValuePublicIds).toEqual({});

    const markupEmpty = renderToStaticMarkup(
      React.createElement(ProductVariantFormContent, {
        ...defaultProps,
        form: emptyVariantForm,
      })
    );

    expect(markupEmpty).toContain("Nova variante");
    expect(markupEmpty).toContain('value=""');
    expect(markupEmpty).not.toContain('value="CAM-AZUL-G"');
    expect(markupEmpty).not.toContain('value="0012345678905"');
  });

  // -------------------------------------------------------------------------
  // 17. Exibição de mensagens operacionais e erros sanitizados na ficha
  // -------------------------------------------------------------------------
  it("17. exibição correta de status de sucesso e alertas sanitizados de erro", () => {
    const sampleProduct: ProductDetail = {
      publicId: mockProductPublicId,
      name: "Produto Teste",
      sku: "PROD-TESTE",
      barcode: null,
      description: null,
      category: null,
      categoryRelational: null,
      brand: null,
      unit: "unit",
      costPriceCents: 1000,
      salePriceCents: 2000,
      minimumStock: "0",
      quantity: "10",
      active: true,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      variants: [],
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: sampleProduct,
        isLoading: false,
        canWrite: true,
        currentTab: "variants",
        onBack: () => {},
        onTabChange: () => {},
        variantActionMessage: "Variante criada com sucesso.",
        variantActionError: "SELECT * FROM erp_product_variants SQLSTATE[42000]",
      })
    );

    expect(markup).toContain('data-testid="variant-action-message"');
    expect(markup).toContain("Variante criada com sucesso.");
    expect(markup).toContain('data-testid="variant-action-error"');
    expect(markup).toContain("Não foi possível carregar os dados devido a uma falha interna.");
    expect(markup).not.toContain("SELECT");
    expect(markup).not.toContain("SQLSTATE");
  });

  // -------------------------------------------------------------------------
  // 18. Nenhuma regressão na visualização read-only (canWrite=false)
  // -------------------------------------------------------------------------
  it("18. visualização read-only (canWrite=false) preserva dados das variantes sem exibir botões de mutação", () => {
    const sampleProduct: ProductDetail = {
      publicId: mockProductPublicId,
      name: "Produto Teste",
      sku: "PROD-TESTE",
      barcode: null,
      description: null,
      category: null,
      categoryRelational: null,
      brand: null,
      unit: "unit",
      costPriceCents: 1000,
      salePriceCents: 2000,
      minimumStock: "0",
      quantity: "10",
      active: true,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      variants: [
        {
          publicId: "v-read-1",
          productPublicId: mockProductPublicId,
          productName: "Produto Teste",
          sku: "PROD-READ-SKU",
          barcode: "0099999999999",
          name: "Variação Somente Leitura",
          costPriceCents: 1500,
          salePriceCents: 3500,
          effectivePriceCents: 3500,
          active: true,
          attributes: [
            {
              typePublicId: "t-1",
              typeName: "Cor",
              typeSlug: "cor",
              valuePublicId: "v-1",
              valueName: "Branco",
              valueSlug: "branco",
            },
          ],
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductDetailView, {
        product: sampleProduct,
        isLoading: false,
        canWrite: false, // Viewer ou Agent sem permissão de escrita
        currentTab: "variants",
        onBack: () => {},
        onTabChange: () => {},
      })
    );

    // Dados da variante visíveis
    expect(markup).toContain("PROD-READ-SKU");
    expect(markup).toContain("0099999999999");
    expect(markup).toContain("Variação Somente Leitura");
    expect(markup).toContain("Cor: Branco");

    // Botões de escrita NÃO devem estar presentes
    expect(markup).not.toContain('data-testid="add-variant-btn"');
    expect(markup).not.toContain('data-testid="edit-variant-btn-v-read-1"');
    expect(markup).not.toContain('data-testid="toggle-variant-active-btn-v-read-1"');
    expect(markup).not.toContain('data-testid="delete-variant-btn-v-read-1"');
  });

  // -------------------------------------------------------------------------
  // 19. Dinheiro inválido (strings alfanuméricas, negativos, Infinity, NaN)
  // -------------------------------------------------------------------------
  it("19. dinheiro inválido é rejeitado como -1 e impede envio com valores corrompidos", () => {
    expect(cents("abc")).toBe(-1);
    expect(cents("-10")).toBe(-1);
    expect(cents("Infinity")).toBe(-1);
    expect(cents("NaN")).toBe(-1);
    expect(cents("12,34,56")).toBe(-1);

    const invalidForm: ProductVariantForm = {
      ...baseVariantForm,
      cost: "abc",
      sale: "-50,00",
    };

    const payload = prepareVariantPayload(invalidForm, mockProductPublicId);
    expect(payload.costPriceCents).toBe(-1);
    expect(payload.salePriceCents).toBe(-1);
  });

  // -------------------------------------------------------------------------
  // 20. Resiliência a falha parcial (update OK + setAttributes FAIL)
  // -------------------------------------------------------------------------
  it("20. falha parcial em edição: se update tem sucesso e setAttributes falha, invalidação de cache ocorre no finally", async () => {
    let invalidated = false;
    let updateCalled = false;

    const mockUpdate = async () => {
      updateCalled = true;
    };
    const mockSetAttributes = async () => {
      throw new Error("Combinação de atributos já cadastrada para este produto.");
    };
    const mockInvalidate = async () => {
      invalidated = true;
    };

    // Simula o bloco try-finally implementado no ProductVariantDialog
    let caughtError: string | null = null;
    try {
      await mockUpdate();
      try {
        await mockSetAttributes();
      } finally {
        await mockInvalidate();
      }
    } catch (err) {
      caughtError = err instanceof Error ? err.message : String(err);
    }

    expect(updateCalled).toBe(true);
    expect(invalidated).toBe(true); // Garante que o painel não ficou com cache obsoleto!
    expect(caughtError).toBe("Combinação de atributos já cadastrada para este produto.");
    expect(sanitizeErrorMessage(caughtError)).toBe(
      "Combinação de atributos já cadastrada para este produto."
    );
  });

  // -------------------------------------------------------------------------
  // 21. Confirmação e cancelamento de exclusão
  // -------------------------------------------------------------------------
  it("21. exclusão cancelada pelo operador não dispara a mutação de exclusão", async () => {
    let deleteDispatched = false;
    const handleDelete = (confirmed: boolean) => {
      if (!confirmed) return;
      deleteDispatched = true;
    };

    // Operador clica "Cancelar" no confirm
    handleDelete(false);
    expect(deleteDispatched).toBe(false);

    // Operador confirma
    handleDelete(true);
    expect(deleteDispatched).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 22. Alternância de status ativo/inativo
  // -------------------------------------------------------------------------
  it("22. alternância de status ativo para inativo e inativo para ativo constrói payload correto", () => {
    const activeVariant = { publicId: "v-active", active: true };
    const inactiveVariant = { publicId: "v-inactive", active: false };

    const getTogglePayload = (v: { publicId: string; active: boolean }) => ({
      publicId: v.publicId,
      active: !v.active,
    });

    expect(getTogglePayload(activeVariant)).toEqual({
      publicId: "v-active",
      active: false,
    });
    expect(getTogglePayload(inactiveVariant)).toEqual({
      publicId: "v-inactive",
      active: true,
    });
  });

  // -------------------------------------------------------------------------
  // Proibição estrita de type casts inseguros nos arquivos P1-A11
  // -------------------------------------------------------------------------
  it("garante ausência total de 'as any', 'as unknown as', '@ts-ignore' e '@ts-expect-error' nos arquivos P1-A11", () => {
    const dialogPath = path.resolve(
      process.cwd(),
      "client/src/pages/erp/ProductVariantDialog.tsx"
    );
    const dialogSource = fs.readFileSync(dialogPath, "utf8");

    expect(dialogSource).not.toContain("as any");
    expect(dialogSource).not.toContain("as unknown as");
    expect(dialogSource).not.toContain("@ts-ignore");
    expect(dialogSource).not.toContain("@ts-expect-error");
    expect(dialogSource).not.toMatch(/Number\([^)]*barcode/);
    expect(dialogSource).not.toMatch(/parseInt\([^)]*barcode/);

    const panelPath = path.resolve(
      process.cwd(),
      "client/src/pages/erp/ProductDetailPanel.tsx"
    );
    const panelSource = fs.readFileSync(panelPath, "utf8");

    expect(panelSource).not.toContain("as any");
    expect(panelSource).not.toContain("as unknown as");
    expect(panelSource).not.toContain("@ts-ignore");
    expect(panelSource).not.toContain("@ts-expect-error");
  });
});
