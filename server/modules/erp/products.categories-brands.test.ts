import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErpService } from "./service";
import type { ProductRow } from "./repository";

function mockProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 1,
    public_id: crypto.randomUUID(),
    client_id: "tenant-a",
    name: "Teclado Mecânico",
    sku: "TEC-MEC-01",
    barcode: null,
    description: "Teclado RGB",
    category: "Informática",
    category_id: null,
    category_public_id: null,
    category_name: null,
    brand_id: null,
    brand_public_id: null,
    brand_name: null,
    unit: "unit",
    cost_price_cents: 10000,
    sale_price_cents: 20000,
    minimum_stock: "5.000",
    active: 1,
    primary_media_id: null,
    created_by: "user-1",
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    quantity: "10.000",
    ...overrides,
  } as ProductRow;
}

describe("Product Categories & Brands Integration Rules", () => {
  const adminA = { clientId: "tenant-a", userId: "admin-a", role: "admin" as const };
  let productRepo: any;
  let categoryRepo: any;
  let brandRepo: any;
  let publisher: any;
  let service: ErpService;

  const baseProductCommand = {
    name: "Teclado Mecânico",
    sku: "TEC-MEC-01",
    barcode: null,
    description: "Teclado RGB",
    category: "Informática",
    unit: "unit" as const,
    costPriceCents: 10000,
    salePriceCents: 20000,
    minimumStock: "5.000",
  };

  beforeEach(() => {
    productRepo = {
      createProduct: vi.fn(),
      updateProduct: vi.fn(),
      findProduct: vi.fn(),
      listProducts: vi.fn(),
    };
    categoryRepo = {
      find: vi.fn(),
      findById: vi.fn(),
    };
    brandRepo = {
      find: vi.fn(),
      findById: vi.fn(),
    };
    publisher = { publish: vi.fn() };
    service = new ErpService(
      productRepo,
      undefined,
      publisher,
      categoryRepo,
      brandRepo
    );
  });

  // 25. produto aceita category_id válida
  it("25. accepts valid category_id (or categoryPublicId) from same tenant", async () => {
    const catPublicId = crypto.randomUUID();
    categoryRepo.find.mockImplementation((clientId: string, pubId: string) => {
      if (clientId === "tenant-a" && pubId === catPublicId) {
        return Promise.resolve({ id: 42, public_id: catPublicId, name: "Periféricos" });
      }
      return Promise.resolve(null);
    });

    const createdRow = mockProduct({
      category_id: 42,
      category_public_id: catPublicId,
      category_name: "Periféricos",
    });
    productRepo.createProduct.mockResolvedValue(createdRow);

    const product = await service.createProduct(adminA, {
      ...baseProductCommand,
      categoryPublicId: catPublicId,
    });

    expect(product.categoryId).toBe(42);
    expect(product.categoryPublicId).toBe(catPublicId);
    expect(product.categoryDetails).toEqual({ publicId: catPublicId, name: "Periféricos" });
    expect(productRepo.createProduct).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      expect.any(String),
      expect.objectContaining({ categoryId: 42 })
    );
  });

  // 26. produto aceita brand_id válida
  it("26. accepts valid brand_id (or brandPublicId) from same tenant", async () => {
    const brandPublicId = crypto.randomUUID();
    brandRepo.find.mockImplementation((clientId: string, pubId: string) => {
      if (clientId === "tenant-a" && pubId === brandPublicId) {
        return Promise.resolve({ id: 88, public_id: brandPublicId, name: "Corsair" });
      }
      return Promise.resolve(null);
    });

    const createdRow = mockProduct({
      brand_id: 88,
      brand_public_id: brandPublicId,
      brand_name: "Corsair",
    });
    productRepo.createProduct.mockResolvedValue(createdRow);

    const product = await service.createProduct(adminA, {
      ...baseProductCommand,
      brandPublicId,
    });

    expect(product.brandId).toBe(88);
    expect(product.brandPublicId).toBe(brandPublicId);
    expect(product.brandDetails).toEqual({ publicId: brandPublicId, name: "Corsair" });
    expect(productRepo.createProduct).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      expect.any(String),
      expect.objectContaining({ brandId: 88 })
    );
  });

  // 27. category cross-tenant rejeitada
  it("27. rejects category belonging to a different tenant", async () => {
    const crossTenantCatId = crypto.randomUUID();
    // Category exists in tenant-b, but tenant-a cannot find it
    categoryRepo.find.mockResolvedValue(null);

    await expect(
      service.createProduct(adminA, {
        ...baseProductCommand,
        categoryPublicId: crossTenantCatId,
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("Categoria não encontrada neste tenant"),
    });

    expect(productRepo.createProduct).not.toHaveBeenCalled();
  });

  // 28. brand cross-tenant rejeitada
  it("28. rejects brand belonging to a different tenant", async () => {
    const crossTenantBrandId = crypto.randomUUID();
    brandRepo.find.mockResolvedValue(null);

    await expect(
      service.createProduct(adminA, {
        ...baseProductCommand,
        brandPublicId: crossTenantBrandId,
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("Marca não encontrada neste tenant"),
    });

    expect(productRepo.createProduct).not.toHaveBeenCalled();
  });

  // 29. null continua permitido
  it("29. allows explicit null for category and brand", async () => {
    const createdRow = mockProduct({
      category_id: null,
      brand_id: null,
    });
    productRepo.createProduct.mockResolvedValue(createdRow);

    const product = await service.createProduct(adminA, {
      ...baseProductCommand,
      categoryPublicId: null,
      brandPublicId: null,
    });

    expect(product.categoryId).toBeNull();
    expect(product.brandId).toBeNull();
    expect(productRepo.createProduct).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      expect.any(String),
      expect.objectContaining({ categoryId: null, brandId: null })
    );
  });

  // 30. produto legado continua funcional
  it("30. legacy product with no structured category or brand remains fully functional", async () => {
    const legacyRow = mockProduct({
      category: "Antiga Categoria",
      category_id: null,
      category_public_id: null,
      brand_id: null,
      brand_public_id: null,
    });
    productRepo.createProduct.mockResolvedValue(legacyRow);

    const product = await service.createProduct(adminA, {
      ...baseProductCommand,
      category: "Antiga Categoria",
    });

    expect(product.category).toBe("Antiga Categoria");
    expect(product.categoryId).toBeNull();
    expect(product.categoryPublicId).toBeNull();
    expect(product.brandId).toBeNull();
    expect(product.brandPublicId).toBeNull();
  });

  // 31. category varchar legado permanece preservado
  it("31. preserves legacy varchar category field alongside structured category", async () => {
    const catPublicId = crypto.randomUUID();
    categoryRepo.find.mockResolvedValue({ id: 10, public_id: catPublicId, name: "Periféricos" });

    const row = mockProduct({
      category: "Texto Legado Preservado",
      category_id: 10,
      category_public_id: catPublicId,
      category_name: "Periféricos",
    });
    productRepo.createProduct.mockResolvedValue(row);

    const product = await service.createProduct(adminA, {
      ...baseProductCommand,
      category: "Texto Legado Preservado",
      categoryPublicId: catPublicId,
    });

    expect(product.category).toBe("Texto Legado Preservado");
    expect(product.categoryId).toBe(10);
    expect(product.categoryDetails).toEqual({ publicId: catPublicId, name: "Periféricos" });
  });
});
