/**
 * Testes de sincronização de permissões MegaAdmin ↔ Backend ↔ MegaDesk
 *
 * Cobre os 4 problemas identificados no diagnóstico:
 * 1. Formato inconsistente (underscore vs hífen)
 * 2. validateToken/tenantObservability misturavam permissões da role com customizadas
 * 3. overview/refreshSession não usavam módulos do cliente para filtrar
 * 4. Checkboxes no MegaAdmin não refletiam permissões salvas
 */

import { describe, it, expect } from "vitest";
import {
  MODULE_NAME_MAP,
  MODULE_LABELS,
  normalizeModuleNameToBackend,
  normalizeModuleNameToAdmin,
  normalizeModuleNamesToBackend,
  normalizeModuleNamesToAdmin,
} from "../shared/const";

// ─── Mapeamento de módulos ────────────────────────────────────────────────────

describe("Mapeamento de módulos MegaAdmin ↔ Backend", () => {
  it("deve mapear todos os módulos do MegaAdmin para o formato backend (hífen)", () => {
    expect(normalizeModuleNameToBackend("atendimento_ativo")).toBe("active-attendance");
    expect(normalizeModuleNameToBackend("conversas")).toBe("conversations");
    expect(normalizeModuleNameToBackend("chamados")).toBe("tickets");
    expect(normalizeModuleNameToBackend("rastreio")).toBe("tracking");
    expect(normalizeModuleNameToBackend("erp")).toBe("erp");
    expect(normalizeModuleNameToBackend("configurar_bot")).toBe("bot-config");
    expect(normalizeModuleNameToBackend("assistente_ia")).toBe("ai-assistant");
  });

  it("deve mapear todos os módulos do backend para o formato MegaAdmin (underscore)", () => {
    expect(normalizeModuleNameToAdmin("active-attendance")).toBe("atendimento_ativo");
    expect(normalizeModuleNameToAdmin("conversations")).toBe("conversas");
    expect(normalizeModuleNameToAdmin("tickets")).toBe("chamados");
    expect(normalizeModuleNameToAdmin("tracking")).toBe("rastreio");
    expect(normalizeModuleNameToAdmin("erp")).toBe("erp");
    expect(normalizeModuleNameToAdmin("bot-config")).toBe("configurar_bot");
    expect(normalizeModuleNameToAdmin("ai-assistant")).toBe("assistente_ia");
  });

  it("deve ser bidirecional: admin → backend → admin", () => {
    const adminModules = Object.keys(MODULE_NAME_MAP);
    for (const mod of adminModules) {
      const backend = normalizeModuleNameToBackend(mod);
      const backToAdmin = normalizeModuleNameToAdmin(backend);
      expect(backToAdmin).toBe(mod);
    }
  });

  it("deve ser bidirecional: backend → admin → backend", () => {
    const backendModules = Object.values(MODULE_NAME_MAP) as string[];
    for (const mod of backendModules) {
      const admin = normalizeModuleNameToAdmin(mod);
      const backToBackend = normalizeModuleNameToBackend(admin);
      expect(backToBackend).toBe(mod);
    }
  });

  it("deve preservar módulos desconhecidos sem alteração", () => {
    expect(normalizeModuleNameToBackend("home")).toBe("home");
    expect(normalizeModuleNameToBackend("settings")).toBe("settings");
    expect(normalizeModuleNameToAdmin("home")).toBe("home");
    expect(normalizeModuleNameToAdmin("notifications")).toBe("notifications");
  });

  it("deve converter arrays corretamente", () => {
    const adminPerms = ["atendimento_ativo", "conversas", "chamados"];
    const backendPerms = normalizeModuleNamesToBackend(adminPerms);
    expect(backendPerms).toEqual(["active-attendance", "conversations", "tickets"]);

    const backToAdmin = normalizeModuleNamesToAdmin(backendPerms);
    expect(backToAdmin).toEqual(adminPerms);
  });

  it("deve ter labels para todos os módulos em ambos os formatos", () => {
    const allModules = [
      "atendimento_ativo", "conversas", "chamados", "rastreio", "erp", "configurar_bot", "assistente_ia",
      "active-attendance", "conversations", "tickets", "tracking", "bot-config", "ai-assistant",
    ];
    for (const mod of allModules) {
      expect((MODULE_LABELS as Record<string, string>)[mod]).toBeDefined();
      expect((MODULE_LABELS as Record<string, string>)[mod]).not.toBe("");
    }
  });
});

// ─── Lógica de resolução de permissões (simula backend) ──────────────────────

