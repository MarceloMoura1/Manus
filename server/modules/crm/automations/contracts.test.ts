import { describe, expect, it } from "vitest";
import {
  ruleCreateInput,
  ruleUpdateInput,
  webhookSourceCreateInput,
  webhookSourceUpdateInput,
  aiSettingsUpdateInput,
} from "./contracts";

describe("CRM Automations Contracts Validation", () => {
  describe("ruleCreateInput", () => {
    it("validates valid automation rule creation payload", () => {
      const parsed = ruleCreateInput.parse({
        name: "Qualificar Lead do WhatsApp",
        description: "Envia mensagem de boas-vindas e gera tarefa",
        triggerType: "lead.created",
        conditions: [
          { field: "origin", op: "eq", value: "whatsapp" },
        ],
        actions: [
          { type: "create_task", config: { title: "Primeiro contato comercial" } },
        ],
        isActive: true,
      });

      expect(parsed.name).toBe("Qualificar Lead do WhatsApp");
      expect(parsed.triggerType).toBe("lead.created");
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.isActive).toBe(true);
    });

    it("requires at least one action", () => {
      expect(() =>
        ruleCreateInput.parse({
          name: "Regra sem ação",
          triggerType: "lead.created",
          actions: [],
        })
      ).toThrow();
    });

    it("rejects empty name", () => {
      expect(() =>
        ruleCreateInput.parse({
          name: "   ",
          triggerType: "lead.created",
          actions: [{ type: "add_tag", config: { tag: "novo" } }],
        })
      ).toThrow();
    });
  });

  describe("webhookSourceCreateInput", () => {
    it("validates webhook source and applies default field mappings", () => {
      const parsed = webhookSourceCreateInput.parse({
        name: "Formulário Landing Page PRO",
      });

      expect(parsed.name).toBe("Formulário Landing Page PRO");
      expect(parsed.fieldMappings.name).toBe("name");
      expect(parsed.fieldMappings.phone).toBe("phone");
      expect(parsed.fieldMappings.email).toBe("email");
    });
  });

  describe("aiSettingsUpdateInput", () => {
    it("validates AI settings update payload", () => {
      const parsed = aiSettingsUpdateInput.parse({
        isEnabled: true,
        systemPrompt: "Você é um assistente comercial especializado em ERP.",
        qualificationCriteria: "Verificar se empresa tem mais de 5 funcionários.",
        autoSuggestNextAction: true,
        modelName: "gemini-1.5-pro",
      });

      expect(parsed.isEnabled).toBe(true);
      expect(parsed.autoSuggestNextAction).toBe(true);
      expect(parsed.modelName).toBe("gemini-1.5-pro");
    });
  });
});
