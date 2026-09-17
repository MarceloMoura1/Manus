import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpService } from "./service";
import { calculateEffectivePrice } from "./variants/contracts";

describe("Products & Variants Integration Rules", () => {
  const adminA = { clientId: "tenant-a", userId: "admin-a", role: "admin" as const };
  const adminB = { clientId: "tenant-b", userId: "admin-b", role: "admin" as const };

  let erpRepo: any;
  let categoryRepo: any;
  let brandRepo: any;
  let variantRepo: any;
  let publisher: any;
  let service: ErpService;

  beforeEach(() => {
    erpRepo = {
      listProducts: vi.fn(),
      findProduct: vi.fn(),
      findProductBySku: vi.fn().mockResolvedValue(null),
      createProduct: vi.fn(),
      updateProduct: vi.fn(),
      setProductActive: vi.fn(),
    };

    categoryRepo = {
      find: vi.fn(),
    };

    brandRepo = {
      find: vi.fn(),
    };

    variantRepo = {
      findBySku: vi.fn().mockResolvedValue(null),
    };

    publisher = { publish: vi.fn() };

    service = new ErpService(
      erpRepo,
      vi.fn().mockResolvedValue(undefined),
      publisher,
      categoryRepo,
      brandRepo,
      variantRepo
    );
  });

  describe("VARIANT_TO_PRODUCT_SKU_COLLISION_REJECTED", () => {
    it("rejects creating product when SKU is already used by a variant in the same tenant", async () => {
      variantRepo.findBySku.mockResolvedValue({ id: 5, sku: "CAM-PRE-P" });

      await expect(
        service.createProduct(adminA, {
          name: "Camiseta",
          sku: "cam-pre-p",
          barcode: null,
          description: null,
          category: null,
          unit: "unit",
          costPriceCents: 1000,
          salePriceCents: 2000,
          minimumStock: "0.000",
        })
      ).rejects.toThrow("SKU já cadastrado em uma variante deste tenant.");

      expect(erpRepo.createProduct).not.toHaveBeenCalled();
    });

    it("rejects updating product to an SKU already used by a variant in the same tenant", async () => {
      const current = {
        id: 1,
        public_id: "prod-1",
        sku: "PROD-OLD",
        category_id: null,
        brand_id: null,
      };
      erpRepo.findProduct.mockResolvedValue(current);
      variantRepo.findBySku.mockResolvedValue({ id: 5, sku: "CAM-PRE-P" });

      await expect(
        service.updateProduct(adminA, current.public_id, {
          name: "Camiseta",
          sku: "CAM-PRE-P",
          barcode: null,
          description: null,
          category: null,
          unit: "unit",
          costPriceCents: 1000,
          salePriceCents: 2000,
          minimumStock: "0.000",
        })
      ).rejects.toThrow("SKU já cadastrado em uma variante deste tenant.");

      expect(erpRepo.updateProduct).not.toHaveBeenCalled();
    });

    it("allows creating product with same SKU as a variant in ANOTHER tenant", async () => {
      // In tenant B, variant repo finds nothing for tenant B
      variantRepo.findBySku.mockResolvedValue(null);
      erpRepo.createProduct.mockResolvedValue({
        id: 2,
        public_id: "prod-2",
        sku: "CAM-PRE-P",
        name: "Camiseta",
        cost_price_cents: 1000,
        sale_price_cents: 2000,
        minimum_stock: "0.000",
        active: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const result = await service.createProduct(adminB, {
        name: "Camiseta",
        sku: "CAM-PRE-P",
        barcode: null,
        description: null,
        category: null,
        unit: "unit",
        costPriceCents: 1000,
        salePriceCents: 2000,
        minimumStock: "0.000",
      });

      expect(result.sku).toBe("CAM-PRE-P");
      expect(variantRepo.findBySku).toHaveBeenCalledWith("tenant-b", "CAM-PRE-P");
    });
  });

  describe("VARIANT_EFFECTIVE_PRICE_AFTER_PRODUCT_PRICE_CHANGE", () => {
    it("automatically reflects new parent price for null-priced variants", () => {
      const variant = {
        sku: "CAM-PRE-M",
        salePriceCents: null,
      };

      // Initial parent product price
      let productSalePriceCents = 10000;
      let effective = calculateEffectivePrice(variant.salePriceCents, productSalePriceCents);
      expect(effective).toBe(10000);

      // Parent product price changes to 12500
      productSalePriceCents = 12500;
      effective = calculateEffectivePrice(variant.salePriceCents, productSalePriceCents);
      expect(effective).toBe(12500);
    });

    it("does not alter variant's own price when parent price changes", () => {
      const variant = {
        sku: "CAM-PRE-G",
        salePriceCents: 14000,
      };

      let productSalePriceCents = 10000;
      let effective = calculateEffectivePrice(variant.salePriceCents, productSalePriceCents);
      expect(effective).toBe(14000);

      // Parent product price changes to 12500
      productSalePriceCents = 12500;
      effective = calculateEffectivePrice(variant.salePriceCents, productSalePriceCents);
      expect(effective).toBe(14000);
    });
  });

  describe("LEGACY_PRODUCT_WITHOUT_VARIANTS_PRESERVED", () => {
    it("legacy product functions normally without variants", async () => {
      const legacy = {
        id: 99,
        public_id: "legacy-prod-99",
        name: "Produto Legado",
        sku: "LEGACY-001",
        barcode: null,
        description: "Produto criado antes de P1-A3",
        category: "Geral",
        category_id: null,
        brand_id: null,
        unit: "unit",
        cost_price_cents: 500,
        sale_price_cents: 1000,
        minimum_stock: "1.000",
        active: 1,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      };

      erpRepo.findProduct.mockResolvedValue(legacy);

      const product = await service.getProduct(adminA, legacy.public_id);
      expect(product.sku).toBe("LEGACY-001");
      expect(product.category).toBe("Geral");
      expect(product.categoryId).toBeNull();
      expect(product.brandId).toBeNull();
      expect(product.salePriceCents).toBe(1000);
    });
  });
});
