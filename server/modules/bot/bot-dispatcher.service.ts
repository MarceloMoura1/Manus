/**
 * Bot Module — Universal Bot Dispatcher Service
 * Interface e implementação unificadas para envio de mensagens via WhatsApp
 * suportando os provedores Evolution API e Meta Cloud API.
 */
import { evoSendText } from "../../evolution/client";
import { instanceNameFor } from "../../evolution/session-store";
import { sendTextMessage } from "../whatsapp/meta/graph-api";
import { listWaAccounts } from "../whatsapp/repositories/whatsapp.repo";

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

