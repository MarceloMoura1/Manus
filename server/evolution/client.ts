/**
 * Evolution API Client v2
 * Cliente HTTP para comunicação com a Evolution API
 * Docs: https://docs.evoapicloud.com
 *
 * Endpoints usados:
 *   POST /instance/create          → cria instância (retorna QR na criação se qrcode:true)
 *   GET  /instance/connect/:name   → busca QR Code ou estado atual
 *   GET  /instance/fetchInstances  → status da instância
 *   DELETE /instance/logout/:name  → desconecta (logout)
 *   POST /message/sendText/:name   → envia mensagem
 *   POST /webhook/set/:name        → configura webhook
 */

import { getEvolutionConfig, getEvolutionWebhookSecret } from "./config";
import { normalizeContactPhone } from "../../shared/contact-phone";
import { normalizeProviderMessageReference, type ProviderMessageReference } from "../conversation-provider-reference";

export class EvolutionApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly code: string,
    public readonly safeDetail: string,
  ) {
    super(`Evolution API request failed [${status}] ${path}${safeDetail ? `: ${safeDetail}` : ""}`);
    this.name = "EvolutionApiError";
  }
}

const MAX_PROVIDER_ERROR_BODY = 2_000;
const MAX_SAFE_DETAIL = 240;

export function sanitizeEvolutionErrorDetail(body: string): string {
  if (!body.trim()) return "";
  const bounded = body.slice(0, MAX_PROVIDER_ERROR_BODY);
  let extracted = "";
  try {
    const parsed = JSON.parse(bounded);
    const value = parsed?.response?.message ?? parsed?.message ?? parsed?.error;
    extracted = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").join("; ")
      : typeof value === "string" ? value : "";
  } catch {
    extracted = bounded;
  }
  return extracted
    .replace(/\b(authorization|api[-_ ]?key|cookie|token|secret|password)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[REDACTED]@")
    .replace(/([?&](?:api[-_]?key|token|secret|authorization|password)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b\+?\d[\d\s().-]{9,}\d\b/g, "[REDACTED_NUMBER]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_SAFE_DETAIL);
}

function providerErrorCode(status: number): string {
  if (status === 401 || status === 403) return "EVOLUTION_ACCESS_DENIED";
  if (status === 404) return "EVOLUTION_NOT_FOUND";
  if (status === 409) return "EVOLUTION_CONFLICT";
  if (status >= 500) return "EVOLUTION_UNAVAILABLE";
  return "EVOLUTION_REQUEST_FAILED";
}

function buildHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: getEvolutionConfig().apiKey,
  };
}

async function request<T = any>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${getEvolutionConfig().apiUrl}${path}`;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[Evolution] ${method} ${path}`);
  }

  const res = await fetch(url, {
    method,
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error(`[Evolution] request failed: status=${res.status} method=${method} path=${path}`);
    throw new EvolutionApiError(res.status, path.split("?")[0], providerErrorCode(res.status), sanitizeEvolutionErrorDetail(text));
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as any;
  }
}

// ─── Tipos ─────────────────────────────────────────────────────────────────

export interface EvoQRCode {
  base64: string;   // data:image/png;base64,...  (já normalizado)
  code?: string;    // raw QR string
}

export interface EvoWebhookSummary {
  enabled: boolean;
  url: string;
  events: string[];
  hasSecretHeader: boolean;
}

// ─── Extrator de QR Code (multi-formato) ──────────────────────────────────

/**
 * Extrai o QR Code base64 de qualquer formato de resposta da Evolution API v2.
 * A Evolution pode retornar em vários formatos dependendo do endpoint/versão.
 */
