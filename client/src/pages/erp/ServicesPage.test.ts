import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatEstimatedMinutes, formatServicePrice } from "./ServicesPage";

describe("ServicesPage UI and Helpers", () => {
  it("formats estimated minutes into human-readable strings", () => {
    expect(formatEstimatedMinutes(null)).toBe("—");
    expect(formatEstimatedMinutes(undefined)).toBe("—");
    expect(formatEstimatedMinutes(0)).toBe("—");
    expect(formatEstimatedMinutes(-5)).toBe("—");
    expect(formatEstimatedMinutes(30)).toBe("30min");
    expect(formatEstimatedMinutes(60)).toBe("1h");
    expect(formatEstimatedMinutes(90)).toBe("1h 30min");
    expect(formatEstimatedMinutes(125)).toBe("2h 5min");
  });

  it("formats service price correctly in BRL currency format", () => {
    expect(formatServicePrice(null)).toBe("R$ 0,00");
    expect(formatServicePrice(undefined)).toBe("R$ 0,00");
    expect(formatServicePrice("")).toBe("R$ 0,00");
    expect(formatServicePrice(150)).toContain("150,00");
    expect(formatServicePrice("250.50")).toContain("250,50");
    expect(formatServicePrice("1250")).toContain("1.250,00");
  });

  it("verifies ServicesPage component contains necessary data attributes and components", () => {
    const source = readFileSync("client/src/pages/erp/ServicesPage.tsx", "utf8");
    expect(source).toContain('data-testid="erp-services-page"');
    expect(source).toContain("trpc.erp.services.list.useQuery");
    expect(source).toContain("trpc.erp.services.create.useMutation");
    expect(source).toContain("trpc.erp.services.update.useMutation");
    expect(source).toContain("trpc.erp.services.toggleActive.useMutation");
    expect(source).toContain("trpc.erp.services.delete.useMutation");
    expect(source).toContain("ErpPageHeader");
    expect(source).toContain("ErpEmptyState");
    expect(source).toContain("Pagination");
  });
});
