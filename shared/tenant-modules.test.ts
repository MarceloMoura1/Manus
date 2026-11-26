import { describe, it, expect } from 'vitest';
import {
  NICHE_PRESETS,
  ALL_MODULE_KEYS,
  resolveTenantEnabledModules,
  isModuleEnabled,
  hasAnyCrmEnabled,
  hasAnyErpEnabled,
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
});
