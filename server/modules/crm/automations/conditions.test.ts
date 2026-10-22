import { describe, expect, it } from "vitest";
import {
  normalizarParaContains,
  resolveField,
  evaluateConditions,
  evaluateConditionsDetailed,
  type RuleCondition,
} from "./conditions";

describe("CRM Automations Condition Engine (Deskcomm-compatible)", () => {
  describe("normalizarParaContains", () => {
    it("strips accents, lowercases, and converts punctuation to spaces", () => {
      expect(normalizarParaContains("Olá, Mundo!")).toBe("ola mundo");
      expect(normalizarParaContains("ATENÇÃO: Orçamento #123")).toBe("atencao orcamento 123");
      expect(normalizarParaContains("  São   Paulo  ")).toBe("sao paulo");
    });

    it("handles null, undefined, and empty string gracefully", () => {
      expect(normalizarParaContains(null)).toBe("");
      expect(normalizarParaContains(undefined)).toBe("");
      expect(normalizarParaContains("")).toBe("");
    });

    it("handles numbers and objects converted to string", () => {
      expect(normalizarParaContains(12345)).toBe("12345");
    });
  });

  describe("resolveField", () => {
    const context = {
      name: "Maria Santos",
      deal: {
        value: 25000,
        stage: "proposta",
      },
      tags: ["vip", "enterprise"],
    };

    it("resolves top-level fields", () => {
      expect(resolveField(context, "name")).toBe("Maria Santos");
    });

    it("resolves nested dot-notation fields", () => {
      expect(resolveField(context, "deal.value")).toBe(25000);
      expect(resolveField(context, "deal.stage")).toBe("proposta");
    });

    it("returns undefined for non-existent paths without throwing", () => {
      expect(resolveField(context, "deal.nonexistent.deep")).toBeUndefined();
      expect(resolveField(context, "unknown")).toBeUndefined();
    });
  });

  describe("evaluateConditions", () => {
    const context = {
      message: "Gostaria de saber o preço do plano PRO!",
      origin: "meta_ads",
      score: "85",
      tags: ["lead-quente", "varejo"],
      emptyField: null,
    };

    it("returns true for empty conditions list (unconditional execution)", () => {
      expect(evaluateConditions([], context)).toBe(true);
    });

    it("evaluates 'contains' with diacritic stripping and case-insensitivity", () => {
      const conditions: RuleCondition[] = [
        { field: "message", op: "contains", value: "preco" },
      ];
      expect(evaluateConditions(conditions, context)).toBe(true);
    });

    it("evaluates 'contains' when target is an array", () => {
      const conditions: RuleCondition[] = [
        { field: "tags", op: "contains", value: "lead-quente" },
      ];
      expect(evaluateConditions(conditions, context)).toBe(true);
    });

    it("evaluates 'eq' exact string comparison", () => {
      const conditions: RuleCondition[] = [
        { field: "origin", op: "eq", value: "meta_ads" },
      ];
      expect(evaluateConditions(conditions, context)).toBe(true);

      const failing: RuleCondition[] = [
        { field: "origin", op: "eq", value: "google_ads" },
      ];
      expect(evaluateConditions(failing, context)).toBe(false);
    });

    it("evaluates 'neq' condition", () => {
      const conditions: RuleCondition[] = [
        { field: "origin", op: "neq", value: "google_ads" },
      ];
      expect(evaluateConditions(conditions, context)).toBe(true);
    });

    it("evaluates multiple conditions with AND semantics", () => {
      const conditions: RuleCondition[] = [
        { field: "origin", op: "eq", value: "meta_ads" },
        { field: "message", op: "contains", value: "pro" },
      ];
      expect(evaluateConditions(conditions, context)).toBe(true);

      // If one fails, whole evaluation returns false
      const mixed: RuleCondition[] = [
        ...conditions,
        { field: "score", op: "eq", value: "100" },
      ];
      expect(evaluateConditions(mixed, context)).toBe(false);
    });

    it("handles null/missing fields correctly", () => {
      expect(
        evaluateConditions(
          [{ field: "emptyField", op: "neq", value: "anything" }],
          context
        )
      ).toBe(true);

      expect(
        evaluateConditions(
          [{ field: "emptyField", op: "eq", value: "anything" }],
          context
        )
      ).toBe(false);
    });
  });

  describe("evaluateConditionsDetailed", () => {
    const context = {
      origin: "site",
      dealValue: 5000,
      tags: ["lead-quente"],
    };

    it("evaluates matching and non-matching conditions with per-condition details", () => {
      const conditions: RuleCondition[] = [
        { field: "origin", op: "eq", value: "site" },
        { field: "dealValue", op: "eq", value: "9999" },
      ];

      const result = evaluateConditionsDetailed(conditions, context);
      expect(result.allMatched).toBe(false);
      expect(result.evaluations).toHaveLength(2);

      expect(result.evaluations[0]).toEqual({
        field: "origin",
        op: "eq",
        expectedValue: "site",
        actualValue: "site",
        matched: true,
      });

      expect(result.evaluations[1]).toEqual({
        field: "dealValue",
        op: "eq",
        expectedValue: "9999",
        actualValue: 5000,
        matched: false,
      });
    });

    it("returns allMatched = true when conditions list is empty", () => {
      const result = evaluateConditionsDetailed([], context);
      expect(result.allMatched).toBe(true);
      expect(result.evaluations).toEqual([]);
    });
  });
});
