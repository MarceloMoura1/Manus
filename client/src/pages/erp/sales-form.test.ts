import { describe, expect, it } from "vitest";
import {
  blankSalesForm,
  calculateSalesFormTotals,
  firstSalesStockIssue,
  hasDuplicateSalesItemIdentity,
  isSalesItemService,
  isSalesProductOptionDisabled,
  salesDraftFromForm,
  salesCommercialDate,
  salesFormFromDetail,
  salesStockIssues,
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
      ...blankSalesForm(),
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

  it("omits an absent legacy seller while preserving an explicit reassignment", () => {
    const form = salesFormFromDetail({
      publicId: "30000000-0000-4000-8000-000000000001",
      documentType: "sale",
      crmClientId: "customer-1",
      sellerUserId: null,
      notes: null,
      expectedDate: null,
      items: [{ productPublicId, quantity: "1.000", unitPriceCents: 1_000 }],
    });

    expect(salesDraftFromForm(form).sellerUserId).toBeUndefined();
    expect(
      salesDraftFromForm({ ...form, sellerUserId: "seller-explicit" }).sellerUserId
    ).toBe("seller-explicit");
  });

  it("keeps an ISO commercial date on the same calendar day in a negative timezone", () => {
    const commercialDate = salesCommercialDate("2026-10-05");
    const brazilianDate = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(commercialDate);

    expect(brazilianDate).toBe("05/10/2026");
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
    expect(salesStockIssues([
      size39,
      { ...size39, productName: "Tênis X / 41", availableQuantity: "1.000", quantity: "3.000" },
      size40,
    ])).toEqual([
      {
        productName: "Tênis X / 39",
        availableQuantity: "5.000",
        requestedQuantity: "6.000",
      },
      {
        productName: "Tênis X / 41",
        availableQuantity: "1.000",
        requestedQuantity: "3.000",
      },
    ]);
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
        ...blankSalesForm(),
        crmClientId: "customer-1",
        notes: "",
        expectedDate: "",
        orderDiscountCents: 200,
        freightCents: 80,
        chargesCents: 40,
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
      partsSubtotalCents: 2_400,
      servicesSubtotalCents: 0,
      itemDiscountCents: 100,
      discountCents: 300,
      chargesCents: 40,
      totalCents: 2_220,
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

  it("identifies services by itemType, sku, variantName or unit and bypasses stock checks", () => {
    const serviceByType: SalesFormItem = {
      productPublicId: "10000000-0000-4000-8000-000000000099",
      inventoryItemPublicId: "20000000-0000-4000-8000-000000000099",
      productName: "Mão de obra mecânica",
      quantity: "2.000",
      availableQuantity: "0.000",
      unitPriceCents: 5_000,
      itemType: "service",
    };
    const serviceBySku: SalesFormItem = {
      productPublicId: "10000000-0000-4000-8000-000000000098",
      sku: "SRV-12",
      productName: "Alinhamento",
      quantity: "1.000",
      availableQuantity: "0.000",
      unitPriceCents: 8_000,
    };
    const serviceByUnit: SalesFormItem = {
      productPublicId: "10000000-0000-4000-8000-000000000097",
      unit: "serviço",
      productName: "Balanceamento",
      quantity: "4.000",
      availableQuantity: "0.000",
      unitPriceCents: 2_500,
    };

    expect(isSalesItemService(serviceByType)).toBe(true);
    expect(isSalesItemService(serviceBySku)).toBe(true);
    expect(isSalesItemService(serviceByUnit)).toBe(true);
    expect(salesStockIssue(serviceByType)).toBeNull();
    expect(salesStockIssue(serviceBySku)).toBeNull();
    expect(salesStockIssue(serviceByUnit)).toBeNull();
  });

  it("calculates combined products and services subtotals and discounts correctly", () => {
    const productItem: SalesFormItem = {
      productPublicId,
      inventoryItemPublicId,
      productName: "Pastilha de Freio",
      quantity: "2.000",
      unitPriceCents: 15_000,
      discountCents: 2_000,
      itemType: "product",
    };
    const serviceItem: SalesFormItem = {
      productPublicId: "10000000-0000-4000-8000-000000000099",
      inventoryItemPublicId: "20000000-0000-4000-8000-000000000099",
      productName: "Troca de Pastilhas",
      quantity: "1.000",
      unitPriceCents: 8_000,
      discountCents: 1_000,
      itemType: "service",
    };

    const totals = calculateSalesFormTotals({
      ...blankSalesForm("quote"),
      crmClientId: "customer-1",
      orderDiscountCents: 500,
      freightCents: 1_500,
      chargesCents: 0,
      items: [productItem, serviceItem],
    });

    // product subtotal: 2 * 15000 = 30000
    // service subtotal: 1 * 8000 = 8000
    // total subtotal: 38000
    // item discounts: 2000 + 1000 = 3000
    // order discount: 500 -> total discount = 3500
    // freight: 1500
    // total: 38000 - 3500 + 1500 = 36000
    expect(totals).toEqual({
      subtotalCents: 38_000,
      partsSubtotalCents: 30_000,
      servicesSubtotalCents: 8_000,
      itemDiscountCents: 3_000,
      discountCents: 3_500,
      chargesCents: 0,
      totalCents: 36_000,
    });
  });

  it("preserves service identity and attributes when converting detail to form", () => {
    const form = salesFormFromDetail({
      publicId: "30000000-0000-4000-8000-000000000001",
      documentType: "quote",
      crmClientId: "customer-1",
      items: [
        {
          productPublicId: "10000000-0000-4000-8000-000000000099",
          inventoryItemPublicId: "20000000-0000-4000-8000-000000000099",
          productName: "Instalação de Acessórios",
          variantName: "Serviço · Mecânica",
          sku: "SRV-50",
          unit: "serviço",
          quantity: "1.000",
          unitPriceCents: 10_000,
          discountCents: 0,
        },
      ],
    });

    expect(form.items[0].itemType).toBe("service");
    expect(form.items[0].unit).toBe("serviço");
    expect(isSalesItemService(form.items[0])).toBe(true);
  });
});
