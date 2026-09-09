import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, ImagePlus, Loader2, Palette, RotateCcw, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConversationBackground } from "@/components/ConversationBackground";
import { ConversationMessageBubble } from "@/components/ConversationMessageBubble";
import { trpc } from "@/lib/trpc";
import {
  isUserPersonalizationBackgroundPath,
  userPersonalizationBackgroundUrl,
} from "@/lib/trpc-url";
import { useUserPersonalization } from "@/hooks/useUserPersonalization";
import {
  CONVERSATION_BACKGROUND_PRESETS,
  DEFAULT_CONVERSATION_BACKGROUND,
  normalizeConversationBackgroundPreference,
  type ConversationBackgroundPreference,
} from "@shared/user-personalization";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
type PersonalizationIdentity = { clientId?: string; userEmail?: string };
type CustomBackgroundUploadResponse = {
  ok?: boolean;
  preference?: Partial<ConversationBackgroundPreference>;
};

export function hasUnsavedConversationBackground(
  draft: ConversationBackgroundPreference | null,
  saved: ConversationBackgroundPreference,
  hasPendingImage: boolean,
) {
  if (!draft) return false;
  if (hasPendingImage) return true;
  return draft.backgroundType !== saved.backgroundType || draft.presetId !== saved.presetId;
}

export function conversationBackgroundSaveInput(
  draft: ConversationBackgroundPreference,
  identity: PersonalizationIdentity,
) {
  return {
    ...identity,
    backgroundType: draft.backgroundType === "preset" ? "preset" as const : "default" as const,
    presetId: draft.backgroundType === "preset" ? draft.presetId : null,
  };
}

export function persistedCustomBackgroundFromUpload(value: unknown): ConversationBackgroundPreference | null {
  const response = value as CustomBackgroundUploadResponse | null;
  if (!response?.ok) return null;
  const preference = normalizeConversationBackgroundPreference(response.preference);
  return preference.backgroundType === "custom" && isUserPersonalizationBackgroundPath(preference.customImageUrl) ? preference : null;
}

