/**
 * WhatsApp Module — Meta Graph API Client
 * Comunicação com a Meta WhatsApp Cloud API (Graph API v19+).
 * Isolado aqui para facilitar extração futura como microserviço.
 */

const META_API_VERSION = "v19.0";
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export class MetaGraphApiError extends Error {
  constructor(
    public code: number,
    public type: string,
    message: string
  ) {
    super(message);
    this.name = "MetaGraphApiError";
  }
}

async function metaFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${META_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok || data.error) {
    const err = data.error as Record<string, unknown> | undefined;
    throw new MetaGraphApiError(
      (err?.code as number) ?? res.status,
      (err?.type as string) ?? "api_error",
      (err?.message as string) ?? `Meta API error ${res.status}`
    );
  }

  return data as T;
}

// ─── Envio de Mensagens ────────────────────────────────────────────────────────

export async function sendTextMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
) {
  return metaFetch<{ messages: { id: string }[] }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    }
  );
}

export async function sendImageMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  imageUrl: string,
  caption?: string
) {
  return metaFetch<{ messages: { id: string }[] }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "image",
        image: { link: imageUrl, ...(caption ? { caption } : {}) },
      }),
    }
  );
}

export async function sendAudioMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  audioUrl: string
) {
  return metaFetch<{ messages: { id: string }[] }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "audio",
        audio: { link: audioUrl },
      }),
    }
  );
}

export async function sendVideoMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  videoUrl: string,
  caption?: string
) {
  return metaFetch<{ messages: { id: string }[] }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "video",
        video: { link: videoUrl, ...(caption ? { caption } : {}) },
      }),
    }
  );
}

export async function sendDocumentMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  documentUrl: string,
  filename?: string,
  caption?: string
) {
  return metaFetch<{ messages: { id: string }[] }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "document",
        document: {
          link: documentUrl,
          ...(filename ? { filename } : {}),
          ...(caption ? { caption } : {}),
        },
      }),
    }
  );
}

export async function sendTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode: string,
  components?: unknown[]
) {
  return metaFetch<{ messages: { id: string }[] }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components ? { components } : {}),
        },
      }),
    }
  );
}

export async function markMessageAsRead(
  phoneNumberId: string,
  accessToken: string,
  waMessageId: string
) {
  return metaFetch<{ success: boolean }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: waMessageId,
      }),
    }
  );
}

// ─── Gerenciamento de Mídia ────────────────────────────────────────────────────

export async function getMediaUrl(mediaId: string, accessToken: string): Promise<string> {
  const data = await metaFetch<{ url: string; mime_type: string }>(
    `/${mediaId}`,
    accessToken
  );
  return data.url;
}

// ─── Registro de Webhook ───────────────────────────────────────────────────────

export async function registerWebhook(
  businessAccountId: string,
  accessToken: string,
  callbackUrl: string,
  verifyToken: string
) {
  return metaFetch<{ success: boolean }>(
    `/${businessAccountId}/subscriptions`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        object: "whatsapp_business_account",
        callback_url: callbackUrl,
        verify_token: verifyToken,
        fields: ["messages"],
      }),
    }
  );
}

// ─── Info da Conta ─────────────────────────────────────────────────────────────

export async function getPhoneNumberInfo(
  phoneNumberId: string,
  accessToken: string
): Promise<{ display_phone_number: string; verified_name: string; quality_rating: string }> {
  return metaFetch(
    `/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    accessToken
  );
}
