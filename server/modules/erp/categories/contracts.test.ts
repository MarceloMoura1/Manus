import { describe, expect, it } from "vitest";
import {
  categoryInput,
  categoryMoveInput,
  categoryUpdateInput,
  normalizeCategoryName,
  normalizeSlug,
} from "./contracts";

describe("ERP Category Contracts", () => {
  it("normalizes category name by trimming and collapsing multiple spaces", () => {
    expect(normalizeCategoryName("  Eletrônicos   e   Acessórios  ")).toBe(
      "Eletrônicos e Acessórios"
    );
  });

  it("normalizes slug correctly removing accents and non-alphanumeric chars", () => {
    expect(normalizeSlug("Informática & Automação")).toBe("informatica-automacao");
    expect(normalizeSlug("Áudio & Vídeo Premium")).toBe("audio-video-premium");
  });

  it("validates valid root category input", () => {
    const parsed = categoryInput.safeParse({
      name: "Hardware",
      parentPublicId: null,
      active: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("validates valid subcategory input with parentPublicId", () => {
    const parsed = categoryInput.safeParse({
      name: "Periféricos",
      parentPublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      active: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid UUID in parentPublicId", () => {
    const parsed = categoryInput.safeParse({
      name: "Periféricos",
      parentPublicId: "not-a-uuid",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects too short category name", () => {
    const parsed = categoryInput.safeParse({
      name: "A",
    });
    expect(parsed.success).toBe(false);
  });

  it("validates move input", () => {
    expect(
      categoryMoveInput.safeParse({
        parentPublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      }).success
    ).toBe(true);
    expect(
      categoryMoveInput.safeParse({
        parentPublicId: null,
      }).success
    ).toBe(true);
  });
});
