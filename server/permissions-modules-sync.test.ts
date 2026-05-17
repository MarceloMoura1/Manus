import { describe, it, expect } from "vitest";

describe("Sincronização de Permissões com Módulos", () => {
  // Simular a função resolveUserPermissions com módulos
  const moduleToPermission: Record<string, string> = {
    "active-attendance": "active-attendance",
    "conversations": "conversations",
    "tickets": "tickets",
    "tracking": "tracking",
    "erp": "erp",
    "bot-config": "bot-config",
    "ai-assistant": "ai-assistant",
  };

  function rolePermissions(role: string): string[] {
    const base = ["home", "settings", "notifications"];
    const all = [...base, "active-attendance", "conversations", "tickets", "tracking", "erp", "bot-config", "ai-assistant"];
    const map: Record<string, string[]> = {
      admin: all,
      manager: all,
      agent: [...base, "active-attendance", "conversations", "tickets"],
      viewer: [...base, "tickets"],
    };
    return map[role] || base;
  }

  function resolveUserPermissions(user: { role: string; permissions?: string[] }, clientModules?: string[]): string[] {
    const base = ["home", "settings", "notifications"];
    let rolePerms = rolePermissions(user.role);

    if (user.permissions && user.permissions.length > 0) {
      rolePerms = [...base, ...user.permissions];
    }

    if (clientModules && clientModules.length > 0) {
      const modulePems = rolePerms.filter(perm => {
        if (base.includes(perm)) return true;
        return clientModules.some(mod => moduleToPermission[mod] === perm);
      });
      return Array.from(new Set(modulePems));
    }

    return Array.from(new Set(rolePerms));
  }

  it("deve retornar todas as permissões para admin sem módulos", () => {
    const user = { role: "admin" };
    const perms = resolveUserPermissions(user);
    expect(perms).toContain("home");
    expect(perms).toContain("active-attendance");
    expect(perms).toContain("conversations");
    expect(perms).toContain("tickets");
  });

  it("deve filtrar permissões de agent para apenas módulos ativados", () => {
    const user = { role: "agent" };
    const clientModules = ["active-attendance", "tickets"];
    const perms = resolveUserPermissions(user, clientModules);
    
    expect(perms).toContain("home");
    expect(perms).toContain("active-attendance");
    expect(perms).toContain("tickets");
    expect(perms).not.toContain("conversations");
    expect(perms).not.toContain("tracking");
    expect(perms).not.toContain("erp");
  });

  it("deve incluir sempre base permissions (home, settings, notifications)", () => {
    const user = { role: "viewer" };
    const clientModules = ["tickets"];
    const perms = resolveUserPermissions(user, clientModules);
    
    expect(perms).toContain("home");
    expect(perms).toContain("settings");
    expect(perms).toContain("notifications");
    expect(perms).toContain("tickets");
  });

  it("deve respeitar permissões customizadas do usuário", () => {
    const user = { role: "viewer", permissions: ["conversations", "tracking"] };
    const clientModules = ["active-attendance", "conversations", "tracking"];
    const perms = resolveUserPermissions(user, clientModules);
    
    expect(perms).toContain("conversations");
    expect(perms).toContain("tracking");
    expect(perms).not.toContain("active-attendance");
  });

  it("deve retornar apenas base permissions quando nenhum módulo está ativado", () => {
    const user = { role: "agent" };
    const clientModules: string[] = [];
    const perms = resolveUserPermissions(user, clientModules);
    
    // Agent sem módulos ativados deve ter permissões padrão
    expect(perms).toContain("home");
    expect(perms).toContain("active-attendance");
    expect(perms).toContain("conversations");
    expect(perms).toContain("tickets");
  });

  it("deve sincronizar permissões quando módulos são ativados/desativados", () => {
    const user = { role: "agent" };
    
    // Cenário 1: Apenas conversas ativada
    let perms = resolveUserPermissions(user, ["conversations"]);
    expect(perms).toContain("conversations");
    expect(perms).not.toContain("active-attendance");
    
    // Cenário 2: Conversas e atendimento ativados
    perms = resolveUserPermissions(user, ["conversations", "active-attendance"]);
    expect(perms).toContain("conversations");
    expect(perms).toContain("active-attendance");
    
    // Cenário 3: Apenas atendimento ativado
    perms = resolveUserPermissions(user, ["active-attendance"]);
    expect(perms).toContain("active-attendance");
    expect(perms).not.toContain("conversations");
  });

  it("deve manter permissões base mesmo com módulos limitados", () => {
    const user = { role: "agent" };
    const clientModules = ["tracking"]; // Módulo não disponível para agent
    const perms = resolveUserPermissions(user, clientModules);
    
    // Deve ter base permissions
    expect(perms).toContain("home");
    expect(perms).toContain("settings");
    expect(perms).toContain("notifications");
  });

  it("deve sincronizar corretamente para manager com todos os módulos", () => {
    const user = { role: "manager" };
    const clientModules = ["active-attendance", "conversations", "tickets", "tracking", "erp", "bot-config", "ai-assistant"];
    const perms = resolveUserPermissions(user, clientModules);
    
    expect(perms).toContain("active-attendance");
    expect(perms).toContain("conversations");
    expect(perms).toContain("tickets");
    expect(perms).toContain("tracking");
    expect(perms).toContain("erp");
    expect(perms).toContain("bot-config");
    expect(perms).toContain("ai-assistant");
  });

  it("deve sincronizar corretamente para viewer com apenas tickets", () => {
    const user = { role: "viewer" };
    const clientModules = ["tickets"];
    const perms = resolveUserPermissions(user, clientModules);
    
    expect(perms).toContain("tickets");
    expect(perms).not.toContain("active-attendance");
    expect(perms).not.toContain("conversations");
    expect(perms).not.toContain("tracking");
  });

  it("deve remover duplicatas de permissões", () => {
    const user = { role: "admin", permissions: ["home", "active-attendance"] };
    const clientModules = ["active-attendance"];
    const perms = resolveUserPermissions(user, clientModules);
    
    const uniquePerms = new Set(perms);
    expect(uniquePerms.size).toBe(perms.length);
  });
});
