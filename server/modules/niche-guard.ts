import { TRPCError } from "@trpc/server";
import type mysql from "mysql2/promise";
import { getPool } from "../db";
import {
  isModuleEnabled,
  resolveTenantEnabledModules,
  type TenantModuleKey,
  type TenantNicheProfile,
} from "../../shared/tenant-modules";

export interface TenantNicheContext {
  clientId: string;
  nicheProfile: TenantNicheProfile;
  enabledModules: TenantModuleKey[];
}

export type NicheQueryExecutor = Pick<mysql.Pool, "execute">;

/**
 * Consulta niche_profile e enabled_modules diretamente do banco MySQL
 * para o tenant informado. Nunca confia em valores enviados pelo cliente/browser.
 */
export async function getTenantNicheContext(
  clientId: string,
  pool: NicheQueryExecutor = getPool()
): Promise<TenantNicheContext | null> {
  const normalizedId = String(clientId ?? "").trim();
  if (!normalizedId) return null;

  const [rows] = (await pool.execute(
    "SELECT niche_profile, enabled_modules FROM megadesk_domain_clients WHERE client_id = ? LIMIT 1",
    [normalizedId]
  )) as any[];

  const row = rows?.[0];
  if (!row) return null;

  const rawProfile = String(row.niche_profile || "personalizado").trim();
  const nicheProfile = (
    ["restaurante", "prestacao_servicos", "ecommerce", "personalizado"].includes(rawProfile)
      ? rawProfile
      : "personalizado"
  ) as TenantNicheProfile;

  const enabledModules = resolveTenantEnabledModules(nicheProfile, row.enabled_modules);
  return {
    clientId: normalizedId,
    nicheProfile,
    enabledModules,
  };
}

/**
 * Garante isolamento estrito de nicho no backend.
 * Lança TRPCError FORBIDDEN caso o tenant não exista ou não pertença
 * a um dos nichos explicitamente permitidos.
 */
export async function assertTenantNiche(
  clientId: string,
  allowedNiches: readonly TenantNicheProfile[],
  pool: NicheQueryExecutor = getPool()
): Promise<TenantNicheContext> {
  const ctx = await getTenantNicheContext(clientId, pool);
  if (!ctx) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tenant não encontrado ou sem permissão para acessar este recurso.",
    });
  }

  if (!allowedNiches.includes(ctx.nicheProfile)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Recurso exclusivo para o nicho ${allowedNiches.join(", ")}. Acesso bloqueado para o perfil "${ctx.nicheProfile}".`,
    });
  }

  return ctx;
}

/**
 * Garante no backend que um módulo específico está habilitado para o tenant.
 * Lança TRPCError FORBIDDEN caso o módulo esteja desabilitado.
 */
export async function assertTenantModule(
  clientId: string,
  moduleKey: TenantModuleKey,
  pool: NicheQueryExecutor = getPool()
): Promise<TenantNicheContext> {
  const ctx = await getTenantNicheContext(clientId, pool);
  if (!ctx) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tenant não encontrado ou sem permissão para acessar este módulo.",
    });
  }

  if (!isModuleEnabled(ctx.enabledModules, moduleKey)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Módulo "${moduleKey}" não está habilitado para este tenant.`,
    });
  }

  return ctx;
}

