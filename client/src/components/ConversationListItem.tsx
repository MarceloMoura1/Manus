import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatConversationListTimestamp, getConversationChannelPresentation } from "@/lib/conversation-list-presentation";

type ConversationListItemProps = {
  name: string;
  lastMessage?: string | null;
  timestamp?: string | number | null;
  unreadCount?: number | null;
  provider?: string | null;
  channel?: string | null;
  selected: boolean;
  closed?: boolean;
  avatarColor: string;
  initials: string;
  onSelect: () => void;
};

export function ConversationListItem({ name, lastMessage, timestamp, unreadCount, provider, channel, selected, closed, avatarColor, initials, onSelect }: ConversationListItemProps) {
  const channelPresentation = getConversationChannelPresentation(provider, channel);
  const unread = Number(unreadCount ?? 0);
  return <button
    type="button"
    data-testid="conversation-list-item"
    data-selected={selected ? "true" : "false"}
    onClick={onSelect}
    className={cn(
      "relative flex w-full min-w-0 items-center gap-3 border-l-2 px-4 py-3 text-left transition-colors duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500",
      selected ? "border-l-violet-600 bg-violet-50/70" : "border-l-transparent bg-white hover:bg-slate-50",
      closed && !selected && "bg-slate-50/50",
    )}
  >
    <span className={cn("relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white", avatarColor)} aria-hidden="true">
      {initials}
      {channelPresentation && <span data-testid="conversation-channel-badge" aria-label={`Canal ${channelPresentation.label}`} title={channelPresentation.label} className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-white shadow-sm">
        <MessageCircle className="h-2.5 w-2.5" strokeWidth={2.5} />
      </span>}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold leading-5", unread > 0 ? "text-slate-900" : "text-slate-800")}>{name}</span>
        <span data-testid="conversation-list-timestamp" className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400">{formatConversationListTimestamp(timestamp)}</span>
      </span>
      <span className="mt-0.5 flex min-w-0 items-center gap-2">
        <span data-testid="conversation-list-preview" className={cn("min-w-0 flex-1 truncate text-xs leading-5", unread > 0 ? "font-medium text-slate-600" : "text-slate-500")}>{lastMessage || "Sem mensagens"}</span>
        {unread > 0 && <span data-testid="conversation-unread-badge" aria-label={`${unread} mensagem${unread === 1 ? "" : "ens"} não lida${unread === 1 ? "" : "s"}`} className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 px-1.5 text-[11px] font-bold tabular-nums text-white">{unread}</span>}
      </span>
    </span>
    <span data-testid="conversation-list-divider" aria-hidden="true" className="pointer-events-none absolute bottom-0 left-[4.25rem] right-4 h-px bg-slate-200/90" />
  </button>;
}
