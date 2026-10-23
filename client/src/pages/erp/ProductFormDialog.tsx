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
  ImageIcon,
  Trash2,
  TrendingUp,
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
  inputClassName,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  required?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <label htmlFor={id} className={`mb-1.5 block text-xs font-medium text-slate-300 ${className ?? ""}`}>
      {label}
      {required && <span className="ml-1 text-rose-500">*</span>}
      <Input
        id={id}
        data-testid={id}
        className={`h-10 rounded-xl border border-slate-700/70 bg-slate-900/80 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 ${inputClassName ?? ""}`}
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4 text-sm">
      {/* Indicador de Modo (Editar vs Novo) para acessibilidade e testes */}
      <div className="sr-only" aria-live="polite">
        <h2>{form.publicId ? "Editar produto" : "Novo produto"}</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      {/* Identificação */}
      <section className="grid gap-4 md:col-start-2 md:row-start-1" aria-label="Identificação do produto">
        <FormField
          id="product-name-input"
          label="Nome do produto"
          value={form.name}
          onChange={name => setForm({ ...form, name })}
          required
          inputClassName="h-11 px-3.5"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="product-sku-input"
            label="SKU"
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
      </section>

      {/* Upload da foto */}
      <section className="md:col-start-1 md:row-start-1 md:row-span-2 md:h-44 md:w-44" aria-label="Foto do produto">
        <div
          className={`relative flex min-h-[140px] h-full flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-700/80 bg-slate-900/40 p-3 text-center transition-all ${
            pending ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-blue-500/60"
          }`}
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0] ?? null;
            if (!pending && file && onPhotoSelect) onPhotoSelect(file);
          }}
        >
          {photoPreview && !removePhoto ? (
            <img
              src={photoPreview}
              alt="Prévia da foto do produto"
              className="h-full w-full object-cover"
            />
          ) : (
            <>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-900/80">
                <ImageIcon className="h-5 w-5 text-blue-400" />
              </div>
              <span className="mt-2 text-xs font-medium text-slate-200">Adicionar foto</span>
              <span className="mt-1 text-xs text-slate-400">Clique ou arraste</span>
            </>
          )}
          <label
            aria-disabled={pending}
            className="absolute inset-0 cursor-pointer"
            aria-label={photoPreview && !removePhoto ? "Trocar foto do produto" : "Adicionar foto do produto"}
          >
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
            <button
              type="button"
              disabled={pending}
              onClick={event => {
                event.stopPropagation();
                onPhotoRemove();
              }}
              title="Remover foto"
              className="absolute top-3 right-3 z-10 rounded-lg border border-slate-700 bg-slate-950/90 p-2 text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </section>

      {/* Categoria, marca, unidade e estoque mínimo */}
      <section className="grid gap-4 sm:grid-cols-2 md:col-start-2 md:row-start-2" aria-label="Classificação e medida">
        {/* Categoria */}
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="product-category-select" className="text-xs font-medium text-slate-300">
              Categoria
            </label>
            {onOpenNewCategory && (
              <button
                type="button"
                onClick={onOpenNewCategory}
                disabled={pending}
                className="cursor-pointer text-xs font-medium text-primary hover:underline disabled:opacity-50"
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
            className="mt-1.5 h-10 w-full rounded-xl border border-slate-700/70 bg-slate-900/80 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-50"
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
              <option value="" disabled>Carregando categorias...</option>
            ) : hasLegacyCategory ? (
              <>
                <option value="">Manter categoria legada: &quot;{form.category}&quot;</option>
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
              <option value={form.categoryPublicId}>{form.category || "Categoria selecionada"}</option>
            )}
          </select>
          {hasLegacyCategory && (
            <p id="legacy-category-notice" data-testid="legacy-category-notice" className="mt-0.5 text-sm text-amber-600 dark:text-amber-400">
              Categoria legada atual: &quot;{form.category}&quot;.
            </p>
          )}
          {categoriesError && (
            <p id="category-error-hint" data-testid="categories-error-message" className="mt-0.5 text-sm text-red-600 dark:text-red-400">
              Não foi possível carregar as categorias. {sanitizeErrorMessage(categoriesError)}
            </p>
          )}
        </div>

        {/* Marca */}
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="product-brand-select" className="text-xs font-medium text-slate-300">
              Marca
            </label>
            {onOpenNewBrand && (
              <button
                type="button"
                onClick={onOpenNewBrand}
                disabled={pending}
                className="cursor-pointer text-xs font-medium text-primary hover:underline disabled:opacity-50"
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
            className="mt-1.5 h-10 w-full rounded-xl border border-slate-700/70 bg-slate-900/80 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-50"
            value={form.brandPublicId || ""}
            onChange={e => {
              const val = e.target.value;
              setForm({ ...form, brandPublicId: val || null });
            }}
          >
            {brandsLoading ? (
              <option value="" disabled>Carregando marcas...</option>
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
            <p id="brand-error-hint" data-testid="brands-error-message" className="mt-0.5 text-sm text-red-600 dark:text-red-400">
              Não foi possível carregar as marcas. {sanitizeErrorMessage(brandsError)}
            </p>
          )}
        </div>

      </section>

      {/* Preços e margem */}
      <section className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 md:col-span-2 md:col-start-1 md:row-start-3" aria-label="Financeiro e estoque">
        <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

        <div className="grid grid-cols-2 gap-2">
          <FormField
            id="product-minimum-stock-input"
            label="Estoque mínimo"
            value={form.minimumStock}
            onChange={minimumStock => setForm({ ...form, minimumStock })}
          />
          <label htmlFor="product-unit-select" className="mb-1.5 block text-xs font-medium text-slate-300">
            Unidade
            <select
              id="product-unit-select"
              data-testid="product-unit-select"
              className="mt-1.5 h-10 w-full rounded-xl border border-slate-700/70 bg-slate-900/80 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              value={form.unit}
              onChange={e => setForm({ ...form, unit: e.target.value as ProductForm["unit"] })}
            >
              <option value="unit">Unidade (UN)</option>
              <option value="kg">Quilograma (KG)</option>
              <option value="liter">Litro (L)</option>
              <option value="meter">Metro (M)</option>
            </select>
          </label>
        </div>
        {/* Margem calculada */}
        <div className="flex flex-col justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-2.5 text-center">
          <span className="flex items-center justify-center gap-1 text-[10px] font-bold tracking-wider text-emerald-500 uppercase">
            <TrendingUp className="h-3 w-3" /> Margem calculada
          </span>
          <div className="mt-1 flex flex-col items-center gap-0.5">
            <span className={`text-sm font-bold ${profitNum >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {costNum > 0 || saleNum > 0 ? `${marginPercentNum}%` : "0,0%"}
            </span>
            {(costNum > 0 || saleNum > 0) && (
              <span className="truncate text-[11px] font-medium text-slate-400">
                Lucro: {profitNum.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </span>
            )}
          </div>
        </div>
        </div>
      </section>

      {/* Descrição */}
      <section className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 md:col-span-2 md:col-start-1 md:row-start-4" aria-label="Descrição do produto">
        <label htmlFor="product-description-input" className="mb-1.5 block text-xs font-medium text-slate-300">
          Descrição do produto
        </label>
        <textarea
          id="product-description-input"
          data-testid="product-description-input"
          rows={2}
          className="w-full resize-y rounded-xl border border-slate-700/70 bg-slate-900/80 p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
          placeholder="Informações técnicas, composição, garantias..."
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
        />
      </section>
      </div>

      {/* Erros sanitizados de submissão */}
      {errorMessage && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-900/60 p-2 text-sm text-rose-700 dark:text-rose-300" data-testid="product-form-error">
          {sanitizeErrorMessage(errorMessage)}
        </div>
      )}

      {/* Rodapé com botões Cancelar e Salvar fixos na base */}
      <div className="mt-4 flex items-center justify-end gap-3 border-t border-slate-800/80 pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={pending}
          className="rounded-xl border border-slate-700 px-4 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={pending}
          data-testid="submit-product-form"
          className="h-10 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-600/25 transition-all hover:bg-blue-500"
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
      <DialogContent
        overlayClassName="!bg-black/70 backdrop-blur-sm"
        className="z-50 w-full max-w-4xl rounded-2xl border border-slate-800/80 bg-[#070d19] p-7 text-slate-100 shadow-2xl sm:!max-w-4xl"
      >
        <DialogHeader className="mb-6 border-b border-slate-800/80 pb-4 pr-10">
          <DialogTitle className="text-xl font-semibold tracking-tight text-slate-100">
            {form.publicId ? "Editar produto" : "Novo produto"}
          </DialogTitle>
          <p className="mt-1 text-xs text-slate-400">
            Cadastre as informações comerciais, fiscais e estoque do produto.
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
