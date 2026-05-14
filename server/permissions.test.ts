import { describe, it, expect } from "vitest";

// Mock da função resolveUserPermissions
function rolePermissions(role: "admin" | "manager" | "agent" | "viewer") {
  const base = ["home", "settings", "notifications"];
  const CONFIGURABLE_MODULES = [
    "atendimento_ativo",
    "conversas",
    "chamados",
    "rastreio",
    "erp",
    "configurar_bot",
    "assistente_ia",
  ];
  const all = [...base, ...CONFIGURABLE_MODULES];
  const map: Record<string, string[]> = {
    admin: all,
    manager: all,
    agent: [...base, "atendimento_ativo", "conversas", "chamados"],
    viewer: [...base, "chamados"],
  };
  return map[role];
}

function resolveUserPermissions(user: { role: "admin" | "manager" | "agent" | "viewer"; permissions?: string[] }) {
  if (user.permissions && user.permissions.length > 0) {
    const base = ["home", "settings", "notifications"];
    return Array.from(new Set([...base, ...user.permissions]));
  }
  return rolePermissions(user.role);
}

describe("Permissões de Usuário", () => {
  it("deve usar permissões customizadas quando definidas", () => {
    const user = {
      role: "agent" as const,
      permissions: ["atendimento_ativo", "conversas"],
    };

    const resolved = resolveUserPermissions(user);

    // Deve incluir base + customizadas
    expect(resolved).toContain("home");
    expect(resolved).toContain("settings");
    expect(resolved).toContain("notifications");
    expect(resolved).toContain("atendimento_ativo");
    expect(resolved).toContain("conversas");

    // NÃO deve incluir permissões padrão de agent que não foram selecionadas
    expect(resolved).not.toContain("chamados");
    expect(resolved).not.toContain("rastreio");
    expect(resolved).not.toContain("erp");
  });

  it("deve usar permissões padrão da role quando não há customizações", () => {
    const user = {
      role: "agent" as const,
      permissions: undefined,
    };

    const resolved = resolveUserPermissions(user);

    // Deve incluir permissões padrão de agent
    expect(resolved).toContain("home");
    expect(resolved).toContain("settings");
    expect(resolved).toContain("notifications");
    expect(resolved).toContain("atendimento_ativo");
    expect(resolved).toContain("conversas");
    expect(resolved).toContain("chamados");
  });

  it("deve sempre incluir permissões base mesmo com customizações", () => {
    const user = {
      role: "viewer" as const,
      permissions: ["atendimento_ativo"],
    };

    const resolved = resolveUserPermissions(user);

    // Deve incluir base + customizadas
    expect(resolved).toContain("home");
    expect(resolved).toContain("settings");
    expect(resolved).toContain("notifications");
    expect(resolved).toContain("atendimento_ativo");

    // Não deve incluir permissões padrão de viewer
    expect(resolved).not.toContain("chamados");
  });

  it("deve remover duplicatas", () => {
    const user = {
      role: "agent" as const,
      permissions: ["home", "atendimento_ativo"], // home é base, não deve duplicar
    };

    const resolved = resolveUserPermissions(user);

    // Contar quantas vezes "home" aparece
    const homeCount = resolved.filter((p) => p === "home").length;
    expect(homeCount).toBe(1);
  });
});
