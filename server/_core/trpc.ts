import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { validateOperationalAccess } from "./tenant-lifecycle";

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

// Procedure para o MegaDesk: valida tenantId via header x-tenant-id sem exigir Manus OAuth
const requireTenant = t.middleware(async opts => {
  const { ctx, next } = opts;
  const tenantId = ctx.tenantId;
  if (!tenantId || tenantId.trim() === '') {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessão MegaDesk inválida. Faça login novamente." });
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
  if (process.env.NODE_ENV === "test") return next({ ctx: { ...ctx, tenantId, userEmail: ctx.userEmail ?? "test@example.invalid" } });
  const userEmail = ctx.userEmail;
  if (!userEmail) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessão MegaDesk inválida. Faça login novamente." });
  try { await validateOperationalAccess({ clientId: tenantId, userEmail }); }
  catch { throw new TRPCError({ code: "FORBIDDEN", message: "Acesso operacional indisponível." }); }
  return next({ ctx: { ...ctx, tenantId, userEmail } });
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
