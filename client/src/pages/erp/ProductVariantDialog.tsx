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

export const cents = (value: string): number => {
  if (!value || typeof value !== "string" || !value.trim()) return -1;
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : -1;
};

export type AttributeTypeOption = {
  publicId: string;
  name: string;
  active?: boolean;
};

export type AttributeValueOption = {
  publicId: string;
  typePublicId: string;
  typeName?: string;
  name: string;
  active?: boolean;
};

export type ProductVariantForm = {
  publicId?: string;
  sku: string;
  barcode: string;
  name: string;
  cost: string;
  sale: string;
  selectedAttributeValuePublicIds: Record<string, string>; // typePublicId -> valuePublicId
};

export const emptyVariantForm: ProductVariantForm = {
  sku: "",
  barcode: "",
  name: "",
  cost: "0,00",
  sale: "",
  selectedAttributeValuePublicIds: {},
};

export type ProductVariantItem = {
  publicId: string;
  productPublicId: string;
  sku: string;
  barcode?: string | null;
  name?: string | null;
  costPriceCents: number;
  salePriceCents?: number | null;
  effectivePriceCents?: number;
  active: boolean;
  attributes?: Array<{
    typePublicId: string;
    typeName: string;
    valuePublicId: string;
    valueName: string;
  }>;
};

export function prepareVariantPayload(
  form: ProductVariantForm,
  productPublicId: string
) {
  const barcodeTrimmed = form.barcode.trim();
  const nameTrimmed = form.name.trim();
  const skuTrimmed = form.sku.trim();

  const costCents = form.cost.trim() === "" ? 0 : cents(form.cost);
  const saleCents = form.sale.trim() === "" ? null : cents(form.sale);

  const attributeValuePublicIds = Object.values(
    form.selectedAttributeValuePublicIds
  ).filter(id => Boolean(id && typeof id === "string" && id.trim()));

  return {
    productPublicId,
    sku: skuTrimmed,
    barcode: barcodeTrimmed || null,
    name: nameTrimmed || null,
    costPriceCents: costCents,
    salePriceCents: saleCents,
    attributeValuePublicIds,
  };
}

export type ProductVariantFormContentProps = {
  form: ProductVariantForm;
  setForm: React.Dispatch<React.SetStateAction<ProductVariantForm>>;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
  pending: boolean;
  errorMessage?: string | null;
  attributeTypes: AttributeTypeOption[];
  attributeValues: AttributeValueOption[];
  typesLoading?: boolean;
  valuesLoading?: boolean;
};

