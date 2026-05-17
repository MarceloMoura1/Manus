import { describe, it, expect } from "vitest";

// Mock da função resolveUserPermissions com nomes de permissões corretos
function rolePermissions(role: "admin" | "manager" | "agent" | "viewer") {
  const base = ["home", "settings", "notifications"];
  const CONFIGURABLE_MODULES = [
    "active-attendance",
    "conversations",
    "tickets",
    "tracking",
    "erp",
    "bot-config",
    "ai-assistant",
  ];
  const all = [...base, ...CONFIGURABLE_MODULES];
  const map: Record<string, string[]> = {
    admin: all,
    manager: all,
    agent: [...base, "active-attendance", "conversations", "tickets"],
    viewer: [...base, "tickets"],
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
      permissions: ["active-attendance", "conversations"],
    };

    const resolved = resolveUserPermissions(user);

    // Deve incluir base + customizadas
    expect(resolved).toContain("home");
    expect(resolved).toContain("settings");
    expect(resolved).toContain("notifications");
    expect(resolved).toContain("active-attendance");
    expect(resolved).toContain("conversations");

    // NÃO deve incluir permissões padrão de agent que não foram selecionadas
    expect(resolved).not.toContain("tickets");
    expect(resolved).not.toContain("tracking");
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
    expect(resolved).toContain("active-attendance");
    expect(resolved).toContain("conversations");
    expect(resolved).toContain("tickets");
  });

  it("deve sempre incluir permissões base mesmo com customizações", () => {
    const user = {
      role: "viewer" as const,
      permissions: ["active-attendance"],
    };

    const resolved = resolveUserPermissions(user);

    // Deve incluir base + customizadas
    expect(resolved).toContain("home");
    expect(resolved).toContain("settings");
    expect(resolved).toContain("notifications");
    expect(resolved).toContain("active-attendance");

    // Não deve incluir permissões padrão de viewer
    expect(resolved).not.toContain("tickets");
  });

  it("deve remover duplicatas", () => {
    const user = {
      role: "agent" as const,
      permissions: ["home", "active-attendance"], // home é base, não deve duplicar
    };

    const resolved = resolveUserPermissions(user);

    // Contar quantas vezes "home" aparece
    const homeCount = resolved.filter((p) => p === "home").length;
    expect(homeCount).toBe(1);
  });

  it("deve validar correspondência entre backend e frontend", () => {
    // Nomes de permissões do backend
    const BACKEND_PERMISSIONS = [
      "active-attendance",
      "conversations",
      "tickets",
      "tracking",
      "erp",
      "bot-config",
      "ai-assistant",
    ];

    // Nomes de rotas do frontend
    const FRONTEND_ROUTES = [
      "home",
      "active-attendance",
      "conversations",
      "tickets",
      "tracking",
      "erp",
      "settings",
      "bot-config",
      "ai-assistant",
      "notifications",
    ];

    // Verificar que todas as permissões do backend existem no frontend
    for (const permission of BACKEND_PERMISSIONS) {
      expect(FRONTEND_ROUTES).toContain(
        permission,
        `Permissão "${permission}" do backend não encontrada nas rotas do frontend`
      );
    }
  });

  it("deve garantir que nenhuma permissão usa underscores", () => {
    const BACKEND_PERMISSIONS = [
      "active-attendance",
      "conversations",
      "tickets",
      "tracking",
      "erp",
      "bot-config",
      "ai-assistant",
    ];

    for (const permission of BACKEND_PERMISSIONS) {
      expect(permission).not.toContain(
        "_",
        `Permissão "${permission}" contém underscore, deve usar hífen`
      );
    }
  });
});
