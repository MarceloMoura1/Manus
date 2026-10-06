import { describe, expect, it, vi } from "vitest";
import type { OperationalRole } from "../contracts";
import { SaleService } from "./service";

const draft = {
  crmClientId: "customer-1",
  notes: null,
  expectedDate: null,
  shippingAddress: null,
  billingAddress: null,
  orderDiscountCents: 0,
  freightCents: 0,
  items: [
    {
      productPublicId: "10000000-0000-4000-8000-000000000001",
      inventoryItemPublicId: "20000000-0000-4000-8000-000000000001",
      quantity: "1.000",
      unitPriceCents: 1_000,
      discountCents: 0,
    },
  ],
};

const identity = (role: OperationalRole) => ({
  clientId: "tenant-a",
  userId: `user-${role}`,
  userName: role,
  role,
});

describe("SaleService permissions", () => {
  it.each(["admin", "manager"] as const)("allows %s to create sales", async role => {
    const repository = {
      save: vi.fn().mockResolvedValue({ publicId: crypto.randomUUID() }),
    };
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const service = new SaleService(repository as never, publisher);

    await expect(service.create(identity(role), draft)).resolves.toBeTruthy();
    expect(repository.save).toHaveBeenCalledWith(
      "tenant-a",
      { userId: `user-${role}`, name: role },
      expect.objectContaining({ crmClientId: "customer-1" })
    );
  });

  it.each(["agent", "viewer"] as const)("keeps %s read-only", async role => {
    const repository = { save: vi.fn() };
    const service = new SaleService(repository as never, { publish: vi.fn() });

    await expect(service.create(identity(role), draft)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Seu perfil possui acesso somente leitura em Vendas.",
    });
    expect(repository.save).not.toHaveBeenCalled();
  });
});
