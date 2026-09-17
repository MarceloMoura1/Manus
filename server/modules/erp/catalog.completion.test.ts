import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpService } from "./service";
import type { ProductRow } from "./repository";
import type { VariantRow, VariantAttributeValueRow } from "./variants/repository";
import type { ProductSupplierRow } from "./product-suppliers/repository";
import { productByBarcodeInput, productBySkuInput, productListInput } from "./contracts";

function mockProductRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 100,
    public_id: "prod-pub-100",
    client_id: "tenant-a",
    name: "Cadeira Ergonômica Pro",
    sku: "CAD-ERG-01",
    barcode: "7891234567890",
    description: "Cadeira gamer de alta performance",
    category: "Móveis e Decoração",
    category_id: 10,
    category_public_id: "cat-pub-10",
    category_name: "Móveis",
    category_slug: "moveis",
    brand_id: 20,
    brand_public_id: "brand-pub-20",
    brand_name: "ErgoMax",
    brand_slug: "ergomax",
    unit: "unit",
    cost_price_cents: 50000,
    sale_price_cents: 120000,
    minimum_stock: "2.000",
    active: 1,
    primary_media_id: null,
    created_by: "user-1",
    updated_by: null,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
    quantity: "15.000",
    ...overrides,
  } as ProductRow;
}

function mockVariantRow(overrides: Partial<VariantRow> = {}): VariantRow {
  return {
    id: 201,
    public_id: "var-pub-201",
    client_id: "tenant-a",
    product_id: 100,
    product_public_id: "prod-pub-100",
    product_name: "Cadeira Ergonômica Pro",
    product_sale_price_cents: 120000,
    sku: "CAD-ERG-01-BLK",
    name: "Preto",
    sale_price_cents: 130000,
    combination_hash: "hash-black",
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: "2026-03-01T10:30:00.000Z",
    updated_at: "2026-03-01T10:30:00.000Z",
    ...overrides,
  } as VariantRow;
}

function mockSupplierRow(overrides: Partial<ProductSupplierRow> = {}): ProductSupplierRow {
  return {
    id: 301,
    public_id: "ps-pub-301",
    client_id: "tenant-a",
    product_id: 100,
    product_public_id: "prod-pub-100",
    product_name: "Cadeira Ergonômica Pro",
    supplier_id: 50,
    supplier_public_id: "sup-pub-50",
    supplier_legal_name: "Ergo Fornecedor LTDA",
    supplier_trade_name: "ErgoDistribuidora",
    supplier_product_code: "SUP-CAD-01",
    cost_price_cents: 45000,
    is_preferred: 1,
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: "2026-03-01T11:00:00.000Z",
    updated_at: "2026-03-01T11:00:00.000Z",
    ...overrides,
  } as ProductSupplierRow;
}

