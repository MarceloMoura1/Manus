import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpService } from "../service";
import { VariantService } from "../variants/service";
import { ProductSupplierService } from "../product-suppliers/service";

describe("P1-A5 Failure Atomicity Tests across Transaction Boundaries", () => {
  const identity = {
    clientId: "tenant-atomic",
    userId: "user-123",
    userName: "Test Operator",
    role: "admin" as const,
  };

  let mockConnection: any;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    mockConnection = {
      beginTransaction: vi.fn().mockImplementation(async () => {
        callOrder.push("beginTransaction");
      }),
      commit: vi.fn().mockImplementation(async () => {
        callOrder.push("commit");
      }),
      rollback: vi.fn().mockImplementation(async () => {
        callOrder.push("rollback");
      }),
      release: vi.fn().mockImplementation(async () => {
        callOrder.push("release");
      }),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };
  });

  describe("1. Product Domain Atomicity", () => {
    let erpRepo: any;
    let auditRepo: any;
    let publisher: any;
    let erpService: ErpService;

    const sampleProductInput = {
      sku: "PROD-001",
      name: "Test Product",
      salePriceCents: 5000,
      costPriceCents: 3000,
      unit: "UN",
      minimumStock: "0.000",
    };

    beforeEach(() => {
      erpRepo = {
        getPool: vi.fn().mockReturnValue({
          getConnection: vi.fn().mockResolvedValue(mockConnection),
        }),
        findProductBySku: vi.fn().mockResolvedValue(null),
        findProduct: vi.fn(),
        createProduct: vi.fn().mockImplementation(async () => {
          callOrder.push("domainMutation");
          return {
            id: 10,
            public_id: "prod-pub-1",
            client_id: "tenant-atomic",
            sku: "PROD-001",
            name: "Test Product",
            unit: "UN",
            cost_price_cents: 3000,
            sale_price_cents: 5000,
            minimum_stock: "0.000",
            active: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }),
        updateProduct: vi.fn().mockImplementation(async () => {
          callOrder.push("domainMutation");
          return {
            id: 10,
            public_id: "prod-pub-1",
            client_id: "tenant-atomic",
            sku: "PROD-001",
            name: "Updated Product",
            unit: "UN",
            cost_price_cents: 3000,
            sale_price_cents: 6000,
            minimum_stock: "0.000",
            active: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }),
        setProductActive: vi.fn().mockImplementation(async () => {
          callOrder.push("domainMutation");
          return {
            id: 10,
            public_id: "prod-pub-1",
            client_id: "tenant-atomic",
            sku: "PROD-001",
            name: "Test Product",
            unit: "UN",
            cost_price_cents: 3000,
            sale_price_cents: 5000,
            minimum_stock: "0.000",
            active: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }),
      };

      auditRepo = {
        record: vi.fn().mockImplementation(async () => {
          callOrder.push("auditRecord");
          return { id: 100 };
        }),
      };

      publisher = {
        publish: vi.fn().mockImplementation(async () => {
          callOrder.push("websocketPublish");
        }),
      };

      const mockVariants = {
        findBySku: vi.fn().mockResolvedValue(null),
      };

      erpService = new ErpService(
        erpRepo,
        undefined,
        publisher,
        undefined,
        undefined,
        mockVariants as any,
        auditRepo
      );
    });

    it("A) domain mutation succeeds + audit succeeds -> COMMIT", async () => {
      const result = await erpService.createProduct(identity, sampleProductInput);

      expect(result.publicId).toBe("prod-pub-1");
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(erpRepo.createProduct).toHaveBeenCalled();
      expect(auditRepo.record).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.rollback).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();

      // Verify sequence: BEGIN -> DOMAIN -> AUDIT -> COMMIT -> PUBLISH -> RELEASE
      expect(callOrder).toEqual([
        "beginTransaction",
        "domainMutation",
        "auditRecord",
        "commit",
        "websocketPublish",
        "release",
      ]);
    });

    it("B) domain mutation succeeds + audit insert fails -> ROLLBACK DOMAIN", async () => {
      auditRepo.record.mockRejectedValue(new Error("Disk full or audit table constraint failure"));

      await expect(
        erpService.createProduct(identity, sampleProductInput)
      ).rejects.toThrow("Disk full or audit table constraint failure");

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(erpRepo.createProduct).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();

      expect(callOrder).toEqual([
        "beginTransaction",
        "domainMutation",
        "rollback",
        "release",
      ]);
    });

    it("B2) updateProduct: domain mutation succeeds + audit insert fails -> ROLLBACK DOMAIN", async () => {
      erpRepo.findProduct.mockResolvedValue({
        id: 10,
        public_id: "prod-pub-1",
        client_id: "tenant-atomic",
        sku: "PROD-001",
        name: "Old Product",
        unit: "UN",
        minimum_stock: "0.000",
        cost_price_cents: 3000,
        sale_price_cents: 5000,
        active: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      auditRepo.record.mockRejectedValue(new Error("Audit record failure"));

      await expect(
        erpService.updateProduct(identity, "prod-pub-1", {
          name: "Updated Product",
          sku: "PROD-001",
          unit: "UN",
          minimumStock: "0.000",
          costPriceCents: 3000,
          salePriceCents: 6000,
        })
      ).rejects.toThrow("Audit record failure");

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("C) domain mutation fails -> NO AUDIT", async () => {
      erpRepo.createProduct.mockRejectedValue(new Error("Duplicate key in domain table"));

      await expect(
        erpService.createProduct(identity, sampleProductInput)
      ).rejects.toThrow("Duplicate key in domain table");

      expect(auditRepo.record).not.toHaveBeenCalled();
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("D) audit event is NOT published via websocket before commit", async () => {
      let commitDoneBeforePublish = false;
      mockConnection.commit.mockImplementation(async () => {
        commitDoneBeforePublish = true;
      });
      publisher.publish.mockImplementation(async () => {
        expect(commitDoneBeforePublish).toBe(true);
      });

      await erpService.createProduct(identity, sampleProductInput);

      expect(commitDoneBeforePublish).toBe(true);
    });

    it("E) post-commit websocket failure -> domain & audit remain committed", async () => {
      publisher.publish.mockRejectedValue(new Error("WebSocket network down"));

      // Operation should succeed despite best-effort notification failure
      const result = await erpService.createProduct(identity, sampleProductInput);

      expect(result.publicId).toBe("prod-pub-1");
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.rollback).not.toHaveBeenCalled();
    });
  });

  describe("2. Variant Domain Atomicity", () => {
    let variantRepo: any;
    let erpRepo: any;
    let attributeRepo: any;
    let auditRepo: any;
    let publisher: any;
    let variantService: VariantService;

    beforeEach(() => {
      variantRepo = {
        getPool: vi.fn().mockReturnValue({
          getConnection: vi.fn().mockResolvedValue(mockConnection),
        }),
        findBySku: vi.fn().mockResolvedValue(null),
        findByCombination: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async () => {
          callOrder.push("variantDomainMutation");
          return {
            id: 20,
            public_id: "var-pub-1",
            client_id: "tenant-atomic",
            product_id: 10,
            product_public_id: "prod-pub-1",
            product_name: "Test Product",
            product_sale_price_cents: 5000,
            sku: "VAR-001",
            name: "Variant 1",
            sale_price_cents: 4500,
            active: 1,
            created_at: new Date().toISOString(),
          };
        }),
        find: vi.fn().mockResolvedValue({
          id: 20,
          public_id: "var-pub-1",
          client_id: "tenant-atomic",
          product_id: 10,
          product_public_id: "prod-pub-1",
          product_name: "Test Product",
          product_sale_price_cents: 5000,
          sku: "VAR-001",
          name: "Variant 1",
          sale_price_cents: 4500,
          active: 1,
        }),
        delete: vi.fn().mockImplementation(async () => {
          callOrder.push("variantDomainMutation");
          return true;
        }),
        getAttributesForVariant: vi.fn().mockResolvedValue([]),
      };

      erpRepo = {
        findProduct: vi.fn().mockResolvedValue({
          id: 10,
          public_id: "prod-pub-1",
          sale_price_cents: 5000,
        }),
        findProductBySku: vi.fn().mockResolvedValue(null),
      };

      attributeRepo = {
        findValuesByPublicIds: vi.fn().mockResolvedValue([]),
      };

      auditRepo = {
        record: vi.fn().mockImplementation(async () => {
          callOrder.push("auditRecord");
          return { id: 101 };
        }),
      };

      publisher = {
        publish: vi.fn().mockImplementation(async () => {
          callOrder.push("websocketPublish");
        }),
      };

      variantService = new VariantService(
        variantRepo,
        erpRepo,
        attributeRepo,
        publisher,
        auditRepo
      );
    });

    it("A) domain mutation succeeds + audit succeeds -> COMMIT", async () => {
      const result = await variantService.create(identity, {
        productPublicId: "prod-pub-1",
        sku: "var-001",
        name: "Variant 1",
        salePriceCents: 4500,
      });

      expect(result.publicId).toBe("var-pub-1");
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(variantRepo.create).toHaveBeenCalled();
      expect(auditRepo.record).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.rollback).not.toHaveBeenCalled();

      expect(callOrder).toEqual([
        "beginTransaction",
        "variantDomainMutation",
        "auditRecord",
        "commit",
        "websocketPublish",
        "release",
      ]);
    });

    it("B) domain mutation succeeds + audit insert fails -> ROLLBACK DOMAIN", async () => {
      auditRepo.record.mockRejectedValue(new Error("Audit failure during variant creation"));

      await expect(
        variantService.create(identity, {
          productPublicId: "prod-pub-1",
          sku: "var-001",
          name: "Variant 1",
        })
      ).rejects.toThrow("Audit failure during variant creation");

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("B2) delete variant: audit failure -> ROLLBACK DOMAIN", async () => {
      auditRepo.record.mockRejectedValue(new Error("Audit failure during variant deletion"));

      await expect(
        variantService.delete(identity, "var-pub-1")
      ).rejects.toThrow("Audit failure during variant deletion");

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("C) variant domain mutation fails -> NO AUDIT", async () => {
      variantRepo.create.mockRejectedValue(new Error("Variant DB constraint violated"));

      await expect(
        variantService.create(identity, {
          productPublicId: "prod-pub-1",
          sku: "var-001",
          name: "Variant 1",
        })
      ).rejects.toThrow("Variant DB constraint violated");

      expect(auditRepo.record).not.toHaveBeenCalled();
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });

    it("E) post-commit websocket failure -> domain & audit remain committed", async () => {
      publisher.publish.mockRejectedValue(new Error("Socket error"));

      const result = await variantService.create(identity, {
        productPublicId: "prod-pub-1",
        sku: "var-001",
        name: "Variant 1",
      });

      expect(result.publicId).toBe("var-pub-1");
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.rollback).not.toHaveBeenCalled();
    });
  });

  describe("3. Product-Supplier Domain Atomicity", () => {
    let psRepo: any;
    let erpRepo: any;
    let supplierRepo: any;
    let auditRepo: any;
    let publisher: any;
    let psService: ProductSupplierService;

    beforeEach(() => {
      psRepo = {
        getPool: vi.fn().mockReturnValue({
          getConnection: vi.fn().mockResolvedValue(mockConnection),
        }),
        findByProductAndSupplier: vi.fn().mockResolvedValue(null),
        findPreferredForProduct: vi.fn().mockResolvedValue(null),
        lockProductRow: vi.fn().mockResolvedValue(undefined),
        clearPreferredForProduct: vi.fn().mockResolvedValue(undefined),
        find: vi.fn().mockResolvedValue({
          id: 50,
          public_id: "ps-pub-1",
          client_id: "tenant-atomic",
          product_id: 10,
          product_public_id: "prod-pub-1",
          product_name: "Test Product",
          supplier_id: 30,
          supplier_public_id: "supp-pub-1",
          supplier_legal_name: "Supp Inc",
          is_preferred: 0,
          active: 1,
        }),
        create: vi.fn().mockImplementation(async () => {
          callOrder.push("supplierDomainMutation");
          return {
            id: 50,
            public_id: "ps-pub-1",
            client_id: "tenant-atomic",
            product_id: 10,
            product_public_id: "prod-pub-1",
            supplier_id: 30,
            supplier_public_id: "supp-pub-1",
            supplier_legal_name: "Supp Inc",
            supplier_product_code: "SUP-01",
            cost_price_cents: 2000,
            is_preferred: 0,
            active: 1,
            created_at: new Date().toISOString(),
          };
        }),
        setPreferred: vi.fn().mockImplementation(async () => {
          callOrder.push("supplierDomainMutation");
          return {
            id: 50,
            public_id: "ps-pub-1",
            client_id: "tenant-atomic",
            product_id: 10,
            product_public_id: "prod-pub-1",
            supplier_id: 30,
            supplier_public_id: "supp-pub-1",
            supplier_legal_name: "Supp Inc",
            is_preferred: 1,
            active: 1,
          };
        }),
        delete: vi.fn().mockImplementation(async () => {
          callOrder.push("supplierDomainMutation");
          return true;
        }),
      };

      erpRepo = {
        findProduct: vi.fn().mockResolvedValue({
          id: 10,
          public_id: "prod-pub-1",
          name: "Test Product",
        }),
      };

      supplierRepo = {
        find: vi.fn().mockResolvedValue({
          id: 30,
          public_id: "supp-pub-1",
          razao_social: "Supp Inc",
        }),
      };

      auditRepo = {
        record: vi.fn().mockImplementation(async () => {
          callOrder.push("auditRecord");
          return { id: 102 };
        }),
      };

      publisher = {
        publish: vi.fn().mockImplementation(async () => {
          callOrder.push("websocketPublish");
        }),
      };

      psService = new ProductSupplierService(
        psRepo,
        erpRepo,
        supplierRepo,
        publisher,
        auditRepo
      );
    });

    it("A) domain mutation succeeds + audit succeeds -> COMMIT", async () => {
      const result = await psService.create(identity, {
        productPublicId: "prod-pub-1",
        supplierPublicId: "supp-pub-1",
      });

      expect(result.publicId).toBe("ps-pub-1");
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(psRepo.create).toHaveBeenCalled();
      expect(auditRepo.record).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.rollback).not.toHaveBeenCalled();

      expect(callOrder).toEqual([
        "beginTransaction",
        "supplierDomainMutation",
        "auditRecord",
        "commit",
        "websocketPublish",
        "release",
      ]);
    });

    it("B) domain mutation succeeds + audit insert fails -> ROLLBACK DOMAIN", async () => {
      auditRepo.record.mockRejectedValue(new Error("Audit failure during supplier link"));

      await expect(
        psService.create(identity, {
          productPublicId: "prod-pub-1",
          supplierPublicId: "supp-pub-1",
        })
      ).rejects.toThrow("Audit failure during supplier link");

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("B2) setPreferred: audit failure -> ROLLBACK DOMAIN", async () => {
      auditRepo.record.mockRejectedValue(new Error("Audit failure during setPreferred"));

      await expect(
        psService.setPreferred(identity, "ps-pub-1", true)
      ).rejects.toThrow("Audit failure during setPreferred");

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("B3) delete supplier association: audit failure -> ROLLBACK DOMAIN", async () => {
      auditRepo.record.mockRejectedValue(new Error("Audit failure during supplier association delete"));

      await expect(
        psService.delete(identity, "ps-pub-1")
      ).rejects.toThrow("Audit failure during supplier association delete");

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("C) supplier domain mutation fails -> NO AUDIT", async () => {
      psRepo.create.mockRejectedValue(new Error("Supplier DB constraint violated"));

      await expect(
        psService.create(identity, {
          productPublicId: "prod-pub-1",
          supplierPublicId: "supp-pub-1",
        })
      ).rejects.toThrow("Supplier DB constraint violated");

      expect(auditRepo.record).not.toHaveBeenCalled();
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });

    it("E) post-commit websocket failure -> domain & audit remain committed", async () => {
      publisher.publish.mockRejectedValue(new Error("Socket error"));

      const result = await psService.create(identity, {
        productPublicId: "prod-pub-1",
        supplierPublicId: "supp-pub-1",
      });

      expect(result.publicId).toBe("ps-pub-1");
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.rollback).not.toHaveBeenCalled();
    });
  });
});
