import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../../../_core/trpc";
import { sendMessageSchema } from "./contracts";
import { hermesService } from "./service";

export function resolveAdminUserId(user: {
  email?: string | null;
  openId?: string | null;
  id?: number | string;
}): string {
  const identifier = user.email || user.openId || (user.id ? String(user.id) : "");
  if (!identifier) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Identificador do administrador não encontrado na sessão.",
    });
  }
  return identifier.toLowerCase().trim();
}

export function createHermesRouter(service = hermesService) {
  return router({
    getHistory: adminProcedure.query(async ({ ctx }) => {
      const adminUserId = resolveAdminUserId(ctx.user);
      const messages = await service.getHistory(adminUserId);
      return {
        adminUserId,
        messages,
      };
    }),

    sendMessage: adminProcedure
      .input(sendMessageSchema)
      .mutation(async ({ ctx, input }) => {
        const adminUserId = resolveAdminUserId(ctx.user);
        return service.sendMessage(adminUserId, input.message);
      }),

    clearHistory: adminProcedure.mutation(async ({ ctx }) => {
      const adminUserId = resolveAdminUserId(ctx.user);
      return service.clearHistory(adminUserId);
    }),

    getQuickStats: adminProcedure.query(async () => {
      return service.getQuickStats();
    }),
  });
}

export const hermesRouter = createHermesRouter();

export type HermesRouter = typeof hermesRouter;