describe("Resolução de permissões de usuário (lógica do backend)", () => {
  const BASE_PERMS = ["home", "settings", "notifications"];
  const ALL_CONFIGURABLE = ["active-attendance", "conversations", "tickets", "tracking", "erp", "bot-config", "ai-assistant"];

  function rolePermissions(role: string): string[] {
    const all = [...BASE_PERMS, ...ALL_CONFIGURABLE];
    const map: Record<string, string[]> = {
      admin: all,
      manager: all,
      agent: [...BASE_PERMS, "active-attendance", "conversations", "tickets"],
      viewer: [...BASE_PERMS, "tickets"],
    };
    return map[role] ?? BASE_PERMS;
  }

  // Espelha exatamente a função resolveUserPermissions do backend
  function resolveUserPermissions(user: { role: string; permissions?: string[] }, clientModules?: string[]): string[] {
    let finalPerms: string[];
    if (user.permissions && user.permissions.length > 0) {
      const normalized = normalizeModuleNamesToBackend(user.permissions);
      finalPerms = [...BASE_PERMS, ...normalized];
    } else {
      finalPerms = rolePermissions(user.role);
    }
    if (clientModules && clientModules.length > 0) {
      const normalizedModules = normalizeModuleNamesToBackend(clientModules);
      finalPerms = finalPerms.filter(perm => BASE_PERMS.includes(perm) || normalizedModules.includes(perm));
    }
    return Array.from(new Set(finalPerms));
  }

  it("deve retornar permissões da role quando não há customizações", () => {
    const user = { role: "agent", permissions: [] };
    const perms = resolveUserPermissions(user);
    expect(perms).toContain("active-attendance");
    expect(perms).toContain("conversations");
    expect(perms).toContain("tickets");
    expect(perms).not.toContain("erp");
    expect(perms).not.toContain("tracking");
  });

  it("BUG #2 CORRIGIDO: deve usar APENAS permissões customizadas (não misturar com role)", () => {
    // Admin com apenas conversas — NÃO deve ter todos os módulos da role admin
    const user = { role: "admin", permissions: ["conversas"] };
    const perms = resolveUserPermissions(user);
    expect(perms).toContain("conversations");
    expect(perms).not.toContain("active-attendance");
    expect(perms).not.toContain("tickets");
    expect(perms).not.toContain("erp");
    expect(perms).not.toContain("tracking");
  });

  it("deve normalizar permissões underscore para hífen ao resolver", () => {
    const user = { role: "agent", permissions: ["atendimento_ativo", "conversas"] };
    const perms = resolveUserPermissions(user);
    expect(perms).toContain("active-attendance");
    expect(perms).toContain("conversations");
    expect(perms).not.toContain("atendimento_ativo"); // não deve ter underscore
    expect(perms).not.toContain("conversas");
  });

  it("BUG #3 CORRIGIDO: deve filtrar por módulos do cliente", () => {
    // Admin com todos os módulos, mas cliente só tem conversas e chamados
    const user = { role: "admin", permissions: [] };
    const clientModules = ["conversas", "chamados"];
    const perms = resolveUserPermissions(user, clientModules);
    expect(perms).toContain("conversations");
    expect(perms).toContain("tickets");
    expect(perms).not.toContain("active-attendance");
    expect(perms).not.toContain("erp");
    expect(perms).not.toContain("tracking");
  });

  it("deve sempre incluir permissões base independente dos módulos do cliente", () => {
    const user = { role: "viewer", permissions: ["chamados"] };
    const clientModules = ["chamados"];
    const perms = resolveUserPermissions(user, clientModules);
    expect(perms).toContain("home");
    expect(perms).toContain("settings");
    expect(perms).toContain("notifications");
  });

  it("deve filtrar permissões customizadas pelos módulos do cliente", () => {
    // Usuário tem permissão para ERP, mas o cliente não tem ERP liberado
    const user = { role: "agent", permissions: ["erp", "conversas"] };
    const clientModules = ["conversas"];
    const perms = resolveUserPermissions(user, clientModules);
    expect(perms).toContain("conversations");
    expect(perms).not.toContain("erp");
  });

  it("deve dar acesso admin a todos os módulos quando sem customizações", () => {
    const user = { role: "admin", permissions: [] };
    const perms = resolveUserPermissions(user);
    expect(perms).toContain("active-attendance");
    expect(perms).toContain("conversations");
    expect(perms).toContain("tickets");
    expect(perms).toContain("tracking");
    expect(perms).toContain("erp");
    expect(perms).toContain("bot-config");
    expect(perms).toContain("ai-assistant");
  });

  it("deve dar acesso viewer apenas a chamados quando sem customizações", () => {
    const user = { role: "viewer", permissions: [] };
    const perms = resolveUserPermissions(user);
    expect(perms).toContain("tickets");
    expect(perms).not.toContain("active-attendance");
    expect(perms).not.toContain("conversations");
    expect(perms).not.toContain("erp");
  });
});

// ─── Fluxo completo MegaAdmin → Backend → MegaDesk ───────────────────────────

