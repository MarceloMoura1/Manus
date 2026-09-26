import { z } from "zod";

export const conversationAttachmentSendInput = z.object({
  conversationId: z.string().min(1),
  kind: z.enum(["image", "video", "audio", "document", "sticker"]),
  dataUrl: z.string().min(20).max(30_000_000),
  mimeType: z.string().min(3).max(120),
  fileName: z.string().max(255).optional(),
  mediaSource: z.enum(["recording", "attachment"]).optional(),
  caption: z.string().max(2000).optional(),
  userEmail: z.string().email(),
  clientAttemptId: z.string().uuid(),
  replyToMessageId: z.string().min(1).max(100).optional(),
}).superRefine((input, context) => {
  if (input.kind === "audio" && input.mediaSource === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mediaSource"],
      message: "Audio source is required.",
    });
  }
});
