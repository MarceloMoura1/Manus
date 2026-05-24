/**
 * Evolution API Module — ponto de entrada
 *
 * Exports:
 *   evolutionRouter   → tRPC router (registrado em server/routers.ts)
 *   handleEvolutionWebhook → Express handler (registrado em server/_core/index.ts)
 *   evoSendText       → envio direto de mensagem (usado por outros módulos)
 *   getSession        → consulta sessão ativa (usado por outros módulos)
 *   ensureSessionTable → chama no boot para criar a tabela se não existir
 */

export { evolutionRouter }          from "./router";
export { handleEvolutionWebhook }   from "./webhook";
export { evoSendText }              from "./client";
export { getSession, ensureSessionTable } from "./session-store";
