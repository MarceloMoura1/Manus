import { ArrowRightLeft, Bot, CheckCircle2, Link2, MessageCircle, RotateCcw } from "lucide-react";
import type { ConversationActivityEvent as ConversationActivity } from "@/lib/conversationTimeline";

type ActivityPresentation = {
  icon: typeof MessageCircle;
  label: string;
  tone: string;
};

function actorName(event: ConversationActivity) {
  return event.actorName?.trim() || "Sistema";
}

function activityPresentation(event: ConversationActivity): ActivityPresentation {
  const actor = actorName(event);
  switch (event.eventType) {
    case "created_inbound":
      return { icon: MessageCircle, label: "Atendimento iniciado pelo WhatsApp.", tone: "border-sky-200 bg-sky-50 text-sky-800" };
    case "created_outbound":
      return { icon: MessageCircle, label: `Atendimento iniciado por ${actor}.`, tone: "border-sky-200 bg-sky-50 text-sky-800" };
    case "claimed":
      return { icon: Bot, label: `Conversa assumida por ${actor}.`, tone: "border-violet-200 bg-violet-50 text-violet-800" };
    case "transferred":
      return {
        icon: ArrowRightLeft,
        label: `${event.fromUserName?.trim() || actor} transferiu a conversa para ${event.toUserName?.trim() || "atendente"}.`,
        tone: "border-amber-200 bg-amber-50 text-amber-900",
      };
    case "closed":
      return { icon: CheckCircle2, label: `Atendimento encerrado por ${actor}.`, tone: "border-emerald-200 bg-emerald-50 text-emerald-800" };
    case "reopened":
      return { icon: RotateCcw, label: `Atendimento reaberto por ${actor}.`, tone: "border-blue-200 bg-blue-50 text-blue-800" };
    case "ticket_linked":
      return { icon: Link2, label: `Chamado vinculado por ${actor}.`, tone: "border-slate-200 bg-slate-50 text-slate-700" };
    default:
      return { icon: MessageCircle, label: "Atividade registrada no atendimento.", tone: "border-slate-200 bg-slate-50 text-slate-700" };
  }
}

function activityTime(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ConversationActivityEvent({ event, compact = false }: { event: ConversationActivity; compact?: boolean }) {
  const presentation = activityPresentation(event);
  const Icon = presentation.icon;
  return (
    <div data-testid="conversation-activity-event" className={compact ? "py-1" : "py-1.5"}>
      <div className={`mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-sm ${presentation.tone}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{presentation.label}</span>
        {activityTime(event.timestamp) && <time className="shrink-0 text-[11px] opacity-70">{activityTime(event.timestamp)}</time>}
      </div>
    </div>
  );
}
