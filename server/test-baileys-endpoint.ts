/**
 * Endpoint de teste isolado para validar envio de mensagens via Baileys
 * POST /api/test-baileys-send
 * Body: { clientId: string, phoneNumber: string, message: string }
 */

import { Router } from "express";
import { sendBaileysMessage } from "./whatsapp-baileys";

const router = Router();

router.post("/test-baileys-send", async (req, res) => {
  const { clientId, phoneNumber, message } = req.body;
  
  console.log(`\n${"=".repeat(80)}`);
  console.log(`[TEST] INICIANDO TESTE DE ENVIO`);
  console.log(`${"=".repeat(80)}`);
  console.log(`[TEST] clientId: ${clientId}`);
  console.log(`[TEST] phoneNumber: ${phoneNumber}`);
  console.log(`[TEST] message: ${message}`);
  console.log(`${"=".repeat(80)}\n`);
  
  if (!clientId || !phoneNumber || !message) {
    return res.status(400).json({
      ok: false,
      error: "Parâmetros obrigatórios: clientId, phoneNumber, message",
    });
  }
  
  try {
    // Usar conversationId fictício para teste
    const testConversationId = `test-${Date.now()}`;
    
    console.log(`[TEST] Chamando sendBaileysMessage...`);
    const result = await sendBaileysMessage(
      clientId,
      testConversationId,
      phoneNumber,
      message,
      "TEST_AGENT"
    );
    
    console.log(`[TEST] Resultado:`, result);
    console.log(`${"=".repeat(80)}\n`);
    
    return res.json({
      ok: result.ok,
      error: result.error,
      timestamp: new Date().toISOString(),
      test: {
        clientId,
        phoneNumber,
        message,
      },
    });
  } catch (err: any) {
    console.error(`[TEST] ERRO:`, err);
    console.log(`${"=".repeat(80)}\n`);
    
    return res.status(500).json({
      ok: false,
      error: err?.message || "Erro desconhecido",
      stack: err?.stack?.substring(0, 1000),
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
