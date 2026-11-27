import { normalizeModuleNameToAdmin, normalizeModuleNameToBackend } from './const';
export type TenantNicheProfile = 'restaurante' | 'prestacao_servicos' | 'ecommerce' | 'personalizado';

export type OperationModuleKey = 'atendimento' | 'chamados' | 'rastreamento' | 'assistente_ia';
export type CrmModuleKey =
  | 'crm.resumo'
  | 'crm.clientes'
  | 'crm.propostas'
  | 'crm.leads'
  | 'crm.pipeline'
  | 'crm.automacoes'
  | 'crm.atividades'
  | 'crm.relatorios';
export type ErpModuleKey =
  | 'erp.resumo'
  | 'erp.produtos'
  | 'erp.servicos'
  | 'erp.estoque'
  | 'erp.vendas'
  | 'erp.compras'
  | 'erp.financeiro'
  | 'erp.fiscal'
  | 'erp.relatorios'
  | 'erp.fornecedores';

export type TenantModuleKey = OperationModuleKey | CrmModuleKey | ErpModuleKey;

export interface ModuleDefinition {
  key: TenantModuleKey;
  label: string;
  description: string;
  group: 'operacao' | 'crm' | 'erp';
}

export const MODULE_CATALOG: ModuleDefinition[] = [
  // Operação & Atendimento
  { key: 'atendimento', label: 'Atendimento Omnichannel', description: 'Painel de conversas e chat WhatsApp', group: 'operacao' },
  { key: 'chamados', label: 'Gestão de Tickets', description: 'Tickets e suporte interno/externo', group: 'operacao' },
  { key: 'rastreamento', label: 'Rastreamento de Pedidos', description: 'Acompanhamento logístico de entregas', group: 'operacao' },
  { key: 'assistente_ia', label: 'Assistente & Bot de IA', description: 'Roteamento e automação inteligente', group: 'operacao' },

  // CRM
  { key: 'crm.resumo', label: 'Resumo do CRM', description: 'Painel com indicadores e atalhos do CRM', group: 'crm' },
  { key: 'crm.clientes', label: 'Carteira de Clientes', description: 'Cadastro e histórico de clientes', group: 'crm' },
  { key: 'crm.propostas', label: 'Propostas Comerciais', description: 'Emissão e envio de orçamentos em PDF', group: 'crm' },
  { key: 'crm.leads', label: 'Base de Leads', description: 'Prospecção e qualificação de contatos', group: 'crm' },
  { key: 'crm.pipeline', label: 'Funil de Vendas (Pipeline)', description: 'Gestão de oportunidades e fases', group: 'crm' },
  { key: 'crm.automacoes', label: 'Automações e IA', description: 'Regras e automações inteligentes do CRM', group: 'crm' },
  { key: 'crm.atividades', label: 'Atividades e Agenda', description: 'Tarefas, follow-ups e compromissos comerciais', group: 'crm' },
  { key: 'crm.relatorios', label: 'Relatórios do CRM', description: 'Métricas de funil, conversão e desempenho', group: 'crm' },

  // ERP
  { key: 'erp.resumo', label: 'Resumo Executivo (Cockpit)', description: 'KPIs, saúde financeira e atalhos rápidos', group: 'erp' },
  { key: 'erp.produtos', label: 'Catálogo de Produtos', description: 'Cadastro de itens físicos e preços', group: 'erp' },
  { key: 'erp.servicos', label: 'Catálogo de Serviços', description: 'Precificação e gestão de serviços', group: 'erp' },
  { key: 'erp.estoque', label: 'Controle de Estoque', description: 'Movimentações, saldo mínimo e reposição', group: 'erp' },
  { key: 'erp.vendas', label: 'Pedidos de Venda', description: 'Gestão de pedidos e faturamento', group: 'erp' },
  { key: 'erp.compras', label: 'Ordens de Compra', description: 'Entrada de mercadorias e insumos', group: 'erp' },
  { key: 'erp.financeiro', label: 'Financeiro (Contas a Pagar/Receber)', description: 'Fluxo de caixa e conciliação', group: 'erp' },
  { key: 'erp.fiscal', label: 'Módulo Fiscal', description: 'Documentos fiscais e impostos', group: 'erp' },
  { key: 'erp.relatorios', label: 'Relatórios & Inteligência', description: 'Análises consolidadas e métricas', group: 'erp' },
  { key: 'erp.fornecedores', label: 'Cadastro de Fornecedores', description: 'Parceiros comerciais e compras', group: 'erp' },
];

export const ALL_MODULE_KEYS: TenantModuleKey[] = MODULE_CATALOG.map((m) => m.key);