function extractQRBase64(data: any): string | null {
  if (!data) return null;

  // Formatos possíveis — do mais ao menos comum em v2.x:
  const candidates: (string | undefined)[] = [
    data?.base64,                      // GET /instance/connect → { base64, code, pairingCode }
    data?.qrcode?.base64,              // POST /instance/create → { qrcode: { base64, count } }
    data?.instance?.qrcode?.base64,    // alternativo
    data?.data?.base64,                // wrapper extra
    data?.data?.qrcode?.base64,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "string" && candidate.length > 50) {
      // Normaliza: garante prefixo data URI
      return candidate.startsWith("data:")
        ? candidate
        : `data:image/png;base64,${candidate}`;
    }
  }

  console.warn("[Evolution] QR Code não encontrado na resposta.");
  return null;
}

// ─── Funções da API ────────────────────────────────────────────────────────

/**
 * Cria uma instância na Evolution API.
 * Se qrcode:true, a resposta já inclui o QR Code — use extractQRFromCreateResult().
 */
export async function evoCreateInstance(instanceName: string): Promise<{
  raw: any;
  qrBase64: string | null;
}> {
  const data = await request<any>("POST", "/instance/create", {
    instanceName,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
  });

  console.log(`[Evolution] Instância criada: ${instanceName}`);

  const qrBase64 = extractQRBase64(data);
  if (qrBase64) {
    console.log(`[Evolution] QR Code obtido direto na criação da instância`);
  }

  return { raw: data, qrBase64 };
}

/**
 * Busca o QR Code da instância via GET /instance/connect/:name.
 * Retorna null se já conectada ou QR ainda não disponível.
 */
export async function evoGetQRCode(instanceName: string): Promise<EvoQRCode | null> {
  try {
    const data = await request<any>("GET", `/instance/connect/${instanceName}`);

    // Se a instância já está conectada, o endpoint retorna estado sem QR
    const state = data?.instance?.state || data?.state;
    if (state === "open") {
      console.log(`[Evolution] Instância já conectada (state=open)`);
      return null;
    }

    const base64 = extractQRBase64(data);
    if (!base64) return null;

    return {
      base64,
      code: data?.code || data?.qrcode?.code,
    };
  } catch (err: unknown) {
    if (err instanceof EvolutionApiError && err.status === 404) {
      console.warn(`[Evolution] Instância ${instanceName} não existe ainda`);
      return null;
    }
    console.error("[Evolution] QR request failed", err instanceof EvolutionApiError ? { code: err.code, status: err.status } : undefined);
    throw err;
  }
}

/**
 * Retorna o status de conexão da instância.
 * Usa GET /instance/fetchInstances para maior compatibilidade entre versões.
 */
