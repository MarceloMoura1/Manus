import { describe, expect, it, vi } from "vitest";
import {
  lineTotalCents,
  purchaseCapabilities,
  purchaseDraftInput,
  purchaseRequestDraftInput,
  purchaseTotalCents,
  receiveInput,
  requestToOrderInput,
  sumMoneyCents,
} from "./domain-contracts";
import { PurchaseService } from "./service";

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("purchase workflow contracts", () => {
  it("calculates monetary totals with millesimal quantity and half-up rounding", () => {
    expect(lineTotalCents("1.005", 101)).toBe(102);
    expect(lineTotalCents("2.000", 250, 50)).toBe(450);
    expect(() => lineTotalCents("1.000", 100, 101)).toThrow(/Desconto/);
  });

  it("rejects aggregate monetary overflow even when every individual line is safe", () => {
    expect(() =>
      sumMoneyCents([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])
    ).toThrow("limite seguro");
    expect(() =>
      purchaseTotalCents(Number.MAX_SAFE_INTEGER, 0, 1, 0)
    ).toThrow("limite seguro");
  });

  it("normalizes a direct order with safe commercial defaults", () => {
    const parsed = purchaseDraftInput.parse({
      supplierPublicId: uuid(1),
      items: [{ productPublicId: uuid(2), quantity: "3.5", unitCostCents: 199 }],
    });
    expect(parsed).toMatchObject({
      discountCents: 0,
      freightCents: 0,
      otherExpensesCents: 0,
      paymentTerms: null,
      installments: [],
    });
  });

  it("rejects duplicate catalog identities in orders and request conversions", () => {
    const duplicate = {
      supplierPublicId: uuid(1),
      items: [
        { productPublicId: uuid(2), quantity: "1", unitCostCents: 100 },
        { productPublicId: uuid(2), quantity: "2", unitCostCents: 90 },
      ],
    };
    expect(purchaseDraftInput.safeParse(duplicate).success).toBe(false);
    expect(requestToOrderInput.safeParse({ ...duplicate, requestPublicId: uuid(3) }).success).toBe(false);
  });

  it("supports cataloged and descriptive request items without inventing product data", () => {
    const parsed = purchaseRequestDraftInput.parse({
      reason: "Reposicao operacional",
      items: [
        { productPublicId: uuid(4), quantity: "1" },
        { description: "Material ainda nao catalogado", unit: "cx", quantity: "2" },
      ],
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[1].productPublicId).toBeUndefined();
    expect(parsed.responsibleUserId).toBeNull();
  });

  it("normalizes omitted optional user ids before they reach SQL bindings", () => {
    const request = purchaseRequestDraftInput.parse({
      reason: "Reposicao operacional",
      items: [{ description: "Material avulso", quantity: "1" }],
    });
    const order = purchaseDraftInput.parse({
      supplierPublicId: uuid(1),
      items: [{ productPublicId: uuid(2), quantity: "1", unitCostCents: 100 }],
    });

    expect(request.responsibleUserId).toBeNull();
    expect(request.department).toBeNull();
    expect(order.responsibleUserId).toBeNull();
    expect(order.expectedDate).toBeNull();
    expect(order.notes).toBeNull();
  });

  it("requires an explicit, non-duplicated item set for partial receipt", () => {
    const base = {
      publicId: uuid(1),
      idempotencyKey: uuid(2),
      items: [{ orderItemPublicId: uuid(3), quantity: "0.500" }],
    };
    expect(receiveInput.parse(base).items[0].quantity).toBe("0.500");
    expect(receiveInput.safeParse({ ...base, items: [...base.items, ...base.items] }).success).toBe(false);
    expect(receiveInput.safeParse({ ...base, items: [{ ...base.items[0], quantity: "0" }] }).success).toBe(false);
  });

  it("keeps role capabilities least-privileged", () => {
    expect(purchaseCapabilities("viewer")).toMatchObject({ canView: true, canCreateRequest: false, canApprove: false, canReceive: false });
    expect(purchaseCapabilities("agent")).toMatchObject({ canCreateRequest: true, canCreateOrder: false, canReceive: true, canViewValues: false });
    expect(purchaseCapabilities("manager")).toMatchObject({ canApprove: true, canCreateOrder: true, canCancel: true });
  });
});

describe("purchase financial visibility", () => {
  it("redacts values and audit payloads for agents at the service boundary", async () => {
    const order = {
      publicId: uuid(90),
      totalCents: 12_345,
      subtotalCents: 12_000,
      financeTotalCents: 12_345,
      paidCents: 345,
      pendingCents: 12_000,
      financialProgress: 3,
      financialStatus: "partially_paid",
      items: [{ unitCostCents: 12_000, discountCents: 0, lineTotalCents: 12_000 }],
      payments: [{ amountCents: 12_345, paidCents: 345, pendingCents: 12_000 }],
      timeline: [{ summary: "Pagamento", before: { amountCents: 1 }, after: { amountCents: 2 }, metadata: { amountCents: 3 } }],
    };
    const repository: any = {
      listOrders: vi.fn(),
      orderDetail: vi.fn().mockResolvedValue(order),
    };
    const service = new PurchaseService(repository, { publish: vi.fn() });
    const visible: any = await service.detail(
      { clientId: "tenant", userId: "agent", role: "agent" },
      order.publicId
    );

    expect(visible).toMatchObject({ totalCents: null, paidCents: null, financialStatus: null });
    expect(visible.items[0].unitCostCents).toBeNull();
    expect(visible.payments[0].amountCents).toBeNull();
    expect(visible.timeline[0]).toEqual({ summary: "Pagamento" });
  });
});