export const NICHE_PRESETS: Record<TenantNicheProfile, TenantModuleKey[]> = {
  restaurante: [
    'atendimento',
    'chamados',
    'assistente_ia',
    'crm.resumo',
    'crm.clientes',
    'crm.propostas',
    'crm.atividades',
    'erp.resumo',
    'erp.produtos',
    'erp.vendas',
    'erp.financeiro',
    'erp.fiscal',
    'erp.relatorios',
  ],
  prestacao_servicos: [
    'atendimento',
    'chamados',
    'assistente_ia',
    'crm.resumo',
    'crm.clientes',
    'crm.propostas',
    'crm.leads',
    'crm.pipeline',
    'crm.automacoes',
    'crm.atividades',
    'crm.relatorios',
    'erp.resumo',
    'erp.servicos',
    'erp.vendas',
    'erp.financeiro',
    'erp.fiscal',
    'erp.relatorios',
  ],
  ecommerce: [...ALL_MODULE_KEYS],
  personalizado: [...ALL_MODULE_KEYS],
};

export interface NicheProfileInfo {
  id: TenantNicheProfile;
  name: string;
  tagline: string;
  description: string;
  recommendedFor: string;
}

export const NICHE_PROFILES: NicheProfileInfo[] = [
  {
    id: 'restaurante',
    name: 'Restaurante / Delivery',
    tagline: 'Foco em pedidos rápidos e produtos',
    description: 'Atendimento ágil, produtos, vendas, financeiro e clientes. Oculta serviços, estoque detalhado e compras.',
    recommendedFor: 'Restaurantes, lanchonetes, bares e delivery.',
  },
  {
    id: 'prestacao_servicos',
    name: 'Prestação de Serviços',
    tagline: 'Foco em propostas e execução',
    description: 'CRM completo, catálogo de serviços, orçamentos e financeiro. Oculta produtos físicos e estoque.',
    recommendedFor: 'Agências, consultorias, clínicas, assistências técnicas e profissionais autônomos.',
  },
  {
    id: 'ecommerce',
    name: 'E-commerce / Comércio Geral',
    tagline: 'Operação integrada ponta a ponta',
    description: 'Todos os módulos liberados: rastreamento, CRM completo, produtos, compras, estoque e financeiro.',
    recommendedFor: 'Lojas virtuais, atacados, varejos e distribuidoras.',
  },
  {
    id: 'personalizado',
    name: 'Personalizado',
    tagline: 'Seleção livre de módulos',
    description: 'Permite selecionar manualmente cada módulo e submódulo de acordo com a necessidade do cliente.',
    recommendedFor: 'Operações sob medida ou configurações personalizadas.',
  },
];

/**
 * Normaliza uma lista arbitrária de módulos de tenant (que pode vir como Array,
 * string JSON simples ou duplamente escapada, ou valores nulos/indefinidos).
 * Retorna uma lista de chaves válidas ou null se não houver módulos configurados.
 */
export function normalizeTenantModules(modules: unknown): TenantModuleKey[] | null {
  if (modules == null) return null;

  let raw = modules;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
    try {
      raw = JSON.parse(trimmed);
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          // Mantém o valor anterior se a segunda decodificação falhar
        }
      }
    } catch {
      return null;
    }
  }

  if (!Array.isArray(raw)) {
    return null;
  }

  const validKeys = new Set<string>(ALL_MODULE_KEYS);
  return raw.filter((k): k is TenantModuleKey => typeof k === 'string' && validKeys.has(k));
}

/**
 * Retrocompatibilidade: listas salvas antes da separação das abas Resumo, Atividades,
 * Automações e Relatórios do CRM só tinham crm.pipeline/leads/propostas/clientes.
 * Essas abas eram sempre visíveis (Automações dependia de assistente_ia). Se a lista tem
 * algum crm.* legado e nenhuma das chaves novas, elas são liberadas para não quebrar o acesso.
 */
const NEW_CRM_KEYS: TenantModuleKey[] = ['crm.resumo', 'crm.atividades', 'crm.automacoes', 'crm.relatorios'];

export function expandLegacyCrmModules(modules: TenantModuleKey[]): TenantModuleKey[] {
  const hasCrm = modules.some((k) => k.startsWith('crm.'));
  const hasNewCrmKey = modules.some((k) => NEW_CRM_KEYS.includes(k));
  if (!hasCrm || hasNewCrmKey) return modules;
  const extra: TenantModuleKey[] = ['crm.resumo', 'crm.atividades', 'crm.relatorios'];
  if (modules.includes('assistente_ia')) extra.push('crm.automacoes');
  return [...modules, ...extra];
}
/**
 * Resolve os módulos habilitados para um tenant.
 * Se customModules for informado (array não nulo/vazio ou string JSON válida com itens), usa-o diretamente.
 * Se não for informado ou for nulo:
 * - Se nicheProfile for fornecido e diferente de 'personalizado', usa o preset do nicho.
 * - Caso contrário (retrocompatibilidade com tenants legados), retorna TODOS os módulos habilitados.
 */
export function resolveTenantEnabledModules(
  nicheProfile?: TenantNicheProfile | string | null,
  customModules?: unknown
): TenantModuleKey[] {
  const normalized = normalizeTenantModules(customModules);
  if (normalized && normalized.length > 0) {
    return expandLegacyCrmModules(normalized);
  }

  const normalizedProfile = (nicheProfile || 'personalizado') as TenantNicheProfile;
  if (normalizedProfile in NICHE_PRESETS && normalizedProfile !== 'personalizado') {
    return [...NICHE_PRESETS[normalizedProfile]];
  }

  // Padrão para clientes legados sem configuração granular explícita: todos liberados
  return [...ALL_MODULE_KEYS];
}

