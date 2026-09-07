export const MEGADESK_FAVICON_HREF = "/megadesk-favicon.png?v=1";

export function browserBrandForHostname(hostname: string) {
  return {
    title: hostname.trim().toLowerCase() === "admin.megadesk.online" ? "MegaAdmin" : "MegaDesk",
    faviconHref: MEGADESK_FAVICON_HREF,
  };
}
