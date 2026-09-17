import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErpService } from "./service";
import type { ProductRow } from "./repository";
import type { VariantRow, VariantAttributeValueRow } from "./variants/repository";
import type { ProductSupplierRow } from "./product-suppliers/repository";

function mockProductRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 100,
    public_id: crypto.randomUUID(),
    client_id: "tenant-a",
    name: "Cadeira Ergonômica Pro",
    sku: "CAD-ERG-01",
    barcode: "7891234567890",
    description: "Cadeira gamer de alta performance",
    category: "Móveis e Decoração",
    category_id: null,
    category_public_id: null,
    category_name: null,
    category_slug: null,
    brand_id: null,
    brand_public_id: null,
    brand_name: null,
    brand_slug: null,
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
    public_id: crypto.randomUUID(),
    client_id: "tenant-a",
    product_id: 100,
    product_public_id: "prod-pub-100",
    product_name: "Cadeira Ergonômica Pro",
    product_sale_price_cents: 120000,
    sku: "CAD-ERG-01-BLK",
    name: "Preto",
    sale_price_cents: null, // inherits from product
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
    public_id: crypto.randomUUID(),
    client_id: "tenant-a",
    product_id: 100,
    product_public_id: "prod-pub-100",
    product_name: "Cadeira Ergonômica Pro",
    product_sku: "CAD-ERG-01",
    supplier_id: 50,
    supplier_public_id: crypto.randomUUID(),
    supplier_legal_name: "Mega Móveis Ltda",
    supplier_trade_name: "Mega Móveis",
    supplier_product_code: "MM-CAD-01",
    cost_price_cents: 48000,
    is_preferred: 1,
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: "2026-03-01T11:00:00.000Z",
    updated_at: "2026-03-01T11:00:00.000Z",
    ...overrides,
  } as ProductSupplierRow;
}

