import { MessageCircle } from "lucide-react";
import { ConversationBackground } from "@/components/ConversationBackground";
import { ConversationMessageBubble } from "@/components/ConversationMessageBubble";
import type { ConversationBackgroundPreference } from "@shared/user-personalization";

type ConversationAppearancePreviewProps = {
  preference: ConversationBackgroundPreference;
};

/** Presentation-only canvas that deliberately reuses the production message bubble. */
export function ConversationAppearancePreview({
  preference,
}: ConversationAppearancePreviewProps) {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      aria-labelledby="conversation-preview-title"
      data-testid="conversation-appearance-preview"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-800"
            aria-hidden="true"
          >
            AM
          </span>
          <div className="min-w-0">
            <h3
              id="conversation-preview-title"
              className="truncate text-sm font-semibold text-slate-950"
            >
              Atendimento MegaDesk
            </h3>
            <p className="mt-0.5 text-xs text-emerald-700">Disponível</p>
          </div>
        </div>
        <span
          className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500"
          aria-label="Prévia de conversa"
        >
          <MessageCircle className="size-4" />
        </span>
      </div>

      <ConversationBackground
        preference={preference}
        className="min-h-[25rem] p-4 sm:min-h-[29rem] sm:p-5"
      >
        <div
          className="flex h-full max-w-xl flex-col justify-end gap-3"
          data-testid="conversation-preview-message-area"
        >
          <ConversationMessageBubble direction="incoming">
            <p>Olá! Preciso de uma atualização sobre meu atendimento.</p>
            <time
              className="mt-1 block text-[10px] text-slate-400"
              dateTime="2026-09-09T10:30:00"
            >
              10:30
            </time>
          </ConversationMessageBubble>
          <ConversationMessageBubble direction="outgoing">
            <p>Claro! Vou verificar os detalhes para você.</p>
            <time
              className="mt-1 block text-[10px] text-blue-100"
              dateTime="2026-09-09T10:31:00"
            >
              10:31
            </time>
          </ConversationMessageBubble>
          <ConversationMessageBubble direction="incoming">
            <p>Perfeito, obrigada pela ajuda.</p>
            <time
              className="mt-1 block text-[10px] text-slate-400"
              dateTime="2026-09-09T10:31:30"
            >
              10:31
            </time>
          </ConversationMessageBubble>
        </div>
      </ConversationBackground>

      <div className="border-t border-slate-100 bg-white px-4 py-3 text-xs text-slate-500 sm:px-5">
        Prévia ao vivo da área de mensagens
      </div>
    </section>
  );
}
