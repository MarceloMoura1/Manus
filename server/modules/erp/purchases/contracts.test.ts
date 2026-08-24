import { describe, expect, it } from "vitest";
import {
  canTransitionPurchase,
  canWritePurchases,
  lineTotalCents,
  normalizePurchaseDraft,
  purchaseDraftInput,
  purchaseEvent,
} from "./contracts";
describe("purchase contracts", () => {
  it("rounds half-up without floats", () => {
    expect(lineTotalCents("1.005", 101)).toBe(102);
    expect(lineTotalCents("0.001", 499)).toBe(0);
    expect(lineTotalCents("0.001", 500)).toBe(1);
  });
  it("normalizes quantities", () => {
    const v = purchaseDraftInput.parse({
      supplierPublicId: crypto.randomUUID(),
      items: [
        {
          productPublicId: crypto.randomUUID(),
          quantity: "2.5",
          unitCostCents: 123,
        },
      ],
    });
    expect(normalizePurchaseDraft(v).items[0].quantity).toBe("2.500");
  });
  it("rejects duplicates", () => {
    const id = crypto.randomUUID();
    expect(() =>
      purchaseDraftInput.parse({
        supplierPublicId: crypto.randomUUID(),
        items: [
          { productPublicId: id, quantity: "1", unitCostCents: 1 },
          { productPublicId: id, quantity: "2", unitCostCents: 1 },
        ],
      })
    ).toThrow("Produto duplicado");
  });
  it("enforces transitions", () => {
    expect(canTransitionPurchase("draft", "approved")).toBe(true);
    expect(canTransitionPurchase("approved", "received")).toBe(true);
    expect(canTransitionPurchase("received", "cancelled")).toBe(false);
  });
  it("restricts writes and events", () => {
    expect(canWritePurchases("manager")).toBe(true);
    expect(canWritePurchases("viewer")).toBe(false);
    expect(Object.keys(purchaseEvent(crypto.randomUUID(), "received"))).toEqual(
      ["publicId", "operation", "occurredAt"]
    );
  });
});
