export const CONVERSATION_BACKGROUND_TYPES = ["default", "preset", "custom"] as const;
export type ConversationBackgroundType = (typeof CONVERSATION_BACKGROUND_TYPES)[number];

export type ConversationBackgroundPreset = {
  id: string;
  name: string;
  description: string;
  kind: "solid" | "pattern";
  style: {
    backgroundColor: string;
    backgroundImage?: string;
  };
};

/**
 * These IDs are the persisted contract. Never accept a class name or arbitrary
 * CSS from a client as a preset value.
 */
export const CONVERSATION_BACKGROUND_PRESETS: readonly ConversationBackgroundPreset[] = [
  { id: "solid-white", name: "Branco", description: "Limpo e claro", kind: "solid", style: { backgroundColor: "#ffffff" } },
  { id: "solid-black", name: "Preto", description: "Contraste discreto", kind: "solid", style: { backgroundColor: "#111827" } },
  { id: "solid-blue", name: "Azul", description: "Azul MegaDesk", kind: "solid", style: { backgroundColor: "#dbeafe" } },
  { id: "solid-soft-gray", name: "Cinza claro", description: "Neutro e suave", kind: "solid", style: { backgroundColor: "#f1f5f9" } },
  { id: "solid-navy", name: "Azul marinho", description: "Profundo e sóbrio", kind: "solid", style: { backgroundColor: "#172554" } },
  {
    id: "minimal-blue",
    name: "Minimal Blue",
    description: "Pontos azuis sutis",
    kind: "pattern",
    style: { backgroundColor: "#eff6ff", backgroundImage: "radial-gradient(circle at 1px 1px, rgba(37,99,235,0.12) 1px, transparent 0)" },
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Textura navy discreta",
    kind: "pattern",
    style: { backgroundColor: "#0f172a", backgroundImage: "linear-gradient(135deg, rgba(56,189,248,0.10) 25%, transparent 25%)" },
  },
  {
    id: "soft-geometry",
    name: "Soft Geometry",
    description: "Formas geométricas leves",
    kind: "pattern",
    style: { backgroundColor: "#f8fafc", backgroundImage: "linear-gradient(30deg, rgba(148,163,184,0.14) 12%, transparent 12.5%, transparent 87%, rgba(148,163,184,0.14) 87.5%)" },
  },
  {
    id: "blue-glow",
    name: "Blue Glow",
    description: "Degradê azul e ciano",
    kind: "pattern",
    style: { backgroundColor: "#ecfeff", backgroundImage: "radial-gradient(circle at 15% 20%, rgba(56,189,248,0.28), transparent 36%), linear-gradient(135deg, #eff6ff, #ecfeff)" },
  },
  {
    id: "desk-pattern",
    name: "Desk Pattern",
    description: "Elementos abstratos sutis",
    kind: "pattern",
    style: { backgroundColor: "#f8fafc", backgroundImage: "radial-gradient(circle at 20% 18%, rgba(14,165,233,0.10) 0 4px, transparent 4.5px), radial-gradient(circle at 78% 74%, rgba(99,102,241,0.09) 0 5px, transparent 5.5px), linear-gradient(135deg, transparent 48%, rgba(148,163,184,0.08) 50%, transparent 52%)" },
  },
] as const;

export type ConversationBackgroundPreference = {
  backgroundType: ConversationBackgroundType;
  presetId: string | null;
  customImageUrl: string | null;
  hasCustomImage: boolean;
};

export type ConversationBackgroundStyle = {
  backgroundColor: string;
  backgroundImage?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  backgroundSize?: string;
};

export const DEFAULT_CONVERSATION_BACKGROUND: ConversationBackgroundPreference = {
  backgroundType: "default",
  presetId: null,
  customImageUrl: null,
  hasCustomImage: false,
};

export function getConversationBackgroundPreset(presetId: string | null | undefined): ConversationBackgroundPreset | null {
  if (!presetId) return null;
  return CONVERSATION_BACKGROUND_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function isConversationBackgroundPresetId(value: unknown): value is string {
  return typeof value === "string" && getConversationBackgroundPreset(value) !== null;
}

/** Always returns a safe, renderable preference; corrupt values fall back to MegaDesk default. */
export function normalizeConversationBackgroundPreference(value: Partial<ConversationBackgroundPreference> | null | undefined): ConversationBackgroundPreference {
  if (value?.backgroundType === "preset" && isConversationBackgroundPresetId(value.presetId)) {
    return { backgroundType: "preset", presetId: value.presetId, customImageUrl: null, hasCustomImage: Boolean(value.hasCustomImage) };
  }
  if (value?.backgroundType === "custom" && typeof value.customImageUrl === "string" && value.customImageUrl.length > 0) {
    return { backgroundType: "custom", presetId: null, customImageUrl: value.customImageUrl, hasCustomImage: true };
  }
  return { ...DEFAULT_CONVERSATION_BACKGROUND, hasCustomImage: Boolean(value?.hasCustomImage) };
}

/** Resolves only trusted preset definitions or a server-issued image URL. */
export function resolveConversationBackgroundStyle(
  value: Partial<ConversationBackgroundPreference> | null | undefined,
): ConversationBackgroundStyle {
  const preference = normalizeConversationBackgroundPreference(value);
  if (preference.backgroundType === "preset") {
    const preset = getConversationBackgroundPreset(preference.presetId);
    if (preset) {
      return {
        ...preset.style,
        backgroundPosition: "center",
        backgroundRepeat: "repeat",
        backgroundSize: preset.kind === "pattern" ? "24px 24px" : "auto",
      };
    }
  }
  if (preference.backgroundType === "custom" && preference.customImageUrl) {
    return {
      backgroundColor: "#f8fafc",
      backgroundImage: `url(${JSON.stringify(preference.customImageUrl)})`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "cover",
    };
  }
  return { backgroundColor: "#f8fafc" };
}
