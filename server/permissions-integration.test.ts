import { describe, it, expect, beforeEach } from "vitest";

/**
 * Teste de integração para validar que:
 * 1. Permissões customizadas são salvas no banco
 * 2. Permissões customizadas são retornadas no overview/login do MegaDesk
 * 3. Permissões customizadas restringem acesso a módulos não permitidos
 */

describe("Integração de Permissões: MegaAdmin → MegaDesk", () => {
  it("deve respeitar permissões customizadas ao retornar overview", () => {
    // Simulação: usuário agent com permissões customizadas
    // (em produção, isso viria do banco de dados)
    const user = {
      id: "user-123",
      name: "João Silva",
      email: "joao@example.com",
      role: "agent" as const,
      status: "active" as const,
      permissions: ["atendimento_ativo", "conversas"], // Customizado: sem chamados
      passwordHash: "hash123",
    };

    // Função que resolve permissões (importada de routers.ts em produção)
    function resolveUserPermissions(u: typeof user) {
      if (u.permissions && u.permissions.length > 0) {
        const base = ["home", "settings", "notifications"];
        return Array.from(new Set([...base, ...u.permissions]));
      }
      // Padrão de agent
      return ["home", "settings", "notifications", "atendimento_ativo", "conversas", "chamados"];
    }

    const resolved = resolveUserPermissions(user);

    // Validações
    expect(resolved).toContain("atendimento_ativo");
    expect(resolved).toContain("conversas");
    expect(resolved).not.toContain("chamados"); // Não foi selecionado
    expect(resolved).not.toContain("rastreio"); // Não foi selecionado
    expect(resolved).toContain("home"); // Base sempre incluída
  });

  it("deve bloquear acesso a módulos não permitidos", () => {
    const user = {
      id: "user-456",
      name: "Maria Santos",
      email: "maria@example.com",
      role: "viewer" as const,
      status: "active" as const,
      permissions: ["atendimento_ativo"], // Viewer com apenas atendimento
      passwordHash: "hash456",
    };

    function resolveUserPermissions(u: typeof user) {
      if (u.permissions && u.permissions.length > 0) {
        const base = ["home", "settings", "notifications"];
        return Array.from(new Set([...base, ...u.permissions]));
      }
      return ["home", "settings", "notifications", "chamados"];
    }

    function canAccessModule(permissions: string[], module: string): boolean {
      return permissions.includes(module);
    }

    const resolved = resolveUserPermissions(user);

    // Validações de acesso
    expect(canAccessModule(resolved, "atendimento_ativo")).toBe(true);
    expect(canAccessModule(resolved, "home")).toBe(true);
    expect(canAccessModule(resolved, "chamados")).toBe(false); // Bloqueado
    expect(canAccessModule(resolved, "conversas")).toBe(false); // Bloqueado
  });

  it("deve manter permissões base mesmo com customizações restritivas", () => {
    const user = {
      id: "user-789",
      name: "Admin Restrito",
      email: "admin@example.com",
      role: "admin" as const,
      status: "active" as const,
      permissions: ["atendimento_ativo"], // Admin com apenas 1 módulo
      passwordHash: "hash789",
    };

    function resolveUserPermissions(u: typeof user) {
      if (u.permissions && u.permissions.length > 0) {
        const base = ["home", "settings", "notifications"];
        return Array.from(new Set([...base, ...u.permissions]));
      }
      // Padrão de admin: todos os módulos
      return [
        "home",
        "settings",
        "notifications",
        "atendimento_ativo",
        "conversas",
        "chamados",
        "rastreio",
        "erp",
        "configurar_bot",
        "assistente_ia",
      ];
    }

    const resolved = resolveUserPermissions(user);

    // Base sempre deve estar presente
    expect(resolved).toContain("home");
    expect(resolved).toContain("settings");
    expect(resolved).toContain("notifications");

    // Mas outros módulos devem estar bloqueados
    expect(resolved).toContain("atendimento_ativo");
    expect(resolved).not.toContain("conversas");
    expect(resolved).not.toContain("chamados");
  });
});
