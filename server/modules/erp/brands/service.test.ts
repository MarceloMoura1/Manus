import { describe, expect, it, vi, beforeEach } from "vitest";
import { BrandService } from "./service";
import type { BrandRow } from "./repository";

function mockBrand(overrides: Partial<BrandRow> = {}): BrandRow {
  return {
    id: 1,
    public_id: crypto.randomUUID(),
    client_id: "tenant-a",
    name: "Apple",
    slug: "apple",
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as BrandRow;
}

describe("BrandService Domain Rules", () => {
  const adminA = { clientId: "tenant-a", userId: "admin-a", role: "admin" as const };
  const adminB = { clientId: "tenant-b", userId: "admin-b", role: "admin" as const };
  let repo: any;
  let publisher: any;
  let service: BrandService;

  beforeEach(() => {
    repo = {
      list: vi.fn(),
      find: vi.fn(),
      findById: vi.fn(),
      findByName: vi.fn().mockResolvedValue(null),
      findBySlug: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      countProducts: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue(true),
    };
    publisher = { publish: vi.fn() };
    service = new BrandService(repo, publisher);
  });

  // 18. criar marca
  it("18. creates brand successfully", async () => {
    const brand = mockBrand({ id: 10, name: "Logitech", slug: "logitech" });
    repo.create.mockResolvedValue(brand);

    const result = await service.create(adminA, { name: "Logitech" });

    expect(result.name).toBe("Logitech");
    expect(repo.create).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      expect.any(String),
      expect.objectContaining({ name: "Logitech", slug: "logitech" })
    );
  });

  // 19. duplicidade rejeitada
  it("19. rejects duplicate brand name within same tenant", async () => {
    repo.findByName.mockResolvedValue(mockBrand({ name: "Sony" }));

    await expect(service.create(adminA, { name: "  sony  " })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Já existe uma marca com este nome"),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  // 20. mesmo nome em tenants diferentes permitido
  it("20. allows same brand name in different tenants", async () => {
    const brandA = mockBrand({ id: 1, client_id: "tenant-a", name: "Nike" });
    const brandB = mockBrand({ id: 2, client_id: "tenant-b", name: "Nike" });

    repo.findByName.mockResolvedValue(null);
    repo.create.mockResolvedValueOnce(brandA).mockResolvedValueOnce(brandB);

    const resA = await service.create(adminA, { name: "Nike" });
    const resB = await service.create(adminB, { name: "Nike" });

    expect(resA.name).toBe("Nike");
    expect(resB.name).toBe("Nike");
  });

  // 21. leitura cross-tenant rejeitada/oculta
  it("21. rejects cross-tenant brand read", async () => {
    repo.find.mockResolvedValue(null);

    await expect(
      service.detail(adminA, "brand-of-tenant-b")
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("Marca não encontrada neste tenant"),
    });
  });

  // 22. edição cross-tenant rejeitada
  it("22. rejects cross-tenant brand update", async () => {
    repo.find.mockResolvedValue(null);

    await expect(
      service.update(adminA, "brand-of-tenant-b", { name: "Novo Nome" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("Marca não encontrada neste tenant"),
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  // 23. exclusão de marca em uso rejeitada
  it("23. rejects deletion of brand associated with products", async () => {
    const brand = mockBrand({ id: 5 });
    repo.find.mockResolvedValue(brand);
    repo.countProducts.mockResolvedValue(3);

    await expect(service.delete(adminA, brand.public_id)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("vinculada a produtos"),
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  // 24. exclusão segura funciona
  it("24. deletes brand successfully when not associated with any products", async () => {
    const brand = mockBrand({ id: 5 });
    repo.find.mockResolvedValue(brand);
    repo.countProducts.mockResolvedValue(0);
    repo.delete.mockResolvedValue(true);

    const result = await service.delete(adminA, brand.public_id);

    expect(result.ok).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith("tenant-a", brand.public_id);
  });

  // Delete TOCTOU / FK failure handling
  it("converts ER_ROW_IS_REFERENCED_2 into clean CONFLICT domain error on brand delete race", async () => {
    const brand = mockBrand({ id: 10, public_id: "brand-race-uuid" });
    repo.find.mockResolvedValue(brand);
    repo.countProducts.mockResolvedValue(0);

    const fkError = new Error("Foreign key constraint fails");
    (fkError as any).code = "ER_ROW_IS_REFERENCED_2";
    repo.delete.mockRejectedValue(fkError);

    await expect(service.delete(adminA, "brand-race-uuid")).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Não é possível excluir marca vinculada a produtos"),
    });

    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
