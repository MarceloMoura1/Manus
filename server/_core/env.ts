export const DEFAULT_TICKET_ATTACHMENT_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

export function parseTicketAttachmentReconcileIntervalMs(value: string | undefined): number {
  const intervalMs = Number(value);
  return Number.isSafeInteger(intervalMs) && intervalMs > 0
    ? intervalMs
    : DEFAULT_TICKET_ATTACHMENT_RECONCILE_INTERVAL_MS;
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  ticketAttachmentReconcileIntervalMs: parseTicketAttachmentReconcileIntervalMs(
    process.env.TICKET_ATTACHMENT_RECONCILE_INTERVAL_MS,
  ),
};