/**
 * Verifica se um módulo específico está habilitado na lista do tenant.
 * Se enabledModules for undefined/null ou inválido,
 * assume true para não quebrar a experiência do usuário.
 */
export function isModuleEnabled(
  enabledModules: unknown,
  key: TenantModuleKey
): boolean {
  if (enabledModules == null) return true;
  const normalized = normalizeTenantModules(enabledModules);
  if (normalized == null) return true;
  return expandLegacyCrmModules(normalized).includes(key);
}

export function hasAnyCrmEnabled(enabledModules: unknown): boolean {
  if (enabledModules == null) return true;
  const normalized = normalizeTenantModules(enabledModules);
  if (normalized == null) return true;
  return normalized.some((k) => k.startsWith('crm.'));
}

export function hasAnyErpEnabled(enabledModules: unknown): boolean {
  if (enabledModules == null) return true;
  const normalized = normalizeTenantModules(enabledModules);
  if (normalized == null) return true;
  return normalized.some((k) => k.startsWith('erp.'));
}

// ─── Abas reais do CRM/ERP ↔ módulos (ordem = ordem da topbar) ─────────────────

export const CRM_SECTION_MODULES = [
  { section: 'summary', key: 'crm.resumo' },
  { section: 'clients', key: 'crm.clientes' },
  { section: 'proposals', key: 'crm.propostas' },
  { section: 'leads', key: 'crm.leads' },
  { section: 'pipeline', key: 'crm.pipeline' },
  { section: 'automations', key: 'crm.automacoes' },
  { section: 'activities', key: 'crm.atividades' },
  { section: 'reports', key: 'crm.relatorios' },
] as const satisfies ReadonlyArray<{ section: string; key: CrmModuleKey }>;

export const ERP_SECTION_MODULES = [
  { section: 'summary', key: 'erp.resumo' },
  { section: 'products', key: 'erp.produtos' },
  { section: 'services', key: 'erp.servicos' },
  { section: 'stock', key: 'erp.estoque' },
  { section: 'sales', key: 'erp.vendas' },
  { section: 'purchases', key: 'erp.compras' },
  { section: 'finance', key: 'erp.financeiro' },
  { section: 'fiscal', key: 'erp.fiscal' },
  { section: 'reports', key: 'erp.relatorios' },
  { section: 'suppliers', key: 'erp.fornecedores' },
  { section: 'clients', key: 'crm.clientes' },
] as const satisfies ReadonlyArray<{ section: string; key: TenantModuleKey }>;

export type CrmSectionId = (typeof CRM_SECTION_MODULES)[number]['section'];
export type ErpSectionId = (typeof ERP_SECTION_MODULES)[number]['section'];

export function isCrmSectionEnabled(enabledModules: unknown, section: string): boolean {
  const entry = CRM_SECTION_MODULES.find((s) => s.section === section);
  return entry ? isModuleEnabled(enabledModules, entry.key) : true;
}

export function isErpSectionEnabled(enabledModules: unknown, section: string): boolean {
  const entry = ERP_SECTION_MODULES.find((s) => s.section === section);
  return entry ? isModuleEnabled(enabledModules, entry.key) : true;
}

export function getFirstEnabledCrmSection(enabledModules: unknown): CrmSectionId | null {
  return CRM_SECTION_MODULES.find((s) => isModuleEnabled(enabledModules, s.key))?.section ?? null;
}

export function getFirstEnabledErpSection(enabledModules: unknown): ErpSectionId | null {
  return ERP_SECTION_MODULES.find((s) => isModuleEnabled(enabledModules, s.key))?.section ?? null;
}

// ─── Permissões de usuário (MegaAdmin/backend) ↔ módulos do tenant ───────────────

/** Verifica permissão aceitando tanto o nome do MegaAdmin (conversas) quanto do backend (conversations). */
export function hasUserPermission(permissions: readonly string[] | null | undefined, name: string): boolean {
  if (!permissions) return false;
  const candidates = new Set<string>([name, normalizeModuleNameToBackend(name), normalizeModuleNameToAdmin(name)]);
  return permissions.some((p) => candidates.has(p));
}

/** Módulo do tenant que bloqueia uma permissão de usuário (retorna true se a empresa liberou). */
export function isUserPermissionAllowedByTenant(permission: string, enabledModules: unknown): boolean {
  switch (normalizeModuleNameToBackend(permission)) {
    case 'conversations':
    case 'active-attendance':
      return isModuleEnabled(enabledModules, 'atendimento');
    case 'tickets':
      return isModuleEnabled(enabledModules, 'chamados');
    case 'tracking':
      return isModuleEnabled(enabledModules, 'rastreamento');
    case 'ai-assistant':
      return isModuleEnabled(enabledModules, 'assistente_ia');
    case 'crm':
      return hasAnyCrmEnabled(enabledModules);
    case 'erp':
      return hasAnyErpEnabled(enabledModules);
    default:
      return true;
  }
}