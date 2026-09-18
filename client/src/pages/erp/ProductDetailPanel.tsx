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
  Image as ImageIcon,
  Info,
  Layers,
  Maximize2,
  Package,
  Plus,
  ShieldAlert,
  Tag,
  Trash2,
  Truck,
  Upload,
  User,
} from "lucide-react";
import { ProductVariantDialog, type ProductVariantItem } from "./ProductVariantDialog";

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
  onAddVariant?: () => void;
  onEditVariant?: (variant: NonNullable<ProductDetail>["variants"][number]) => void;
  onToggleVariantActive?: (variant: NonNullable<ProductDetail>["variants"][number]) => void;
  onDeleteVariant?: (variant: NonNullable<ProductDetail>["variants"][number]) => void;
  variantActionPending?: boolean;
  variantActionMessage?: string | null;
  variantActionError?: string | null;
  onImagesChanged?: () => void;
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
  onAddVariant,
  onEditVariant,
  onToggleVariantActive,
  onDeleteVariant,
  variantActionPending,
  variantActionMessage,
  variantActionError,
  onImagesChanged,
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

            {/* IMAGENS DO PRODUTO */}
            <ProductImageGallerySection
              productPublicId={product.publicId}
              productName={product.name}
              canWrite={canWrite}
              onImagesChanged={onImagesChanged}
            />

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
            {/* Barra de Ações de Variantes */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Variantes do Produto</h2>
                <p className="text-xs text-slate-500">
                  Gerencie as variações comerciais (tamanhos, cores, voltagens) com SKUs e preços próprios.
                </p>
              </div>
              {canWrite && onAddVariant && (
                <Button
                  size="sm"
                  onClick={onAddVariant}
                  data-testid="add-variant-btn"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Nova variante
                </Button>
              )}
            </div>

            {variantActionMessage && (
              <p
                role="status"
                className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800"
                data-testid="variant-action-message"
              >
                {variantActionMessage}
              </p>
            )}

            {variantActionError && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800"
                data-testid="variant-action-error"
              >
                {sanitizeErrorMessage(variantActionError)}
              </p>
            )}

            {product.variants?.length === 0 ? (
              <ErpEmptyState
                title="Nenhuma variante cadastrada para este produto."
                description="Produtos simples não possuem variantes. Cadastre variantes quando o produto tiver opções de tamanho, cor ou outros atributos."
                action={
                  canWrite && onAddVariant
                    ? { label: "Adicionar primeira variante", onClick: onAddVariant }
                    : undefined
                }
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
                      {canWrite && (onEditVariant || onToggleVariantActive || onDeleteVariant) && (
                        <th className="p-3.5 text-right">Ações</th>
                      )}
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
                          {canWrite && (onEditVariant || onToggleVariantActive || onDeleteVariant) && (
                            <td className="p-3.5 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                {onEditVariant && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2.5 text-xs"
                                    data-testid={`edit-variant-btn-${v.publicId}`}
                                    onClick={() => onEditVariant(v)}
                                    disabled={variantActionPending}
                                  >
                                    Editar
                                  </Button>
                                )}
                                {onToggleVariantActive && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2.5 text-xs"
                                    data-testid={`toggle-variant-active-btn-${v.publicId}`}
                                    onClick={() => onToggleVariantActive(v)}
                                    disabled={variantActionPending}
                                  >
                                    {v.active ? "Inativar" : "Ativar"}
                                  </Button>
                                )}
                                {onDeleteVariant && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 border-red-200"
                                    data-testid={`delete-variant-btn-${v.publicId}`}
                                    onClick={() => onDeleteVariant(v)}
                                    disabled={variantActionPending}
                                  >
                                    Excluir
                                  </Button>
                                )}
                              </div>
                            </td>
                          )}
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

export type ProductGalleryItem = {
  mediaId: string;
  isPrimary: boolean;
  displayOrder: number;
  width: number;
  height: number;
  byteSize: number;
  mimeType: string;
  createdAt: string;
};

