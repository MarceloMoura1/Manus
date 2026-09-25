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

export function requireCrmAdmin(context: Pick<CrmAccessContext, "operationalUserRole">): void {
  if (context.operationalUserRole !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Somente administradores podem excluir clientes definitivamente." });
  }
}
