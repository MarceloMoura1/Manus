import { describe, expect, it, vi } from "vitest";
import { ErpRepository } from "./repository";
import { ErpService } from "./service";

const identity = { clientId: "tenant-a", userId: "user-a", role: "admin" as const };
const product = { id: 42, public_id: "product-a", name: "Produto", sku: "P-1", active: 1 };

function setup() {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
  };
  const repository = {
    getPool: vi.fn().mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) }),
    checkProductDependencies: vi.fn().mockResolvedValue({ hasDependencies: true, salesCount: 2, stockCount: 3 }),
    findProduct: vi.fn().mockResolvedValue(product),
    purgeProduct: vi.fn().mockResolvedValue(true),
  };
  const audit = { record: vi.fn().mockResolvedValue({}) };
  const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
  const service = new ErpService(repository as never, undefined, publisher, undefined, undefined, undefined, audit as never);
  return { service, connection, repository, audit, publisher };
}

describe("purga lógica de produtos", () => {
  it("preserva histórico e registra auditoria na mesma transação", async () => {
    const { service, connection, repository, audit } = setup();
    const result = await service.deleteProduct(identity, "product-a", true, true);
    expect(result).toMatchObject({ success: true, hardDeleted: false, salesCount: 2 });
    expect(repository.findProduct).toHaveBeenCalledWith("tenant-a", "product-a", connection, true);
    expect(repository.purgeProduct).toHaveBeenCalledWith("tenant-a", "product-a", "user-a", connection);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "product_purged", clientId: "tenant-a", productId: 42 }), connection);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("reverte a alteração se a auditoria falhar", async () => {
    const { service, connection, audit, publisher } = setup();
    audit.record.mockRejectedValueOnce(new Error("falha de auditoria"));
    await expect(service.deleteProduct(identity, "product-a")).rejects.toThrow("falha de auditoria");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("não altera produto inexistente nem produto de outro tenant", async () => {
    const { service, connection, repository, audit } = setup();
    repository.findProduct.mockResolvedValueOnce(null);
    await expect(service.deleteProduct(identity, "product-a")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repository.purgeProduct).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("recusa alteração para perfil sem permissão", async () => {
    const { service, repository } = setup();
    await expect(service.deleteProduct({ ...identity, role: "viewer" }, "product-a")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.getPool).not.toHaveBeenCalled();
  });

  it("executa somente UPDATE com tenant, sem DELETE ou alteração de chaves estrangeiras", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const repository = new ErpRepository();
    expect(await repository.purgeProduct("tenant-a", "product-a", "user-a", { execute } as never)).toBe(true);
    const [sql, values] = execute.mock.calls[0];
    expect(sql).toContain("active=-1");
    expect(sql).toContain("client_id=? AND public_id=? AND active <> -1");
    expect(sql).not.toMatch(/DELETE|FOREIGN_KEY_CHECKS/i);
    expect(values).toEqual(["user-a", "tenant-a", "product-a"]);
  });

  it("filtra purgados também no filtro de inativos", async () => {
    const execute = vi.fn().mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);
    const repository = new ErpRepository({ execute } as never);
    await repository.listProducts("tenant-a", { search: "", active: false, stock: "all", sort: "name", direction: "asc", page: 1, pageSize: 10 });
    for (const [sql, values] of execute.mock.calls) {
      expect(sql).toContain("p.active <> -1");
      expect(sql).toContain("p.active = ?");
      expect(values).toEqual(["tenant-a", 0]);
    }
  });

  it("não reativa um produto purgado por alteração de status", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 0 }]);
    const repository = new ErpRepository({ execute } as never);
    expect(await repository.setProductActive("tenant-a", "product-a", "user-a", true)).toBe(false);
    expect(execute.mock.calls[0][0]).toContain("active <> -1");
    expect(execute.mock.calls[0][1]).toEqual([1, "user-a", "tenant-a", "product-a"]);
  });

  it("não retorna produto purgado pela busca de SKU", async () => {
    const { service, repository } = setup();
    const repo = repository as typeof repository & { findProductBySku: ReturnType<typeof vi.fn> };
    repo.findProductBySku = vi.fn().mockResolvedValue({ ...product, active: -1 });
    await expect(service.getProductBySku(identity, "P-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