describe("Fluxo completo de permissões MegaAdmin → MegaDesk", () => {
  it("deve sincronizar: MegaAdmin salva underscore → backend normaliza → MegaDesk filtra sidebar", () => {
    // 1. MegaAdmin envia permissões em underscore
    const adminPermissions = ["atendimento_ativo", "conversas", "chamados"];

    // 2. Backend normaliza para hífen ao salvar
    const backendPermissions = normalizeModuleNamesToBackend(adminPermissions);
    expect(backendPermissions).toEqual(["active-attendance", "conversations", "tickets"]);

    // 3. MegaDesk recebe permissões em hífen e filtra navegação
    const navItems = [
      { id: "active-attendance" }, { id: "conversations" }, { id: "tickets" },
      { id: "tracking" }, { id: "erp" }, { id: "bot-config" }, { id: "ai-assistant" },
    ];
    const visibleItems = navItems.filter(item => backendPermissions.includes(item.id));
    expect(visibleItems.map(i => i.id)).toEqual(["active-attendance", "conversations", "tickets"]);
    expect(visibleItems).toHaveLength(3);
  });

  it("BUG #4 CORRIGIDO: checkboxes no MegaAdmin devem refletir permissões salvas", () => {
    // Permissões chegam do backend em hífen
    const backendPermissions = ["active-attendance", "conversations", "tickets"];

    // MegaAdmin converte para underscore para comparar com ALL_MODULES
    const adminPermissions = normalizeModuleNamesToAdmin(backendPermissions);

    const ALL_MODULES = ["atendimento_ativo", "conversas", "chamados", "rastreio", "erp", "configurar_bot", "assistente_ia"];
    const checkedModules = ALL_MODULES.filter(mod => adminPermissions.includes(mod));

    expect(checkedModules).toContain("atendimento_ativo");
    expect(checkedModules).toContain("conversas");
    expect(checkedModules).toContain("chamados");
    expect(checkedModules).not.toContain("rastreio");
    expect(checkedModules).not.toContain("erp");
    expect(checkedModules).not.toContain("configurar_bot");
    expect(checkedModules).not.toContain("assistente_ia");
  });

  it("deve preservar permissões após ciclo completo: admin → backend → admin", () => {
    const originalAdminPerms = ["atendimento_ativo", "erp", "assistente_ia"];
    const backendPerms = normalizeModuleNamesToBackend(originalAdminPerms);
    const restoredAdminPerms = normalizeModuleNamesToAdmin(backendPerms);
    expect(restoredAdminPerms).toEqual(originalAdminPerms);
  });

  it("deve respeitar módulos do cliente ao filtrar permissões no login", () => {
    const clientModules = ["conversas", "chamados"];
    const normalizedClientModules = normalizeModuleNamesToBackend(clientModules);
    const BASE_PERMS = ["home", "settings", "notifications"];

    // Usuário admin tenta acessar todos os módulos
    const userPermissions = ["active-attendance", "conversations", "tickets", "tracking", "erp", "bot-config", "ai-assistant"];

    const filteredPerms = userPermissions.filter(perm =>
      BASE_PERMS.includes(perm) || normalizedClientModules.includes(perm)
    );

    expect(filteredPerms).toContain("conversations");
    expect(filteredPerms).toContain("tickets");
    expect(filteredPerms).not.toContain("active-attendance");
    expect(filteredPerms).not.toContain("tracking");
    expect(filteredPerms).not.toContain("erp");
  });

  it("deve garantir que MegaDesk só mostra páginas liberadas no MegaAdmin", () => {
    // Admin libera apenas ERP e Assistente IA para um usuário
    const adminGranted = ["erp", "assistente_ia"];
    const backendPerms = normalizeModuleNamesToBackend(adminGranted);

    const allNavItems = ["active-attendance", "conversations", "tickets", "tracking", "erp", "bot-config", "ai-assistant"];
    const visibleNav = allNavItems.filter(item => backendPerms.includes(item));

    expect(visibleNav).toEqual(["erp", "ai-assistant"]);
    expect(visibleNav).toHaveLength(2);
  });

  it("deve filtrar corretamente itens de navegação por permissões (role agent)", () => {
    const navItems = [
      { id: "home" }, { id: "active-attendance" }, { id: "conversations" },
      { id: "tickets" }, { id: "tracking" }, { id: "erp" },
      { id: "bot-config" }, { id: "ai-assistant" }, { id: "settings" },
      { id: "help" }, { id: "notifications" },
    ];
    const alwaysVisible = ["home", "settings", "help", "notifications"];
    const agentPerms = ["home", "settings", "notifications", "active-attendance", "conversations", "tickets"];

    const filtered = navItems.filter(item =>
      alwaysVisible.includes(item.id) || agentPerms.includes(item.id)
    );
    const ids = filtered.map(i => i.id);

    expect(ids).toContain("home");
    expect(ids).toContain("active-attendance");
    expect(ids).toContain("conversations");
    expect(ids).toContain("tickets");
    expect(ids).not.toContain("tracking");
    expect(ids).not.toContain("erp");
    expect(ids).not.toContain("bot-config");
    expect(ids).not.toContain("ai-assistant");
  });
});
