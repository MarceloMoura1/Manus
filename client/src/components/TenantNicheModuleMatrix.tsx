import React from 'react';
import {
  UtensilsCrossed,
  Briefcase,
  ShoppingCart,
  Sliders,
  CheckCircle2,
  CheckSquare,
  Square,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  TenantNicheProfile,
  TenantModuleKey,
  NICHE_PROFILES,
  NICHE_PRESETS,
  MODULE_CATALOG,
  ALL_MODULE_KEYS,
} from '@shared/tenant-modules';

interface TenantNicheModuleMatrixProps {
  nicheProfile: TenantNicheProfile;
  enabledModules: TenantModuleKey[];
  onChangeNiche: (niche: TenantNicheProfile) => void;
  onChangeModules: (modules: TenantModuleKey[]) => void;
  disabled?: boolean;
}

const NICHE_ICONS: Record<TenantNicheProfile, React.ElementType> = {
  restaurante: UtensilsCrossed,
  prestacao_servicos: Briefcase,
  ecommerce: ShoppingCart,
  personalizado: Sliders,
};

export const TenantNicheModuleMatrix: React.FC<TenantNicheModuleMatrixProps> = ({
  nicheProfile,
  enabledModules,
  onChangeNiche,
  onChangeModules,
  disabled = false,
}) => {
  const handleSelectNiche = (niche: TenantNicheProfile) => {
    if (disabled) return;
    onChangeNiche(niche);
    if (niche !== 'personalizado') {
      onChangeModules([...NICHE_PRESETS[niche]]);
    }
  };

  const handleToggleModule = (key: TenantModuleKey) => {
    if (disabled) return;
    let nextModules: TenantModuleKey[];
    if (enabledModules.includes(key)) {
      nextModules = enabledModules.filter((m) => m !== key);
    } else {
      nextModules = [...enabledModules, key];
    }
    onChangeModules(nextModules);

    // Se a nova seleção não for exatamente igual ao preset do nicho atual, muda para personalizado
    if (nicheProfile !== 'personalizado') {
      const presetSet = new Set(NICHE_PRESETS[nicheProfile]);
      const nextSet = new Set(nextModules);
      const isExactMatch =
        presetSet.size === nextSet.size && [...presetSet].every((k) => nextSet.has(k));
      if (!isExactMatch) {
        onChangeNiche('personalizado');
      }
    }
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onChangeModules([...ALL_MODULE_KEYS]);
    onChangeNiche('ecommerce');
  };

  const handleApplyPreset = () => {
    if (disabled) return;
    onChangeModules([...NICHE_PRESETS[nicheProfile]]);
  };

  const handleClearAll = () => {
    if (disabled) return;
    onChangeModules(['atendimento']); // Atendimento é essencial
    onChangeNiche('personalizado');
  };

  const operacaoModules = MODULE_CATALOG.filter((m) => m.group === 'operacao');
  const crmModules = MODULE_CATALOG.filter((m) => m.group === 'crm');
  const erpModules = MODULE_CATALOG.filter((m) => m.group === 'erp');

  return (
    <div className="space-y-6">
      {/* 1. Seleção de Nicho */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <label className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            Perfil de Nicho do Cliente
          </label>
          <span className="text-xs text-slate-400">
            Define os módulos recomendados para o modelo de negócio
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {NICHE_PROFILES.map((niche) => {
            const Icon = NICHE_ICONS[niche.id];
            const isSelected = nicheProfile === niche.id;

            return (
              <button
                key={niche.id}
                type="button"
                disabled={disabled}
                onClick={() => handleSelectNiche(niche.id)}
                className={`flex flex-col text-left p-3.5 rounded-2xl border transition relative overflow-hidden ${
                  isSelected
                    ? 'border-emerald-400/80 bg-emerald-950/30 text-white shadow-lg shadow-emerald-950/50 ring-1 ring-emerald-400/50'
                    : 'border-white/10 bg-slate-900/60 text-slate-300 hover:border-white/20 hover:bg-slate-900'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div
                    className={`p-2 rounded-xl ${
                      isSelected
                        ? 'bg-emerald-400/20 text-emerald-300'
                        : 'bg-white/5 text-slate-400'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  )}
                </div>
                <h5 className="text-sm font-semibold text-white">{niche.name}</h5>
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                  {niche.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Barra de Ações Rápidas */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900/80 border border-white/10">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-300 font-medium border border-emerald-400/30">
            {enabledModules.length} de {ALL_MODULE_KEYS.length} ativos
          </span>
          <span className="text-slate-400">
            Nicho atual: <strong className="text-white capitalize">{nicheProfile.replace('_', ' ')}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={handleApplyPreset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition"
          >
            <RotateCcw className="h-3.5 w-3.5 text-cyan-400" />
            Aplicar padrão do nicho
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={handleSelectAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition"
          >
            <CheckSquare className="h-3.5 w-3.5 text-emerald-400" />
            Marcar todos
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={handleClearAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-red-300 transition"
          >
            <Square className="h-3.5 w-3.5" />
            Limpar
          </button>
        </div>
      </div>

      {/* 3. Matriz Granular de Módulos (3 Grupos) */}
      <div className="space-y-4">
        {/* Bloco 1: Operação & Atendimento */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
            <h6 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              Operação & Atendimento
            </h6>
            <span className="text-[11px] text-slate-500">
              {operacaoModules.filter((m) => enabledModules.includes(m.key)).length} / {operacaoModules.length} ativos
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {operacaoModules.map((mod) => {
              const checked = enabledModules.includes(mod.key);
              return (
                <label
                  key={mod.key}
                  className={`flex items-start gap-3 p-2.5 rounded-xl border transition cursor-pointer ${
                    checked
                      ? 'border-cyan-500/30 bg-cyan-950/20 text-white'
                      : 'border-white/5 bg-slate-900/30 text-slate-400 opacity-75 hover:opacity-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => handleToggleModule(mod.key)}
                    className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200">{mod.label}</p>
                    <p className="text-[11px] text-slate-400 truncate">{mod.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Bloco 2: CRM */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
            <h6 className="text-xs font-bold uppercase tracking-wider text-purple-400">
              CRM (Gestão Comercial & Vendas)
            </h6>
            <span className="text-[11px] text-slate-500">
              {crmModules.filter((m) => enabledModules.includes(m.key)).length} / {crmModules.length} ativos
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {crmModules.map((mod) => {
              const checked = enabledModules.includes(mod.key);
              return (
                <label
                  key={mod.key}
                  className={`flex items-start gap-3 p-2.5 rounded-xl border transition cursor-pointer ${
                    checked
                      ? 'border-purple-500/30 bg-purple-950/20 text-white'
                      : 'border-white/5 bg-slate-900/30 text-slate-400 opacity-75 hover:opacity-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => handleToggleModule(mod.key)}
                    className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-800 text-purple-500 focus:ring-0 focus:ring-offset-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200">{mod.label}</p>
                    <p className="text-[11px] text-slate-400 truncate">{mod.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Bloco 3: ERP */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
            <h6 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              ERP (Gestão Empresarial & Backoffice)
            </h6>
            <span className="text-[11px] text-slate-500">
              {erpModules.filter((m) => enabledModules.includes(m.key)).length} / {erpModules.length} ativos
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {erpModules.map((mod) => {
              const checked = enabledModules.includes(mod.key);
              return (
                <label
                  key={mod.key}
                  className={`flex items-start gap-3 p-2.5 rounded-xl border transition cursor-pointer ${
                    checked
                      ? 'border-emerald-500/30 bg-emerald-950/20 text-white'
                      : 'border-white/5 bg-slate-900/30 text-slate-400 opacity-75 hover:opacity-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => handleToggleModule(mod.key)}
                    className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-0 focus:ring-offset-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200">{mod.label}</p>
                    <p className="text-[11px] text-slate-400 truncate">{mod.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
