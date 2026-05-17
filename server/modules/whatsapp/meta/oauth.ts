/**
 * WhatsApp Module — Meta OAuth
 * Fluxo OAuth para conectar conta WhatsApp Business via Meta.
 * Documentação: https://developers.facebook.com/docs/whatsapp/embedded-signup
 */

const META_API_VERSION = "v19.0";

export interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/**
 * Gera a URL de autorização OAuth da Meta para o usuário fazer login
 * e autorizar o MegaDesk a gerenciar o WhatsApp Business.
 */
export function buildMetaOAuthUrl(config: MetaOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    scope: [
      "whatsapp_business_management",
      "whatsapp_business_messaging",
      "business_management",
    ].join(","),
    response_type: "code",
    state,
  });

  return `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`;
}

export interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

/**
 * Troca o código de autorização por um access_token.
 */
export async function exchangeCodeForToken(
  config: MetaOAuthConfig,
  code: string
): Promise<MetaTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  });

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?${params.toString()}`
  );

  if (!res.ok) {
    const err = await res.json() as Record<string, unknown>;
    throw new Error(`Meta OAuth error: ${JSON.stringify(err)}`);
  }

  return res.json() as Promise<MetaTokenResponse>;
}

/**
 * Busca os números de telefone associados à conta Business do usuário.
 */
export async function getPhoneNumbers(
  accessToken: string
): Promise<{ id: string; display_phone_number: string; verified_name: string; quality_rating: string }[]> {
  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/me/businesses?fields=id,name,whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,quality_rating}}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error("Falha ao buscar números de telefone da conta Meta");
  }

  const data = await res.json() as Record<string, unknown>;
  // Extrair todos os phone_numbers de todos os business accounts
  const phones: { id: string; display_phone_number: string; verified_name: string; quality_rating: string }[] = [];

  const businesses = (data.data as Record<string, unknown>[]) ?? [];
  for (const biz of businesses) {
    const wabas = ((biz.whatsapp_business_accounts as Record<string, unknown>)?.data as Record<string, unknown>[]) ?? [];
    for (const waba of wabas) {
      const numbers = ((waba.phone_numbers as Record<string, unknown>)?.data as Record<string, unknown>[]) ?? [];
      for (const num of numbers) {
        phones.push(num as { id: string; display_phone_number: string; verified_name: string; quality_rating: string });
      }
    }
  }

  return phones;
}

/**
 * Obtém o business_account_id associado a um phone_number_id.
 */
export async function getBusinessAccountId(
  phoneNumberId: string,
  accessToken: string
): Promise<string> {
  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}?fields=id,display_phone_number,whatsapp_business_account`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error("Falha ao buscar business account ID");
  }

  const data = await res.json() as Record<string, unknown>;
  const waba = data.whatsapp_business_account as Record<string, unknown> | undefined;
  if (!waba?.id) throw new Error("business_account_id não encontrado");
  return waba.id as string;
}
