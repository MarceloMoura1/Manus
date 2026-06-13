/**
 * Evolution API Client
 * Cliente HTTP para comunicação com a Evolution API
 * Docs: https://docs.evoapicloud.com
 */

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_API_URL || "http://localhost:8080").replace(/\/$/, "");
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";

const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  apikey: EVOLUTION_API_KEY,
};

async function request<T = any>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${EVOLUTION_BASE_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: DEFAULT_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution API [${res.status}] ${path}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Tipos ─────────────────────────────────────────────────────────────────

export interface EvoInstance {
  instanceName: string;
  status: "open" | "connecting" | "close";
  profileName?: string;
  profilePicUrl?: string;
  ownerJid?: string;
}

export interface EvoQRCode {
  base64: string;   // data:image/png;base64,...
  code?: string;    // raw qr string
}

export interface EvoCreateResult {
  instance: {
    instanceName: string;
    status: string;
  };
  hash?: { apikey: string };
}

// ─── Funções da API ────────────────────────────────────────────────────────

/**
 * Cria uma instância na Evolution API.
 * Se já existir, retorna sem erro.
 */
export async function evoCreateInstance(instanceName: string): Promise<EvoCreateResult> {
  return request<EvoCreateResult>("POST", "/instance/create", {
    instanceName,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
  });
}

/**
 * Busca o QR Code em base64 da instância.
 * Retorna null se a instância já estiver conectada ou o QR ainda não gerou.
 */
export async function evoGetQRCode(instanceName: string): Promise<EvoQRCode | null> {
  try {
    const data = await request<any>("GET", `/instance/connect/${instanceName}`);

    // Evolution pode retornar em diferentes formatos dependendo da versão
    const base64: string | undefined =
      data?.base64 ||
      data?.qrcode?.base64 ||
      data?.data?.base64 ||
      data?.data?.qrcode?.base64;

    if (!base64) return null;

    // Garante prefixo data URI
    const normalized = base64.startsWith("data:")
      ? base64
      : `data:image/png;base64,${base64}`;

    return { base64: normalized, code: data?.code || data?.qrcode?.code };
  } catch (err: any) {
    // Se a instância não existir ainda, retornar null para o chamador criar
    if (err.message?.includes("404") || err.message?.includes("not found")) {
      return null;
    }
    throw err;
  }
}

/**
 * Retorna o status de conexão da instância.
 */
export async function evoGetStatus(instanceName: string): Promise<"connected" | "connecting" | "disconnected"> {
  try {
    const data = await request<any>("GET", `/instance/fetchInstances?instanceName=${instanceName}`);

    // Pode vir como array ou objeto
    const inst = Array.isArray(data) ? data[0] : data?.instance || data;
    const state: string = inst?.connectionStatus || inst?.instance?.status || inst?.status || "close";

    if (state === "open")       return "connected";
    if (state === "connecting") return "connecting";
    return "disconnected";
  } catch {
    return "disconnected";
  }
}

/**
 * Desconecta (logout) a instância.
 */
export async function evoLogout(instanceName: string): Promise<void> {
  await request("DELETE", `/instance/logout/${instanceName}`);
}

/**
 * Deleta a instância da Evolution API.
 */
export async function evoDeleteInstance(instanceName: string): Promise<void> {
  await request("DELETE", `/instance/delete/${instanceName}`);
}

/**
 * Envia mensagem de texto.
 */
export async function evoSendText(
  instanceName: string,
  number: string,
  text: string
): Promise<{ key: { id: string } }> {
  return request("POST", `/message/sendText/${instanceName}`, {
    number,
    text,
    delay: 500,
  });
}

/**
 * Configura webhook da instância para receber eventos.
 */
export async function evoSetWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  await request("POST", `/webhook/set/${instanceName}`, {
    url: webhookUrl,
    byEvents: false,
    base64: false,
    headers: { apikey: EVOLUTION_API_KEY },
    events: [
      "MESSAGES_UPSERT",
      "MESSAGES_UPDATE",
      "CONNECTION_UPDATE",
      "QRCODE_UPDATED",
    ],
  });
}
