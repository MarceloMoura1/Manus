export type MegaDeskPlatform = "megadesk" | "megaadmin";

const ADMIN_PATHS = ["/admin", "/megaadmin"];
const DESK_PATHS = ["/desk", "/megadesk"];

function normalizeExternalUrl(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function getConfiguredPlatformUrl(platform: MegaDeskPlatform) {
  const env = import.meta.env as Record<string, unknown>;
  return platform === "megaadmin"
    ? normalizeExternalUrl(env.VITE_MEGAADMIN_URL)
    : normalizeExternalUrl(env.VITE_MEGADESK_URL);
}

export function getPlatformPath(platform: MegaDeskPlatform) {
  return platform === "megaadmin" ? "/admin" : "/desk";
}

export function getPlatformUrl(platform: MegaDeskPlatform) {
  return getConfiguredPlatformUrl(platform) ?? `${window.location.origin}${getPlatformPath(platform)}`;
}

export function getPlatformFromLocation(location: Pick<Location, "hostname" | "pathname"> = window.location): MegaDeskPlatform {
  const hostname = location.hostname.toLowerCase();
  const pathname = location.pathname.toLowerCase();

  if (hostname.includes("megaadmin") || hostname.startsWith("admin.")) return "megaadmin";
  if (hostname.includes("megadesk") || hostname.startsWith("desk.")) return "megadesk";
  if (ADMIN_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return "megaadmin";
  if (DESK_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return "megadesk";
  return "megadesk";
}

export function navigateToPlatform(platform: MegaDeskPlatform) {
  const target = getPlatformUrl(platform);
  const targetUrl = new URL(target, window.location.origin);

  if (targetUrl.origin === window.location.origin) {
    window.history.pushState({}, "", `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }

  window.location.assign(targetUrl.toString());
}
