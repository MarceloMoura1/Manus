/**
 * Evolution API Client
 * Integração com Evolution API para envio/recebimento de mensagens WhatsApp
 * 
 * Documentação: https://docs.evoapicloud.com
 */

import axios, { AxiosInstance } from "axios";

export interface EvolutionConfig {
  baseUrl: string; // Ex: http://localhost:8081
  apiKey: string; // API key da Evolution API
  globalApiKey?: string; // API key global (opcional)
}

export interface EvolutionInstance {
  instanceId: string;
  instanceName: string;
  token: string;
  phoneNumber?: string;
  status: "connected" | "disconnected" | "connecting";
  qrcode?: {
    code: string;
    base64: string;
  };
}

export interface SendMessageRequest {
  number: string;
  text: string;
}

export interface SendMessageResponse {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  status: "PENDING" | "SERVER_ACK" | "DELIVERY_ACK" | "READ" | "PLAYED" | "ERROR";
  message: string;
}

export interface QRCodeResponse {
  qrcode: {
    code: string;
    base64: string;
  };
}

export interface InstanceStatusResponse {
  instanceId: string;
  instanceName: string;
  token: string;
  phoneNumber?: string;
  status: "connected" | "disconnected" | "connecting";
  connectionStatus?: string;
}

export class EvolutionAPIClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private globalApiKey: string;

  constructor(config: EvolutionConfig) {
    this.baseUrl = config.baseUrl;
    this.globalApiKey = config.globalApiKey || config.apiKey;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        "Content-Type": "application/json",
        apikey: this.globalApiKey,
      },
      timeout: 30000,
    });

    // Adicionar interceptor de erro
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          console.error(`[Evolution] Erro HTTP ${error.response.status}:`, error.response.data);
        } else if (error.request) {
          console.error(`[Evolution] Sem resposta do servidor:`, error.message);
        } else {
          console.error(`[Evolution] Erro na requisição:`, error.message);
        }
        throw error;
      }
    );
  }

  /**
   * Criar uma nova instância de WhatsApp
   */
  async createInstance(instanceName: string): Promise<EvolutionInstance> {
    try {
      console.log(`[Evolution] Criando instância: ${instanceName}`);
      const response = await this.client.post("/instances", {
        instanceName,
      });
      console.log(`[Evolution] Instância criada: ${response.data.instanceId}`);
      return response.data;
    } catch (err: any) {
      console.error(`[Evolution] Erro ao criar instância: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Obter detalhes de uma instância
   */
  async getInstance(instanceId: string): Promise<EvolutionInstance> {
    try {
      const response = await this.client.get(`/instances/${instanceId}`);
      return response.data;
    } catch (err: any) {
      console.error(`[Evolution] Erro ao obter instância: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Listar todas as instâncias
   */
  async listInstances(): Promise<EvolutionInstance[]> {
    try {
      const response = await this.client.get("/instances");
      return Array.isArray(response.data) ? response.data : response.data.instances || [];
    } catch (err: any) {
      console.error(`[Evolution] Erro ao listar instâncias: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Obter QR Code para conectar WhatsApp
   */
  async getQRCode(instanceId: string, token: string): Promise<QRCodeResponse> {
    try {
      console.log(`[Evolution] Obtendo QR Code para ${instanceId}`);
      const response = await this.client.get(
        `/instances/${instanceId}/connect/qr-code`,
        {
          headers: {
            apikey: token,
          },
        }
      );
      return response.data;
    } catch (err: any) {
      console.error(`[Evolution] Erro ao obter QR Code: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Obter imagem do QR Code
   */
  async getQRCodeImage(instanceId: string, token: string): Promise<string> {
    try {
      const response = await this.client.get(
        `/instances/${instanceId}/connect/qr-code/image`,
        {
          headers: {
            apikey: token,
          },
          responseType: "arraybuffer",
        }
      );
      return Buffer.from(response.data).toString("base64");
    } catch (err: any) {
      console.error(`[Evolution] Erro ao obter imagem QR: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Desconectar WhatsApp
   */
  async disconnect(instanceId: string, token: string): Promise<void> {
    try {
      console.log(`[Evolution] Desconectando ${instanceId}`);
      await this.client.post(
        `/instances/${instanceId}/connect/logout`,
        {},
        {
          headers: {
            apikey: token,
          },
        }
      );
      console.log(`[Evolution] Desconectado com sucesso`);
    } catch (err: any) {
      console.error(`[Evolution] Erro ao desconectar: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Enviar mensagem de texto
   */
  async sendMessage(
    instanceId: string,
    token: string,
    request: SendMessageRequest
  ): Promise<SendMessageResponse> {
    try {
      console.log(
        `[Evolution] Enviando mensagem para ${request.number}: "${request.text.substring(0, 50)}..."`
      );

      const response = await this.client.post(
        `/instances/${instanceId}/send/text`,
        request,
        {
          headers: {
            apikey: token,
          },
        }
      );

      console.log(
        `[Evolution] Mensagem enviada: ${response.data?.key?.id} (status: ${response.data?.status})`
      );
      return response.data;
    } catch (err: any) {
      console.error(`[Evolution] Erro ao enviar mensagem: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Enviar mídia (imagem, vídeo, documento)
   */
  async sendMedia(
    instanceId: string,
    token: string,
    number: string,
    mediaUrl: string,
    mediaType: "image" | "video" | "document" | "audio",
    caption?: string
  ): Promise<SendMessageResponse> {
    try {
      console.log(`[Evolution] Enviando ${mediaType} para ${number}`);
      const response = await this.client.post(
        `/instances/${instanceId}/send/media`,
        {
          number,
          mediaUrl,
          mediaType,
          caption,
        },
        {
          headers: {
            apikey: token,
          },
        }
      );
      return response.data;
    } catch (err: any) {
      console.error(`[Evolution] Erro ao enviar mídia: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Listar conversas
   */
  async listChats(instanceId: string, token: string): Promise<any[]> {
    try {
      const response = await this.client.get(`/instances/${instanceId}/chats`, {
        headers: {
          apikey: token,
        },
      });
      return Array.isArray(response.data) ? response.data : response.data.chats || [];
    } catch (err: any) {
      console.error(`[Evolution] Erro ao listar conversas: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Listar mensagens de uma conversa
   */
  async listMessages(
    instanceId: string,
    token: string,
    chatId: string
  ): Promise<any[]> {
    try {
      const response = await this.client.get(
        `/instances/${instanceId}/messages/${chatId}`,
        {
          headers: {
            apikey: token,
          },
        }
      );
      return Array.isArray(response.data) ? response.data : response.data.messages || [];
    } catch (err: any) {
      console.error(`[Evolution] Erro ao listar mensagens: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Listar contatos
   */
  async listContacts(instanceId: string, token: string): Promise<any[]> {
    try {
      const response = await this.client.get(
        `/instances/${instanceId}/contacts`,
        {
          headers: {
            apikey: token,
          },
        }
      );
      return Array.isArray(response.data) ? response.data : response.data.contacts || [];
    } catch (err: any) {
      console.error(`[Evolution] Erro ao listar contatos: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Validar se número tem WhatsApp ativo
   */
  async checkNumberStatus(
    instanceId: string,
    token: string,
    number: string
  ): Promise<boolean> {
    try {
      const response = await this.client.post(
        `/instances/${instanceId}/check-number`,
        { number },
        {
          headers: {
            apikey: token,
          },
        }
      );
      return response.data?.exists === true;
    } catch (err: any) {
      console.error(`[Evolution] Erro ao verificar número: ${err?.message}`);
      return false;
    }
  }

  /**
   * Obter status da instância
   */
  async getInstanceStatus(instanceId: string, token: string): Promise<InstanceStatusResponse> {
    try {
      const response = await this.client.get(
        `/instances/${instanceId}/status`,
        {
          headers: {
            apikey: token,
          },
        }
      );
      return response.data;
    } catch (err: any) {
      console.error(`[Evolution] Erro ao obter status: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Deletar instância
   */
  async deleteInstance(instanceId: string): Promise<void> {
    try {
      console.log(`[Evolution] Deletando instância ${instanceId}`);
      await this.client.delete(`/instances/${instanceId}`);
      console.log(`[Evolution] Instância deletada com sucesso`);
    } catch (err: any) {
      console.error(`[Evolution] Erro ao deletar instância: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Configurar webhook para receber mensagens
   */
  async setWebhook(
    instanceId: string,
    token: string,
    webhookUrl: string,
    events: string[] = ["messages", "status"]
  ): Promise<void> {
    try {
      console.log(`[Evolution] Configurando webhook: ${webhookUrl}`);
      await this.client.post(
        `/instances/${instanceId}/webhook`,
        {
          url: webhookUrl,
          events,
        },
        {
          headers: {
            apikey: token,
          },
        }
      );
      console.log(`[Evolution] Webhook configurado com sucesso`);
    } catch (err: any) {
      console.error(`[Evolution] Erro ao configurar webhook: ${err?.message}`);
      throw err;
    }
  }
}

// Singleton instance
let evolutionClient: EvolutionAPIClient | null = null;

export function initEvolutionAPI(config: EvolutionConfig): EvolutionAPIClient {
  console.log(`[Evolution] Inicializando cliente: ${config.baseUrl}`);
  evolutionClient = new EvolutionAPIClient(config);
  return evolutionClient;
}

export function getEvolutionAPI(): EvolutionAPIClient {
  if (!evolutionClient) {
    throw new Error("Evolution API não foi inicializado");
  }
  return evolutionClient;
}
