import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_CREATE_LIMIT, assertBatchSize, enforceAdministrativeRateLimit, normalizeDigits,
  normalizeEmail, normalizeTechnicalName, resetProvisioningGuardsForTests, runIdempotent,
  tenantProvisioningKey,
} from "./_core/provisioning-guards";

describe("tenant provisioning guards", () => {
  beforeEach(resetProvisioningGuardsForTests);

  it("normalizes natural identities deterministically", () => {
    expect(normalizeEmail("  USER@Example.COM ")).toBe("user@example.com");
    expect(normalizeDigits("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizeTechnicalName("  Empresa São João  ")).toBe("empresa-sao-joao");
    expect(tenantProvisioningKey({ company: "Empresa São João", email: "USER@example.com", cnpj: "12.345.678/0001-90" }))
      .toBe(tenantProvisioningKey({ company: "empresa sao joao", email: "user@EXAMPLE.com", cnpj: "12345678000190" }));
  });

  it("coalesces concurrent creation and retries with the same key", async () => {
    const operation = vi.fn(async () => ({ clientId: "one" }));
    const [first, second] = await Promise.all([
      runIdempotent("same-key", operation), runIdempotent("same-key", operation),
    ]);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("releases a failed key so a safe retry can run", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("created");
    await expect(runIdempotent("retry-key", operation)).rejects.toThrow("timeout");
    await expect(runIdempotent("retry-key", operation)).resolves.toBe("created");
  });

  it("enforces user batch and administrative rate limits", () => {
    expect(() => assertBatchSize(25)).not.toThrow();
    expect(() => assertBatchSize(26)).toThrow("USER_BATCH_LIMIT_EXCEEDED");
    for (let index = 0; index < ADMIN_CREATE_LIMIT; index++) enforceAdministrativeRateLimit("admin", 10_000);
    expect(() => enforceAdministrativeRateLimit("admin", 10_000)).toThrow("ADMIN_CREATE_RATE_LIMITED");
  });
});
