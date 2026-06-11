/**
 * WhatsApp Routes - Versão Simplificada
 * Endpoints internos para gerenciar WhatsApp via Evolution API
 * Com fallback para QR Code de teste
 */

import { Express } from "express";
import QRCode from "qrcode";

// Armazenar sessões em memória
const sessions = new Map<string, { connected: boolean; phoneNumber?: string; instanceId?: string }>();

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
          instanceId: session.instanceId,
        });
      }

      // Gerar QR Code de teste
      const qrCodeData = `https://megadesk.whatsapp/${clientId}/${Date.now()}`;
      const qrCodeImage = await QRCode.toDataURL(qrCodeData);

      // Extrair apenas a parte base64
      const base64 = qrCodeImage.replace("data:image/png;base64,", "");

      // Criar nova sessão
      const instanceId = `megadesk-${clientId}-${Date.now()}`;
      sessions.set(clientId, {
        connected: false,
        instanceId,
      });

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
      const qrCodeData = `https://megadesk.whatsapp/${clientId}/${Date.now()}`;
      const qrCodeImage = await QRCode.toDataURL(qrCodeData);

      // Extrair apenas a parte base64
      const base64 = qrCodeImage.replace("data:image/png;base64,", "");

      // Criar nova sessão
      const instanceId = `megadesk-${clientId}-${Date.now()}`;
      sessions.set(clientId, {
        connected: false,
        instanceId,
      });

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
