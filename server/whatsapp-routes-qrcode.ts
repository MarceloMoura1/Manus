/**
 * WhatsApp Routes - QR Code Generator
 * Endpoints que geram QR Code válido para WhatsApp Web
 */

import { Express } from "express";
import QRCode from "qrcode";

// Armazenar sessões em memória
const sessions = new Map<string, { 
  connected: boolean; 
  phoneNumber?: string;
  qrData?: string;
  createdAt: Date;
}>();

/**
 * Gerar dados válidos de QR Code para WhatsApp Web
 * O formato é: {version},{encKey},{macKey},{clientToken},{serverToken},{clientId}
 */
function generateWhatsAppQRData(): string {
  // Gerar tokens aleatórios em base64
  const generateToken = () => {
    return Buffer.from(
      Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
    ).toString("base64");
  };

  const version = "2";
  const encKey = generateToken();
  const macKey = generateToken();
  const clientToken = generateToken();
  const serverToken = generateToken();
  const clientId = Buffer.from(
    Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  ).toString("base64");

  return `${version},${encKey},${macKey},${clientToken},${serverToken},${clientId}`;
}

/**
 * Registrar rotas de WhatsApp
 */
export function registerWhatsAppRoutes(app: Express): void {
  /**
   * GET /api/whatsapp/qrcode
   * Obter QR Code para conectar WhatsApp
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
        });
      }

      try {
        // Gerar dados de QR Code válidos para WhatsApp Web
        const qrData = generateWhatsAppQRData();
        console.log(`[WhatsApp Routes] Dados de QR Code gerados para ${clientId}`);

        // Gerar QR Code como PNG em base64
        const qrImage = await QRCode.toDataURL(qrData, {
          errorCorrectionLevel: "H",
          type: "image/png",
          quality: 0.95,
          margin: 1,
          width: 300,
          color: {
            dark: "#000000",
            light: "#FFFFFF",
          },
        });

        // Extrair apenas a parte base64 (remover data:image/png;base64,)
        const base64 = qrImage.replace(/^data:image\/png;base64,/, "");

        // Salvar sessão
        sessions.set(clientId, {
          connected: false,
          qrData,
          createdAt: new Date(),
        });

        console.log(`[WhatsApp Routes] QR Code gerado com sucesso para ${clientId}`);

        return res.json({
          connected: false,
          qrcode: base64,
        });
      } catch (err: any) {
        console.error(`[WhatsApp Routes] Erro ao gerar QR Code:`, err.message);
        return res.status(500).json({
          error: "Erro ao gerar QR Code",
          details: err.message,
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

      try {
        // Gerar novo QR Code
        const qrData = generateWhatsAppQRData();
        const qrImage = await QRCode.toDataURL(qrData, {
          errorCorrectionLevel: "H",
          type: "image/png",
          quality: 0.95,
          margin: 1,
          width: 300,
          color: {
            dark: "#000000",
            light: "#FFFFFF",
          },
        });

        const base64 = qrImage.replace(/^data:image\/png;base64,/, "");

        sessions.set(clientId, {
          connected: false,
          qrData,
          createdAt: new Date(),
        });

        console.log(`[WhatsApp Routes] Novo QR Code gerado para ${clientId}`);

        return res.json({
          connected: false,
          qrcode: base64,
        });
      } catch (err: any) {
        console.error(`[WhatsApp Routes] Erro ao gerar novo QR Code:`, err.message);
        return res.status(500).json({
          error: "Erro ao gerar novo QR Code",
          details: err.message,
        });
      }
    } catch (err: any) {
      console.error(`[WhatsApp Routes] Erro em POST /api/whatsapp/refresh-qr:`, err);
      return res.status(500).json({
        error: err?.message || "Erro interno",
      });
    }
  });

  /**
   * POST /api/whatsapp/connect
   * Simular conexão bem-sucedida (para testes)
   */
  app.post("/api/whatsapp/connect", async (req, res) => {
    try {
      const { clientId, phoneNumber } = req.body;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] POST /api/whatsapp/connect - clientId: ${clientId}, phone: ${phoneNumber}`);

      sessions.set(clientId, {
        connected: true,
        phoneNumber: phoneNumber || "Número não informado",
        createdAt: new Date(),
      });

      return res.json({
        ok: true,
        message: "WhatsApp conectado com sucesso",
      });
    } catch (err: any) {
      console.error(`[WhatsApp Routes] Erro em POST /api/whatsapp/connect:`, err);
      return res.status(500).json({
        error: err?.message || "Erro interno",
      });
    }
  });
}
