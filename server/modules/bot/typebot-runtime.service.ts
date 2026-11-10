/**
 * Bot Module — Typebot Runtime (execução do fluxo publicado do tenant).
 *
 * 1. Resolve o Typebot publicado no workspace isolado do tenant
 *    (Workspace.settings.megadeskClientId = clientId).
 * 2. Normaliza estruturas de botões consecutivos para evitar corte de opções.
 * 3. Executa o fluxo pelo viewer na rede interna do Docker
 *    (`/api/v1/typebots/{publicId}/startChat` e `/api/v1/sessions/{id}/continueChat`).
 * 4. Converte mensagens (texto, imagens, vídeos, áudios) e inputs para o WhatsApp.
 */
import { typebotWorkspaceService } from "./typebot-workspace.service";

export interface PublishedTypebot {
  typebotId: string;
  publicId: string;
  name: string;
}

export type TypebotTurnItem =
  | { type: "text"; text: string }
  | { type: "image"; url: string; caption?: string }
  | { type: "video"; url: string; caption?: string }
  | { type: "audio"; url: string; caption?: string };

export interface TypebotTurnResult {
  sessionId: string;
  messages: string[];
  items: TypebotTurnItem[];
  /** true quando o fluxo terminou (não há input aguardando resposta do cliente). */
  flowEnded: boolean;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

type SessionEntry = { sessionId: string; typebotId: string; updatedAt: number };
const sessions = new Map<string, SessionEntry>();

const sessionKey = (tenantId: string, conversationId: string) => `${tenantId}\u0000${conversationId}`;

export function getTypebotViewerInternalUrl(): string {
  return (process.env.TYPEBOT_VIEWER_INTERNAL_URL || "http://typebot-viewer:3000").replace(/\/+$/, "");
}

export function clearTypebotSession(tenantId: string, conversationId: string): void {
  sessions.delete(sessionKey(tenantId, conversationId));
}

/** Usado apenas por testes. */
export function __resetTypebotSessions(): void {
  sessions.clear();
}

/**
 * Normaliza os blocos do Typebot: quando blocos de "choice input" consecutivos
 * são criados no mesmo grupo (ex: o usuário arrasta múltiplos botões como blocos separados),
 * mescla os itens no primeiro bloco de escolha e atualiza os edges correspondentes.
 */
export async function normalizeTypebotStructure(typebotId: string): Promise<boolean> {
  try {
    const pool = typebotWorkspaceService.getPool();
    let anyChanged = false;

    for (const table of ["PublicTypebot", "Typebot"]) {
      const whereClause = table === "PublicTypebot" ? `WHERE "typebotId" = $1` : `WHERE id = $1`;
      const res = await pool.query(
        `SELECT id, groups, edges FROM "${table}" ${whereClause}`,
        [typebotId]
      );
      for (const row of (res?.rows || [])) {
        const groups = typeof row.groups === "string" ? JSON.parse(row.groups) : (row.groups || []);
        let edges = typeof row.edges === "string" ? JSON.parse(row.edges) : (row.edges || []);
        let changed = false;

        for (const group of groups) {
          const newBlocks: any[] = [];
          for (let i = 0; i < (group.blocks || []).length; i++) {
            const block = group.blocks[i];
            if (block.type === "choice input" || block.type === "picture choice input") {
              while (
                i + 1 < group.blocks.length &&
                (group.blocks[i + 1].type === "choice input" || group.blocks[i + 1].type === "picture choice input")
              ) {
                const nextBlock = group.blocks[i + 1];
                block.items = (block.items || []).concat(nextBlock.items || []);
                for (const edge of edges) {
                  if (edge.from && edge.from.blockId === nextBlock.id) {
                    edge.from.blockId = block.id;
                  }
                }
                i++;
                changed = true;
              }
            }
            newBlocks.push(block);
          }
          group.blocks = newBlocks;
        }

        if (changed) {
          await pool.query(
            `UPDATE "${table}" SET groups = $1, edges = $2, "updatedAt" = NOW() WHERE id = $3`,
            [JSON.stringify(groups), JSON.stringify(edges), row.id]
          );
          anyChanged = true;
          console.log(`[TypebotRuntime] Fluxo normalizado com sucesso para ${table} ${row.id}`);
        }
      }
    }
    return anyChanged;
  } catch (err: any) {
    console.warn(`[TypebotRuntime] Erro não-bloqueante na normalização do typebot ${typebotId}:`, err?.message || err);
    return false;
  }
}

/** Localiza o Typebot publicado mais recente no workspace do tenant. */
export async function resolvePublishedTypebot(tenantId: string): Promise<PublishedTypebot | null> {
  const pool = typebotWorkspaceService.getPool();
  const res = await pool.query(
    `SELECT t.id AS "typebotId", t."publicId" AS "publicId", t.name AS name
     FROM "Typebot" t
     JOIN "PublicTypebot" p ON p."typebotId" = t.id
     JOIN "Workspace" w ON w.id = t."workspaceId"
     WHERE w.settings->>'megadeskClientId' = $1
       AND t."isArchived" = false
       AND t."publicId" IS NOT NULL
     ORDER BY p."updatedAt" DESC
     LIMIT 1`,
    [tenantId]
  );
  const row = res.rows?.[0];
  if (!row?.publicId) return null;

  // Normalização assíncrona não-bloqueante
  normalizeTypebotStructure(row.typebotId).catch(() => {});

  return { typebotId: row.typebotId, publicId: row.publicId, name: row.name };
}

function richTextToPlain(nodes: any[]): string {
  const walk = (node: any): string => {
    if (!node) return "";
    if (typeof node.text === "string") {
      let t = node.text;
      if (node.bold && t.trim()) t = `*${t}*`;
      if (node.italic && t.trim()) t = `_${t}_`;
      return t;
    }
    const children = Array.isArray(node.children) ? node.children.map(walk).join("") : "";
    return node.type === "variable" ? children : children;
  };
  return (nodes || []).map(walk).join("\n");
}

/** Converte markdown simples do Typebot para a formatação do WhatsApp. */
function markdownToWhatsApp(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/\\([*_~`])/g, "$1")
    .trim();
}

export function typebotMessageToText(message: any): string {
  if (!message) return "";
  const content = message.content ?? {};
  if (message.type === "text") {
    if (content.type === "markdown" && typeof content.markdown === "string") return markdownToWhatsApp(content.markdown);
    if (Array.isArray(content.richText)) return richTextToPlain(content.richText).trim();
    if (typeof content.html === "string") return content.html.replace(/<[^>]+>/g, "").trim();
    if (typeof content.plainText === "string") return content.plainText.trim();
    return "";
  }
  if (["image", "video", "audio", "embed"].includes(message.type)) {
    return typeof content.url === "string" ? content.url : "";
  }
  return "";
}

export function typebotInputToText(input: any): string {
  if (!input) return "";
  if (input.type === "choice input" || input.type === "picture choice input") {
    const items: any[] = Array.isArray(input.items) ? input.items : [];
    const labels = items
      .map((item) => String(item?.content ?? item?.title ?? "").trim())
      .filter(Boolean);
    if (labels.length === 0) return "";
    const optionsText = labels.map((label, idx) => `${idx + 1}. ${label}`).join("\n");
    return `${optionsText}\n\n_Responda com o número ou o texto da opção._`;
  }
  return "";
}

function normalizeComparisonText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Para inputs de escolha, permite que o cliente responda com o número ou texto da opção. */
export function mapChoiceAnswer(input: any, text: string): string {
  if (!input || (input.type !== "choice input" && input.type !== "picture choice input")) return text;
  const items: any[] = Array.isArray(input.items) ? input.items : [];
  const trimmed = text.trim();
  const n = Number(trimmed);
  if (Number.isInteger(n) && n >= 1 && n <= items.length) {
    return String(items[n - 1]?.content ?? items[n - 1]?.title ?? text);
  }
  const normTarget = normalizeComparisonText(trimmed);
  for (const item of items) {
    const label = String(item?.content ?? item?.title ?? "");
    if (normalizeComparisonText(label) === normTarget) {
      return label;
    }
  }
  return text;
}

const lastInputs = new Map<string, any>();

async function postJson(url: string, body: unknown): Promise<{ status: number; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw: raw.slice(0, 300) }; }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function toTurn(sessionId: string, data: any): TypebotTurnResult {
  const items: TypebotTurnItem[] = [];
  const messages: string[] = [];

  const rawMessages = Array.isArray(data?.messages) ? data.messages : [];
  for (const m of rawMessages) {
    if (!m) continue;
    if (m.type === "text") {
      const text = typebotMessageToText(m);
      if (text.trim()) {
        items.push({ type: "text", text });
        messages.push(text);
      }
    } else if (m.type === "image") {
      const url = m.content?.url;
      if (typeof url === "string" && url.trim()) {
        items.push({ type: "image", url, caption: m.content?.caption });
        messages.push(url);
      }
    } else if (m.type === "video") {
      const url = m.content?.url;
      if (typeof url === "string" && url.trim()) {
        items.push({ type: "video", url, caption: m.content?.caption });
        messages.push(url);
      }
    } else if (m.type === "audio") {
      const url = m.content?.url;
      if (typeof url === "string" && url.trim()) {
        items.push({ type: "audio", url });
        messages.push(url);
      }
    }
  }

  const inputText = typebotInputToText(data?.input);
  if (inputText) {
    items.push({ type: "text", text: inputText });
    messages.push(inputText);
  }

  return { sessionId, messages, items, flowEnded: !data?.input };
}

/**
 * Executa um turno do fluxo publicado para a conversa: continua a sessão ativa
 * ou inicia uma nova (também quando a sessão anterior expirou ou terminou).
 */
export async function runTypebotTurn(input: {
  tenantId: string;
  conversationId: string;
  typebot: PublishedTypebot;
  text: string;
  phone: string;
  customerName?: string;
}): Promise<TypebotTurnResult> {
  const base = getTypebotViewerInternalUrl();
  const key = sessionKey(input.tenantId, input.conversationId);
  const existing = sessions.get(key);
  const now = Date.now();

  if (existing && existing.typebotId === input.typebot.typebotId && now - existing.updatedAt < SESSION_TTL_MS) {
    const answer = mapChoiceAnswer(lastInputs.get(key), input.text);
    const url = `${base}/api/v1/sessions/${encodeURIComponent(existing.sessionId)}/continueChat`;
    console.log(`[BotWebhook] Typebot continueChat session=${existing.sessionId} answer="${answer}"`);
    const { status, data } = await postJson(url, {
      message: { type: "text", text: answer },
      textBubbleContentFormat: "markdown",
    });
    console.log(`[BotWebhook] Typebot continueChat HTTP ${status}`);
    if (status >= 200 && status < 300) {
      existing.updatedAt = now;
      if (data?.input) lastInputs.set(key, data.input); else lastInputs.delete(key);
      const turn = toTurn(existing.sessionId, data);
      if (turn.flowEnded) sessions.delete(key);
      return turn;
    }
    // Sessão inválida/expirada: reinicia o fluxo.
    sessions.delete(key);
    lastInputs.delete(key);
  }

  const url = `${base}/api/v1/typebots/${encodeURIComponent(input.typebot.publicId)}/startChat`;
  console.log(`[BotWebhook] Typebot startChat publicId=${input.typebot.publicId} url=${url}`);
  const { status, data } = await postJson(url, {
    message: { type: "text", text: input.text },
    isStreamEnabled: false,
    textBubbleContentFormat: "markdown",
    prefilledVariables: {
      phone: input.phone,
      telefone: input.phone,
      name: input.customerName || "",
      nome: input.customerName || "",
    },
  });
  console.log(`[BotWebhook] Typebot startChat HTTP ${status}`);
  if (status < 200 || status >= 300 || !data?.sessionId) {
    throw new Error(`Typebot startChat falhou (HTTP ${status}): ${JSON.stringify(data)?.slice(0, 300)}`);
  }
  const turn = toTurn(data.sessionId, data);
  if (!turn.flowEnded) {
    sessions.set(key, { sessionId: data.sessionId, typebotId: input.typebot.typebotId, updatedAt: now });
    lastInputs.set(key, data.input);
  }
  return turn;
}
