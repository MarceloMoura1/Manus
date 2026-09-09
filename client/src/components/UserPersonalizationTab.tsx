import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Check,
  ImagePlus,
  Loader2,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  SwatchBook,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConversationAppearancePreview } from "@/components/ConversationAppearancePreview";
import { trpc } from "@/lib/trpc";
import {
  isUserPersonalizationBackgroundPath,
  userPersonalizationBackgroundUrl,
} from "@/lib/trpc-url";
import { useUserPersonalization } from "@/hooks/useUserPersonalization";
import {
  CONVERSATION_BACKGROUND_PRESETS,
  CONVERSATION_BUBBLE_COLOR_SWATCHES,
  DEFAULT_CONVERSATION_BACKGROUND,
  conversationBubbleForegroundColor,
  getConversationBackgroundPreset,
  normalizeConversationBackgroundPreference,
  type ConversationBackgroundPreference,
} from "@shared/user-personalization";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
type PersonalizationIdentity = { clientId?: string; userEmail?: string };
type BackgroundMode = "default" | "solid" | "pattern" | "custom";
type CustomBackgroundUploadResponse = {
  ok?: boolean;
  preference?: Partial<ConversationBackgroundPreference>;
};

const BACKGROUND_MODES: ReadonlyArray<{
  id: BackgroundMode;
  label: string;
  description: string;
  icon: typeof Palette;
}> = [
  {
    id: "default",
    label: "Padrão",
    description: "Visual original do MegaDesk",
    icon: RotateCcw,
  },
  {
    id: "solid",
    label: "Cor sólida",
    description: "Uma cor limpa para as mensagens",
    icon: Palette,
  },
  {
    id: "pattern",
    label: "Fundo estilizado",
    description: "Texturas sutis e profissionais",
    icon: WandSparkles,
  },
  {
    id: "custom",
    label: "Sua imagem",
    description: "Use uma imagem da sua preferência",
    icon: ImagePlus,
  },
];

export function hasUnsavedConversationBackground(
  draft: ConversationBackgroundPreference | null,
  saved: ConversationBackgroundPreference,
  hasPendingImage: boolean
) {
  if (!draft) return false;
  if (hasPendingImage) return true;
  return (
    draft.backgroundType !== saved.backgroundType ||
    draft.presetId !== saved.presetId ||
    draft.incomingBubbleColor !== saved.incomingBubbleColor ||
    draft.outgoingBubbleColor !== saved.outgoingBubbleColor
  );
}

export function conversationBackgroundSaveInput(
  draft: ConversationBackgroundPreference,
  identity: PersonalizationIdentity
) {
  return {
    ...identity,
    backgroundType: draft.backgroundType,
    presetId: draft.backgroundType === "preset" ? draft.presetId : null,
    incomingBubbleColor: draft.incomingBubbleColor,
    outgoingBubbleColor: draft.outgoingBubbleColor,
  };
}

export function persistedCustomBackgroundFromUpload(
  value: unknown
): ConversationBackgroundPreference | null {
  const response = value as CustomBackgroundUploadResponse | null;
  if (!response?.ok) return null;
  const preference = normalizeConversationBackgroundPreference(
    response.preference
  );
  return preference.backgroundType === "custom" &&
    isUserPersonalizationBackgroundPath(preference.customImageUrl)
    ? preference
    : null;
}

export function conversationBackgroundMode(
  preference: ConversationBackgroundPreference
): BackgroundMode {
  if (preference.backgroundType === "custom") return "custom";
  if (preference.backgroundType === "preset")
    return (
      getConversationBackgroundPreset(preference.presetId)?.kind ?? "default"
    );
  return "default";
}

function activeBackgroundLabel(preference: ConversationBackgroundPreference) {
  if (preference.backgroundType === "custom") return "Sua imagem";
  if (preference.backgroundType === "preset")
    return (
      getConversationBackgroundPreset(preference.presetId)?.name ??
      "Fundo estilizado"
    );
  return "Padrão MegaDesk";
}

