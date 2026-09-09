export const USER_PERSONALIZATION_BACKGROUND_PATH = "/api/user-personalization/background";

export function isUserPersonalizationBackgroundPath(value: string | null | undefined): value is string {
  return Boolean(value && (value === USER_PERSONALIZATION_BACKGROUND_PATH || value.startsWith(`${USER_PERSONALIZATION_BACKGROUND_PATH}?`)));
}

export function trpcBaseUrl(hostname = window.location.hostname): string {
  return hostname.endsWith("megadesk.online")
    ? "https://api.megadesk.online/api/trpc"
    : "/api/trpc";
}

export function trpcProcedureUrl(procedure: string, hostname = window.location.hostname): string {
  return `${trpcBaseUrl(hostname)}/${procedure}`;
}

export function conversationMediaUrl(conversationId: string, messageId: string, hostname = window.location.hostname): string {
  return `${trpcBaseUrl(hostname).replace(/\/api\/trpc$/, "")}/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/media`;
}

export function userPersonalizationBackgroundUrl(hostname = window.location.hostname): string {
  return `${trpcBaseUrl(hostname).replace(/\/api\/trpc$/, "")}${USER_PERSONALIZATION_BACKGROUND_PATH}`;
}

export function resolveUserPersonalizationBackgroundUrl(value: string, hostname = window.location.hostname): string {
  if (!isUserPersonalizationBackgroundPath(value)) return value;
  return `${userPersonalizationBackgroundUrl(hostname)}${value.slice(USER_PERSONALIZATION_BACKGROUND_PATH.length)}`;
}
