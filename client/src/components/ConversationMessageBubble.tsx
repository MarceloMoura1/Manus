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

type RgbColor = { red: number; green: number; blue: number };

function hexToRgb(color: string): RgbColor {
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
  };
}

function rgbToHex({ red, green, blue }: RgbColor) {
  return `#${[red, green, blue]
    .map(channel => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function mixBubbleColor(
  color: string,
  target: RgbColor,
  amount: number
) {
  const source = hexToRgb(color);
  const mix = (channel: keyof RgbColor) =>
    Math.round(source[channel] * (1 - amount) + target[channel] * amount);
  return rgbToHex({ red: mix("red"), green: mix("green"), blue: mix("blue") });
}

/**
 * Derives restrained tonal stops from a persisted base colour. The low stop
 * uses slate rather than pure black so very dark colours retain their hue.
 */
export function conversationMessageBubbleGradient(color: string) {
  const lighter = mixBubbleColor(color, { red: 255, green: 255, blue: 255 }, 0.18);
  const darker = mixBubbleColor(color, { red: 15, green: 23, blue: 42 }, 0.16);
  return `linear-gradient(135deg, ${lighter} 0%, ${color} 52%, ${darker} 100%)`;
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
    backgroundImage: conversationMessageBubbleGradient(backgroundColor),
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
