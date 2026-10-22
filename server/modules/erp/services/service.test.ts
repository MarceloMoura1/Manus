import { describe, expect, it, vi } from "vitest";
import { ErpDomainError } from "../errors";
import {
  parseCurrency,
  parseCost,
  serviceInput,
  serviceUpdateInput,
  type ServiceItem,
} from "./contracts";
import { ServiceService } from "./service";
import type { ServiceRepository } from "./repository";

describe("ERP Services Module", () => {
  describe("Contracts & Validation", () => {
    it("validates parseCurrency properly", () => {
      expect(parseCurrency(150)).toBe("150.00");
      expect(parseCurrency("150")).toBe("150.00");
      expect(parseCurrency("150.50")).toBe("150.50");
      expect(parseCurrency("1.250,50")).toBe("1250.50");
      expect(parseCurrency("150,00")).toBe("150.00");
      expect(() => parseCurrency(-10)).toThrow("Preço deve ser maior ou igual a zero");
      expect(() => parseCurrency("abc")).toThrow("Preço deve ser maior ou igual a zero");
      expect(() => parseCurrency("")).toThrow("Preço é obrigatório");
    });

    it("validates parseCost properly", () => {
      expect(parseCost(undefined)).toBe("0.00");
      expect(parseCost(null)).toBe("0.00");
      expect(parseCost("")).toBe("0.00");
      expect(parseCost(50)).toBe("50.00");
      expect(parseCost("45,50")).toBe("45.50");
      expect(parseCost("50.25")).toBe("50.25");
      expect(parseCost(-10)).toBe("0.00");
    });

    it("parses valid service input", () => {
      const parsed = serviceInput.parse({
        name: "Troca de óleo sintético",
        code: "SRV-001",
        category: "Mecânica",
        price: "150,00",
        estimatedCost: "50,00",
        estimatedMinutes: 45,
        description: "Inclui filtro e óleo 5W30",
      });

      expect(parsed.name).toBe("Troca de óleo sintético");
      expect(parsed.code).toBe("SRV-001");
      expect(parsed.category).toBe("Mecânica");
      expect(parsed.price).toBe("150.00");
      expect(parsed.estimatedCost).toBe("50.00");
      expect(parsed.estimatedMinutes).toBe(45);
      expect(parsed.isActive).toBe(true);
    });

    it("rejects service input without name", () => {
      expect(() =>
        serviceInput.parse({
          name: "",
          price: "100.00",
        })
      ).toThrow();
    });

    it("parses serviceUpdateInput with partial fields", () => {
      const parsed = serviceUpdateInput.parse({
        id: 1,
        name: "Novo Nome",
        price: 200,
      });

      expect(parsed.id).toBe(1);
      expect(parsed.name).toBe("Novo Nome");
      expect(parsed.price).toBe("200.00");
    });
  });

  describe("ServiceService Business Logic", () => {
    const mockServiceItem: ServiceItem = {
      id: 1,
      clientId: "tenant-a",
      name: "Alinhamento 3D",
      code: "AL-01",
      category: "Geometria",
      price: "120.00",
      estimatedCost: "20.00",
      estimatedMinutes: 60,
      description: "Alinhamento computadorizado",
      isActive: true,
      createdAt: "2026-10-21T00:00:00.000Z",
      updatedAt: "2026-10-21T00:00:00.000Z",
    };

    const createMockRepo = () =>
      ({
        list: vi.fn().mockResolvedValue({
          items: [mockServiceItem],
          total: 1,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        }),
        getById: vi.fn().mockImplementation((clientId, id) => {
          if (clientId === "tenant-a" && id === 1) return Promise.resolve(mockServiceItem);
          return Promise.resolve(null);
        }),
        create: vi.fn().mockImplementation((clientId, input) =>
          Promise.resolve({
            ...mockServiceItem,
            ...input,
            clientId,
            id: 2,
          })
        ),
        update: vi.fn().mockImplementation((clientId, id, input) => {
          if (clientId === "tenant-a" && id === 1) {
            return Promise.resolve({ ...mockServiceItem, ...input });
          }
          return Promise.resolve(null);
        }),
        toggleActive: vi.fn().mockImplementation((clientId, id) => {
          if (clientId === "tenant-a" && id === 1) {
            return Promise.resolve({ ...mockServiceItem, isActive: false });
          }
          return Promise.resolve(null);
        }),
        delete: vi.fn().mockImplementation((clientId, id) => {
          if (clientId === "tenant-a" && id === 1) return Promise.resolve(true);
          return Promise.resolve(false);
        }),
        listCategories: vi.fn().mockResolvedValue(["Geometria", "Mecânica"]),
      }) as unknown as ServiceRepository;

    it("enforces multi-tenancy on list", async () => {
      const repo = createMockRepo();
      const service = new ServiceService(repo);

      const result = await service.list(
        { clientId: "tenant-a", userId: "user-1", role: "admin" },
        { page: 1, pageSize: 50 }
      );

      expect(repo.list).toHaveBeenCalledWith("tenant-a", { page: 1, pageSize: 50 });
      expect(result.items).toHaveLength(1);
    });

    it("throws NOT_FOUND when querying a service from another tenant", async () => {
      const repo = createMockRepo();
      const service = new ServiceService(repo);

      await expect(
        service.getById({ clientId: "tenant-b", userId: "user-1", role: "admin" }, 1)
      ).rejects.toThrow("Serviço não encontrado.");
    });

    it("blocks non-admin/manager roles from creating services", async () => {
      const repo = createMockRepo();
      const service = new ServiceService(repo);

      await expect(
        service.create(
          { clientId: "tenant-a", userId: "user-1", role: "viewer" },
          { name: "Teste", price: "50.00" }
        )
      ).rejects.toThrow(ErpDomainError);

      await expect(
        service.create(
          { clientId: "tenant-a", userId: "user-1", role: "agent" },
          { name: "Teste", price: "50.00" }
        )
      ).rejects.toThrow("Usuário sem permissão para gerenciar serviços.");
    });

    it("allows manager to create service with tenant binding", async () => {
      const repo = createMockRepo();
      const service = new ServiceService(repo);

      const created = await service.create(
        { clientId: "tenant-a", userId: "user-1", role: "manager" },
        { name: "Balanceamento", price: "80.00" }
      );

      expect(repo.create).toHaveBeenCalledWith("tenant-a", {
        name: "Balanceamento",
        price: "80.00",
      });
      expect(created.id).toBe(2);
    });

    it("allows admin to toggle active status", async () => {
      const repo = createMockRepo();
      const service = new ServiceService(repo);

      const updated = await service.toggleActive(
        { clientId: "tenant-a", userId: "user-1", role: "admin" },
        1
      );

      expect(repo.toggleActive).toHaveBeenCalledWith("tenant-a", 1);
      expect(updated.isActive).toBe(false);
    });

    it("allows admin to delete service", async () => {
      const repo = createMockRepo();
      const service = new ServiceService(repo);

      const res = await service.delete(
        { clientId: "tenant-a", userId: "user-1", role: "admin" },
        1
      );

      expect(repo.delete).toHaveBeenCalledWith("tenant-a", 1);
      expect(res.success).toBe(true);
    });

    it("resolves service for sale with product and inventory item references", async () => {
      const repo = createMockRepo();
      (repo as any).resolveForSale = vi.fn().mockResolvedValue({
        serviceId: 1,
        productPublicId: "prod-uuid-1",
        inventoryItemPublicId: "inv-uuid-1",
        name: "Alinhamento 3D",
        sku: "SRV-001",
        unit: "serviço",
        priceCents: 12000,
        isService: true,
      });
      const service = new ServiceService(repo);

      const resolved = await service.resolveForSale(
        { clientId: "tenant-a", userId: "user-1", role: "agent" },
        1
      );

      expect((repo as any).resolveForSale).toHaveBeenCalledWith("tenant-a", "user-1", 1);
      expect(resolved.productPublicId).toBe("prod-uuid-1");
      expect(resolved.unit).toBe("serviço");
      expect(resolved.isService).toBe(true);
    });
  });
});
