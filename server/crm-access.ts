import { TRPCError } from "@trpc/server";

const CRM_ROLES = new Set(["admin", "manager"]);

export type CrmAccessContext = {
  tenantId: string;
  operationalUserRole?: string;
  operationalPermissions?: string[];
};

export function hasCrmAccess(context: Pick<CrmAccessContext, "operationalUserRole" | "operationalPermissions">): boolean {
  if (!context.operationalUserRole || !CRM_ROLES.has(context.operationalUserRole)) return false;
  return !context.operationalPermissions
    || context.operationalPermissions.some(permission => permission === "clients" || permission === "erp");
}

export function requireCrmAccess(context: CrmAccessContext): string {
  if (!hasCrmAccess(context)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso a Clientes indisponível." });
  }
  return context.tenantId;
}

export function hasDedicatedCrmAccess(context: Pick<CrmAccessContext, "operationalUserRole" | "operationalPermissions">): boolean {
  if (!context.operationalPermissions || !Array.isArray(context.operationalPermissions)) {
    return false;
  }
  return context.operationalPermissions.includes("crm");
}

export function requireDedicatedCrmAccess(context: CrmAccessContext): string {
  if (!hasDedicatedCrmAccess(context)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso ao CRM indisponível." });
  }
  return context.tenantId;
}

export function requireCrmAdmin(context: Pick<CrmAccessContext, "operationalUserRole">): void {
  if (context.operationalUserRole !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Somente administradores podem excluir clientes definitivamente." });
  }
}

export const CRM_COMMERCIAL_ROLES = new Set(["admin", "manager", "agent", "user"]);
export const CRM_LIFECYCLE_ROLES = new Set(["admin", "manager"]);
export const CRM_ADMIN_ROLES = new Set(["admin"]);

export function requireTenantId(context: Pick<CrmAccessContext, "tenantId">): string {
  if (!context.tenantId || typeof context.tenantId !== "string" || !context.tenantId.trim()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Identificador de tenant inválido ou ausente." });
  }
  return context.tenantId.trim();
}

/**
 * Operações comerciais ordinárias (consultar, cadastrar, editar, timeline, chamados, conversas, arquivos).
 * Autoriza se tiver a permissão dedicada `crm` OU as permissões legadas (`clients` ou `erp`),
 * desde que o papel operacional seja compatível (admin, manager, agent, user).
 */
export function hasCrmCustomerCommercialAccess(
  context: Pick<CrmAccessContext, "operationalUserRole" | "operationalPermissions">
): boolean {
  if (!context.operationalUserRole || !CRM_COMMERCIAL_ROLES.has(context.operationalUserRole)) {
    return false;
  }
  if (!context.operationalPermissions || !Array.isArray(context.operationalPermissions)) {
    return false;
  }
  if (context.operationalPermissions.includes("crm")) {
    return true;
  }
  if (context.operationalUserRole === "admin" || context.operationalUserRole === "manager") {
    return context.operationalPermissions.some(
      permission => permission === "clients" || permission === "erp"
    );
  }
  return false;
}

export function requireCrmCustomerCommercialAccess(context: CrmAccessContext): string {
  const tenantId = requireTenantId(context);
  if (!hasCrmCustomerCommercialAccess(context)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso a Clientes indisponível." });
  }
  return tenantId;
}

/**
 * Operações privilegiadas de ciclo de vida (desativar, reativar, arquivar, restaurar).
 * Restritas a papéis de gestão (admin, manager) com permissão crm ou clientes/erp.
 */
export function hasCrmCustomerLifecycleAccess(
  context: Pick<CrmAccessContext, "operationalUserRole" | "operationalPermissions">
): boolean {
  if (!context.operationalUserRole || !CRM_LIFECYCLE_ROLES.has(context.operationalUserRole)) {
    return false;
  }
  if (!context.operationalPermissions || !Array.isArray(context.operationalPermissions)) {
    return false;
  }
  return context.operationalPermissions.some(
    permission => permission === "crm" || permission === "clients" || permission === "erp"
  );
}

export function requireCrmCustomerLifecycleAccess(context: CrmAccessContext): string {
  const tenantId = requireTenantId(context);
  if (!hasCrmCustomerCommercialAccess(context)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso a Clientes indisponível." });
  }
  if (!hasCrmCustomerLifecycleAccess(context)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Somente administradores e gerentes podem alterar o ciclo de vida de clientes.",
    });
  }
  return tenantId;
}

