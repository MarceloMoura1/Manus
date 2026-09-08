import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Palette } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConversationBackground } from "@/components/ConversationBackground";
import { trpc } from "@/lib/trpc";
import { useUserPersonalization } from "@/hooks/useUserPersonalization";
import {
  CONVERSATION_BACKGROUND_PRESETS,
  DEFAULT_CONVERSATION_BACKGROUND,
  normalizeConversationBackgroundPreference,
  type ConversationBackgroundPreference,
} from "@shared/user-personalization";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function UserPersonalizationTab() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ConversationBackgroundPreference | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const personalization = useUserPersonalization();
  const utils = trpc.useUtils();
  const visiblePreference = preview ?? personalization.preference;

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  const saveMutation = trpc.userPersonalization.save.useMutation({
    onSuccess: async (saved) => {
      setPreview(null);
      await utils.userPersonalization.get.setData(personalization.cacheIdentity, saved);
      toast.success("Fundo da conversa salvo.");
    },
    onError: (error) => toast.error(error.message || "Não foi possível salvar o fundo."),
  });

  const saveBackground = (backgroundType: "default" | "preset", presetId?: string) => {
    setPreview(backgroundType === "preset"
      ? normalizeConversationBackgroundPreference({ backgroundType, presetId: presetId ?? null, customImageUrl: null, hasCustomImage: false })
      : DEFAULT_CONVERSATION_BACKGROUND);
    saveMutation.mutate({ ...personalization.cacheIdentity, backgroundType, presetId: presetId ?? null });
  };

  const upload = async (file: File) => {
    if (!ACCEPTED_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      toast.error("Use uma imagem JPG, PNG ou WebP de até 5 MB.");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(nextUrl);
    setPreview({ backgroundType: "custom", presetId: null, customImageUrl: nextUrl, hasCustomImage: true });
    setUploading(true);
    try {
      const response = await fetch("/api/user-personalization/background", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || "Não foi possível salvar a imagem.");
      }
      await utils.userPersonalization.get.invalidate(personalization.cacheIdentity);
      setPreview(null);
      URL.revokeObjectURL(nextUrl);
      setObjectUrl(null);
      toast.success("Fundo personalizado salvo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a imagem.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Personalização</h2>
        <p className="mt-1 text-sm text-slate-500">Escolha o fundo exibido na sua área de conversa.</p>
      </div>

      <ConversationBackground preference={visiblePreference} className="min-h-56 overflow-hidden border border-slate-200 p-4">
        <div className="space-y-3">
          <div className="w-4/5 rounded-lg bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">Olá, como posso ajudar?</div>
          <div className="ml-auto w-3/5 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white shadow-sm">Quero acompanhar meu atendimento.</div>
          <div className="w-2/3 rounded-lg bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">Já vou verificar para você.</div>
        </div>
      </ConversationBackground>

      <section className="border-t border-slate-200 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">Cores sólidas</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {CONVERSATION_BACKGROUND_PRESETS.filter((preset) => preset.kind === "solid").map((preset) => {
            const selected = visiblePreference.backgroundType === "preset" && visiblePreference.presetId === preset.id;
            return <button key={preset.id} type="button" onClick={() => saveBackground("preset", preset.id)} disabled={saveMutation.isPending || uploading} className={`h-20 border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 ${selected ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-200 hover:border-blue-300"}`} style={preset.style}>
              <span className={`block text-xs font-semibold ${preset.id === "solid-black" || preset.id === "solid-navy" ? "text-white" : "text-slate-800"}`}>{preset.name}</span>
            </button>;
          })}
        </div>
      </section>

      <section className="border-t border-slate-200 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">Padrões</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {CONVERSATION_BACKGROUND_PRESETS.filter((preset) => preset.kind === "pattern").map((preset) => {
            const selected = visiblePreference.backgroundType === "preset" && visiblePreference.presetId === preset.id;
            return <button key={preset.id} type="button" onClick={() => saveBackground("preset", preset.id)} disabled={saveMutation.isPending || uploading} className={`h-24 border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 ${selected ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-200 hover:border-blue-300"}`} style={{ ...preset.style, backgroundSize: "24px 24px" }}>
              <span className="block text-sm font-semibold text-slate-900">{preset.name}</span>
              <span className="mt-1 block text-xs text-slate-600">{preset.description}</span>
            </button>;
          })}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
        <div><h3 className="text-sm font-semibold text-slate-900">Imagem personalizada</h3><p className="mt-1 text-xs text-slate-500">JPG, PNG ou WebP, até 5 MB.</p></div>
        <input ref={fileInput} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={saveMutation.isPending || uploading} onClick={() => saveBackground("default")}><Palette className="mr-2 h-4 w-4" />Padrão</Button>
          <Button type="button" disabled={saveMutation.isPending || uploading} onClick={() => fileInput.current?.click()}>{uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}Enviar imagem</Button>
        </div>
      </section>
    </div>
  );
}
