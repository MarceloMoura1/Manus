import React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AlignLeft,
  Boxes,
  DollarSign,
  ImageIcon,
  Package,
  Plus,
  Tag,
  Trash2,
  TrendingUp,
  Upload,
} from "lucide-react";
import { sanitizeErrorMessage as baseSanitizeErrorMessage } from "./ProductDetailPanel";

export function sanitizeErrorMessage(message?: string | null): string {
  if (!message) return "Ocorreu um erro ao processar a requisição.";
  const extraPatterns = [
    /drizzle/i,
    /stack\s*trace/i,
    /[a-z]:\\/i,
    /\/(?:usr|home|var|tmp|etc|app|node_modules)\//i,
    /select[\s*(]/i,
    /insert[\s*(]/i,
    /update[\s*(]/i,
    /delete[\s*(]/i,
  ];
  for (const pattern of extraPatterns) {
    if (pattern.test(message)) {
      return "Não foi possível carregar os dados devido a uma falha interna. Tente novamente mais tarde.";
    }
  }
  return baseSanitizeErrorMessage(message);
}

export type ProductForm = {
  publicId?: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  categoryPublicId?: string | null;
  brandPublicId?: string | null;
  unit: "unit" | "kg" | "liter" | "meter";
  cost: string;
  sale: string;
  minimumStock: string;
  description: string;
};

export const emptyProduct: ProductForm = {
  name: "",
  sku: "",
  barcode: "",
  category: "",
  categoryPublicId: null,
  brandPublicId: null,
  unit: "unit",
  cost: "0,00",
  sale: "0,00",
  minimumStock: "0",
  description: "",
};

export const cents = (value: string): number => {
  if (!value || typeof value !== "string" || !value.trim()) return -1;
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : -1;
};

export function formatCategoryOptionLabel(cat: {
  depth: number;
  name: string;
  parentName?: string | null;
}): string {
  if (cat.depth === 0) return cat.name;
  return `${cat.parentName ? `${cat.parentName} > ` : ""}${cat.name}`;
}

export function prepareProductCommand(form: ProductForm) {
  return {
    name: form.name,
    sku: form.sku,
    barcode: form.barcode.trim() || undefined,
    description: form.description.trim() || undefined,
    category: form.category.trim() || undefined,
    categoryPublicId: form.categoryPublicId ? form.categoryPublicId : null,
    brandPublicId: form.brandPublicId ? form.brandPublicId : null,
    unit: form.unit,
    costPriceCents: cents(form.cost),
    salePriceCents: cents(form.sale),
    minimumStock: form.minimumStock,
  };
}

export type CategoryOptionItem = {
  publicId: string;
  name: string;
  depth: number;
  parentName?: string | null;
};

export type BrandOptionItem = {
  publicId: string;
  name: string;
};

export type ProductFormDialogViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ProductForm | null;
  setForm: React.Dispatch<React.SetStateAction<ProductForm | null>>;
  onSubmit: (event: React.FormEvent) => void;
  pending: boolean;
  errorMessage?: string | null;
  photoPreview: string | null;
  removePhoto: boolean;
  onPhotoSelect: (file: File) => void;
  onPhotoRemove: () => void;
  categories: CategoryOptionItem[];
  categoriesLoading?: boolean;
  categoriesError?: string | null;
  brands: BrandOptionItem[];
  brandsLoading?: boolean;
  brandsError?: string | null;
  onOpenNewCategory?: () => void;
  onOpenNewBrand?: () => void;
};

function FormField({
  id,
  label,
  value,
  onChange,
  required,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  required?: boolean;
  className?: string;
}) {
  return (
    <label htmlFor={id} className={`block text-xs font-semibold text-slate-700 dark:text-slate-300 ${className ?? ""}`}>
      {label}
      {required && <span className="ml-1 text-rose-500">*</span>}
      <Input
        id={id}
        data-testid={id}
        className="mt-1 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500"
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}

export type ProductFormContentProps = {
  form: ProductForm;
  setForm: React.Dispatch<React.SetStateAction<ProductForm | null>>;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
  pending: boolean;
  errorMessage?: string | null;
  photoPreview?: string | null;
  removePhoto?: boolean;
  onPhotoSelect?: (file: File) => void;
  onPhotoRemove?: () => void;
  categories: CategoryOptionItem[];
  categoriesLoading?: boolean;
  categoriesError?: string | null;
  brands: BrandOptionItem[];
  brandsLoading?: boolean;
  brandsError?: string | null;
  onOpenNewCategory?: () => void;
  onOpenNewBrand?: () => void;
};

export function ProductFormContent({
  form,
  setForm,
  onSubmit,
  onCancel,
  pending,
  errorMessage,
  photoPreview,
  removePhoto,
  onPhotoSelect,
  onPhotoRemove,
  categories,
  categoriesLoading,
  categoriesError,
  brands,
  brandsLoading,
  brandsError,
  onOpenNewCategory,
  onOpenNewBrand,
}: ProductFormContentProps) {
  const hasLegacyCategory = Boolean(form.category && !form.categoryPublicId);

  const isSelectedCategoryInList = form.categoryPublicId
    ? categories.some(c => c.publicId === form.categoryPublicId)
    : true;
  const isSelectedBrandInList = form.brandPublicId
    ? brands.some(b => b.publicId === form.brandPublicId)
    : true;

  // Cálculo da Margem em tempo real
  const parsePrice = (val: string): number => {
    if (!val || typeof val !== "string") return 0;
    const num = Number(val.trim().replace(/\./g, "").replace(",", "."));
    return Number.isFinite(num) && num >= 0 ? num : 0;
  };
  const costNum = parsePrice(form.cost);
  const saleNum = parsePrice(form.sale);
  const profitNum = saleNum - costNum;
  const marginPercentNum = costNum > 0 ? ((profitNum / costNum) * 100).toFixed(1) : (saleNum > 0 ? "100.0" : "0.0");

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Indicador de Modo (Editar vs Novo) para acessibilidade e testes */}
      <div className="sr-only" aria-live="polite">
        <h2>{form.publicId ? "Editar produto" : "Novo produto"}</h2>
      </div>

      {/* BLOCO 1: Foto e Identificação */}
      <div className="space-y-3 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          <Package className="h-4 w-4" />
          <span>Bloco 1: Foto e Identificação</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Box de Preview e Seleção de Foto */}
          <div className="sm:col-span-1">
            <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Foto principal
            </span>
            <div className="mt-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3 text-center">
              {photoPreview && !removePhoto ? (
                <div className="relative group">
                  <img
                    src={photoPreview}
                    alt="Prévia da foto do produto"
                    className="h-24 w-24 rounded-lg object-cover shadow-xs"
                  />
                  {onPhotoRemove && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={onPhotoRemove}
                      title="Remover foto"
                      className="absolute -top-2 -right-2 rounded-full bg-rose-600 text-white p-1 shadow-md hover:bg-rose-700 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400">
                  <ImageIcon className="h-8 w-8" />
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
                <label
                  aria-disabled={pending}
                  className={`inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-xs ${
                    pending
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5 text-blue-500" />
                  {photoPreview && !removePhoto ? "Trocar" : "Upload"}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={pending}
                    onChange={event => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      event.currentTarget.value = "";
                      if (file && onPhotoSelect) onPhotoSelect(file);
                    }}
                  />
                </label>
                {photoPreview && !removePhoto && onPhotoRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={onPhotoRemove}
                    className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Remover
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Dados Principais: Nome, SKU, Código de barras */}
          <div className="sm:col-span-2 space-y-3">
            <FormField
              id="product-name-input"
              label="Nome do produto"
              value={form.name}
              onChange={name => setForm({ ...form, name })}
              required
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                id="product-sku-input"
                label="SKU (Identificador único)"
                value={form.sku}
                onChange={sku => setForm({ ...form, sku })}
                required
              />

              <FormField
                id="product-barcode-input"
                label="Código de barras (EAN/GTIN)"
                value={form.barcode}
                onChange={barcode => setForm({ ...form, barcode })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* BLOCO 2: Categorização e Unidade */}
      <div className="space-y-3 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          <Tag className="h-4 w-4" />
          <span>Bloco 2: Categorização e Unidade</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {/* Categoria */}
          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="product-category-select"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Categoria
              </label>
              {onOpenNewCategory && (
                <button
                  type="button"
                  onClick={onOpenNewCategory}
                  disabled={pending}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                  data-testid="btn-new-category"
                >
                  + Nova categoria
                </button>
              )}
            </div>
            <select
              id="product-category-select"
              data-testid="product-category-select"
              aria-label="Categoria"
              aria-describedby={
                hasLegacyCategory
                  ? "legacy-category-notice"
                  : categoriesError
                  ? "category-error-hint"
                  : undefined
              }
              disabled={pending || categoriesLoading || Boolean(categoriesError)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs text-slate-900 dark:text-slate-100 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              value={form.categoryPublicId || ""}
              onChange={e => {
                const val = e.target.value;
                if (val === "__NONE__") {
                  setForm({ ...form, categoryPublicId: null, category: "" });
                } else if (!val) {
                  if (hasLegacyCategory) {
                    setForm({ ...form, categoryPublicId: null });
                  } else {
                    setForm({ ...form, categoryPublicId: null, category: "" });
                  }
                } else {
                  const cat = categories.find(c => c.publicId === val);
                  setForm({
                    ...form,
                    categoryPublicId: val,
                    category: cat ? cat.name : form.category,
                  });
                }
              }}
            >
              {categoriesLoading ? (
                <option value="" disabled>
                  Carregando categorias...
                </option>
              ) : hasLegacyCategory ? (
                <>
                  <option value="">
                    Manter categoria legada: &quot;{form.category}&quot;
                  </option>
                  <option value="__NONE__">Sem categoria</option>
                </>
              ) : (
                <option value="">Sem categoria</option>
              )}

              {categories.map(cat => (
                <option key={cat.publicId} value={cat.publicId}>
                  {formatCategoryOptionLabel(cat)}
                </option>
              ))}

              {!isSelectedCategoryInList && form.categoryPublicId && (
                <option value={form.categoryPublicId}>
                  {form.category || "Categoria selecionada"}
                </option>
              )}
            </select>

            {hasLegacyCategory && (
              <p
                id="legacy-category-notice"
                data-testid="legacy-category-notice"
                className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:border-amber-900/60 dark:text-amber-300"
              >
                Categoria legada atual: &quot;{form.category}&quot;. Selecione uma categoria relacional para atualizar.
              </p>
            )}

            {categoriesError && (
              <p
                id="category-error-hint"
                data-testid="categories-error-message"
                className="mt-1 text-[11px] text-red-600 dark:text-red-400"
              >
                Não foi possível carregar as categorias. {sanitizeErrorMessage(categoriesError)}
              </p>
            )}
          </div>

          {/* Marca */}
          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="product-brand-select"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Marca
              </label>
              {onOpenNewBrand && (
                <button
                  type="button"
                  onClick={onOpenNewBrand}
                  disabled={pending}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                  data-testid="btn-new-brand"
                >
                  + Nova marca
                </button>
              )}
            </div>
            <select
              id="product-brand-select"
              data-testid="product-brand-select"
              aria-label="Marca"
              aria-describedby={brandsError ? "brand-error-hint" : undefined}
              disabled={pending || brandsLoading || Boolean(brandsError)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs text-slate-900 dark:text-slate-100 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              value={form.brandPublicId || ""}
              onChange={e => {
                const val = e.target.value;
                setForm({
                  ...form,
                  brandPublicId: val || null,
                });
              }}
            >
              {brandsLoading ? (
                <option value="" disabled>
                  Carregando marcas...
                </option>
              ) : (
                <option value="">Sem marca</option>
              )}

              {brands.map(brand => (
                <option key={brand.publicId} value={brand.publicId}>
                  {brand.name}
                </option>
              ))}

              {!isSelectedBrandInList && form.brandPublicId && (
                <option value={form.brandPublicId}>Marca selecionada</option>
              )}
            </select>

            {brandsError && (
              <p
                id="brand-error-hint"
                data-testid="brands-error-message"
                className="mt-1 text-[11px] text-red-600 dark:text-red-400"
              >
                Não foi possível carregar as marcas. {sanitizeErrorMessage(brandsError)}
              </p>
            )}
          </div>

          {/* Unidade */}
          <div>
            <label
              htmlFor="product-unit-select"
              className="text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Unidade de medida
            </label>
            <select
              id="product-unit-select"
              data-testid="product-unit-select"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs text-slate-900 dark:text-slate-100 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={form.unit}
              onChange={e =>
                setForm({ ...form, unit: e.target.value as ProductForm["unit"] })
              }
            >
              <option value="unit">Unidade (UN)</option>
              <option value="kg">Quilograma (KG)</option>
              <option value="liter">Litro (L)</option>
              <option value="meter">Metro (M)</option>
            </select>
          </div>
        </div>
      </div>

      {/* BLOCO 3: Precificação e Margem */}
      <div className="space-y-3 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          <DollarSign className="h-4 w-4" />
          <span>Bloco 3: Precificação e Margem</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField
            id="product-cost-input"
            label="Preço de custo (R$)"
            value={form.cost}
            onChange={cost => setForm({ ...form, cost })}
          />

          <FormField
            id="product-sale-input"
            label="Preço de venda (R$)"
            value={form.sale}
            onChange={sale => setForm({ ...form, sale })}
          />

          {/* Card de Margem de Lucro em tempo real */}
          <div className="flex flex-col justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 p-2 px-3">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> Margem de lucro
            </span>
            <div className="mt-1 flex items-baseline justify-between gap-1">
              <span
                className={`text-base font-extrabold ${
                  profitNum >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {costNum > 0 || saleNum > 0 ? `${marginPercentNum}%` : "0,0%"}
              </span>
              {(costNum > 0 || saleNum > 0) && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate">
                  Lucro: {profitNum.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BLOCO 4: Controle de Estoque */}
      <div className="space-y-3 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          <Boxes className="h-4 w-4" />
          <span>Bloco 4: Controle de Estoque</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="product-minimum-stock-input"
            label="Estoque mínimo para alerta"
            value={form.minimumStock}
            onChange={minimumStock => setForm({ ...form, minimumStock })}
          />
          <div className="flex items-center text-xs text-slate-500 dark:text-slate-400 pt-5 leading-relaxed">
            Quando o saldo em estoque for menor ou igual a esse valor, o produto receberá a tag de estoque baixo.
          </div>
        </div>
      </div>

      {/* BLOCO 5: Descrição e Detalhes */}
      <div className="space-y-3 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          <AlignLeft className="h-4 w-4" />
          <span>Bloco 5: Descrição e Detalhes</span>
        </div>

        <div>
          <label
            htmlFor="product-description-input"
            className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Descrição complementar
          </label>
          <textarea
            id="product-description-input"
            data-testid="product-description-input"
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-2.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Informações técnicas, composição, garantias..."
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </div>

      {/* Erros sanitizados de submissão */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-900/60 p-3 text-xs text-rose-700 dark:text-rose-300"
          data-testid="product-form-error"
        >
          {sanitizeErrorMessage(errorMessage)}
        </div>
      )}

      {/* Rodapé de Ações */}
      <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending}
          className="dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={pending}
          data-testid="submit-product-form"
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-[0_0_15px_rgba(37,99,235,0.35)] px-6"
        >
          {pending ? "Salvando…" : "Salvar produto"}
        </Button>
      </div>
    </form>
  );
}

export function ProductFormDialogView({
  open,
  onOpenChange,
  form,
  setForm,
  onSubmit,
  pending,
  errorMessage,
  photoPreview,
  removePhoto,
  onPhotoSelect,
  onPhotoRemove,
  categories,
  categoriesLoading,
  categoriesError,
  brands,
  brandsLoading,
  brandsError,
  onOpenNewCategory,
  onOpenNewBrand,
}: ProductFormDialogViewProps) {
  if (!form) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 sm:max-w-3xl rounded-2xl shadow-2xl p-6">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <DialogTitle className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {form.publicId ? "Editar produto" : "Novo produto"}
          </DialogTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Preencha as informações organizadas nos blocos abaixo para gerenciar o catálogo.
          </p>
        </DialogHeader>
        <ProductFormContent
          form={form}
          setForm={setForm}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          pending={pending}
          errorMessage={errorMessage}
          photoPreview={photoPreview}
          removePhoto={removePhoto}
          onPhotoSelect={onPhotoSelect}
          onPhotoRemove={onPhotoRemove}
          categories={categories}
          categoriesLoading={categoriesLoading}
          categoriesError={categoriesError}
          brands={brands}
          brandsLoading={brandsLoading}
          brandsError={brandsError}
          onOpenNewCategory={onOpenNewCategory}
          onOpenNewBrand={onOpenNewBrand}
        />
      </DialogContent>
    </Dialog>
  );
}

export function CategoryCreateModal({
  open,
  onOpenChange,
  categories,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryOptionItem[];
  onCreated: (cat: { publicId: string; name: string }) => void;
}) {
  const [name, setName] = React.useState("");
  const [parentPublicId, setParentPublicId] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const createCategory = trpc.erp.categories.create.useMutation();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setName("");
      setParentPublicId("");
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("O nome da categoria deve ter no mínimo 2 caracteres.");
      return;
    }
    if (trimmed.length > 120) {
      setError("O nome da categoria deve ter no máximo 120 caracteres.");
      return;
    }
    setError(null);
    try {
      const res = await createCategory.mutateAsync({
        name: trimmed,
        parentPublicId: parentPublicId ? parentPublicId : null,
      });
      onCreated({ publicId: res.publicId, name: res.name });
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a categoria.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 sm:max-w-md rounded-2xl shadow-xl" data-testid="category-create-dialog">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Nova Categoria</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="new-category-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Nome da categoria
            <Input
              id="new-category-name"
              data-testid="new-category-name-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Calçados Esportivos"
              className="mt-1 h-9 rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
              required
              minLength={2}
              maxLength={120}
              autoFocus
            />
          </label>
          <label htmlFor="new-category-parent" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Categoria pai (opcional)
            <select
              id="new-category-parent"
              data-testid="new-category-parent-select"
              value={parentPublicId}
              onChange={e => setParentPublicId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs text-slate-900 dark:text-slate-100 shadow-xs"
            >
              <option value="">Nenhuma (categoria raiz)</option>
              {categories.map(cat => (
                <option key={cat.publicId} value={cat.publicId}>
                  {formatCategoryOptionLabel(cat)}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400" data-testid="category-create-error">
              {sanitizeErrorMessage(error)}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createCategory.isPending}
              className="dark:border-slate-700 dark:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createCategory.isPending || name.trim().length < 2}
              data-testid="submit-new-category"
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold"
            >
              {createCategory.isPending ? "Criando…" : "Salvar categoria"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BrandCreateModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (brand: { publicId: string; name: string }) => void;
}) {
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const createBrand = trpc.erp.brands.create.useMutation();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setName("");
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("O nome da marca deve ter no mínimo 2 caracteres.");
      return;
    }
    if (trimmed.length > 120) {
      setError("O nome da marca deve ter no máximo 120 caracteres.");
      return;
    }
    setError(null);
    try {
      const res = await createBrand.mutateAsync({
        name: trimmed,
      });
      onCreated({ publicId: res.publicId, name: res.name });
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a marca.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 sm:max-w-md rounded-2xl shadow-xl" data-testid="brand-create-dialog">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Nova Marca</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="new-brand-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Nome da marca
            <Input
              id="new-brand-name"
              data-testid="new-brand-name-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Nike, Logitech"
              className="mt-1 h-9 rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
              required
              minLength={2}
              maxLength={120}
              autoFocus
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400" data-testid="brand-create-error">
              {sanitizeErrorMessage(error)}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createBrand.isPending}
              className="dark:border-slate-700 dark:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createBrand.isPending || name.trim().length < 2}
              data-testid="submit-new-brand"
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold"
            >
              {createBrand.isPending ? "Criando…" : "Salvar marca"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type ProductFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ProductForm | null;
  setForm: React.Dispatch<React.SetStateAction<ProductForm | null>>;
  onSubmit: (event: React.FormEvent) => void;
  pending: boolean;
  errorMessage?: string | null;
  photoPreview: string | null;
  removePhoto: boolean;
  onPhotoSelect: (file: File) => void;
  onPhotoRemove: () => void;
  categoriesOverride?: {
    items?: CategoryOptionItem[];
    isLoading?: boolean;
    error?: { message?: string } | null;
  };
  brandsOverride?: {
    items?: BrandOptionItem[];
    isLoading?: boolean;
    error?: { message?: string } | null;
  };
};

export function ProductFormDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSubmit,
  pending,
  errorMessage,
  photoPreview,
  removePhoto,
  onPhotoSelect,
  onPhotoRemove,
  categoriesOverride,
  brandsOverride,
}: ProductFormDialogProps) {
  const [categoryModalOpen, setCategoryModalOpen] = React.useState(false);
  const [brandModalOpen, setBrandModalOpen] = React.useState(false);

  const categoriesQuery = trpc.erp.categories.list.useQuery(
    { pageSize: 100 },
    { staleTime: 30_000, enabled: open && !categoriesOverride }
  );
  const brandsQuery = trpc.erp.brands.list.useQuery(
    { pageSize: 100 },
    { staleTime: 30_000, enabled: open && !brandsOverride }
  );

  const categories =
    categoriesOverride?.items ?? categoriesQuery.data?.items ?? [];
  const categoriesLoading =
    categoriesOverride?.isLoading ?? categoriesQuery.isLoading;
  const categoriesError =
    categoriesOverride?.error?.message ?? categoriesQuery.error?.message;

  const brands = brandsOverride?.items ?? brandsQuery.data?.items ?? [];
  const brandsLoading = brandsOverride?.isLoading ?? brandsQuery.isLoading;
  const brandsError =
    brandsOverride?.error?.message ?? brandsQuery.error?.message;

  return (
    <>
      <ProductFormDialogView
        open={open}
        onOpenChange={onOpenChange}
        form={form}
        setForm={setForm}
        onSubmit={onSubmit}
        pending={pending}
        errorMessage={errorMessage}
        photoPreview={photoPreview}
        removePhoto={removePhoto}
        onPhotoSelect={onPhotoSelect}
        onPhotoRemove={onPhotoRemove}
        categories={categories}
        categoriesLoading={categoriesLoading}
        categoriesError={categoriesError}
        brands={brands}
        brandsLoading={brandsLoading}
        brandsError={brandsError}
        onOpenNewCategory={() => setCategoryModalOpen(true)}
        onOpenNewBrand={() => setBrandModalOpen(true)}
      />
      <CategoryCreateModal
        open={categoryModalOpen}
        onOpenChange={setCategoryModalOpen}
        categories={categories}
        onCreated={cat => {
          setForm(curr =>
            curr
              ? { ...curr, categoryPublicId: cat.publicId, category: cat.name }
              : null
          );
          void categoriesQuery.refetch();
        }}
      />
      <BrandCreateModal
        open={brandModalOpen}
        onOpenChange={setBrandModalOpen}
        onCreated={brand => {
          setForm(curr =>
            curr ? { ...curr, brandPublicId: brand.publicId } : null
          );
          void brandsQuery.refetch();
        }}
      />
    </>
  );
}
