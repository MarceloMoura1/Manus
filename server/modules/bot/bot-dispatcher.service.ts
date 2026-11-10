/**
 * Bot Module — Universal Bot Dispatcher Service
 * Interface e implementação unificadas para envio de mensagens via WhatsApp
 * suportando os provedores Evolution API e Meta Cloud API (texto e mídias).
 */
import fs from "node:fs";
import path from "node:path";
import { evoSendText, evoSendAttachment } from "../../evolution/client";
import { instanceNameFor } from "../../evolution/session-store";
import { sendTextMessage } from "../whatsapp/meta/graph-api";
import { listWaAccounts } from "../whatsapp/repositories/whatsapp.repo";
import { getTypebotStorageDir, detectMimeType } from "./typebot-storage-proxy";

export interface WhatsAppSender {
  sendMessage(
    tenantId: string,
    toPhone: string,
    text: string,
    provider: "evolution" | "meta_cloud"
  ): Promise<void>;
  sendTextMessage(options: {
    tenantId: string;
    to: string;
    text: string;
    provider?: "evolution" | "meta_cloud";
  }): Promise<void>;
  sendMediaMessage?(options: {
    tenantId: string;
    to: string;
    mediaUrl: string;
    kind: "image" | "video" | "audio";
    caption?: string;
    fileName?: string;
    mimeType?: string;
    provider?: "evolution" | "meta_cloud";
  }): Promise<void>;
}

export class BotDispatcherService implements WhatsAppSender {
  /**
   * Envia mensagem de texto para o destinatário pelo provedor escolhido (default: evolution).
   */
  async sendTextMessage(options: {
    tenantId: string;
    to: string;
    text: string;
    provider?: "evolution" | "meta_cloud";
  }): Promise<void> {
    return this.sendMessage(options.tenantId, options.to, options.text, options.provider || "evolution");
  }

  /**
   * Envia mensagem de texto para o destinatário pelo provedor escolhido.
   */
  async sendMessage(
    tenantId: string,
    toPhone: string,
    text: string,
    provider: "evolution" | "meta_cloud"
  ): Promise<void> {
    if (!tenantId || !tenantId.trim()) {
      throw new Error("tenantId é obrigatório para envio de mensagem do bot.");
    }
    if (!toPhone || !toPhone.trim()) {
      throw new Error("toPhone é obrigatório para envio de mensagem do bot.");
    }
    if (!text || !text.trim()) {
      throw new Error("text não pode ser vazio.");
    }

    const cleanPhone = toPhone.replace(/\D/g, "");
    if (!cleanPhone) {
      throw new Error("Número de telefone de destino inválido.");
    }

    if (provider === "evolution") {
      await this.sendViaEvolution(tenantId, cleanPhone, text);
      return;
    }

    if (provider === "meta_cloud") {
      await this.sendViaMetaCloud(tenantId, cleanPhone, text);
      return;
    }

    throw new Error(`Provedor não suportado: ${provider}`);
  }

