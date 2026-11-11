import { TRPCError } from "@trpc/server";
import { router, isolatedProcedure } from "../../_core/trpc";
import { resolveAssistantIdentity } from "./assistant-threads.router";
import {
  DEFAULT_ROUTINE_PRESETS,
  upsertRoutineSchema,
  toggleRoutineActiveSchema,
  deleteRoutineSchema,
  runRoutineNowSchema,
} from "./contracts";
import {
  AssistantRoutinesRepository,
  assistantRoutinesRepository,
} from "./routines-repository";
import { executeRoutine } from "./routine-executor";

export function createAssistantRoutinesRouter(
  repo: AssistantRoutinesRepository = assistantRoutinesRepository,
  executor: typeof executeRoutine = executeRoutine
) {
  return router({
    listRoutines: isolatedProcedure.query(async ({ ctx }) => {
      const identity = resolveAssistantIdentity(ctx);
      const routines = await repo.listRoutines(identity.tenantId, identity.userId);
      const recentLogs = await repo.listRecentLogs(identity.tenantId, 5);

      return {
        routines,
        recentLogs,
        presets: DEFAULT_ROUTINE_PRESETS,
      };
    }),

    upsertRoutine: isolatedProcedure
      .input(upsertRoutineSchema)
      .mutation(async ({ ctx, input }) => {
        const identity = resolveAssistantIdentity(ctx);
        const routine = await repo.upsertRoutine(
          identity.tenantId,
          identity.userId,
          input
        );
        return {
          ok: true,
          routine,
        };
      }),

    toggleRoutineActive: isolatedProcedure
      .input(toggleRoutineActiveSchema)
      .mutation(async ({ ctx, input }) => {
        const identity = resolveAssistantIdentity(ctx);
        const routine = await repo.toggleRoutineActive(
          identity.tenantId,
          input.id,
          input.isActive
        );
        return {
          ok: true,
          routine,
        };
      }),

    deleteRoutine: isolatedProcedure
      .input(deleteRoutineSchema)
      .mutation(async ({ ctx, input }) => {
        const identity = resolveAssistantIdentity(ctx);
        await repo.deleteRoutine(identity.tenantId, input.id);
        return {
          ok: true,
          id: input.id,
        };
      }),

    runRoutineNow: isolatedProcedure
      .input(runRoutineNowSchema)
      .mutation(async ({ ctx, input }) => {
        const identity = resolveAssistantIdentity(ctx);
        const routine = await repo.getRoutine(identity.tenantId, input.id);
        if (!routine) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Rotina não encontrada ou acesso não autorizado.",
          });
        }

        const result = await executor(routine);
        return {
          ok: result.success,
          status: result.status,
          outputSummary: result.outputSummary,
          threadId: result.threadId,
        };
      }),
  });
}

export const assistantRoutinesRouter = createAssistantRoutinesRouter();
export type AssistantRoutinesRouter = typeof assistantRoutinesRouter;
