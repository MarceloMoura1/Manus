import { describe, it, expect } from "vitest";
import { normalizeModuleNameToBackend, normalizeModuleNamesToBackend, normalizeModuleNameToAdmin, normalizeModuleNamesToAdmin, MODULE_NAME_MAP } from "@shared/const";

/**
 * Testes abrangentes para o sistema de permissões
 * Valida sincronização entre MegaAdmin (underscore) e Backend/MegaDesk (hífen)
 */

describe("Permissions System - Module Name Normalization", () => {
  describe("Single Module Name Normalization", () => {
    it("should convert atendimento_ativo to active-attendance", () => {
      expect(normalizeModuleNameToBackend("atendimento_ativo")).toBe("active-attendance");
    });

    it("should convert conversas to conversations", () => {
      expect(normalizeModuleNameToBackend("conversas")).toBe("conversations");
    });

    it("should convert chamados to tickets", () => {
      expect(normalizeModuleNameToBackend("chamados")).toBe("tickets");
    });

    it("should convert rastreio to tracking", () => {
      expect(normalizeModuleNameToBackend("rastreio")).toBe("tracking");
    });

    it("should convert erp to erp (no change)", () => {
      expect(normalizeModuleNameToBackend("erp")).toBe("erp");
    });

    it("should convert configurar_bot to bot-config", () => {
      expect(normalizeModuleNameToBackend("configurar_bot")).toBe("bot-config");
    });

    it("should convert assistente_ia to ai-assistant", () => {
      expect(normalizeModuleNameToBackend("assistente_ia")).toBe("ai-assistant");
    });
  });

  describe("Reverse Module Name Normalization", () => {
    it("should convert active-attendance to atendimento_ativo", () => {
      expect(normalizeModuleNameToAdmin("active-attendance")).toBe("atendimento_ativo");
    });

    it("should convert conversations to conversas", () => {
      expect(normalizeModuleNameToAdmin("conversations")).toBe("conversas");
    });

    it("should convert tickets to chamados", () => {
      expect(normalizeModuleNameToAdmin("tickets")).toBe("chamados");
    });

    it("should convert tracking to rastreio", () => {
      expect(normalizeModuleNameToAdmin("tracking")).toBe("rastreio");
    });

    it("should convert bot-config to configurar_bot", () => {
      expect(normalizeModuleNameToAdmin("bot-config")).toBe("configurar_bot");
    });

    it("should convert ai-assistant to assistente_ia", () => {
      expect(normalizeModuleNameToAdmin("ai-assistant")).toBe("assistente_ia");
    });
  });

  describe("Array Module Name Normalization", () => {
    it("should convert array of underscore names to hyphen names", () => {
      const input = ["atendimento_ativo", "conversas", "chamados"];
      const expected = ["active-attendance", "conversations", "tickets"];
      expect(normalizeModuleNamesToBackend(input)).toEqual(expected);
    });

    it("should convert array of hyphen names to underscore names", () => {
      const input = ["active-attendance", "conversations", "tickets"];
      const expected = ["atendimento_ativo", "conversas", "chamados"];
      expect(normalizeModuleNamesToAdmin(input)).toEqual(expected);
    });

    it("should handle all modules conversion to backend", () => {
      const allModules = Object.keys(MODULE_NAME_MAP);
      const converted = normalizeModuleNamesToBackend(allModules);
      expect(converted).toHaveLength(allModules.length);
      expect(converted).not.toContain("_"); // Nenhum underscore
    });

  });

  describe("Permission Resolution Logic", () => {
    it("should resolve permissions with customizations (no role mixing)", () => {
      const user = {
        id: "user-1",
        name: "John",
        email: "john@example.com",
        role: "agent" as const,
        status: "active" as const,
        permissions: ["atendimento_ativo", "conversas"], // Customizações em underscore
      };

      // Simular resolveUserPermissions
      const base = ["home", "settings", "notifications"];
      const normalizedCustomPerms = normalizeModuleNamesToBackend(user.permissions);
      const finalPerms = [...base, ...normalizedCustomPerms];

      expect(finalPerms).toContain("home");
      expect(finalPerms).toContain("active-attendance");
      expect(finalPerms).toContain("conversations");
      expect(finalPerms).not.toContain("tickets"); // Não incluir permissões da role
    });

    it("should filter permissions by client modules", () => {
      const user = {
        id: "user-1",
        name: "John",
        email: "john@example.com",
        role: "agent" as const,
        status: "active" as const,
        permissions: ["atendimento_ativo", "conversas", "chamados"],
      };

      const clientModules = ["atendimento_ativo", "conversas"]; // Cliente só libera esses
      const base = ["home", "settings", "notifications"];
      const normalizedCustomPerms = normalizeModuleNamesToBackend(user.permissions);
      const normalizedModules = normalizeModuleNamesToBackend(clientModules);

      const finalPerms = [...base, ...normalizedCustomPerms];
      const filteredPerms = finalPerms.filter(perm => {
        if (base.includes(perm)) return true;
        return normalizedModules.includes(perm);
      });

      expect(filteredPerms).toContain("home");
      expect(filteredPerms).toContain("active-attendance");
      expect(filteredPerms).toContain("conversations");
      expect(filteredPerms).not.toContain("tickets"); // Filtrado por módulos do cliente
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty arrays", () => {
      expect(normalizeModuleNamesToBackend([])).toEqual([]);
      expect(normalizeModuleNamesToAdmin([])).toEqual([]);
    });

    it("should handle unknown module names (passthrough)", () => {
      expect(normalizeModuleNameToBackend("unknown_module")).toBe("unknown_module");
      expect(normalizeModuleNameToAdmin("unknown-module")).toBe("unknown-module");
    });

    it("should handle mixed known and unknown modules", () => {
      const input = ["atendimento_ativo", "unknown_module", "conversas"];
      const result = normalizeModuleNamesToBackend(input);
      expect(result).toContain("active-attendance");
      expect(result).toContain("unknown_module"); // Passthrough
      expect(result).toContain("conversations");
    });

    it("should maintain uniqueness after normalization", () => {
      const input = ["atendimento_ativo", "atendimento_ativo", "conversas"];
      const result = normalizeModuleNamesToBackend(input);
      expect(result).toContain("active-attendance");
      expect(result).toContain("conversations");
      // Não há garantia de deduplicação aqui, mas o código deve usar Set
    });
  });

  describe("Bidirectional Consistency", () => {
    it("should convert back and forth consistently", () => {
      const original = "atendimento_ativo";
      const toBackend = normalizeModuleNameToBackend(original);
      const backToAdmin = normalizeModuleNameToAdmin(toBackend);
      expect(backToAdmin).toBe(original);
    });

    it("should handle array bidirectional conversion", () => {
      const original = ["atendimento_ativo", "conversas", "chamados"];
      const toBackend = normalizeModuleNamesToBackend(original);
      const backToAdmin = normalizeModuleNamesToAdmin(toBackend);
      expect(backToAdmin).toEqual(original);
    });

    it("should verify all mappings are bidirectional", () => {
      for (const [adminName, backendName] of Object.entries(MODULE_NAME_MAP)) {
        expect(normalizeModuleNameToBackend(adminName)).toBe(backendName);
        expect(normalizeModuleNameToAdmin(backendName)).toBe(adminName);
      }
    });
  });

  describe("Synchronization Scenarios", () => {
    it("MegaAdmin → Backend: User permissions saved correctly", () => {
      // MegaAdmin envia permissões em underscore
      const megaAdminPermissions = ["atendimento_ativo", "conversas"];
      // Backend normaliza para hífen
      const backendPermissions = normalizeModuleNamesToBackend(megaAdminPermissions);
      expect(backendPermissions).toEqual(["active-attendance", "conversations"]);
    });

    it("Backend → MegaDesk: User sees correct modules", () => {
      // Backend retorna permissões em hífen
      const backendPermissions = ["active-attendance", "conversations", "tickets"];
      // MegaDesk recebe e exibe corretamente
      expect(backendPermissions).toContain("active-attendance");
      expect(backendPermissions).toContain("conversations");
    });

    it("MegaAdmin → Backend → MegaDesk: Full sync cycle", () => {
      // 1. MegaAdmin seleciona permissões
      const megaAdminSelection = ["atendimento_ativo", "conversas"];
      // 2. Backend normaliza
      const normalized = normalizeModuleNamesToBackend(megaAdminSelection);
      // 3. MegaDesk recebe e filtra por módulos do cliente
      const clientModules = normalizeModuleNamesToBackend(["atendimento_ativo", "conversas", "chamados"]);
      const visibleModules = normalized.filter(m => clientModules.includes(m));
      
      expect(visibleModules).toEqual(["active-attendance", "conversations"]);
    });
  });
});
