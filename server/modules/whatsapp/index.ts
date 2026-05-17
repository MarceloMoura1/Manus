/**
 * WhatsApp Module — Entry Point
 * Exporta o router tRPC e a função de inicialização do Socket.IO.
 * Importar este arquivo no servidor principal para ativar o módulo.
 */
export { whatsappRouter } from "./whatsapp.router";
export { initWhatsAppSocket } from "./socket/whatsapp.socket";
export { handleWebhookVerify, handleWebhookEvent } from "./webhooks/webhook.handler";
