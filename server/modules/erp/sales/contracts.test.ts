import { describe, expect, it } from "vitest";
import { hasDuplicateResolvedInventoryItem } from "../contracts";
import {
  calculateSaleTotals,
  canCancelSaleAtStage,
  canWriteSales,
  derivePaymentStatus,
  isStockExitTransition,
  legacySaleStage,
  lineTotalCents,
  normalizeSaleDraft,
  saleConfirmationInput,
  saleDraftInput,
  saleEvent,
  saleListInput,
  saleTransitionKind,
} from "./contracts";

describe("sale contracts", () => {
  it("accepts an explicit customer filter without broadening the search", () => {
    expect(saleListInput.parse({ crmClientId: "crm-customer-42" })).toMatchObject({
      crmClientId: "crm-customer-42",
      kind: "all",
      search: "",
      page: 1,
      pageSize: 20,
    });
  });

  it("accepts only the supported order and quote tabs", () => {
    expect(saleListInput.parse({ kind: "quotes" }).kind).toBe("quotes");
    expect(saleListInput.parse({ kind: "orders" }).kind).toBe("orders");
    expect(() => saleListInput.parse({ kind: "archived" })).toThrow();
  });

  it("rounds quantities half-up without floating-point arithmetic", () => {
    expect(lineTotalCents("1.005", 101)).toBe(102);
    expect(lineTotalCents("0.001", 499)).toBe(0);
    expect(lineTotalCents("0.001", 500)).toBe(1);
  });

  it("calculates item discounts, order discount and freight exactly", () => {
    expect(
      calculateSaleTotals(
        [
          { quantity: "2.000", unitPriceCents: 1_200, discountCents: 100 },
          { quantity: "1.000", unitPriceCents: 500, discountCents: 0 },
        ],
        200,
        80
      )
    ).toEqual({
      subtotalCents: 2_900,
      itemDiscountCents: 100,
      orderDiscountCents: 200,
      freightCents: 80,
      totalCents: 2_680,
    });
    expect(() =>
      calculateSaleTotals([{ quantity: "1", unitPriceCents: 100, discountCents: 101 }])
    ).toThrow("desconto do item");
    expect(() =>
      calculateSaleTotals([
        { quantity: "1", unitPriceCents: Number.MAX_SAFE_INTEGER },
        { quantity: "1", unitPriceCents: 1 },
      ])
    ).toThrow("limite seguro");
  });

  it("normalizes quantities and preserves the variation identity", () => {
    const inventoryItemPublicId = crypto.randomUUID();
    const value = saleDraftInput.parse({
      crmClientId: crypto.randomUUID(),
      items: [
        {
          productPublicId: crypto.randomUUID(),
          inventoryItemPublicId,
          quantity: "2.5",
          unitPriceCents: 123,
          discountCents: 0,
        },
      ],
    });
    const normalized = normalizeSaleDraft(value);
    expect(normalized.items[0].quantity).toBe("2.500");
    expect(normalized.items[0].inventoryItemPublicId).toBe(inventoryItemPublicId);
  });

  it("rejects only a duplicate resolved stock identity", () => {
    const productPublicId = crypto.randomUUID();
    const variation = crypto.randomUUID();
    expect(() =>
      saleDraftInput.parse({
        crmClientId: crypto.randomUUID(),
        items: [
          { productPublicId, inventoryItemPublicId: variation, quantity: "1", unitPriceCents: 1 },
          { productPublicId, inventoryItemPublicId: variation, quantity: "2", unitPriceCents: 1 },
        ],
      })
    ).toThrow("Item de estoque duplicado");
    expect(hasDuplicateResolvedInventoryItem([{ inventoryItemId: 1 }, { inventoryItemId: 2 }])).toBe(false);
    expect(hasDuplicateResolvedInventoryItem([{ inventoryItemId: 1 }, { inventoryItemId: 1 }])).toBe(true);
  });

  it("requires valid installment data at the confirmation boundary", () => {
    expect(() =>
      saleConfirmationInput.parse({
        publicId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        paymentMethod: "PIX",
        categoryPublicId: crypto.randomUUID(),
        installments: [{ dueDate: "2026-10-10", amountCents: 0 }],
      })
    ).toThrow();
  });

  it("accepts an explicit real receipt and defaults legacy confirmation calls to pending", () => {
    const base = {
      publicId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      paymentMethod: "PIX",
      categoryPublicId: crypto.randomUUID(),
      financialAccountPublicId: crypto.randomUUID(),
      installments: [{ dueDate: "2026-10-10", amountCents: 1_000 }],
    };
    expect(saleConfirmationInput.parse(base).receivedCents).toBe(0);
    expect(saleConfirmationInput.parse({ ...base, receivedCents: 400 }).receivedCents).toBe(400);
    expect(() => saleConfirmationInput.parse({ ...base, receivedCents: -1 })).toThrow();
  });

  it("allows only adjacent forward stages and explicit safe corrections", () => {
    expect(saleTransitionKind("confirmed", "separation")).toBe("forward");
    expect(saleTransitionKind("separation", "shipped")).toBe("forward");
    expect(saleTransitionKind("separation", "confirmed")).toBe("correction");
    expect(saleTransitionKind("received", "shipped")).toBe("correction");
    expect(saleTransitionKind("shipped", "separation")).toBe("blocked");
    expect(saleTransitionKind("confirmed", "completed")).toBe("blocked");
  });

  it("creates stock movement only on Separation to Enviado", () => {
    expect(isStockExitTransition("separation", "shipped")).toBe(true);
    expect(isStockExitTransition("received", "completed")).toBe(false);
    expect(isStockExitTransition("shipped", "received")).toBe(false);
  });

  it("blocks cancellation after shipment and preserves legacy stage meaning", () => {
    expect(canCancelSaleAtStage("created")).toBe(true);
    expect(canCancelSaleAtStage("separation")).toBe(true);
    expect(canCancelSaleAtStage("shipped")).toBe(false);
    expect(canCancelSaleAtStage("completed")).toBe(false);
    expect(legacySaleStage("draft")).toBe("created");
    expect(legacySaleStage("confirmed")).toBe("confirmed");
    expect(legacySaleStage("fulfilled")).toBe("completed");
  });

  it("derives payment status from real received amounts", () => {
    expect(derivePaymentStatus(1_000, 0)).toBe("pending");
    expect(derivePaymentStatus(1_000, 300)).toBe("partial");
    expect(derivePaymentStatus(1_000, 1_000)).toBe("paid");
  });

  it("allows writes only for admin and manager roles", () => {
    expect(canWriteSales("admin")).toBe(true);
    expect(canWriteSales("manager")).toBe(true);
    expect(canWriteSales("agent")).toBe(false);
    expect(canWriteSales("viewer")).toBe(false);
  });

  it("keeps websocket events public and minimal", () => {
    expect(Object.keys(saleEvent(crypto.randomUUID(), "shipped"))).toEqual([
      "publicId",
      "operation",
      "occurredAt",
    ]);
  });
});
