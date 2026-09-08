import { z } from "zod";
import { router, megadeskProcedure } from "./_core/trpc";
import { getUserSettings } from "./db-user-settings";
import { saveUserConversationBackground } from "./user-personalization";
import {
  DEFAULT_CONVERSATION_BACKGROUND,
  isConversationBackgroundPresetId,
  type ConversationBackgroundPreference,
} from "../shared/user-personalization";

function responseFromSettings(settings: Awaited<ReturnType<typeof getUserSettings>>): ConversationBackgroundPreference {
  const hasCustomImage = Boolean(settings.conversationBackgroundImageKey);
  if (settings.conversationBackgroundType === "preset" && isConversationBackgroundPresetId(settings.conversationBackgroundPresetId)) {
    return { backgroundType: "preset", presetId: settings.conversationBackgroundPresetId, customImageUrl: null, hasCustomImage };
  }
  if (settings.conversationBackgroundType === "custom" && hasCustomImage) {
    return { backgroundType: "custom", presetId: null, customImageUrl: "/api/user-personalization/background", hasCustomImage: true };
  }
  return { ...DEFAULT_CONVERSATION_BACKGROUND, hasCustomImage };
}

const cacheIdentity = z.object({
  clientId: z.string().min(1).optional(),
  userEmail: z.string().email().optional(),
});

export const userPersonalizationRouter = router({
  get: megadeskProcedure.input(cacheIdentity).query(async ({ ctx }) => {
    return responseFromSettings(await getUserSettings(ctx.tenantId, ctx.operationalUserId));
  }),
  save: megadeskProcedure.input(cacheIdentity.extend({
    backgroundType: z.enum(["default", "preset"]),
    presetId: z.string().max(64).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const presetId = input.backgroundType === "preset" && isConversationBackgroundPresetId(input.presetId) ? input.presetId : null;
    const backgroundType = presetId ? "preset" : "default";
    await saveUserConversationBackground(
      { tenantId: ctx.tenantId, userId: ctx.operationalUserId },
      { backgroundType, presetId },
    );
    return responseFromSettings(await getUserSettings(ctx.tenantId, ctx.operationalUserId));
  }),
});
