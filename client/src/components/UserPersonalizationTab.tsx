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
  Layers,
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
  CONVERSATION_BUBBLE_STYLES,
  DEFAULT_CONVERSATION_BACKGROUND,
  conversationBubbleForegroundColor,
  getConversationBackgroundPreset,
  normalizeConversationBackgroundPreference,
  type ConversationBackgroundPreference,
  type ConversationBubbleStyle,
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
    description: "Visual original MegaDesk",
    icon: RotateCcw,
  },
  {
    id: "solid",
    label: "Cor sólida",
    description: "Cores limpas para mensagens",
    icon: Palette,
  },
  {
    id: "pattern",
    label: "Fundo estilizado",
    description: "Temas Typebot & degradês",
    icon: WandSparkles,
  },
  {
    id: "custom",
    label: "Sua imagem",
    description: "Upload de imagem própria",
    icon: ImagePlus,
  },
];

const BUBBLE_STYLE_OPTIONS: ReadonlyArray<{
  id: ConversationBubbleStyle;
  label: string;
  description: string;
}> = [
  {
    id: "classic_tail",
    label: "Clássico",
    description: "Bordas arredondadas tradicionais",
  },
  {
    id: "pill_soft",
    label: "Pill Soft",
    description: "Cápsula suave e moderna",
  },
  {
    id: "glassmorphism",
    label: "Glassmorphism",
    description: "Translúcido com efeito vidro",
  },
  {
    id: "neon_border",
    label: "Neon Border",
    description: "Contorno com brilho neon",
  },
  {
    id: "minimal_flat",
    label: "Minimal Flat",
    description: "Design plano e limpo",
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
    draft.outgoingBubbleColor !== saved.outgoingBubbleColor ||
    (Boolean(draft.bubbleStyle) &&
      Boolean(saved.bubbleStyle) &&
      draft.bubbleStyle !== saved.bubbleStyle)
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
      <div className="flex items-center justify-between mb-1.5">
        <legend className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Balões {label}
        </legend>
        <button
          type="button"
          aria-pressed={value === null}
          disabled={disabled}
          onClick={() => onChange(null)}
          className="text-[11px] font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
        >
          {value === null ? "✓ Padrão" : "Restaurar padrão"}
        </button>
      </div>
      <div
        className="flex flex-wrap gap-1.5"
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
              className={`flex size-7 items-center justify-center rounded-full border-2 border-white shadow-xs ring-1 ring-slate-300 transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:pointer-events-none disabled:opacity-50 ${
                selected ? "scale-110 ring-2 ring-blue-600" : ""
              }`}
              style={{
                backgroundColor: color,
                color: conversationBubbleForegroundColor(color),
              }}
            >
              {selected && <Check className="size-3.5" aria-hidden="true" />}
              <span className="sr-only">
                {selected ? "Selecionada" : color}
              </span>
            </button>
          );
        })}
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
            bubbleStyle: visiblePreference.bubbleStyle,
            incomingBubbleColor: visiblePreference.incomingBubbleColor,
            outgoingBubbleColor: visiblePreference.outgoingBubbleColor,
          })
        : {
            ...DEFAULT_CONVERSATION_BACKGROUND,
            bubbleStyle: visiblePreference.bubbleStyle,
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

  const selectBubbleStyle = (style: ConversationBubbleStyle) => {
    setPreview(prev =>
      normalizeConversationBackgroundPreference({
        ...(prev ?? personalization.preference),
        bubbleStyle: style,
      })
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
      bubbleStyle: visiblePreference.bubbleStyle,
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

    if (preview.bubbleStyle) {
      personalization.setBubbleStyle(preview.bubbleStyle);
    }

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
            "A imagem foi enviada, mas a preferência salva não pôde ser confirmada."
          );
        utils.userPersonalization.get.setData(
          personalization.cacheIdentity,
          saved
        );
        setPreview(null);
        setPendingImage(null);
        setObjectUrl(null);
        toast.success("Fundo e estilo da conversa salvos.");
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
      toast.success("Fundo e estilo da conversa salvos.");
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
    <div className="space-y-5 pb-6" data-testid="personalization-tab">
      <header
        className="flex items-center justify-between border-b border-slate-200/80 pb-4"
        data-testid="personalization-section-header"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 shadow-xs">
            <Palette className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">
              Personalização do Chat
            </h2>
            <p className="text-xs text-slate-500">
              Configure temas estilo Typebot, texturas, cores e formatos de balão.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Alterações pendentes
            </span>
          )}
          <Button
            type="button"
            size="sm"
            className="bg-blue-600 font-semibold shadow-xs hover:bg-blue-700"
            disabled={!hasUnsavedChanges || !canPersist || isSaving}
            onClick={() => void save()}
          >
            {isSaving ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-3.5" />
            )}
            {isSaving ? "Salvando…" : "Salvar alterações"}
          </Button>
        </div>
      </header>

      {/* 2-Column Responsive Cockpit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Controls */}
        <div className="lg:col-span-7 space-y-4">
          {/* Card 1: Background Modes */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-blue-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Fundo da Conversa
                </h3>
              </div>
              <span
                className="text-[11px] font-medium text-slate-500"
                data-testid="active-background-mode"
              >
                Ativo: {activeBackgroundLabel(visiblePreference)}
              </span>
            </div>

            {/* Mode Selector Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-xl bg-slate-100 p-1">
              {BACKGROUND_MODES.map(({ id, label, icon: Icon }) => {
                const selected = controlMode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => activateMode(id)}
                    disabled={isSaving}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-semibold transition ${
                      selected
                        ? "bg-white text-blue-700 shadow-xs ring-1 ring-slate-200"
                        : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                    }`}
                  >
                    <Icon className="size-3.5" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            {/* Mode Content Panes */}
            <div className="mt-3.5 pt-3 border-t border-slate-100">
              {controlMode === "default" && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3.5 text-center">
                  <p className="text-xs font-semibold text-slate-800">
                    Fundo Padrão MegaDesk
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Base neutra equilibrada e otimizada para legibilidade.
                  </p>
                </div>
              )}

              {controlMode === "solid" && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">
                    Selecione uma tonalidade sólida para o plano de fundo:
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {CONVERSATION_BACKGROUND_PRESETS.filter(
                      p => p.kind === "solid"
                    ).map(preset => {
                      const selected =
                        visiblePreference.backgroundType === "preset" &&
                        visiblePreference.presetId === preset.id;
                      const dark =
                        preset.id === "solid-black" ||
                        preset.id === "solid-navy";
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => selectBackground("preset", preset.id)}
                          disabled={isSaving}
                          className={`group relative flex h-14 items-end rounded-xl border p-2 text-left transition ${
                            selected
                              ? "border-blue-600 ring-2 ring-blue-500/20 shadow-xs"
                              : "border-slate-200 hover:border-blue-300"
                          }`}
                          style={preset.style}
                        >
                          <span
                            className={`text-[11px] font-semibold truncate ${
                              dark ? "text-white" : "text-slate-900"
                            }`}
                          >
                            {preset.name}
                          </span>
                          {selected && (
                            <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-blue-600 text-white">
                              <Check className="size-2.5" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {controlMode === "pattern" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-slate-500">
                      Temas Typebot, degradês imersivos e texturas executivas:
                    </p>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      Typebot Ready
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {CONVERSATION_BACKGROUND_PRESETS.filter(
                      p => p.kind === "pattern"
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
                          className={`group relative flex flex-col justify-between h-20 overflow-hidden rounded-xl border p-2.5 text-left transition ${
                            selected
                              ? "border-blue-600 ring-2 ring-blue-500/30 shadow-xs"
                              : "border-slate-200 hover:border-blue-300"
                          }`}
                          style={{
                            ...preset.style,
                            backgroundSize: "cover",
                          }}
                        >
                          <div className="flex items-center justify-end w-full">
                            {selected && (
                              <span className="flex size-4 items-center justify-center rounded-full bg-blue-600 text-white shadow-xs">
                                <Check className="size-2.5" />
                              </span>
                            )}
                          </div>
                          <div className="rounded-md bg-slate-950/70 p-1.5 backdrop-blur-xs">
                            <span className="block text-xs font-semibold text-white leading-tight">
                              {preset.name}
                            </span>
                            <span className="block text-[10px] text-slate-300 truncate leading-tight mt-0.5">
                              {preset.description}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {controlMode === "custom" && (
                <div
                  className="rounded-xl border border-dashed border-blue-200 bg-blue-50/30 p-4 text-center"
                  data-testid="custom-image-option"
                >
                  <ImagePlus className="mx-auto size-7 text-blue-600" />
                  <p className="mt-2 text-xs font-semibold text-slate-900">
                    Imagem Personalizada
                  </p>
                  <p className="text-[11px] text-slate-500">
                    JPG, PNG ou WebP de até 5 MB.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3 border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                    disabled={isSaving}
                    onClick={() => fileInput.current?.click()}
                  >
                    <ImagePlus className="mr-1.5 size-3.5" /> Escolher arquivo
                  </Button>
                  {(pendingImage ||
                    visiblePreference.backgroundType === "custom") && (
                    <p className="mt-2 text-xs font-medium text-emerald-700">
                      ✓ Imagem selecionada:{" "}
                      {pendingImage?.name ?? "Imagem ativa"}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Bubble Styles (Typebot & Modern Shapes) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-blue-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Estilo dos Balões
                </h3>
              </div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                Geometria & Acabamento
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {BUBBLE_STYLE_OPTIONS.map(opt => {
                const selected =
                  (visiblePreference.bubbleStyle ?? "classic_tail") === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectBubbleStyle(opt.id)}
                    disabled={isSaving}
                    className={`flex flex-col text-left p-2.5 rounded-xl border transition ${
                      selected
                        ? "border-blue-600 bg-blue-50/70 ring-1 ring-blue-500/20"
                        : "border-slate-200 hover:border-blue-300 hover:bg-slate-50/60"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900">
                        {opt.label}
                      </span>
                      {selected && (
                        <Check className="size-3.5 text-blue-700" />
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card 3: Bubble Colors */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="mb-3 flex items-center gap-2">
              <SwatchBook className="size-4 text-blue-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                Cores dos Balões
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </div>
        </div>

        {/* Right Column: Sticky Live Preview & Action Bar */}
        <div className="lg:col-span-5 sticky top-4 space-y-4">
          <div
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs"
            data-testid="conversation-preview-wide"
          >
            <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-slate-800">
                  Prévia em Tempo Real
                </span>
              </div>
              <span className="text-[11px] text-slate-500">
                {visiblePreference.bubbleStyle ?? "classic_tail"}
              </span>
            </div>

            <div className="p-3">
              <ConversationAppearancePreview preference={visiblePreference} />
            </div>

            <div className="border-t border-slate-100 bg-slate-50/60 p-3.5 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {hasUnsavedChanges ? (
                  <span className="font-medium text-amber-700">
                    Modificações não salvas
                  </span>
                ) : (
                  <span>Aparência salva e ativa</span>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                className="bg-blue-600 font-semibold shadow-xs hover:bg-blue-700"
                disabled={!hasUnsavedChanges || !canPersist || isSaving}
                onClick={() => void save()}
              >
                {isSaving ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 size-3.5" />
                )}
                {isSaving ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
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
    </div>
  );
}
