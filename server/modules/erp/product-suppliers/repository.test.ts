import { describe, expect, it, vi } from "vitest";
import { ProductSupplierRepository } from "./repository";

describe("product supplier repository listing", () => {
  it("scopes supplier products by tenant, supplier and active entities", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[{ total: 0 }], []])
      .mockResolvedValueOnce([[], []]);
    const repository = new ProductSupplierRepository({ execute } as any);

    const result = await repository.list("tenant-a", {
      supplierPublicId: "supplier-a",
      active: true,
      search: "",
      page: 1,
      pageSize: 100,
    });

    expect(result).toEqual({ items: [], total: 0 });
    for (const [sql, values] of execute.mock.calls) {
      expect(sql).toContain("ps.client_id = ?");
      expect(sql).toContain("s.public_id = ?");
      expect(sql).toContain("ps.active = ?");
      expect(sql).toContain("p.active = 1");
      expect(sql).toContain("s.active = 1");
      expect(values).toEqual(["tenant-a", "supplier-a", 1]);
    }
  });
});