export function UserPersonalizationTab() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ConversationBackgroundPreference | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const personalization = useUserPersonalization();
  const utils = trpc.useUtils();
  const saveMutation = trpc.userPersonalization.save.useMutation();
  const visiblePreference = preview ?? personalization.preference;
  const isSaving = saveMutation.isPending || uploading;
  const canPersist = Boolean(personalization.cacheIdentity.clientId && personalization.cacheIdentity.userEmail);
  const hasUnsavedChanges = hasUnsavedConversationBackground(preview, personalization.preference, Boolean(pendingImage));

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  const selectBackground = (backgroundType: "default" | "preset", presetId?: string) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setPendingImage(null);
    setObjectUrl(null);
    setPreview(backgroundType === "preset"
      ? normalizeConversationBackgroundPreference({ backgroundType, presetId: presetId ?? null, customImageUrl: null, hasCustomImage: false })
      : DEFAULT_CONVERSATION_BACKGROUND);
  };

  const selectImage = (file: File) => {
    if (!ACCEPTED_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      toast.error("Use uma imagem JPG, PNG ou WebP de até 5 MB.");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(nextUrl);
    setPendingImage(file);
    setPreview({ backgroundType: "custom", presetId: null, customImageUrl: nextUrl, hasCustomImage: true });
  };

  const save = async () => {
    if (!preview || !hasUnsavedChanges || !canPersist || isSaving) return;

    if (preview.backgroundType === "custom") {
      if (!pendingImage) return;
      setUploading(true);
      try {
        const response = await fetch(userPersonalizationBackgroundUrl(), {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": pendingImage.type },
          body: pendingImage,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(data?.error || "Não foi possível salvar a imagem.");
        }
        const payload = await response.json().catch(() => null);
        const saved = persistedCustomBackgroundFromUpload(payload);
        if (!saved) throw new Error("A imagem foi enviada, mas a preferÃªncia salva nÃ£o pÃ´de ser confirmada.");
        utils.userPersonalization.get.setData(personalization.cacheIdentity, saved);
        setPreview(null);
        setPendingImage(null);
        setObjectUrl(null);
        toast.success("Fundo da conversa salvo.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Não foi possível salvar a imagem.");
      } finally {
        setUploading(false);
      }
      return;
    }

    try {
      const saved = await saveMutation.mutateAsync(conversationBackgroundSaveInput(preview, personalization.cacheIdentity));
      utils.userPersonalization.get.setData(personalization.cacheIdentity, saved);
      setPreview(null);
      toast.success("Fundo da conversa salvo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o fundo.");
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) selectImage(file);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-6" data-testid="personalization-tab">
      <header className="flex items-start gap-3 px-1 py-1" data-testid="personalization-section-header">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Palette className="size-4" /></div>
        <div><h2 className="text-xl font-semibold tracking-tight text-slate-900">Personalização</h2><p className="mt-1 text-sm text-slate-500">Escolha como suas conversas aparecem para você.</p></div>
      </header>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="conversation-preview-title">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5"><Sparkles className="size-4 text-blue-600" /><div><h3 id="conversation-preview-title" className="text-sm font-semibold text-slate-900">Prévia da conversa</h3><p className="text-xs text-slate-500">Veja o fundo antes de salvar.</p></div></div>
        <ConversationBackground preference={visiblePreference} className="min-h-[20rem] p-5 sm:min-h-[23rem] sm:p-6 lg:min-h-[25rem]">
          <div className="mx-auto flex h-full max-w-2xl flex-col justify-end gap-3">
            <ConversationMessageBubble direction="incoming">Olá! Como posso ajudar?</ConversationMessageBubble>
            <ConversationMessageBubble direction="outgoing">Quero acompanhar meu atendimento.</ConversationMessageBubble>
            <ConversationMessageBubble direction="incoming">Claro, já vou verificar para você.</ConversationMessageBubble>
          </div>
        </ConversationBackground>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="solid-backgrounds-title">
        <div><h3 id="solid-backgrounds-title" className="text-base font-semibold text-slate-900">Cores sólidas</h3><p className="mt-1 text-sm text-slate-500">Uma base limpa para manter a conversa confortável de ler.</p></div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {CONVERSATION_BACKGROUND_PRESETS.filter((preset) => preset.kind === "solid").map((preset) => {
            const selected = visiblePreference.backgroundType === "preset" && visiblePreference.presetId === preset.id;
            return <button key={preset.id} type="button" aria-pressed={selected} onClick={() => selectBackground("preset", preset.id)} disabled={isSaving} className={`relative min-h-28 overflow-hidden rounded-xl border p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 ${selected ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-200 hover:border-blue-300"}`} style={preset.style}>
              {selected && <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-blue-600 text-white"><Check className="size-3" /></span>}
              <span className={`absolute inset-x-3 bottom-3 text-xs font-semibold ${preset.id === "solid-black" || preset.id === "solid-navy" ? "text-white" : "text-slate-800"}`}>{preset.name}</span>
            </button>;
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="pattern-backgrounds-title">
        <div><h3 id="pattern-backgrounds-title" className="text-base font-semibold text-slate-900">Fundos padrão</h3><p className="mt-1 text-sm text-slate-500">Escolha um padrão que combine com seu ritmo de atendimento.</p></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CONVERSATION_BACKGROUND_PRESETS.filter((preset) => preset.kind === "pattern").map((preset) => {
            const selected = visiblePreference.backgroundType === "preset" && visiblePreference.presetId === preset.id;
            return <button key={preset.id} type="button" aria-pressed={selected} onClick={() => selectBackground("preset", preset.id)} disabled={isSaving} className={`relative min-h-32 overflow-hidden rounded-xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 ${selected ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-200 hover:border-blue-300"}`} style={{ ...preset.style, backgroundSize: "24px 24px" }}>
              <span className="absolute inset-0 bg-white/35" aria-hidden="true" />
              {selected && <span className="absolute right-3 top-3 z-10 flex size-5 items-center justify-center rounded-full bg-blue-600 text-white"><Check className="size-3" /></span>}
              <span className="relative z-10 block text-sm font-semibold text-slate-900">{preset.name}</span>
              <span className="relative z-10 mt-1 block text-xs text-slate-700">{preset.description}</span>
            </button>;
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-base font-semibold text-slate-900">Imagem personalizada</h3><p className="mt-1 text-sm text-slate-500">JPG, PNG ou WebP, até 5 MB. A prévia aparece antes de salvar.</p></div>{visiblePreference.backgroundType === "custom" && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">Imagem selecionada</span>}</div>
        <input ref={fileInput} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFileChange} />
        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button type="button" variant="ghost" className="justify-center text-slate-600 hover:bg-slate-100" disabled={isSaving} onClick={() => selectBackground("default")}><RotateCcw className="size-4" />Restaurar padrão</Button>
          <Button type="button" variant="outline" className="justify-center border-blue-200 text-blue-700 hover:bg-blue-50" disabled={isSaving} onClick={() => fileInput.current?.click()}><ImagePlus className="size-4" />Enviar imagem</Button>
          <Button type="button" className="justify-center bg-blue-600 px-6 shadow-sm hover:bg-blue-700" disabled={!hasUnsavedChanges || !canPersist || isSaving} onClick={() => void save()}>{isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{isSaving ? "Salvando…" : "Salvar"}</Button>
        </div>
      </section>
    </div>
  );
}
