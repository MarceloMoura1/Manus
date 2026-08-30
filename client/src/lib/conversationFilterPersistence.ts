export type ConversationAttendantScope = "all" | "mine";
export type ConversationInboxView = "open" | "bot" | "closed";

export type ConversationFilters = {
  attendantScope: ConversationAttendantScope;
  inboxView: ConversationInboxView;
};

export const DEFAULT_CONVERSATION_FILTERS: ConversationFilters = {
  attendantScope: "all",
  inboxView: "open",
};

const STORAGE_PREFIX = "megadesk:conversation-filters:v1";

function opaqueIdentity(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function conversationFilterStorageKey(tenantId: string, userId: string): string | null {
  const tenant = tenantId.trim();
  const user = userId.trim().toLowerCase();
  if (!tenant || !user) return null;
  return `${STORAGE_PREFIX}:${opaqueIdentity(tenant)}:${opaqueIdentity(user)}`;
}

export function validateConversationFilters(value: unknown): ConversationFilters | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "attendantScope" && key !== "inboxView")) return null;
  if (record.attendantScope !== "all" && record.attendantScope !== "mine") return null;
  if (record.inboxView !== "open" && record.inboxView !== "bot" && record.inboxView !== "closed") return null;
  return { attendantScope: record.attendantScope, inboxView: record.inboxView };
}

type FilterStorage = Pick<Storage, "getItem" | "setItem">;

export function readConversationFilters(
  search: string,
  storage: FilterStorage,
  storageKey: string | null,
): ConversationFilters {
  const params = new URLSearchParams(search);
  if (params.has("conversationScope") || params.has("conversationInbox")) {
    return validateConversationFilters({
      attendantScope: params.get("conversationScope"),
      inboxView: params.get("conversationInbox"),
    }) ?? DEFAULT_CONVERSATION_FILTERS;
  }
  if (!storageKey) return DEFAULT_CONVERSATION_FILTERS;
  try {
    return validateConversationFilters(JSON.parse(storage.getItem(storageKey) ?? "null")) ?? DEFAULT_CONVERSATION_FILTERS;
  } catch {
    return DEFAULT_CONVERSATION_FILTERS;
  }
}

export function writeConversationFilters(storage: FilterStorage, storageKey: string | null, filters: ConversationFilters): void {
  if (!storageKey) return;
  storage.setItem(storageKey, JSON.stringify({
    attendantScope: filters.attendantScope,
    inboxView: filters.inboxView,
  }));
}
