/**
 * WhatsApp Routes
 * Endpoints internos para gerenciar Evolution API
 * Frontend nunca acessa Evolution diretamente
 */

import { Express } from "express";
import {
  createWhatsAppSession,
  getWhatsAppQRCode,
  getWhatsAppQRCodeImage,
  getWhatsAppStatus,
  disconnectWhatsApp,
} from "./evolution-manager";

/**
 * Registrar rotas de WhatsApp
 */
export function registerWhatsAppRoutes(app: Express): void {
  /**
   * GET /api/whatsapp/qrcode
   * Obter QR Code para conectar WhatsApp
   * 
   * Query params:
   * - clientId: ID do cliente
   */
  app.get("/api/whatsapp/qrcode", async (req, res) => {
    try {
      const { clientId } = req.query;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] GET /api/whatsapp/qrcode - clientId: ${clientId}`);

      // Verificar se já existe sessão ativa
      const status = getWhatsAppStatus(clientId);
      
      if (status.connected) {
        return res.json({
          connected: true,
          phoneNumber: status.phoneNumber,
          instanceId: status.instanceId,
        });
      }

      // Criar nova sessão se não existir
      const sessionResult = await createWhatsAppSession(clientId);
      
      if (!sessionResult.ok) {
        return res.status(500).json({
          connected: false,
          error: sessionResult.error || "Erro ao criar sessão",
        });
      }

      // Obter QR Code em base64
      const qrResult = await getWhatsAppQRCodeImage(clientId);

      if (!qrResult.ok) {
        return res.status(500).json({
          connected: false,
          error: qrResult.error || "Erro ao obter QR Code",
        });
      }

      return res.json({
        connected: false,
        qrcode: qrResult.image, // base64 da imagem
        instanceId: sessionResult.instanceId,
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
   * 
   * Query params:
   * - clientId: ID do cliente
   */
  app.get("/api/whatsapp/status", async (req, res) => {
    try {
      const { clientId } = req.query;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] GET /api/whatsapp/status - clientId: ${clientId}`);

      const status = getWhatsAppStatus(clientId);

      return res.json({
        connected: status.connected,
        phoneNumber: status.phoneNumber || null,
        instanceId: status.instanceId || null,
        status: status.status,
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
   * 
   * Body:
   * - clientId: ID do cliente
   */
  app.post("/api/whatsapp/disconnect", async (req, res) => {
    try {
      const { clientId } = req.body;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] POST /api/whatsapp/disconnect - clientId: ${clientId}`);

      const result = await disconnectWhatsApp(clientId);

      if (!result.ok) {
        return res.status(500).json({
          error: result.error || "Erro ao desconectar",
        });
      }

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
   * 
   * Body:
   * - clientId: ID do cliente
   */
  app.post("/api/whatsapp/refresh-qr", async (req, res) => {
    try {
      const { clientId } = req.body;

      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId é obrigatório" });
      }

      console.log(`[WhatsApp Routes] POST /api/whatsapp/refresh-qr - clientId: ${clientId}`);

      // Desconectar sessão anterior
      await disconnectWhatsApp(clientId);

      // Criar nova sessão
      const sessionResult = await createWhatsAppSession(clientId);

      if (!sessionResult.ok) {
        return res.status(500).json({
          error: sessionResult.error || "Erro ao criar sessão",
        });
      }

      // Obter novo QR Code
      const qrResult = await getWhatsAppQRCodeImage(clientId);

      if (!qrResult.ok) {
        return res.status(500).json({
          error: qrResult.error || "Erro ao obter QR Code",
        });
      }

      return res.json({
        connected: false,
        qrcode: qrResult.image, // base64 da imagem
        instanceId: sessionResult.instanceId,
      });
    } catch (err: any) {
      console.error(`[WhatsApp Routes] Erro em POST /api/whatsapp/refresh-qr:`, err);
      return res.status(500).json({
        error: err?.message || "Erro interno",
      });
    }
  });
}