export function ProductVariantFormContent({
  form,
  setForm,
  onSubmit,
  onCancel,
  pending,
  errorMessage,
  attributeTypes,
  attributeValues,
  typesLoading,
  valuesLoading,
}: ProductVariantFormContentProps) {
  // Mapeamento dos valores por typePublicId
  const valuesByType = React.useMemo(() => {
    const map = new Map<string, AttributeValueOption[]>();
    for (const val of attributeValues) {
      const list = map.get(val.typePublicId) || [];
      list.push(val);
      map.set(val.typePublicId, list);
    }
    return map;
  }, [attributeValues]);

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" data-testid="product-variant-form">
      {/* Indicador de Modo (Editar vs Novo) para acessibilidade */}
      <div className="sr-only" aria-live="polite">
        <h2>{form.publicId ? "Editar variante" : "Nova variante"}</h2>
      </div>

      {/* SKU da Variante */}
      <div className="sm:col-span-1">
        <label
          htmlFor="variant-sku-input"
          className="text-sm font-medium text-slate-700"
        >
          SKU da variante <span className="text-red-500">*</span>
          <Input
            id="variant-sku-input"
            data-testid="variant-sku-input"
            className="mt-1 font-mono"
            placeholder="Ex: CAM-AZUL-G"
            value={form.sku}
            onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
            disabled={pending}
            required
          />
        </label>
      </div>

      {/* Código de barras (EAN/GTIN com preservação estrita de string) */}
      <div className="sm:col-span-1">
        <label
          htmlFor="variant-barcode-input"
          className="text-sm font-medium text-slate-700"
        >
          Código de barras
          <Input
            id="variant-barcode-input"
            data-testid="variant-barcode-input"
            className="mt-1 font-mono"
            placeholder="Ex: 7891234567890"
            value={form.barcode}
            onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
            disabled={pending}
          />
        </label>
      </div>

      {/* Nome / Descrição da Variação */}
      <div className="sm:col-span-2">
        <label
          htmlFor="variant-name-input"
          className="text-sm font-medium text-slate-700"
        >
          Nome / Variação
          <Input
            id="variant-name-input"
            data-testid="variant-name-input"
            className="mt-1"
            placeholder="Ex: Azul / Tamanho G"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            disabled={pending}
          />
        </label>
      </div>

      {/* Preço de Custo */}
      <div className="sm:col-span-1">
        <label
          htmlFor="variant-cost-input"
          className="text-sm font-medium text-slate-700"
        >
          Preço de custo (R$)
          <Input
            id="variant-cost-input"
            data-testid="variant-cost-input"
            className="mt-1 font-mono"
            placeholder="0,00"
            value={form.cost}
            onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
            disabled={pending}
          />
        </label>
      </div>

      {/* Preço de Venda */}
      <div className="sm:col-span-1">
        <label
          htmlFor="variant-sale-input"
          className="text-sm font-medium text-slate-700"
        >
          Preço de venda específico (R$)
          <Input
            id="variant-sale-input"
            data-testid="variant-sale-input"
            className="mt-1 font-mono"
            placeholder="Padrão do produto"
            value={form.sale}
            onChange={e => setForm(f => ({ ...f, sale: e.target.value }))}
            disabled={pending}
          />
        </label>
        <span className="text-[11px] text-slate-500">
          Deixe vazio para usar o preço do produto pai.
        </span>
      </div>

      {/* Seção de Atributos da Variante */}
      <div className="sm:col-span-2 border-t pt-3">
        <h3 className="text-sm font-semibold text-slate-800">
          Atributos da variante
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Selecione a combinação de atributos que define esta variação (ex: Cor, Tamanho).
        </p>

        {typesLoading || valuesLoading ? (
          <p className="text-xs text-slate-400">Carregando atributos disponíveis...</p>
        ) : attributeTypes.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            Nenhum tipo de atributo cadastrado no catálogo. A variante pode ser cadastrada sem atributos específicos.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {attributeTypes.map(type => {
              const values = valuesByType.get(type.publicId) || [];
              const selectedValueId =
                form.selectedAttributeValuePublicIds[type.publicId] || "";

              return (
                <div key={type.publicId} className="space-y-1">
                  <label
                    htmlFor={`attr-select-${type.publicId}`}
                    className="text-xs font-medium text-slate-600"
                  >
                    {type.name}
                  </label>
                  <select
                    id={`attr-select-${type.publicId}`}
                    data-testid={`attr-select-${type.publicId}`}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                    disabled={pending}
                    value={selectedValueId}
                    onChange={e => {
                      const val = e.target.value;
                      setForm(f => ({
                        ...f,
                        selectedAttributeValuePublicIds: {
                          ...f.selectedAttributeValuePublicIds,
                          [type.publicId]: val,
                        },
                      }));
                    }}
                  >
                    <option value="">Não selecionado</option>
                    {values.map(v => (
                      <option key={v.publicId} value={v.publicId}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Erro Sanitizado */}
      {errorMessage && (
        <p
          role="alert"
          className="text-sm text-red-600 sm:col-span-2"
          data-testid="variant-form-error"
        >
          {sanitizeErrorMessage(errorMessage)}
        </p>
      )}

      {/* Ações */}
      <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
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
          data-testid="submit-variant-form"
        >
          {pending ? "Salvando…" : "Salvar variante"}
        </Button>
      </div>
    </form>
  );
}

export type ProductVariantDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productPublicId: string;
  variant: ProductVariantItem | null;
  onSuccess?: () => void;
  typesOverride?: { items?: AttributeTypeOption[]; isLoading?: boolean };
  valuesOverride?: { items?: AttributeValueOption[]; isLoading?: boolean };
  onSubmitOverride?: (data: ReturnType<typeof prepareVariantPayload>) => Promise<void>;
};

export function ProductVariantDialog({
  open,
  onOpenChange,
  productPublicId,
  variant,
  onSuccess,
  typesOverride,
  valuesOverride,
  onSubmitOverride,
}: ProductVariantDialogProps) {
  const utils = trpc.useUtils();

  const [form, setForm] = React.useState<ProductVariantForm>(emptyVariantForm);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const submittingRef = React.useRef(false);

  // Queries de atributos disponíveis
  const typesQuery = trpc.erp.attributes.types.list.useQuery(
    { pageSize: 100 },
    { staleTime: 30_000, enabled: open && !typesOverride }
  );

  const valuesQuery = trpc.erp.attributes.values.list.useQuery(
    { pageSize: 100 },
    { staleTime: 30_000, enabled: open && !valuesOverride }
  );

  const attributeTypes =
    typesOverride?.items ?? typesQuery.data?.items ?? [];
  const attributeValues =
    valuesOverride?.items ?? valuesQuery.data?.items ?? [];
  const typesLoading = typesOverride?.isLoading ?? typesQuery.isLoading;
  const valuesLoading = valuesOverride?.isLoading ?? valuesQuery.isLoading;

  // Sincroniza formulário ao abrir ou trocar de variante/produto
  React.useEffect(() => {
    if (!open) {
      setForm(emptyVariantForm);
      setErrorMessage(null);
      return;
    }

    if (variant) {
      const selectedAttrs: Record<string, string> = {};
      variant.attributes?.forEach(a => {
        selectedAttrs[a.typePublicId] = a.valuePublicId;
      });

      setForm({
        publicId: variant.publicId,
        sku: variant.sku,
        barcode: variant.barcode ?? "",
        name: variant.name ?? "",
        cost: (variant.costPriceCents / 100).toFixed(2).replace(".", ","),
        sale:
          variant.salePriceCents !== null && variant.salePriceCents !== undefined
            ? (variant.salePriceCents / 100).toFixed(2).replace(".", ",")
            : "",
        selectedAttributeValuePublicIds: selectedAttrs,
      });
    } else {
      setForm(emptyVariantForm);
    }
    setErrorMessage(null);
  }, [open, variant, productPublicId]);

  // Mutações tRPC
  const createMutation = trpc.erp.variants.create.useMutation();
  const updateMutation = trpc.erp.variants.update.useMutation();
  const setAttributesMutation = trpc.erp.variants.setAttributes.useMutation();

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    setAttributesMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || pending) return;
    submittingRef.current = true;
    setErrorMessage(null);

    const payload = prepareVariantPayload(form, productPublicId);

    if (!payload.sku) {
      submittingRef.current = false;
      setErrorMessage("SKU é obrigatório.");
      return;
    }

    if (payload.costPriceCents < 0) {
      submittingRef.current = false;
      setErrorMessage("Preço de custo inválido.");
      return;
    }

    if (payload.salePriceCents !== null && payload.salePriceCents < 0) {
      submittingRef.current = false;
      setErrorMessage("Preço de venda inválido.");
      return;
    }

    try {
      if (onSubmitOverride) {
        await onSubmitOverride(payload);
      } else if (variant?.publicId) {
        // Atualiza campos da variante
        await updateMutation.mutateAsync({
          publicId: variant.publicId,
          sku: payload.sku,
          barcode: payload.barcode,
          name: payload.name,
          costPriceCents: payload.costPriceCents,
          salePriceCents: payload.salePriceCents,
        });

        try {
          // Atualiza atributos da variante
          await setAttributesMutation.mutateAsync({
            publicId: variant.publicId,
            attributeValuePublicIds: payload.attributeValuePublicIds,
          });
        } finally {
          // Garante que qualquer alteração persistida no backend seja refletida no painel
          await utils.erp.products.detail.invalidate({ publicId: productPublicId });
        }
      } else {
        // Cria nova variante
        await createMutation.mutateAsync({
          productPublicId,
          sku: payload.sku,
          barcode: payload.barcode,
          name: payload.name,
          costPriceCents: payload.costPriceCents,
          salePriceCents: payload.salePriceCents,
          attributeValuePublicIds: payload.attributeValuePublicIds,
          active: true,
        });

        await utils.erp.products.detail.invalidate({ publicId: productPublicId });
      }

      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Não foi possível salvar a variante.";
      setErrorMessage(sanitizeErrorMessage(msg));
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {variant?.publicId ? "Editar variante" : "Nova variante"}
          </DialogTitle>
        </DialogHeader>
        <ProductVariantFormContent
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          pending={pending}
          errorMessage={errorMessage}
          attributeTypes={attributeTypes}
          attributeValues={attributeValues}
          typesLoading={typesLoading}
          valuesLoading={valuesLoading}
        />
      </DialogContent>
    </Dialog>
  );
}