describe("P1-A7 — Product Catalog Completion Gate", () => {
  const adminA = { clientId: "tenant-a", userId: "user-a", role: "admin" as const };
  const adminB = { clientId: "tenant-b", userId: "user-b", role: "admin" as const };

  let productRepo: any;
  let categoryRepo: any;
  let brandRepo: any;
  let variantRepo: any;
  let supplierRepo: any;
  let auditRepo: any;
  let publisher: any;
  let service: ErpService;

  beforeEach(() => {
    productRepo = {
      findProduct: vi.fn(),
      findProductBySku: vi.fn(),
      findProductByBarcode: vi.fn(),
      listProducts: vi.fn(),
      createProduct: vi.fn(),
      updateProduct: vi.fn(),
      summary: vi.fn(),
    };
    categoryRepo = {
      find: vi.fn(),
      findById: vi.fn(),
    };
    brandRepo = {
      find: vi.fn(),
      findById: vi.fn(),
    };
    variantRepo = {
      findByProductId: vi.fn().mockResolvedValue({ rows: [], attributesMap: new Map() }),
      findBySku: vi.fn().mockResolvedValue(null),
    };
    supplierRepo = {
      findPreferredForProduct: vi.fn().mockResolvedValue(null),
    };
    auditRepo = {
      record: vi.fn(),
    };
    publisher = {
      publish: vi.fn(),
    };

    service = new ErpService(
      productRepo,
      undefined,
      publisher,
      categoryRepo,
      brandRepo,
      variantRepo,
      auditRepo,
      supplierRepo
    );
  });

  describe("A. Contract Validation", () => {
    it("validates productBySkuInput schema with exact boundaries", () => {
      expect(productBySkuInput.safeParse({ sku: "CAD-ERG-01" }).success).toBe(true);
      expect(productBySkuInput.safeParse({ sku: "A".repeat(80) }).success).toBe(true);
      expect(productBySkuInput.safeParse({ sku: "A".repeat(81) }).success).toBe(false);
      expect(productBySkuInput.safeParse({ sku: "   " }).success).toBe(false);
      expect(productBySkuInput.safeParse({ sku: "" }).success).toBe(false);
      expect(productBySkuInput.safeParse({}).success).toBe(false);
    });

    it("validates productByBarcodeInput schema with exact boundaries", () => {
      expect(productByBarcodeInput.safeParse({ barcode: "7891234567890" }).success).toBe(true);
      expect(productByBarcodeInput.safeParse({ barcode: "0012345678905" }).success).toBe(true);
      expect(productByBarcodeInput.safeParse({ barcode: "A".repeat(80) }).success).toBe(true);
      expect(productByBarcodeInput.safeParse({ barcode: "A".repeat(81) }).success).toBe(false);
      expect(productByBarcodeInput.safeParse({ barcode: "   " }).success).toBe(false);
      expect(productByBarcodeInput.safeParse({ barcode: "" }).success).toBe(false);
      expect(productByBarcodeInput.safeParse({}).success).toBe(false);
    });

    it("accepts brandId and brandPublicId in productListInput schema", () => {
      const validUuid = crypto.randomUUID();
      const parsed = productListInput.safeParse({
        brandId: 42,
        brandPublicId: validUuid,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.brandId).toBe(42);
        expect(parsed.data.brandPublicId).toBe(validUuid);
      }
    });

    it("rejects non-positive brandId in productListInput schema", () => {
      expect(productListInput.safeParse({ brandId: 0 }).success).toBe(false);
      expect(productListInput.safeParse({ brandId: -5 }).success).toBe(false);
      expect(productListInput.safeParse({ brandId: 1.5 }).success).toBe(false);
    });
  });

  describe("B. SKU Lookup Adversarial (products.bySku)", () => {
    it("resolves product by root SKU with full aggregation", async () => {
      const rootRow = mockProductRow({ sku: "CAD-ERG-01" });
      const variantRow = mockVariantRow({ product_id: 100 });
      const preferredRow = mockSupplierRow({ product_id: 100 });

      productRepo.findProductBySku.mockImplementation((clientId: string, sku: string) => {
        if (clientId === "tenant-a" && sku === "CAD-ERG-01") return Promise.resolve(rootRow);
        return Promise.resolve(null);
      });
      variantRepo.findByProductId.mockResolvedValue({
        rows: [variantRow],
        attributesMap: new Map(),
      });
      supplierRepo.findPreferredForProduct.mockResolvedValue(preferredRow);

      const result = await service.getProductBySku(adminA, "cad-erg-01");

      expect(result.publicId).toBe("prod-pub-100");
      expect(result.name).toBe("Cadeira Ergonômica Pro");
      expect(result.sku).toBe("CAD-ERG-01");
      expect(result.categoryRelational).toEqual({
        publicId: "cat-pub-10",
        name: "Móveis",
        slug: "moveis",
      });
      expect(result.brand).toEqual({
        publicId: "brand-pub-20",
        name: "ErgoMax",
        slug: "ergomax",
      });
      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].sku).toBe("CAD-ERG-01-BLK");
      expect(result.preferredSupplier).not.toBeNull();
      expect(result.preferredSupplier?.supplierPublicId).toBe("sup-pub-50");
      expect(result.matchedVariantPublicId).toBeNull();
    });

    it("normalizes SKU casing and whitespace", async () => {
      productRepo.findProductBySku.mockResolvedValue(mockProductRow());

      await service.getProductBySku(adminA, "   cad-erg-01   ");

      expect(productRepo.findProductBySku).toHaveBeenCalledWith("tenant-a", "CAD-ERG-01");
    });

    it("handles SKU at maximum length limit (80 chars)", async () => {
      const longSku = "S".repeat(80);
      productRepo.findProductBySku.mockResolvedValue(mockProductRow({ sku: longSku }));

      const result = await service.getProductBySku(adminA, longSku);

      expect(result.sku).toBe(longSku);
      expect(productRepo.findProductBySku).toHaveBeenCalledWith("tenant-a", longSku);
    });

    it("resolves variant SKU to parent product and sets matchedVariantPublicId", async () => {
      const parentRow = mockProductRow({ id: 100, public_id: "prod-pub-100", sku: "CAD-ROOT" });
      const variantRow = mockVariantRow({
        id: 205,
        public_id: "var-pub-205",
        sku: "CAD-VAR-SPECIAL",
        product_public_id: "prod-pub-100",
      });

      productRepo.findProductBySku.mockResolvedValue(null);
      variantRepo.findBySku.mockImplementation((clientId: string, sku: string) => {
        if (clientId === "tenant-a" && sku === "CAD-VAR-SPECIAL") return Promise.resolve(variantRow);
        return Promise.resolve(null);
      });
      productRepo.findProduct.mockImplementation((clientId: string, pubId: string) => {
        if (clientId === "tenant-a" && pubId === "prod-pub-100") return Promise.resolve(parentRow);
        return Promise.resolve(null);
      });

      const result = await service.getProductBySku(adminA, "cad-var-special");

      expect(result.publicId).toBe("prod-pub-100");
      expect(result.sku).toBe("CAD-ROOT");
      expect(result.matchedVariantPublicId).toBe("var-pub-205");
    });

    it("retrieves inactive product by SKU correctly preserving active=false", async () => {
      const inactiveRow = mockProductRow({ sku: "INACTIVE-ROOT", active: 0 });
      productRepo.findProductBySku.mockResolvedValue(inactiveRow);

      const result = await service.getProductBySku(adminA, "INACTIVE-ROOT");

      expect(result.publicId).toBe("prod-pub-100");
      expect(result.active).toBe(false);
      expect(result.matchedVariantPublicId).toBeNull();
    });

    it("retrieves parent product when matched variant is inactive", async () => {
      const parentRow = mockProductRow({ id: 100, public_id: "prod-pub-100", sku: "PARENT-ROOT", active: 1 });
      const inactiveVariantRow = mockVariantRow({
        id: 209,
        public_id: "var-pub-209",
        sku: "VAR-INACTIVE",
        active: 0,
        product_public_id: "prod-pub-100",
      });

      productRepo.findProductBySku.mockResolvedValue(null);
      variantRepo.findBySku.mockResolvedValue(inactiveVariantRow);
      productRepo.findProduct.mockResolvedValue(parentRow);
      variantRepo.findByProductId.mockResolvedValue({
        rows: [inactiveVariantRow],
        attributesMap: new Map(),
      });

      const result = await service.getProductBySku(adminA, "VAR-INACTIVE");

      expect(result.publicId).toBe("prod-pub-100");
      expect(result.matchedVariantPublicId).toBe("var-pub-209");
      expect(result.variants[0].active).toBe(false);
    });

    it("rejects with NOT_FOUND when SKU does not exist in the tenant", async () => {
      productRepo.findProductBySku.mockResolvedValue(null);
      variantRepo.findBySku.mockResolvedValue(null);

      await expect(service.getProductBySku(adminA, "NON-EXISTENT")).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: expect.stringContaining("Produto não encontrado para o SKU informado"),
      });
    });

    it("rejects cross-tenant lookup by root SKU", async () => {
      productRepo.findProductBySku.mockImplementation((clientId: string) => {
        if (clientId === "tenant-a") return Promise.resolve(mockProductRow());
        return Promise.resolve(null);
      });
      variantRepo.findBySku.mockResolvedValue(null);

      await expect(service.getProductBySku(adminB, "CAD-ERG-01")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects cross-tenant lookup by variant SKU", async () => {
      productRepo.findProductBySku.mockResolvedValue(null);
      variantRepo.findBySku.mockImplementation((clientId: string) => {
        if (clientId === "tenant-a") return Promise.resolve(mockVariantRow());
        return Promise.resolve(null);
      });

      await expect(service.getProductBySku(adminB, "CAD-ERG-01-BLK")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("permits the same SKU text in different tenants independently", async () => {
      const rowA = mockProductRow({ client_id: "tenant-a", name: "Produto Tenant A", sku: "SHARED-SKU" });
      const rowB = mockProductRow({ client_id: "tenant-b", name: "Produto Tenant B", sku: "SHARED-SKU" });

      productRepo.findProductBySku.mockImplementation((clientId: string, sku: string) => {
        if (sku !== "SHARED-SKU") return Promise.resolve(null);
        if (clientId === "tenant-a") return Promise.resolve(rowA);
        if (clientId === "tenant-b") return Promise.resolve(rowB);
        return Promise.resolve(null);
      });

      const resA = await service.getProductBySku(adminA, "SHARED-SKU");
      const resB = await service.getProductBySku(adminB, "SHARED-SKU");

      expect(resA.name).toBe("Produto Tenant A");
      expect(resB.name).toBe("Produto Tenant B");
    });
  });

  describe("C. Cross-Table SKU Ambiguity (FASE 5)", () => {
    it("resolves deterministically to root product when same SKU exists on product AND variant in same tenant", async () => {
      const rootRow = mockProductRow({
        id: 100,
        public_id: "prod-pub-root",
        name: "Produto Raiz Conflitante",
        sku: "COLLISION-SKU",
      });
      const conflictingVariant = mockVariantRow({
        id: 500,
        public_id: "var-pub-other",
        sku: "COLLISION-SKU",
        product_public_id: "prod-pub-other",
      });

      // Both repository methods would find a match for COLLISION-SKU
      productRepo.findProductBySku.mockResolvedValue(rootRow);
      variantRepo.findBySku.mockResolvedValue(conflictingVariant);

      const result = await service.getProductBySku(adminA, "COLLISION-SKU");

      // Root product MUST win deterministically
      expect(result.publicId).toBe("prod-pub-root");
      expect(result.name).toBe("Produto Raiz Conflitante");
      expect(result.matchedVariantPublicId).toBeNull();
      // Variant repo should NOT even be called because root matched first
      expect(variantRepo.findBySku).not.toHaveBeenCalled();
    });
  });

  describe("D. Barcode Lookup Adversarial (products.byBarcode)", () => {
    it("resolves product by barcode with full aggregation", async () => {
      const rootRow = mockProductRow({ barcode: "7891234567890" });
      productRepo.findProductByBarcode.mockImplementation((clientId: string, barcode: string) => {
        if (clientId === "tenant-a" && barcode === "7891234567890") return Promise.resolve(rootRow);
        return Promise.resolve(null);
      });

      const result = await service.getProductByBarcode(adminA, "7891234567890");

      expect(result.publicId).toBe("prod-pub-100");
      expect(result.barcode).toBe("7891234567890");
      expect(result.categoryRelational?.name).toBe("Móveis");
      expect(result.brand?.name).toBe("ErgoMax");
    });

    it("preserves leading zeros as a string and does not convert to number", async () => {
      const barcodeWithZeros = "0012345678905";
      const rootRow = mockProductRow({ barcode: barcodeWithZeros });
      productRepo.findProductByBarcode.mockImplementation((clientId: string, barcode: string) => {
        if (clientId === "tenant-a" && barcode === barcodeWithZeros) return Promise.resolve(rootRow);
        return Promise.resolve(null);
      });

      const result = await service.getProductByBarcode(adminA, "0012345678905");

      expect(result.barcode).toBe("0012345678905");
      expect(productRepo.findProductByBarcode).toHaveBeenCalledWith("tenant-a", "0012345678905");
    });

    it("normalizes barcode whitespace, hyphens and dots", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(mockProductRow());

      await service.getProductByBarcode(adminA, " 789-123.456 7890 ");

      expect(productRepo.findProductByBarcode).toHaveBeenCalledWith("tenant-a", "7891234567890");
    });

    it("rejects empty or whitespace-only barcode with VALIDATION error", async () => {
      await expect(service.getProductByBarcode(adminA, "   ")).rejects.toMatchObject({
        code: "VALIDATION",
        message: expect.stringContaining("Código de barras inválido"),
      });
      expect(productRepo.findProductByBarcode).not.toHaveBeenCalled();
    });

    it("rejects barcode consisting only of punctuation with VALIDATION error", async () => {
      await expect(service.getProductByBarcode(adminA, " . - - . ")).rejects.toMatchObject({
        code: "VALIDATION",
        message: expect.stringContaining("Código de barras inválido"),
      });
      expect(productRepo.findProductByBarcode).not.toHaveBeenCalled();
    });

    it("retrieves inactive product by barcode correctly preserving active=false", async () => {
      const inactiveRow = mockProductRow({ barcode: "7890000000001", active: 0 });
      productRepo.findProductByBarcode.mockResolvedValue(inactiveRow);

      const result = await service.getProductByBarcode(adminA, "7890000000001");

      expect(result.publicId).toBe("prod-pub-100");
      expect(result.active).toBe(false);
    });

    it("rejects with NOT_FOUND when barcode is not in tenant", async () => {
      productRepo.findProductByBarcode.mockResolvedValue(null);

      await expect(service.getProductByBarcode(adminA, "9999999999999")).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: expect.stringContaining("Produto não encontrado para o código de barras informado"),
      });
    });

    it("rejects cross-tenant lookup by barcode", async () => {
      productRepo.findProductByBarcode.mockImplementation((clientId: string) => {
        if (clientId === "tenant-a") return Promise.resolve(mockProductRow());
        return Promise.resolve(null);
      });

      await expect(service.getProductByBarcode(adminB, "7891234567890")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("allows the same barcode in different tenants independently", async () => {
      const rowA = mockProductRow({ client_id: "tenant-a", name: "Bar A", barcode: "789SHARED" });
      const rowB = mockProductRow({ client_id: "tenant-b", name: "Bar B", barcode: "789SHARED" });

      productRepo.findProductByBarcode.mockImplementation((clientId: string, barcode: string) => {
        if (barcode !== "789SHARED") return Promise.resolve(null);
        if (clientId === "tenant-a") return Promise.resolve(rowA);
        if (clientId === "tenant-b") return Promise.resolve(rowB);
        return Promise.resolve(null);
      });

      const resA = await service.getProductByBarcode(adminA, "789SHARED");
      const resB = await service.getProductByBarcode(adminB, "789SHARED");

      expect(resA.name).toBe("Bar A");
      expect(resB.name).toBe("Bar B");
    });
  });

  describe("E. Brand Filter Parity & Aggregation Integrity", () => {
    it("passes brandId to repository when provided in options", async () => {
      productRepo.listProducts.mockResolvedValue({ items: [mockProductRow()], total: 1 });

      const result = await service.listProducts(adminA, {
        brandId: 20,
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(productRepo.listProducts).toHaveBeenCalledWith(
        "tenant-a",
        expect.objectContaining({ brandId: 20 })
      );
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("combines brandId + brandPublicId + categoryId + categoryPublicId without conflict", async () => {
      const catPub = crypto.randomUUID();
      const brandPub = crypto.randomUUID();
      categoryRepo.find.mockResolvedValue({ id: 10, public_id: catPub, name: "Cat" });
      categoryRepo.findById.mockResolvedValue({ id: 10, public_id: catPub, name: "Cat" });
      productRepo.listProducts.mockResolvedValue({ items: [mockProductRow()], total: 1 });

      const result = await service.listProducts(adminA, {
        categoryId: 10,
        categoryPublicId: catPub,
        brandId: 20,
        brandPublicId: brandPub,
        search: "cadeira",
        stock: "low",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(productRepo.listProducts).toHaveBeenCalledWith(
        "tenant-a",
        expect.objectContaining({
          categoryId: 10,
          categoryPublicId: catPub,
          brandId: 20,
          brandPublicId: brandPub,
          search: "cadeira",
          stock: "low",
        })
      );
      expect(result.items).toHaveLength(1);
    });

    it("omits preferredSupplier when association is inactive or not preferred", async () => {
      const rootRow = mockProductRow();
      productRepo.findProductBySku.mockResolvedValue(rootRow);
      supplierRepo.findPreferredForProduct.mockResolvedValue(
        mockSupplierRow({ active: 0, is_preferred: 1 })
      );

      const result = await service.getProductBySku(adminA, "CAD-ERG-01");

      expect(result.preferredSupplier).toBeNull();
    });

    it("omits preferredSupplier when is_preferred is 0", async () => {
      const rootRow = mockProductRow();
      productRepo.findProductBySku.mockResolvedValue(rootRow);
      supplierRepo.findPreferredForProduct.mockResolvedValue(
        mockSupplierRow({ active: 1, is_preferred: 0 })
      );

      const result = await service.getProductBySku(adminA, "CAD-ERG-01");

      expect(result.preferredSupplier).toBeNull();
    });
  });

  describe("F. Security, Isolation & Error Contract", () => {
    it("never leaks internal database IDs on public product responses", async () => {
      const rootRow = mockProductRow({
        id: 777,
        category_id: 888,
        brand_id: 999,
      });
      productRepo.findProductBySku.mockResolvedValue(rootRow);

      const result = await service.getProductBySku(adminA, "CAD-ERG-01");

      expect(result).not.toHaveProperty("id");
      expect(result.publicId).toBe("prod-pub-100");
    });

    it("handles unexpected variant repository error gracefully without leaking details", async () => {
      productRepo.findProductBySku.mockResolvedValue(null);
      variantRepo.findBySku.mockRejectedValue(new Error("MySQL connection dropped"));

      await expect(service.getProductBySku(adminA, "UNKNOWN")).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: expect.stringContaining("Produto não encontrado para o SKU informado"),
      });
    });
  });
});
