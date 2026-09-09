import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ConversationMessageBubbleProps = {
  direction: "incoming" | "outgoing";
  children: ReactNode;
  className?: string;
};

export function conversationMessageBubbleClasses(direction: "incoming" | "outgoing") {
  return direction === "outgoing"
    ? "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm bg-blue-600 text-white"
    : "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm border border-slate-200/80 bg-white/95 text-slate-700";
}

/** Shared visual primitive for real and preview conversation messages. */
export function ConversationMessageBubble({ direction, children, className }: ConversationMessageBubbleProps) {
  const outgoing = direction === "outgoing";

  return (
    <div className={cn("flex", outgoing ? "justify-end" : "justify-start")}>
      <div
        data-testid={`conversation-message-${direction}`}
        className={cn(conversationMessageBubbleClasses(direction), className)}
      >
        {children}
      </div>
    </div>
  );
}
