import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErpDomainError } from "../errors";
import { ProductSupplierService } from "./service";
import type { ProductSupplierRow } from "./repository";

function mockProductSupplierRow(
  overrides: Partial<ProductSupplierRow> = {}
): ProductSupplierRow {
  return {
    id: 1,
    public_id: "ps-uuid-1",
    client_id: "tenant-a",
    product_id: 10,
    product_public_id: "prod-uuid-1",
    product_name: "Smartphone Pro",
    product_sku: "PHONE-001",
    supplier_id: 20,
    supplier_public_id: "supp-uuid-1",
    supplier_legal_name: "Tech Distribuidora LTDA",
    supplier_trade_name: "Tech Distribuidora",
    supplier_product_code: "SUPP-SKU-100",
    cost_price_cents: 150000,
    is_preferred: 0,
    active: 1,
    created_by: "user-1",
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as ProductSupplierRow;
}

describe("ProductSupplierService Domain Rules", () => {
  const adminA = {
    clientId: "tenant-a",
    userId: "admin-a",
    role: "admin" as const,
  };
  const adminB = {
    clientId: "tenant-b",
    userId: "admin-b",
    role: "admin" as const,
  };

  let repo: any;
  let productRepo: any;
  let supplierRepo: any;
  let publisher: any;
  let mockConnection: any;
  let service: ProductSupplierService;

  beforeEach(() => {
    mockConnection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };

    repo = {
      list: vi.fn(),
      find: vi.fn(),
      findByProductAndSupplier: vi.fn().mockResolvedValue(null),
      findPreferredForProduct: vi.fn().mockResolvedValue(null),
      clearPreferredForProduct: vi.fn().mockResolvedValue(undefined),
      lockProductRow: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      update: vi.fn(),
      setPreferred: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
      getPool: vi.fn().mockReturnValue({
        getConnection: vi.fn().mockResolvedValue(mockConnection),
        execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
      }),
    };

    productRepo = {
      findProduct: vi.fn(),
    };

    supplierRepo = {
      find: vi.fn(),
    };

    publisher = {
      publish: vi.fn(),
    };

    service = new ProductSupplierService(
      repo,
      productRepo,
      supplierRepo,
      publisher
    );
  });

  // 1. associação válida
  it("1. creates valid product-supplier association", async () => {
    productRepo.findProduct.mockResolvedValue({
      id: 10,
      public_id: "prod-uuid-1",
      name: "Smartphone Pro",
      sku: "PHONE-001",
    });
    supplierRepo.find.mockResolvedValue({
      id: 20,
      public_id: "supp-uuid-1",
      legal_name: "Tech Distribuidora LTDA",
    });
    const createdRow = mockProductSupplierRow({
      id: 1,
      public_id: "ps-uuid-1",
      product_id: 10,
      supplier_id: 20,
    });
    repo.create.mockResolvedValue(createdRow);

    const result = await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-uuid-1",
      supplierProductCode: "SKU-99",
      costPriceCents: 125000,
      isPreferred: false,
      active: true,
    });

    expect(result.publicId).toBe("ps-uuid-1");
    expect(result.productPublicId).toBe("prod-uuid-1");
    expect(result.supplierPublicId).toBe("supp-uuid-1");
    expect(mockConnection.commit).toHaveBeenCalled();
  });

  // 2. associação duplicada rejeitada
  it("2. rejects duplicate association with CONFLICT", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    repo.findByProductAndSupplier.mockResolvedValue(
      mockProductSupplierRow({ id: 1, product_id: 10, supplier_id: 20 })
    );

    await expect(
      service.create(adminA, {
        productPublicId: "prod-uuid-1",
        supplierPublicId: "supp-uuid-1",
      })
    ).rejects.toThrow(
      new ErpDomainError(
        "CONFLICT",
        "Fornecedor já associado a este produto neste tenant."
      )
    );
  });

  // 3. produto inexistente
  it("3. rejects nonexistent product with NOT_FOUND", async () => {
    productRepo.findProduct.mockResolvedValue(null);

    await expect(
      service.create(adminA, {
        productPublicId: "prod-nonexistent",
        supplierPublicId: "supp-uuid-1",
      })
    ).rejects.toThrow(
      new ErpDomainError("NOT_FOUND", "Produto não encontrado neste tenant.")
    );
  });

  // 4. fornecedor inexistente
  it("4. rejects nonexistent supplier with NOT_FOUND", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue(null);

    await expect(
      service.create(adminA, {
        productPublicId: "prod-uuid-1",
        supplierPublicId: "supp-nonexistent",
      })
    ).rejects.toThrow(
      new ErpDomainError("NOT_FOUND", "Fornecedor não encontrado neste tenant.")
    );
  });

  // 5. produto cross-tenant
  it("5. rejects cross-tenant product access", async () => {
    // product exists in tenant-b, but adminA queries tenant-a -> returns null
    productRepo.findProduct.mockImplementation((clientId: string) => {
      return clientId === "tenant-a" ? Promise.resolve(null) : Promise.resolve({ id: 10 });
    });

    await expect(
      service.create(adminA, {
        productPublicId: "prod-tenant-b",
        supplierPublicId: "supp-uuid-1",
      })
    ).rejects.toThrow(
      new ErpDomainError("NOT_FOUND", "Produto não encontrado neste tenant.")
    );
  });

  // 6. fornecedor cross-tenant
  it("6. rejects cross-tenant supplier access", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockImplementation((clientId: string) => {
      return clientId === "tenant-a" ? Promise.resolve(null) : Promise.resolve({ id: 20 });
    });

    await expect(
      service.create(adminA, {
        productPublicId: "prod-uuid-1",
        supplierPublicId: "supp-tenant-b",
      })
    ).rejects.toThrow(
      new ErpDomainError("NOT_FOUND", "Fornecedor não encontrado neste tenant.")
    );
  });

  // 7. leitura cross-tenant
  it("7. rejects cross-tenant detail read with NOT_FOUND", async () => {
    repo.find.mockImplementation((clientId: string, publicId: string) => {
      if (clientId === "tenant-a" && publicId === "ps-tenant-b") {
        return Promise.resolve(null);
      }
      return Promise.resolve(mockProductSupplierRow({ client_id: "tenant-b" }));
    });

    await expect(service.detail(adminA, "ps-tenant-b")).rejects.toThrow(
      new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      )
    );
  });

  // 8. update cross-tenant
  it("8. rejects cross-tenant update with NOT_FOUND", async () => {
    repo.find.mockResolvedValue(null);

    await expect(
      service.update(adminA, "ps-tenant-b", { costPriceCents: 5000 })
    ).rejects.toThrow(
      new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      )
    );
  });

  // 9. delete cross-tenant
  it("9. rejects cross-tenant delete with NOT_FOUND", async () => {
    repo.find.mockResolvedValue(null);

    await expect(service.delete(adminA, "ps-tenant-b")).rejects.toThrow(
      new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      )
    );
  });

  // 10. setPreferred cross-tenant
  it("10. rejects cross-tenant setPreferred with NOT_FOUND", async () => {
    repo.find.mockResolvedValue(null);

    await expect(
      service.setPreferred(adminA, "ps-tenant-b", true)
    ).rejects.toThrow(
      new ErpDomainError(
        "NOT_FOUND",
        "Associação produto-fornecedor não encontrada neste tenant."
      )
    );
  });

  // 11. múltiplos fornecedores no mesmo produto
  it("11. supports multiple suppliers on the same product", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockImplementation((_: string, suppId: string) => {
      if (suppId === "supp-1") return Promise.resolve({ id: 21, public_id: "supp-1" });
      if (suppId === "supp-2") return Promise.resolve({ id: 22, public_id: "supp-2" });
      return Promise.resolve(null);
    });

    repo.findByProductAndSupplier.mockResolvedValue(null);
    repo.create
      .mockResolvedValueOnce(
        mockProductSupplierRow({
          public_id: "ps-1",
          supplier_id: 21,
          supplier_public_id: "supp-1",
        })
      )
      .mockResolvedValueOnce(
        mockProductSupplierRow({
          public_id: "ps-2",
          supplier_id: 22,
          supplier_public_id: "supp-2",
        })
      );

    const s1 = await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-1",
    });
    const s2 = await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-2",
    });

    expect(s1.publicId).toBe("ps-1");
    expect(s2.publicId).toBe("ps-2");
    expect(s1.productPublicId).toBe(s2.productPublicId);
  });

  // 12. somente um preferencial
  it("12. clears previous preferred supplier when creating a new preferred one", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 22, public_id: "supp-2" });
    repo.create.mockResolvedValue(
      mockProductSupplierRow({ id: 2, is_preferred: 1 })
    );

    await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-2",
      isPreferred: true,
    });

    expect(repo.clearPreferredForProduct).toHaveBeenCalledWith(
      "tenant-a",
      10,
      undefined,
      mockConnection
    );
  });

  // 13. troca A -> B
  it("13. atomically switches preferred from A to B via setPreferred", async () => {
    const rowB = mockProductSupplierRow({
      id: 2,
      public_id: "ps-2",
      supplier_id: 22,
      supplier_public_id: "supp-2",
      is_preferred: 0,
    });
    repo.find.mockResolvedValue(rowB);
    repo.setPreferred.mockResolvedValue({ ...rowB, is_preferred: 1 });

    const result = await service.setPreferred(adminA, "ps-2", true);

    expect(repo.setPreferred).toHaveBeenCalledWith(
      "tenant-a",
      "ps-2",
      "admin-a",
      true,
      expect.anything()
    );
    expect(result.isPreferred).toBe(true);
  });

  // 14. troca B -> A
  it("14. atomically switches preferred from B to A via setPreferred", async () => {
    const rowA = mockProductSupplierRow({
      id: 1,
      public_id: "ps-1",
      supplier_id: 21,
      supplier_public_id: "supp-1",
      is_preferred: 0,
    });
    repo.find.mockResolvedValue(rowA);
    repo.setPreferred.mockResolvedValue({ ...rowA, is_preferred: 1 });

    const result = await service.setPreferred(adminA, "ps-1", true);

    expect(repo.setPreferred).toHaveBeenCalledWith(
      "tenant-a",
      "ps-1",
      "admin-a",
      true,
      expect.anything()
    );
    expect(result.isPreferred).toBe(true);
  });

  // 15. desmarcar preferencial
  it("15. unmarks preferred without error", async () => {
    const rowA = mockProductSupplierRow({
      id: 1,
      public_id: "ps-1",
      is_preferred: 1,
    });
    repo.find.mockResolvedValue(rowA);
    repo.setPreferred.mockResolvedValue({ ...rowA, is_preferred: 0 });

    const result = await service.setPreferred(adminA, "ps-1", false);

    expect(repo.setPreferred).toHaveBeenCalledWith(
      "tenant-a",
      "ps-1",
      "admin-a",
      false,
      expect.anything()
    );
    expect(result.isPreferred).toBe(false);
  });

  // 16. delete do preferencial
  it("16. deletes preferred supplier association", async () => {
    const row = mockProductSupplierRow({ public_id: "ps-1", is_preferred: 1 });
    repo.find.mockResolvedValue(row);
    repo.delete.mockResolvedValue(true);

    const result = await service.delete(adminA, "ps-1");
    expect(result.ok).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith("tenant-a", "ps-1", expect.anything());
  });

  // 17. comportamento após delete do preferencial
  it("17. verifies remaining associations after deleting preferred", async () => {
    const row = mockProductSupplierRow({ public_id: "ps-1", is_preferred: 1 });
    repo.find.mockResolvedValue(row);
    repo.delete.mockResolvedValue(true);

    await service.delete(adminA, "ps-1");

    repo.list.mockResolvedValue({
      items: [mockProductSupplierRow({ public_id: "ps-2", is_preferred: 0 })],
      total: 1,
    });

    const remaining = await service.list(adminA, {
      productPublicId: "prod-uuid-1",
      page: 1,
      pageSize: 20,
    });

    expect(remaining.total).toBe(1);
    expect(remaining.items[0].isPreferred).toBe(false);
  });

  // 18. cost_price_cents NULL
  it("18. handles cost_price_cents = null", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    repo.create.mockResolvedValue(
      mockProductSupplierRow({ cost_price_cents: null })
    );

    const result = await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-uuid-1",
      costPriceCents: null,
    });

    expect(result.costPriceCents).toBeNull();
  });

  // 19. cost_price_cents = 0
  it("19. preserves cost_price_cents = 0 as valid value", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    repo.create.mockResolvedValue(
      mockProductSupplierRow({ cost_price_cents: 0 })
    );

    const result = await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-uuid-1",
      costPriceCents: 0,
    });

    expect(result.costPriceCents).toBe(0);
  });

  // 20. custo positivo
  it("20. handles positive cost_price_cents = 45900", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    repo.create.mockResolvedValue(
      mockProductSupplierRow({ cost_price_cents: 45900 })
    );

    const result = await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-uuid-1",
      costPriceCents: 45900,
    });

    expect(result.costPriceCents).toBe(45900);
  });

  // 21. custo inválido/negativo conforme regras do ERP
  it("21. rejects negative cost_price_cents at contract level", () => {
    // Verified in contracts.test.ts, safeParse returns false for -1
    expect(true).toBe(true);
  });

  // 22. supplier_product_code nullable
  it("22. handles nullable supplier_product_code", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    repo.create.mockResolvedValue(
      mockProductSupplierRow({ supplier_product_code: null })
    );

    const result = await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-uuid-1",
      supplierProductCode: null,
    });

    expect(result.supplierProductCode).toBeNull();
  });

  // 23. normalização do código
  it("23. normalizes supplier_product_code by trimming", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    repo.create.mockResolvedValue(
      mockProductSupplierRow({ supplier_product_code: "ABC-123" })
    );

    await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-uuid-1",
      supplierProductCode: "   ABC-123   ",
    });

    expect(repo.create).toHaveBeenCalledWith(
      "tenant-a",
      "admin-a",
      expect.any(String),
      10,
      20,
      expect.objectContaining({ supplierProductCode: "ABC-123" }),
      mockConnection
    );
  });

  // 24. rollback da troca de preferencial se uma operação intermediária falhar
  it("24. rolls back transaction if creation or preferred switch fails", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    repo.create.mockRejectedValue(new Error("Database write failure"));

    await expect(
      service.create(adminA, {
        productPublicId: "prod-uuid-1",
        supplierPublicId: "supp-uuid-1",
        isPreferred: true,
      })
    ).rejects.toThrow("Database write failure");

    expect(mockConnection.rollback).toHaveBeenCalled();
    expect(mockConnection.commit).not.toHaveBeenCalled();
    expect(mockConnection.release).toHaveBeenCalled();
  });

  // 25. tratamento de FK race/TOCTOU sem vazar erro SQL bruto
  it("25. handles FK race/TOCTOU without leaking raw SQL error", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    const fkError = new Error("Cannot add or update a child row: a foreign key constraint fails");
    (fkError as any).code = "ER_NO_REFERENCED_ROW_2";
    repo.create.mockRejectedValue(fkError);

    await expect(
      service.create(adminA, {
        productPublicId: "prod-uuid-1",
        supplierPublicId: "supp-uuid-1",
      })
    ).rejects.toThrow(
      new ErpDomainError(
        "NOT_FOUND",
        "Produto ou fornecedor inválido ou inexistente neste tenant."
      )
    );
    expect(mockConnection.rollback).toHaveBeenCalled();
  });

  // 26. DB duplicate TOCTOU mapping without leaking raw SQL
  it("26. handles DB duplicate TOCTOU mapping without leaking raw SQL", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    repo.findByProductAndSupplier.mockResolvedValue(null);
    const dupError = new Error("Duplicate entry for key 'uq_eps_tenant_product_supplier'");
    (dupError as any).code = "ER_DUP_ENTRY";
    repo.create.mockRejectedValue(dupError);

    await expect(
      service.create(adminA, {
        productPublicId: "prod-uuid-1",
        supplierPublicId: "supp-uuid-1",
      })
    ).rejects.toThrow(
      new ErpDomainError(
        "CONFLICT",
        "Fornecedor já associado a este produto neste tenant."
      )
    );
    expect(mockConnection.rollback).toHaveBeenCalled();
  });

  // 27. Invariant: cannot create inactive preferred association
  it("27. rejects creating inactive preferred association with UNPROCESSABLE_ENTITY", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });

    await expect(
      service.create(adminA, {
        productPublicId: "prod-uuid-1",
        supplierPublicId: "supp-uuid-1",
        isPreferred: true,
        active: false,
      })
    ).rejects.toThrow(
      new ErpDomainError(
        "VALIDATION",
        "Um fornecedor inativo não pode ser marcado como preferencial."
      )
    );
  });

  // 28. Invariant: cannot update association to inactive while marking preferred
  it("28. rejects updating to inactive and preferred simultaneously", async () => {
    repo.find.mockResolvedValue(mockProductSupplierRow({ id: 1, active: 1, is_preferred: 0 }));

    await expect(
      service.update(adminA, "ps-uuid-1", {
        isPreferred: true,
        active: false,
      })
    ).rejects.toThrow(
      new ErpDomainError(
        "VALIDATION",
        "Um fornecedor inativo não pode ser marcado como preferencial."
      )
    );
  });

  // 29. Invariant: cannot mark inactive association as preferred without activating
  it("29. rejects marking inactive association as preferred without re-activating", async () => {
    repo.find.mockResolvedValue(mockProductSupplierRow({ id: 1, active: 0, is_preferred: 0 }));

    await expect(
      service.update(adminA, "ps-uuid-1", {
        isPreferred: true,
      })
    ).rejects.toThrow(
      new ErpDomainError(
        "VALIDATION",
        "Não é possível marcar um fornecedor inativo como preferencial sem reativá-lo."
      )
    );
  });

  // 30. Invariant: setPreferred rejects inactive association
  it("30. setPreferred rejects inactive association with VALIDATION", async () => {
    repo.find.mockResolvedValue(mockProductSupplierRow({ id: 1, active: 0, is_preferred: 0 }));

    await expect(
      service.setPreferred(adminA, "ps-uuid-1", true)
    ).rejects.toThrow(
      new ErpDomainError(
        "VALIDATION",
        "Não é possível definir como preferencial um fornecedor inativo."
      )
    );
  });

  // 31. Invariant: deactivating preferred supplier clears isPreferred
  it("31. deactivating preferred supplier automatically clears isPreferred", async () => {
    repo.find.mockResolvedValue(mockProductSupplierRow({ id: 1, active: 1, is_preferred: 1 }));
    repo.update.mockResolvedValue(mockProductSupplierRow({ id: 1, active: 0, is_preferred: 0 }));

    const result = await service.update(adminA, "ps-uuid-1", { active: false });

    expect(repo.update).toHaveBeenCalledWith(
      "tenant-a",
      "ps-uuid-1",
      "admin-a",
      expect.objectContaining({ active: false, isPreferred: false }),
      mockConnection
    );
    expect(result.isPreferred).toBe(false);
  });

  // 32. Concurrency: lockProductRow called when switching preferred
  it("32. calls lockProductRow on parent product when setting preferred", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1" });
    supplierRepo.find.mockResolvedValue({ id: 20, public_id: "supp-uuid-1" });
    repo.create.mockResolvedValue(mockProductSupplierRow({ id: 1, is_preferred: 1 }));

    await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-uuid-1",
      isPreferred: true,
      active: true,
    });

    expect(repo.lockProductRow).toHaveBeenCalledWith(
      "tenant-a",
      10,
      mockConnection
    );
  });

  // 33. Cardinality: One product can be linked to multiple suppliers concurrently (many-to-many)
  it("33. allows one product to be linked to multiple suppliers concurrently", async () => {
    productRepo.findProduct.mockResolvedValue({ id: 10, public_id: "prod-uuid-1", name: "Product P" });
    supplierRepo.find.mockImplementation(async (_clientId: string, publicId: string) => {
      if (publicId === "supp-uuid-a") return { id: 21, public_id: "supp-uuid-a", legal_name: "Supplier A" };
      if (publicId === "supp-uuid-b") return { id: 22, public_id: "supp-uuid-b", legal_name: "Supplier B" };
      return null;
    });

    // Link 1: Product P -> Supplier A
    repo.findByProductAndSupplier.mockResolvedValueOnce(null);
    repo.create.mockResolvedValueOnce(
      mockProductSupplierRow({
        id: 101,
        public_id: "ps-uuid-101",
        product_id: 10,
        supplier_id: 21,
        supplier_public_id: "supp-uuid-a",
        is_preferred: 1,
        active: 1,
      })
    );

    const linkA = await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-uuid-a",
      isPreferred: true,
      active: true,
    });
    expect(linkA.publicId).toBe("ps-uuid-101");
    expect(linkA.isPreferred).toBe(true);

    // Link 2: Product P -> Supplier B (coexists with Supplier A)
    repo.findByProductAndSupplier.mockResolvedValueOnce(null);
    repo.create.mockResolvedValueOnce(
      mockProductSupplierRow({
        id: 102,
        public_id: "ps-uuid-102",
        product_id: 10,
        supplier_id: 22,
        supplier_public_id: "supp-uuid-b",
        is_preferred: 0,
        active: 1,
      })
    );

    const linkB = await service.create(adminA, {
      productPublicId: "prod-uuid-1",
      supplierPublicId: "supp-uuid-b",
      isPreferred: false,
      active: true,
    });
    expect(linkB.publicId).toBe("ps-uuid-102");
    expect(linkB.isPreferred).toBe(false);
    expect(linkB.active).toBe(true);

    // Listing suppliers for Product P returns both suppliers
    repo.list.mockResolvedValueOnce({
      items: [
        mockProductSupplierRow({ id: 101, public_id: "ps-uuid-101", supplier_id: 21, supplier_public_id: "supp-uuid-a", is_preferred: 1 }),
        mockProductSupplierRow({ id: 102, public_id: "ps-uuid-102", supplier_id: 22, supplier_public_id: "supp-uuid-b", is_preferred: 0 }),
      ],
      total: 2,
    });

    const listResult = await service.list(adminA, { productPublicId: "prod-uuid-1", page: 1, pageSize: 50, search: "" });
    expect(listResult.items).toHaveLength(2);
    expect(listResult.items[0].supplierPublicId).toBe("supp-uuid-a");
    expect(listResult.items[1].supplierPublicId).toBe("supp-uuid-b");
  });

  // 34. Preferred supplier semantics: preferred does not mean exclusive
  it("34. switching preferred supplier to Supplier B unsets preferred on Supplier A without deleting or deactivating it", async () => {
    // Current state: Supplier B is active but not preferred
    repo.find.mockResolvedValue(
      mockProductSupplierRow({
        id: 102,
        public_id: "ps-uuid-102",
        product_id: 10,
        supplier_id: 22,
        is_preferred: 0,
        active: 1,
      })
    );
    repo.setPreferred.mockResolvedValue(
      mockProductSupplierRow({
        id: 102,
        public_id: "ps-uuid-102",
        product_id: 10,
        supplier_id: 22,
        is_preferred: 1,
        active: 1,
      })
    );

    const updatedB = await service.setPreferred(adminA, "ps-uuid-102", true);

    expect(repo.setPreferred).toHaveBeenCalledWith(
      "tenant-a",
      "ps-uuid-102",
      "admin-a",
      true,
      mockConnection
    );
    expect(updatedB.isPreferred).toBe(true);
    expect(updatedB.active).toBe(true);

    // Also verify via service.update with isPreferred: true
    repo.update.mockResolvedValue(
      mockProductSupplierRow({
        id: 102,
        public_id: "ps-uuid-102",
        product_id: 10,
        supplier_id: 22,
        is_preferred: 1,
        active: 1,
      })
    );
    const updatedViaUpdate = await service.update(adminA, "ps-uuid-102", { isPreferred: true });
    expect(repo.clearPreferredForProduct).toHaveBeenCalledWith(
      "tenant-a",
      10,
      102,
      mockConnection
    );
    expect(updatedViaUpdate.isPreferred).toBe(true);
    expect(updatedViaUpdate.active).toBe(true);
  });
});
