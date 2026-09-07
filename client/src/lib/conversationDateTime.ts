export const DEFAULT_LOCALE = "pt-BR";
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

export const CONVERSATION_LOCALE = DEFAULT_LOCALE;
export const CONVERSATION_TIME_ZONE = DEFAULT_TIME_ZONE;

const dateFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  timeZone: DEFAULT_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  timeZone: DEFAULT_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  timeZone: DEFAULT_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});

const timeFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  timeZone: DEFAULT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export function parsePlatformDate(value: string | number | Date | null | undefined): Date | null {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const ms = value < 1e11 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      const ms = num < 1e11 ? num * 1000 : num;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    // SQL timestamp without timezone (e.g., "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss" without offset/Z)
    // Server database stores canonical UTC instants; treat as UTC to prevent browser from interpreting as local host time.
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
      const iso = trimmed.replace(" ", "T") + "Z";
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function formatDate(value: string | number | Date | null | undefined, fallback = ""): string {
  const date = parsePlatformDate(value);
  return date ? dateFormatter.format(date) : fallback;
}

export function formatShortDate(value: string | number | Date | null | undefined, fallback = ""): string {
  const date = parsePlatformDate(value);
  return date ? shortDateFormatter.format(date) : fallback;
}

export function formatTime(value: string | number | Date | null | undefined, fallback = ""): string {
  const date = parsePlatformDate(value);
  return date ? timeFormatter.format(date) : fallback;
}

export function formatDateTime(value: string | number | Date | null | undefined, fallback = ""): string {
  const date = parsePlatformDate(value);
  return date ? dateTimeFormatter.format(date) : fallback;
}

export const formatConversationDateTime = formatDateTime;
export const formatConversationTime = formatTime;
