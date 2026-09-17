import React from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/conversationDateTime";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErpDetailLayout } from "@/components/erp/ErpDetailLayout";
import { ErpStatusBadge } from "@/components/erp/ErpStatusBadge";
import { ErpEmptyState } from "@/components/erp/ErpEmptyState";
import {
  Boxes,
  Barcode,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Edit,
  History,
  Info,
  Layers,
  Package,
  ShieldAlert,
  Tag,
  Truck,
  User,
} from "lucide-react";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type ProductDetail = RouterOutputs["erp"]["products"]["detail"];
export type ProductSupplierItem = RouterOutputs["erp"]["productSuppliers"]["list"]["items"][number];
export type ProductAuditItem = RouterOutputs["erp"]["products"]["history"]["list"]["items"][number];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatMoneyCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return money.format(cents / 100);
}

export function formatQuantityString(value: string | null | undefined): string {
  if (!value) return "0,000";
  const num = Number(value);
  if (!Number.isFinite(num)) return "0,000";
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export const unitLabels: Record<string, string> = {
  unit: "Unidade",
  kg: "Quilograma (kg)",
  liter: "Litro (L)",
  meter: "Metro (m)",
};

export const actionLabels: Record<string, string> = {
  product_created: "Produto criado",
  product_updated: "Produto atualizado",
  product_activated: "Produto ativado",
  product_deactivated: "Produto desativado",
  category_changed: "Categoria alterada",
  brand_changed: "Marca alterada",
  variant_created: "Variante criada",
  variant_updated: "Variante atualizada",
  variant_activated: "Variante ativada",
  variant_deactivated: "Variante desativada",
  variant_deleted: "Variante excluída",
  attribute_combination_changed: "Combinação de atributos alterada",
  supplier_associated: "Fornecedor vinculado",
  supplier_disassociated: "Fornecedor desvinculado",
  preferred_supplier_changed: "Fornecedor preferencial alterado",
  supplier_commercial_updated: "Condições comerciais atualizadas",
  supplier_association_status: "Status do fornecedor alterado",
};

export const fieldLabels: Record<string, string> = {
  name: "Nome",
  sku: "SKU",
  barcode: "Código de barras",
  description: "Descrição",
  costPriceCents: "Preço de custo",
  salePriceCents: "Preço de venda",
  minimumStock: "Estoque mínimo",
  unit: "Unidade",
  active: "Status",
  categoryId: "Categoria",
  brandId: "Marca",
  isPreferred: "Preferencial",
  supplierProductCode: "Código no fornecedor",
};

export function formatAuditValue(field: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (field.endsWith("Cents") && typeof val === "number") {
    return formatMoneyCents(val);
  }
  if (typeof val === "boolean") {
    return val ? "Ativo" : "Inativo";
  }
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch {
      return "—";
    }
  }
  return String(val);
}

