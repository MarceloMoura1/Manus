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