export function ProductImageGallerySection({
  productPublicId,
  productName,
  canWrite,
  onImagesChanged,
}: {
  productPublicId: string;
  productName: string;
  canWrite?: boolean;
  onImagesChanged?: () => void;
}) {
  const [items, setItems] = React.useState<ProductGalleryItem[]>([]);
  const [selectedMediaId, setSelectedMediaId] = React.useState<string | null>(null);
  const [hasImage, setHasImage] = React.useState(true);
  const [timestamp, setTimestamp] = React.useState(1);
  const [zoomOpen, setZoomOpen] = React.useState(false);
  const [actionPending, setActionPending] = React.useState(false);
  const [feedbackError, setFeedbackError] = React.useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = React.useState<string | null>(null);
  const addInputRef = React.useRef<HTMLInputElement | null>(null);
  const replaceInputRef = React.useRef<HTMLInputElement | null>(null);

  const loadGallery = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productPublicId}/images`);
      if (res.ok) {
        const data = await res.json();
        if (typeof data === "object" && data !== null && "items" in data && Array.isArray(data.items)) {
          const validItems: ProductGalleryItem[] = [];
          for (const it of data.items) {
            if (typeof it === "object" && it !== null && "mediaId" in it && typeof it.mediaId === "string") {
              validItems.push({
                mediaId: it.mediaId,
                isPrimary: Boolean(it.isPrimary),
                displayOrder: Number(it.displayOrder ?? 0),
                width: Number(it.width ?? 0),
                height: Number(it.height ?? 0),
                byteSize: Number(it.byteSize ?? 0),
                mimeType: typeof it.mimeType === "string" ? it.mimeType : "image/webp",
                createdAt: typeof it.createdAt === "string" ? it.createdAt : "",
              });
            }
          }
          setItems(validItems);
        }
      }
    } catch {
      // ignore
    }
  }, [productPublicId]);

  React.useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

  const activeItem =
    items.find(it => it.mediaId === selectedMediaId) ||
    items.find(it => it.isPrimary) ||
    items[0] ||
    null;

  const handleUploadAdditional = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setFeedbackError("A imagem deve ter no máximo 5MB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFeedbackError("Formato não suportado. Use JPG, PNG ou WEBP.");
      return;
    }

    setActionPending(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const res = await fetch(`/api/products/${productPublicId}/images`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) {
        let errMsg = "Não foi possível adicionar a imagem à galeria.";
        try {
          const errData = await res.json();
          if (
            typeof errData === "object" &&
            errData !== null &&
            "error" in errData &&
            typeof errData.error === "string"
          ) {
            errMsg = errData.error;
          }
        } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (typeof data === "object" && data !== null && "mediaId" in data && typeof data.mediaId === "string") {
        setSelectedMediaId(data.mediaId);
      }
      setTimestamp(Date.now());
      await loadGallery();
      onImagesChanged?.();
      setFeedbackSuccess("Imagem adicionada à galeria com sucesso.");
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : "Erro ao enviar imagem.");
    } finally {
      setActionPending(false);
      if (addInputRef.current) addInputRef.current.value = "";
    }
  };

  const handleReplacePrimary = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setFeedbackError("A imagem deve ter no máximo 5MB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFeedbackError("Formato não suportado. Use JPG, PNG ou WEBP.");
      return;
    }

    setActionPending(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const res = await fetch(`/api/products/${productPublicId}/image`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) {
        let errMsg = "Não foi possível salvar a imagem principal.";
        try {
          const errData = await res.json();
          if (
            typeof errData === "object" &&
            errData !== null &&
            "error" in errData &&
            typeof errData.error === "string"
          ) {
            errMsg = errData.error;
          }
        } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (typeof data === "object" && data !== null && "mediaId" in data && typeof data.mediaId === "string") {
        setSelectedMediaId(data.mediaId);
      }
      setTimestamp(Date.now());
      await loadGallery();
      onImagesChanged?.();
      setFeedbackSuccess("Foto principal atualizada com sucesso.");
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : "Erro ao alterar foto principal.");
    } finally {
      setActionPending(false);
      if (replaceInputRef.current) replaceInputRef.current.value = "";
    }
  };

  const handleSetPrimary = async () => {
    if (!activeItem || activeItem.isPrimary) return;

    setActionPending(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const res = await fetch(`/api/products/${productPublicId}/images/${activeItem.mediaId}/primary`, {
        method: "PUT",
      });
      if (!res.ok) {
        let errMsg = "Não foi possível definir como foto principal.";
        try {
          const errData = await res.json();
          if (
            typeof errData === "object" &&
            errData !== null &&
            "error" in errData &&
            typeof errData.error === "string"
          ) {
            errMsg = errData.error;
          }
        } catch {}
        throw new Error(errMsg);
      }
      setTimestamp(Date.now());
      await loadGallery();
      onImagesChanged?.();
      setFeedbackSuccess("Foto principal atualizada com sucesso.");
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : "Erro ao definir foto principal.");
    } finally {
      setActionPending(false);
    }
  };

  const handleDeleteActive = async () => {
    if (!activeItem) return;

    const isPrimary = activeItem.isPrimary;
    const confirmText = isPrimary
      ? "Deseja realmente remover a foto principal? Se houver outras fotos na galeria, a próxima se tornará a foto principal."
      : "Deseja realmente remover esta imagem da galeria?";

    if (!window.confirm(confirmText)) return;

    setActionPending(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const res = await fetch(`/api/products/${productPublicId}/images/${activeItem.mediaId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        let errMsg = "Não foi possível remover a imagem.";
        try {
          const errData = await res.json();
          if (
            typeof errData === "object" &&
            errData !== null &&
            "error" in errData &&
            typeof errData.error === "string"
          ) {
            errMsg = errData.error;
          }
        } catch {}
        throw new Error(errMsg);
      }
      setSelectedMediaId(null);
      setTimestamp(Date.now());
      await loadGallery();
      onImagesChanged?.();
      setFeedbackSuccess("Imagem removida com sucesso.");
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : "Erro ao remover imagem.");
    } finally {
      setActionPending(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
      data-testid="product-images-section"
    >
      <div className="flex items-center justify-between border-b pb-3">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-slate-500" />
          Imagens do Produto
        </h2>
        <span className="text-xs text-slate-500 font-medium">
          {items.length === 0
            ? "Nenhuma imagem cadastrada"
            : items.length === 1
            ? "1 imagem cadastrada"
            : `${items.length} imagens na galeria`}
        </span>
      </div>

      {feedbackSuccess && (
        <p className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800" role="status">
          {feedbackSuccess}
        </p>
      )}

      {feedbackError && (
        <p className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-800" role="alert">
          {feedbackError}
        </p>
      )}

      {/* ÁREA PRINCIPAL DA GALERIA */}
      <div className="space-y-4">
        {/* GRANDE VISUALIZADOR DA FOTO SELECIONADA */}
        <div className="relative w-full max-w-2xl mx-auto aspect-[16/10] sm:aspect-[16/9] rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center group shadow-inner">
          {activeItem ? (
            <>
              <img
                src={`/api/products/${productPublicId}/images/${activeItem.mediaId}?v=${timestamp}`}
                alt={`${productName} — Imagem`}
                className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.02] cursor-pointer"
                onClick={() => setZoomOpen(true)}
                data-testid="main-product-image"
              />
              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                className="absolute bottom-3 right-3 p-2 rounded-xl bg-slate-900/70 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-slate-900 shadow-md"
                title="Ampliar imagem"
                data-testid="zoom-product-image-btn"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              {activeItem.isPrimary && (
                <div
                  className="absolute top-3 left-3 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm flex items-center gap-1.5"
                  data-testid="badge-primary-image"
                >
                  <span>★ Foto Principal</span>
                </div>
              )}
            </>
          ) : hasImage ? (
            <>
              <img
                src={`/api/products/${productPublicId}/image?v=${timestamp}`}
                alt={`${productName} — Imagem Principal`}
                className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.02] cursor-pointer"
                onClick={() => setZoomOpen(true)}
                onError={() => setHasImage(false)}
                data-testid="main-product-image"
              />
              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                className="absolute bottom-3 right-3 p-2 rounded-xl bg-slate-900/70 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-slate-900 shadow-md"
                title="Ampliar imagem"
                data-testid="zoom-product-image-btn"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <div
                className="absolute top-3 left-3 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm flex items-center gap-1.5"
                data-testid="badge-primary-image"
              >
                <span>★ Foto Principal</span>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-400 p-6 text-center">
              <ImageIcon className="h-14 w-14 stroke-1 mb-2 text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">Nenhuma imagem cadastrada</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                Adicione fotos do produto para enriquecer o catálogo e facilitar as vendas.
              </p>
            </div>
          )}
        </div>

        {/* BARRA DE AÇÕES PARA A IMAGEM SELECIONADA */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex items-center gap-2">
            {canWrite && (
              <>
                <input
                  type="file"
                  ref={addInputRef}
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleUploadAdditional}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-medium"
                  onClick={() => addInputRef.current?.click()}
                  disabled={actionPending}
                  data-testid="upload-product-image-btn"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Adicionar foto
                </Button>

                {activeItem && activeItem.isPrimary && (
                  <>
                    <input
                      type="file"
                      ref={replaceInputRef}
                      className="hidden"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleReplacePrimary}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs font-medium"
                      onClick={() => replaceInputRef.current?.click()}
                      disabled={actionPending}
                      data-testid="replace-primary-image-btn"
                      title="Substituir foto principal por um novo arquivo"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1" />
                      Substituir foto principal
                    </Button>
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeItem && canWrite && !activeItem.isPrimary && (
              <Button
                size="sm"
                variant="default"
                className="h-8 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleSetPrimary}
                disabled={actionPending}
                data-testid="btn-set-primary-media"
              >
                Definir como principal
              </Button>
            )}

            {activeItem && canWrite && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={handleDeleteActive}
                disabled={actionPending}
                title="Remover imagem selecionada"
                data-testid="btn-delete-media"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Remover imagem
              </Button>
            )}
          </div>
        </div>

        {/* FAIXA DE MINIATURAS (THUMBNAILS STRIP) */}
        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Galeria de Imagens
            </span>
            <span className="text-[11px] text-slate-400">
              Clique em uma miniatura para visualizá-la ou gerenciá-la
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5" data-testid="gallery-thumbnails-strip">
            {items.length > 0 ? (
              items.map((it, idx) => {
                const isSelected = activeItem?.mediaId === it.mediaId;
                return (
                  <button
                    key={it.mediaId}
                    type="button"
                    onClick={() => setSelectedMediaId(it.mediaId)}
                    className={`relative h-20 w-20 rounded-xl overflow-hidden border-2 transition-all group bg-slate-50 flex items-center justify-center ${
                      isSelected
                        ? "border-blue-600 ring-2 ring-blue-600/30 shadow-md scale-105"
                        : "border-slate-200 hover:border-slate-400 opacity-80 hover:opacity-100"
                    }`}
                    data-testid={it.isPrimary ? "gallery-thumb-primary" : `gallery-thumb-${it.mediaId}`}
                    title={it.isPrimary ? "Foto Principal" : `Foto ${idx + 1}`}
                  >
                    <img
                      src={`/api/products/${productPublicId}/images/${it.mediaId}?variant=thumbnail&v=${timestamp}`}
                      alt={`Miniatura ${idx + 1}`}
                      className="h-full w-full object-cover"
                    />
                    {it.isPrimary && (
                      <span className="absolute bottom-0 inset-x-0 bg-blue-600 text-[9px] font-bold text-white text-center py-0.5 uppercase tracking-wider">
                        Principal
                      </span>
                    )}
                  </button>
                );
              })
            ) : hasImage ? (
              <button
                type="button"
                className="relative h-20 w-20 rounded-xl overflow-hidden border-2 border-blue-600 ring-2 ring-blue-600/30 shadow-md scale-105 bg-slate-50 flex items-center justify-center"
                data-testid="gallery-thumb-primary"
                title="Foto Principal"
              >
                <img
                  src={`/api/products/${productPublicId}/image?variant=thumbnail&v=${timestamp}`}
                  alt="Miniatura Principal"
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-0 inset-x-0 bg-blue-600 text-[9px] font-bold text-white text-center py-0.5 uppercase tracking-wider">
                  Principal
                </span>
              </button>
            ) : null}

            {canWrite && (
              <button
                type="button"
                onClick={() => addInputRef.current?.click()}
                disabled={actionPending}
                className="h-20 w-20 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50/50 flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                data-testid="gallery-add-placeholder"
                title="Adicionar foto à galeria"
              >
                <Plus className="h-5 w-5 mb-0.5" />
                <span className="text-[10px] font-semibold">+ Adicionar</span>
              </button>
            )}
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900 space-y-1 mt-2">
            <div className="flex items-center gap-1.5 font-semibold text-blue-950">
              <Info className="h-3.5 w-3.5 text-blue-700 shrink-0" />
              <span>Galeria Multi-Imagem Ativa (Migration 0030)</span>
            </div>
            <p className="text-[11px] leading-relaxed text-blue-800">
              A migration 0030 resolveu a restrição de unicidade anterior (P1_GALLERY_SCHEMA_GAP=YES). Agora o catálogo suporta múltiplos arquivos por produto com ordenação determinística e seleção canônica da foto principal.
            </p>
          </div>
        </div>
      </div>

      {/* Modal de Zoom / Lightbox */}
      {zoomOpen && activeItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-in fade-in"
          onClick={() => setZoomOpen(false)}
          data-testid="image-zoom-modal"
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl p-4 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{productName}</span>
                {activeItem.isPrimary && (
                  <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    ★ Principal
                  </span>
                )}
              </div>
              <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs font-semibold" onClick={() => setZoomOpen(false)}>
                ✕ Fechar
              </Button>
            </div>
            <div className="flex items-center justify-center p-4">
              <img
                src={`/api/products/${productPublicId}/images/${activeItem.mediaId}?v=${timestamp}`}
                alt={productName}
                className="max-h-[75vh] w-auto object-contain rounded-xl"
              />
            </div>
          </div>
        </div>
      )}
    </section>
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
  const [variantModalOpen, setVariantModalOpen] = React.useState(false);
  const [selectedVariant, setSelectedVariant] = React.useState<ProductVariantItem | null>(null);
  const [variantActionMessage, setVariantActionMessage] = React.useState<string | null>(null);
  const [variantActionError, setVariantActionError] = React.useState<string | null>(null);

  const utils = trpc.useUtils();

  const productQuery = trpc.erp.products.detail.useQuery({ publicId: productPublicId });

  const suppliersQuery = trpc.erp.productSuppliers.list.useQuery(
    { productPublicId },
    { enabled: currentTab === "suppliers" }
  );

  const historyQuery = trpc.erp.products.history.list.useQuery(
    { productPublicId, pageSize: 50 },
    { enabled: currentTab === "history" }
  );

  const setActiveMutation = trpc.erp.variants.setActive.useMutation();
  const deleteMutation = trpc.erp.variants.delete.useMutation();

  const actionRunningRef = React.useRef(false);
  const variantActionPending = setActiveMutation.isPending || deleteMutation.isPending;

  const handleAddVariant = () => {
    setSelectedVariant(null);
    setVariantActionMessage(null);
    setVariantActionError(null);
    setVariantModalOpen(true);
  };

  const handleEditVariant = (v: NonNullable<ProductDetail>["variants"][number]) => {
    setSelectedVariant(v);
    setVariantActionMessage(null);
    setVariantActionError(null);
    setVariantModalOpen(true);
  };

  const handleToggleVariantActive = async (v: NonNullable<ProductDetail>["variants"][number]) => {
    if (actionRunningRef.current || variantActionPending) return;
    actionRunningRef.current = true;
    try {
      setVariantActionError(null);
      await setActiveMutation.mutateAsync({
        publicId: v.publicId,
        active: !v.active,
      });
      await utils.erp.products.detail.invalidate({ publicId: productPublicId });
      setVariantActionMessage(v.active ? `Variante ${v.sku} inativada com sucesso.` : `Variante ${v.sku} ativada com sucesso.`);
    } catch (err) {
      setVariantActionError(err instanceof Error ? err.message : "Erro ao alterar status da variante.");
    } finally {
      actionRunningRef.current = false;
    }
  };

  const handleDeleteVariant = async (v: NonNullable<ProductDetail>["variants"][number]) => {
    if (actionRunningRef.current || variantActionPending) return;
    if (!window.confirm(`Deseja realmente excluir a variante ${v.sku}? Esta ação não pode ser desfeita.`)) {
      return;
    }
    actionRunningRef.current = true;
    try {
      setVariantActionError(null);
      await deleteMutation.mutateAsync({ publicId: v.publicId });
      await utils.erp.products.detail.invalidate({ publicId: productPublicId });
      setVariantActionMessage(`Variante ${v.sku} excluída com sucesso.`);
    } catch (err) {
      setVariantActionError(err instanceof Error ? err.message : "Erro ao excluir variante.");
    } finally {
      actionRunningRef.current = false;
    }
  };

  return (
    <>
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
        onAddVariant={handleAddVariant}
        onEditVariant={handleEditVariant}
        onToggleVariantActive={handleToggleVariantActive}
        onDeleteVariant={handleDeleteVariant}
        variantActionPending={variantActionPending}
        variantActionMessage={variantActionMessage}
        variantActionError={variantActionError}
        onImagesChanged={() => {
          void utils.erp.products.detail.invalidate({ publicId: productPublicId });
          void utils.erp.products.list.invalidate();
        }}
      />

      <ProductVariantDialog
        open={variantModalOpen}
        onOpenChange={setVariantModalOpen}
        productPublicId={productPublicId}
        variant={selectedVariant}
        onSuccess={() => {
          setVariantActionMessage(
            selectedVariant
              ? "Variante atualizada com sucesso."
              : "Variante cadastrada com sucesso."
          );
        }}
      />
    </>
  );
}
