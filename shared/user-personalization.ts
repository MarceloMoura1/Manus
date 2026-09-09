export const CONVERSATION_BACKGROUND_TYPES = [
  "default",
  "preset",
  "custom",
] as const;
export type ConversationBackgroundType =
  (typeof CONVERSATION_BACKGROUND_TYPES)[number];

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
export const CONVERSATION_BACKGROUND_PRESETS: readonly ConversationBackgroundPreset[] =
  [
    {
      id: "solid-white",
      name: "Branco",
      description: "Limpo e claro",
      kind: "solid",
      style: { backgroundColor: "#ffffff" },
    },
    {
      id: "solid-black",
      name: "Preto",
      description: "Contraste discreto",
      kind: "solid",
      style: { backgroundColor: "#111827" },
    },
    {
      id: "solid-blue",
      name: "Azul",
      description: "Azul MegaDesk",
      kind: "solid",
      style: { backgroundColor: "#dbeafe" },
    },
    {
      id: "solid-soft-gray",
      name: "Cinza claro",
      description: "Neutro e suave",
      kind: "solid",
      style: { backgroundColor: "#f1f5f9" },
    },
    {
      id: "solid-navy",
      name: "Azul marinho",
      description: "Profundo e sóbrio",
      kind: "solid",
      style: { backgroundColor: "#172554" },
    },
    {
      id: "minimal-blue",
      name: "Minimal Blue",
      description: "Pontos azuis sutis",
      kind: "pattern",
      style: {
        backgroundColor: "#eff6ff",
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(37,99,235,0.12) 1px, transparent 0)",
      },
    },
    {
      id: "midnight",
      name: "Midnight",
      description: "Textura navy discreta",
      kind: "pattern",
      style: {
        backgroundColor: "#0f172a",
        backgroundImage:
          "linear-gradient(135deg, rgba(56,189,248,0.10) 25%, transparent 25%)",
      },
    },
    {
      id: "soft-geometry",
      name: "Soft Geometry",
      description: "Formas geométricas leves",
      kind: "pattern",
      style: {
        backgroundColor: "#f8fafc",
        backgroundImage:
          "linear-gradient(30deg, rgba(148,163,184,0.14) 12%, transparent 12.5%, transparent 87%, rgba(148,163,184,0.14) 87.5%)",
      },
    },
    {
      id: "blue-glow",
      name: "Blue Glow",
      description: "Degradê azul e ciano",
      kind: "pattern",
      style: {
        backgroundColor: "#ecfeff",
        backgroundImage:
          "radial-gradient(circle at 15% 20%, rgba(56,189,248,0.28), transparent 36%), linear-gradient(135deg, #eff6ff, #ecfeff)",
      },
    },
    {
      id: "desk-pattern",
      name: "Desk Pattern",
      description: "Elementos abstratos sutis",
      kind: "pattern",
      style: {
        backgroundColor: "#f8fafc",
        backgroundImage:
          "radial-gradient(circle at 20% 18%, rgba(14,165,233,0.10) 0 4px, transparent 4.5px), radial-gradient(circle at 78% 74%, rgba(99,102,241,0.09) 0 5px, transparent 5.5px), linear-gradient(135deg, transparent 48%, rgba(148,163,184,0.08) 50%, transparent 52%)",
      },
    },
  ] as const;

export type ConversationBackgroundPreference = {
  backgroundType: ConversationBackgroundType;
  presetId: string | null;
  customImageUrl: string | null;
  hasCustomImage: boolean;
  /** Null keeps the established MegaDesk visual default for existing users. */
  incomingBubbleColor: string | null;
  /** Null keeps the established MegaDesk visual default for existing users. */
  outgoingBubbleColor: string | null;
};

export type ConversationBubbleDirection = "incoming" | "outgoing";

export const CONVERSATION_BUBBLE_COLOR_SWATCHES = [
  "#FFFFFF",
  "#E2E8F0",
  "#DBEAFE",
  "#DCFCE7",
  "#FEF3C7",
  "#FCE7F3",
  "#1E293B",
  "#1D4ED8",
  "#047857",
  "#9F1239",
] as const;

const BUBBLE_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Only canonical six-digit hex colours are persisted; arbitrary CSS is never accepted. */
export function normalizeConversationBubbleColor(
  value: unknown
): string | null {
  return typeof value === "string" && BUBBLE_COLOR.test(value)
    ? value.toUpperCase()
    : null;
}

export function isConversationBubbleColor(value: unknown): value is string {
  return normalizeConversationBubbleColor(value) !== null;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  );
  const [red, green, blue] = channels.map(channel =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Returns a readable foreground for a trusted bubble background colour. */
export function conversationBubbleForegroundColor(
  color: string
): "#0F172A" | "#FFFFFF" {
  return relativeLuminance(color) > 0.36 ? "#0F172A" : "#FFFFFF";
}

export type ConversationBackgroundStyle = {
  backgroundColor: string;
  backgroundImage?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  backgroundSize?: string;
};

export const DEFAULT_CONVERSATION_BACKGROUND: ConversationBackgroundPreference =
  {
    backgroundType: "default",
    presetId: null,
    customImageUrl: null,
    hasCustomImage: false,
    incomingBubbleColor: null,
    outgoingBubbleColor: null,
  };

export function getConversationBackgroundPreset(
  presetId: string | null | undefined
): ConversationBackgroundPreset | null {
  if (!presetId) return null;
  return (
    CONVERSATION_BACKGROUND_PRESETS.find(preset => preset.id === presetId) ??
    null
  );
}

export function isConversationBackgroundPresetId(
  value: unknown
): value is string {
  return (
    typeof value === "string" && getConversationBackgroundPreset(value) !== null
  );
}

/** Always returns a safe, renderable preference; corrupt values fall back to MegaDesk default. */
export function normalizeConversationBackgroundPreference(
  value: Partial<ConversationBackgroundPreference> | null | undefined
): ConversationBackgroundPreference {
  const bubbleColors = {
    incomingBubbleColor: normalizeConversationBubbleColor(
      value?.incomingBubbleColor
    ),
    outgoingBubbleColor: normalizeConversationBubbleColor(
      value?.outgoingBubbleColor
    ),
  };
  if (
    value?.backgroundType === "preset" &&
    isConversationBackgroundPresetId(value.presetId)
  ) {
    return {
      backgroundType: "preset",
      presetId: value.presetId,
      customImageUrl: null,
      hasCustomImage: Boolean(value.hasCustomImage),
      ...bubbleColors,
    };
  }
  if (
    value?.backgroundType === "custom" &&
    typeof value.customImageUrl === "string" &&
    value.customImageUrl.length > 0
  ) {
    return {
      backgroundType: "custom",
      presetId: null,
      customImageUrl: value.customImageUrl,
      hasCustomImage: true,
      ...bubbleColors,
    };
  }
  return {
    ...DEFAULT_CONVERSATION_BACKGROUND,
    hasCustomImage: Boolean(value?.hasCustomImage),
    ...bubbleColors,
  };
}

/** Resolves only trusted preset definitions or a server-issued image URL. */
export function resolveConversationBackgroundStyle(
  value: Partial<ConversationBackgroundPreference> | null | undefined
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
