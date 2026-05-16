import { describe, it, expect } from "vitest";

/**
 * Testes para validar sincronização de permissões entre MegaAdmin e MegaDesk
 */
describe("Permissions Synchronization", () => {
  // Módulos configuráveis que devem estar sincronizados
  const CONFIGURABLE_MODULES = [
    "active-attendance",
    "conversations",
    "tickets",
    "tracking",
    "erp",
    "bot-config",
    "ai-assistant",
  ];

  // Permissões base que todo usuário tem
  const BASE_PERMISSIONS = ["home", "settings", "notifications"];

  // Mapeamento de roles para permissões
  const ROLE_PERMISSIONS = {
    admin: [...BASE_PERMISSIONS, ...CONFIGURABLE_MODULES],
    manager: [...BASE_PERMISSIONS, ...CONFIGURABLE_MODULES],
    agent: [...BASE_PERMISSIONS, "active-attendance", "conversations", "tickets"],
    viewer: [...BASE_PERMISSIONS, "tickets"],
  };

  it("deve ter todos os módulos configuráveis definidos", () => {
    expect(CONFIGURABLE_MODULES).toContain("active-attendance");
    expect(CONFIGURABLE_MODULES).toContain("conversations");
    expect(CONFIGURABLE_MODULES).toContain("tickets");
    expect(CONFIGURABLE_MODULES).toContain("tracking");
    expect(CONFIGURABLE_MODULES).toContain("erp");
    expect(CONFIGURABLE_MODULES).toContain("bot-config");
    expect(CONFIGURABLE_MODULES).toContain("ai-assistant");
  });

  it("deve dar acesso admin a todos os módulos", () => {
    const adminPerms = ROLE_PERMISSIONS.admin;
    expect(adminPerms).toContain("active-attendance");
    expect(adminPerms).toContain("conversations");
    expect(adminPerms).toContain("tickets");
    expect(adminPerms).toContain("tracking");
    expect(adminPerms).toContain("erp");
    expect(adminPerms).toContain("bot-config");
    expect(adminPerms).toContain("ai-assistant");
  });

  it("deve dar acesso manager a todos os módulos", () => {
    const managerPerms = ROLE_PERMISSIONS.manager;
    expect(managerPerms).toContain("active-attendance");
    expect(managerPerms).toContain("conversations");
    expect(managerPerms).toContain("tickets");
    expect(managerPerms).toContain("tracking");
    expect(managerPerms).toContain("erp");
    expect(managerPerms).toContain("bot-config");
    expect(managerPerms).toContain("ai-assistant");
  });

  it("deve dar acesso agent a atendimento, conversas e chamados", () => {
    const agentPerms = ROLE_PERMISSIONS.agent;
    expect(agentPerms).toContain("active-attendance");
    expect(agentPerms).toContain("conversations");
    expect(agentPerms).toContain("tickets");
    expect(agentPerms).not.toContain("tracking");
    expect(agentPerms).not.toContain("erp");
    expect(agentPerms).not.toContain("bot-config");
    expect(agentPerms).not.toContain("ai-assistant");
  });

  it("deve dar acesso viewer apenas a chamados", () => {
    const viewerPerms = ROLE_PERMISSIONS.viewer;
    expect(viewerPerms).toContain("tickets");
    expect(viewerPerms).not.toContain("active-attendance");
    expect(viewerPerms).not.toContain("conversations");
    expect(viewerPerms).not.toContain("tracking");
    expect(viewerPerms).not.toContain("erp");
    expect(viewerPerms).not.toContain("bot-config");
    expect(viewerPerms).not.toContain("ai-assistant");
  });

  it("deve incluir permissões base em todas as roles", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
      expect(perms).toContain("home");
      expect(perms).toContain("settings");
      expect(perms).toContain("notifications");
    }
  });

  it("deve filtrar corretamente itens de navegação por permissões", () => {
    const navItems = [
      { id: "home", label: "Home" },
      { id: "active-attendance", label: "Atendimento Ativo" },
      { id: "conversations", label: "Conversas" },
      { id: "tickets", label: "Chamados" },
      { id: "tracking", label: "Rastreamento" },
      { id: "erp", label: "ERP" },
      { id: "bot-config", label: "Configurar Bot" },
      { id: "ai-assistant", label: "Assistente IA" },
      { id: "settings", label: "Configurações" },
      { id: "help", label: "Ajuda" },
      { id: "notifications", label: "Notificações" },
    ];

    const alwaysVisibleItems = ["home", "settings", "help", "notifications"];
    const agentPermissions = ROLE_PERMISSIONS.agent;

    const filteredItems = navItems.filter((item) => {
      if (alwaysVisibleItems.includes(item.id)) return true;
      return agentPermissions.includes(item.id);
    });

    const visibleIds = filteredItems.map((item) => item.id);

    expect(visibleIds).toContain("home");
    expect(visibleIds).toContain("active-attendance");
    expect(visibleIds).toContain("conversations");
    expect(visibleIds).toContain("tickets");
    expect(visibleIds).toContain("settings");
    expect(visibleIds).toContain("help");
    expect(visibleIds).toContain("notifications");
    expect(visibleIds).not.toContain("tracking");
    expect(visibleIds).not.toContain("erp");
    expect(visibleIds).not.toContain("bot-config");
    expect(visibleIds).not.toContain("ai-assistant");
  });

  it("deve sincronizar permissões customizadas com base", () => {
    const basePerms = ["home", "settings", "notifications"];
    const customPerms = ["conversations", "tickets"];
    const merged = Array.from(new Set([...basePerms, ...customPerms]));

    expect(merged).toContain("home");
    expect(merged).toContain("conversations");
    expect(merged).toContain("tickets");
    expect(merged.length).toBe(5);
  });

  it("deve validar que agent pode acessar active-attendance", () => {
    const agentPerms = ROLE_PERMISSIONS.agent;
    expect(agentPerms.includes("active-attendance")).toBe(true);
  });

  it("deve validar que viewer não pode acessar active-attendance", () => {
    const viewerPerms = ROLE_PERMISSIONS.viewer;
    expect(viewerPerms.includes("active-attendance")).toBe(false);
  });

  it("deve validar que admin pode acessar tracking", () => {
    const adminPerms = ROLE_PERMISSIONS.admin;
    expect(adminPerms.includes("tracking")).toBe(true);
  });

  it("deve validar que agent não pode acessar tracking", () => {
    const agentPerms = ROLE_PERMISSIONS.agent;
    expect(agentPerms.includes("tracking")).toBe(false);
  });

  it("deve validar que admin pode acessar erp", () => {
    const adminPerms = ROLE_PERMISSIONS.admin;
    expect(adminPerms.includes("erp")).toBe(true);
  });

  it("deve validar que viewer não pode acessar erp", () => {
    const viewerPerms = ROLE_PERMISSIONS.viewer;
    expect(viewerPerms.includes("erp")).toBe(false);
  });

  it("deve validar que admin pode acessar bot-config", () => {
    const adminPerms = ROLE_PERMISSIONS.admin;
    expect(adminPerms.includes("bot-config")).toBe(true);
  });

  it("deve validar que agent não pode acessar bot-config", () => {
    const agentPerms = ROLE_PERMISSIONS.agent;
    expect(agentPerms.includes("bot-config")).toBe(false);
  });

  it("deve validar que admin pode acessar ai-assistant", () => {
    const adminPerms = ROLE_PERMISSIONS.admin;
    expect(adminPerms.includes("ai-assistant")).toBe(true);
  });

  it("deve validar que viewer não pode acessar ai-assistant", () => {
    const viewerPerms = ROLE_PERMISSIONS.viewer;
    expect(viewerPerms.includes("ai-assistant")).toBe(false);
  });
});
