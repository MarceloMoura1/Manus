import React from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  History,
  PackageCheck,
  PackageX,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/conversationDateTime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErpPageHeader } from "@/components/erp/ErpPageHeader";
import { Pagination } from "@/components/erp/Pagination";

export type StockMovementType =
  | "initial"
  | "manual_in"
  | "manual_out"
  | "adjustment_in"
  | "adjustment_out"
  | "purchase_in"
  | "sale_out"
  | "reversal";

type ManualStockMovementType = "manual_in" | "manual_out" | "adjustment_in" | "adjustment_out";
type StockFilterType = "all" | StockMovementType;
type StockUnit = "unit" | "kg" | "liter" | "meter";

export type StockProductView = {
  publicId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: string;
  minimumStock: string;
};

export type StockMovementView = {
  publicId: string;
  productPublicId: string;
  productName: string;
  sku: string;
  unit?: string;
  type: string;
  direction: "in" | "out";
  quantity: string;
  previousBalance: string;
  resultingBalance: string;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  createdBy: string;
  responsibleDisplayName: string;
  createdAt: string | Date;
  reversed: boolean;
  reversalPublicId: string | null;
};

type StockForm = {
  productPublicId: string;
  type: ManualStockMovementType;
  quantity: string;
  reason: string;
  idempotencyKey: string;
};

type ReverseForm = {
  movement: StockMovementView;
  reason: string;
  idempotencyKey: string;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function stockSummaryValues(input: {
  availableProducts: number;
  lowProducts: number;
  emptyProducts: number;
  costValueCents: number;
}) {
  return {
    available: input.availableProducts,
    low: input.lowProducts,
    empty: input.emptyProducts,
    value: money.format(input.costValueCents / 100),
  };
}

const movementLabels: Record<StockMovementType, string> = {
  initial: "Saldo inicial",
  manual_in: "Entrada manual",
  manual_out: "Saída manual",
  adjustment_in: "Ajuste de entrada",
  adjustment_out: "Ajuste de saída",
  purchase_in: "Recebimento de compra",
  sale_out: "Baixa de venda",
  reversal: "Movimentação de reversão",
};

const referenceLabels: Record<string, string> = {
  manual: "Lançamento manual",
  purchase: "Compra",
  sale: "Venda",
  purchase_reversal: "Cancelamento de compra",
  sale_reversal: "Cancelamento de venda",
  movement: "Reversão de movimentação",
};

const unitLabels: Record<StockUnit, string> = {
  unit: "Unidade",
  kg: "Quilograma",
  liter: "Litro",
  meter: "Metro",
};

const unitShortLabels: Record<StockUnit, string> = {
  unit: "un",
  kg: "kg",
  liter: "L",
  meter: "m",
};

export function movementTypeLabel(type: string): string {
  return movementLabels[type as StockMovementType] ?? "Movimentação de estoque";
}

export function movementReferenceLabel(type: string | null): string {
  if (!type) return "Sem referência externa";
  return referenceLabels[type] ?? "Origem registrada";
}

export function stockUnitLabel(unit: string): string {
  return unitLabels[unit as StockUnit] ?? unit;
}

export function stockUnitShortLabel(unit: string | undefined): string {
  if (!unit) return "";
  return unitShortLabels[unit as StockUnit] ?? unit;
}

export function formatStockQuantity(value: string | number): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("pt-BR", { maximumFractionDigits: 3 })
    : "—";
}

function parseQuantityMillis(value: string): bigint | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
}

