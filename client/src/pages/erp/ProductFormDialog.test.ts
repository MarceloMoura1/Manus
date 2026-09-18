import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ProductFormContent,
  type ProductForm,
  emptyProduct,
  prepareProductCommand,
  formatCategoryOptionLabel,
  cents,
  sanitizeErrorMessage,
  type CategoryOptionItem,
  type BrandOptionItem,
} from "./ProductFormDialog";
import { productInput } from "../../../../server/modules/erp/contracts";
import fs from "node:fs";
import path from "node:path";

describe("ProductFormDialog (P1-A10 Relational Category & Brand Integration)", () => {
  const mockCategories: CategoryOptionItem[] = [
    {
      publicId: "a0000000-0000-4000-8000-000000000001",
      name: "Informática",
      depth: 0,
      parentName: null,
    },
    {
      publicId: "a0000000-0000-4000-8000-000000000002",
      name: "Periféricos",
      depth: 1,
      parentName: "Informática",
    },
    {
      publicId: "a0000000-0000-4000-8000-000000000003",
      name: "Mouses",
      depth: 2,
      parentName: "Periféricos",
    },
  ];

  const mockBrands: BrandOptionItem[] = [
    {
      publicId: "b0000000-0000-4000-8000-000000000001",
      name: "Logitech",
    },
    {
      publicId: "b0000000-0000-4000-8000-000000000002",
      name: "Razer",
    },
  ];

  const baseFormData: ProductForm = {
    publicId: "prod-pub-uuid-1111",
    name: "Mouse Ergonômico Wireless",
    sku: "MOU-ERG-001",
    barcode: "0012345678905",
    description: "Mouse sem fio ergonômico",
    category: "Mouses",
    categoryPublicId: "a0000000-0000-4000-8000-000000000003",
    brandPublicId: "b0000000-0000-4000-8000-000000000001",
    cost: "45,00",
    sale: "99,90",
    minimumStock: "5",
    unit: "unit",
  };

  const defaultProps = {
    form: baseFormData,
    setForm: () => {},
    onSubmit: () => {},
    onCancel: () => {},
    pending: false,
    categories: mockCategories,
    brands: mockBrands,
    photoPreview: null,
    removePhoto: false,
    onPhotoSelect: () => {},
    onPhotoRemove: () => {},
    onOpenNewCategory: () => {},
    onOpenNewBrand: () => {},
  };

  // -------------------------------------------------------------------------
  // 1. categories.list alimenta seletor relacional
  // -------------------------------------------------------------------------
  it("1. categories.list alimenta seletor relacional com hierarquia formatada", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
      })
    );

    expect(markup).toContain('id="product-category-select"');
    expect(markup).toContain("a0000000-0000-4000-8000-000000000001");
    expect(markup).toContain("a0000000-0000-4000-8000-000000000002");
    expect(markup).toContain("a0000000-0000-4000-8000-000000000003");
    expect(markup).toContain("Informática");
    expect(markup).toContain("Informática &gt; Periféricos");
    expect(markup).toContain("Periféricos &gt; Mouses");
  });

  // -------------------------------------------------------------------------
  // 2. brands.list alimenta seletor relacional
  // -------------------------------------------------------------------------
  it("2. brands.list alimenta seletor relacional com opção de Sem marca", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
      })
    );

    expect(markup).toContain('id="product-brand-select"');
    expect(markup).toContain("Sem marca");
    expect(markup).toContain("b0000000-0000-4000-8000-000000000001");
    expect(markup).toContain("Logitech");
    expect(markup).toContain("b0000000-0000-4000-8000-000000000002");
    expect(markup).toContain("Razer");
  });

  // -------------------------------------------------------------------------
  // 3 & 4. create envia categoryPublicId e brandPublicId corretos
  // -------------------------------------------------------------------------
  it("3 & 4. create prepara payload com categoryPublicId e brandPublicId corretos e passa no Zod schema real", () => {
    const newForm: ProductForm = {
      ...emptyProduct,
      name: "Teclado Mecânico RGB",
      sku: "TEC-MEC-001",
      barcode: "0098765432101",
      categoryPublicId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      brandPublicId: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22",
      category: "Periféricos",
      cost: "120,50",
      sale: "299,00",
      minimumStock: "10",
      unit: "unit",
      description: "Teclado mecânico switch azul",
    };

    const command = prepareProductCommand(newForm);

    expect(command.categoryPublicId).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(command.brandPublicId).toBe("b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22");
    expect(command.category).toBe("Periféricos");
    expect(command.costPriceCents).toBe(12050);
    expect(command.salePriceCents).toBe(29900);
    expect(command.minimumStock).toBe("10");
    expect(command.barcode).toBe("0098765432101");

    // Validação estrita contra schema Zod real do backend
    const validated = productInput.parse(command);
    expect(validated.categoryPublicId).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(validated.brandPublicId).toBe("b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22");
    expect(validated.category).toBe("Periféricos");
  });

  // -------------------------------------------------------------------------
  // 5 & 6. edit pré-seleciona categoryId e brandId
  // -------------------------------------------------------------------------
  it("5 & 6. edit pré-seleciona categoryPublicId e brandPublicId no markup", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
      })
    );

    // O select de categoria deve ter o option selecionado com o value correspondente
    expect(markup).toContain('<option value="a0000000-0000-4000-8000-000000000003" selected=""');
    // O select de marca deve ter o option selecionado com o value correspondente
    expect(markup).toContain('<option value="b0000000-0000-4000-8000-000000000001" selected=""');
  });

  // -------------------------------------------------------------------------
  // 7. produto sem marca permanece válido
  // -------------------------------------------------------------------------
  it("7. produto sem marca aceita null e envia brandPublicId: null validado pelo Zod real", () => {
    const unbrandedForm: ProductForm = {
      ...baseFormData,
      brandPublicId: null,
    };

    const command = prepareProductCommand(unbrandedForm);
    expect(command.brandPublicId).toBeNull();

    const validated = productInput.parse(command);
    expect(validated.brandPublicId).toBeNull();

    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        form: unbrandedForm,
      })
    );

    expect(markup).toContain('<option value="" selected="">Sem marca</option>');
  });

  // -------------------------------------------------------------------------
  // 8. produto legado sem categoryId continua exibindo categoria textual
  // -------------------------------------------------------------------------
  it("8. produto legado sem categoryPublicId continua exibindo categoria textual com aviso amigável", () => {
    const legacyForm: ProductForm = {
      ...baseFormData,
      categoryPublicId: null,
      category: "Categoria Legada Antiga",
    };

    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        form: legacyForm,
      })
    );

    expect(markup).toContain('id="legacy-category-notice"');
    expect(markup).toContain("Categoria legada atual: &quot;Categoria Legada Antiga&quot;");
    expect(markup).toContain("Manter categoria legada: &quot;Categoria Legada Antiga&quot;");
    expect(markup).toContain('<option value="" selected="">');
  });

  // -------------------------------------------------------------------------
  // 9. salvar produto legado sem mudar categoria não apaga silenciosamente categoria textual
  // -------------------------------------------------------------------------
  it("9. salvar produto legado sem alterar categoria preserva a string textual e envia categoryPublicId: null", () => {
    const legacyForm: ProductForm = {
      ...baseFormData,
      categoryPublicId: null,
      category: "Hardware Antigo",
    };

    const command = prepareProductCommand(legacyForm);
    expect(command.categoryPublicId).toBeNull();
    expect(command.category).toBe("Hardware Antigo");

    const validated = productInput.parse(command);
    expect(validated.categoryPublicId).toBeNull();
    expect(validated.category).toBe("Hardware Antigo");
  });

  // -------------------------------------------------------------------------
  // 10. seleção explícita de categoria relacional funciona em produto legado
  // -------------------------------------------------------------------------
  it("10. selecionar explicitamente categoria relacional em produto legado define categoryPublicId e category", () => {
    const selectedCat = mockCategories[1]; // Periféricos
    const upgradedForm: ProductForm = {
      ...baseFormData,
      categoryPublicId: selectedCat.publicId,
      category: selectedCat.name,
    };

    const command = prepareProductCommand(upgradedForm);
    expect(command.categoryPublicId).toBe("a0000000-0000-4000-8000-000000000002");
    expect(command.category).toBe("Periféricos");

    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        form: upgradedForm,
      })
    );

    // O aviso de categoria legada não deve ser exibido quando categoryPublicId está definido
    expect(markup).not.toContain('id="legacy-category-notice"');
    expect(markup).toContain('<option value="a0000000-0000-4000-8000-000000000002" selected=""');
  });

  // -------------------------------------------------------------------------
  // 11 & 12. barcode com zeros à esquerda permanece string e não sofre coerção numérica
  // -------------------------------------------------------------------------
  it("11 & 12. barcode '0012345678905' permanece string e não sofre coerção numérica", () => {
    const formWithZeros: ProductForm = {
      ...baseFormData,
      barcode: "0012345678905",
    };

    const command = prepareProductCommand(formWithZeros);
    expect(command.barcode).toBe("0012345678905");
    expect(typeof command.barcode).toBe("string");
    expect(command.barcode.startsWith("00")).toBe(true);

    const validated = productInput.parse(command);
    expect(validated.barcode).toBe("0012345678905");
    expect(typeof validated.barcode).toBe("string");
  });

  // -------------------------------------------------------------------------
  // 13. categoria/marca vazias respeitam null/undefined do contrato real
  // -------------------------------------------------------------------------
  it("13. categoria e marca vazias são normalizadas para null/undefined respeitando contrato do backend", () => {
    const emptyRelationalForm: ProductForm = {
      ...baseFormData,
      categoryPublicId: "",
      brandPublicId: "",
      category: "",
      barcode: "   ",
      description: "   ",
    };

    const command = prepareProductCommand(emptyRelationalForm);
    expect(command.categoryPublicId).toBeNull();
    expect(command.brandPublicId).toBeNull();
    expect(command.category).toBeUndefined();
    expect(command.barcode).toBeUndefined();
    expect(command.description).toBeUndefined();

    const validated = productInput.parse(command);
    expect(validated.categoryPublicId).toBeNull();
    expect(validated.brandPublicId).toBeNull();
    expect(validated.category).toBeNull(); // Zod optionalText transforms undefined to null
    expect(validated.barcode).toBeNull();
    expect(validated.description).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 14. falha em categories.list possui estado seguro
  // -------------------------------------------------------------------------
  it("14. falha em categories.list exibe estado seguro e desabilita o seletor sem quebrar o formulário", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        categories: [],
        categoriesError: "Falha de conexão com o catálogo",
      })
    );

    expect(markup).toContain('id="category-error-hint"');
    expect(markup).toContain("Não foi possível carregar as categorias.");
    expect(markup).toContain("disabled");
    // O formulário continua utilizável
    expect(markup).toContain("Salvar");
    expect(markup).toContain("Cancelar");
  });

  // -------------------------------------------------------------------------
  // 15. falha em brands.list possui estado seguro
  // -------------------------------------------------------------------------
  it("15. falha em brands.list exibe estado seguro e desabilita o seletor sem quebrar o formulário", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        brands: [],
        brandsError: "Timeout ao buscar marcas",
      })
    );

    expect(markup).toContain('id="brand-error-hint"');
    expect(markup).toContain("Não foi possível carregar as marcas.");
    expect(markup).toContain("disabled");
    // O formulário continua utilizável
    expect(markup).toContain("Salvar");
  });

  // -------------------------------------------------------------------------
  // 16. nenhum erro técnico/SQL é exibido ao operador
  // -------------------------------------------------------------------------
  it("16. sanitiza rigorosamente erros técnicos contendo SQL ou tabelas internas", () => {
    const technicalError =
      "SELECT * FROM erp_products WHERE client_id = 'tenant-xyz' SQLSTATE[23000]";

    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        errorMessage: technicalError,
        categoriesError: "Unhandled error in Drizzle query on table erp_categories",
        brandsError: "syntax error at or near SELECT table erp_brands",
      })
    );

    expect(markup).not.toContain("SELECT");
    expect(markup).not.toContain("erp_products");
    expect(markup).not.toContain("client_id");
    expect(markup).not.toContain("SQLSTATE");
    expect(markup).not.toContain("Drizzle");
    expect(markup).not.toContain("erp_categories");
    expect(markup).not.toContain("erp_brands");
    expect(markup).toContain("Não foi possível carregar os dados devido a uma falha interna.");
  });

  // -------------------------------------------------------------------------
  // 17. criação/edição existente continua funcional
  // -------------------------------------------------------------------------
  it("17. campos existentes continuam plenamente funcionais (nome, sku, unidade, preços, estoque mínimo)", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
      })
    );

    expect(markup).toContain("Editar produto");
    expect(markup).toContain('value="Mouse Ergonômico Wireless"');
    expect(markup).toContain('value="MOU-ERG-001"');
    expect(markup).toContain('value="0012345678905"');
    expect(markup).toContain('value="45,00"');
    expect(markup).toContain('value="99,90"');
    expect(markup).toContain('value="5"');
    expect(markup).toContain("Quilograma");
    expect(markup).toContain("Metro");
    expect(markup).toContain("Mouse sem fio ergonômico");
  });

  // -------------------------------------------------------------------------
  // Helper: formatCategoryOptionLabel
  // -------------------------------------------------------------------------
  it("formata rótulo de categoria hierárquica corretamente", () => {
    expect(formatCategoryOptionLabel(mockCategories[0])).toBe("Informática");
    expect(formatCategoryOptionLabel(mockCategories[1])).toBe("Informática > Periféricos");
    expect(formatCategoryOptionLabel(mockCategories[2])).toBe("Periféricos > Mouses");
  });

  // -------------------------------------------------------------------------
  // 18. Adversarial: categorias com nomes iguais em pais diferentes (5.L)
  // -------------------------------------------------------------------------
  it("18. categorias com nomes iguais em pais diferentes permanecem distinguíveis", () => {
    const catInformaticaCabos: CategoryOptionItem = {
      publicId: "c0000000-0000-4000-8000-000000000001",
      name: "Cabos",
      depth: 1,
      parentName: "Informática",
    };
    const catAudioCabos: CategoryOptionItem = {
      publicId: "c0000000-0000-4000-8000-000000000002",
      name: "Cabos",
      depth: 1,
      parentName: "Áudio & Vídeo",
    };

    const label1 = formatCategoryOptionLabel(catInformaticaCabos);
    const label2 = formatCategoryOptionLabel(catAudioCabos);

    expect(label1).toBe("Informática > Cabos");
    expect(label2).toBe("Áudio & Vídeo > Cabos");
    expect(label1).not.toBe(label2);

    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        categories: [catInformaticaCabos, catAudioCabos],
      })
    );

    expect(markup).toContain("Informática &gt; Cabos");
    expect(markup).toContain("Áudio &amp; Vídeo &gt; Cabos");
  });

  // -------------------------------------------------------------------------
  // 19. Adversarial: troca de categoria relacional e remoção de marca (5.D & 6.E)
  // -------------------------------------------------------------------------
  it("19. troca de categoria relacional e desvinculação de marca atualizam payload corretamente", () => {
    const initialForm: ProductForm = {
      ...baseFormData,
      categoryPublicId: "a0000000-0000-4000-8000-000000000001", // Informática
      brandPublicId: "b0000000-0000-4000-8000-000000000001", // Logitech
    };

    // Troca para Categoria 2 e desvincula marca
    const updatedForm: ProductForm = {
      ...initialForm,
      categoryPublicId: "a0000000-0000-4000-8000-000000000002", // Periféricos
      category: "Periféricos",
      brandPublicId: null,
    };

    const command = prepareProductCommand(updatedForm);
    expect(command.categoryPublicId).toBe("a0000000-0000-4000-8000-000000000002");
    expect(command.category).toBe("Periféricos");
    expect(command.brandPublicId).toBeNull();

    const validated = productInput.parse(command);
    expect(validated.categoryPublicId).toBe("a0000000-0000-4000-8000-000000000002");
    expect(validated.brandPublicId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 20. Adversarial: Request switching / isolamento estrito de estado (7)
  // -------------------------------------------------------------------------
  it("20. Request switching: abrir produto A, fechar e abrir B não vaza dados nem estado de categoria legada", () => {
    const prodA: ProductForm = {
      publicId: "prod-aaa-111",
      name: "Produto A Legado",
      sku: "SKU-AAA",
      barcode: "0011111111111",
      category: "Categoria Exclusiva de A",
      categoryPublicId: null,
      brandPublicId: "b0000000-0000-4000-8000-000000000001",
      cost: "11,11",
      sale: "22,22",
      minimumStock: "1",
      unit: "unit",
      description: "Descrição de A",
    };

    const prodB: ProductForm = {
      publicId: "prod-bbb-222",
      name: "Produto B Moderno",
      sku: "SKU-BBB",
      barcode: "0022222222222",
      category: "Mouses",
      categoryPublicId: "a0000000-0000-4000-8000-000000000003",
      brandPublicId: "b0000000-0000-4000-8000-000000000002",
      cost: "33,33",
      sale: "44,44",
      minimumStock: "2",
      unit: "kg",
      description: "Descrição de B",
    };

    // Renderiza A
    const markupA = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        form: prodA,
      })
    );
    expect(markupA).toContain('value="Produto A Legado"');
    expect(markupA).toContain('value="SKU-AAA"');
    expect(markupA).toContain('value="0011111111111"');
    expect(markupA).toContain("Categoria Exclusiva de A");
    expect(markupA).toContain('id="legacy-category-notice"');

    // Renderiza B imediatamente
    const markupB = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        form: prodB,
      })
    );
    expect(markupB).not.toContain("Produto A Legado");
    expect(markupB).not.toContain("SKU-AAA");
    expect(markupB).not.toContain("0011111111111");
    expect(markupB).not.toContain("Categoria Exclusiva de A");
    expect(markupB).not.toContain('id="legacy-category-notice"');
    expect(markupB).toContain('value="Produto B Moderno"');
    expect(markupB).toContain('value="SKU-BBB"');
    expect(markupB).toContain('value="0022222222222"');

    // Fechar e abrir criação: emptyProduct inicia limpo
    const markupCreate = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        form: emptyProduct,
      })
    );
    expect(markupCreate).toContain("Novo produto");
    expect(markupCreate).toContain('value=""');
    expect(markupCreate).not.toContain("prod-aaa-111");
    expect(markupCreate).not.toContain("prod-bbb-222");
    expect(markupCreate).not.toContain('id="legacy-category-notice"');
  });

  // -------------------------------------------------------------------------
  // 21. Adversarial: Barcodes com zeros à esquerda extremos (8)
  // -------------------------------------------------------------------------
  it("21. Barcode com '0000000000000' e '0012345678905' preserva exatamente a string", () => {
    const testBarcodes = ["0000000000000", "0012345678905"];

    for (const barcode of testBarcodes) {
      const form: ProductForm = {
        ...baseFormData,
        barcode,
      };
      const cmd = prepareProductCommand(form);
      expect(cmd.barcode).toBe(barcode);
      expect(typeof cmd.barcode).toBe("string");

      const validated = productInput.parse(cmd);
      expect(validated.barcode).toBe(barcode);
      expect(typeof validated.barcode).toBe("string");
    }
  });

  // -------------------------------------------------------------------------
  // 22. Adversarial: Semântica de valores zero vs ausência/inválido (9)
  // -------------------------------------------------------------------------
  it("22. Valores monetários zero válidos ('0,00' e '0') resultam em 0 cents, enquanto strings vazias retornam -1", () => {
    // Valores zero válidos
    expect(cents("0,00")).toBe(0);
    expect(cents("0.00")).toBe(0);
    expect(cents("0")).toBe(0);
    expect(cents("0,0")).toBe(0);

    // Valores ausentes ou inválidos (não podem ser mascarados como zero)
    expect(cents("")).toBe(-1);
    expect(cents("   ")).toBe(-1);
    expect(cents("-10,00")).toBe(-1);
    expect(cents("invalido")).toBe(-1);

    const zeroProductForm: ProductForm = {
      ...baseFormData,
      cost: "0,00",
      sale: "0,00",
      minimumStock: "0",
    };

    const cmd = prepareProductCommand(zeroProductForm);
    expect(cmd.costPriceCents).toBe(0);
    expect(cmd.salePriceCents).toBe(0);
    expect(cmd.minimumStock).toBe("0");

    const validated = productInput.parse(cmd);
    expect(validated.costPriceCents).toBe(0);
    expect(validated.salePriceCents).toBe(0);
    expect(validated.minimumStock).toBe("0");
  });

  // -------------------------------------------------------------------------
  // 23. Adversarial: Bloqueio estrito de vazamento de SQL, tabelas e caminhos (10)
  // -------------------------------------------------------------------------
  it("23. Sanitização contra vazamento de SQL, tabelas, identificadores e caminhos locais", () => {
    const forbiddenLeaks = [
      "SELECT * FROM erp_products",
      "INSERT INTO erp_categories VALUES ('x')",
      "UPDATE erp_brands SET name='test'",
      "DELETE FROM erp_stock_balances",
      "SQLSTATE[42S02]: Base table or view not found",
      "client_id = 'cl_tenant_test_123'",
      "Error: stack trace at C:\\Projetos\\megadesk\\server\\modules\\erp\\service.ts:123",
      "at /usr/src/app/node_modules/drizzle-orm/index.js:45",
      "drizzle query error occurred",
    ];

    for (const leak of forbiddenLeaks) {
      const sanitized = sanitizeErrorMessage(leak);
      expect(sanitized).toBe(
        "Não foi possível carregar os dados devido a uma falha interna. Tente novamente mais tarde."
      );
      expect(sanitized).not.toContain("SELECT");
      expect(sanitized).not.toContain("INSERT");
      expect(sanitized).not.toContain("UPDATE");
      expect(sanitized).not.toContain("DELETE");
      expect(sanitized).not.toContain("SQLSTATE");
      expect(sanitized).not.toContain("erp_products");
      expect(sanitized).not.toContain("erp_categories");
      expect(sanitized).not.toContain("erp_brands");
      expect(sanitized).not.toContain("client_id");
      expect(sanitized).not.toContain("C:\\");
      expect(sanitized).not.toContain("/usr/");
      expect(sanitized).not.toContain("drizzle");
      expect(sanitized).not.toContain("stack trace");
    }
  });

  // -------------------------------------------------------------------------
  // 24. Adversarial: Proteção contra Double Submit e Acessibilidade (11 & 12)
  // -------------------------------------------------------------------------
  it("24. Double submit protection e controles desabilitados quando pending=true", () => {
    const markupPending = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        pending: true,
      })
    );

    // Botão de submit desabilitado e com texto 'Salvando…'
    expect(markupPending).toContain('data-testid="submit-product-form"');
    expect(markupPending).toContain("Salvando…");
    expect(markupPending).toContain("disabled");

    // Seletor de categoria desabilitado durante pending
    expect(markupPending).toContain('id="product-category-select"');
    expect(markupPending).toContain('id="product-brand-select"');

    // Acessibilidade: labels associados por id
    expect(markupPending).toContain('for="product-name-input"');
    expect(markupPending).toContain('id="product-name-input"');
    expect(markupPending).toContain('for="product-sku-input"');
    expect(markupPending).toContain('id="product-sku-input"');
    expect(markupPending).toContain('for="product-barcode-input"');
    expect(markupPending).toContain('id="product-barcode-input"');
    expect(markupPending).toContain('for="product-category-select"');
    expect(markupPending).toContain('for="product-brand-select"');
  });

  // -------------------------------------------------------------------------
  // 25. Inline Category & Brand Creation Buttons
  // -------------------------------------------------------------------------
  it("25. renderiza botões '+ Nova categoria' e '+ Nova marca' com acessibilidade e data-testids", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
      })
    );

    expect(markup).toContain('data-testid="btn-new-category"');
    expect(markup).toContain("+ Nova categoria");
    expect(markup).toContain('data-testid="btn-new-brand"');
    expect(markup).toContain("+ Nova marca");
  });

  it("26. botões '+ Nova categoria' e '+ Nova marca' ficam desabilitados quando pending=true", () => {
    const markupPending = renderToStaticMarkup(
      React.createElement(ProductFormContent, {
        ...defaultProps,
        pending: true,
      })
    );

    // Both buttons should be disabled
    expect(markupPending).toMatch(/<button[^>]*data-testid="btn-new-category"[^>]*disabled|<button[^>]*disabled[^>]*data-testid="btn-new-category"/);
    expect(markupPending).toMatch(/<button[^>]*data-testid="btn-new-brand"[^>]*disabled|<button[^>]*disabled[^>]*data-testid="btn-new-brand"/);
  });

  // -------------------------------------------------------------------------
  // Proibição estrita de type casts e coerções perigosas
  // -------------------------------------------------------------------------
  it("garante ausência de casts inseguros ('as any', 'as unknown as', '@ts-ignore', '@ts-expect-error') e sem coerção numérica em barcode", () => {
    const dialogPath = path.resolve(process.cwd(), "client/src/pages/erp/ProductFormDialog.tsx");
    const dialogSource = fs.readFileSync(dialogPath, "utf8");

    expect(dialogSource).not.toContain("as any");
    expect(dialogSource).not.toContain("as unknown as");
    expect(dialogSource).not.toContain("@ts-ignore");
    expect(dialogSource).not.toContain("@ts-expect-error");
    expect(dialogSource).not.toMatch(/Number\([^)]*barcode/);
    expect(dialogSource).not.toMatch(/parseInt\([^)]*barcode/);

    const workspacePath = path.resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx");
    const workspaceSource = fs.readFileSync(workspacePath, "utf8");

    expect(workspaceSource).not.toContain("as any");
    expect(workspaceSource).not.toContain("as unknown as");
    expect(workspaceSource).not.toContain("@ts-ignore");
    expect(workspaceSource).not.toContain("@ts-expect-error");
  });
});