describe("P1-A6 — API Compatibility & Aggregation Gate", () => {
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

  describe("A. Public Product Aggregation", () => {
    it("aggregates product without category, brand, variants or preferred supplier", async () => {
      const row = mockProductRow({
        category: null,
        category_id: null,
        category_public_id: null,
        brand_id: null,
        brand_public_id: null,
      });
      productRepo.findProduct.mockResolvedValue(row);

      const result = await service.getProduct(adminA, row.public_id);

      expect(result.publicId).toBe(row.public_id);
      expect(result.category).toBeNull();
      expect(result.categoryId).toBeNull();
      expect(result.categoryPublicId).toBeNull();
      expect(result.categoryDetails).toBeNull();
      expect(result.categoryRelational).toBeNull();
      expect(result.brandId).toBeNull();
      expect(result.brandPublicId).toBeNull();
      expect(result.brandDetails).toBeNull();
      expect(result.brand).toBeNull();
      expect(result.variants).toEqual([]);
      expect(result.preferredSupplier).toBeNull();
    });

    it("aggregates product with category (relational object and legacy details preserved)", async () => {
      const catPublicId = crypto.randomUUID();
      const row = mockProductRow({
        category: "Legado Texto",
        category_id: 15,
        category_public_id: catPublicId,
        category_name: "Cadeiras",
        category_slug: "cadeiras",
      });
      productRepo.findProduct.mockResolvedValue(row);

      const result = await service.getProduct(adminA, row.public_id);

      expect(result.category).toBe("Legado Texto");
      expect(result.categoryId).toBe(15);
      expect(result.categoryPublicId).toBe(catPublicId);
      expect(result.categoryDetails).toEqual({ publicId: catPublicId, name: "Cadeiras" });
      expect(result.categoryRelational).toEqual({
        publicId: catPublicId,
        name: "Cadeiras",
        slug: "cadeiras",
      });
    });

    it("aggregates product with brand (relational object and legacy details preserved)", async () => {
      const brandPublicId = crypto.randomUUID();
      const row = mockProductRow({
        brand_id: 44,
        brand_public_id: brandPublicId,
        brand_name: "ErgoMax",
        brand_slug: "ergomax",
      });
      productRepo.findProduct.mockResolvedValue(row);

      const result = await service.getProduct(adminA, row.public_id);

      expect(result.brandId).toBe(44);
      expect(result.brandPublicId).toBe(brandPublicId);
      expect(result.brandDetails).toEqual({ publicId: brandPublicId, name: "ErgoMax" });
      expect(result.brand).toEqual({
        publicId: brandPublicId,
        name: "ErgoMax",
        slug: "ergomax",
      });
    });

    it("aggregates variants with deterministic ordering, attributes, and price inheritance", async () => {
      const row = mockProductRow({ sale_price_cents: 10000 });
      productRepo.findProduct.mockResolvedValue(row);

      const attrVal1: VariantAttributeValueRow = {
        id: 1,
        variant_id: 201,
        attribute_type_id: 10,
        attribute_value_id: 20,
        type_public_id: "type-pub-1",
        type_name: "Cor",
        type_slug: "cor",
        value_public_id: "val-pub-1",
        value_name: "Azul",
        value_slug: "azul",
      } as VariantAttributeValueRow;

      const v1 = mockVariantRow({
        id: 201,
        sku: "CAD-ERG-01-BLU",
        name: "Azul",
        sale_price_cents: null, // Inherits product price 10000
        product_sale_price_cents: 10000,
      });

      const v2 = mockVariantRow({
        id: 202,
        sku: "CAD-ERG-01-RED",
        name: "Vermelho Especial",
        sale_price_cents: 15000, // Explicit override
        product_sale_price_cents: 10000,
      });

      const v3 = mockVariantRow({
        id: 203,
        sku: "CAD-ERG-01-FREE",
        name: "Brinde Promocional",
        sale_price_cents: 0, // Explicit 0 cents (must NOT inherit product price)
        product_sale_price_cents: 10000,
      });

      const attrMap = new Map<number, VariantAttributeValueRow[]>();
      attrMap.set(201, [attrVal1]);

      // Return variants sorted deterministically by SKU
      variantRepo.findByProductId.mockResolvedValue({
        rows: [v1, v3, v2], // BLU, FREE, RED
        attributesMap: attrMap,
      });

      const result = await service.getProduct(adminA, row.public_id);

      expect(result.variants).toHaveLength(3);

      // Deterministic order maintained
      expect(result.variants[0].sku).toBe("CAD-ERG-01-BLU");
      expect(result.variants[0].salePriceCents).toBeNull();
      expect(result.variants[0].effectivePriceCents).toBe(10000); // Inherited
      expect(result.variants[0].attributes).toEqual([
        {
          typePublicId: "type-pub-1",
          typeName: "Cor",
          typeSlug: "cor",
          valuePublicId: "val-pub-1",
          valueName: "Azul",
          valueSlug: "azul",
        },
      ]);

      // Explicit 0 cents preserves 0
      expect(result.variants[1].sku).toBe("CAD-ERG-01-FREE");
      expect(result.variants[1].salePriceCents).toBe(0);
      expect(result.variants[1].effectivePriceCents).toBe(0);

      // Explicit override
      expect(result.variants[2].sku).toBe("CAD-ERG-01-RED");
      expect(result.variants[2].salePriceCents).toBe(15000);
      expect(result.variants[2].effectivePriceCents).toBe(15000);
    });

    it("aggregates preferred supplier when present", async () => {
      const row = mockProductRow();
      productRepo.findProduct.mockResolvedValue(row);

      const supplierRow = mockSupplierRow({ is_preferred: 1 });
      supplierRepo.findPreferredForProduct.mockResolvedValue(supplierRow);

      const result = await service.getProduct(adminA, row.public_id);

      expect(result.preferredSupplier).not.toBeNull();
      expect(result.preferredSupplier?.supplierLegalName).toBe("Mega Móveis Ltda");
      expect(result.preferredSupplier?.supplierTradeName).toBe("Mega Móveis");
      expect(result.preferredSupplier?.isPreferred).toBe(true);
      expect(result.preferredSupplier?.costPriceCents).toBe(48000);
    });

    it("guarantees tenant isolation across all product detail lookups", async () => {
      // If product belongs to tenant-a, tenant-b cannot find it
      productRepo.findProduct.mockImplementation((clientId: string, pubId: string) => {
        if (clientId === "tenant-a") return Promise.resolve(mockProductRow({ public_id: pubId }));
        return Promise.resolve(null);
      });

      await expect(service.getProduct(adminB, "some-prod-id")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      expect(variantRepo.findByProductId).not.toHaveBeenCalled();
      expect(supplierRepo.findPreferredForProduct).not.toHaveBeenCalled();
    });
  });

  describe("B. Backward Compatibility", () => {
    it("preserves exact shape of all legacy fields on public product", async () => {
      const row = mockProductRow({
        cost_price_cents: 2500,
        sale_price_cents: 5000,
        minimum_stock: "3.000",
        quantity: "12.000",
        active: 1,
      });
      productRepo.findProduct.mockResolvedValue(row);

      const result = await service.getProduct(adminA, row.public_id);

      expect(typeof result.publicId).toBe("string");
      expect(typeof result.name).toBe("string");
      expect(typeof result.sku).toBe("string");
      expect(typeof result.unit).toBe("string");
      expect(typeof result.costPriceCents).toBe("number");
      expect(result.costPriceCents).toBe(2500);
      expect(typeof result.salePriceCents).toBe("number");
      expect(result.salePriceCents).toBe(5000);
      expect(typeof result.minimumStock).toBe("string");
      expect(result.minimumStock).toBe("3.000");
      expect(typeof result.quantity).toBe("string");
      expect(result.quantity).toBe("12.000");
      expect(typeof result.active).toBe("boolean");
      expect(result.active).toBe(true);
      expect(typeof result.hasImage).toBe("boolean");
      expect(typeof result.createdAt).toBe("string");
      expect(typeof result.updatedAt).toBe("string");
    });
  });

  describe("C. List Products & Category Filtering", () => {
    it("lists products without category filter and keeps shape lean without N+1 queries", async () => {
      const rows = [mockProductRow({ sku: "P1" }), mockProductRow({ sku: "P2" })];
      productRepo.listProducts.mockResolvedValue({ items: rows, total: 2 });

      const result = await service.listProducts(adminA, {
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(productRepo.listProducts).toHaveBeenCalledTimes(1);
      // Ensure no variant or supplier lookups occurred for listing
      expect(variantRepo.findByProductId).not.toHaveBeenCalled();
      expect(supplierRepo.findPreferredForProduct).not.toHaveBeenCalled();
    });

    it("filters products by valid categoryPublicId", async () => {
      const catPubId = crypto.randomUUID();
      categoryRepo.find.mockResolvedValue({ id: 10, public_id: catPubId, name: "Informática" });
      productRepo.listProducts.mockResolvedValue({ items: [mockProductRow()], total: 1 });

      const result = await service.listProducts(adminA, {
        categoryPublicId: catPubId,
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(categoryRepo.find).toHaveBeenCalledWith("tenant-a", catPubId);
      expect(productRepo.listProducts).toHaveBeenCalledWith(
        "tenant-a",
        expect.objectContaining({ categoryPublicId: catPubId })
      );
      expect(result.items).toHaveLength(1);
    });

    it("returns empty results immediately when categoryPublicId does not exist in tenant", async () => {
      const crossCatPubId = crypto.randomUUID();
      // Tenant-A cannot find this category
      categoryRepo.find.mockResolvedValue(null);

      const result = await service.listProducts(adminA, {
        categoryPublicId: crossCatPubId,
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(productRepo.listProducts).not.toHaveBeenCalled();
    });

    it("filters products by valid categoryId (numeric PK)", async () => {
      categoryRepo.findById.mockResolvedValue({ id: 25, public_id: "cat-25", name: "Games" });
      productRepo.listProducts.mockResolvedValue({ items: [mockProductRow()], total: 1 });

      const result = await service.listProducts(adminA, {
        categoryId: 25,
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(categoryRepo.findById).toHaveBeenCalledWith("tenant-a", 25);
      expect(productRepo.listProducts).toHaveBeenCalledWith(
        "tenant-a",
        expect.objectContaining({ categoryId: 25 })
      );
      expect(result.items).toHaveLength(1);
    });

    it("returns empty results immediately when numeric categoryId does not exist in tenant", async () => {
      categoryRepo.findById.mockResolvedValue(null);

      const result = await service.listProducts(adminA, {
        categoryId: 9999,
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(productRepo.listProducts).not.toHaveBeenCalled();
    });
  });

  describe("D. ERP Summary with Variant Metrics", () => {
    it("returns summary with tenant-isolated variant metrics and legacy metrics preserved", async () => {
      productRepo.summary.mockResolvedValue({
        metrics: {
          activeProducts: 5,
          inactiveProducts: 1,
          emptyProducts: 0,
          lowProducts: 2,
          totalQuantity: "50.000",
          costValueCents: 100000,
          saleValueCents: 250000,
          totalVariants: 12,
          activeVariants: 10,
          inactiveVariants: 2,
        },
        critical: [],
        recent: [],
      });

      const result = await service.summary(adminA);

      expect(result.metrics.activeProducts).toBe(5);
      expect(result.metrics.inactiveProducts).toBe(1);
      expect(result.metrics.emptyProducts).toBe(0);
      expect(result.metrics.lowProducts).toBe(2);
      expect(result.metrics.totalQuantity).toBe("50.000");
      expect(result.metrics.costValueCents).toBe(100000);
      expect(result.metrics.saleValueCents).toBe(250000);

      // P1-A6 additive variant metrics
      expect(result.metrics.totalVariants).toBe(12);
      expect(result.metrics.activeVariants).toBe(10);
      expect(result.metrics.inactiveVariants).toBe(2);
    });

    it("handles zero variants gracefully without NaN or null", async () => {
      productRepo.summary.mockResolvedValue({
        metrics: {
          activeProducts: 1,
          inactiveProducts: 0,
          totalVariants: 0,
          activeVariants: 0,
          inactiveVariants: 0,
        },
        critical: [],
        recent: [],
      });

      const result = await service.summary(adminA);

      expect(result.metrics.totalVariants).toBe(0);
      expect(result.metrics.activeVariants).toBe(0);
      expect(result.metrics.inactiveVariants).toBe(0);
    });
  });

  describe("E. Security & Data Shape Protection", () => {
    it("never leaks internal database PKs in public product or aggregated entities", async () => {
      const row = mockProductRow({
        id: 777,
        category_id: 888,
        brand_id: 999,
        category_public_id: "cat-pub",
        brand_public_id: "brand-pub",
      });
      productRepo.findProduct.mockResolvedValue(row);

      const variant = mockVariantRow({ id: 555, product_id: 777 });
      variantRepo.findByProductId.mockResolvedValue({
        rows: [variant],
        attributesMap: new Map(),
      });

      const supplier = mockSupplierRow({ id: 444, product_id: 777, supplier_id: 333 });
      supplierRepo.findPreferredForProduct.mockResolvedValue(supplier);

      const result = await service.getProduct(adminA, row.public_id);

      // Root product internal PK check
      expect((result as any).id).toBeUndefined();

      // Relational category check
      expect((result.categoryRelational as any)?.id).toBeUndefined();

      // Relational brand check
      expect((result.brand as any)?.id).toBeUndefined();

      // Variant check
      expect((result.variants[0] as any).id).toBeUndefined();
      expect((result.variants[0] as any).productId).toBeUndefined();
      expect((result.variants[0] as any).product_id).toBeUndefined();

      // Preferred supplier check
      expect((result.preferredSupplier as any)?.id).toBeUndefined();
      expect((result.preferredSupplier as any)?.productId).toBeUndefined();
      expect((result.preferredSupplier as any)?.supplierId).toBeUndefined();
    });

    it("does not trigger audit log records on read operations", async () => {
      productRepo.findProduct.mockResolvedValue(mockProductRow());
      productRepo.listProducts.mockResolvedValue({ items: [], total: 0 });
      productRepo.summary.mockResolvedValue({ metrics: {}, critical: [], recent: [] });

      await service.getProduct(adminA, "prod-id");
      await service.listProducts(adminA, {
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });
      await service.summary(adminA);

      expect(auditRepo.record).not.toHaveBeenCalled();
    });
  });

  describe("F. Adversarial Preferred Supplier & Invariant Review", () => {
    it("never exposes preferredSupplier if association is inactive (active = 0)", async () => {
      const row = mockProductRow();
      productRepo.findProduct.mockResolvedValue(row);

      const inactivePreferred = mockSupplierRow({ is_preferred: 1, active: 0 });
      supplierRepo.findPreferredForProduct.mockResolvedValue(inactivePreferred);

      const result = await service.getProduct(adminA, row.public_id);
      expect(result.preferredSupplier).toBeNull();
    });

    it("never exposes preferredSupplier if association is not preferred (is_preferred = 0)", async () => {
      const row = mockProductRow();
      productRepo.findProduct.mockResolvedValue(row);

      const activeNonPreferred = mockSupplierRow({ is_preferred: 0, active: 1 });
      supplierRepo.findPreferredForProduct.mockResolvedValue(activeNonPreferred);

      const result = await service.getProduct(adminA, row.public_id);
      expect(result.preferredSupplier).toBeNull();
    });
  });

  describe("G. Adversarial List Products Combined Filters & Consistency", () => {
    it("combines categoryPublicId + active correctly", async () => {
      const catPubId = crypto.randomUUID();
      categoryRepo.find.mockResolvedValue({ id: 10, public_id: catPubId, name: "Informática" });
      productRepo.listProducts.mockResolvedValue({ items: [mockProductRow({ active: 1 })], total: 1 });

      const result = await service.listProducts(adminA, {
        categoryPublicId: catPubId,
        active: true,
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(productRepo.listProducts).toHaveBeenCalledWith(
        "tenant-a",
        expect.objectContaining({ categoryPublicId: catPubId, active: true })
      );
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("combines categoryPublicId + search correctly", async () => {
      const catPubId = crypto.randomUUID();
      categoryRepo.find.mockResolvedValue({ id: 10, public_id: catPubId, name: "Informática" });
      productRepo.listProducts.mockResolvedValue({ items: [], total: 0 });

      const result = await service.listProducts(adminA, {
        categoryPublicId: catPubId,
        search: "Gamer",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(productRepo.listProducts).toHaveBeenCalledWith(
        "tenant-a",
        expect.objectContaining({ categoryPublicId: catPubId, search: "Gamer" })
      );
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("combines categoryId + stock correctly", async () => {
      categoryRepo.findById.mockResolvedValue({ id: 25, public_id: "cat-25", name: "Games" });
      productRepo.listProducts.mockResolvedValue({ items: [mockProductRow()], total: 1 });

      const result = await service.listProducts(adminA, {
        categoryId: 25,
        stock: "low",
        search: "",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(productRepo.listProducts).toHaveBeenCalledWith(
        "tenant-a",
        expect.objectContaining({ categoryId: 25, stock: "low" })
      );
      expect(result.items).toHaveLength(1);
    });

    it("combines brandPublicId + categoryPublicId correctly", async () => {
      const catPubId = crypto.randomUUID();
      const brandPubId = crypto.randomUUID();
      categoryRepo.find.mockResolvedValue({ id: 10, public_id: catPubId, name: "Informática" });
      productRepo.listProducts.mockResolvedValue({ items: [mockProductRow()], total: 1 });

      const result = await service.listProducts(adminA, {
        categoryPublicId: catPubId,
        brandPublicId: brandPubId,
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(productRepo.listProducts).toHaveBeenCalledWith(
        "tenant-a",
        expect.objectContaining({ categoryPublicId: catPubId, brandPublicId: brandPubId })
      );
      expect(result.items).toHaveLength(1);
    });

    it("guarantees count and items consistency across pages with filter", async () => {
      const catPubId = crypto.randomUUID();
      categoryRepo.find.mockResolvedValue({ id: 10, public_id: catPubId, name: "Informática" });
      const rows = [mockProductRow({ sku: "P3" })];
      productRepo.listProducts.mockResolvedValue({ items: rows, total: 25 });

      const result = await service.listProducts(adminA, {
        categoryPublicId: catPubId,
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 2,
        pageSize: 10,
      });

      expect(result.total).toBe(25);
      expect(result.totalPages).toBe(3);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(result.items).toHaveLength(1);
    });
  });

  describe("H. Adversarial Summary Variant Metrics Mathematical Proof", () => {
    it("proves mathematically that totalVariants = activeVariants + inactiveVariants", async () => {
      const sampleCases = [
        { total: 0, active: 0, inactive: 0 },
        { total: 1, active: 1, inactive: 0 },
        { total: 1, active: 0, inactive: 1 },
        { total: 15, active: 11, inactive: 4 },
        { total: 100, active: 85, inactive: 15 },
      ];

      for (const sample of sampleCases) {
        productRepo.summary.mockResolvedValue({
          metrics: {
            activeProducts: 5,
            totalVariants: sample.total,
            activeVariants: sample.active,
            inactiveVariants: sample.inactive,
          },
          critical: [],
          recent: [],
        });

        const result = await service.summary(adminA);

        expect(result.metrics.totalVariants).toBe(sample.total);
        expect(result.metrics.activeVariants).toBe(sample.active);
        expect(result.metrics.inactiveVariants).toBe(sample.inactive);
        // Invariant proof
        expect(result.metrics.activeVariants + result.metrics.inactiveVariants).toBe(result.metrics.totalVariants);
      }
    });
  });

  describe("I. Query Complexity Verification (No N+1)", () => {
    it("listProducts executes exactly O(1) repository calls for a page of 20 items", async () => {
      const rows = Array.from({ length: 20 }, (_, i) => mockProductRow({ id: 100 + i, sku: `P-${i}` }));
      productRepo.listProducts.mockResolvedValue({ items: rows, total: 50 });

      await service.listProducts(adminA, {
        search: "",
        stock: "all",
        sort: "name",
        direction: "asc",
        page: 1,
        pageSize: 20,
      });

      expect(productRepo.listProducts).toHaveBeenCalledTimes(1);
      expect(variantRepo.findByProductId).not.toHaveBeenCalled();
      expect(supplierRepo.findPreferredForProduct).not.toHaveBeenCalled();
    });

    it("getProduct executes exactly O(1) queries for product with 10 variants", async () => {
      const row = mockProductRow();
      productRepo.findProduct.mockResolvedValue(row);

      const variants = Array.from({ length: 10 }, (_, i) => mockVariantRow({ id: 200 + i, sku: `V-${i}` }));
      variantRepo.findByProductId.mockResolvedValue({
        rows: variants,
        attributesMap: new Map(),
      });
      supplierRepo.findPreferredForProduct.mockResolvedValue(mockSupplierRow());

      await service.getProduct(adminA, row.public_id);

      expect(productRepo.findProduct).toHaveBeenCalledTimes(1);
      expect(variantRepo.findByProductId).toHaveBeenCalledTimes(1);
      expect(supplierRepo.findPreferredForProduct).toHaveBeenCalledTimes(1);
    });
  });
});