function millisToQuantity(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 1_000n}.${String(absolute % 1_000n).padStart(3, "0")}`;
}

export function normalizeStockQuantityInput(value: string): string {
  return value.trim().replace(",", ".");
}

export function stockAttentionLevel(quantity: string, minimumStock: string): "empty" | "low" | "normal" {
  const current = parseQuantityMillis(quantity) ?? 0n;
  const minimum = parseQuantityMillis(minimumStock) ?? 0n;
  if (current === 0n) return "empty";
  if (current > 0n && current <= minimum) return "low";
  return "normal";
}

export function stockShortageToMinimum(quantity: string, minimumStock: string): string {
  const current = parseQuantityMillis(quantity) ?? 0n;
  const minimum = parseQuantityMillis(minimumStock) ?? 0n;
  return millisToQuantity(minimum > current ? minimum - current : 0n);
}

export function prioritizeStockAttention(
  emptyProducts: StockProductView[],
  lowProducts: StockProductView[],
): StockProductView[] {
  return [
    ...emptyProducts.filter(product => stockAttentionLevel(product.quantity, product.minimumStock) === "empty"),
    ...lowProducts.filter(product => stockAttentionLevel(product.quantity, product.minimumStock) === "low"),
  ];
}

export function canReverseStockMovement(movement: Pick<StockMovementView, "type" | "reversed">): boolean {
  return !movement.reversed && !["reversal", "purchase_in", "sale_out"].includes(movement.type);
}

export function movementStatus(movement: Pick<StockMovementView, "type" | "reversed">) {
  if (movement.reversed) return { label: "Revertida", tone: "amber" as const };
  if (movement.type === "reversal") return { label: "Reversão confirmada", tone: "blue" as const };
  return { label: "Confirmada", tone: "emerald" as const };
}

export function signedMovementQuantity(movement: Pick<StockMovementView, "direction" | "quantity" | "unit">): string {
  const unit = stockUnitShortLabel(movement.unit);
  return `${movement.direction === "in" ? "+" : "−"}${formatStockQuantity(movement.quantity)}${unit ? ` ${unit}` : ""}`;
}

export function projectStockBalancePreview(
  currentValue: string,
  quantityValue: string,
  type: ManualStockMovementType,
): { current: string; change: string; resulting: string | null; insufficient: boolean } | null {
  const current = parseQuantityMillis(currentValue);
  const quantity = parseQuantityMillis(quantityValue);
  if (current === null || quantity === null || quantity <= 0n) return null;
  const output = type === "manual_out" || type === "adjustment_out";
  const resulting = output ? current - quantity : current + quantity;
  return {
    current: millisToQuantity(current),
    change: `${output ? "−" : "+"}${millisToQuantity(quantity)}`,
    resulting: resulting < 0n ? null : millisToQuantity(resulting),
    insufficient: resulting < 0n,
  };
}

function movementTone(type: string, direction: "in" | "out") {
  if (type === "reversal") return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200";
  return direction === "in"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
    : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200";
}

function StockState({ title, description, retry }: { title: string; description?: string; retry?: () => void }) {
  return (
    <div role="status" className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center dark:border-slate-800 dark:bg-slate-950">
      <ClipboardList aria-hidden="true" className="mx-auto h-7 w-7 text-slate-400" />
      <p className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {retry && <Button className="mt-4" variant="outline" onClick={retry}>Tentar novamente</Button>}
    </div>
  );
}

function StockStatusBadge({ movement }: { movement: Pick<StockMovementView, "type" | "reversed"> }) {
  const status = movementStatus(movement);
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    blue: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  } as const;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[status.tone]}`}>{status.label}</span>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{children}</span>;
}

function StockSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 ${props.className ?? ""}`}
    />
  );
}

function AttentionItem({ product }: { product: StockProductView }) {
  const level = stockAttentionLevel(product.quantity, product.minimumStock);
  const empty = level === "empty";
  const unit = stockUnitShortLabel(product.unit);
  const shortage = stockShortageToMinimum(product.quantity, product.minimumStock);
  return (
    <article data-testid={`stock-attention-${level}`} className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 last:border-b-0 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-semibold text-slate-950 dark:text-slate-50">{product.name}</h3>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${empty ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"}`}>
            {empty ? "Sem estoque" : "Estoque baixo"}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">SKU {product.sku} · Mínimo {formatStockQuantity(product.minimumStock)} {unit}</p>
      </div>
      <div className="shrink-0 sm:text-right">
        <p className="text-lg font-bold text-slate-950 dark:text-slate-50">{formatStockQuantity(product.quantity)} {unit} <span className="text-sm font-medium text-slate-500">disponíveis</span></p>
        <p className={`mt-0.5 text-xs font-semibold ${empty ? "text-rose-700 dark:text-rose-300" : "text-amber-700 dark:text-amber-300"}`}>
          {empty
            ? Number(product.minimumStock) > 0 ? `Repor ao menos ${formatStockQuantity(product.minimumStock)} ${unit}` : "Produto sem saldo disponível"
            : Number(shortage) > 0 ? `Faltam ${formatStockQuantity(shortage)} ${unit} para o mínimo` : "Produto no limite mínimo"}
        </p>
      </div>
    </article>
  );
}

