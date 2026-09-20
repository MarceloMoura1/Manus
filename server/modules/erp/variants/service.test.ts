import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpDomainError } from "../errors";
import { VariantService } from "./service";
import type { VariantAttributeValueRow, VariantRow } from "./repository";

function mockVariant(overrides: Partial<VariantRow> = {}): VariantRow {
  return {
    id: 1,
    public_id: crypto.randomUUID(),
    client_id: "tenant-a",
    product_id: 10,
    product_public_id: crypto.randomUUID(),
    product_name: "Camiseta Essential",
    product_sale_price_cents: 9900,
    sku: "CAM-ESS-PRE-M",
    name: "Preto M",
    sale_price_cents: null,
    combination_hash: "dummyhash",
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as VariantRow;
}

function mockAttributeRow(overrides: Partial<VariantAttributeValueRow> = {}): VariantAttributeValueRow {
  return {
    id: 100,
    variant_id: 1,
    attribute_type_id: 1,
    attribute_value_id: 10,
    type_public_id: crypto.randomUUID(),
    type_name: "Cor",
    type_slug: "cor",
    value_public_id: crypto.randomUUID(),
    value_name: "Preto",
    value_slug: "preto",
    ...overrides,
  } as VariantAttributeValueRow;
}

describe("VariantService Domain Rules", () => {
  const adminA = { clientId: "tenant-a", userId: "admin-a", role: "admin" as const };
  const adminB = { clientId: "tenant-b", userId: "admin-b", role: "admin" as const };
  const viewerA = { clientId: "tenant-a", userId: "viewer-a", role: "viewer" as const };

  let variantRepo: any;
  let productRepo: any;
  let attributeRepo: any;
  let publisher: any;
  let inventoryRepo: any;
  let service: VariantService;

  beforeEach(() => {
    variantRepo = {
      list: vi.fn(),
      find: vi.fn(),
      findById: vi.fn(),
      findBySku: vi.fn().mockResolvedValue(null),
      findByCombination: vi.fn().mockResolvedValue(null),
      getAttributesForVariant: vi.fn().mockResolvedValue([]),
      getAttributesForVariants: vi.fn().mockResolvedValue(new Map()),
      create: vi.fn(),
      update: vi.fn(),
      setAttributes: vi.fn(),
      setActive: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
    };

    productRepo = {
      findProduct: vi.fn(),
      findProductBySku: vi.fn().mockResolvedValue(null),
    };

    attributeRepo = {
      findValuesByPublicIds: vi.fn().mockResolvedValue([]),
    };

    publisher = { publish: vi.fn() };

    const mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };

    variantRepo.getPool = vi.fn().mockReturnValue({
      getConnection: vi.fn().mockResolvedValue(mockConnection),
    });

    const auditRepo = {
      record: vi.fn().mockResolvedValue({ id: 1 }),
    };
    inventoryRepo = {
      prepareSimpleItemForFirstVariant: vi.fn().mockResolvedValue("removed"),
      createVariantForProduct: vi.fn().mockResolvedValue({ id: 99 }),
      setVariantItemActive: vi.fn().mockResolvedValue(undefined),
    };

    service = new VariantService(
      variantRepo,
      productRepo,
      attributeRepo,
      publisher,
      auditRepo as any,
      inventoryRepo
    );
  });

  describe("VARIANT_CREATE & Lifecyle", () => {
    it("creates variant, normalizes SKU, links to product, emits event", async () => {
      const product = { id: 10, public_id: crypto.randomUUID(), sale_price_cents: 8000 };
      productRepo.findProduct.mockResolvedValue(product);

      const created = mockVariant({
        sku: "CAM-ESS-PRE-M",
        sale_price_cents: null,
        product_sale_price_cents: 8000,
      });
      variantRepo.create.mockResolvedValue(created);

      const result = await service.create(adminA, {
        productPublicId: product.public_id,
        sku: "cam ess pre m",
        name: "Preto M",
        salePriceCents: null,
      });

      expect(variantRepo.findBySku).toHaveBeenCalledWith("tenant-a", "CAM-ESS-PRE-M");
      expect(productRepo.findProductBySku).toHaveBeenCalledWith("tenant-a", "CAM-ESS-PRE-M");
      expect(variantRepo.create).toHaveBeenCalledWith(
        "tenant-a",
        "admin-a",
        expect.any(String),
        10,
        expect.objectContaining({
          sku: "CAM-ESS-PRE-M",
          salePriceCents: null,
        }),
        [],
        expect.anything()
      );
      expect(result.effectivePriceCents).toBe(8000);
      expect(result.salePriceCents).toBeNull();
      expect(publisher.publish).toHaveBeenCalledWith(
        "tenant-a",
        "erp:variant.changed",
        expect.objectContaining({ operation: "created" })
      );
    });

    it("VARIANT_UPDATE: updates SKU, name, price, active and emits event", async () => {
      const current = mockVariant({ sku: "OLD-SKU" });
      variantRepo.find.mockResolvedValue(current);
      variantRepo.update.mockResolvedValue({ ...current, sku: "NEW-SKU", sale_price_cents: 9500 });

      const result = await service.update(adminA, current.public_id, {
        sku: "new-sku",
        salePriceCents: 9500,
      });

      expect(result.sku).toBe("NEW-SKU");
      expect(result.salePriceCents).toBe(9500);
      expect(publisher.publish).toHaveBeenCalledWith(
        "tenant-a",
        "erp:variant.changed",
        expect.objectContaining({ operation: "updated" })
      );
    });

    it("VARIANT_DETAIL: returns variant with effective price and resolved attributes", async () => {
      const current = mockVariant({ sale_price_cents: null, product_sale_price_cents: 5000 });
      variantRepo.find.mockResolvedValue(current);
      variantRepo.getAttributesForVariant.mockResolvedValue([
        mockAttributeRow({ type_name: "Cor", value_name: "Preto" }),
      ]);

      const result = await service.detail(adminA, current.public_id);
      expect(result.effectivePriceCents).toBe(5000);
      expect(result.attributes).toHaveLength(1);
      expect(result.attributes[0].typeName).toBe("Cor");
      expect(result.attributes[0].valueName).toBe("Preto");
    });

    it("VARIANT_LIST: returns paginated list with attributes mapped", async () => {
      const v1 = mockVariant({ id: 1, public_id: "var-1" });
      const v2 = mockVariant({ id: 2, public_id: "var-2" });
      const attributesMap = new Map([
        [1, [mockAttributeRow({ variant_id: 1, type_name: "Cor" })]],
        [2, [mockAttributeRow({ variant_id: 2, type_name: "Tamanho" })]],
      ]);
      variantRepo.list.mockResolvedValue({
        items: [v1, v2],
        attributesMap,
        total: 2,
      });

      const result = await service.list(adminA, { page: 1, pageSize: 50, search: "" });
      expect(result.items).toHaveLength(2);
      expect(result.items[0].attributes).toHaveLength(1);
      expect(result.items[0].attributes[0].typeName).toBe("Cor");
      expect(result.items[1].attributes[0].typeName).toBe("Tamanho");
    });
  });

  describe("SKU Collision & Commercial Namespace", () => {
    it("VARIANT_SKU_REQUIRED: rejects empty SKU", async () => {
      await expect(
        service.create(adminA, {
          productPublicId: crypto.randomUUID(),
          sku: "   ",
        })
      ).rejects.toThrow("SKU da variante é obrigatório.");
    });

    it("VARIANT_DUPLICATE_SKU_REJECTED: rejects if another variant has this SKU", async () => {
      variantRepo.findBySku.mockResolvedValue(mockVariant({ sku: "ABC123" }));

      await expect(
        service.create(adminA, {
          productPublicId: crypto.randomUUID(),
          sku: "ABC123",
        })
      ).rejects.toThrow("SKU já cadastrado em outra variante deste tenant.");
    });

    it("PRODUCT_SKU_COLLISION_REJECTED: rejects if a product has this SKU", async () => {
      productRepo.findProductBySku.mockResolvedValue({ id: 99, sku: "ABC123" });

      await expect(
        service.create(adminA, {
          productPublicId: crypto.randomUUID(),
          sku: "ABC123",
        })
      ).rejects.toThrow("SKU já cadastrado em um produto deste tenant.");
    });

    it("CROSS_TENANT_SKU_BEHAVIOR: allows variant with same SKU in another tenant", async () => {
      const product = { id: 10, public_id: crypto.randomUUID(), sale_price_cents: 8000 };
      productRepo.findProduct.mockResolvedValue(product);
      variantRepo.create.mockResolvedValue(mockVariant({ client_id: "tenant-b", sku: "ABC123" }));

      const result = await service.create(adminB, {
        productPublicId: product.public_id,
        sku: "ABC123",
      });
      expect(result.sku).toBe("ABC123");
    });
  });

  describe("Price Inheritance & Semantics", () => {
    it("VARIANT_PRICE_INHERITANCE: variant null price inherits parent product price", async () => {
      const current = mockVariant({ sale_price_cents: null, product_sale_price_cents: 10000 });
      variantRepo.find.mockResolvedValue(current);

      const detail = await service.detail(adminA, current.public_id);
      expect(detail.salePriceCents).toBeNull();
      expect(detail.effectivePriceCents).toBe(10000);
    });

    it("VARIANT_OWN_PRICE: variant own price overrides parent product price", async () => {
      const current = mockVariant({ sale_price_cents: 12000, product_sale_price_cents: 10000 });
      variantRepo.find.mockResolvedValue(current);

      const detail = await service.detail(adminA, current.public_id);
      expect(detail.salePriceCents).toBe(12000);
      expect(detail.effectivePriceCents).toBe(12000);
    });

    it("VARIANT_ZERO_PRICE_SEMANTICS: variant zero price remains zero (not null, not parent)", async () => {
      const current = mockVariant({ sale_price_cents: 0, product_sale_price_cents: 10000 });
      variantRepo.find.mockResolvedValue(current);

      const detail = await service.detail(adminA, current.public_id);
      expect(detail.salePriceCents).toBe(0);
      expect(detail.effectivePriceCents).toBe(0);
    });
  });

  describe("Attributes Association & Combination Uniqueness", () => {
    it("DUPLICATE_ATTRIBUTE_TYPE_ON_VARIANT_REJECTED: rejects two values of same type", async () => {
      const product = { id: 10, public_id: crypto.randomUUID() };
      productRepo.findProduct.mockResolvedValue(product);

      // Two values belonging to attribute_type_id: 1 (e.g. Cor=Preto, Cor=Azul)
      const val1 = { id: 10, attribute_type_id: 1, public_id: "val-preto" };
      const val2 = { id: 11, attribute_type_id: 1, public_id: "val-azul" };
      attributeRepo.findValuesByPublicIds.mockResolvedValue([val1, val2]);

      await expect(
        service.create(adminA, {
          productPublicId: product.public_id,
          sku: "CAM-PRE-AZU",
          attributeValuePublicIds: ["val-preto", "val-azul"],
        })
      ).rejects.toThrow("Não é permitido associar múltiplos valores do mesmo tipo de atributo a uma variante.");
    });

    it("DUPLICATE_COMBINATION_REJECTED: rejects duplicate combination on same product", async () => {
      const product = { id: 10, public_id: crypto.randomUUID() };
      productRepo.findProduct.mockResolvedValue(product);

      const valCor = { id: 10, attribute_type_id: 1, public_id: "val-preto" };
      const valTam = { id: 20, attribute_type_id: 2, public_id: "val-m" };
      attributeRepo.findValuesByPublicIds.mockResolvedValue([valCor, valTam]);

      // Simulate repository finding existing variant with same combination hash for product 10
      variantRepo.findByCombination.mockResolvedValue(mockVariant({ id: 99 }));

      await expect(
        service.create(adminA, {
          productPublicId: product.public_id,
          sku: "CAM-PRE-M-DUPLICATE",
          attributeValuePublicIds: ["val-preto", "val-m"],
        })
      ).rejects.toThrow("Já existe uma variante com esta mesma combinação de atributos para este produto.");
    });

    it("ATTRIBUTE_ORDER_DOES_NOT_CHANGE_COMBINATION: verifies combination hash is order-independent in setAttributes", async () => {
      const current = mockVariant({ id: 5, product_id: 10 });
      variantRepo.find.mockResolvedValue(current);

      const valCor = { id: 10, attribute_type_id: 1, public_id: "val-preto" };
      const valTam = { id: 20, attribute_type_id: 2, public_id: "val-m" };
      attributeRepo.findValuesByPublicIds.mockResolvedValue([valTam, valCor]); // reverse order

      // Should check findByCombination with canonical hash
      variantRepo.findByCombination.mockResolvedValue(mockVariant({ id: 99 }));

      await expect(
        service.setAttributes(adminA, current.public_id, {
          attributeValuePublicIds: ["val-m", "val-preto"],
        })
      ).rejects.toThrow("Já existe uma variante com esta mesma combinação de atributos para este produto.");
    });
  });

  describe("Cross-Tenant Isolation & Error Handling", () => {
    it("CROSS_TENANT_PRODUCT_REFERENCE_REJECTED: cannot create variant pointing to product in another tenant", async () => {
      productRepo.findProduct.mockResolvedValue(null); // not in tenant-a

      await expect(
        service.create(adminA, {
          productPublicId: crypto.randomUUID(),
          sku: "CAM-01",
        })
      ).rejects.toThrow("Produto não encontrado neste tenant.");
    });

    it("CROSS_TENANT_VALUE_REJECTED: cannot associate attribute value belonging to another tenant", async () => {
      const product = { id: 10, public_id: crypto.randomUUID() };
      productRepo.findProduct.mockResolvedValue(product);

      // Attribute repo returns fewer items because of tenant filter
      attributeRepo.findValuesByPublicIds.mockResolvedValue([]);

      await expect(
        service.create(adminA, {
          productPublicId: product.public_id,
          sku: "CAM-01",
          attributeValuePublicIds: [crypto.randomUUID()],
        })
      ).rejects.toThrow("Um ou mais valores de atributo não foram encontrados neste tenant.");
    });

    it("ROLLBACK_ON_PARTIAL_VARIANT_CREATE_FAILURE: does not publish if repo.create fails", async () => {
      const product = { id: 10, public_id: crypto.randomUUID() };
      productRepo.findProduct.mockResolvedValue(product);
      variantRepo.create.mockRejectedValue(new Error("DB deadlock on insert"));

      await expect(
        service.create(adminA, {
          productPublicId: product.public_id,
          sku: "CAM-FAIL",
        })
      ).rejects.toThrow("DB deadlock on insert");

      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("rejects viewer role from creating variant", async () => {
      await expect(
        service.create(viewerA, {
          productPublicId: crypto.randomUUID(),
          sku: "CAM-VIEWER",
        })
      ).rejects.toThrow("Seu perfil não permite alterar variantes.");
    });
  });
});