/**
 * Operações de exclusão definitiva de clientes.
 * Restritas a administradores com permissão crm ou clientes/erp.
 */
export function hasCrmCustomerAdminAccess(
  context: Pick<CrmAccessContext, "operationalUserRole" | "operationalPermissions">
): boolean {
  if (context.operationalUserRole !== "admin") {
    return false;
  }
  if (!context.operationalPermissions || !Array.isArray(context.operationalPermissions)) {
    return false;
  }
  return context.operationalPermissions.some(
    permission => permission === "crm" || permission === "clients" || permission === "erp"
  );
}

export function requireCrmCustomerAdminAccess(context: CrmAccessContext): string {
  const tenantId = requireTenantId(context);
  if (!hasCrmCustomerCommercialAccess(context)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso a Clientes indisponível." });
  }
  if (context.operationalUserRole !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Somente administradores podem excluir clientes definitivamente." });
  }
  return tenantId;
}

/**
 * Operações do módulo de Leads (Etapa 2B.3).
 * Exige estritamente a permissão dedicada `crm` (permissões legadas `clients` ou `erp` NÃO concedem acesso).
 */
export function hasCrmLeadAccess(
  context: Pick<CrmAccessContext, "tenantId" | "operationalUserRole" | "operationalPermissions">
): boolean {
  if (!context.tenantId || typeof context.tenantId !== "string" || !context.tenantId.trim()) {
    return false;
  }
  if (!context.operationalUserRole || !CRM_COMMERCIAL_ROLES.has(context.operationalUserRole)) {
    return false;
  }
  if (!context.operationalPermissions || !Array.isArray(context.operationalPermissions)) {
    return false;
  }
  return context.operationalPermissions.includes("crm");
}

export function requireCrmLeadAccess(context: CrmAccessContext): string {
  if (!context.tenantId || typeof context.tenantId !== "string" || !context.tenantId.trim()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sessão operacional sem empresa identificada." });
  }
  if (!hasCrmLeadAccess(context)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito ao módulo CRM." });
  }
  return context.tenantId.trim();
}

/**
 * Operações do módulo de Oportunidades e Funil de Vendas (Etapa 2B.4).
 * Exige estritamente a permissão dedicada `crm` (permissões legadas `clients` ou `erp` NÃO concedem acesso).
 */
export function hasCrmOpportunityAccess(
  context: Pick<CrmAccessContext, "tenantId" | "operationalUserRole" | "operationalPermissions">
): boolean {
  if (!context.tenantId || typeof context.tenantId !== "string" || !context.tenantId.trim()) {
    return false;
  }
  if (!context.operationalUserRole || !CRM_COMMERCIAL_ROLES.has(context.operationalUserRole)) {
    return false;
  }
  if (!context.operationalPermissions || !Array.isArray(context.operationalPermissions)) {
    return false;
  }
  return context.operationalPermissions.includes("crm");
}

export function requireCrmOpportunityAccess(context: CrmAccessContext): string {
  if (!context.tenantId || typeof context.tenantId !== "string" || !context.tenantId.trim()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sessão operacional sem empresa identificada." });
  }
  if (!hasCrmOpportunityAccess(context)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito ao módulo CRM." });
  }
  return context.tenantId.trim();
}

/**
 * Operações administrativas / de ciclo de vida do funil (configurar pipelines e estágios).
 * Restritas a administradores e gerentes com permissão crm dedicada.
 */
export function hasCrmPipelineAdminAccess(
  context: Pick<CrmAccessContext, "tenantId" | "operationalUserRole" | "operationalPermissions">
): boolean {
  if (!hasCrmOpportunityAccess(context)) {
    return false;
  }
  return context.operationalUserRole ? CRM_LIFECYCLE_ROLES.has(context.operationalUserRole) : false;
}

export function requireCrmPipelineAdminAccess(context: CrmAccessContext): string {
  const tenantId = requireCrmOpportunityAccess(context);
  if (!hasCrmPipelineAdminAccess(context)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Somente administradores e gerentes podem alterar configurações do funil de vendas.",
    });
  }
  return tenantId;
}
