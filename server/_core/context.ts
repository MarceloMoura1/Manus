import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "./types";
import { sdk } from "./sdk";
import { jwtVerify } from "jose";
import { resolveOperationalSession, type OperationalIdentity } from "./megadesk-session";

export const MEGAADMIN_COOKIE = "megaadmin_session";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  tenantId?: string; // clientId para isolamento multitenante
  userRole?: string; // role do usuário no tenant
  userEmail?: string; // identidade da sessão MegaDesk para revalidação autoritativa
  operationalUserId?: string;
  operationalUserRole?: OperationalIdentity["role"];
  operationalSessionId?: string;
  operationalPermissions?: string[];
};

async function tryMegaAdminSession(req: CreateExpressContextOptions["req"]): Promise<User | null> {
  try {
    // Try cookie first, then Authorization Bearer header (localStorage-based auth)
    let raw = req.cookies?.[MEGAADMIN_COOKIE];
    if (!raw) {
      const authHeader = req.headers?.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        raw = authHeader.slice(7);
      }
    }
    if (!raw) {
      process.env.NODE_ENV === 'development' && console.log('[DEBUG] No MegaAdmin token found in cookie or Authorization header');
      return null;
    }
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? (() => { throw new Error("JWT_SECRET não configurado. Defina no .env"); })());
    const { payload } = await jwtVerify(raw, secret);
    process.env.NODE_ENV === 'development' && console.log('[DEBUG] MegaAdmin JWT verified:', { type: payload.type, role: payload.role, sub: payload.sub });
    if (payload.type !== "megaadmin" || payload.role !== "admin") {
      process.env.NODE_ENV === 'development' && console.log('[DEBUG] Token is not megaadmin admin type');
      return null;
    }
    // Construct a synthetic User object that satisfies adminProcedure checks
    return {
      id: 0,
      openId: String(payload.sub ?? ""),
      name: String(payload.name ?? "Admin"),
      email: String(payload.sub ?? ""),
      loginMethod: "megaadmin",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as User;
  } catch (err) {
    process.env.NODE_ENV === 'development' && console.log('[DEBUG] MegaAdmin session error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let operationalSession: Awaited<ReturnType<typeof resolveOperationalSession>> = null;

  // 1. Try Manus OAuth session
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  // 2. Fallback: try MegaAdmin own session cookie
  if (!user) {
    user = await tryMegaAdminSession(opts.req);
  }

  // 3. Fallback: Create test user ONLY if explicitly requested via header
  // This prevents accidentally creating non-admin users when auth fails
  if (!user && opts.req.headers?.['x-allow-test-user'] === 'true') {
    user = {
      id: 1,
      openId: 'test-user-dev',
      name: 'Usuário Teste',
      email: 'test@megadesk.local',
      loginMethod: 'development',
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as User;
  }

  // 4. MegaDesk operational identity comes only from its opaque server session.
  try {
    operationalSession = await resolveOperationalSession(opts.req);
  } catch {
    operationalSession = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    tenantId: operationalSession?.tenantId,
    userRole: operationalSession?.role,
    userEmail: operationalSession?.userEmail,
    operationalUserId: operationalSession?.userId,
    operationalUserRole: operationalSession?.role,
    operationalSessionId: operationalSession?.sessionId,
    operationalPermissions: operationalSession?.permissions,
  };
}
