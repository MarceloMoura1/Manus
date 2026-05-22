/**
 * WhatsApp Routes - Evolution API Integration (FIXED)
 * Endpoints que chamam o Evolution API com correção de case-sensitive
 */

import { Express } from "express";
import axios from "axios";

// Armazenar sessões em memória
const sessions = new Map<string, { 
  connected: boolean; 
  phoneNumber?: string; 
  instanceId?: string;
  instanceName?: string;
  token?: string;
  createdAt: Date;
}>();

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || "http://localhost:8081";
const EVOLUTION_API_KEY = process.env.AUTHENTICATION_API_KEY || "evolution_api_key_123456";

/**
 * Registrar rotas de WhatsApp
 */
export function registerWhatsAppRoutes(app: Express): void {
  /**
   * GET /api/whatsapp/qrcode
   * Obter QR Code do Evolution API para conectar WhatsApp
   */
  app.get("/api/whatsapp/qrcode", async (req, res) => {
    try {
      const { clientId } = req.query;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] GET /api/whatsapp/qrcode - clientId: ${clientId}`);

      // Verificar se já existe sessão conectada
      const session = sessions.get(clientId);
      
      if (session?.connected) {
        return res.json({
          connected: true,
          phoneNumber: session.phoneNumber,
          instanceId: session.instanceId,
        });
      }

      // Criar nome de instância único
      const instanceName = `megadesk-${clientId}-${Date.now()}`;

      try {
        // Criar instância no Evolution API
        console.log(`[WhatsApp Routes] Criando instância: ${instanceName}`);
        
        const createResponse = await axios.post(
          `${EVOLUTION_API_URL}/instance/create`,
          {
            instanceName,
            integration: "WHATSAPP-BAILEYS", // IMPORTANTE: usar 'integration' em minúsculas!
            qrcode: true,
          },
          {
            headers: {
              apikey: EVOLUTION_API_KEY,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );

        console.log(`[WhatsApp Routes] Resposta da criação:`, JSON.stringify(createResponse.data).substring(0, 200));

        // Extrair dados da resposta
        const instanceData = createResponse.data?.instance || createResponse.data;
        const instanceId = instanceData?.instanceId || instanceData?.id;
        const token = instanceData?.token || EVOLUTION_API_KEY;

        if (!instanceId) {
          console.error(`[WhatsApp Routes] Resposta inválida da Evolution:`, createResponse.data);
          return res.status(500).json({
            error: "Erro ao criar instância no Evolution API",
            details: createResponse.data,
          });
        }

        // Obter QR Code
        console.log(`[WhatsApp Routes] Obtendo QR Code para: ${instanceName}`);
        
        let qrBase64: string;
        
        try {
          // Tentar obter QR Code via rota específica (usar instanceName, não instanceId)
          const qrResponse = await axios.get(
            `${EVOLUTION_API_URL}/instance/connect/${instanceName}`,
            {
              headers: {
                apikey: token,
              },
              timeout: 30000,
            }
          );

          // A resposta é JSON com campo qrCode
          const qrData = qrResponse.data?.qrCode;
          if (qrData) {
            qrBase64 = qrData;
          } else {
            throw new Error("QR Code não encontrado na resposta");
          }
        } catch (qrError: any) {
          console.warn(`[WhatsApp Routes] Erro ao obter QR Code via /connect/qr-code/image:`, qrError.message);
          
          // Tentar rota alternativa
          try {
            const altQrResponse = await axios.get(
              `${EVOLUTION_API_URL}/instance/connect/${instanceName}`,
              {
                headers: {
                  apikey: token,
                },
                responseType: "arraybuffer",
                timeout: 30000,
              }
            );
            qrBase64 = Buffer.from(altQrResponse.data).toString("base64");
          } catch (altQrError: any) {
            console.error(`[WhatsApp Routes] Erro ao obter QR Code via rota alternativa:`, altQrError.message);
            return res.status(500).json({
              error: "Erro ao obter QR Code do Evolution API",
              details: altQrError.message,
            });
          }
        }

        // Salvar sessão
        sessions.set(clientId, {
          connected: false,
          instanceId,
          instanceName,
          token,
          createdAt: new Date(),
        });

        console.log(`[WhatsApp Routes] QR Code gerado com sucesso para ${clientId}`);

        return res.json({
          connected: false,
          qrcode: qrBase64,
          instanceId,
          instanceName,
        });
      } catch (evolutionError: any) {
        console.error(`[WhatsApp Routes] Erro ao chamar Evolution API:`, {
          status: evolutionError.response?.status,
          data: evolutionError.response?.data,
          message: evolutionError.message,
        });

        return res.status(500).json({
          error: "Erro ao gerar QR Code do Evolution API",
          details: evolutionError.response?.data?.response?.message || evolutionError.message,
        });
      }
    } catch (err: any) {
      console.error(`[WhatsApp Routes] Erro em GET /api/whatsapp/qrcode:`, err);
      return res.status(500).json({
        error: err?.message || "Erro interno",
      });
    }
  });

  /**
   * GET /api/whatsapp/status
   * Obter status da conexão WhatsApp
   */
  app.get("/api/whatsapp/status", async (req, res) => {
    try {
      const { clientId } = req.query;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] GET /api/whatsapp/status - clientId: ${clientId}`);

      const session = sessions.get(clientId);

      if (session?.instanceId && session?.token) {
        try {
          // Verificar status no Evolution API
          const statusResponse = await axios.get(
            `${EVOLUTION_API_URL}/instance/${session.instanceId}/connectionState`,
            {
              headers: {
                apikey: session.token,
              },
              timeout: 10000,
            }
          );

          const connectionState = statusResponse.data?.instance?.state || statusResponse.data?.state;
          const isConnected = connectionState === "open" || connectionState === "connected";

          if (isConnected) {
            session.connected = true;
          }

          return res.json({
            connected: isConnected,
            phoneNumber: session.phoneNumber || null,
            state: connectionState,
          });
        } catch (err: any) {
          console.warn(`[WhatsApp Routes] Erro ao verificar status no Evolution:`, err.message);
        }
      }

      return res.json({
        connected: session?.connected || false,
        phoneNumber: session?.phoneNumber || null,
      });
    } catch (err: any) {
      console.error(`[WhatsApp Routes] Erro em GET /api/whatsapp/status:`, err);
      return res.status(500).json({
        error: err?.message || "Erro interno",
      });
    }
  });

  /**
   * POST /api/whatsapp/disconnect
   * Desconectar WhatsApp
   */
  app.post("/api/whatsapp/disconnect", async (req, res) => {
    try {
      const { clientId } = req.body;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] POST /api/whatsapp/disconnect - clientId: ${clientId}`);

      const session = sessions.get(clientId);

      if (session?.instanceId && session?.token) {
        try {
          // Desconectar no Evolution API
          await axios.post(
            `${EVOLUTION_API_URL}/instance/${session.instanceId}/connect/logout`,
            {},
            {
              headers: {
                apikey: session.token,
              },
              timeout: 30000,
            }
          );
        } catch (err: any) {
          console.error(`[WhatsApp Routes] Erro ao desconectar no Evolution:`, err.message);
        }
      }

      sessions.delete(clientId);

      return res.json({
        ok: true,
        message: "WhatsApp desconectado com sucesso",
      });
    } catch (err: any) {
      console.error(`[WhatsApp Routes] Erro em POST /api/whatsapp/disconnect:`, err);
      return res.status(500).json({
        error: err?.message || "Erro interno",
      });
    }
  });

  /**
   * POST /api/whatsapp/refresh-qr
   * Gerar novo QR Code
   */
  app.post("/api/whatsapp/refresh-qr", async (req, res) => {
    try {
      const { clientId } = req.body;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] POST /api/whatsapp/refresh-qr - clientId: ${clientId}`);

      // Desconectar sessão anterior
      const oldSession = sessions.get(clientId);
      if (oldSession?.instanceId && oldSession?.token) {
        try {
          await axios.post(
            `${EVOLUTION_API_URL}/instance/${oldSession.instanceId}/connect/logout`,
            {},
            {
              headers: {
                apikey: oldSession.token,
              },
              timeout: 30000,
            }
          );
        } catch (err: any) {
          console.error(`[WhatsApp Routes] Erro ao desconectar instância anterior:`, err.message);
        }
      }

      sessions.delete(clientId);

      // Gerar novo QR Code (reutilizar lógica de criação)
      const instanceName = `megadesk-${clientId}-${Date.now()}`;

      try {
        const createResponse = await axios.post(
          `${EVOLUTION_API_URL}/instance/create`,
          {
            instanceName,
            integration: "WHATSAPP-BAILEYS", // IMPORTANTE: usar 'integration' em minúsculas!
            qrcode: true,
          },
          {
            headers: {
              apikey: EVOLUTION_API_KEY,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );

        const instanceData = createResponse.data?.instance || createResponse.data;
        const instanceId = instanceData?.instanceId || instanceData?.id;
        const token = instanceData?.token || EVOLUTION_API_KEY;

        if (!instanceId) {
          return res.status(500).json({
            error: "Erro ao criar instância no Evolution API",
          });
        }

        let qrBase64: string;
        
        try {
          const qrResponse = await axios.get(
            `${EVOLUTION_API_URL}/instance/${instanceId}/connect/qr-code/image`,
            {
              headers: {
                apikey: token,
              },
              responseType: "arraybuffer",
              timeout: 30000,
            }
          );
          qrBase64 = Buffer.from(qrResponse.data).toString("base64");
        } catch (qrError: any) {
          const altQrResponse = await axios.get(
            `${EVOLUTION_API_URL}/instance/${instanceId}/qrcode`,
            {
              headers: {
                apikey: token,
              },
            }
          );
          const qrData = altQrResponse.data?.qrCode;
          if (qrData) {
            qrBase64 = qrData;
          } else {
            throw new Error("QR Code não encontrado na resposta");
          }
        }

        sessions.set(clientId, {
          connected: false,
          instanceId,
          instanceName,
          token,
          createdAt: new Date(),
        });

        console.log(`[WhatsApp Routes] Novo QR Code gerado para ${clientId}`);

        return res.json({
          connected: false,
          qrcode: qrBase64,
          instanceId,
          instanceName,
        });
      } catch (evolutionError: any) {
        console.error(`[WhatsApp Routes] Erro ao chamar Evolution API:`, evolutionError.message);
        return res.status(500).json({
          error: "Erro ao gerar novo QR Code",
          details: evolutionError.response?.data?.response?.message || evolutionError.message,
        });
      }
    } catch (err: any) {
      console.error(`[WhatsApp Routes] Erro em POST /api/whatsapp/refresh-qr:`, err);
      return res.status(500).json({
        error: err?.message || "Erro interno",
      });
    }
  });
}
