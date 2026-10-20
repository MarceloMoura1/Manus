import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  hasCrmCustomerCommercialAccess,
  requireCrmCustomerCommercialAccess,
  hasCrmCustomerLifecycleAccess,
  requireCrmCustomerLifecycleAccess,
  hasCrmCustomerAdminAccess,
  requireCrmCustomerAdminAccess,
  hasCrmAccess,
  requireCrmAccess,
  hasDedicatedCrmAccess,
  requireDedicatedCrmAccess,
  requireTenantId,
} from "./crm-access";
import { canAccessCrmClients } from "../client/src/pages/Home";

describe("MegaDesk CRM — Etapa 2B.1.1: Autorização de Clientes do CRM", () => {
  const tenantId = "tenant-crm-test-01";

  describe("1. Usuário agent com crm (sem clients e sem erp)", () => {
    const agentCtx = {
      tenantId,
      operationalUserId: "user-agent-01",
      operationalUserRole: "agent" as const,
      operationalPermissions: ["crm"],
    };

    it("está autorizado nas operações comerciais de clientes", () => {
      expect(hasCrmCustomerCommercialAccess(agentCtx)).toBe(true);
      expect(requireCrmCustomerCommercialAccess(agentCtx)).toBe(tenantId);
    });

    it("pode acessar a carteira de clientes no frontend via canAccessCrmClients", () => {
      const session = {
        token: "tok",
        userRole: "agent",
        permissions: ["crm"],
        userId: "user-agent-01",
        clientId: tenantId,
        userEmail: "agent@empresa.com",
        userName: "Agent",
        plan: "standard",
        modules: ["crm"],
      };
      expect(canAccessCrmClients(session as any)).toBe(true);
    });

    it("NÃO tem permissão para alterar ciclo de vida (desativar/arquivar)", () => {
      expect(hasCrmCustomerLifecycleAccess(agentCtx)).toBe(false);
      expect(() => requireCrmCustomerLifecycleAccess(agentCtx)).toThrowError(TRPCError);
      expect(() => requireCrmCustomerLifecycleAccess(agentCtx)).toThrowError(
        "Somente administradores e gerentes podem alterar o ciclo de vida de clientes."
      );
    });

    it("NÃO tem permissão para exclusão definitiva de clientes", () => {
      expect(hasCrmCustomerAdminAccess(agentCtx)).toBe(false);
      expect(() => requireCrmCustomerAdminAccess(agentCtx)).toThrowError(TRPCError);
      expect(() => requireCrmCustomerAdminAccess(agentCtx)).toThrowError(
        "Somente administradores podem excluir clientes definitivamente."
      );
    });
  });

  describe("2. Usuário user com crm (sem clients e sem erp)", () => {
    const userCtx = {
      tenantId,
      operationalUserId: "user-standard-01",
      operationalUserRole: "user" as const,
      operationalPermissions: ["crm"],
    };

    it("está autorizado nas operações comerciais de clientes", () => {
      expect(hasCrmCustomerCommercialAccess(userCtx)).toBe(true);
      expect(requireCrmCustomerCommercialAccess(userCtx)).toBe(tenantId);
    });

    it("NÃO tem permissão para alterar ciclo de vida nem exclusão permanente", () => {
      expect(hasCrmCustomerLifecycleAccess(userCtx)).toBe(false);
      expect(hasCrmCustomerAdminAccess(userCtx)).toBe(false);
      expect(() => requireCrmCustomerLifecycleAccess(userCtx)).toThrowError(TRPCError);
      expect(() => requireCrmCustomerAdminAccess(userCtx)).toThrowError(TRPCError);
    });
  });

  describe("3. Usuário manager com crm", () => {
    const managerCtx = {
      tenantId,
      operationalUserId: "user-manager-01",
      operationalUserRole: "manager" as const,
      operationalPermissions: ["crm"],
    };

    it("está autorizado nas operações comerciais e no ciclo de vida", () => {
      expect(hasCrmCustomerCommercialAccess(managerCtx)).toBe(true);
      expect(requireCrmCustomerCommercialAccess(managerCtx)).toBe(tenantId);
      expect(hasCrmCustomerLifecycleAccess(managerCtx)).toBe(true);
      expect(requireCrmCustomerLifecycleAccess(managerCtx)).toBe(tenantId);
    });

    it("NÃO tem permissão para exclusão definitiva (exclusiva de admin)", () => {
      expect(hasCrmCustomerAdminAccess(managerCtx)).toBe(false);
      expect(() => requireCrmCustomerAdminAccess(managerCtx)).toThrowError(
        "Somente administradores podem excluir clientes definitivamente."
      );
    });
  });

  describe("4. Usuário admin sem crm", () => {
    const adminWithoutCrmCtx = {
      tenantId,
      operationalUserId: "user-admin-01",
      operationalUserRole: "admin" as const,
      operationalPermissions: ["tickets", "tracking"], // Sem CRM, sem clients, sem erp
    };

    it("NÃO ganha acesso aos endpoints de clientes do CRM apenas pelo nome do papel admin", () => {
      expect(hasCrmCustomerCommercialAccess(adminWithoutCrmCtx)).toBe(false);
      expect(() => requireCrmCustomerCommercialAccess(adminWithoutCrmCtx)).toThrowError(
        "Acesso a Clientes indisponível."
      );
      expect(hasCrmCustomerLifecycleAccess(adminWithoutCrmCtx)).toBe(false);
      expect(() => requireCrmCustomerLifecycleAccess(adminWithoutCrmCtx)).toThrowError(TRPCError);
      expect(hasCrmCustomerAdminAccess(adminWithoutCrmCtx)).toBe(false);
      expect(() => requireCrmCustomerAdminAccess(adminWithoutCrmCtx)).toThrowError(TRPCError);
    });

    it("NÃO ganha acesso ao shell do CRM dedicado", () => {
      expect(hasDedicatedCrmAccess(adminWithoutCrmCtx)).toBe(false);
      expect(() => requireDedicatedCrmAccess(adminWithoutCrmCtx)).toThrowError(
        "Acesso ao CRM indisponível."
      );
    });
  });

  describe("5. Usuário com clients ou erp (legado) sem crm", () => {
    const erpManagerCtx = {
      tenantId,
      operationalUserId: "user-erp-mgr",
      operationalUserRole: "manager" as const,
      operationalPermissions: ["erp"],
    };

    const clientsAdminCtx = {
      tenantId,
      operationalUserId: "user-clients-adm",
      operationalUserRole: "admin" as const,
      operationalPermissions: ["clients"],
    };

    it("preserva o acesso legado a clientes e operações comerciais", () => {
      expect(hasCrmAccess(erpManagerCtx)).toBe(true);
      expect(requireCrmAccess(erpManagerCtx)).toBe(tenantId);
      expect(hasCrmCustomerCommercialAccess(erpManagerCtx)).toBe(true);
      expect(hasCrmCustomerCommercialAccess(clientsAdminCtx)).toBe(true);
    });

    it("NÃO concede acesso indevido ao módulo CRM dedicado", () => {
      expect(hasDedicatedCrmAccess(erpManagerCtx)).toBe(false);
      expect(hasDedicatedCrmAccess(clientsAdminCtx)).toBe(false);
      expect(() => requireDedicatedCrmAccess(erpManagerCtx)).toThrowError(
        "Acesso ao CRM indisponível."
      );
      expect(() => requireDedicatedCrmAccess(clientsAdminCtx)).toThrowError(
        "Acesso ao CRM indisponível."
      );
    });
  });

  describe("6. Exclusão permanente bloqueada para papéis não autorizados", () => {
    it("bloqueia agent, user e manager mesmo que possuam crm", () => {
      for (const role of ["agent", "user", "manager"] as const) {
        const ctx = {
          tenantId,
          operationalUserId: `user-${role}`,
          operationalUserRole: role,
          operationalPermissions: ["crm"],
        };
        expect(hasCrmCustomerAdminAccess(ctx)).toBe(false);
        expect(() => requireCrmCustomerAdminAccess(ctx)).toThrowError(
          "Somente administradores podem excluir clientes definitivamente."
        );
      }
    });

    it("permite exclusão permanente apenas para admin com crm (ou legado)", () => {
      const adminCtx = {
        tenantId,
        operationalUserId: "user-admin",
        operationalUserRole: "admin" as const,
        operationalPermissions: ["crm"],
      };
      expect(hasCrmCustomerAdminAccess(adminCtx)).toBe(true);
      expect(requireCrmCustomerAdminAccess(adminCtx)).toBe(tenantId);
    });
  });

  describe("7. Ausência de permissões e contexto inválido (fail-closed)", () => {
    it("nega acesso quando operationalPermissions é undefined ou null", () => {
      const invalidPermCtx = {
        tenantId,
        operationalUserRole: "admin" as const,
        operationalPermissions: undefined,
      };
      expect(hasCrmCustomerCommercialAccess(invalidPermCtx)).toBe(false);
      expect(() => requireCrmCustomerCommercialAccess(invalidPermCtx as any)).toThrowError(TRPCError);
    });

    it("nega acesso quando operationalPermissions é um array vazio", () => {
      const emptyPermCtx = {
        tenantId,
        operationalUserRole: "admin" as const,
        operationalPermissions: [],
      };
      expect(hasCrmCustomerCommercialAccess(emptyPermCtx)).toBe(false);
      expect(() => requireCrmCustomerCommercialAccess(emptyPermCtx)).toThrowError(TRPCError);
    });

    it("nega acesso quando o papel operacional não é informado ou é desconhecido", () => {
      const noRoleCtx = {
        tenantId,
        operationalUserRole: undefined,
        operationalPermissions: ["crm"],
      };
      expect(hasCrmCustomerCommercialAccess(noRoleCtx)).toBe(false);
      expect(() => requireCrmCustomerCommercialAccess(noRoleCtx as any)).toThrowError(TRPCError);
    });

    it("bloqueia papel viewer para operações de escrita", () => {
      const viewerCtx = {
        tenantId,
        operationalUserRole: "viewer" as const,
        operationalPermissions: ["crm"],
      };
      // Viewer não está no CRM_COMMERCIAL_ROLES (admin, manager, agent, user)
      expect(hasCrmCustomerCommercialAccess(viewerCtx)).toBe(false);
      expect(() => requireCrmCustomerCommercialAccess(viewerCtx as any)).toThrowError(TRPCError);
    });
  });

  describe("8. Isolamento entre tenants e rejeição de manipulação de tenant", () => {
    it("rejeita contexto sem tenantId ou com tenantId em branco", () => {
      const missingTenantCtx = {
        tenantId: "",
        operationalUserRole: "admin" as const,
        operationalPermissions: ["crm"],
      };
      expect(() => requireTenantId(missingTenantCtx)).toThrowError(TRPCError);
      expect(() => requireTenantId(missingTenantCtx)).toThrowError(
        "Identificador de tenant inválido ou ausente."
      );
      expect(() => requireCrmCustomerCommercialAccess(missingTenantCtx)).toThrowError(
        "Identificador de tenant inválido ou ausente."
      );
    });

    it("deriva e retorna estritamente o tenantId autenticado da sessão", () => {
      const sessionTenant = "tenant-autenticado-xyz";
      const ctx = {
        tenantId: sessionTenant,
        operationalUserRole: "agent" as const,
        operationalPermissions: ["crm"],
      };
      const returnedTenant = requireCrmCustomerCommercialAccess(ctx);
      expect(returnedTenant).toBe(sessionTenant);
    });
  });

  describe("9. Frontend: canAccessCrmClients e ausência de redirecionamento indevido", () => {
    it("permite acesso a crm-clients para usuário agent com crm sem clients/erp", () => {
      const session = {
        token: "tok",
        userRole: "agent",
        permissions: ["crm"],
      };
      expect(canAccessCrmClients(session as any)).toBe(true);
    });

    it("permite acesso a crm-clients para manager com clients ou erp legado", () => {
      const sessionClients = {
        token: "tok",
        userRole: "manager",
        permissions: ["clients"],
      };
      const sessionErp = {
        token: "tok",
        userRole: "manager",
        permissions: ["erp"],
      };
      expect(canAccessCrmClients(sessionClients as any)).toBe(true);
      expect(canAccessCrmClients(sessionErp as any)).toBe(true);
    });

    it("bloqueia acesso a crm-clients para usuário sem crm, sem clients e sem erp", () => {
      const sessionTicketsOnly = {
        token: "tok",
        userRole: "admin",
        permissions: ["tickets"],
      };
      expect(canAccessCrmClients(sessionTicketsOnly as any)).toBe(false);
    });
  });
});