  /**
   * Envia mídia (imagem, vídeo, áudio) para o destinatário via Evolution API.
   */
  async sendMediaMessage(options: {
    tenantId: string;
    to: string;
    mediaUrl: string;
    kind: "image" | "video" | "audio";
    caption?: string;
    fileName?: string;
    mimeType?: string;
    provider?: "evolution" | "meta_cloud";
  }): Promise<void> {
    const { tenantId, to, mediaUrl, kind, caption, fileName, mimeType, provider = "evolution" } = options;

    if (!tenantId || !tenantId.trim()) throw new Error("tenantId é obrigatório.");
    if (!to || !to.trim()) throw new Error("to é obrigatório.");
    if (!mediaUrl || !mediaUrl.trim()) throw new Error("mediaUrl não pode ser vazia.");

    const cleanPhone = to.replace(/\D/g, "");
    if (!cleanPhone) throw new Error("Número de telefone de destino inválido.");

    if (provider === "evolution") {
      const instanceName = instanceNameFor(tenantId);

      let base64 = "";
      let resolvedMime = mimeType || (kind === "image" ? "image/png" : kind === "audio" ? "audio/ogg; codecs=opus" : "video/mp4");

      // 1. Tenta ler do armazenamento local se for URL interna /api/typebot-media/
      if (mediaUrl.includes("/api/typebot-media/")) {
        try {
          const relPath = decodeURIComponent(mediaUrl.split("/api/typebot-media/")[1]);
          const localPath = path.join(getTypebotStorageDir(), relPath);
          if (fs.existsSync(localPath)) {
            const buf = fs.readFileSync(localPath);
            base64 = buf.toString("base64");
            resolvedMime = mimeType || detectMimeType(localPath);
            console.log(`[BotDispatcher] Mídia local carregada: ${localPath} (${buf.length} bytes)`);
          }
        } catch (err: any) {
          console.warn(`[BotDispatcher] Falha ao ler mídia do disco local:`, err?.message || err);
        }
      }

      // 2. Se não encontrou localmente e é URL HTTP/HTTPS, tenta baixar como Buffer
      if (!base64 && (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://"))) {
        try {
          const fetchRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(15000) });
          if (fetchRes.ok) {
            const buf = Buffer.from(await fetchRes.arrayBuffer());
            base64 = buf.toString("base64");
            const headerMime = fetchRes.headers.get("content-type");
            if (headerMime) resolvedMime = headerMime.split(";")[0].trim();
            console.log(`[BotDispatcher] Mídia remota baixada: ${mediaUrl} (${buf.length} bytes)`);
          }
        } catch (fetchErr: any) {
          console.warn(`[BotDispatcher] Não foi possível baixar mídia remota ${mediaUrl}:`, fetchErr?.message || fetchErr);
        }
      }

      // 3. Fallback: se tiver base64 passa dataUrl, senão passa a própria URL pública
      const dataUrl = base64 ? `data:${resolvedMime};base64,${base64}` : mediaUrl;
      const defaultExt = kind === "audio" ? "ogg" : kind === "image" ? "png" : "mp4";

      console.log(`[BotDispatcher] Despachando ${kind} para Evolution API conv instance=${instanceName} phone=${cleanPhone}`);
      await evoSendAttachment({
        instanceName,
        number: cleanPhone,
        kind,
        dataUrl,
        mimeType: resolvedMime,
        fileName: fileName || `midia-${Date.now()}.${defaultExt}`,
        caption,
      });
      return;
    }

    throw new Error(`Envio de mídia para o provedor ${provider} não suportado.`);
  }

  /**
   * Envio via Evolution API (Baileys/QR Code).
   */
  private async sendViaEvolution(tenantId: string, phone: string, text: string): Promise<void> {
    const instanceName = instanceNameFor(tenantId);
    try {
      await evoSendText(instanceName, phone, text);
    } catch (error: any) {
      console.error(`[BotDispatcher] Falha ao enviar via Evolution API para tenant=${tenantId}:`, error?.message || error);
      throw error;
    }
  }

  /**
   * Envio via Meta WhatsApp Cloud API (Graph API).
   */
  private async sendViaMetaCloud(tenantId: string, phone: string, text: string): Promise<void> {
    const accounts = await listWaAccounts(tenantId).catch(() => []);
    const activeAccount = accounts.find((acc) => acc.status === "active" && acc.phoneNumberId && acc.accessToken);

    if (!activeAccount) {
      throw new Error(
        `Nenhuma conta Meta Cloud WhatsApp conectada e ativa encontrada para o tenant ${tenantId}.`
      );
    }

    try {
      await sendTextMessage(
        activeAccount.phoneNumberId,
        activeAccount.accessToken,
        phone,
        text
      );
    } catch (error: any) {
      console.error(`[BotDispatcher] Falha ao enviar via Meta Cloud API para tenant=${tenantId}:`, error?.message || error);
      throw error;
    }
  }
}

export const botDispatcher: BotDispatcherService = new BotDispatcherService();
export const botDispatcherService = botDispatcher;