function MovementActions({ movement, canWrite, onDetail, onReverse }: { movement: StockMovementView; canWrite: boolean; onDetail: () => void; onReverse: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={onDetail}>Detalhes</Button>
      {canWrite && canReverseStockMovement(movement) && (
        <Button size="sm" variant="outline" className="text-amber-800 hover:text-amber-900 dark:text-amber-300" onClick={onReverse}>
          <RotateCcw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Reverter
        </Button>
      )}
    </div>
  );
}

export function StockPage() {
  const utils = trpc.useUtils();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState("");
  const [productFilter, setProductFilter] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<StockFilterType>("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [showPeriodFilters, setShowPeriodFilters] = React.useState(false);
  const [showMoreFilters, setShowMoreFilters] = React.useState(false);
  const [form, setForm] = React.useState<StockForm | null>(null);
  const [reverse, setReverse] = React.useState<ReverseForm | null>(null);
  const [detail, setDetail] = React.useState<StockMovementView | null>(null);
  const [message, setMessage] = React.useState("");

  const products = trpc.erp.products.list.useQuery({ search: "", active: true, stock: "all", sort: "name", direction: "asc", page: 1, pageSize: 100 });
  const availableProducts = trpc.erp.products.list.useQuery({ search: "", active: true, stock: "available", sort: "name", direction: "asc", page: 1, pageSize: 1 });
  const lowProducts = trpc.erp.products.list.useQuery({ search: "", active: true, stock: "low", sort: "stock", direction: "asc", page: 1, pageSize: 100 });
  const emptyProducts = trpc.erp.products.list.useQuery({ search: "", active: true, stock: "empty", sort: "name", direction: "asc", page: 1, pageSize: 100 });
  const summary = trpc.erp.summary.useQuery();
  const movements = trpc.erp.stock.list.useQuery({
    search,
    productPublicId: productFilter || undefined,
    type: typeFilter === "all" ? undefined : typeFilter,
    from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined,
    page,
    pageSize,
  });

  const move = trpc.erp.stock.move.useMutation({
    onSuccess: async () => {
      setForm(null);
      setMessage("Movimentação registrada com sucesso.");
      await utils.erp.invalidate();
    },
  });
  const reverseMutation = trpc.erp.stock.reverse.useMutation({
    onSuccess: async () => {
      setReverse(null);
      setMessage("Reversão registrada com sucesso.");
      await utils.erp.invalidate();
    },
  });

  const canWrite = products.data?.canWrite === true;
  const selectedProduct = products.data?.items.find(item => item.publicId === form?.productPublicId);
  const preview = form && selectedProduct
    ? projectStockBalancePreview(selectedProduct.quantity, form.quantity, form.type)
    : null;
  const emptyAttentionProducts = (emptyProducts.data?.items ?? []) as StockProductView[];
  const lowAttentionProducts = (lowProducts.data?.items ?? []) as StockProductView[];
  const attentionProducts = prioritizeStockAttention(emptyAttentionProducts, lowAttentionProducts);
  const attentionTotal = (emptyProducts.data?.total ?? 0) + (lowProducts.data?.total ?? 0);
  const filtersActive = Boolean(search || productFilter || typeFilter !== "all" || from || to);

  const openMovementForm = () => {
    setMessage("");
    setForm({ productPublicId: "", type: "manual_in", quantity: "", reason: "", idempotencyKey: crypto.randomUUID() });
  };

  const resetFilters = () => {
    setSearch("");
    setProductFilter("");
    setTypeFilter("all");
    setFrom("");
    setTo("");
    setPage(1);
  };

  const submitMovement = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || move.isPending || !preview || preview.insufficient || form.reason.trim().length < 3) return;
    move.mutate({ ...form, quantity: normalizeStockQuantityInput(form.quantity), reason: form.reason.trim() });
  };

  const submitReversal = (event: React.FormEvent) => {
    event.preventDefault();
    if (!reverse || reverseMutation.isPending || reverse.reason.trim().length < 3) return;
    reverseMutation.mutate({ movementPublicId: reverse.movement.publicId, reason: reverse.reason.trim(), idempotencyKey: reverse.idempotencyKey });
  };

  const startReversal = (movement: StockMovementView) => {
    if (!canReverseStockMovement(movement)) return;
    setReverse({ movement, reason: "", idempotencyKey: crypto.randomUUID() });
  };

  const movementItems = (movements.data?.items ?? []) as StockMovementView[];
  const metricLoading = summary.isLoading || availableProducts.isLoading || lowProducts.isLoading || emptyProducts.isLoading;
  const metricValues = stockSummaryValues({
    availableProducts: availableProducts.data?.total ?? 0,
    lowProducts: lowProducts.data?.total ?? 0,
    emptyProducts: emptyProducts.data?.total ?? 0,
    costValueCents: summary.data?.metrics.costValueCents ?? 0,
  });
  const metrics = [
    { key: "available", label: "Produtos em estoque", value: metricValues.available, note: "Produtos ativos com saldo disponível", icon: PackageCheck, tone: "blue" },
    { key: "low", label: "Estoque baixo", value: metricValues.low, note: "Acima de zero e no mínimo", icon: AlertTriangle, tone: "amber" },
    { key: "empty", label: "Sem estoque", value: metricValues.empty, note: "Produtos ativos com saldo zerado", icon: PackageX, tone: "rose" },
    { key: "value", label: "Valor em estoque", value: metricValues.value, note: "Baseado no custo atual cadastrado", icon: WalletCards, tone: "slate" },
  ] as const;

  return (
    <div className="space-y-6" data-testid="erp-stock-page">
      <ErpPageHeader
        title="Estoque"
        eyebrow="Operação"
        description="Acompanhe saldos, identifique produtos que precisam de reposição e consulte todas as movimentações."
        actions={canWrite && (
          <Button onClick={openMovementForm} className="shadow-sm">
            <Plus aria-hidden="true" className="mr-2 h-4 w-4" />Nova movimentação
          </Button>
        )}
      />

      <section data-testid="stock-overview-panel" aria-labelledby="stock-summary-heading" className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="grid lg:grid-cols-[1.15fr_1.85fr]">
          <div className="relative overflow-hidden bg-slate-950 p-6 text-white dark:bg-slate-900 sm:p-7">
            <div aria-hidden="true" className="absolute -right-14 -top-16 h-44 w-44 rounded-full bg-blue-500/20 blur-2xl" />
            <p className="relative text-xs font-bold uppercase tracking-[0.18em] text-blue-200">Visão geral</p>
            <h2 id="stock-summary-heading" className="relative mt-2 text-xl font-bold">Disponibilidade atual</h2>
            <div className="relative mt-7 flex items-end gap-3">
              <span className="text-5xl font-bold tracking-tight">{metricLoading ? "—" : metricValues.available}</span>
              <span className="pb-1 text-sm text-slate-300">produtos com saldo</span>
            </div>
            <p className="relative mt-3 max-w-sm text-sm leading-relaxed text-slate-300">Produtos ativos prontos para atender à operação neste momento.</p>
          </div>
          <div className="grid divide-y divide-slate-200 dark:divide-slate-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {metrics.slice(1).map(metric => {
              const Icon = metric.icon;
              const iconTone = metric.key === "low" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : metric.key === "empty" ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
              return (
                <div key={metric.key} data-testid={`stock-overview-${metric.key}`} className="flex min-h-36 flex-col justify-between p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{metric.label}</p><span className={`rounded-xl p-2 ${iconTone}`}><Icon aria-hidden="true" className="h-4 w-4" /></span></div>
                  <div><p className="mt-5 text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">{metricLoading ? "—" : metric.value}</p><p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{metric.note}</p></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section data-testid="stock-attention-columns" aria-labelledby="stock-attention-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Precisa de atenção</p>
            <h2 id="stock-attention-heading" className="mt-1 text-xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Prioridades de reposição</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Somente itens zerados ou que chegaram ao limite mínimo.</p>
          </div>
          {attentionTotal > 0 && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{attentionTotal} {attentionTotal === 1 ? "prioridade" : "prioridades"}</span>}
        </div>
        {emptyProducts.isLoading || lowProducts.isLoading ? (
          <div className="h-32 animate-pulse rounded-3xl bg-slate-200/70 dark:bg-slate-800" aria-label="Carregando produtos que precisam de atenção" />
        ) : attentionProducts.length === 0 ? (
          <div data-testid="stock-attention-empty" className="rounded-3xl border border-emerald-200 bg-emerald-50/60 px-6 py-10 text-center dark:border-emerald-900 dark:bg-emerald-950/25">
            <CheckCircle2 aria-hidden="true" className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-300" />
            <p className="mt-3 text-lg font-bold text-emerald-950 dark:text-emerald-100">Tudo certo com o estoque</p>
            <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-200/80">Nenhum produto está abaixo do nível mínimo neste momento.</p>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <div data-testid="stock-attention-empty-list" className="overflow-hidden rounded-3xl border border-rose-200 bg-white dark:border-rose-950 dark:bg-slate-950">
              <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50/70 px-4 py-3 dark:border-rose-950 dark:bg-rose-950/30"><div className="flex items-center gap-2"><PackageX aria-hidden="true" className="h-4 w-4 text-rose-600 dark:text-rose-300" /><h3 className="text-sm font-bold text-rose-950 dark:text-rose-100">Sem estoque</h3></div><span className="text-xs font-bold text-rose-700 dark:text-rose-300">{emptyProducts.data?.total ?? 0}</span></div>
              {emptyAttentionProducts.length ? emptyAttentionProducts.map(product => <AttentionItem key={product.publicId} product={product} />) : <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Nenhum produto com saldo zerado.</p>}
            </div>
            <div data-testid="stock-attention-low-list" className="overflow-hidden rounded-3xl border border-amber-200 bg-white dark:border-amber-950 dark:bg-slate-950">
              <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50/70 px-4 py-3 dark:border-amber-950 dark:bg-amber-950/30"><div className="flex items-center gap-2"><AlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-600 dark:text-amber-300" /><h3 className="text-sm font-bold text-amber-950 dark:text-amber-100">Estoque baixo</h3></div><span className="text-xs font-bold text-amber-700 dark:text-amber-300">{lowProducts.data?.total ?? 0}</span></div>
              {lowAttentionProducts.length ? lowAttentionProducts.map(product => <AttentionItem key={product.publicId} product={product} />) : <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Nenhum produto no limite mínimo.</p>}
            </div>
          </div>
        )}
      </section>

      {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</p>}

      <section aria-labelledby="stock-movements-heading" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">O que aconteceu</p>
            <h2 id="stock-movements-heading" className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-950 dark:text-slate-50"><History aria-hidden="true" className="h-5 w-5 text-blue-600 dark:text-blue-300" />Movimentações</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Entradas, saídas, ajustes e reversões registradas no estoque.</p>
          </div>
        </div>

        <div data-testid="stock-filter-toolbar" className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950" aria-label="Consulta de movimentações">
          <div className="flex flex-col gap-2 p-2 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Buscar produto ou SKU</span>
              <Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input aria-label="Buscar produto ou SKU" className="border-0 bg-slate-50 pl-9 shadow-none focus-visible:ring-2 dark:bg-slate-900" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar produto ou SKU" />
            </label>
            <StockSelect aria-label="Tipo de movimentação" className="lg:w-52" value={typeFilter} onChange={event => { setTypeFilter(event.target.value as StockFilterType); setPage(1); }}>
              <option value="all">Todos os tipos</option>
              {(Object.keys(movementLabels) as StockMovementType[]).map(type => <option key={type} value={type}>{movementLabels[type]}</option>)}
            </StockSelect>
            <Button type="button" variant={from || to ? "secondary" : "outline"} aria-expanded={showPeriodFilters} onClick={() => setShowPeriodFilters(value => !value)}>
              Período{from || to ? " ativo" : ""}
            </Button>
            <Button type="button" variant={productFilter ? "secondary" : "outline"} aria-expanded={showMoreFilters} onClick={() => setShowMoreFilters(value => !value)}>
              <SlidersHorizontal aria-hidden="true" className="mr-2 h-4 w-4" />Mais filtros
            </Button>
          </div>
          {(showPeriodFilters || showMoreFilters) && (
            <div data-testid="stock-filter-drawer" className="grid gap-3 border-t border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50 sm:grid-cols-2 lg:grid-cols-4">
              {showPeriodFilters && <><label><FieldLabel>Data inicial</FieldLabel><Input aria-label="Data inicial" type="date" className="dark:border-slate-700 dark:bg-slate-950" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label><label><FieldLabel>Data final</FieldLabel><Input aria-label="Data final" type="date" className="dark:border-slate-700 dark:bg-slate-950" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></label></>}
              {showMoreFilters && <><label><FieldLabel>Produto</FieldLabel><StockSelect aria-label="Produto" value={productFilter} onChange={event => { setProductFilter(event.target.value); setPage(1); }}><option value="">Todos os produtos</option>{products.data?.items.map(product => <option key={product.publicId} value={product.publicId}>{product.name}</option>)}</StockSelect></label><label><FieldLabel>Por página</FieldLabel><StockSelect aria-label="Movimentações por página" value={String(pageSize)} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="10">10 por página</option><option value="20">20 por página</option><option value="50">50 por página</option></StockSelect></label></>}
            </div>
          )}
          {filtersActive && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2.5 text-xs dark:border-slate-800">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Filtros ativos:</span>
              {search && <button type="button" onClick={() => { setSearch(""); setPage(1); }} className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-800 dark:text-slate-200">Busca: {search} ×</button>}
              {typeFilter !== "all" && <button type="button" onClick={() => { setTypeFilter("all"); setPage(1); }} className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-blue-950 dark:text-blue-200">{movementTypeLabel(typeFilter)} ×</button>}
              {productFilter && <button type="button" onClick={() => { setProductFilter(""); setPage(1); }} className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-800 dark:text-slate-200">Produto selecionado ×</button>}
              {(from || to) && <button type="button" onClick={() => { setFrom(""); setTo(""); setPage(1); }} className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-800 dark:text-slate-200">Período selecionado ×</button>}
              <button type="button" onClick={resetFilters} className="ml-auto font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300">Limpar tudo</button>
            </div>
          )}
        </div>

        {movements.isLoading ? (
          <StockState title="Carregando movimentações…" />
        ) : movements.error ? (
          <StockState title="Não foi possível carregar as movimentações." description={movements.error.message} retry={() => void movements.refetch()} />
        ) : movementItems.length === 0 ? (
          <StockState title={filtersActive ? "Nenhuma movimentação corresponde aos filtros." : "Nenhuma movimentação registrada."} description={filtersActive ? "Revise os filtros ou limpe a busca para ver todo o histórico." : "As entradas, saídas e ajustes aparecerão aqui."} />
        ) : (
          <div data-testid="stock-movement-ledger" className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
            {movementItems.map(item => {
              const DirectionIcon = item.direction === "in" ? ArrowUpRight : ArrowDownRight;
              return (
                <article key={item.publicId} className="grid gap-4 border-b border-slate-200 p-4 last:border-b-0 dark:border-slate-800 sm:p-5 xl:grid-cols-[130px_minmax(190px,1.15fr)_minmax(190px,1fr)_minmax(220px,1.25fr)_auto] xl:items-center">
                  <div className="flex items-center justify-between gap-3 xl:block"><p className="text-xs font-medium text-slate-500 dark:text-slate-400">{formatDateTime(item.createdAt)}</p><div className="mt-0 xl:mt-2"><StockStatusBadge movement={item} /></div></div>
                  <div className="min-w-0"><p className="truncate font-bold text-slate-950 dark:text-slate-50">{item.productName}</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">SKU {item.sku}</p><span className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${movementTone(item.type, item.direction)}`}><DirectionIcon aria-hidden="true" className="h-3.5 w-3.5" />{movementTypeLabel(item.type)}</span></div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-900"><p className="text-xl font-bold text-slate-950 dark:text-slate-50">{signedMovementQuantity(item)}</p><p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"><span>{formatStockQuantity(item.previousBalance)}</span><ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" /><span>{formatStockQuantity(item.resultingBalance)} {stockUnitShortLabel(item.unit)}</span></p></div>
                  <div className="min-w-0"><p className="line-clamp-2 text-sm text-slate-700 dark:text-slate-200">{item.reason}</p><p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{movementReferenceLabel(item.referenceType)} · {item.responsibleDisplayName}</p></div>
                  <MovementActions movement={item} canWrite={canWrite} onDetail={() => setDetail(item)} onReverse={() => startReversal(item)} />
                </article>
              );
            })}
          </div>
        )}
        {movements.data && <Pagination page={page} totalPages={movements.data.totalPages} onPage={setPage} />}
      </section>

      <Dialog open={Boolean(detail)} onOpenChange={open => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto dark:border-slate-800 dark:bg-slate-950">
          <DialogHeader><DialogTitle>Detalhes da movimentação</DialogTitle><DialogDescription>Informações registradas no histórico de estoque.</DialogDescription></DialogHeader>
          {detail && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900"><div><p className="font-bold text-slate-950 dark:text-slate-50">{detail.productName}</p><p className="mt-0.5 text-xs text-slate-500">SKU {detail.sku} · {stockUnitLabel(detail.unit ?? "")}</p></div><StockStatusBadge movement={detail} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{movementTypeLabel(detail.type)}</p><p className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-50">{signedMovementQuantity(detail)}</p></div>
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transição de saldo</p><p className="mt-3 flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-50"><span>{formatStockQuantity(detail.previousBalance)}</span><ArrowRight aria-hidden="true" className="h-4 w-4 text-slate-400" /><span>{formatStockQuantity(detail.resultingBalance)} {stockUnitShortLabel(detail.unit)}</span></p></div>
              </div>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Motivo</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-200">{detail.reason}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data e hora</dt><dd className="mt-1 text-slate-800 dark:text-slate-200">{formatDateTime(detail.createdAt)}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Origem</dt><dd className="mt-1 text-slate-800 dark:text-slate-200">{movementReferenceLabel(detail.referenceType)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Responsável</dt><dd className="mt-1 text-slate-800 dark:text-slate-200">{detail.responsibleDisplayName}</dd></div>
                {detail.referenceId && <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Referência</dt><dd className="mt-1 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{detail.referenceId}</dd></div>}
                {detail.reversalPublicId && <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Movimentação compensatória</dt><dd className="mt-1 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{detail.reversalPublicId}</dd></div>}
              </dl>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setDetail(null)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(form)} onOpenChange={open => !open && setForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto dark:border-slate-800 dark:bg-slate-950">
          <DialogHeader><DialogTitle>Nova movimentação</DialogTitle><DialogDescription>Informe a operação e confira o efeito no saldo antes de registrar.</DialogDescription></DialogHeader>
          {form && (
            <form onSubmit={submitMovement} className="space-y-5">
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">1. Movimentação</p>
                <label className="block"><FieldLabel>Produto</FieldLabel><StockSelect required value={form.productPublicId} onChange={event => setForm({ ...form, productPublicId: event.target.value })}><option value="">Selecione um produto</option>{products.data?.items.map(product => <option key={product.publicId} value={product.publicId}>{product.name} · SKU {product.sku} · saldo {formatStockQuantity(product.quantity)} {stockUnitShortLabel(product.unit)}</option>)}</StockSelect></label>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label><FieldLabel>Tipo</FieldLabel><StockSelect value={form.type} onChange={event => setForm({ ...form, type: event.target.value as ManualStockMovementType })}><option value="manual_in">Entrada manual</option><option value="manual_out">Saída manual</option><option value="adjustment_in">Ajuste de entrada</option><option value="adjustment_out">Ajuste de saída</option></StockSelect></label>
                  <label><FieldLabel>Quantidade {selectedProduct ? `(${stockUnitShortLabel(selectedProduct.unit)})` : ""}</FieldLabel><Input required inputMode="decimal" placeholder="0,000" className="dark:border-slate-700 dark:bg-slate-950" value={form.quantity} onChange={event => setForm({ ...form, quantity: event.target.value })} /></label>
                </div>
              </div>
              {selectedProduct && (
                <div data-testid="stock-balance-preview" className={`rounded-2xl border p-5 ${preview?.insufficient ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30" : "border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/30"}`}>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">2. Efeito no saldo</p>
                  {preview ? (
                    <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      <div><p className="text-xs text-slate-500">Saldo atual</p><p className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-50">{formatStockQuantity(preview.current)} <span className="text-sm font-semibold text-slate-500">{stockUnitShortLabel(selectedProduct.unit)}</span></p><p className="mt-2 inline-flex rounded-full bg-white/70 px-2 py-1 text-xs font-bold text-slate-700 dark:bg-slate-900 dark:text-slate-200">{preview.change} {stockUnitShortLabel(selectedProduct.unit)}</p></div>
                      <ArrowRight aria-hidden="true" className="h-5 w-5 text-blue-500" />
                      <div><p className="text-xs text-slate-500">Saldo após movimentação</p><p className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-50">{preview.resulting === null ? "Saldo insuficiente" : `${formatStockQuantity(preview.resulting)} ${stockUnitShortLabel(selectedProduct.unit)}`}</p></div>
                    </div>
                  ) : <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Informe uma quantidade positiva para visualizar o novo saldo.</p>}
                  <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Prévia informativa; o saldo definitivo será validado pelo servidor.</p>
                </div>
              )}
              <label className="block rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><FieldLabel>3. Motivo</FieldLabel><Textarea required minLength={3} maxLength={500} rows={3} placeholder="Explique por que esta movimentação está sendo feita" className="dark:border-slate-700 dark:bg-slate-950" value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} /></label>
              {move.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{move.error.message}</p>}
              <DialogFooter><Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" disabled={move.isPending || !form.productPublicId || !preview || preview.insufficient || form.reason.trim().length < 3}>{move.isPending ? "Registrando…" : "Registrar movimentação"}</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reverse)} onOpenChange={open => !open && setReverse(null)}>
        <DialogContent className="dark:border-slate-800 dark:bg-slate-950">
          <DialogHeader><DialogTitle>Confirmar reversão</DialogTitle><DialogDescription>Esta ação cria uma movimentação compensatória e não apaga o histórico original.</DialogDescription></DialogHeader>
          {reverse && (
            <form onSubmit={submitReversal} className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">{reverse.movement.productName}</p><p className="mt-1">{movementTypeLabel(reverse.movement.type)} · {signedMovementQuantity(reverse.movement)}</p><p className="mt-2 text-xs opacity-80">O saldo será recalculado pelo servidor e a reversão ficará registrada no histórico.</p></div>
              <label className="block"><FieldLabel>Motivo da reversão</FieldLabel><Textarea required minLength={3} maxLength={500} rows={3} placeholder="Explique por que a movimentação precisa ser revertida" className="dark:border-slate-700 dark:bg-slate-950" value={reverse.reason} onChange={event => setReverse({ ...reverse, reason: event.target.value })} /></label>
              {reverseMutation.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{reverseMutation.error.message}</p>}
              <DialogFooter><Button type="button" variant="outline" onClick={() => setReverse(null)}>Cancelar</Button><Button type="submit" disabled={reverseMutation.isPending || reverse.reason.trim().length < 3}>{reverseMutation.isPending ? "Revertendo…" : "Confirmar reversão"}</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
