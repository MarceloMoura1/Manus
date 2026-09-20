import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpDomainError } from "../errors";
import { VariantService } from "./service";
import { ErpService } from "../service";
import type { VariantRow, VariantAttributeValueRow } from "./repository";
import type { ProductRow } from "../repository";
import { normalizeBarcode } from "../contracts";
import { variantInput, variantUpdateInput } from "./contracts";

function mockVariantRow(overrides: Partial<VariantRow> = {}): VariantRow {
  return {
    id: 201,
    public_id: "var-pub-201",
    client_id: "tenant-a",
    product_id: 100,
    product_public_id: "prod-pub-100",
    product_name: "Camiseta Premium",
    product_sale_price_cents: 9900,
    sku: "CAM-PREM-BLK-M",
    barcode: "0012345678905",
    name: "Preto M",
    cost_price_cents: 2500,
    sale_price_cents: 10900,
    combination_hash: "hash-black-m",
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: "2026-03-01T10:30:00.000Z",
    updated_at: "2026-03-01T10:30:00.000Z",
    ...overrides,
  } as VariantRow;
}

function mockProductRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 100,
    public_id: "prod-pub-100",
    client_id: "tenant-a",
    name: "Camiseta Premium",
    sku: "CAM-PREM",
    barcode: "7891234567890",
    description: "Algodão Pima 100%",
    category: "Vestuário",
    category_id: 10,
    category_public_id: "cat-pub-10",
    category_name: "Roupas",
    category_slug: "roupas",
    brand_id: 20,
    brand_public_id: "brand-pub-20",
    brand_name: "MegaBrand",
    brand_slug: "megabrand",
    unit: "unit",
    cost_price_cents: 2000,
    sale_price_cents: 9900,
    minimum_stock: "5.000",
    active: 1,
    primary_media_id: null,
    created_by: "user-1",
    updated_by: null,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
    quantity: "50.000",
    ...overrides,
  } as ProductRow;
}

