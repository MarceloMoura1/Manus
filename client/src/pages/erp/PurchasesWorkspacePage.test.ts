import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { safeDate } from "./PurchasesWorkspacePage";
import {
  consumePurchaseOpenIntent,
  queuePurchaseOpenIntent,
} from "./purchase-navigation";

const source = readFileSync(
  "client/src/pages/erp/PurchasesWorkspacePage.tsx",
  "utf8"
);

describe("canonical purchases workspace", () => {
  it("formats both mysql strings and SuperJSON Date values without throwing", () => {
    expect(safeDate("2026-10-02")).toMatch(/2026/);
    expect(safeDate(new Date("2026-10-02T12:00:00.000Z"))).toMatch(/2026/);
    expect(safeDate(null)).toBe("Sem prazo");
    expect(safeDate("invalid")).toBe("Data indisponível");
  });

  it("uses the supplier-scoped canonical relationship in both creation flows", () => {
    expect(source.match(/trpc\.erp\.productSuppliers\.list\.useQuery/g)).toHaveLength(2);
    expect(source).toContain("supplierPublicId: supplier || undefined");
    expect(source).toContain("Nenhum produto cadastrado para este fornecedor.");
    expect(source).not.toContain("trpc.erp.products.list.useQuery");
  });

  it("opens the canonical detail and permits editing only for drafts", () => {
    expect(source).toContain("consumePurchaseOpenIntent(window.sessionStorage)");
    expect(source).toContain('order?.status === "draft" && order.capabilities?.canEditOrder');
    expect(source).toContain("trpc.erp.purchases.update.useMutation");
    expect(source).toContain("Editar pedido");
    expect(source).toContain("order?.installments ?? []");
    expect(source).toContain("Parcela planejada");
  });

  it("transfers a supplier-history order exactly once", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };
    queuePurchaseOpenIntent(storage, "order-123");
    expect(consumePurchaseOpenIntent(storage)).toBe("order-123");
    expect(consumePurchaseOpenIntent(storage)).toBeNull();
  });
});
