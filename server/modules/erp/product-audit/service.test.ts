import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpDomainError } from "../errors";
import { ProductAuditService } from "./service";
import type { ProductAuditRow } from "./repository";

function mockAuditRow(overrides: Partial<ProductAuditRow> = {}): ProductAuditRow {
  return {
    id: 1,
    public_id: "audit-uuid-1",
    client_id: "tenant-a",
    product_id: 10,
    product_public_id: "prod-uuid-1",
    entity_type: "product",
    entity_public_id: "prod-uuid-1",
    action: "product_created",
    actor_user_id: "user-1",
    actor_name_snapshot: "Admin User",
    actor_role: "admin",
    summary: "Produto criado com sucesso",
    changes_json: { name: { before: null, after: "Camiseta" } },
    metadata_json: { sku: "CAM-01" },
    created_at: new Date().toISOString(),
    ...overrides,
  } as ProductAuditRow;
}

describe("ProductAuditService Domain Rules & Tenant Isolation", () => {
  const adminA = { clientId: "tenant-a", userId: "admin-a", role: "admin" as const };
  const adminB = { clientId: "tenant-b", userId: "admin-b", role: "admin" as const };

  let auditRepo: any;
  let erpRepo: any;
  let service: ProductAuditService;

  beforeEach(() => {
    auditRepo = {
      list: vi.fn(),
      find: vi.fn(),
    };

    erpRepo = {
      findProduct: vi.fn(),
    };

    service = new ProductAuditService(auditRepo, erpRepo);
  });

  describe("list", () => {
    it("returns paginated audit logs for a valid product", async () => {
      erpRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
      const row = mockAuditRow();
      auditRepo.list.mockResolvedValue({ items: [row], total: 1 });

      const result = await service.list(adminA, {
        productPublicId: "prod-uuid-1",
        page: 1,
        pageSize: 20,
      });

      expect(erpRepo.findProduct).toHaveBeenCalledWith("tenant-a", "prod-uuid-1");
      expect(auditRepo.list).toHaveBeenCalledWith("tenant-a", 10, {
        productPublicId: "prod-uuid-1",
        page: 1,
        pageSize: 20,
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      const item = result.items[0];

      // Verify no BigInt or internal IDs exposed
      expect(item.publicId).toBe("audit-uuid-1");
      expect(item.productPublicId).toBe("prod-uuid-1");
      expect(item.entityType).toBe("product");
      expect(item.action).toBe("product_created");
      expect(item.actor.userId).toBe("user-1");
      expect(item.actor.name).toBe("Admin User");
      expect(item.actor.role).toBe("admin");
      expect(item.summary).toBe("Produto criado com sucesso");
      expect(item.changes).toEqual({ name: { before: null, after: "Camiseta" } });
      expect(item.metadata).toEqual({ sku: "CAM-01" });

      expect(item).not.toHaveProperty("id");
      expect(item).not.toHaveProperty("productId");
      expect(item).not.toHaveProperty("product_id");
      expect(item).not.toHaveProperty("client_id");
    });

    it("throws NOT_FOUND if product does not exist in the tenant", async () => {
      erpRepo.findProduct.mockResolvedValue(null);

      await expect(
        service.list(adminA, { productPublicId: "nonexistent" })
      ).rejects.toThrow(ErpDomainError);

      expect(auditRepo.list).not.toHaveBeenCalled();
    });

    it("enforces tenant isolation: tenant B cannot read tenant A audit logs", async () => {
      // product exists only in tenant A; searching with tenant B credentials returns null
      erpRepo.findProduct.mockImplementation((clientId: string, publicId: string) => {
        if (clientId === "tenant-a" && publicId === "prod-uuid-1") {
          return Promise.resolve({ id: 10, public_id: "prod-uuid-1" });
        }
        return Promise.resolve(null);
      });

      await expect(
        service.list(adminB, { productPublicId: "prod-uuid-1" })
      ).rejects.toThrow(ErpDomainError);

      expect(auditRepo.list).not.toHaveBeenCalled();
    });
  });

  describe("detail", () => {
    it("returns detail for a specific audit entry", async () => {
      erpRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
      const row = mockAuditRow();
      auditRepo.find.mockResolvedValue(row);

      const result = await service.detail(adminA, {
        productPublicId: "prod-uuid-1",
        auditPublicId: "audit-uuid-1",
      });

      expect(erpRepo.findProduct).toHaveBeenCalledWith("tenant-a", "prod-uuid-1");
      expect(auditRepo.find).toHaveBeenCalledWith("tenant-a", 10, "audit-uuid-1");
      expect(result.publicId).toBe("audit-uuid-1");
      expect(result).not.toHaveProperty("id");
      expect(result).not.toHaveProperty("productId");
    });

    it("throws NOT_FOUND if audit entry does not exist", async () => {
      erpRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
      auditRepo.find.mockResolvedValue(null);

      await expect(
        service.detail(adminA, {
          productPublicId: "prod-uuid-1",
          auditPublicId: "nonexistent-audit",
        })
      ).rejects.toThrow(ErpDomainError);
    });

    it("throws NOT_FOUND if product does not belong to tenant", async () => {
      erpRepo.findProduct.mockResolvedValue(null);

      await expect(
        service.detail(adminA, {
          productPublicId: "prod-uuid-from-another-tenant",
          auditPublicId: "audit-uuid-1",
        })
      ).rejects.toThrow(ErpDomainError);

      expect(auditRepo.find).not.toHaveBeenCalled();
    });

    it("resolves human name when actor_name_snapshot is a UUID technical id", async () => {
      erpRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
      const row = mockAuditRow({
        actor_name_snapshot: "user-2fbdc1cd-fc40-4ba2-87ff-b59fa3b0c735",
        user_name: "Marcelo Moura",
      });
      auditRepo.find.mockResolvedValue(row);

      const result = await service.detail(adminA, {
        productPublicId: "prod-uuid-1",
        auditPublicId: "audit-uuid-1",
      });

      expect(result.actor.name).toBe("Marcelo Moura");
    });

    it("falls back to 'Usuário não disponível' when actor is a technical id and user is deleted", async () => {
      erpRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
      const row = mockAuditRow({
        actor_name_snapshot: "user-2fbdc1cd-fc40-4ba2-87ff-b59fa3b0c735",
        user_name: null,
      });
      auditRepo.find.mockResolvedValue(row);

      const result = await service.detail(adminA, {
        productPublicId: "prod-uuid-1",
        auditPublicId: "audit-uuid-1",
      });

      expect(result.actor.name).toBe("Usuário não disponível");
    });
  });
});
