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
 *   DELETE /instance/delete/:name  → deleta instância
 *   POST /message/sendText/:name   → envia mensagem
 *   POST /webhook/set/:name        → configura webhook
 */

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_API_URL || "http://localhost:8080").replace(/\/$/, "");
const EVOLUTION_API_KEY  = process.env.EVOLUTION_API_KEY || "";

function buildHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: EVOLUTION_API_KEY,
  };
}

async function request<T = any>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${EVOLUTION_BASE_URL}${path}`;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[Evolution] ${method} ${url}`);
  }

  const res = await fetch(url, {
    method,
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error(`[Evolution] ERRO ${res.status} ${method} ${path}: ${text.slice(0, 500)}`);
    throw new Error(`Evolution API [${res.status}] ${path}: ${text.slice(0, 300)}`);
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
    data?.code,                        // raw QR (menos comum como imagem)
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "string" && candidate.length > 50) {
      // Normaliza: garante prefixo data URI
      return candidate.startsWith("data:")
        ? candidate
        : `data:image/png;base64,${candidate}`;
    }
  }

  console.warn("[Evolution] QR Code não encontrado na resposta. Campos disponíveis:", Object.keys(data));
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

    console.log(`[Evolution] /instance/connect/${instanceName} →`, JSON.stringify(data).slice(0, 300));

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
  } catch (err: any) {
    // 404 = instância não existe ainda
    if (err.message?.includes("404") || err.message?.toLowerCase().includes("not found") ||
        err.message?.toLowerCase().includes("does not exist")) {
      console.warn(`[Evolution] Instância ${instanceName} não existe ainda`);
      return null;
    }
    console.error(`[Evolution] Erro em evoGetQRCode(${instanceName}):`, err.message);
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
  } catch (err: any) {
    // Instância não existe = disconnected
    if (err.message?.includes("404") || err.message?.toLowerCase().includes("not found")) {
      return "disconnected";
    }
    console.warn(`[Evolution] evoGetStatus falhou para ${instanceName}:`, err.message);
    return "disconnected";
  }
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
 * Configura webhook da instância para receber eventos do MegaDesk.
 */
export async function evoSetWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  console.log(`[Evolution] Configurando webhook: ${instanceName} → ${webhookUrl}`);
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