function BubbleColorPalette({
  direction,
  label,
  value,
  disabled,
  onChange,
}: {
  direction: "incoming" | "outgoing";
  label: string;
  value: string | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <fieldset
      className="min-w-0"
      data-testid={`bubble-color-${direction}-selector`}
    >
      <legend className="text-sm font-semibold text-slate-900">{label}</legend>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        Escolha uma cor segura ou mantenha o padrão atual.
      </p>
      <div
        className="mt-3 flex flex-wrap gap-2"
        role="group"
        aria-label={`Cores dos balões ${label.toLowerCase()}`}
      >
        {CONVERSATION_BUBBLE_COLOR_SWATCHES.map(color => {
          const selected = value === color;
          return (
            <button
              key={color}
              type="button"
              aria-pressed={selected}
              aria-label={`${label}: ${color}${selected ? ", selecionada" : ""}`}
              disabled={disabled}
              onClick={() => onChange(color)}
              className="flex size-9 items-center justify-center rounded-full border-2 border-white shadow-sm ring-1 ring-slate-300 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55"
              style={{
                backgroundColor: color,
                color: conversationBubbleForegroundColor(color),
              }}
            >
              {selected && <Check className="size-4" aria-hidden="true" />}
              <span className="sr-only">
                {selected ? "Selecionada" : color}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={value === null}
          disabled={disabled}
          onClick={() => onChange(null)}
          className="rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55"
        >
          {value === null && (
            <Check className="mr-1 inline size-3.5" aria-hidden="true" />
          )}
          Usar padrão
        </button>
      </div>
    </fieldset>
  );
}

export function UserPersonalizationTab() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] =
    useState<ConversationBackgroundPreference | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const personalization = useUserPersonalization();
  const utils = trpc.useUtils();
  const saveMutation = trpc.userPersonalization.save.useMutation();
  const visiblePreference = preview ?? personalization.preference;
  const activeMode = conversationBackgroundMode(visiblePreference);
  const [controlMode, setControlMode] = useState<BackgroundMode>(activeMode);
  const isSaving = saveMutation.isPending || uploading;
  const canPersist = Boolean(
    personalization.cacheIdentity.clientId &&
      personalization.cacheIdentity.userEmail
  );
  const hasUnsavedChanges = hasUnsavedConversationBackground(
    preview,
    personalization.preference,
    Boolean(pendingImage)
  );

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl]
  );
  useEffect(() => {
    setControlMode(conversationBackgroundMode(visiblePreference));
  }, [
    visiblePreference.backgroundType,
    visiblePreference.presetId,
    visiblePreference.customImageUrl,
  ]);

  const selectBackground = (
    backgroundType: "default" | "preset",
    presetId?: string
  ) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setPendingImage(null);
    setObjectUrl(null);
    setPreview(
      backgroundType === "preset"
        ? normalizeConversationBackgroundPreference({
            backgroundType,
            presetId: presetId ?? null,
            customImageUrl: null,
            hasCustomImage: false,
          })
        : {
            ...DEFAULT_CONVERSATION_BACKGROUND,
            incomingBubbleColor: visiblePreference.incomingBubbleColor,
            outgoingBubbleColor: visiblePreference.outgoingBubbleColor,
          }
    );
    setControlMode(
      backgroundType === "preset"
        ? (getConversationBackgroundPreset(presetId)?.kind ?? "solid")
        : "default"
    );
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
    setPreview({
      backgroundType: "custom",
      presetId: null,
      customImageUrl: nextUrl,
      hasCustomImage: true,
      incomingBubbleColor: visiblePreference.incomingBubbleColor,
      outgoingBubbleColor: visiblePreference.outgoingBubbleColor,
    });
    setControlMode("custom");
  };

  const selectBubbleColor = (
    direction: "incoming" | "outgoing",
    color: string | null
  ) => {
    setPreview(
      normalizeConversationBackgroundPreference({
        ...visiblePreference,
        [direction === "incoming"
          ? "incomingBubbleColor"
          : "outgoingBubbleColor"]: color,
      })
    );
  };

  const save = async () => {
    if (!preview || !hasUnsavedChanges || !canPersist || isSaving) return;
    const imageToUpload = pendingImage;

    if (preview.backgroundType === "custom" && imageToUpload) {
      setUploading(true);
      try {
        const response = await fetch(userPersonalizationBackgroundUrl(), {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": imageToUpload.type,
            "x-megadesk-incoming-bubble-color":
              preview.incomingBubbleColor ?? "default",
            "x-megadesk-outgoing-bubble-color":
              preview.outgoingBubbleColor ?? "default",
          },
          body: imageToUpload,
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error || "Não foi possível salvar a imagem.");
        }
        const payload = await response.json().catch(() => null);
        const saved = persistedCustomBackgroundFromUpload(payload);
        if (!saved)
          throw new Error(
            "A imagem foi enviada, mas a preferÃªncia salva nÃ£o pÃ´de ser confirmada."
          );
        utils.userPersonalization.get.setData(
          personalization.cacheIdentity,
          saved
        );
        setPreview(null);
        setPendingImage(null);
        setObjectUrl(null);
        toast.success("Fundo da conversa salvo.");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível salvar a imagem."
        );
      } finally {
        setUploading(false);
      }
      return;
    }

    try {
      const saved = await saveMutation.mutateAsync(
        conversationBackgroundSaveInput(preview, personalization.cacheIdentity)
      );
      utils.userPersonalization.get.setData(
        personalization.cacheIdentity,
        saved
      );
      setPreview(null);
      toast.success("Fundo da conversa salvo.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o fundo."
      );
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) selectImage(file);
  };

  const activateMode = (mode: BackgroundMode) => {
    if (mode === "default") {
      selectBackground("default");
      return;
    }
    setControlMode(mode);
    if (mode === "custom") fileInput.current?.click();
  };

  return (
    <div className="space-y-6 pb-8" data-testid="personalization-tab">
      <header
        className="flex items-start gap-3 px-1"
        data-testid="personalization-section-header"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 shadow-sm">
          <Palette className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-950">
            Personalização
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Organize a aparência da área de conversas do seu jeito.
          </p>
        </div>
      </header>

      <section
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        aria-labelledby="conversation-appearance-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div className="flex gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h3
                id="conversation-appearance-title"
                className="text-base font-semibold text-slate-950"
              >
                Aparência das conversas
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Escolha o fundo que aparece na área de mensagens.
              </p>
            </div>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800"
            data-testid="active-background-mode"
          >
            <Check className="size-3.5" />
            Em uso na prévia: {activeBackgroundLabel(visiblePreference)}
          </span>
        </div>
        <div
          className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4 sm:p-4"
          aria-label="Modo de fundo"
        >
          {BACKGROUND_MODES.map(({ id, label, description, icon: Icon }) => {
            const selected = controlMode === id;
            if (id === "custom") {
              return (
                <div
                  key={id}
                  className={`group relative overflow-hidden rounded-xl border transition duration-150 ${selected ? "border-blue-600 bg-blue-50/70 shadow-sm" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"}`}
                  data-testid="custom-image-option"
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setControlMode("custom")}
                    disabled={isSaving}
                    className="flex min-h-24 w-full items-start gap-3 p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 disabled:pointer-events-none disabled:opacity-55"
                  >
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition ${selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700"}`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        {label}
                        {activeMode === id && (
                          <Check
                            className="size-3.5 text-blue-700"
                            aria-label="Fundo atual"
                          />
                        )}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {description}
                      </span>
                    </span>
                  </button>
                  <div className="border-t border-blue-100 px-3.5 pb-3.5 pt-3">
                    <p className="text-xs leading-5 text-slate-500">
                      JPG, PNG ou WebP de até 5 MB.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full border-blue-200 bg-white text-blue-800 hover:bg-blue-100"
                      disabled={isSaving}
                      onClick={() => fileInput.current?.click()}
                    >
                      <ImagePlus className="size-4" /> Enviar imagem
                    </Button>
                    {(pendingImage ||
                      visiblePreference.backgroundType === "custom") && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                        <Check className="size-3.5" />
                        {pendingImage
                          ? "Imagem pronta para salvar"
                          : "Imagem personalizada ativa"}
                      </p>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => activateMode(id)}
                disabled={isSaving}
                className={`group relative flex min-h-24 items-start gap-3 rounded-xl border p-3.5 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55 ${selected ? "border-blue-600 bg-blue-50/70 shadow-sm" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"}`}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition ${selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700"}`}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    {label}
                    {activeMode === id && (
                      <Check
                        className="size-3.5 text-blue-700"
                        aria-label="Fundo atual"
                      />
                    )}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    {description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="space-y-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <section
          className="border-t border-slate-100"
          aria-labelledby="background-controls-title"
        >
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="flex items-center gap-2">
              <SwatchBook className="size-4 text-blue-700" />
              <h3
                id="background-controls-title"
                className="text-sm font-semibold text-slate-950"
              >
                Escolha seu fundo
              </h3>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              As mudanças aparecem ao vivo na prévia antes de salvar.
            </p>
          </div>
          <div className="p-5 sm:p-6">
            {controlMode === "default" && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  Fundo padrão selecionado
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Uma base neutra para manter a conversa confortável e legível.
                </p>
              </div>
            )}
            {controlMode === "solid" && (
              <fieldset>
                <legend className="text-sm font-semibold text-slate-900">
                  Cores sólidas
                </legend>
                <p className="mt-1 text-sm text-slate-500">
                  Selecione uma cor para aplicar na área de mensagens.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {CONVERSATION_BACKGROUND_PRESETS.filter(
                    preset => preset.kind === "solid"
                  ).map(preset => {
                    const selected =
                      visiblePreference.backgroundType === "preset" &&
                      visiblePreference.presetId === preset.id;
                    const dark =
                      preset.id === "solid-black" || preset.id === "solid-navy";
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => selectBackground("preset", preset.id)}
                        disabled={isSaving}
                        className={`group relative flex min-h-20 items-end overflow-hidden rounded-xl border p-3 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55 ${selected ? "border-blue-600 ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-300 hover:shadow-sm"}`}
                        style={preset.style}
                      >
                        <span
                          className={`absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t ${dark ? "from-slate-950/45" : "from-white/70"}`}
                          aria-hidden="true"
                        />
                        <span
                          className={`relative flex w-full items-center justify-between gap-2 text-xs font-semibold ${dark ? "text-white" : "text-slate-900"}`}
                        >
                          {preset.name}
                          {selected && (
                            <Check
                              className="size-3.5"
                              aria-label="Cor selecionada"
                            />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {controlMode === "pattern" && (
              <fieldset>
                <legend className="text-sm font-semibold text-slate-900">
                  Fundos estilizados
                </legend>
                <p className="mt-1 text-sm text-slate-500">
                  Compare as texturas antes de escolher a que combina com seu
                  atendimento.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {CONVERSATION_BACKGROUND_PRESETS.filter(
                    preset => preset.kind === "pattern"
                  ).map(preset => {
                    const selected =
                      visiblePreference.backgroundType === "preset" &&
                      visiblePreference.presetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => selectBackground("preset", preset.id)}
                        disabled={isSaving}
                        className={`group relative min-h-28 overflow-hidden rounded-xl border p-3 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55 ${selected ? "border-blue-600 ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-300 hover:shadow-sm"}`}
                        style={{ ...preset.style, backgroundSize: "24px 24px" }}
                      >
                        <span
                          className="absolute inset-0 bg-white/30 transition group-hover:bg-white/15"
                          aria-hidden="true"
                        />
                        <span className="relative flex h-full flex-col justify-between">
                          <span className="flex items-center justify-end">
                            {selected && (
                              <span className="flex size-5 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
                                <Check
                                  className="size-3"
                                  aria-label="Fundo selecionado"
                                />
                              </span>
                            )}
                          </span>
                          <span className="rounded-lg bg-white/80 px-2.5 py-2 backdrop-blur-sm">
                            <span className="block text-xs font-semibold text-slate-900">
                              {preset.name}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-4 text-slate-600">
                              {preset.description}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {false && controlMode === "custom" && (
              <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/45 p-4 sm:p-5">
                <div className="flex size-10 items-center justify-center rounded-xl bg-white text-blue-700 shadow-sm">
                  <ImagePlus className="size-5" />
                </div>
                <h4 className="mt-4 text-sm font-semibold text-slate-950">
                  Adicione sua própria imagem
                </h4>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  JPG, PNG ou WebP com até 5 MB. A imagem é exibida na prévia
                  antes de ser salva.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 border-blue-200 bg-white text-blue-800 hover:bg-blue-100"
                  disabled={isSaving}
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus className="size-4" />
                  Enviar imagem
                </Button>
                {(pendingImage ||
                  visiblePreference.backgroundType === "custom") && (
                  <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-blue-800">
                    <Check className="size-3.5" />
                    {pendingImage
                      ? `Imagem pronta para salvar: ${pendingImage?.name ?? "imagem selecionada"}`
                      : "Imagem personalizada ativa"}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
        <section
          className="border-t border-slate-100 px-5 py-5 sm:px-6"
          aria-labelledby="message-bubbles-title"
        >
          <h3
            id="message-bubbles-title"
            className="text-sm font-semibold text-slate-950"
          >
            Balões de mensagem
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Personalize mensagens recebidas e enviadas sem mudar o conteúdo da
            conversa.
          </p>
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <BubbleColorPalette
              direction="incoming"
              label="Recebidas"
              value={visiblePreference.incomingBubbleColor}
              disabled={isSaving}
              onChange={color => selectBubbleColor("incoming", color)}
            />
            <BubbleColorPalette
              direction="outgoing"
              label="Enviadas"
              value={visiblePreference.outgoingBubbleColor}
              disabled={isSaving}
              onChange={color => selectBubbleColor("outgoing", color)}
            />
          </div>
        </section>
        <div
          className="border-t border-slate-100 p-4 sm:p-6"
          data-testid="conversation-preview-wide"
        >
          <ConversationAppearancePreview preference={visiblePreference} />
        </div>
      </div>

      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onFileChange}
        aria-label="Enviar imagem de fundo"
      />
      <footer className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-h-5 text-sm" aria-live="polite">
          {hasUnsavedChanges ? (
            <span className="inline-flex items-center gap-2 font-medium text-amber-800">
              <span
                className="size-2 rounded-full bg-amber-500"
                aria-hidden="true"
              />
              Alterações não salvas
            </span>
          ) : (
            <span className="text-slate-500">
              As alterações salvas aparecem em Conversas e Novo Atendimento.
            </span>
          )}
        </div>
        <Button
          type="button"
          size="lg"
          className="min-w-44 bg-blue-600 px-6 font-semibold shadow-sm transition hover:bg-blue-700 focus-visible:ring-blue-600"
          disabled={!hasUnsavedChanges || !canPersist || isSaving}
          onClick={() => void save()}
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {isSaving ? "Salvando…" : "Salvar alterações"}
        </Button>
      </footer>
    </div>
  );
}
