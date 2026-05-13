/**
 * Contexto de Tenant
 * Fornece acesso ao banco de dados correto baseado no cliente logado
 */

import { getTenantConnection } from "./tenant-db-manager";
import type { TrpcContext } from "./context";

interface TenantContextData {
  clientId: string;
  databaseName: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
}

// Armazena contexto do tenant por request
const tenantContextMap = new WeakMap<any, TenantContextData>();

/**
 * Define contexto de tenant para uma requisição
 */
export function setTenantContext(req: any, data: TenantContextData): void {
  tenantContextMap.set(req, data);
}

/**
 * Obtém contexto de tenant de uma requisição
 */
export function getTenantContext(req: any): TenantContextData | undefined {
  return tenantContextMap.get(req);
}

/**
 * Extrai clientId do contexto ou headers
 */
export function extractClientId(ctx: TrpcContext): string | undefined {
  // Tenta extrair de headers
  const clientIdFromHeader = ctx.req.headers["x-client-id"] as string | undefined;
  if (clientIdFromHeader) return clientIdFromHeader;

  // Tenta extrair de query params (se disponível)
  const url = (ctx.req as any).url as string | undefined;
  if (url) {
    const urlObj = new URL(url, "http://localhost");
    const clientId = urlObj.searchParams.get("clientId");
    if (clientId) return clientId;
  }

  return undefined;
}

/**
 * Middleware para injetar conexão de tenant no contexto
 */
export async function withTenantConnection(
  ctx: TrpcContext,
  clientId: string,
  databaseName: string
): Promise<TrpcContext & { tenantDb: Awaited<ReturnType<typeof getTenantConnection>>["db"] }> {
  try {
    const tenantConnection = await getTenantConnection(clientId, databaseName);

    return {
      ...ctx,
      tenantDb: tenantConnection.db,
      clientId,
      databaseName,
    };
  } catch (error) {
    console.error(`Erro ao conectar ao banco do tenant ${clientId}:`, error);
    throw new Error(`Falha ao conectar ao banco de dados do cliente: ${error instanceof Error ? error.message : "Desconhecido"}`);
  }
}

/**
 * Valida se o cliente existe e está ativo
 */
export async function validateTenantAccess(
  clientId: string,
  databaseName: string
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const tenantConnection = await getTenantConnection(clientId, databaseName);

    // Tenta fazer uma query simples para validar conexão
    const result = await tenantConnection.db.execute(
      "SELECT 1 as test"
    );

    if (result) {
      return { valid: true };
    }

    return { valid: false, reason: "Banco de dados não respondeu" };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}

/**
 * Extrai informações de tenant da sessão do usuário
 */
export function extractTenantFromSession(session: any): { clientId: string; databaseName: string } | null {
  if (!session?.clientId || !session?.tenantDatabaseName) {
    return null;
  }

  return {
    clientId: session.clientId,
    databaseName: session.tenantDatabaseName,
  };
}
