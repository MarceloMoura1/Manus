export const CONVERSATION_LOCALE = "pt-BR";
export const CONVERSATION_TIME_ZONE = "America/Sao_Paulo";

const dateTimeFormatter = new Intl.DateTimeFormat(CONVERSATION_LOCALE, {
  timeZone: CONVERSATION_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});

const timeFormatter = new Intl.DateTimeFormat(CONVERSATION_LOCALE, {
  timeZone: CONVERSATION_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

function parseTimestamp(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatConversationDateTime(value: string | Date | null | undefined, fallback = "") {
  const date = parseTimestamp(value);
  return date ? dateTimeFormatter.format(date) : fallback;
}

export function formatConversationTime(value: string | Date | null | undefined, fallback = "") {
  const date = parseTimestamp(value);
  return date ? timeFormatter.format(date) : fallback;
}
