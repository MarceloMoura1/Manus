import { describe, expect, it } from "vitest";
import {
  activeSalesFilterCount,
  canRunSalesLookup,
  salesAddressesMatch,
  salesConfirmationRequirements,
  salesDraftProgress,
} from "./sales-ux";

const address = {
  recipientName: "Ana",
  postalCode: "01001-000",
  street: "Praça da Sé",
  number: "1",
  complement: "",
  district: "Sé",
  city: "São Paulo",
  state: "SP",
};

describe("sales UX state", () => {
  it("does not query the entire customer or product catalog before intent", () => {
    expect(canRunSalesLookup("")).toBe(false);
    expect(canRunSalesLookup("a")).toBe(false);
    expect(canRunSalesLookup(" al ")).toBe(true);
  });

  it("keeps one address by default and detects an explicit billing exception", () => {
    expect(salesAddressesMatch(address, { ...address })).toBe(true);
    expect(salesAddressesMatch(address, { ...address, number: "2" })).toBe(false);
  });

  it("reports draft progress from real form data", () => {
    expect(
      salesDraftProgress({
        crmClientId: "crm-1",
        notes: "",
        expectedDate: "",
        shippingAddress: address,
        billingAddress: address,
        items: [
          {
            productPublicId: "product-1",
            quantity: "1.000",
            unitPriceCents: 100,
          },
        ],
      }).every(item => item.complete)
    ).toBe(true);
  });

  it("keeps confirmation blocked until category and expected account are resolved", () => {
    const requirements = salesConfirmationRequirements({
      hasCustomer: true,
      hasProducts: true,
      hasAddress: true,
      paymentMethod: "PIX",
      categoryPublicId: "",
      financialAccountPublicId: "",
      installmentCount: 1,
      firstDueDate: "2026-10-06",
    });
    expect(requirements.filter(item => !item.complete).map(item => item.key)).toEqual([
      "category",
      "account",
    ]);
  });

  it("counts visible and advanced filters consistently", () => {
    expect(
      activeSalesFilterCount({
        search: "Alfa",
        stage: "confirmed",
        paymentStatus: "all",
        paymentMethod: "PIX",
        sellerUserId: "all",
        customerId: "crm-1",
        from: "2026-10-01",
        to: "2026-10-31",
        defaultFrom: "2026-10-01",
        defaultTo: "2026-10-31",
      })
    ).toBe(4);
  });
});
