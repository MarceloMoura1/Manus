import { describe, it, expect } from 'vitest';
import {
  NICHE_PRESETS,
  ALL_MODULE_KEYS,
  normalizeTenantModules,
  resolveTenantEnabledModules,
  isModuleEnabled,
  hasAnyCrmEnabled,
  hasAnyErpEnabled,
  MODULE_CATALOG,
  CRM_SECTION_MODULES,
  ERP_SECTION_MODULES,
  getFirstEnabledCrmSection,
  getFirstEnabledErpSection,
  hasUserPermission,
  isUserPermissionAllowedByTenant,
} from './tenant-modules';

describe('shared/tenant-modules', () => {
  it('deve ter presets corretos para restaurante', () => {
    const modules = NICHE_PRESETS.restaurante;
    expect(modules).toContain('atendimento');
    expect(modules).toContain('erp.produtos');
    expect(modules).toContain('erp.vendas');
    expect(modules).not.toContain('rastreamento');
    expect(modules).not.toContain('erp.servicos');
    expect(modules).not.toContain('erp.estoque');
    expect(modules).not.toContain('erp.compras');
    expect(modules).not.toContain('erp.fornecedores');
  });

  it('deve ter presets corretos para prestacao_servicos', () => {
    const modules = NICHE_PRESETS.prestacao_servicos;
    expect(modules).toContain('atendimento');
    expect(modules).toContain('crm.pipeline');
    expect(modules).toContain('erp.servicos');
    expect(modules).not.toContain('rastreamento');
    expect(modules).not.toContain('erp.produtos');
    expect(modules).not.toContain('erp.estoque');
    expect(modules).not.toContain('erp.compras');
    expect(modules).not.toContain('erp.fornecedores');
  });

  it('deve ter todos os modulos para ecommerce', () => {
    expect(NICHE_PRESETS.ecommerce).toEqual(ALL_MODULE_KEYS);
  });

  it('deve resolver para todos os módulos quando customModules for null/undefined e perfil personalizado (retrocompatibilidade)', () => {
    const resolved = resolveTenantEnabledModules('personalizado', null);
    expect(resolved).toEqual(ALL_MODULE_KEYS);

    const legacyResolved = resolveTenantEnabledModules(undefined, undefined);
    expect(legacyResolved).toEqual(ALL_MODULE_KEYS);
  });

  it('deve resolver para o preset do nicho quando customModules for omitido', () => {
    const resolvedRestaurante = resolveTenantEnabledModules('restaurante', null);
    expect(resolvedRestaurante).toEqual(NICHE_PRESETS.restaurante);

    const resolvedServicos = resolveTenantEnabledModules('prestacao_servicos', []);
    expect(resolvedServicos).toEqual(NICHE_PRESETS.prestacao_servicos);
  });

  it('deve respeitar a seleção personalizada de módulos quando fornecida', () => {
    const custom = ['atendimento', 'erp.resumo', 'erp.financeiro'];
    const resolved = resolveTenantEnabledModules('personalizado', custom);
    expect(resolved).toEqual(custom);
  });

  it('deve checar se um módulo está habilitado com fallback seguro', () => {
    expect(isModuleEnabled(undefined, 'rastreamento')).toBe(true);
    expect(isModuleEnabled(['atendimento', 'chamados'], 'atendimento')).toBe(true);
    expect(isModuleEnabled(['atendimento', 'chamados'], 'rastreamento')).toBe(false);
  });

  it('deve detectar se CRM ou ERP possuem algum submódulo ativo', () => {
    expect(hasAnyCrmEnabled(['atendimento', 'crm.propostas'])).toBe(true);
    expect(hasAnyCrmEnabled(['atendimento', 'erp.vendas'])).toBe(false);
    expect(hasAnyErpEnabled(['atendimento', 'erp.vendas'])).toBe(true);
    expect(hasAnyErpEnabled(['atendimento', 'crm.leads'])).toBe(false);
  });

  it('catálogo contém todas as abas reais do CRM e ERP e módulos de operação', () => {
    const keys = MODULE_CATALOG.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ['atendimento', 'chamados', 'rastreamento', 'assistente_ia']) expect(keys).toContain(k);
    for (const { key } of CRM_SECTION_MODULES) expect(keys).toContain(key);
    for (const { key } of ERP_SECTION_MODULES) expect(keys).toContain(key);
    expect(MODULE_CATALOG.filter((m) => m.group === 'crm')).toHaveLength(8);
    expect(MODULE_CATALOG.filter((m) => m.group === 'erp')).toHaveLength(10);
    for (const preset of Object.values(NICHE_PRESETS)) {
      for (const k of preset) expect(keys).toContain(k);
      expect(preset).toContain('atendimento');
    }
  });

  it('retrocompatibilidade: listas legadas com crm.* liberam resumo, atividades e relatórios', () => {
    const legacy = ['atendimento', 'assistente_ia', 'crm.pipeline', 'crm.clientes'];
    const resolved = resolveTenantEnabledModules('personalizado', legacy);
    expect(resolved).toEqual(expect.arrayContaining(['crm.resumo', 'crm.atividades', 'crm.relatorios', 'crm.automacoes']));
    expect(isModuleEnabled(legacy, 'crm.relatorios')).toBe(true);
    expect(isModuleEnabled(['atendimento', 'crm.pipeline'], 'crm.automacoes')).toBe(false);
    // lista nova explícita não é expandida
    expect(isModuleEnabled(['atendimento', 'crm.pipeline', 'crm.resumo'], 'crm.relatorios')).toBe(false);
  });

  it('abre na primeira aba habilitada', () => {
    expect(getFirstEnabledCrmSection(['atendimento', 'crm.leads', 'crm.resumo'])).toBe('summary');
    expect(getFirstEnabledCrmSection(['atendimento', 'crm.leads', 'crm.relatorios'])).toBe('leads');
    expect(getFirstEnabledCrmSection(['atendimento', 'erp.vendas'])).toBeNull();
    expect(getFirstEnabledErpSection(['atendimento', 'erp.vendas', 'erp.fiscal'])).toBe('sales');
  });

  it('permissões de usuário aceitam nomes do MegaAdmin e do backend e respeitam bloqueio da empresa', () => {
    expect(hasUserPermission(['conversations'], 'conversas')).toBe(true);
    expect(hasUserPermission(['conversas'], 'conversations')).toBe(true);
    expect(hasUserPermission(['tracking'], 'rastreio')).toBe(true);
    expect(hasUserPermission(['tickets'], 'conversations')).toBe(false);
    expect(isUserPermissionAllowedByTenant('conversas', ['chamados'])).toBe(false);
    expect(isUserPermissionAllowedByTenant('conversations', ['atendimento'])).toBe(true);
    expect(isUserPermissionAllowedByTenant('crm', ['atendimento'])).toBe(false);
    expect(isUserPermissionAllowedByTenant('erp', ['erp.vendas'])).toBe(true);
  });

  describe('normalização robusta (strings, JSON duplamente escapado, nulos e tipos inválidos)', () => {
    it('deve normalizar arrays válidos', () => {
      expect(normalizeTenantModules(['atendimento', 'crm.leads'])).toEqual(['atendimento', 'crm.leads']);
      expect(normalizeTenantModules(['atendimento', 'modulo_invalido_xyz'])).toEqual(['atendimento']);
    });

    it('deve normalizar strings JSON simples', () => {
      expect(normalizeTenantModules('["atendimento", "crm.leads"]')).toEqual(['atendimento', 'crm.leads']);
    });

    it('deve normalizar strings JSON duplamente escapadas', () => {
      const doubleEncoded = JSON.stringify(JSON.stringify(['atendimento', 'erp.vendas']));
      expect(normalizeTenantModules(doubleEncoded)).toEqual(['atendimento', 'erp.vendas']);
    });

    it('deve retornar null para valores vazios ou inválidos', () => {
      expect(normalizeTenantModules(null)).toBeNull();
      expect(normalizeTenantModules(undefined)).toBeNull();
      expect(normalizeTenantModules('')).toBeNull();
      expect(normalizeTenantModules('   ')).toBeNull();
      expect(normalizeTenantModules('null')).toBeNull();
      expect(normalizeTenantModules('undefined')).toBeNull();
      expect(normalizeTenantModules('{ "invalid": 123 }')).toBeNull();
      expect(normalizeTenantModules(12345)).toBeNull();
      expect(normalizeTenantModules(true)).toBeNull();
      expect(normalizeTenantModules({})).toBeNull();
    });

    it('resolveTenantEnabledModules deve aceitar customModules como string JSON', () => {
      const resolved = resolveTenantEnabledModules('personalizado', '["atendimento", "erp.fiscal"]');
      expect(resolved).toEqual(['atendimento', 'erp.fiscal']);
    });

    it('isModuleEnabled, hasAnyCrmEnabled e hasAnyErpEnabled não devem lançar exceções com string ou tipos anômalos', () => {
      // Testes com string JSON
      expect(isModuleEnabled('["atendimento", "crm.propostas"]', 'atendimento')).toBe(true);
      expect(isModuleEnabled('["atendimento", "crm.propostas"]', 'rastreamento')).toBe(false);
      expect(hasAnyCrmEnabled('["atendimento", "crm.propostas"]')).toBe(true);
      expect(hasAnyCrmEnabled('["atendimento", "erp.fiscal"]')).toBe(false);
      expect(hasAnyErpEnabled('["atendimento", "erp.fiscal"]')).toBe(true);
      expect(hasAnyErpEnabled('["atendimento", "crm.propostas"]')).toBe(false);

      // Testes com tipos inválidos (fallback seguro para true)
      expect(isModuleEnabled('texto-invalido-nao-json', 'atendimento')).toBe(true);
      expect(hasAnyCrmEnabled('texto-invalido-nao-json')).toBe(true);
      expect(hasAnyErpEnabled({ invalid: true })).toBe(true);
    });
  });
});
