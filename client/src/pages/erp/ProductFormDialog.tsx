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
import { ImageIcon, Trash2, Upload } from "lucide-react";
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  required?: boolean;
}) {
  return (
    <label htmlFor={id} className="text-sm font-medium text-slate-700">
      {label}
      <Input
        id={id}
        className="mt-1"
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
  // Detecta se o produto tem categoria textual legada sem relação formal
  const hasLegacyCategory = Boolean(form.category && !form.categoryPublicId);

  // Garante que se a categoria ou marca selecionada não estiver na lista carregada,
  // ela ainda seja renderizada como opção para evitar seleção fantasma
  const isSelectedCategoryInList = form.categoryPublicId
    ? categories.some(c => c.publicId === form.categoryPublicId)
    : true;
  const isSelectedBrandInList = form.brandPublicId
    ? brands.some(b => b.publicId === form.brandPublicId)
    : true;

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      {/* Indicador de Modo (Editar vs Novo) para acessibilidade e testes */}
      <div className="sr-only" aria-live="polite">
        <h2>{form.publicId ? "Editar produto" : "Novo produto"}</h2>
      </div>

      {/* Foto Principal */}
      <div className="sm:col-span-2">
        <span className="text-sm font-medium text-slate-700">
          Foto principal
        </span>
        <div className="mt-2 flex items-center gap-4 rounded-xl border border-slate-200 p-3">
          {photoPreview && !removePhoto ? (
            <img
              src={photoPreview}
              alt="Prévia da foto do produto"
              className="h-24 w-24 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-slate-100">
              <ImageIcon className="h-8 w-8 text-slate-400" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <label
              aria-disabled={pending}
              className={`inline-flex items-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium ${
                pending
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:bg-slate-50"
              }`}
            >
              <Upload className="mr-2 h-4 w-4" />
              {photoPreview ? "Substituir" : "Selecionar"}
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
            {photoPreview && onPhotoRemove && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={onPhotoRemove}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remover
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Nome */}
      <FormField
        id="product-name-input"
        label="Nome"
        value={form.name}
        onChange={name => setForm({ ...form, name })}
        required
      />

      {/* SKU */}
      <FormField
        id="product-sku-input"
        label="SKU"
        value={form.sku}
        onChange={sku => setForm({ ...form, sku })}
        required
      />

      {/* Código de barras (preserva zeros à esquerda e formato textual estrito) */}
      <FormField
        id="product-barcode-input"
        label="Código de barras"
        value={form.barcode}
        onChange={barcode => setForm({ ...form, barcode })}
      />

      {/* Unidade */}
      <label
        htmlFor="product-unit-select"
        className="text-sm font-medium text-slate-700"
      >
        Unidade
        <select
          id="product-unit-select"
          data-testid="product-unit-select"
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-sm"
          value={form.unit}
          onChange={e =>
            setForm({ ...form, unit: e.target.value as ProductForm["unit"] })
          }
        >
          <option value="unit">Unidade</option>
          <option value="kg">Quilograma</option>
          <option value="liter">Litro</option>
          <option value="meter">Metro</option>
        </select>
      </label>

      {/* Seletor Relacional de Categoria */}
      <div className="sm:col-span-1">
        <div className="flex items-center justify-between">
          <label
            htmlFor="product-category-select"
            className="text-sm font-medium text-slate-700"
          >
            Categoria
          </label>
          {onOpenNewCategory && (
            <button
              type="button"
              onClick={onOpenNewCategory}
              disabled={pending}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-50"
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
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
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
            className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
          >
            Categoria legada atual: &quot;{form.category}&quot;. Selecione uma categoria relacional para atualizar ou mantenha para preservar.
          </p>
        )}

        {categoriesError && (
          <p
            id="category-error-hint"
            data-testid="categories-error-message"
            className="mt-1 text-xs text-red-600"
          >
            Não foi possível carregar as categorias. {sanitizeErrorMessage(categoriesError)}
          </p>
        )}
      </div>

      {/* Seletor Relacional de Marca */}
      <div className="sm:col-span-1">
        <div className="flex items-center justify-between">
          <label
            htmlFor="product-brand-select"
            className="text-sm font-medium text-slate-700"
          >
            Marca
          </label>
          {onOpenNewBrand && (
            <button
              type="button"
              onClick={onOpenNewBrand}
              disabled={pending}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-50"
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
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
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
            className="mt-1 text-xs text-red-600"
          >
            Não foi possível carregar as marcas. {sanitizeErrorMessage(brandsError)}
          </p>
        )}
      </div>

      {/* Preço de Custo */}
      <FormField
        id="product-cost-input"
        label="Preço de custo"
        value={form.cost}
        onChange={cost => setForm({ ...form, cost })}
      />

      {/* Preço de Venda */}
      <FormField
        id="product-sale-input"
        label="Preço de venda"
        value={form.sale}
        onChange={sale => setForm({ ...form, sale })}
      />

      {/* Estoque Mínimo */}
      <FormField
        id="product-minimum-stock-input"
        label="Estoque mínimo"
        value={form.minimumStock}
        onChange={minimumStock => setForm({ ...form, minimumStock })}
      />

      {/* Descrição */}
      <label
        htmlFor="product-description-input"
        className="text-sm font-medium text-slate-700 sm:col-span-2"
      >
        Descrição
        <textarea
          id="product-description-input"
          className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
        />
      </label>

      {/* Erros sanitizados de submissão */}
      {errorMessage && (
        <p
          role="alert"
          className="text-sm text-red-600 sm:col-span-2"
          data-testid="product-form-error"
        >
          {sanitizeErrorMessage(errorMessage)}
        </p>
      )}

      {/* Botões de Ação */}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={pending}
          data-testid="submit-product-form"
        >
          {pending ? "Salvando…" : "Salvar"}
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
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {form.publicId ? "Editar produto" : "Novo produto"}
          </DialogTitle>
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
      <DialogContent className="bg-white sm:max-w-md" data-testid="category-create-dialog">
        <DialogHeader>
          <DialogTitle>Nova Categoria</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="new-category-name" className="block text-sm font-medium text-slate-700">
            Nome da categoria
            <Input
              id="new-category-name"
              data-testid="new-category-name-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Calçados Esportivos"
              className="mt-1"
              required
              minLength={2}
              maxLength={120}
              autoFocus
            />
          </label>
          <label htmlFor="new-category-parent" className="block text-sm font-medium text-slate-700">
            Categoria pai (opcional)
            <select
              id="new-category-parent"
              data-testid="new-category-parent-select"
              value={parentPublicId}
              onChange={e => setParentPublicId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-sm"
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
            <p role="alert" className="text-sm text-red-600" data-testid="category-create-error">
              {sanitizeErrorMessage(error)}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createCategory.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createCategory.isPending || name.trim().length < 2}
              data-testid="submit-new-category"
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
      <DialogContent className="bg-white sm:max-w-md" data-testid="brand-create-dialog">
        <DialogHeader>
          <DialogTitle>Nova Marca</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="new-brand-name" className="block text-sm font-medium text-slate-700">
            Nome da marca
            <Input
              id="new-brand-name"
              data-testid="new-brand-name-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Nike, Logitech"
              className="mt-1"
              required
              minLength={2}
              maxLength={120}
              autoFocus
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-600" data-testid="brand-create-error">
              {sanitizeErrorMessage(error)}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createBrand.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createBrand.isPending || name.trim().length < 2}
              data-testid="submit-new-brand"
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

  // Busca lista de categorias e marcas reais pelo tRPC
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
