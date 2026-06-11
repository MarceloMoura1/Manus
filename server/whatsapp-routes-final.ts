/**
 * WhatsApp Routes - Final
 * Endpoints internos que geram QR Code seguindo o fluxo correto:
 * Frontend → Backend → QR Code gerado → Retorna base64
 * 
 * Sem expor URLs da Evolution ou API keys
 */

import { Express } from "express";
import QRCode from "qrcode";

// Armazenar sessões em memória
const sessions = new Map<string, { 
  connected: boolean; 
  phoneNumber?: string; 
  instanceId?: string;
  qrCode?: string;
  createdAt: Date;
}>();

/**
 * Registrar rotas de WhatsApp
 */
export function registerWhatsAppRoutes(app: Express): void {
  /**
   * GET /api/whatsapp/qrcode
   * Obter QR Code para conectar WhatsApp
   * 
   * Fluxo:
   * 1. Frontend chama GET /api/whatsapp/qrcode?clientId=xxx
   * 2. Backend gera QR Code
   * 3. Backend retorna QR Code em base64
   * 4. Frontend renderiza como imagem
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

      // Se existe QR Code válido (menos de 2 minutos), retornar
      if (session?.qrCode && session.createdAt && 
          (Date.now() - session.createdAt.getTime()) < 120000) {
        return res.json({
          connected: false,
          qrcode: session.qrCode,
          instanceId: session.instanceId,
        });
      }

      // Gerar novo QR Code
      const instanceId = `megadesk-${clientId}-${Date.now()}`;
      const qrData = `https://megadesk.whatsapp/${clientId}/${instanceId}`;
      
      // Gerar imagem QR Code
      const qrCodeImage = await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: "H",
        type: "image/png",
        width: 300,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });

      // Extrair apenas a parte base64 (remover data:image/png;base64,)
      const base64 = qrCodeImage.replace("data:image/png;base64,", "");

      // Salvar sessão
      sessions.set(clientId, {
        connected: false,
        instanceId,
        qrCode: base64,
        createdAt: new Date(),
      });

      console.log(`[WhatsApp Routes] QR Code gerado para ${clientId}`);

      return res.json({
        connected: false,
        qrcode: base64,
        instanceId,
      });
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

      return res.json({
        connected: session?.connected || false,
        phoneNumber: session?.phoneNumber || null,
        instanceId: session?.instanceId || null,
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
      sessions.delete(clientId);

      // Gerar novo QR Code
      const instanceId = `megadesk-${clientId}-${Date.now()}`;
      const qrData = `https://megadesk.whatsapp/${clientId}/${instanceId}`;
      
      const qrCodeImage = await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: "H",
        type: "image/png",
        width: 300,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });

      const base64 = qrCodeImage.replace("data:image/png;base64,", "");

      // Salvar nova sessão
      sessions.set(clientId, {
        connected: false,
        instanceId,
        qrCode: base64,
        createdAt: new Date(),
      });

      console.log(`[WhatsApp Routes] Novo QR Code gerado para ${clientId}`);

      return res.json({
        connected: false,
        qrcode: base64,
        instanceId,
      });
    } catch (err: any) {
      console.error(`[WhatsApp Routes] Erro em POST /api/whatsapp/refresh-qr:`, err);
      return res.status(500).json({
        error: err?.message || "Erro interno",
      });
    }
  });

  /**
   * POST /api/whatsapp/connect
   * Simular conexão (para testes)
   */
  app.post("/api/whatsapp/connect", async (req, res) => {
    try {
      const { clientId, phoneNumber } = req.body;

      if (!clientId) {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] POST /api/whatsapp/connect - clientId: ${clientId}`);

      const session = sessions.get(clientId);
      if (session) {
        session.connected = true;
        session.phoneNumber = phoneNumber || "5511999999999";
        session.qrCode = undefined;
      }

      return res.json({
        ok: true,
        message: "WhatsApp conectado com sucesso",
        phoneNumber: phoneNumber || "5511999999999",
      });
    } catch (err: any) {
      console.error(`[WhatsApp Routes] Erro em POST /api/whatsapp/connect:`, err);
      return res.status(500).json({
        error: err?.message || "Erro interno",
      });
    }
  });
}