describe("P1-A8: Variant Barcode & Cost Parity with Symmetric Catalog Lookups", () => {
  const adminA = { clientId: "tenant-a", userId: "admin-a", role: "admin" as const, userName: "Admin A" };
  const adminB = { clientId: "tenant-b", userId: "admin-b", role: "admin" as const, userName: "Admin B" };

  let variantRepo: any;
  let productRepo: any;
  let attributeRepo: any;
  let auditRepo: any;
  let publisher: any;
  let inventoryRepo: any;
  let variantService: VariantService;
  let erpService: ErpService;
  let mockConnection: any;

  beforeEach(() => {
    mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };

    variantRepo = {
      list: vi.fn(),
      find: vi.fn(),
      findById: vi.fn(),
      findBySku: vi.fn().mockResolvedValue(null),
      findByBarcode: vi.fn().mockResolvedValue(null),
      findByProductId: vi.fn().mockResolvedValue({ rows: [], attributesMap: new Map() }),
      findByCombination: vi.fn().mockResolvedValue(null),
      getAttributesForVariant: vi.fn().mockResolvedValue([]),
      getAttributesForVariants: vi.fn().mockResolvedValue(new Map()),
      create: vi.fn(),
      update: vi.fn(),
      setAttributes: vi.fn(),
      setActive: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
      getPool: vi.fn().mockReturnValue({
        getConnection: vi.fn().mockResolvedValue(mockConnection),
        execute: vi.fn().mockResolvedValue([[]]),
      }),
    };

    productRepo = {
      findProduct: vi.fn().mockResolvedValue(mockProductRow()),
      findProductBySku: vi.fn().mockResolvedValue(null),
      findProductByBarcode: vi.fn().mockResolvedValue(null),
      getPool: vi.fn().mockReturnValue({
        getConnection: vi.fn().mockResolvedValue(mockConnection),
        execute: vi.fn().mockResolvedValue([[]]),
      }),
    };

    attributeRepo = {
      findValuesByPublicIds: vi.fn().mockResolvedValue([]),
    };

    auditRepo = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    publisher = { publish: vi.fn() };
    inventoryRepo = {
      prepareSimpleItemForFirstVariant: vi.fn().mockResolvedValue("removed"),
      createVariantForProduct: vi.fn().mockResolvedValue({ id: 901 }),
      setVariantItemActive: vi.fn().mockResolvedValue(undefined),
    };

    const categoryRepo = {
      find: vi.fn(),
      findById: vi.fn(),
    };

    const brandRepo = {
      find: vi.fn(),
      findById: vi.fn(),
    };

    const supplierRepo = {
      findPreferredForProduct: vi.fn().mockResolvedValue(null),
    };

    variantService = new VariantService(
      variantRepo,
      productRepo,
      attributeRepo,
      publisher,
      auditRepo,
      inventoryRepo
    );

    erpService = new ErpService(
      productRepo,
      undefined,
      publisher,
      categoryRepo as any,
      brandRepo as any,
      variantRepo,
      auditRepo,
      supplierRepo as any
    );
  });

  // ==========================================
  // A. CREATE
  // ==========================================
  describe("A. CREATE", () => {
    it("1. cria variante sem barcode com barcode=null", async () => {
      variantRepo.create.mockResolvedValue(mockVariantRow({ barcode: null }));

      const result = await variantService.create(adminA, {
        productPublicId: "prod-pub-100",
        sku: "CAM-PREM-BLK-P",
      });

      expect(variantRepo.create).toHaveBeenCalledWith(
        "tenant-a",
        "admin-a",
        expect.any(String),
        100,
        expect.objectContaining({
          sku: "CAM-PREM-BLK-P",
          barcode: null,
          costPriceCents: 0,
        }),
        [],
        mockConnection
      );
      expect(result.barcode).toBeNull();
    });

    it("2. cria variante com barcode", async () => {
      variantRepo.create.mockResolvedValue(mockVariantRow({ barcode: "0012345678905" }));

      const result = await variantService.create(adminA, {
        productPublicId: "prod-pub-100",
        sku: "CAM-PREM-BLK-M",
        barcode: "0012345678905",
      });

      expect(variantRepo.create).toHaveBeenCalledWith(
        "tenant-a",
        "admin-a",
        expect.any(String),
        100,
        expect.objectContaining({
          sku: "CAM-PREM-BLK-M",
          barcode: "0012345678905",
        }),
        [],
        mockConnection
      );
      expect(result.barcode).toBe("0012345678905");
    });

    it("3. cria variante com costPriceCents=0 por default", async () => {
      variantRepo.create.mockResolvedValue(mockVariantRow({ cost_price_cents: 0 }));

      const result = await variantService.create(adminA, {
        productPublicId: "prod-pub-100",
        sku: "CAM-PREM-BLK-G",
      });

      expect(variantRepo.create).toHaveBeenCalledWith(
        "tenant-a",
        "admin-a",
        expect.any(String),
        100,
        expect.objectContaining({
          costPriceCents: 0,
        }),
        [],
        mockConnection
      );
      expect(result.costPriceCents).toBe(0);
    });

    it("4. cria variante com custo positivo", async () => {
      variantRepo.create.mockResolvedValue(mockVariantRow({ cost_price_cents: 3550 }));

      const result = await variantService.create(adminA, {
        productPublicId: "prod-pub-100",
        sku: "CAM-PREM-BLK-GG",
        costPriceCents: 3550,
      });

      expect(variantRepo.create).toHaveBeenCalledWith(
        "tenant-a",
        "admin-a",
        expect.any(String),
        100,
        expect.objectContaining({
          costPriceCents: 3550,
        }),
        [],
        mockConnection
      );
      expect(result.costPriceCents).toBe(3550);
    });

    it("5. rejeita custo negativo no schema Zod", () => {
      const parsed = variantInput.safeParse({
        productPublicId: crypto.randomUUID(),
        sku: "CAM-NEG",
        costPriceCents: -100,
      });
      expect(parsed.success).toBe(false);
    });

    it("6. rejeita custo não inteiro (float)", () => {
      const parsed = variantInput.safeParse({
        productPublicId: crypto.randomUUID(),
        sku: "CAM-FLOAT",
        costPriceCents: 19.99,
      });
      expect(parsed.success).toBe(false);
    });
  });

  // ==========================================
  // B. BARCODE NORMALIZATION
  // ==========================================
  describe("B. BARCODE NORMALIZATION", () => {
    it("7. preserva zeros à esquerda no barcode", async () => {
      variantRepo.create.mockResolvedValue(mockVariantRow({ barcode: "0000078912345" }));

      await variantService.create(adminA, {
        productPublicId: "prod-pub-100",
        sku: "CAM-ZERO",
        barcode: " 0000078912345 ",
      });

      expect(variantRepo.create).toHaveBeenCalledWith(
        "tenant-a",
        "admin-a",
        expect.any(String),
        100,
        expect.objectContaining({
          barcode: "0000078912345",
        }),
        [],
        mockConnection
      );
    });

    it("8. normaliza exatamente como produto raiz (remove hifens, pontos e espaços)", () => {
      const raw = " 001.234-567 890 ";
      expect(normalizeBarcode(raw)).toBe("001234567890");
    });

    it("9. não converte barcode para Number (permanece string com leading zero intacto)", () => {
      const normalized = normalizeBarcode("00099");
      expect(typeof normalized).toBe("string");
      expect(normalized).toBe("00099");
      expect(normalized).not.toBe(99);
    });

    it("10. barcode vazio ou só com espaços vira null", () => {
      expect(normalizeBarcode("   ")).toBeNull();
      expect(normalizeBarcode("")).toBeNull();
      expect(normalizeBarcode(null)).toBeNull();
    });
  });

  // ==========================================
  // C. UPDATE
  // ==========================================
  describe("C. UPDATE", () => {
    it("11. altera barcode da variante", async () => {
      const existing = mockVariantRow({ barcode: "1111111111111" });
      variantRepo.find.mockResolvedValue(existing);
      variantRepo.update.mockResolvedValue(mockVariantRow({ barcode: "2222222222222" }));

      const result = await variantService.update(adminA, "var-pub-201", {
        barcode: " 2222-2222-22222 ",
      });

      expect(variantRepo.update).toHaveBeenCalledWith(
        "tenant-a",
        "var-pub-201",
        "admin-a",
        expect.objectContaining({
          barcode: "2222222222222",
        }),
        mockConnection
      );
      expect(result.barcode).toBe("2222222222222");
    });

    it("12. remove barcode ao passar null", async () => {
      const existing = mockVariantRow({ barcode: "1111111111111" });
      variantRepo.find.mockResolvedValue(existing);
      variantRepo.update.mockResolvedValue(mockVariantRow({ barcode: null }));

      const result = await variantService.update(adminA, "var-pub-201", {
        barcode: null,
      });

      expect(variantRepo.update).toHaveBeenCalledWith(
        "tenant-a",
        "var-pub-201",
        "admin-a",
        expect.objectContaining({
          barcode: null,
        }),
        mockConnection
      );
      expect(result.barcode).toBeNull();
    });

    it("13. altera costPriceCents da variante", async () => {
      const existing = mockVariantRow({ cost_price_cents: 2000 });
      variantRepo.find.mockResolvedValue(existing);
      variantRepo.update.mockResolvedValue(mockVariantRow({ cost_price_cents: 4500 }));

      const result = await variantService.update(adminA, "var-pub-201", {
        costPriceCents: 4500,
      });

      expect(variantRepo.update).toHaveBeenCalledWith(
        "tenant-a",
        "var-pub-201",
        "admin-a",
        expect.objectContaining({
          costPriceCents: 4500,
        }),
        mockConnection
      );
      expect(result.costPriceCents).toBe(4500);
    });

    it("14. patch sem barcode preserva o barcode existente sem apagá-lo", async () => {
      const existing = mockVariantRow({ barcode: "0012345678905" });
      variantRepo.find.mockResolvedValue(existing);
      variantRepo.update.mockResolvedValue(mockVariantRow({ name: "Nome Atualizado" }));

      await variantService.update(adminA, "var-pub-201", {
        name: "Nome Atualizado",
      });

      expect(variantRepo.update).toHaveBeenCalledWith(
        "tenant-a",
        "var-pub-201",
        "admin-a",
        expect.not.objectContaining({
          barcode: expect.anything(),
        }),
        mockConnection
      );
    });
  });

  // ==========================================
  // D. UNIQUENESS
  // ==========================================
  describe("D. UNIQUENESS", () => {
    it("15. rejeita mesmo barcode em duas variantes do mesmo tenant (CONFLICT)", async () => {
      variantRepo.findByBarcode.mockResolvedValue(mockVariantRow({ id: 999, public_id: "other-var" }));

      await expect(
        variantService.create(adminA, {
          productPublicId: "prod-pub-100",
          sku: "CAM-DUP-BARCODE",
          barcode: "7890000000001",
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("Código de barras já cadastrado em uma variante"),
      });
    });

    it("16. mesmo barcode em tenants diferentes é permitido", async () => {
      variantRepo.create.mockResolvedValue(mockVariantRow({ client_id: "tenant-b", barcode: "7890000000001" }));

      const result = await variantService.create(adminB, {
        productPublicId: "prod-pub-100",
        sku: "CAM-TENANT-B",
        barcode: "7890000000001",
      });

      expect(variantRepo.findByBarcode).toHaveBeenCalledWith("tenant-b", "7890000000001");
      expect(result.barcode).toBe("7890000000001");
    });

    it("17. concorrência com ER_DUP_ENTRY no índice uq_epv_tenant_barcode é traduzida para CONFLICT sem vazar SQL", async () => {
      const dbError: any = new Error("Duplicate entry 'tenant-a-7890000000001' for key 'uq_epv_tenant_barcode'");
      dbError.code = "ER_DUP_ENTRY";
      variantRepo.create.mockRejectedValue(dbError);

      await expect(
        variantService.create(adminA, {
          productPublicId: "prod-pub-100",
          sku: "CAM-RACE",
          barcode: "7890000000001",
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("Código de barras já cadastrado"),
      });
    });

    it("17b. múltiplos barcodes NULL no mesmo tenant são permitidos sem conflito", async () => {
      variantRepo.create.mockResolvedValueOnce(mockVariantRow({ id: 201, barcode: null }));
      variantRepo.create.mockResolvedValueOnce(mockVariantRow({ id: 202, barcode: null }));

      const v1 = await variantService.create(adminA, {
        productPublicId: "prod-pub-100",
        sku: "CAM-NULL-1",
        barcode: null,
      });

      const v2 = await variantService.create(adminA, {
        productPublicId: "prod-pub-100",
        sku: "CAM-NULL-2",
        barcode: null,
      });

      expect(variantRepo.findByBarcode).not.toHaveBeenCalled();
      expect(v1.barcode).toBeNull();
      expect(v2.barcode).toBeNull();
    });

    it("17c. boundary de barcode: comprimento 80 é aceito e 81 é rejeitado pelo schema", () => {
      const valid80 = "A".repeat(80);
      const invalid81 = "A".repeat(81);

      const parsedValid = variantInput.safeParse({
        productPublicId: crypto.randomUUID(),
        sku: "CAM-LEN-80",
        barcode: valid80,
      });
      expect(parsedValid.success).toBe(true);

      const parsedInvalid = variantInput.safeParse({
        productPublicId: crypto.randomUUID(),
        sku: "CAM-LEN-81",
        barcode: invalid81,
      });
      expect(parsedInvalid.success).toBe(false);
    });

    it("17d. casos adversariais de custo: NaN, Infinity, negativo e decimal são rejeitados", () => {
      const uuid = crypto.randomUUID();
      expect(variantInput.safeParse({ productPublicId: uuid, sku: "S1", costPriceCents: NaN }).success).toBe(false);
      expect(variantInput.safeParse({ productPublicId: uuid, sku: "S2", costPriceCents: Infinity }).success).toBe(false);
      expect(variantInput.safeParse({ productPublicId: uuid, sku: "S3", costPriceCents: -1 }).success).toBe(false);
      expect(variantInput.safeParse({ productPublicId: uuid, sku: "S4", costPriceCents: 1.5 }).success).toBe(false);
      expect(variantInput.safeParse({ productPublicId: uuid, sku: "S5", costPriceCents: 0 }).success).toBe(true);
      expect(variantInput.safeParse({ productPublicId: uuid, sku: "S6", costPriceCents: 1 }).success).toBe(true);
      expect(variantInput.safeParse({ productPublicId: uuid, sku: "S7", costPriceCents: 50000000 }).success).toBe(true);
    });

    it("17e. update parcial preserva costPriceCents e barcode sem alterá-los", async () => {
      const existing = mockVariantRow({ barcode: "0012345678905", cost_price_cents: 2500 });
      variantRepo.find.mockResolvedValue(existing);
      variantRepo.update.mockResolvedValue(mockVariantRow({ active: 0 }));

      await variantService.update(adminA, "var-pub-201", {
        active: false,
      });

      expect(variantRepo.update).toHaveBeenCalledWith(
        "tenant-a",
        "var-pub-201",
        "admin-a",
        expect.not.objectContaining({
          barcode: expect.anything(),
          costPriceCents: expect.anything(),
        }),
        mockConnection
      );
    });
  });

  // ==========================================
  // E. CATALOG LOOKUP (products.byBarcode)
  // ==========================================
  describe("E. CATALOG LOOKUP", () => {
    it("18. products.byBarcode encontra produto raiz quando cadastrado na raiz", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(mockProductRow({ barcode: "7891111111111" }));

      const result = await erpService.getProductByBarcode(adminA, "7891111111111");

      expect(result.publicId).toBe("prod-pub-100");
    });

    it("19. root match define matchedVariantPublicId=null", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(mockProductRow({ barcode: "7891111111111" }));

      const result = await erpService.getProductByBarcode(adminA, "7891111111111");

      expect(result.matchedVariantPublicId).toBeNull();
    });

    it("20. products.byBarcode resolve variante quando não há produto raiz com o barcode", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(null);
      variantRepo.findByBarcode.mockResolvedValue(mockVariantRow({
        public_id: "var-pub-777",
        product_public_id: "prod-pub-100",
        barcode: "7892222222222",
      }));
      productRepo.findProduct.mockResolvedValue(mockProductRow());

      const result = await erpService.getProductByBarcode(adminA, "7892222222222");

      expect(result.publicId).toBe("prod-pub-100");
      expect(result.matchedVariantPublicId).toBe("var-pub-777");
    });

    it("21. variant match retorna produto pai agregado completo", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(null);
      variantRepo.findByBarcode.mockResolvedValue(mockVariantRow({
        public_id: "var-pub-777",
        product_public_id: "prod-pub-100",
        barcode: "7892222222222",
      }));
      productRepo.findProduct.mockResolvedValue(mockProductRow({ name: "Produto Pai Agregado" }));

      const result = await erpService.getProductByBarcode(adminA, "7892222222222");

      expect(result.name).toBe("Produto Pai Agregado");
      expect(result.category).toBe("Vestuário");
      expect(result.categoryDetails?.name).toBe("Roupas");
      expect(result.brand?.name).toBe("MegaBrand");
    });

    it("22. variant match retorna matchedVariantPublicId correspondente à variante encontrada", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(null);
      variantRepo.findByBarcode.mockResolvedValue(mockVariantRow({
        public_id: "var-pub-xyz-888",
        product_public_id: "prod-pub-100",
        barcode: "7893333333333",
      }));

      const result = await erpService.getProductByBarcode(adminA, "7893333333333");

      expect(result.matchedVariantPublicId).toBe("var-pub-xyz-888");
    });

    it("23. lookup cross-tenant não vaza dados de outro tenant (NOT_FOUND)", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(null);
      variantRepo.findByBarcode.mockResolvedValue(null);

      await expect(erpService.getProductByBarcode(adminA, "7899999999999")).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: expect.stringContaining("Produto não encontrado para o código de barras informado"),
      });
      expect(variantRepo.findByBarcode).toHaveBeenCalledWith("tenant-a", "7899999999999");
    });

    it("24. código de barras inexistente lança NOT_FOUND", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(null);
      variantRepo.findByBarcode.mockResolvedValue(null);

      await expect(erpService.getProductByBarcode(adminA, "0000000000000")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("25. busca com zeros à esquerda encontra a variante", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(null);
      variantRepo.findByBarcode.mockResolvedValue(mockVariantRow({
        public_id: "var-leading-zero",
        barcode: "00012345",
      }));

      const result = await erpService.getProductByBarcode(adminA, " 00012345 ");

      expect(variantRepo.findByBarcode).toHaveBeenCalledWith("tenant-a", "00012345");
      expect(result.matchedVariantPublicId).toBe("var-leading-zero");
    });

    it("26. se root e variant tiverem o mesmo barcode, ROOT vence deterministicamente (ROOT_PRIORITY)", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(mockProductRow({
        public_id: "prod-root-wins",
        barcode: "789-COLLISION",
      }));
      variantRepo.findByBarcode.mockResolvedValue(mockVariantRow({
        public_id: "var-should-not-be-reached",
        barcode: "789-COLLISION",
      }));

      const result = await erpService.getProductByBarcode(adminA, "789-COLLISION");

      expect(result.publicId).toBe("prod-root-wins");
      expect(result.matchedVariantPublicId).toBeNull();
      expect(variantRepo.findByBarcode).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // F. AGGREGATION & BACKWARD COMPATIBILITY
  // ==========================================
  describe("F. AGGREGATION & BACKWARD COMPATIBILITY", () => {
    it("27. products.detail inclui barcode da variante na lista de variantes", async () => {
      productRepo.findProduct.mockResolvedValue(mockProductRow());
      variantRepo.findByProductId = vi.fn().mockResolvedValue({
        rows: [mockVariantRow({ barcode: "0012345678905" })],
        attributesMap: new Map(),
      });

      const result = await erpService.getProduct(adminA, "prod-pub-100");

      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].barcode).toBe("0012345678905");
    });

    it("28. products.detail inclui costPriceCents da variante", async () => {
      productRepo.findProduct.mockResolvedValue(mockProductRow());
      variantRepo.findByProductId = vi.fn().mockResolvedValue({
        rows: [mockVariantRow({ cost_price_cents: 2750 })],
        attributesMap: new Map(),
      });

      const result = await erpService.getProduct(adminA, "prod-pub-100");

      expect(result.variants[0].costPriceCents).toBe(2750);
    });

    it("29. products.bySku continua funcionando normalmente", async () => {
      productRepo.findProductBySku.mockResolvedValue(null);
      variantRepo.findBySku.mockResolvedValue(mockVariantRow({
        public_id: "var-sku-match",
        sku: "CAM-BY-SKU",
      }));

      const result = await erpService.getProductBySku(adminA, "CAM-BY-SKU");

      expect(result.matchedVariantPublicId).toBe("var-sku-match");
    });

    it("30. variantes existentes sem barcode (null) continuam funcionando sem quebra", async () => {
      productRepo.findProduct.mockResolvedValue(mockProductRow());
      variantRepo.findByProductId = vi.fn().mockResolvedValue({
        rows: [mockVariantRow({ barcode: null, cost_price_cents: 0 })],
        attributesMap: new Map(),
      });

      const result = await erpService.getProduct(adminA, "prod-pub-100");

      expect(result.variants[0].barcode).toBeNull();
      expect(result.variants[0].costPriceCents).toBe(0);
    });
  });

  // ==========================================
  // G. AUDIT
  // ==========================================
  describe("G. AUDIT", () => {
    it("31. variant_created registra barcode e costPriceCents no diff", async () => {
      variantRepo.create.mockResolvedValue(mockVariantRow({
        barcode: "7890001112223",
        cost_price_cents: 3200,
      }));

      await variantService.create(adminA, {
        productPublicId: "prod-pub-100",
        sku: "CAM-AUDIT-CREATE",
        barcode: "7890001112223",
        costPriceCents: 3200,
      });

      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "variant_created",
          changesJson: expect.objectContaining({
            barcode: { before: null, after: "7890001112223" },
            costPriceCents: { before: null, after: 3200 },
          }),
        }),
        mockConnection
      );
    });

    it("32. variant_updated registra alteração de barcode", async () => {
      const existing = mockVariantRow({ barcode: "OLD-BARCODE-1" });
      variantRepo.find.mockResolvedValue(existing);
      variantRepo.update.mockResolvedValue(mockVariantRow({ barcode: "NEW-BARCODE-2" }));

      await variantService.update(adminA, "var-pub-201", {
        barcode: "NEW-BARCODE-2",
      });

      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "variant_updated",
          changesJson: expect.objectContaining({
            barcode: { before: "OLD-BARCODE-1", after: "NEW-BARCODE-2" },
          }),
        }),
        mockConnection
      );
    });

    it("33. variant_updated registra alteração de custo", async () => {
      const existing = mockVariantRow({ cost_price_cents: 1000 });
      variantRepo.find.mockResolvedValue(existing);
      variantRepo.update.mockResolvedValue(mockVariantRow({ cost_price_cents: 1500 }));

      await variantService.update(adminA, "var-pub-201", {
        costPriceCents: 1500,
      });

      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "variant_updated",
          changesJson: expect.objectContaining({
            costPriceCents: { before: 1000, after: 1500 },
          }),
        }),
        mockConnection
      );
    });

    it("34. falha no audit causa rollback completo da mutação da variante", async () => {
      variantRepo.create.mockResolvedValue(mockVariantRow());
      auditRepo.record.mockRejectedValue(new Error("Audit log disk write failure"));

      await expect(
        variantService.create(adminA, {
          productPublicId: "prod-pub-100",
          sku: "CAM-ROLLBACK-AUDIT",
          barcode: "7899998887776",
        })
      ).rejects.toThrow("Audit log disk write failure");

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // H. TENANT ISOLATION
  // ==========================================
  describe("H. TENANT ISOLATION", () => {
    it("35. nenhuma query de barcode retorna variante de outro tenant", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(null);
      variantRepo.findByBarcode.mockResolvedValue(null);

      await expect(erpService.getProductByBarcode(adminA, "BARCODE-OTHER-TENANT")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      expect(variantRepo.findByBarcode).toHaveBeenCalledWith("tenant-a", "BARCODEOTHERTENANT");
      expect(variantRepo.findByBarcode).not.toHaveBeenCalledWith("tenant-b", expect.anything());
    });
  });
});