export function sanitizeErrorMessage(message?: string | null): string {
  if (!message) return "Ocorreu um erro ao processar a requisição.";
  const technicalPatterns = [
    /select\s+/i,
    /insert\s+/i,
    /update\s+/i,
    /delete\s+/i,
    /sqlstate/i,
    /duplicate\s+entry/i,
    /erp_/i,
    /client_id/i,
    /at\s+[\w/\\.-]+:\d+/i,
    /table\s+['"`]/i,
    /syntax\s+error/i,
    /foreign\s+key/i,
    /repository\./i,
  ];
  for (const pattern of technicalPatterns) {
    if (pattern.test(message)) {
      return "Não foi possível carregar os dados devido a uma falha interna. Tente novamente mais tarde.";
    }
  }
  return message;
}

export function isNotFoundError(error?: { data?: { code?: string } | null; message?: string } | null): boolean {
  if (!error) return false;
  if (error.data?.code === "NOT_FOUND") return true;
  if (typeof error.message === "string") {
    const lower = error.message.toLowerCase();
    if (lower.includes("não encontrado") || lower.includes("not found") || lower.includes("not_found")) {
      return true;
    }
  }
  return false;
}

export function formatBarcodeDisplay(barcode: string | null | undefined): React.ReactNode {
  if (typeof barcode === "string" && barcode.trim().length > 0) {
    return barcode;
  }
  return <span className="text-slate-400 font-normal">—</span>;
}

export type ProductDetailViewProps = {
  product: ProductDetail | null | undefined;
  isLoading: boolean;
  error?: { data?: { code?: string } | null; message?: string } | null;
  onBack: () => void;
  onEdit?: (product: ProductDetail) => void;
  canWrite?: boolean;
  currentTab: "general" | "variants" | "suppliers" | "history";
  onTabChange: (tab: "general" | "variants" | "suppliers" | "history") => void;
  suppliersState?: {
    isLoading: boolean;
    error?: { data?: { code?: string } | null; message?: string } | null;
    items?: ProductSupplierItem[];
    refetch?: () => void;
  };
  historyState?: {
    isLoading: boolean;
    error?: { data?: { code?: string } | null; message?: string } | null;
    items?: ProductAuditItem[];
    refetch?: () => void;
  };
  onRetry?: () => void;
};

export function ProductDetailView({
  product,
  isLoading,
  error,
  onBack,
  onEdit,
  canWrite,
  currentTab,
  onTabChange,
  suppliersState,
  historyState,
  onRetry,
}: ProductDetailViewProps) {
  // 1. Estado de Carregamento
  if (isLoading) {
    return (
      <div data-testid="product-detail-loading">
        <ErpDetailLayout title="Carregando produto..." onBack={onBack} backLabel="Voltar ao catálogo">
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Clock className="h-8 w-8 animate-spin text-blue-600 mb-3" />
            <p className="text-sm font-medium text-slate-600">Carregando dados da ficha do produto...</p>
          </div>
        </ErpDetailLayout>
      </div>
    );
  }

  // 2. Estado Não Encontrado (por retorno nulo ou por erro tRPC NOT_FOUND)
  if (isNotFoundError(error) || (!product && !error)) {
    return (
      <div data-testid="product-detail-not-found">
        <ErpDetailLayout title="Produto não encontrado" onBack={onBack} backLabel="Voltar ao catálogo">
          <ErpEmptyState
            title="O produto solicitado não foi encontrado neste tenant ou foi removido."
            action={{ label: "Voltar para a listagem", onClick: onBack }}
          />
        </ErpDetailLayout>
      </div>
    );
  }

  // 3. Estado de Erro Sanitizado (com proteção contra vazamento de SQL, stack trace, tabelas e internals)
  if (error) {
    return (
      <div data-testid="product-detail-error">
        <ErpDetailLayout title="Erro ao carregar produto" onBack={onBack} backLabel="Voltar ao catálogo">
          <ErpEmptyState
            title={sanitizeErrorMessage(error.message)}
            action={onRetry ? { label: "Tentar novamente", onClick: onRetry } : undefined}
          />
        </ErpDetailLayout>
      </div>
    );
  }

  if (!product) return null;

  // Margem estimada calculada com proteção total contra divisão por zero, NaN e Infinity
  const costCents = Number(product.costPriceCents);
  const saleCents = Number(product.salePriceCents);
  const marginPercent =
    Number.isFinite(costCents) && Number.isFinite(saleCents) && costCents > 0
      ? (((saleCents - costCents) / costCents) * 100).toFixed(1)
      : null;

  return (
    <div className="space-y-6" data-testid="product-detail-page">
      <ErpDetailLayout
        title={product.name}
        eyebrow={`Catálogo • SKU: ${product.sku}`}
        onBack={onBack}
        backLabel="Voltar ao catálogo"
        headerActions={
          <div className="flex flex-wrap items-center gap-2">
            <ErpStatusBadge
              variant={product.active ? "active" : "inactive"}
              label={product.active ? "Ativo" : "Inativo"}
            />
            {canWrite && onEdit && (
              <Button size="sm" variant="outline" onClick={() => onEdit(product)} data-testid="edit-product-button">
                <Edit className="mr-1.5 h-3.5 w-3.5" />
                Editar produto
              </Button>
            )}
          </div>
        }
        tabs={
          <Tabs value={currentTab} onValueChange={(val) => onTabChange(val as typeof currentTab)}>
            <TabsList className="bg-slate-100 p-1 border border-slate-200">
              <TabsTrigger value="general" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <Info className="mr-1.5 h-4 w-4" />
                Geral
              </TabsTrigger>
              <TabsTrigger value="variants" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <Layers className="mr-1.5 h-4 w-4" />
                Variantes ({product.variants?.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="suppliers" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <Truck className="mr-1.5 h-4 w-4" />
                Fornecedores
              </TabsTrigger>
              <TabsTrigger value="history" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <History className="mr-1.5 h-4 w-4" />
                Histórico
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        {/* ABA 1: GERAL */}
        {currentTab === "general" && (
          <div className="space-y-6" data-testid="tab-general-content">
            {/* Informações Comerciais Principais */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-xs font-semibold uppercase tracking-wider">Preço de Venda</span>
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900" data-testid="field-sale-price">
                  {formatMoneyCents(product.salePriceCents)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {marginPercent ? `Margem estimada: +${marginPercent}%` : "Margem não calculável"}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-xs font-semibold uppercase tracking-wider">Preço de Custo</span>
                  <DollarSign className="h-4 w-4 text-slate-400" />
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900" data-testid="field-cost-price">
                  {formatMoneyCents(product.costPriceCents)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Base para apuração de lucro</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-xs font-semibold uppercase tracking-wider">Saldo em Estoque</span>
                  <Boxes className="h-4 w-4 text-blue-600" />
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900" data-testid="field-quantity">
                  {formatQuantityString(product.quantity)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Unidade: {unitLabels[product.unit] || product.unit}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-xs font-semibold uppercase tracking-wider">Estoque Mínimo</span>
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900" data-testid="field-minimum-stock">
                  {formatQuantityString(product.minimumStock)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Gatilho para alerta de reposição</p>
              </div>
            </div>

            {/* Identificação e Taxonomia */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b pb-3">
                  <Tag className="h-4 w-4 text-slate-500" />
                  Identificação do Produto
                </h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">SKU Raiz</dt>
                    <dd className="mt-1 font-mono font-semibold text-slate-900" data-testid="field-sku">
                      {product.sku}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Código de Barras (EAN/GTIN)</dt>
                    <dd className="mt-1 font-mono font-semibold text-slate-900" data-testid="field-barcode">
                      {formatBarcodeDisplay(product.barcode)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Unidade de Medida</dt>
                    <dd className="mt-1 text-slate-900" data-testid="field-unit">
                      {unitLabels[product.unit] || product.unit}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Status no Catálogo</dt>
                    <dd className="mt-1" data-testid="field-status">
                      <ErpStatusBadge
                        variant={product.active ? "active" : "inactive"}
                        label={product.active ? "Ativo para vendas" : "Inativo"}
                      />
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-slate-500">Descrição Comercial</dt>
                    <dd className="mt-1 text-slate-700 whitespace-pre-line" data-testid="field-description">
                      {product.description || <span className="text-slate-400 italic">Nenhuma descrição informada.</span>}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b pb-3">
                  <Building2 className="h-4 w-4 text-slate-500" />
                  Taxonomia e Relacionamentos
                </h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Categoria</dt>
                    <dd className="mt-1 text-slate-900 font-medium" data-testid="field-category">
                      {product.categoryRelational ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-blue-900 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                          {product.categoryRelational.name}
                          {product.categoryRelational.slug && (
                            <span className="text-xs font-normal text-blue-700 font-mono">
                              ({product.categoryRelational.slug})
                            </span>
                          )}
                        </span>
                      ) : product.category ? (
                        <span className="text-slate-800">
                          {product.category} <span className="text-xs text-slate-400">(legada)</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal">Nenhuma categoria vinculada</span>
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-medium text-slate-500">Marca</dt>
                    <dd className="mt-1 text-slate-900 font-medium" data-testid="field-brand">
                      {product.brand ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                          {product.brand.name}
                          {product.brand.slug && (
                            <span className="text-xs font-normal text-slate-500 font-mono">
                              ({product.brand.slug})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal">Nenhuma marca vinculada</span>
                      )}
                    </dd>
                  </div>

                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-slate-500">Fornecedor Preferencial</dt>
                    <dd className="mt-1 text-slate-900" data-testid="field-preferred-supplier">
                      {product.preferredSupplier ? (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">
                            {product.preferredSupplier.supplierLegalName}
                          </span>
                          <span className="rounded-full bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 font-semibold inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Preferencial
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">Nenhum fornecedor preferencial definido</span>
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-medium text-slate-500">Data de Cadastro</dt>
                    <dd className="mt-1 text-slate-600" data-testid="field-created-at">
                      {formatDateTime(product.createdAt) || "—"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-medium text-slate-500">Última Atualização</dt>
                    <dd className="mt-1 text-slate-600" data-testid="field-updated-at">
                      {formatDateTime(product.updatedAt) || "—"}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </div>
        )}

        {/* ABA 2: VARIANTES */}
        {currentTab === "variants" && (
          <div className="space-y-4" data-testid="tab-variants-content">
            {product.variants?.length === 0 ? (
              <ErpEmptyState
                title="Nenhuma variante cadastrada para este produto."
                description="Produtos simples não possuem variantes. Cadastre variantes quando o produto tiver opções de tamanho, cor ou outros atributos."
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-left text-sm" data-testid="variants-table">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5">Nome / Variação</th>
                      <th className="p-3.5">SKU da Variante</th>
                      <th className="p-3.5">Código de Barras</th>
                      <th className="p-3.5 text-right">Preço Efetivo</th>
                      <th className="p-3.5 text-right">Custo Próprio</th>
                      <th className="p-3.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {product.variants.map((v) => {
                      const attrSummary =
                        v.attributes?.map((a) => `${a.typeName}: ${a.valueName}`).join(", ") || "";
                      return (
                        <tr key={v.publicId} className="hover:bg-slate-50/80 transition-colors" data-testid="variant-row">
                          <td className="p-3.5 font-medium text-slate-900">
                            <div>
                              <span>{v.name || "Variante"}</span>
                              {attrSummary && (
                                <p className="text-xs text-slate-500 font-normal mt-0.5">{attrSummary}</p>
                              )}
                            </div>
                          </td>
                          <td className="p-3.5 font-mono text-slate-800 font-semibold">{v.sku}</td>
                          <td className="p-3.5 font-mono text-slate-700">
                            {formatBarcodeDisplay(v.barcode)}
                          </td>
                          <td className="p-3.5 text-right font-semibold text-slate-900">
                            {formatMoneyCents(v.effectivePriceCents)}
                          </td>
                          <td className="p-3.5 text-right text-slate-700">
                            {formatMoneyCents(v.costPriceCents)}
                          </td>
                          <td className="p-3.5 text-center">
                            <ErpStatusBadge
                              variant={v.active ? "active" : "inactive"}
                              label={v.active ? "Ativo" : "Inativo"}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ABA 3: FORNECEDORES */}
        {currentTab === "suppliers" && (
          <div className="space-y-4" data-testid="tab-suppliers-content">
            {suppliersState?.isLoading ? (
              <div className="flex flex-col items-center justify-center p-8 text-center" data-testid="suppliers-loading">
                <Clock className="h-6 w-6 animate-spin text-blue-600 mb-2" />
                <p className="text-sm text-slate-500">Carregando fornecedores associados...</p>
              </div>
            ) : suppliersState?.error ? (
              <ErpEmptyState
                title={sanitizeErrorMessage(suppliersState.error.message)}
                action={suppliersState.refetch ? { label: "Tentar novamente", onClick: suppliersState.refetch } : undefined}
              />
            ) : !suppliersState?.items || suppliersState.items.length === 0 ? (
              <ErpEmptyState
                title="Nenhum fornecedor vinculado a este produto."
                description="Associe fornecedores para registrar referências de compras, custos praticados e fornecedor preferencial."
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-left text-sm" data-testid="suppliers-table">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5">Fornecedor</th>
                      <th className="p-3.5">Código no Fornecedor</th>
                      <th className="p-3.5 text-right">Custo de Referência</th>
                      <th className="p-3.5 text-center">Preferencial</th>
                      <th className="p-3.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suppliersState.items.map((s) => (
                      <tr key={s.publicId} className="hover:bg-slate-50/80 transition-colors" data-testid="supplier-row">
                        <td className="p-3.5">
                          <p className="font-semibold text-slate-900">{s.supplierLegalName}</p>
                          {s.supplierTradeName && (
                            <p className="text-xs text-slate-500">{s.supplierTradeName}</p>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-slate-700">{s.supplierProductCode || "—"}</td>
                        <td className="p-3.5 text-right font-medium text-slate-900">
                          {s.costPriceCents !== null ? formatMoneyCents(s.costPriceCents) : "—"}
                        </td>
                        <td className="p-3.5 text-center">
                          {s.isPreferred ? (
                            <span className="rounded-full bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 font-semibold inline-flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Preferencial
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          <ErpStatusBadge
                            variant={s.active ? "active" : "inactive"}
                            label={s.active ? "Ativo" : "Inativo"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ABA 4: HISTÓRICO / AUDITORIA */}
        {currentTab === "history" && (
          <div className="space-y-4" data-testid="tab-history-content">
            {historyState?.isLoading ? (
              <div className="flex flex-col items-center justify-center p-8 text-center" data-testid="history-loading">
                <Clock className="h-6 w-6 animate-spin text-blue-600 mb-2" />
                <p className="text-sm text-slate-500">Carregando histórico de alterações...</p>
              </div>
            ) : historyState?.error ? (
              <ErpEmptyState
                title={sanitizeErrorMessage(historyState.error.message)}
                action={historyState.refetch ? { label: "Tentar novamente", onClick: historyState.refetch } : undefined}
              />
            ) : !historyState?.items || historyState.items.length === 0 ? (
              <ErpEmptyState
                title="Nenhum registro de auditoria encontrado para este produto."
                description="Alterações de preço, status, variantes ou fornecedores serão registradas aqui automaticamente de forma imutável."
              />
            ) : (
              <div className="space-y-3" data-testid="audit-history-list">
                {historyState.items.map((log) => {
                  const changeEntries = log.changes && typeof log.changes === "object" ? Object.entries(log.changes) : [];
                  return (
                    <article
                      key={log.publicId}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3"
                      data-testid="audit-log-item"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800">
                            {actionLabels[log.action] || log.action}
                          </span>
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            {formatDateTime(log.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <span className="font-semibold text-slate-800" data-testid="actor-name">
                            {log.actor?.name || "Operador do Sistema"}
                          </span>
                          {log.actor?.role && (
                            <span className="text-slate-400">({log.actor.role})</span>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-slate-800 font-medium">
                        {log.summary || actionLabels[log.action] || log.action}
                      </p>

                      {changeEntries.length > 0 && (
                        <div className="rounded-xl bg-slate-50 p-3 border border-slate-100" data-testid="audit-diff-box">
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                            Modificações Registradas
                          </p>
                          <div className="grid gap-1.5 text-xs">
                            {changeEntries.map(([field, diff]) => {
                              const before =
                                diff && typeof diff === "object" && "before" in diff
                                  ? (diff as { before: unknown }).before
                                  : undefined;
                              const after =
                                diff && typeof diff === "object" && "after" in diff
                                  ? (diff as { after: unknown }).after
                                  : diff;
                              return (
                                <div key={field} className="flex flex-wrap items-baseline gap-2">
                                  <span className="font-semibold text-slate-700 min-w-[120px]">
                                    {fieldLabels[field] || field}:
                                  </span>
                                  <span className="text-slate-500 line-through">
                                    {formatAuditValue(field, before)}
                                  </span>
                                  <span className="text-slate-400">→</span>
                                  <span className="font-semibold text-emerald-700">
                                    {formatAuditValue(field, after)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </ErpDetailLayout>
    </div>
  );
}

export function ProductDetailPanel({
  productPublicId,
  onBack,
  onEdit,
  canWrite,
}: {
  productPublicId: string;
  onBack: () => void;
  onEdit?: (product: ProductDetail) => void;
  canWrite?: boolean;
}) {
  const [currentTab, setCurrentTab] = React.useState<"general" | "variants" | "suppliers" | "history">("general");

  const productQuery = trpc.erp.products.detail.useQuery({ publicId: productPublicId });

  const suppliersQuery = trpc.erp.productSuppliers.list.useQuery(
    { productPublicId },
    { enabled: currentTab === "suppliers" }
  );

  const historyQuery = trpc.erp.products.history.list.useQuery(
    { productPublicId, pageSize: 50 },
    { enabled: currentTab === "history" }
  );

  return (
    <ProductDetailView
      product={productQuery.data}
      isLoading={productQuery.isLoading}
      error={productQuery.error}
      onBack={onBack}
      onEdit={onEdit}
      canWrite={canWrite}
      currentTab={currentTab}
      onTabChange={setCurrentTab}
      suppliersState={{
        isLoading: suppliersQuery.isLoading,
        error: suppliersQuery.error,
        items: suppliersQuery.data?.items,
        refetch: () => void suppliersQuery.refetch(),
      }}
      historyState={{
        isLoading: historyQuery.isLoading,
        error: historyQuery.error,
        items: historyQuery.data?.items,
        refetch: () => void historyQuery.refetch(),
      }}
      onRetry={() => void productQuery.refetch()}
    />
  );
}