export async function evoGetStatus(
  instanceName: string
): Promise<"connected" | "connecting" | "disconnected"> {
  try {
    // v2: GET /instance/fetchInstances?instanceName=X
    const data = await request<any>(
      "GET",
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`
    );

    // A resposta pode ser array ou objeto
    const inst = Array.isArray(data) ? data[0] : data?.instance || data;
    const state: string = (
      inst?.connectionStatus ||
      inst?.instance?.state  ||
      inst?.state            ||
      inst?.status           ||
      "close"
    ).toLowerCase();

    console.log(`[Evolution] Status de ${instanceName}: "${state}"`);

    if (state === "open")        return "connected";
    if (state === "connecting")  return "connecting";
    return "disconnected"; // close, logout, undefined, etc.
  } catch (err: unknown) {
    if (err instanceof EvolutionApiError && err.status === 404) {
      return "disconnected";
    }
    console.warn("[Evolution] status request failed", err instanceof EvolutionApiError ? { code: err.code, status: err.status } : undefined);
    throw err;
  }
}

export async function evoGetWebhookSummary(instanceName: string): Promise<EvoWebhookSummary> {
  const data = await request<any>("GET", `/webhook/find/${instanceName}`);
  const webhook = data?.webhook ?? data ?? {};
  return {
    enabled: webhook.enabled === true,
    url: typeof webhook.url === "string" ? webhook.url : "",
    events: Array.isArray(webhook.events) ? webhook.events.filter((event: unknown): event is string => typeof event === "string") : [],
    hasSecretHeader: Boolean(webhook.headers?.["x-megadesk-webhook-secret"]),
  };
}

/**
 * Desconecta (logout) a instância — mantém instância mas desconecta o número.
 */
export async function evoLogout(instanceName: string): Promise<void> {
  await request("DELETE", `/instance/logout/${instanceName}`);
}

/**
 * Deleta completamente a instância da Evolution API.
 */
export function normalizeEvolutionRecipient(number: string): string {
  const result = normalizeContactPhone(number);
  if (result.status !== "valid") throw new Error("Número de WhatsApp inválido.");
  return result.value;
}

/**
 * Envia mensagem de texto.
 */
export async function evoSendText(
  instanceName: string,
  number: string,
  text: string,
  quoted?: ProviderMessageReference,
): Promise<ProviderMessageReference> {
  const normalizedNumber = normalizeEvolutionRecipient(number);
  const response = await request<any>("POST", `/message/sendText/${instanceName}`, {
    number: normalizedNumber,
    text,
    delay: 500,
    ...(quoted ? { quoted } : {}),
  });
  const reference = normalizeProviderMessageReference(response);
  if (!reference) throw new Error("A Evolution não confirmou a referência completa da mensagem.");
  return reference;
}

export type EvolutionAttachmentKind = "image" | "video" | "audio" | "document" | "sticker";

export async function evoSendAttachment(input: {
  instanceName: string;
  number: string;
  kind: EvolutionAttachmentKind;
  dataUrl: string;
  mimeType: string;
  fileName?: string;
  caption?: string;
  quoted?: ProviderMessageReference;
}): Promise<ProviderMessageReference> {
  const number = normalizeEvolutionRecipient(input.number);
  // Evolution 2.3.x expects the media field as raw base64 (or a public URL),
  // not as a browser data URI.
  const media = input.dataUrl.replace(/^data:[^,]+;base64,/i, "");
  let response: unknown;
  if (input.kind === "audio") {
    response = await request("POST", `/message/sendWhatsAppAudio/${input.instanceName}`, {
      number,
      audio: media,
      encoding: true,
      delay: 500,
      ...(input.quoted ? { quoted: input.quoted } : {}),
    });
  } else if (input.kind === "sticker") {
    response = await request("POST", `/message/sendSticker/${input.instanceName}`, {
      number,
      sticker: media,
      delay: 500,
      ...(input.quoted ? { quoted: input.quoted } : {}),
    });
  } else {
    response = await request("POST", `/message/sendMedia/${input.instanceName}`, {
      number,
      mediatype: input.kind,
      mimetype: input.mimeType,
      media,
      fileName: input.fileName,
      caption: input.caption || "",
      delay: 500,
      ...(input.quoted ? { quoted: input.quoted } : {}),
    });
  }
  const reference = normalizeProviderMessageReference(response);
  if (!reference) throw new Error("A Evolution não confirmou a referência completa da mensagem.");
  return reference;
}

export async function evoGetMediaBase64(
  instanceName: string,
  message: Record<string, unknown>,
): Promise<{ base64: string; mimetype?: string; fileName?: string }> {
  const result = await request<Record<string, unknown>>(
    "POST",
    `/chat/getBase64FromMediaMessage/${instanceName}`,
    { message, convertToMp4: false },
  );
  if (typeof result?.base64 !== "string" || !result.base64) {
    throw new Error("Evolution API did not return media content.");
  }
  return {
    base64: result.base64,
    mimetype: typeof result.mimetype === "string" ? result.mimetype : undefined,
    fileName: typeof result.fileName === "string" ? result.fileName : undefined,
  };
}

/**
 * Configura webhook da instância para receber eventos do MegaDesk.
 */
export async function evoSetWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  console.log(`[Evolution] Configurando webhook: ${instanceName} → ${webhookUrl}`);
  await request("POST", `/webhook/set/${instanceName}`, {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: true,
      headers: { "x-megadesk-webhook-secret": getEvolutionWebhookSecret() },
      events: [
        "MESSAGES_UPSERT",
        "MESSAGES_UPDATE",
        "CONNECTION_UPDATE",
        "QRCODE_UPDATED",
      ],
    },
  });
}
