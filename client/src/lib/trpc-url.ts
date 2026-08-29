export function trpcBaseUrl(hostname = window.location.hostname): string {
  return hostname.endsWith("megadesk.online")
    ? "https://api.megadesk.online/api/trpc"
    : "/api/trpc";
}

export function trpcProcedureUrl(procedure: string, hostname = window.location.hostname): string {
  return `${trpcBaseUrl(hostname)}/${procedure}`;
}
