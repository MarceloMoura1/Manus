import { describe, expect, it } from "vitest";
import {
  canTransitionSale,
  canWriteSales,
  lineTotalCents,
  normalizeSaleDraft,
  saleDraftInput,
  saleEvent,
} from "./contracts";
describe("sale contracts", () => {
  it("rounds half-up without floats", () => {
    expect(lineTotalCents("1.005", 101)).toBe(102);
    expect(lineTotalCents("0.001", 499)).toBe(0);
    expect(lineTotalCents("0.001", 500)).toBe(1);
  });
  it("normalizes quantities", () => {
    const v = saleDraftInput.parse({
      crmClientId: crypto.randomUUID(),
      items: [
        {
          productPublicId: crypto.randomUUID(),
          quantity: "2.5",
          unitPriceCents: 123,
        },
      ],
    });
    expect(normalizeSaleDraft(v).items[0].quantity).toBe("2.500");
  });
  it("rejects duplicates", () => {
    const id = crypto.randomUUID();
    expect(() =>
      saleDraftInput.parse({
        crmClientId: crypto.randomUUID(),
        items: [
          { productPublicId: id, quantity: "1", unitPriceCents: 1 },
          { productPublicId: id, quantity: "2", unitPriceCents: 1 },
        ],
      })
    ).toThrow("Produto duplicado");
  });
  it("enforces transitions", () => {
    expect(canTransitionSale("draft", "confirmed")).toBe(true);
    expect(canTransitionSale("confirmed", "fulfilled")).toBe(true);
    expect(canTransitionSale("fulfilled", "cancelled")).toBe(false);
  });
  it("restricts writes and events", () => {
    expect(canWriteSales("manager")).toBe(true);
    expect(canWriteSales("viewer")).toBe(false);
    expect(Object.keys(saleEvent(crypto.randomUUID(), "fulfilled"))).toEqual(
      ["publicId", "operation", "occurredAt"]
    );
  });
});
