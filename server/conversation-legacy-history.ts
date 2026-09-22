import { publicConversationMediaMetadata } from "./conversation-media-storage";

export type ConversationMessageChronology = "absolute" | "unknown";

export type ConversationHistoryMessage = Record<string, unknown> & {
  id?: string;
  timestamp?: string | Date | null;
  chronology: ConversationMessageChronology;
};

export type ConversationHistoryRead = {
  messages: ConversationHistoryMessage[];
  indeterminateHistory: ConversationHistoryMessage[];
};

const RFC3339_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/;
const PRIVATE_MEDIA_KEYS = new Set(["mediadata", "base64", "dataurl", "storagekey", "physicalpath", "filepath", "localpath"]);
const BINARY_DATA_URL = /^data:(?:image|audio|video|application)\/[A-Za-z0-9!#$&^_.+-]+(?:;[A-Za-z0-9!#$&^_.+-]+(?:=[^;,]*)?)*;base64,[A-Za-z0-9+/=\s]*$/i;
const OMIT_LEGACY_VALUE = Symbol("omit legacy media value");
const MAX_LEGACY_SANITIZE_DEPTH = 64;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Accepts only an unambiguous absolute instant; local or display-only time never enters the timeline sort. */
export function hasAbsoluteTimestamp(value: unknown) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === "string" && RFC3339_WITH_OFFSET.test(value) && !Number.isNaN(new Date(value).getTime());
}

function legacyRecords(messagesJson: unknown): Record<string, unknown>[] {
  if (typeof messagesJson !== "string") return [] as Record<string, unknown>[];
  try {
    const parsed = JSON.parse(messagesJson);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [];
  } catch {
    return [];
  }
}

/**
 * Legacy JSON is untrusted compatibility data. Keep its public shape, but never
 * expose binary payloads or storage-location details at any nesting depth.
 */
function sanitizeLegacyValue(value: unknown, depth = 0): unknown | typeof OMIT_LEGACY_VALUE {
  if (depth > MAX_LEGACY_SANITIZE_DEPTH) return OMIT_LEGACY_VALUE;
  if (typeof value === "string") return BINARY_DATA_URL.test(value) ? OMIT_LEGACY_VALUE : value;
  if (Array.isArray(value)) {
    const safe: unknown[] = [];
    for (const item of value) {
      const sanitized = sanitizeLegacyValue(item, depth + 1);
      if (sanitized !== OMIT_LEGACY_VALUE) safe.push(sanitized);
    }
    return safe;
  }
  if (!record(value)) return value;

  const safe: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_MEDIA_KEYS.has(key.toLowerCase())) continue;
    const sanitized = sanitizeLegacyValue(nested, depth + 1);
    if (sanitized !== OMIT_LEGACY_VALUE) safe[key] = sanitized;
  }
  return safe;
}

function parseLegacyMessages(messagesJson: unknown, limit: number) {
  return legacyRecords(messagesJson).slice(0, limit).map(sanitizeLegacyMedia);
}

/**
 * Returns only a V1 Data URL already stored in this conversation's legacy JSON.
 * The caller must have scoped the conversation and tenant before invoking it.
 */
export function findLegacyConversationMedia(messagesJson: unknown, messageId: string): {
  mediaData: string;
  fileName?: unknown;
  messageType?: unknown;
} | null {
  const message = legacyRecords(messagesJson).find(item => nonEmptyId(item.id) === messageId);
  if (!message) return null;
  const nested = message.mediaReference;
  const reference = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : message;
  if (typeof reference.mediaData !== "string") return null;
  return { mediaData: reference.mediaData, fileName: reference.fileName ?? message.fileName, messageType: message.type };
}

/** Old JSON mirrors may still contain V1 Data URLs. History is API data, never a binary transport. */
function sanitizeLegacyMedia(message: Record<string, unknown>): Record<string, unknown> {
  const nestedReference = message.mediaReference;
  const publicMedia = publicConversationMediaMetadata(nestedReference, message.id)
    ?? publicConversationMediaMetadata(message, message.id);
  const sanitized = sanitizeLegacyValue(message);
  const safe = record(sanitized) ? sanitized : {};
  if (!publicMedia) return safe;
  const { mediaReference, ...metadata } = publicMedia;
  return { ...safe, ...metadata, mediaReference };
}

/**
 * Normalized messages are authoritative. JSON entries with a proven matching id are mirrors and are omitted;
 * all remaining JSON entries are preserved, either on the absolute timeline or in the explicitly indeterminate section.
 */
export function readConversationHistory(
  normalized: Record<string, unknown>[],
  messagesJson: unknown,
  limit: number,
): ConversationHistoryRead {
  const normalizedIds = new Set(normalized.map(message => nonEmptyId(message.id)).filter(Boolean));
  const messages: ConversationHistoryMessage[] = normalized.map(message => ({ ...message, chronology: "absolute" }));
  const indeterminateHistory: ConversationHistoryMessage[] = [];

  for (const message of parseLegacyMessages(messagesJson, limit)) {
    const legacyId = nonEmptyId(message.id);
    if (legacyId && normalizedIds.has(legacyId)) continue;
    if (hasAbsoluteTimestamp(message.timestamp)) {
      messages.push({ ...message, chronology: "absolute" });
    } else {
      indeterminateHistory.push({ ...message, chronology: "unknown" });
    }
  }

  return { messages, indeterminateHistory };
}
