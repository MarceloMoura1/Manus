import { describe, expect, it } from "vitest";
import {
  attributeTypeInput,
  attributeTypeUpdateInput,
  attributeValueInput,
  attributeValueUpdateInput,
  normalizeAttributeName,
  normalizeSlug,
} from "./contracts";

describe("ERP Attributes Contracts", () => {
  it("normalizes attribute name by trimming and collapsing multiple spaces", () => {
    expect(normalizeAttributeName("  Tamanho   do   Calçado  ")).toBe(
      "Tamanho do Calçado"
    );
  });

  it("normalizes slug correctly removing accents and special chars", () => {
    expect(normalizeSlug("Cor & Estampa")).toBe("cor-estampa");
    expect(normalizeSlug("Voltagem (110V/220V)")).toBe("voltagem-110v-220v");
  });

  it("validates attribute type input", () => {
    const valid = attributeTypeInput.safeParse({
      name: "Tamanho",
      active: true,
    });
    expect(valid.success).toBe(true);
  });

  it("rejects empty attribute type name", () => {
    const invalid = attributeTypeInput.safeParse({
      name: "   ",
    });
    expect(invalid.success).toBe(false);
  });

  it("validates attribute value input with valid typePublicId", () => {
    const valid = attributeValueInput.safeParse({
      typePublicId: "a2b7b282-1d5d-4f27-a068-18e388d757d7",
      name: "Azul Marinho",
      active: true,
    });
    expect(valid.success).toBe(true);
  });

  it("rejects invalid UUID in attribute value typePublicId", () => {
    const invalid = attributeValueInput.safeParse({
      typePublicId: "invalid-uuid",
      name: "Azul Marinho",
    });
    expect(invalid.success).toBe(false);
  });

  it("validates attribute type update input", () => {
    expect(attributeTypeUpdateInput.safeParse({ name: "Novo Nome" }).success).toBe(true);
    expect(attributeTypeUpdateInput.safeParse({ active: false }).success).toBe(true);
  });

  it("validates attribute value update input", () => {
    expect(attributeValueUpdateInput.safeParse({ name: "G" }).success).toBe(true);
    expect(attributeValueUpdateInput.safeParse({ active: false }).success).toBe(true);
  });
});
