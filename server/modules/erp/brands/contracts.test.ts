import { describe, expect, it } from "vitest";
import {
  brandInput,
  brandListInput,
  brandUpdateInput,
  normalizeBrandName,
  normalizeSlug,
} from "./contracts";

describe("ERP Brand Contracts", () => {
  it("normalizes brand name by trimming and collapsing spaces", () => {
    expect(normalizeBrandName("  Dell   Technologies  ")).toBe("Dell Technologies");
  });

  it("normalizes brand slug", () => {
    expect(normalizeSlug("LG Eletrônicos")).toBe("lg-eletronicos");
  });

  it("validates valid brand input", () => {
    const parsed = brandInput.safeParse({
      name: "Samsung",
      active: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects too short brand name", () => {
    const parsed = brandInput.safeParse({
      name: "S",
    });
    expect(parsed.success).toBe(false);
  });

  it("validates brand list input defaults", () => {
    const parsed = brandListInput.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.search).toBe("");
  });
});
