import { describe, expect, it } from "vitest";
import { buildSalesPath, readSalesRoute } from "./sales-navigation";

describe("sales route", () => {
  it("recognizes list and direct detail URLs without selecting a default sale", () => {
    expect(readSalesRoute("/erp/vendas")).toEqual({
      matches: true,
      salePublicId: null,
    });
    expect(readSalesRoute("/erp/vendas/")).toEqual({
      matches: true,
      salePublicId: null,
    });
    expect(readSalesRoute("/erp/vendas/sale-42")).toEqual({
      matches: true,
      salePublicId: "sale-42",
    });
  });

  it("rejects unrelated and malformed nested routes", () => {
    expect(readSalesRoute("/erp/vendas/sale-42/extra").matches).toBe(false);
    expect(readSalesRoute("/erp/compras").matches).toBe(false);
  });

  it("preserves list search state while entering and leaving a detail", () => {
    expect(buildSalesPath("sale-42", "?page=3&pageSize=50")).toBe(
      "/erp/vendas/sale-42?page=3&pageSize=50"
    );
    expect(buildSalesPath(undefined, "?page=3&pageSize=50")).toBe(
      "/erp/vendas?page=3&pageSize=50"
    );
  });

  it("removes the legacy selected-sale query parameter when navigating", () => {
    expect(
      buildSalesPath(undefined, "?salePublicId=legacy-sale&page=2")
    ).toBe("/erp/vendas?page=2");
    expect(buildSalesPath("sale-42", "?salePublicId=legacy-sale")).toBe(
      "/erp/vendas/sale-42"
    );
  });
});
