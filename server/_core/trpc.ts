import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { assertOperationalCsrf } from "./megadesk-session";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const isolatedProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

// MegaDesk procedures require an opaque server-side session.
const requireTenant = t.middleware(async opts => {
  const { ctx, next } = opts;
  const tenantId = ctx.tenantId;
  const trustedTestContext = process.env.NODE_ENV === "test"
    && !ctx.operationalSessionId
    && Boolean(ctx.operationalUserId || tenantId);
  if (!tenantId || tenantId.trim() === '' || (!ctx.operationalSessionId && !trustedTestContext)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessão MegaDesk inválida. Faça login novamente." });
  }
  const headers = ctx.req?.headers ?? {};
  const legacyTenant = headers["x-tenant-id"];
  const legacyEmail = headers["x-user-email"];
  const legacyRole = headers["x-user-role"];
  if ((typeof legacyTenant === "string" && legacyTenant !== tenantId)
    || (typeof legacyEmail === "string" && legacyEmail.trim().toLowerCase() !== ctx.userEmail)
    || (typeof legacyRole === "string" && legacyRole !== ctx.operationalUserRole)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso operacional indisponível." });
  }
  const rawInput = await opts.getRawInput();
  if (rawInput && typeof rawInput === "object" && "clientId" in rawInput) {
    const requestedTenant = (rawInput as { clientId?: unknown }).clientId;
    if (typeof requestedTenant === "string" && requestedTenant !== tenantId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Acesso operacional indisponível." });
    }
  }
  if (rawInput && typeof rawInput === "object" && "userEmail" in rawInput) {
    const requestedUser = (rawInput as { userEmail?: unknown }).userEmail;
    if (typeof requestedUser === "string" && ctx.userEmail && requestedUser.trim().toLowerCase() !== ctx.userEmail) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Acesso operacional indisponível." });
    }
  }
  if (opts.type === "mutation" && !trustedTestContext) {
    try { assertOperationalCsrf(ctx.req); }
    catch { throw new TRPCError({ code: "FORBIDDEN", message: "Origem da requisição não autorizada." }); }
  }
  if (trustedTestContext) return next({ ctx: {
    ...ctx,
    tenantId,
    userEmail: ctx.userEmail ?? "test@example.invalid",
    operationalUserId: ctx.operationalUserId ?? "test-operational-user",
    operationalUserRole: ctx.operationalUserRole ?? "admin",
  } });
  if (!ctx.userEmail || !ctx.operationalUserId || !ctx.operationalUserRole) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessão MegaDesk inválida. Faça login novamente." });
  }
  return next({ ctx: { ...ctx, tenantId, userEmail: ctx.userEmail, operationalUserId: ctx.operationalUserId, operationalUserRole: ctx.operationalUserRole } });
});
export const megadeskProcedure = t.procedure.use(requireTenant);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
