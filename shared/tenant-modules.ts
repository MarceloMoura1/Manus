export type TenantNicheProfile = 'restaurante' | 'prestacao_servicos' | 'ecommerce' | 'personalizado';

export type OperationModuleKey = 'atendimento' | 'chamados' | 'rastreamento' | 'assistente_ia';
export type CrmModuleKey = 'crm.pipeline' | 'crm.leads' | 'crm.propostas' | 'crm.clientes';
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
  { key: 'chamados', label: 'Gestão de Chamados', description: 'Tickets e suporte interno/externo', group: 'operacao' },
  { key: 'rastreamento', label: 'Rastreamento de Pedidos', description: 'Acompanhamento logístico de entregas', group: 'operacao' },
  { key: 'assistente_ia', label: 'Assistente & Bot de IA', description: 'Roteamento e automação inteligente', group: 'operacao' },

  // CRM
  { key: 'crm.pipeline', label: 'Funil de Vendas (Pipeline)', description: 'Gestão de oportunidades e fases', group: 'crm' },
  { key: 'crm.leads', label: 'Base de Leads', description: 'Prospecção e qualificação de contatos', group: 'crm' },
  { key: 'crm.propostas', label: 'Propostas Comerciais', description: 'Emissão e envio de orçamentos em PDF', group: 'crm' },
  { key: 'crm.clientes', label: 'Carteira de Clientes', description: 'Cadastro e histórico de clientes', group: 'crm' },

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
    'crm.clientes',
    'crm.propostas',
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
    'crm.pipeline',
    'crm.leads',
    'crm.propostas',
    'crm.clientes',
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
    return normalized;
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
  return normalized.includes(key);
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
