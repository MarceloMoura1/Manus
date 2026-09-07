import { formatDate, formatShortDate, formatTime, parsePlatformDate } from "./conversationDateTime";

export type ConversationChannelPresentation = { label: string; tone: "whatsapp" };

/** Presentation only: data stays canonical in the conversations.list contract. */
export function getConversationChannelPresentation(provider?: string | null, channel?: string | null): ConversationChannelPresentation | null {
  const normalizedProvider = provider?.trim().toLowerCase();
  const normalizedChannel = channel?.trim().toLowerCase();
  if (normalizedChannel === "whatsapp" || normalizedProvider === "whatsapp") return { label: "WhatsApp", tone: "whatsapp" };
  return null;
}

export function formatConversationListTimestamp(value: unknown, now: unknown = new Date()): string {
  if (!value) return "";
  const date = parsePlatformDate(value as string | number | Date);
  if (!date) return "";
  const nowDate = parsePlatformDate(now as string | number | Date) ?? new Date();
  const sameDay = formatDate(date) === formatDate(nowDate);
  return sameDay ? formatTime(date) : formatShortDate(date);
}
