import { z } from "zod";
import { router, megadeskProcedure } from "./_core/trpc";
import { getUserSettings } from "./db-user-settings";
import {
  saveUserConversationAppearance,
  userConversationBackgroundPreference,
} from "./user-personalization";
import {
  isConversationBackgroundPresetId,
  normalizeConversationBubbleColor,
} from "../shared/user-personalization";

const cacheIdentity = z.object({
  clientId: z.string().min(1).optional(),
  userEmail: z.string().email().optional(),
});

export const userPersonalizationRouter = router({
  get: megadeskProcedure.input(cacheIdentity).query(async ({ ctx }) => {
    return userConversationBackgroundPreference(
      await getUserSettings(ctx.tenantId, ctx.operationalUserId)
    );
  }),
  save: megadeskProcedure
    .input(
      cacheIdentity.extend({
        backgroundType: z.enum(["default", "preset", "custom"]),
        presetId: z.string().max(64).nullable().optional(),
        incomingBubbleColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .nullable()
          .optional(),
        outgoingBubbleColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .nullable()
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const presetId =
        input.backgroundType === "preset" &&
        isConversationBackgroundPresetId(input.presetId)
          ? (input.presetId ?? null)
          : null;
      const backgroundType =
        input.backgroundType === "custom"
          ? "custom"
          : presetId
            ? "preset"
            : "default";
      await saveUserConversationAppearance(
        { tenantId: ctx.tenantId, userId: ctx.operationalUserId },
        {
          backgroundType,
          presetId,
          incomingBubbleColor:
            input.incomingBubbleColor === undefined
              ? undefined
              : normalizeConversationBubbleColor(input.incomingBubbleColor),
          outgoingBubbleColor:
            input.outgoingBubbleColor === undefined
              ? undefined
              : normalizeConversationBubbleColor(input.outgoingBubbleColor),
        }
      );
      return userConversationBackgroundPreference(
        await getUserSettings(ctx.tenantId, ctx.operationalUserId)
      );
    }),
});
