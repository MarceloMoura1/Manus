import { describe, expect, it, vi } from "vitest";
import { PurchaseWorkflowRepository } from "./workflow-repository";

const listInput = (supplierPublicId: string) => ({
  search: "",
  supplierPublicId,
  sort: "createdAt" as const,
  direction: "desc" as const,
  page: 1,
  pageSize: 100,
});

describe("purchase workflow repository regressions", () => {
  it("reads the canonical supplier names instead of the removed name column", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            id: 7,
            public_id: "supplier-a",
            legal_name: "Fornecedor A Ltda",
            trade_name: "Fornecedor A",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ order_count: 0, purchased_cents: 0 }], []])
      .mockResolvedValueOnce([[{ launched_cents: 0, paid_cents: 0 }], []])
      .mockResolvedValueOnce([[], []]);
    const repository = new PurchaseWorkflowRepository({ execute } as any);

    const result = await repository.supplierMetrics("tenant-a", "supplier-a");

    expect(result.supplierName).toBe("Fornecedor A");
    expect(execute.mock.calls[0][0]).toContain(
      "SELECT id,public_id,legal_name,trade_name FROM erp_suppliers"
    );
    expect(execute.mock.calls[0][0]).not.toMatch(/\bname\b/);
    expect(execute.mock.calls[0][1]).toEqual(["tenant-a", "supplier-a"]);
  });

  it("keeps supplier draft orders in canonical history and scopes both ids", async () => {
    const execute = vi.fn(async (sql: string, values: unknown[]) => {
      const tenant = values[0];
      if (sql.includes("SELECT COUNT(*) total")) {
        return [[{ total: tenant === "tenant-a" ? 1 : 0 }], []];
      }
      if (tenant !== "tenant-a") return [[], []];
      return [
        [
          {
            public_id: "order-a",
            order_number: "PO-2026-000001",
            supplier_public_id: "supplier-a",
            supplier_name_snapshot: "Fornecedor A",
            source_type: "direct",
            status: "draft",
            notes: null,
            expected_date: null,
            responsible_user_id: null,
            responsible_name: null,
            created_by_name: "Comprador",
            subtotal_cents: 7300,
            discount_cents: 0,
            freight_cents: 0,
            other_expenses_cents: 0,
            total_cents: 7300,
            payment_terms: null,
            approved_at: null,
            received_at: null,
            cancelled_at: null,
            cancellation_reason: null,
            ordered_quantity: "1.000",
            received_quantity: "0.000",
            finance_total: 0,
            paid_cents: 0,
            has_overdue: 0,
            created_at: new Date("2026-10-02T12:00:00Z"),
            updated_at: new Date("2026-10-02T12:00:00Z"),
          },
        ],
        [],
      ];
    });
    const repository = new PurchaseWorkflowRepository({ execute } as any);

    const own = await repository.listOrders("tenant-a", listInput("supplier-a"));
    const crossTenant = await repository.listOrders(
      "tenant-b",
      listInput("supplier-a")
    );

    expect(own.items).toHaveLength(1);
    expect(own.items[0]).toMatchObject({
      publicId: "order-a",
      status: "draft",
      supplierPublicId: "supplier-a",
    });
    expect(crossTenant).toEqual({ items: [], total: 0 });
    for (const [, values] of execute.mock.calls) {
      expect(values).toEqual(
        expect.arrayContaining([expect.stringMatching(/^tenant-[ab]$/), "supplier-a"])
      );
    }
  });
});
