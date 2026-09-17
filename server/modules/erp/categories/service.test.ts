import { describe, expect, it, vi, beforeEach } from "vitest";
import { CategoryService } from "./service";
import type { CategoryRow } from "./repository";

function mockCategory(overrides: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: 1,
    public_id: crypto.randomUUID(),
    client_id: "tenant-a",
    parent_id: null,
    parent_public_id: null,
    parent_name: null,
    depth: 0,
    name: "Eletrônicos",
    slug: "eletronicos",
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as CategoryRow;
}

describe("CategoryService Domain Rules", () => {
  const adminA = { clientId: "tenant-a", userId: "admin-a", role: "admin" as const };
  const adminB = { clientId: "tenant-b", userId: "admin-b", role: "admin" as const };
  let repo: any;
  let publisher: any;
  let service: CategoryService;

  beforeEach(() => {
    repo = {
      list: vi.fn(),
      find: vi.fn(),
      findById: vi.fn(),
      findRootByName: vi.fn().mockResolvedValue(null),
      findSiblingByName: vi.fn().mockResolvedValue(null),
      findBySlug: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      getChildren: vi.fn().mockResolvedValue([]),
      getDescendants: vi.fn().mockResolvedValue([]),
      moveSubtree: vi.fn().mockResolvedValue(undefined),
      countChildren: vi.fn().mockResolvedValue(0),
      countProducts: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue(true),
    };
    publisher = { publish: vi.fn() };
    service = new CategoryService(repo, publisher);
  });

  // 1. criar root
  it("1. creates root category with depth 0 and null parent", async () => {
    const root = mockCategory({ id: 10, depth: 0, parent_id: null, name: "Computadores" });
    repo.create.mockResolvedValue(root);

    const result = await service.create(adminA, { name: "Computadores", parentPublicId: null });

    expect(result.depth).toBe(0);
    expect(result.parentPublicId).toBeNull();
    expect(repo.create).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      expect.any(String),
      expect.objectContaining({ depth: 0, parentId: null, name: "Computadores" })
    );
  });

  // 2. criar depth 1
  it("2. creates subcategory with depth 1 when parent is depth 0", async () => {
    const parent = mockCategory({ id: 10, depth: 0, public_id: crypto.randomUUID(), name: "Computadores" });
    const sub = mockCategory({ id: 20, depth: 1, parent_id: 10, parent_public_id: parent.public_id, name: "Notebooks" });

    repo.find.mockResolvedValue(parent);
    repo.create.mockResolvedValue(sub);

    const result = await service.create(adminA, { name: "Notebooks", parentPublicId: parent.public_id });

    expect(result.depth).toBe(1);
    expect(repo.create).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      expect.any(String),
      expect.objectContaining({ depth: 1, parentId: 10, name: "Notebooks" })
    );
  });

  // 3. criar depth 2
  it("3. creates subcategory with depth 2 when parent is depth 1", async () => {
    const parent = mockCategory({ id: 20, depth: 1, public_id: crypto.randomUUID(), name: "Notebooks" });
    const sub = mockCategory({ id: 30, depth: 2, parent_id: 20, parent_public_id: parent.public_id, name: "Gamer" });

    repo.find.mockResolvedValue(parent);
    repo.create.mockResolvedValue(sub);

    const result = await service.create(adminA, { name: "Gamer", parentPublicId: parent.public_id });

    expect(result.depth).toBe(2);
    expect(repo.create).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      expect.any(String),
      expect.objectContaining({ depth: 2, parentId: 20, name: "Gamer" })
    );
  });

  // 4. rejeitar depth 3
  it("4. rejects subcategory when parent is depth 2 (resulting in depth 3)", async () => {
    const parent = mockCategory({ id: 30, depth: 2, public_id: crypto.randomUUID(), name: "Gamer" });
    repo.find.mockResolvedValue(parent);

    await expect(
      service.create(adminA, { name: "Acessórios", parentPublicId: parent.public_id })
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("profundidade máxima"),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  // 5. rejeitar root duplicada
  it("5. rejects duplicate root category with same normalized name in same tenant", async () => {
    const existing = mockCategory({ id: 1, name: "Hardware", parent_id: null });
    repo.findRootByName.mockResolvedValue(existing);

    await expect(
      service.create(adminA, { name: "  hardware  ", parentPublicId: null })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("categoria raiz"),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  // 6. rejeitar sibling duplicada
  it("6. rejects duplicate sibling under same parent in same tenant", async () => {
    const parent = mockCategory({ id: 10, depth: 0, public_id: crypto.randomUUID() });
    const existingSibling = mockCategory({ id: 11, parent_id: 10, name: "Monitores" });

    repo.find.mockResolvedValue(parent);
    repo.findSiblingByName.mockResolvedValue(existingSibling);

    await expect(
      service.create(adminA, { name: "Monitores", parentPublicId: parent.public_id })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("subcategoria"),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  // 7. mesmo nome permitido em tenants distintos
  it("7. allows same category name in different tenants", async () => {
    const catA = mockCategory({ id: 1, client_id: "tenant-a", name: "Serviços" });
    const catB = mockCategory({ id: 2, client_id: "tenant-b", name: "Serviços" });

    repo.findRootByName.mockResolvedValue(null);
    repo.create.mockResolvedValueOnce(catA).mockResolvedValueOnce(catB);

    const resA = await service.create(adminA, { name: "Serviços" });
    const resB = await service.create(adminB, { name: "Serviços" });

    expect(resA.name).toBe("Serviços");
    expect(resB.name).toBe("Serviços");
  });

  // 8. parent cross-tenant rejeitado
  it("8. rejects parent belonging to another tenant", async () => {
    // repo.find returns null when querying with tenant-a for a parent that exists only in tenant-b
    repo.find.mockResolvedValue(null);

    await expect(
      service.create(adminA, { name: "Sub", parentPublicId: crypto.randomUUID() })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("Categoria pai não encontrada neste tenant"),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  // 9. self-parent rejeitado
  it("9. rejects moving a category to be its own parent", async () => {
    const cat = mockCategory({ id: 1, public_id: "c8f1a234-1111-2222-3333-444455556666" });
    repo.find.mockResolvedValue(cat);

    await expect(
      service.move(adminA, cat.public_id, { parentPublicId: cat.public_id })
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("não pode ser pai de si mesma"),
    });
  });

  // 10. ciclo indireto rejeitado
  it("10. rejects moving category to one of its descendants (indirect cycle)", async () => {
    // A (depth 0) -> B (depth 1) -> C (depth 2)
    // Attempting to move A under C
    const catA = mockCategory({ id: 1, depth: 0, public_id: "cat-a-uuid" });
    const catB = mockCategory({ id: 2, parent_id: 1, depth: 1, public_id: "cat-b-uuid" });
    const catC = mockCategory({ id: 3, parent_id: 2, depth: 2, public_id: "cat-c-uuid" });

    repo.find.mockImplementation((tenantId: string, publicId: string) => {
      if (publicId === "cat-a-uuid") return Promise.resolve(catA);
      if (publicId === "cat-c-uuid") return Promise.resolve(catC);
      return Promise.resolve(null);
    });
    repo.getDescendants.mockResolvedValue([catB, catC]);

    await expect(
      service.move(adminA, "cat-a-uuid", { parentPublicId: "cat-c-uuid" })
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("próprios descendentes"),
    });
  });

  // 11. movimento válido
  it("11. moves category successfully within valid depth constraints", async () => {
    // Move B (currently child of A depth 0) to be child of X (depth 0)
    const catB = mockCategory({ id: 2, parent_id: 1, depth: 1, public_id: "cat-b-uuid", name: "B" });
    const catX = mockCategory({ id: 10, parent_id: null, depth: 0, public_id: "cat-x-uuid", name: "X" });

    repo.find.mockImplementation((tenantId: string, publicId: string) => {
      if (publicId === "cat-b-uuid") return Promise.resolve({ ...catB, depth: 1, parent_id: 10 });
      if (publicId === "cat-x-uuid") return Promise.resolve(catX);
      return Promise.resolve(null);
    });
    repo.getDescendants.mockResolvedValue([]);

    const result = await service.move(adminA, "cat-b-uuid", { parentPublicId: "cat-x-uuid" });
    expect(repo.moveSubtree).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      2,
      10,
      1,
      0,
      []
    );
    expect(result.publicId).toBe("cat-b-uuid");
  });

  // 12. movimento que faria descendente ultrapassar depth 2 rejeitado
  it("12. rejects move when a descendant would exceed depth 2", async () => {
    // Target parent is depth 1. Category has a child at relative depth +1 (so new child depth would be 1 + 1 + 1 = 3 > 2)
    const targetParent = mockCategory({ id: 99, depth: 1, public_id: "target-uuid" });
    const cat = mockCategory({ id: 10, depth: 0, public_id: "cat-uuid" });
    const child = mockCategory({ id: 11, parent_id: 10, depth: 1, public_id: "child-uuid" });

    repo.find.mockImplementation((tenantId: string, publicId: string) => {
      if (publicId === "cat-uuid") return Promise.resolve(cat);
      if (publicId === "target-uuid") return Promise.resolve(targetParent);
      return Promise.resolve(null);
    });
    repo.getDescendants.mockResolvedValue([child]);

    await expect(
      service.move(adminA, "cat-uuid", { parentPublicId: "target-uuid" })
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("profundidade máxima permitida"),
    });
    expect(repo.moveSubtree).not.toHaveBeenCalled();
  });

  // 13. depths da subárvore atualizados corretamente
  it("13. updates subtree depths atomically with correct delta", async () => {
    // Category at depth 1 moving to root (depth 0). Delta is -1.
    // Descendant was depth 2, should receive delta -1.
    const cat = mockCategory({ id: 20, parent_id: 10, depth: 1, public_id: "cat-uuid" });
    const child = mockCategory({ id: 21, parent_id: 20, depth: 2, public_id: "child-uuid" });

    let callCount = 0;
    repo.find.mockImplementation((tenantId: string, publicId: string) => {
      if (publicId === "cat-uuid") {
        callCount += 1;
        return Promise.resolve(callCount === 1 ? cat : { ...cat, depth: 0, parent_id: null });
      }
      return Promise.resolve(null);
    });
    repo.getDescendants.mockResolvedValue([child]);

    await service.move(adminA, "cat-uuid", { parentPublicId: null });

    expect(repo.moveSubtree).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      20,
      null,
      0, // new depth
      -1, // delta depth
      [21] // descendantIds
    );
  });

  // 14. exclusão com filhos rejeitada
  it("14. rejects category deletion if it has subcategories", async () => {
    const cat = mockCategory({ id: 5, public_id: "cat-5-uuid" });
    repo.find.mockResolvedValue(cat);
    repo.countChildren.mockResolvedValue(2);

    await expect(service.delete(adminA, "cat-5-uuid")).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("possui subcategorias"),
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  // 15. exclusão com produtos rejeitada
  it("15. rejects category deletion if it has products assigned", async () => {
    const cat = mockCategory({ id: 6, public_id: "cat-6-uuid" });
    repo.find.mockResolvedValue(cat);
    repo.countChildren.mockResolvedValue(0);
    repo.countProducts.mockResolvedValue(5);

    await expect(service.delete(adminA, "cat-6-uuid")).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("vinculada a produtos"),
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  // 16. exclusão segura funciona
  it("16. deletes safely when there are no subcategories and no products", async () => {
    const cat = mockCategory({ id: 7, public_id: "cat-7-uuid" });
    repo.find.mockResolvedValue(cat);
    repo.countChildren.mockResolvedValue(0);
    repo.countProducts.mockResolvedValue(0);
    repo.delete.mockResolvedValue(true);

    const result = await service.delete(adminA, "cat-7-uuid");

    expect(result.ok).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith("tenant-a", "cat-7-uuid");
  });

  // 17. leitura cross-tenant rejeitada/oculta
  it("17. rejects cross-tenant category access", async () => {
    repo.find.mockResolvedValue(null);

    await expect(
      service.detail(adminA, "category-of-tenant-b")
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("Categoria não encontrada neste tenant"),
    });
  });

  // Multi-branch subtree move
  it("handles multi-branch subtree move collecting all branch descendants", async () => {
    const root = mockCategory({ id: 1, depth: 0, public_id: "root-uuid" });
    const b1 = mockCategory({ id: 2, parent_id: 1, depth: 1, public_id: "b1-uuid" });
    const b2 = mockCategory({ id: 3, parent_id: 1, depth: 1, public_id: "b2-uuid" });

    const newTarget = mockCategory({ id: 99, depth: 0, public_id: "target-uuid" });

    let count = 0;
    repo.find.mockImplementation((tenantId: string, publicId: string) => {
      if (publicId === "root-uuid") {
        count += 1;
        return Promise.resolve(count === 1 ? root : { ...root, depth: 1, parent_id: 99 });
      }
      if (publicId === "target-uuid") return Promise.resolve(newTarget);
      return Promise.resolve(null);
    });
    repo.getDescendants.mockResolvedValue([b1, b2]);

    await service.move(adminA, "root-uuid", { parentPublicId: "target-uuid" });

    expect(repo.moveSubtree).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      1,
      99,
      1, // new depth
      1, // delta depth (+1)
      [2, 3] // all branches included
    );
  });

  // Move rollback on repository failure
  it("propagates failure without publishing event when moveSubtree fails", async () => {
    const cat = mockCategory({ id: 1, depth: 0, public_id: "cat-uuid" });
    repo.find.mockResolvedValue(cat);
    repo.getDescendants.mockResolvedValue([]);
    repo.moveSubtree.mockRejectedValue(new Error("DB transaction deadlock"));

    await expect(
      service.move(adminA, "cat-uuid", { parentPublicId: null })
    ).rejects.toThrow("DB transaction deadlock");

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  // Delete TOCTOU / FK failure handling
  it("converts ER_ROW_IS_REFERENCED_2 into clean CONFLICT domain error on delete race", async () => {
    const cat = mockCategory({ id: 10, public_id: "cat-race-uuid" });
    repo.find.mockResolvedValue(cat);
    repo.countChildren.mockResolvedValue(0);
    repo.countProducts.mockResolvedValue(0);
    // Simulate DB rejecting delete because another transaction inserted a product right after the check
    const fkError = new Error("Foreign key constraint fails");
    (fkError as any).code = "ER_ROW_IS_REFERENCED_2";
    repo.delete.mockRejectedValue(fkError);

    await expect(service.delete(adminA, "cat-race-uuid")).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Não é possível excluir categoria vinculada a produtos ou subcategorias"),
    });

    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
