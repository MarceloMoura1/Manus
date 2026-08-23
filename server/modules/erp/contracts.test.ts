import { describe, expect, it } from "vitest";
import { canWriteErp, millisQuantity, normalizeBarcode, normalizeQuantity, normalizeSku, productInput, quantityMillis, stockMovementInput } from "./contracts";
import { isRetryableStockError, projectStockBalance } from "./service";

describe("ERP product and stock contracts", () => {
  it("normalizes SKU deterministically", () => expect(normalizeSku("  abc  123 ")).toBe("ABC-123"));
  it("normalizes an empty barcode to null", () => expect(normalizeBarcode("  ")).toBeNull());
  it("normalizes barcode separators", () => expect(normalizeBarcode(" 789. 123-4 ")).toBe("7891234"));
  it("normalizes quantities to three decimal places", () => expect(normalizeQuantity("12.5")).toBe("12.500"));
  it("converts decimal quantities without floating point", () => expect(quantityMillis("123.456")).toBe(123456n));
  it("converts millis back to a canonical quantity", () => expect(millisQuantity(123456n)).toBe("123.456"));
  it("supports a negative internal projection", () => expect(millisQuantity(-1250n)).toBe("-1.250"));
  it.each(["unit", "kg", "liter", "meter"])("accepts controlled unit %s", unit => expect(productInput.safeParse({ name:"Produto",sku:"P-1",unit,costPriceCents:0,salePriceCents:0,minimumStock:"0" }).success).toBe(true));
  it("rejects negative monetary values", () => expect(productInput.safeParse({ name:"Produto",sku:"P-1",unit:"unit",costPriceCents:-1,salePriceCents:0,minimumStock:"0" }).success).toBe(false));
  it("rejects negative minimum stock", () => expect(productInput.safeParse({ name:"Produto",sku:"P-1",unit:"unit",costPriceCents:0,salePriceCents:0,minimumStock:"-1" }).success).toBe(false));
  it("rejects more than three quantity decimals", () => expect(stockMovementInput.safeParse({ productPublicId:crypto.randomUUID(),type:"manual_in",quantity:"1.0001",reason:"Ajuste manual",idempotencyKey:crypto.randomUUID() }).success).toBe(false));
  it("requires a reason", () => expect(stockMovementInput.safeParse({ productPublicId:crypto.randomUUID(),type:"manual_in",quantity:"1",reason:"x",idempotencyKey:crypto.randomUUID() }).success).toBe(false));
  it("requires opaque idempotency keys", () => expect(stockMovementInput.safeParse({ productPublicId:crypto.randomUUID(),type:"manual_in",quantity:"1",reason:"Entrada manual",idempotencyKey:"customer@example.com" }).success).toBe(false));
  it.each(["admin", "manager"] as const)("allows %s to write", role => expect(canWriteErp(role)).toBe(true));
  it.each(["agent", "viewer"] as const)("keeps %s read-only", role => expect(canWriteErp(role)).toBe(false));
  it("projects stock entries exactly", () => expect(projectStockBalance("1.125", "2.250", "in")).toBe("3.375"));
  it("projects stock outputs exactly", () => expect(projectStockBalance("3.375", "2.250", "out")).toBe("1.125"));
  it("blocks negative stock", () => expect(() => projectStockBalance("1.000", "1.001", "out")).toThrow("Estoque insuficiente"));
  it.each(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"])("retries transient database error %s", code => expect(isRetryableStockError({ code })).toBe(true));
  it.each(["ER_DUP_ENTRY", "ER_NO_REFERENCED_ROW", "ECONNRESET"])("does not retry permanent error %s", code => expect(isRetryableStockError({ code })).toBe(false));
});
