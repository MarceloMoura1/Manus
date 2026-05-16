export const AXIOS_TIMEOUT_MS = 10000;
export const COOKIE_NAME = "manus_session";
export const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export const UNAUTHED_ERR_MSG = "Faça login para continuar.";
export const NOT_ADMIN_ERR_MSG = "Acesso restrito a administradores.";

// ─── Mapeamento de Módulos: MegaAdmin (underscore) ↔ Backend/MegaDesk (hífen) ────────
// MegaAdmin usa underscore, Backend e MegaDesk usam hífen
// Este mapeamento garante sincronização correta entre os sistemas
export const MODULE_NAME_MAP = {
  // MegaAdmin → Backend/MegaDesk
  "atendimento_ativo": "active-attendance",
  "conversas": "conversations",
  "chamados": "tickets",
  "rastreio": "tracking",
  "erp": "erp",
  "configurar_bot": "bot-config",
  "assistente_ia": "ai-assistant",
} as const;

// Mapeamento reverso: Backend/MegaDesk → MegaAdmin
export const MODULE_NAME_MAP_REVERSE = Object.fromEntries(
  Object.entries(MODULE_NAME_MAP).map(([k, v]) => [v, k])
) as Record<string, string>;

// Labels dos módulos (mesmo em ambos os sistemas)
export const MODULE_LABELS = {
  "atendimento_ativo": "Atendimento Ativo",
  "conversas": "Conversas",
  "chamados": "Chamados",
  "rastreio": "Rastreio",
  "erp": "ERP",
  "configurar_bot": "Configurar Bot",
  "assistente_ia": "Assistente IA",
  // Também suportar nomes em hífen (para backend)
  "active-attendance": "Atendimento Ativo",
  "conversations": "Conversas",
  "tickets": "Chamados",
  "tracking": "Rastreio",
  "bot-config": "Configurar Bot",
  "ai-assistant": "Assistente IA",
} as const;

// Função para normalizar nome de módulo para formato hífen (backend/MegaDesk)
export function normalizeModuleNameToBackend(name: string): string {
  return (MODULE_NAME_MAP as Record<string, string>)[name] || name;
}

// Função para normalizar nome de módulo para formato underscore (MegaAdmin)
export function normalizeModuleNameToAdmin(name: string): string {
  return (MODULE_NAME_MAP_REVERSE as Record<string, string>)[name] || name;
}

// Função para converter array de nomes de módulos
export function normalizeModuleNamesToBackend(names: string[]): string[] {
  return names.map(normalizeModuleNameToBackend);
}

export function normalizeModuleNamesToAdmin(names: string[]): string[] {
  return names.map(normalizeModuleNameToAdmin);
}
