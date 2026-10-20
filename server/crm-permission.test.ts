import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  MODULE_NAME_MAP,
  MODULE_LABELS,
  normalizeModuleNameToBackend,
  normalizeModuleNameToAdmin,
  normalizeModuleNamesToBackend,
  normalizeModuleNamesToAdmin,
} from "@shared/const";
import {
  hasCrmAccess,
  requireCrmAccess,
  hasDedicatedCrmAccess,
  requireDedicatedCrmAccess,
} from "./crm-access";
import {
  CONFIGURABLE_MODULES,
  rolePermissions,
  resolveUserPermissions,
  assertClientUserPermission,
} from "./routers";

describe("MegaDesk - Fase 1: Permissão Dedicada CRM", () => {
  // Mock tenant helper
  const createMockTenant = (modules: string[] = ["crm"]) => ({
    clientId: "tenant-crm-01",
    company: "Empresa Teste CRM",
    status: "active" as const,
    accessReleased: true,
    modules,
    users: [
      {
        id: "u-admin",
        name: "Admin User",
        email: "admin@empresa.com",
        role: "admin" as const,
        status: "active" as const,
        permissions: rolePermissions("admin"),
        passwordHash: "hash",
      },
      {
        id: "u-agent-authorized",
        name: "Authorized Agent",
        email: "agent.auth@empresa.com",
        role: "agent" as const,
        status: "active" as const,
        permissions: ["crm"],
        passwordHash: "hash",
      },
      {
        id: "u-agent-unauthorized",
        name: "Unauthorized Agent",
        email: "agent.unauth@empresa.com",
        role: "agent" as const,
        status: "active" as const,
        permissions: ["tickets"],
        passwordHash: "hash",
      },
      {
        id: "u-agent-default",
        name: "Default Agent",
        email: "agent.default@empresa.com",
        role: "agent" as const,
        status: "active" as const,
        passwordHash: "hash",
      },
      {
        id: "u-viewer",
        name: "Viewer User",
        email: "viewer@empresa.com",
        role: "viewer" as const,
        status: "active" as const,
        passwordHash: "hash",
      },
    ],
  });

  describe("1. Tenant com CRM contratado e usuário autorizado", () => {
    it("deve permitir acesso para usuário com permissão individual crm em tenant contratado", () => {
      const client = createMockTenant(["crm", "active-attendance"]);
      const agentUser = client.users.find((u) => u.id === "u-agent-authorized")!;

      const resolved = resolveUserPermissions(agentUser, client.modules);
      expect(resolved).toContain("crm");
      expect(resolved).toContain("home");

      expect(hasDedicatedCrmAccess({ operationalUserRole: agentUser.role, operationalPermissions: resolved })).toBe(true);
      expect(requireDedicatedCrmAccess({ tenantId: client.clientId, operationalUserRole: agentUser.role, operationalPermissions: resolved })).toBe(client.clientId);

      const assertedUser = assertClientUserPermission(client as any, "crm", agentUser.email);
      expect(assertedUser.email).toBe(agentUser.email);
    });
  });

  describe("2. Tenant sem CRM contratado e usuário com permissão individual", () => {
    it("deve negar acesso ao CRM mesmo com permissão individual armazenada se o tenant não contratou CRM", () => {
      // Tenant sem "crm" contratado
      const client = createMockTenant(["active-attendance", "erp"]);
      const agentUser = client.users.find((u) => u.id === "u-agent-authorized")!;

      // Permissão individual armazena "crm", mas resolveUserPermissions filtra pelo client.modules
      const resolved = resolveUserPermissions(agentUser, client.modules);
      expect(resolved).not.toContain("crm");

      expect(hasDedicatedCrmAccess({ operationalUserRole: agentUser.role, operationalPermissions: resolved })).toBe(false);

      expect(() => {
        requireDedicatedCrmAccess({ tenantId: client.clientId, operationalUserRole: agentUser.role, operationalPermissions: resolved });
      }).toThrowError(TRPCError);

      expect(() => {
        assertClientUserPermission(client as any, "crm", agentUser.email);
      }).toThrowError(TRPCError);
    });

    it("papel admin ou manager nunca permite contornar a contratação do módulo CRM pelo tenant", () => {
      // Tenant SEM "crm" contratado
      const client = createMockTenant(["active-attendance", "erp"]);
      const adminUser = client.users.find((u) => u.id === "u-admin")!;

      // resolveUserPermissions deve filtrar "crm" porque o tenant não contratou
      const resolved = resolveUserPermissions(adminUser, client.modules);
      expect(resolved).not.toContain("crm");

      // hasDedicatedCrmAccess deve negar acesso
      expect(hasDedicatedCrmAccess({ operationalUserRole: "admin", operationalPermissions: resolved })).toBe(false);

      // requireDedicatedCrmAccess deve lançar erro
      expect(() => {
        requireDedicatedCrmAccess({ tenantId: client.clientId, operationalUserRole: "admin", operationalPermissions: resolved });
      }).toThrowError(TRPCError);

      // assertClientUserPermission no backend deve negar acesso
      expect(() => {
        assertClientUserPermission(client as any, "crm", adminUser.email);
      }).toThrowError(TRPCError);
    });

    it("bloqueio fail-closed: nega acesso quando operationalPermissions é undefined, null ou vazio, mesmo para admin/manager", () => {
      // undefined permissions
      expect(hasDedicatedCrmAccess({ operationalUserRole: "admin", operationalPermissions: undefined })).toBe(false);
      expect(hasDedicatedCrmAccess({ operationalUserRole: "manager", operationalPermissions: undefined })).toBe(false);

      // null permissions (como cast)
      expect(hasDedicatedCrmAccess({ operationalUserRole: "admin", operationalPermissions: null as any })).toBe(false);
      expect(hasDedicatedCrmAccess({ operationalUserRole: "manager", operationalPermissions: null as any })).toBe(false);

      // empty permissions
      expect(hasDedicatedCrmAccess({ operationalUserRole: "admin", operationalPermissions: [] })).toBe(false);
      expect(hasDedicatedCrmAccess({ operationalUserRole: "manager", operationalPermissions: [] })).toBe(false);

      // requireDedicatedCrmAccess deve lançar FORBIDDEN
      expect(() => {
        requireDedicatedCrmAccess({ tenantId: "tenant-1", operationalUserRole: "admin", operationalPermissions: undefined });
      }).toThrowError("Acesso ao CRM indisponível.");

      expect(() => {
        requireDedicatedCrmAccess({ tenantId: "tenant-1", operationalUserRole: "manager", operationalPermissions: [] });
      }).toThrowError("Acesso ao CRM indisponível.");
    });
  });

  describe("3. Tenant com CRM contratado e usuário sem permissão individual", () => {
    it("deve negar acesso a agente sem permissão individual de CRM", () => {
      const client = createMockTenant(["crm", "tickets"]);
      const agentUser = client.users.find((u) => u.id === "u-agent-unauthorized")!;

      const resolved = resolveUserPermissions(agentUser, client.modules);
      expect(resolved).not.toContain("crm");

      expect(hasDedicatedCrmAccess({ operationalUserRole: agentUser.role, operationalPermissions: resolved })).toBe(false);

      expect(() => {
        assertClientUserPermission(client as any, "crm", agentUser.email);
      }).toThrowError(TRPCError);
    });

    it("deve negar acesso a agente com permissões padrão da role", () => {
      const client = createMockTenant(["crm", "active-attendance", "conversations"]);
      const agentUser = client.users.find((u) => u.id === "u-agent-default")!;

      const resolved = resolveUserPermissions(agentUser, client.modules);
      expect(resolved).not.toContain("crm");
      expect(hasDedicatedCrmAccess({ operationalUserRole: agentUser.role, operationalPermissions: resolved })).toBe(false);
    });

    it("deve negar acesso a viewer com permissões padrão da role", () => {
      const client = createMockTenant(["crm", "tickets"]);
      const viewerUser = client.users.find((u) => u.id === "u-viewer")!;

      const resolved = resolveUserPermissions(viewerUser, client.modules);
      expect(resolved).not.toContain("crm");
      expect(hasDedicatedCrmAccess({ operationalUserRole: viewerUser.role, operationalPermissions: resolved })).toBe(false);
    });

    it("exceção administrativa prevista: admin e manager sem customização herdam crm da role quando contratado", () => {
      const client = createMockTenant(["crm"]);
      const adminUser = {
        id: "u-admin-default",
        name: "Admin Default",
        email: "admin.def@empresa.com",
        role: "admin" as const,
        status: "active" as const,
        // Sem permissões customizadas
      };
      const managerUser = {
        id: "u-manager-default",
        name: "Manager Default",
        email: "manager.def@empresa.com",
        role: "manager" as const,
        status: "active" as const,
      };

      const resolvedAdmin = resolveUserPermissions(adminUser as any, client.modules);
      const resolvedManager = resolveUserPermissions(managerUser as any, client.modules);

      expect(resolvedAdmin).toContain("crm");
      expect(resolvedManager).toContain("crm");
      expect(hasDedicatedCrmAccess({ operationalUserRole: "admin", operationalPermissions: resolvedAdmin })).toBe(true);
      expect(hasDedicatedCrmAccess({ operationalUserRole: "manager", operationalPermissions: resolvedManager })).toBe(true);
    });

    it("admin com customização explícita sem crm não deve ter acesso ao crm", () => {
      const client = createMockTenant(["crm"]);
      const adminCustom = {
        id: "u-admin-custom",
        name: "Admin Custom",
        email: "admin.custom@empresa.com",
        role: "admin" as const,
        status: "active" as const,
        permissions: ["tickets"], // Customizado sem CRM
      };

      const resolved = resolveUserPermissions(adminCustom as any, client.modules);
      expect(resolved).not.toContain("crm");
      expect(hasDedicatedCrmAccess({ operationalUserRole: "admin", operationalPermissions: resolved })).toBe(false);
    });
  });

  describe("4. Permissão crm não concede acesso a clients nem a erp", () => {
    it("não concede acesso a clients ou erp quando o usuário só possui crm", () => {
      const client = createMockTenant(["crm"]);
      const user = {
        id: "u-crm-only",
        name: "CRM Only",
        email: "crm.only@empresa.com",
        role: "admin" as const,
        status: "active" as const,
        permissions: ["crm"],
      };

      const resolved = resolveUserPermissions(user as any, client.modules);
      expect(resolved).toContain("crm");
      expect(resolved).not.toContain("clients");
      expect(resolved).not.toContain("erp");

      // hasCrmAccess verifica o acesso legado a Clientes/ERP
      expect(hasCrmAccess({ operationalUserRole: "admin", operationalPermissions: resolved })).toBe(false);

      expect(() => {
        requireCrmAccess({ tenantId: client.clientId, operationalUserRole: "admin", operationalPermissions: resolved });
      }).toThrowError("Acesso a Clientes indisponível.");
    });

    it("permissão erp ou clients não concede acesso ao CRM dedicado", () => {
      const client = createMockTenant(["erp", "clients"]);
      const user = {
        id: "u-erp-only",
        name: "ERP Only",
        email: "erp.only@empresa.com",
        role: "admin" as const,
        status: "active" as const,
        permissions: ["erp", "clients"],
      };

      const resolved = resolveUserPermissions(user as any, client.modules);
      expect(resolved).toContain("erp");
      expect(resolved).toContain("clients");
      expect(resolved).not.toContain("crm");

      // Não deve ter acesso ao módulo dedicado CRM
      expect(hasDedicatedCrmAccess({ operationalUserRole: "admin", operationalPermissions: resolved })).toBe(false);
      expect(() => {
        requireDedicatedCrmAccess({ tenantId: client.clientId, operationalUserRole: "admin", operationalPermissions: resolved });
      }).toThrowError("Acesso ao CRM indisponível.");
    });
  });

  describe("5. Permissões legadas continuam funcionando como antes", () => {
    it("acesso legado a clientes/erp continua operando normalmente para admin com erp", () => {
      const client = createMockTenant(["erp"]);
      const user = {
        id: "u-erp-admin",
        name: "ERP Admin",
        email: "erp.admin@empresa.com",
        role: "admin" as const,
        status: "active" as const,
        permissions: ["erp"],
      };

      const resolved = resolveUserPermissions(user as any, client.modules);
      expect(resolved).toContain("erp");
      expect(resolved).toContain("clients"); // Compatibilidade: erp adiciona clients para admin
      expect(hasCrmAccess({ operationalUserRole: "admin", operationalPermissions: resolved })).toBe(true);
      expect(requireCrmAccess({ tenantId: client.clientId, operationalUserRole: "admin", operationalPermissions: resolved })).toBe(client.clientId);
    });

    it("mantém restrição de segurança que impede agent/viewer de acessar clients diretamente", () => {
      const client = createMockTenant(["erp", "clients", "active-attendance"]);
      const agentUser = {
        id: "u-agent",
        name: "Agent",
        email: "agent@empresa.com",
        role: "agent" as const,
        status: "active" as const,
        permissions: ["clients", "active-attendance"],
      };

      const resolved = resolveUserPermissions(agentUser as any, client.modules);
      // "clients" é filtrado para agent por regra de integridade do ERP
      expect(resolved).not.toContain("clients");
      expect(resolved).toContain("active-attendance");
    });
  });

  describe("6. Revogação da contratação ou da permissão individual", () => {
    it("revogação do módulo contratado remove imediatamente crm na nova resolução de permissões", () => {
      // 1. Início: módulo contratado
      let clientModules = ["active-attendance", "crm"];
      const user = {
        id: "u-test",
        name: "Test",
        email: "test@empresa.com",
        role: "agent" as const,
        status: "active" as const,
        permissions: ["crm"],
      };

      const initialPerms = resolveUserPermissions(user as any, clientModules);
      expect(initialPerms).toContain("crm");
      expect(hasDedicatedCrmAccess({ operationalUserRole: user.role, operationalPermissions: initialPerms })).toBe(true);

      // 2. Simula toggleModule desabilitando "crm" no tenant
      clientModules = clientModules.filter((m) => m !== "crm");

      // 3. Ao renovar sessão (login ou refreshSession), permissão crm não é mais concedida
      const renewedPerms = resolveUserPermissions(user as any, clientModules);
      expect(renewedPerms).not.toContain("crm");
      expect(hasDedicatedCrmAccess({ operationalUserRole: user.role, operationalPermissions: renewedPerms })).toBe(false);
    });

    it("revogação da permissão individual do usuário remove o acesso na renovação", () => {
      const clientModules = ["crm"];
      const user = {
        id: "u-test",
        name: "Test",
        email: "test@empresa.com",
        role: "agent" as const,
        status: "active" as const,
        permissions: ["crm"],
      };

      const initialPerms = resolveUserPermissions(user as any, clientModules);
      expect(initialPerms).toContain("crm");

      // Simula updateUserPermissions removendo "crm"
      user.permissions = [];
      const renewedPerms = resolveUserPermissions(user as any, clientModules);
      expect(renewedPerms).not.toContain("crm");
      expect(hasDedicatedCrmAccess({ operationalUserRole: user.role, operationalPermissions: renewedPerms })).toBe(false);
    });
  });

  describe("7. Mapeamento e consistência com interfaces administrativas", () => {
    it("deve mapear crm bidirecionalmente entre MegaAdmin e backend", () => {
      expect(normalizeModuleNameToBackend("crm")).toBe("crm");
      expect(normalizeModuleNameToAdmin("crm")).toBe("crm");
      expect(normalizeModuleNamesToBackend(["crm", "conversas"])).toEqual(["crm", "conversations"]);
      expect(normalizeModuleNamesToAdmin(["crm", "conversations"])).toEqual(["crm", "conversas"]);
    });

    it("deve possuir rótulo amigável no catálogo MODULE_LABELS", () => {
      expect((MODULE_LABELS as Record<string, string>)["crm"]).toBe("CRM");
    });

    it("CONFIGURABLE_MODULES no backend deve conter crm", () => {
      expect(CONFIGURABLE_MODULES).toContain("crm");
    });

    it("rolePermissions deve incluir crm para admin e manager e NÃO incluir para agent e viewer", () => {
      expect(rolePermissions("admin")).toContain("crm");
      expect(rolePermissions("manager")).toContain("crm");
      expect(rolePermissions("agent")).not.toContain("crm");
      expect(rolePermissions("viewer")).not.toContain("crm");
    });
  });
});
