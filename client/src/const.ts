export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Gera a URL de login OAuth.
 * Retorna "/" como fallback seguro quando VITE_OAUTH_PORTAL_URL não estiver configurado.
 * Isso evita que new URL("undefined/app-auth") quebre useAuth em ambiente local.
 */
export const getLoginUrl = (): string => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;

  // Fallback seguro: sem OAuth configurado, redirecionar para root (não quebra a app)
  if (!oauthPortalUrl || oauthPortalUrl === "undefined") {
    return "/";
  }

  try {
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    const state = btoa(redirectUri);
    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId ?? "");
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");
    return url.toString();
  } catch {
    // Se new URL() falhar por qualquer motivo, não quebrar a aplicação
    return "/";
  }
};
