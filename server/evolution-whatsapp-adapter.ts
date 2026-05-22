/**
 * Evolution WhatsApp Adapter
 * Wrapper que implementa a mesma interface do Baileys usando Evolution API
 * Permite migração com mínimas mudanças no código existente
 */

import { EvolutionAPIClient, EvolutionInstance, SendMessageResponse } from "./evolution-api-client";

export interface EvolutionSessionInfo {
  clientId: string;
  instanceId: string;
  token: string;
  phoneNumber?: string;
  status: "connected" | "disconnected" | "connecting";
  evolutionClient: EvolutionAPIClient;
  createdAt: Date;
  lastActivity?: Date;
}

export class EvolutionWhatsAppAdapter {
  private sessions: Map<string, EvolutionSessionInfo> = new Map();
  private evolutionClient: EvolutionAPIClient;

  constructor(evolutionClient: EvolutionAPIClient) {
    this.evolutionClient = evolutionClient;
  }

  /**
   * Criar nova sessão WhatsApp
   */
  async createSession(clientId: string, instanceName: string): Promise<EvolutionSessionInfo> {
    try {
      console.log(`[Evolution Adapter] Criando sessão para ${clientId}...`);

      // Verificar se já existe sessão
      const existing = this.sessions.get(clientId);
      if (existing?.status === "connected") {
        console.log(`[Evolution Adapter] Sessão já conectada para ${clientId}`);
        return existing;
      }

      // Criar instância na Evolution API
      const instance = await this.evolutionClient.createInstance(instanceName);

      const session: EvolutionSessionInfo = {
        clientId,
        instanceId: instance.instanceId,
        token: instance.token,
        phoneNumber: instance.phoneNumber,
        status: "disconnected",
        evolutionClient: this.evolutionClient,
        createdAt: new Date(),
      };

      this.sessions.set(clientId, session);

      console.log(`[Evolution Adapter] Sessão criada: ${instance.instanceId}`);
      return session;
    } catch (err: any) {
      console.error(`[Evolution Adapter] Erro ao criar sessão: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Obter sessão existente
   */
  getSession(clientId: string): EvolutionSessionInfo | undefined {
    return this.sessions.get(clientId);
  }

  /**
   * Restaurar sessão do banco de dados
   */
  async restoreSession(
    clientId: string,
    instanceId: string,
    token: string
  ): Promise<EvolutionSessionInfo> {
    try {
      console.log(`[Evolution Adapter] Restaurando sessão ${instanceId}...`);

      // Obter status da instância
      const instance = await this.evolutionClient.getInstance(instanceId);

      const session: EvolutionSessionInfo = {
        clientId,
        instanceId: instance.instanceId,
        token: token,
        phoneNumber: instance.phoneNumber,
        status: instance.status as "connected" | "disconnected" | "connecting",
        evolutionClient: this.evolutionClient,
        createdAt: new Date(),
      };

      this.sessions.set(clientId, session);

      console.log(
        `[Evolution Adapter] Sessão restaurada: ${instanceId} (status: ${instance.status})`
      );
      return session;
    } catch (err: any) {
      console.error(`[Evolution Adapter] Erro ao restaurar sessão: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Obter QR Code para conectar
   */
  async getQRCode(clientId: string): Promise<string> {
    const session = this.getSession(clientId);
    if (!session) throw new Error(`Sessão não encontrada para ${clientId}`);

    try {
      console.log(`[Evolution Adapter] Obtendo QR Code para ${session.instanceId}...`);
      const qrCode = await this.evolutionClient.getQRCode(
        session.instanceId,
        session.token
      );
      return qrCode.qrcode.code;
    } catch (err: any) {
      console.error(`[Evolution Adapter] Erro ao obter QR Code: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Obter imagem do QR Code em base64
   */
  async getQRCodeImage(clientId: string): Promise<string> {
    const session = this.getSession(clientId);
    if (!session) throw new Error(`Sessão não encontrada para ${clientId}`);

    try {
      console.log(`[Evolution Adapter] Obtendo imagem QR Code para ${session.instanceId}...`);
      return await this.evolutionClient.getQRCodeImage(
        session.instanceId,
        session.token
      );
    } catch (err: any) {
      console.error(`[Evolution Adapter] Erro ao obter imagem QR: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Enviar mensagem com validações
   */
  async sendMessage(
    clientId: string,
    number: string,
    text: string
  ): Promise<{ ok: boolean; messageId?: string; error?: string; status?: string }> {
    const session = this.getSession(clientId);
    if (!session) {
      return { ok: false, error: "Sessão não encontrada" };
    }

    if (session.status !== "connected") {
      return { ok: false, error: `Sessão não conectada: ${session.status}` };
    }

    try {
      console.log(
        `[Evolution Adapter] Enviando mensagem para ${number}: "${text.substring(0, 50)}..."`
      );

      // Formatar número para WhatsApp
      const formattedNumber = this.formatPhoneNumber(number);

      // Validar se número tem WhatsApp ativo
      const hasWhatsApp = await this.evolutionClient.checkNumberStatus(
        session.instanceId,
        session.token,
        formattedNumber
      );

      if (!hasWhatsApp) {
        console.warn(`[Evolution Adapter] Número ${formattedNumber} não tem WhatsApp ativo`);
        return { ok: false, error: "Número não possui WhatsApp ativo" };
      }

      // Enviar mensagem
      const response = await this.evolutionClient.sendMessage(
        session.instanceId,
        session.token,
        {
          number: formattedNumber,
          text,
        }
      );

      session.lastActivity = new Date();

      // Verificar status de envio
      if (response.status === "ERROR") {
        return {
          ok: false,
          error: "Erro ao enviar mensagem",
          status: response.status,
        };
      }

      return {
        ok: true,
        messageId: response.key.id,
        status: response.status,
      };
    } catch (err: any) {
      console.error(`[Evolution Adapter] Erro ao enviar mensagem: ${err?.message}`);
      return {
        ok: false,
        error: err?.message || "Erro ao enviar mensagem",
      };
    }
  }

  /**
   * Enviar mídia
   */
  async sendMedia(
    clientId: string,
    number: string,
    mediaUrl: string,
    mediaType: "image" | "video" | "document" | "audio",
    caption?: string
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const session = this.getSession(clientId);
    if (!session) {
      return { ok: false, error: "Sessão não encontrada" };
    }

    if (session.status !== "connected") {
      return { ok: false, error: `Sessão não conectada: ${session.status}` };
    }

    try {
      const formattedNumber = this.formatPhoneNumber(number);

      const response = await this.evolutionClient.sendMedia(
        session.instanceId,
        session.token,
        formattedNumber,
        mediaUrl,
        mediaType,
        caption
      );

      session.lastActivity = new Date();

      return {
        ok: true,
        messageId: response.key.id,
      };
    } catch (err: any) {
      console.error(`[Evolution Adapter] Erro ao enviar mídia: ${err?.message}`);
      return {
        ok: false,
        error: err?.message || "Erro ao enviar mídia",
      };
    }
  }

  /**
   * Desconectar
   */
  async disconnect(clientId: string): Promise<void> {
    const session = this.getSession(clientId);
    if (!session) throw new Error(`Sessão não encontrada para ${clientId}`);

    try {
      console.log(`[Evolution Adapter] Desconectando ${session.instanceId}...`);
      await this.evolutionClient.disconnect(session.instanceId, session.token);
      this.sessions.delete(clientId);
      console.log(`[Evolution Adapter] Desconectado com sucesso`);
    } catch (err: any) {
      console.error(`[Evolution Adapter] Erro ao desconectar: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Obter status
   */
  getStatus(clientId: string): {
    status: string;
    phoneNumber?: string;
    instanceId?: string;
    connected: boolean;
  } {
    const session = this.getSession(clientId);
    if (!session) {
      return { status: "not_found", connected: false };
    }

    return {
      status: session.status,
      phoneNumber: session.phoneNumber,
      instanceId: session.instanceId,
      connected: session.status === "connected",
    };
  }

  /**
   * Listar conversas
   */
  async listChats(clientId: string): Promise<any[]> {
    const session = this.getSession(clientId);
    if (!session) throw new Error(`Sessão não encontrada para ${clientId}`);

    try {
      return await this.evolutionClient.listChats(session.instanceId, session.token);
    } catch (err: any) {
      console.error(`[Evolution Adapter] Erro ao listar conversas: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Listar contatos
   */
  async listContacts(clientId: string): Promise<any[]> {
    const session = this.getSession(clientId);
    if (!session) throw new Error(`Sessão não encontrada para ${clientId}`);

    try {
      return await this.evolutionClient.listContacts(session.instanceId, session.token);
    } catch (err: any) {
      console.error(`[Evolution Adapter] Erro ao listar contatos: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Formatar número para WhatsApp
   */
  private formatPhoneNumber(phone: string): string {
    // Remover caracteres especiais
    let cleanPhone = phone.replace(/\D/g, "");

    // Se tem 11 dígitos e não começa com 55, adicionar código do Brasil
    if (cleanPhone.length === 11 && !cleanPhone.startsWith("55")) {
      cleanPhone = "55" + cleanPhone;
    }

    // Se tem 10 dígitos (sem código de país), adicionar 55
    if (cleanPhone.length === 10 && !cleanPhone.startsWith("55")) {
      cleanPhone = "55" + cleanPhone;
    }

    return cleanPhone;
  }

  /**
   * Listar todas as sessões
   */
  listSessions(): Map<string, EvolutionSessionInfo> {
    return this.sessions;
  }

  /**
   * Limpar sessão
   */
  removeSession(clientId: string): void {
    this.sessions.delete(clientId);
  }

  /**
   * Atualizar status da sessão
   */
  updateSessionStatus(clientId: string, status: "connected" | "disconnected" | "connecting"): void {
    const session = this.getSession(clientId);
    if (session) {
      session.status = status;
      session.lastActivity = new Date();
    }
  }

  /**
   * Atualizar número de telefone da sessão
   */
  updateSessionPhoneNumber(clientId: string, phoneNumber: string): void {
    const session = this.getSession(clientId);
    if (session) {
      session.phoneNumber = phoneNumber;
      session.lastActivity = new Date();
    }
  }
}
