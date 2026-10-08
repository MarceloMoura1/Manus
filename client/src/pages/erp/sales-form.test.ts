import { describe, expect, it } from "vitest";
import {
  calculateSalesFormTotals,
  firstSalesStockIssue,
  hasDuplicateSalesItemIdentity,
  isSalesProductOptionDisabled,
  salesDraftFromForm,
  salesFormFromDetail,
  selectSalesItemProduct,
  splitInstallments,
  salesStockIssue,
  type SalesFormItem,
} from "./sales-form";

const productPublicId = "10000000-0000-4000-8000-000000000001";
const inventoryItemPublicId = "20000000-0000-4000-8000-000000000001";

describe("sales form inventory identity", () => {
  it("includes inventoryItemPublicId in a new sale command", () => {
    const command = salesDraftFromForm({
      crmClientId: "customer-1",
      notes: "",
      expectedDate: "",
      items: [
        {
          productPublicId,
          inventoryItemPublicId,
          quantity: "1.000",
          unitPriceCents: 1_000,
        },
      ],
    });

    expect(command.items[0].inventoryItemPublicId).toBe(
      inventoryItemPublicId
    );
  });

  it("preserves inventoryItemPublicId from detail through edit and save", () => {
    const form = salesFormFromDetail({
      publicId: "30000000-0000-4000-8000-000000000001",
      crmClientId: "customer-1",
      notes: null,
      expectedDate: null,
      items: [
        {
          productPublicId,
          inventoryItemPublicId,
          quantity: "2.000",
          unitPriceCents: 1_500,
        },
      ],
    });

    expect(form.items[0].inventoryItemPublicId).toBe(inventoryItemPublicId);
    expect(salesDraftFromForm(form).items[0].inventoryItemPublicId).toBe(
      inventoryItemPublicId
    );
  });

  it("accepts distinct variations of one product and rejects duplicate identities", () => {
    const first: SalesFormItem = {
      productPublicId,
      inventoryItemPublicId,
      quantity: "1.000",
      unitPriceCents: 1_000,
    };
    const second = {
      ...first,
      inventoryItemPublicId: "20000000-0000-4000-8000-000000000002",
    };

    expect(hasDuplicateSalesItemIdentity([first, second])).toBe(false);
    expect(hasDuplicateSalesItemIdentity([first, { ...first }])).toBe(true);
  });

  it("clears an old variation identity when the product changes", () => {
    const changed = selectSalesItemProduct(
      {
        productPublicId,
        inventoryItemPublicId,
        quantity: "1.000",
        unitPriceCents: 1_000,
      },
      "10000000-0000-4000-8000-000000000002"
    );

    expect(changed.inventoryItemPublicId).toBeUndefined();
  });

  it("does not disable distinct saved variations of the same product", () => {
    const items: SalesFormItem[] = [
      {
        productPublicId,
        inventoryItemPublicId,
        quantity: "1.000",
        unitPriceCents: 1_000,
      },
      {
        productPublicId,
        inventoryItemPublicId: "20000000-0000-4000-8000-000000000002",
        quantity: "1.000",
        unitPriceCents: 1_000,
      },
    ];

    expect(isSalesProductOptionDisabled(items, 0, productPublicId)).toBe(false);
  });

  it("validates the selected variation against its own available balance", () => {
    const size39: SalesFormItem = {
      productPublicId,
      inventoryItemPublicId,
      productName: "Tênis X / 39",
      availableQuantity: "5.000",
      quantity: "6.000",
      unitPriceCents: 10_000,
    };
    const size40: SalesFormItem = {
      ...size39,
      inventoryItemPublicId: "20000000-0000-4000-8000-000000000040",
      productName: "Tênis X / 40",
      availableQuantity: "8.000",
      quantity: "8.000",
    };

    expect(salesStockIssue(size39)).toEqual({
      productName: "Tênis X / 39",
      availableQuantity: "5.000",
      requestedQuantity: "6.000",
    });
    expect(salesStockIssue(size40)).toBeNull();
    expect(firstSalesStockIssue([size40, size39])?.productName).toBe("Tênis X / 39");
  });

  it("does not invent a stock block for historical items without a current balance", () => {
    expect(
      salesStockIssue({
        productPublicId,
        quantity: "1.000",
        unitPriceCents: 100,
        availableQuantity: null,
      })
    ).toBeNull();
  });

  it("calculates discounts and freight from real form values", () => {
    expect(
      calculateSalesFormTotals({
        crmClientId: "customer-1",
        notes: "",
        expectedDate: "",
        orderDiscountCents: 200,
        freightCents: 80,
        items: [
          {
            productPublicId,
            inventoryItemPublicId,
            quantity: "2.000",
            unitPriceCents: 1_200,
            discountCents: 100,
          },
        ],
      })
    ).toEqual({
      subtotalCents: 2_400,
      itemDiscountCents: 100,
      discountCents: 300,
      totalCents: 2_180,
    });
  });

  it("splits installments with an exact cent total and monthly due dates", () => {
    const installments = splitInstallments(1_000, 3, "2026-10-05");
    expect(installments).toEqual([
      { dueDate: "2026-10-05", amountCents: 334 },
      { dueDate: "2026-11-05", amountCents: 333 },
      { dueDate: "2026-12-05", amountCents: 333 },
    ]);
    expect(installments.reduce((sum, item) => sum + item.amountCents, 0)).toBe(1_000);
  });
});
