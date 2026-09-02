export type ConversationChannelPresentation = { label: string; tone: "whatsapp" };

/** Presentation only: data stays canonical in the conversations.list contract. */
export function getConversationChannelPresentation(provider?: string | null, channel?: string | null): ConversationChannelPresentation | null {
  const normalizedProvider = provider?.trim().toLowerCase();
  const normalizedChannel = channel?.trim().toLowerCase();
  if (normalizedChannel === "whatsapp" || normalizedProvider === "whatsapp") return { label: "WhatsApp", tone: "whatsapp" };
  return null;
}

export function formatConversationListTimestamp(value: unknown, now = new Date()): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
