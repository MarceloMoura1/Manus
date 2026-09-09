import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  conversationBubbleForegroundColor,
  normalizeConversationBackgroundPreference,
  type ConversationBackgroundPreference,
  type ConversationBubbleDirection,
} from "@shared/user-personalization";

type ConversationMessageBubbleProps = {
  direction: ConversationBubbleDirection;
  children: ReactNode;
  className?: string;
  preference?: ConversationBackgroundPreference | null;
};

/** Shared spacing used by the real Conversations canvas and the personalization preview. */
export const conversationMessageAreaClasses =
  "min-h-0 space-y-3 overflow-y-auto p-4";

export function conversationMessageBubbleClasses(
  direction: ConversationBubbleDirection
) {
  return direction === "outgoing"
    ? "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm bg-blue-600 text-white"
    : "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm border border-slate-200/80 bg-white/95 text-slate-700";
}

/** Resolves only normalized persisted colours; null deliberately leaves the legacy classes untouched. */
export function conversationMessageBubbleStyle(
  direction: ConversationBubbleDirection,
  preference?: ConversationBackgroundPreference | null
): CSSProperties | undefined {
  const normalized = normalizeConversationBackgroundPreference(preference);
  const backgroundColor =
    direction === "incoming"
      ? normalized.incomingBubbleColor
      : normalized.outgoingBubbleColor;
  if (!backgroundColor) return undefined;
  return {
    backgroundColor,
    color: conversationBubbleForegroundColor(backgroundColor),
    ...(direction === "incoming" ? { borderColor: backgroundColor } : {}),
  };
}

/** Shared visual primitive for real and preview conversation messages. */
export function ConversationMessageBubble({
  direction,
  children,
  className,
  preference,
}: ConversationMessageBubbleProps) {
  const outgoing = direction === "outgoing";
  const style = conversationMessageBubbleStyle(direction, preference);

  return (
    <div className={cn("flex", outgoing ? "justify-end" : "justify-start")}>
      <div
        data-testid={`conversation-message-${direction}`}
        data-bubble-color={style?.backgroundColor ?? "default"}
        className={cn(conversationMessageBubbleClasses(direction), className)}
        style={style}
      >
        {children}
      </div>
    </div>
  );
}
