import { z } from "zod";
import { router, megadeskProcedure } from "./_core/trpc";
import { getUserSettings } from "./db-user-settings";
import { saveUserConversationBackground, userConversationBackgroundPreference } from "./user-personalization";
import { isConversationBackgroundPresetId } from "../shared/user-personalization";

const cacheIdentity = z.object({
  clientId: z.string().min(1).optional(),
  userEmail: z.string().email().optional(),
});

export const userPersonalizationRouter = router({
  get: megadeskProcedure.input(cacheIdentity).query(async ({ ctx }) => {
    return userConversationBackgroundPreference(await getUserSettings(ctx.tenantId, ctx.operationalUserId));
  }),
  save: megadeskProcedure.input(cacheIdentity.extend({
    backgroundType: z.enum(["default", "preset"]),
    presetId: z.string().max(64).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const presetId = input.backgroundType === "preset" && isConversationBackgroundPresetId(input.presetId) ? input.presetId ?? null : null;
    const backgroundType = presetId ? "preset" : "default";
    await saveUserConversationBackground(
      { tenantId: ctx.tenantId, userId: ctx.operationalUserId },
      { backgroundType, presetId },
    );
    return userConversationBackgroundPreference(await getUserSettings(ctx.tenantId, ctx.operationalUserId));
  }),
});
