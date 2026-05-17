import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { jwtVerify } from "jose";

export const MEGAADMIN_COOKIE = "megaadmin_session";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  tenantId?: string; // clientId para isolamento multitenante
  userRole?: string; // role do usuário no tenant
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
      console.log('[DEBUG] No MegaAdmin token found in cookie or Authorization header');
      return null;
    }
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "fallback");
    const { payload } = await jwtVerify(raw, secret);
    console.log('[DEBUG] MegaAdmin JWT verified:', { type: payload.type, role: payload.role, sub: payload.sub });
    if (payload.type !== "megaadmin" || payload.role !== "admin") {
      console.log('[DEBUG] Token is not megaadmin admin type');
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
    console.log('[DEBUG] MegaAdmin session error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let tenantId: string | undefined;
  let userRole: string | undefined;

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

  // 4. Extract tenant info from headers or session
  try {
    const sessionData = opts.req.headers?.["x-tenant-id"];
    if (typeof sessionData === "string") {
      tenantId = sessionData;
    }

    const roleData = opts.req.headers?.["x-user-role"];
    if (typeof roleData === "string") {
      userRole = roleData;
    }

    // For test user, use test client ID
    if (!tenantId && user?.openId === 'test-user-dev') {
      tenantId = 'test-client-dev';
    }
  } catch {
    // Ignore errors extracting tenant info
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    tenantId,
    userRole,
  };
}
