import React from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  AlertCircle,
  ArrowRight,
  Box,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  Edit3,
  Eye,
  MapPin,
  PackageCheck,
  PackageOpen,
  Plus,
  Paperclip,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  UserRound,
  UploadCloud,
  WalletCards,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { productMediaUrl } from "@/lib/trpc-url";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ErpPageHeader } from "@/components/erp/ErpPageHeader";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  blankSalesAddress,
  blankSalesForm,
  calculateSalesFormTotals,
  hasDuplicateSalesItemIdentity,
  salesDraftFromForm,
  salesFormFromDetail,
  splitInstallments,
  type SalesAddress,
  type SalesForm,
} from "./sales-form";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});
const stageOrder = [
  "created",
  "confirmed",
  "separation",
  "shipped",
  "received",
  "completed",
] as const;
type Stage = (typeof stageOrder)[number];
type RouterOutputs = inferRouterOutputs<AppRouter>;
type SaleDetail = RouterOutputs["erp"]["sales"]["detail"];
type CustomerResults = RouterOutputs["erp"]["sales"]["customers"];
type CatalogResults = RouterOutputs["erp"]["sales"]["catalog"];
type DetailQueryState = {
  data?: SaleDetail;
  isFetched: boolean;
  isLoading: boolean;
  error: unknown;
};

const stageLabels: Record<Stage, string> = {
  created: "Criada",
  confirmed: "Confirmada",
  separation: "Separação",
  shipped: "Enviado",
  received: "Recebido",
  completed: "Concluído",
};
const paymentLabels = {
  pending: "Pendente",
  partial: "Pagamento parcial",
  paid: "Pago",
} as const;

function currentMonth() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const local = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  return { from: local(from), to: local(to) };
}

const month = currentMonth();

export function SalesPage({
  initialSelectedId,
  onClientNavigate,
}: {
  initialSelectedId?: string;
  onClientNavigate?: (crmClientId: string) => void;
} = {}) {
  const utils = trpc.useUtils();
  const [search, setSearch] = React.useState("");
  const [stage, setStage] = React.useState<"all" | Stage>("all");
  const [paymentStatus, setPaymentStatus] = React.useState<
    "all" | "pending" | "partial" | "paid"
  >("all");
  const [paymentMethod, setPaymentMethod] = React.useState("all");
  const [sellerUserId, setSellerUserId] = React.useState("all");
  const [from, setFrom] = React.useState(month.from);
  const [to, setTo] = React.useState(month.to);
  const [page, setPage] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialSelectedId ?? null
  );
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<SalesForm | null>(null);
  const [customerSearch, setCustomerSearch] = React.useState("");
  const [catalogSearch, setCatalogSearch] = React.useState("");
  const [customerPage, setCustomerPage] = React.useState(1);
  const [catalogPage, setCatalogPage] = React.useState(1);
  const [message, setMessage] = React.useState("");
  const [confirmation, setConfirmation] = React.useState<ConfirmationState | null>(null);
  const [cancellation, setCancellation] = React.useState<ReasonState | null>(null);
  const [transition, setTransition] = React.useState<TransitionState | null>(null);
  const [addressCorrection, setAddressCorrection] = React.useState<AddressCorrectionState | null>(null);

  const metrics = trpc.erp.sales.metrics.useQuery({ from, to });
  const list = trpc.erp.sales.list.useQuery({
    search,
    stage: stage === "all" ? undefined : stage,
    paymentStatus: paymentStatus === "all" ? undefined : paymentStatus,
    paymentMethod: paymentMethod === "all" ? undefined : paymentMethod,
    sellerUserId: sellerUserId === "all" ? undefined : sellerUserId,
    from,
    to,
    sort: "createdAt",
    direction: "desc",
    page,
    pageSize: 12,
  });
  const options = trpc.erp.sales.options.useQuery();
  const detail = trpc.erp.sales.detail.useQuery(
    { publicId: selectedId! },
    { enabled: Boolean(selectedId) }
  );
  const customers = trpc.erp.sales.customers.useQuery(
    { search: customerSearch, page: customerPage, pageSize: 12 },
    { enabled: Boolean(form) }
  );
  const catalog = trpc.erp.sales.catalog.useQuery(
    { search: catalogSearch, page: catalogPage, pageSize: 12 },
    { enabled: Boolean(form) }
  );

  React.useEffect(() => {
    const first = list.data?.items[0]?.publicId;
    if (!selectedId && first) setSelectedId(first);
  }, [list.data?.items, selectedId]);

  React.useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);

  const refresh = React.useCallback(async () => {
    await utils.erp.invalidate();
  }, [utils]);
  const done = React.useCallback(
    async (text: string, id?: string) => {
      setForm(null);
      setConfirmation(null);
      setCancellation(null);
      setTransition(null);
      setAddressCorrection(null);
      setMessage(text);
      if (id) setSelectedId(id);
      await refresh();
    },
    [refresh]
  );

  const create = trpc.erp.sales.create.useMutation({
    onSuccess: result => void done("Venda criada como rascunho.", result.publicId),
  });
  const update = trpc.erp.sales.update.useMutation({
    onSuccess: result => void done("Rascunho atualizado.", result.publicId),
  });
  const confirmSale = trpc.erp.sales.confirm.useMutation({
    onSuccess: result =>
      void done(
        result.replay
          ? "A confirmação já havia sido processada com estes dados."
          : "Venda confirmada e títulos criados na mesma transação.",
        result.publicId
      ),
  });
  const changeStage = trpc.erp.sales.transition.useMutation({
    onSuccess: result =>
      void done(
        result.replay
          ? "A alteração de etapa já havia sido processada."
          : result.currentStage === "shipped"
            ? "Venda marcada como Enviado e estoque baixado."
            : `Venda movida para ${stageLabels[result.currentStage as Stage]}.`,
        result.publicId
      ),
  });
  const cancelSale = trpc.erp.sales.cancel.useMutation({
    onSuccess: result => void done("Venda cancelada e títulos em aberto cancelados.", result.publicId),
  });
  const correctAddress = trpc.erp.sales.correctAddress.useMutation({
    onSuccess: result => void done("Endereço corrigido com registro de auditoria.", result.publicId),
  });

  const canWrite = list.data?.canWrite === true;
  const pendingError =
    create.error ??
    update.error ??
    confirmSale.error ??
    changeStage.error ??
    cancelSale.error ??
    correctAddress.error;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    if (!form.items.length) {
      setMessage("Adicione ao menos um produto à venda.");
      return;
    }
    if (hasDuplicateSalesItemIdentity(form.items)) {
      setMessage("A mesma variação não pode aparecer duas vezes na venda.");
      return;
    }
    const command = salesDraftFromForm(form);
    if (form.publicId) update.mutate({ ...command, publicId: form.publicId });
    else create.mutate(command);
  };

  const edit = async (publicId: string) => {
    const selected = await utils.erp.sales.detail.fetch({ publicId });
    setForm(salesFormFromDetail(selected));
    setCustomerSearch(selected.customerName);
    setCustomerPage(1);
    setCatalogPage(1);
  };

  return (
    <div
      className="min-w-0 space-y-5 selection:bg-blue-100 selection:text-blue-950"
      data-testid="erp-sales-page"
    >
      <ErpPageHeader
        title="Vendas"
        description="Pedidos, produtos e recebimentos em uma única visão."
        actions={
          canWrite ? (
            <Button
              className="min-h-10 bg-blue-600 px-5 text-white shadow-sm hover:bg-blue-700"
              onClick={() => {
                setForm(blankSalesForm());
                setCustomerSearch("");
                setCatalogSearch("");
                setCustomerPage(1);
                setCatalogPage(1);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Nova venda
            </Button>
          ) : undefined
        }
      />

      {(message || pendingError) && (
        <div
          role={pendingError ? "alert" : "status"}
          className={cn(
            "flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium",
            pendingError ? "bg-rose-50 text-rose-900" : "bg-emerald-50 text-emerald-900"
          )}
        >
          {pendingError ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{pendingError?.message ?? message}</span>
        </div>
      )}

      <SalesMetrics data={metrics.data} loading={metrics.isLoading} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-3" aria-label="Lista de vendas">
          <div className="grid gap-2 rounded-xl bg-slate-100/80 p-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(220px,1fr)_145px_150px_150px_150px_210px]">
            <label className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                aria-label="Buscar por venda, cliente, produto ou SKU"
                className="bg-white pl-9"
                placeholder="Venda, cliente, produto ou SKU"
                value={search}
                onChange={event => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              <span className="sr-only">Etapa</span>
              <select
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                value={stage}
                onChange={event => {
                  setStage(event.target.value as typeof stage);
                  setPage(1);
                }}
              >
                <option value="all">Todas as etapas</option>
                {stageOrder.map(value => (
                  <option key={value} value={value}>{stageLabels[value]}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Forma de pagamento</span>
              <select
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                value={paymentMethod}
                onChange={event => {
                  setPaymentMethod(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todas as formas</option>
                {options.data?.paymentMethods.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Vendedor</span>
              <select
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                value={sellerUserId}
                onChange={event => {
                  setSellerUserId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todos os vendedores</option>
                {options.data?.sellers.map(value => <option key={value.publicId} value={value.publicId}>{value.name}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Pagamento</span>
              <select
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                value={paymentStatus}
                onChange={event => {
                  setPaymentStatus(event.target.value as typeof paymentStatus);
                  setPage(1);
                }}
              >
                <option value="all">Todos os pagamentos</option>
                <option value="pending">Pendente</option>
                <option value="partial">Pagamento parcial</option>
                <option value="paid">Pago</option>
              </select>
            </label>
            <label className="grid grid-cols-2 gap-1" aria-label="Período das vendas">
              <Input
                type="date"
                aria-label="Data inicial"
                value={from}
                onChange={event => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
              />
              <Input
                type="date"
                aria-label="Data final"
                value={to}
                onChange={event => {
                  setTo(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>

          {list.isLoading ? (
            <State title="Carregando vendas…" />
          ) : list.error ? (
            <State
              title={
                list.error.data?.code === "FORBIDDEN"
                  ? "Seu perfil não tem acesso à área de Vendas."
                  : "Não foi possível carregar as vendas."
              }
              retry={() => void list.refetch()}
              error
            />
          ) : !list.data?.items.length ? (
            <State
              title="Nenhuma venda encontrada neste período."
              description="Ajuste os filtros ou crie uma nova venda."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_-20px_rgba(15,23,42,0.55)]">
              <div className="hidden grid-cols-[34px_110px_minmax(140px,1fr)_minmax(145px,1.2fr)_110px_130px_120px] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 lg:grid">
                <span aria-hidden="true" />
                <span>Pedido</span>
                <span>Cliente</span>
                <span>Produtos</span>
                <span className="text-right">Total</span>
                <span>Pagamento</span>
                <span>Etapa</span>
              </div>
              {list.data.items.map(order => {
                const expanded = expandedId === order.publicId;
                const active = selectedId === order.publicId;
                return (
                  <article
                    key={order.publicId}
                    className={cn(
                      "border-t border-slate-100 first:border-t-0",
                      active && "bg-blue-50/55"
                    )}
                  >
                    <div className="grid items-center gap-3 px-4 py-3 lg:grid-cols-[34px_110px_minmax(140px,1fr)_minmax(145px,1.2fr)_110px_130px_120px]">
                      <button
                        type="button"
                        aria-label={expanded ? "Recolher itens" : "Expandir itens"}
                        aria-expanded={expanded}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        onClick={() => {
                          setExpandedId(expanded ? null : order.publicId);
                          setSelectedId(order.publicId);
                        }}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        onClick={() => setSelectedId(order.publicId)}
                      >
                        <strong className="block text-sm text-slate-950">{order.orderNumber}</strong>
                        <span className="text-xs text-slate-500">{date.format(new Date(order.createdAt))}</span>
                      </button>
                      <button
                        type="button"
                        className="truncate text-left text-sm font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        onClick={() => setSelectedId(order.publicId)}
                      >
                        {order.customerName}
                      </button>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-800">
                          {order.firstProductName ?? "Itens históricos indisponíveis"}
                          {order.itemCount > 1 ? ` · +${order.itemCount - 1}` : ""}
                        </p>
                        <p className="text-xs text-slate-500">
                          {order.itemCount} {order.itemCount === 1 ? "item" : "itens"} · {formatQuantity(order.totalQuantity)} un.
                        </p>
                      </div>
                      <strong className="text-left text-sm tabular-nums text-slate-950 lg:text-right">
                        {money.format(order.totalCents / 100)}
                      </strong>
                      <PaymentBadge value={order.paymentStatus} />
                      <div className="flex items-center justify-between gap-2">
                        <StageBadge stage={order.currentStage as Stage} cancelled={order.cancelled} />
                        {order.cancelled && <XCircle className="h-4 w-4 text-rose-600" aria-label="Cancelada" />}
                      </div>
                    </div>
                    {expanded && (
                      <ExpandedProducts
                        orderId={order.publicId}
                        detail={selectedId === order.publicId ? detail : null}
                        onEdit={canWrite && order.currentStage === "created" && !order.cancelled ? () => void edit(order.publicId) : undefined}
                      />
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {list.data && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <span>{list.data.total} {list.data.total === 1 ? "venda" : "vendas"}</span>
              {list.data.totalPages > 1 && (
                <nav aria-label="Paginação das vendas" className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>
                    Anterior
                  </Button>
                  <span className="tabular-nums">{page} / {list.data.totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= list.data.totalPages} onClick={() => setPage(value => value + 1)}>
                    Próxima
                  </Button>
                </nav>
              )}
            </div>
          )}
        </section>

        <SaleDetailPanel
          query={detail}
          canWrite={canWrite}
          onRetry={() => void detail.refetch()}
          onEdit={id => void edit(id)}
          onConfirm={order =>
            setConfirmation({
              publicId: order.publicId,
              idempotencyKey: crypto.randomUUID(),
              totalCents: order.totalCents,
              paymentMethod: options.data?.paymentMethods[0] ?? "PIX",
              categoryPublicId: options.data?.categories[0]?.publicId ?? "",
              financialAccountPublicId: "",
              installmentCount: 1,
              firstDueDate: new Date().toISOString().slice(0, 10),
            })
          }
          onTransition={(order, toStage, correction) =>
            setTransition({
              publicId: order.publicId,
              idempotencyKey: crypto.randomUUID(),
              fromStage: order.currentStage as Stage,
              toStage,
              reason: "",
              correction,
            })
          }
          onCancel={order => setCancellation({ publicId: order.publicId, reason: "" })}
          onCorrectAddress={order =>
            setAddressCorrection({
              publicId: order.publicId,
              shippingAddress: order.shippingAddress ?? blankSalesAddress(),
              billingAddress: order.billingAddress ?? blankSalesAddress(),
              reason: "",
            })
          }
          onClientNavigate={onClientNavigate}
        />
      </div>

      <SaleFormDialog
        form={form}
        setForm={setForm}
        customerSearch={customerSearch}
        setCustomerSearch={value => {
          setCustomerSearch(value);
          setCustomerPage(1);
        }}
        customerPage={customerPage}
        setCustomerPage={setCustomerPage}
        catalogSearch={catalogSearch}
        setCatalogSearch={value => {
          setCatalogSearch(value);
          setCatalogPage(1);
        }}
        catalogPage={catalogPage}
        setCatalogPage={setCatalogPage}
        customers={customers}
        catalog={catalog}
        busy={create.isPending || update.isPending}
        onSubmit={save}
      />

      <ConfirmationDialog
        state={confirmation}
        setState={setConfirmation}
        categories={options.data?.categories ?? []}
        accounts={options.data?.accounts ?? []}
        paymentMethods={options.data?.paymentMethods ?? []}
        busy={confirmSale.isPending}
        onConfirm={state => {
          const installments = splitInstallments(
            state.totalCents,
            state.installmentCount,
            state.firstDueDate
          );
          confirmSale.mutate({
            publicId: state.publicId,
            idempotencyKey: state.idempotencyKey,
            paymentMethod: state.paymentMethod,
            categoryPublicId: state.categoryPublicId,
            financialAccountPublicId: state.financialAccountPublicId || undefined,
            installments,
          });
        }}
      />

      <ReasonDialog
        title="Cancelar venda"
        description="O cancelamento preserva a etapa e o histórico. Se houver recebimentos, a operação será bloqueada porque estornos ainda não estão disponíveis."
        confirmLabel="Cancelar venda"
        state={cancellation}
        setState={setCancellation}
        busy={cancelSale.isPending}
        destructive
        onConfirm={state => cancelSale.mutate(state)}
      />

      <TransitionDialog
        state={transition}
        setState={setTransition}
        busy={changeStage.isPending}
        onConfirm={state =>
          changeStage.mutate({
            publicId: state.publicId,
            toStage: state.toStage,
            idempotencyKey: state.idempotencyKey,
            reason: state.reason || undefined,
          })
        }
      />

      <AddressCorrectionDialog
        state={addressCorrection}
        setState={setAddressCorrection}
        busy={correctAddress.isPending}
        onConfirm={state => correctAddress.mutate(state)}
      />
    </div>
  );
}

function SalesMetrics({
  data,
  loading,
}: {
  data?: {
    salesCents: number;
    receivableCents: number;
    openOrders: number;
    grossMarginAvailable: boolean;
    grossMarginReason: string;
    period: { from: string; to: string; criterion: string };
  };
  loading: boolean;
}) {
  const metrics = [
    {
      label: "Vendas do período",
      value: data ? money.format(data.salesCents / 100) : "—",
      icon: ShoppingCart,
      detail: data?.period.criterion ?? "data de criação da venda",
    },
    {
      label: "A receber",
      value: data ? money.format(data.receivableCents / 100) : "—",
      icon: CreditCard,
      detail: "total da venda menos recebimentos reais",
    },
    {
      label: "Pedidos em aberto",
      value: data ? String(data.openOrders) : "—",
      icon: ReceiptText,
      detail: "não cancelados e não concluídos",
    },
    {
      label: "Margem bruta",
      value: data?.grossMarginAvailable ? "Disponível" : "Indisponível",
      icon: CircleDollarSign,
      detail: data?.grossMarginReason ?? "aguardando dados históricos",
    },
  ];
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores de vendas">
      {metrics.map(metric => (
        <div key={metric.label} className="flex min-h-28 items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_8px_20px_-20px_rgba(15,23,42,0.6)]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <metric.icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-600">{metric.label}</p>
            <p className="mt-1 truncate text-xl font-bold tracking-[-0.02em] text-slate-950 tabular-nums">
              {loading ? "Carregando…" : metric.value}
            </p>
            <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-500">{metric.detail}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

function ExpandedProducts({
  orderId,
  detail,
  onEdit,
}: {
  orderId: string;
  detail: DetailQueryState | null;
  onEdit?: () => void;
}) {
  if (!detail || detail.isLoading) {
    return <div className="border-t border-blue-100 bg-white px-5 py-6 text-sm text-slate-600">Carregando itens…</div>;
  }
  if (detail.error || !detail.data) {
    return <div role="alert" className="border-t border-rose-100 bg-rose-50 px-5 py-4 text-sm text-rose-900">Não foi possível carregar os itens desta venda.</div>;
  }
  return (
    <div className="border-t border-blue-100 bg-white p-4" data-order-id={orderId}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900">Itens da venda ({detail.data.items.length})</h3>
        {onEdit && <Button variant="ghost" size="sm" onClick={onEdit}><Edit3 className="mr-2 h-4 w-4" />Editar rascunho</Button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[680px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Produto</th>
              <th className="px-3 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 text-right font-semibold">Qtd.</th>
              <th className="px-3 py-2 text-right font-semibold">Preço unit.</th>
              <th className="px-3 py-2 text-right font-semibold">Desconto</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
              <th className="px-3 py-2 text-right font-semibold">Disponível agora</th>
            </tr>
          </thead>
          <tbody>
            {detail.data.items.map(item => (
              <tr key={item.publicId} className="border-t border-slate-100">
                <td className="px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProductThumb imagePath={item.canonicalImage?.thumbnailPath} name={item.productName} />
                    <div className="min-w-0">
                      <strong className="block truncate text-slate-900">{item.productName}</strong>
                      {item.variantName && <span className="block truncate text-xs text-slate-500">{item.variantName}</span>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-slate-600">{item.sku}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatQuantity(item.quantity)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money.format(item.unitPriceCents / 100)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money.format(item.discountCents / 100)}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money.format(item.lineTotalCents / 100)}</td>
                <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{item.currentAvailable === null ? "Não disponível" : formatQuantity(item.currentAvailable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span className="text-slate-600">Subtotal <strong className="ml-2 text-slate-950 tabular-nums">{money.format(detail.data.subtotalCents / 100)}</strong></span>
        <span className="text-slate-600">Total <strong className="ml-2 text-slate-950 tabular-nums">{money.format(detail.data.totalCents / 100)}</strong></span>
      </div>
    </div>
  );
}

function SaleDetailPanel({
  query,
  canWrite,
  onRetry,
  onEdit,
  onConfirm,
  onTransition,
  onCancel,
  onCorrectAddress,
  onClientNavigate,
}: {
  query: DetailQueryState;
  canWrite: boolean;
  onRetry: () => void;
  onEdit: (id: string) => void;
  onConfirm: (order: SaleDetail) => void;
  onTransition: (order: SaleDetail, stage: Stage, correction: boolean) => void;
  onCancel: (order: SaleDetail) => void;
  onCorrectAddress: (order: SaleDetail) => void;
  onClientNavigate?: (crmClientId: string) => void;
}) {
  if (!query.isFetched && !query.isLoading) {
    return <aside className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Selecione uma venda para ver os detalhes.</aside>;
  }
  if (query.isLoading) {
    return <aside className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Carregando detalhes…</aside>;
  }
  if (query.error || !query.data) {
    return (
      <aside role="alert" className="rounded-xl bg-rose-50 p-6 text-sm text-rose-900">
        <AlertCircle className="mb-3 h-5 w-5" />
        <p>Não foi possível carregar o detalhe da venda.</p>
        <Button className="mt-4" variant="outline" onClick={onRetry}>Tentar novamente</Button>
      </aside>
    );
  }
  const order = query.data;
  const index = stageOrder.indexOf(order.currentStage as Stage);
  const next = stageOrder[index + 1];
  const correction =
    order.currentStage === "separation"
      ? "confirmed"
      : order.currentStage === "received"
        ? "shipped"
        : order.currentStage === "completed"
          ? "received"
          : null;
  const canCancel = index < stageOrder.indexOf("shipped") && !order.cancelled;
  const canCorrectAddress = ["confirmed", "separation"].includes(order.currentStage);
  const progress = order.totalCents > 0 ? Math.min(100, Math.round((order.paidCents / order.totalCents) * 100)) : 0;
  return (
    <aside className="self-start overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_14px_30px_-26px_rgba(15,23,42,0.65)] xl:sticky xl:top-3" aria-label="Detalhes da venda selecionada">
      <header className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-[-0.02em] text-slate-950">Pedido {order.orderNumber}</h2>
            <p className="mt-1 text-xs text-slate-500">Criado em {dateTime.format(new Date(order.createdAt))}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <PaymentBadge value={order.paymentStatus} />
            <StageBadge stage={order.currentStage as Stage} cancelled={order.cancelled} />
          </div>
        </div>
        {order.cancelled && (
          <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">
            <strong className="flex items-center gap-2"><XCircle className="h-4 w-4" />Venda cancelada</strong>
            <p className="mt-1">Última etapa: {stageLabels[order.currentStage as Stage]}. {order.cancellationReason}</p>
          </div>
        )}
      </header>

      <div className="max-h-[calc(100vh-190px)] space-y-5 overflow-y-auto px-5 py-5 [scrollbar-color:#94a3b8_transparent] [scrollbar-width:thin]">
        <section className="grid gap-4 text-sm">
          <div>
            <InfoRow icon={UserRound} label="Cliente" value={order.customerName} detail={order.crmClientId} />
            {onClientNavigate && (
              <button
                type="button"
                className="ml-10 mt-1 text-xs font-semibold text-blue-700 hover:underline"
                onClick={() => onClientNavigate(order.crmClientId)}
              >
                Ver dados do cliente <ArrowRight className="ml-1 inline h-3 w-3" />
              </button>
            )}
          </div>
          <InfoRow icon={UserRound} label="Vendedor(a)" value={order.sellerName ?? "Histórico indisponível"} />
          <InfoRow icon={CalendarDays} label="Previsão de entrega" value={order.expectedDate ? date.format(new Date(`${order.expectedDate}T12:00:00`)) : "Não informada"} />
        </section>

        <section>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Edit3 className="h-4 w-4 text-slate-500" />Etapa da venda</h3>
          <SaleTimeline stage={order.currentStage as Stage} cancelled={order.cancelled} />
          <p className="mt-3 text-xs leading-5 text-slate-600">
            A confirmação não reserva estoque. A disponibilidade é revalidada e a baixa ocorre somente ao marcar como Enviado.
          </p>
        </section>

        <section className="rounded-xl bg-slate-50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><WalletCards className="h-4 w-4 text-slate-500" />Pagamento</h3>
          <Progress value={progress} className="mt-3 h-2" />
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-slate-500">Recebido</span><strong className="mt-1 block text-sm text-emerald-700 tabular-nums">{money.format(order.paidCents / 100)}</strong></div>
            <div className="text-right"><span className="text-slate-500">Saldo a receber</span><strong className="mt-1 block text-sm text-slate-950 tabular-nums">{money.format(order.balanceCents / 100)}</strong></div>
          </div>
          <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
            {order.installments.length ? order.installments.map(entry => (
              <div key={entry.publicId} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-600">{entry.installment}/{order.installments.length} · {date.format(new Date(`${entry.dueDate}T12:00:00`))}</span>
                <span className="font-semibold text-slate-900 tabular-nums">{money.format(entry.amountCents / 100)}</span>
              </div>
            )) : (
              <p className="text-xs leading-5 text-amber-800">Venda legada sem títulos vinculados. Nenhuma cobrança retroativa foi criada.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl bg-blue-50 p-4 text-blue-950">
          <h3 className="flex items-center gap-2 text-sm font-bold"><Box className="h-4 w-4" />Estoque</h3>
          {stageOrder.indexOf(order.currentStage as Stage) >= stageOrder.indexOf("shipped") ? (
            <p className="mt-2 text-sm">Saída registrada no envio. Concluir a venda não gera nova movimentação.</p>
          ) : (
            <p className="mt-2 text-sm">Sem reserva. O saldo permanece disponível até o envio.</p>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><MapPin className="h-4 w-4 text-slate-500" />Endereço de entrega</h3>
            {canWrite && canCorrectAddress && !order.cancelled && (
              <button type="button" className="text-xs font-semibold text-blue-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => onCorrectAddress(order)}>Corrigir</button>
            )}
          </div>
          <AddressSummary address={order.shippingAddress} />
        </section>

        <SaleDocuments
          salePublicId={order.publicId}
          canWrite={canWrite && !order.cancelled}
        />

        <section>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Clock3 className="h-4 w-4 text-slate-500" />Histórico</h3>
          {!order.historyComplete && (
            <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              Parte do histórico é anterior à timeline auditada. Apenas eventos realmente registrados são exibidos.
            </p>
          )}
          <ol className="mt-3 space-y-0">
            {order.history.length ? order.history.slice().reverse().map((event, eventIndex) => (
              <li key={`${event.createdAt}-${eventIndex}`} className="relative grid grid-cols-[18px_1fr_auto] gap-2 pb-4 text-xs last:pb-0">
                <span className="relative z-10 mt-1.5 h-2.5 w-2.5 rounded-full bg-blue-600 ring-4 ring-white" />
                {eventIndex < order.history.length - 1 && <span className="absolute left-[4px] top-3 h-full w-px bg-slate-200" />}
                <div>
                  <strong className="text-slate-800">{eventLabel(event.eventType, event.toStage)}</strong>
                  <p className="mt-0.5 text-slate-500">Por {event.changedByName ?? event.changedBy}</p>
                  {event.reason && <p className="mt-1 leading-4 text-slate-600">Motivo: {event.reason}</p>}
                </div>
                <time className="text-right text-slate-500 tabular-nums">{dateTime.format(new Date(event.createdAt))}</time>
              </li>
            )) : <li className="text-xs text-slate-500">Nenhum evento histórico registrado.</li>}
          </ol>
        </section>
      </div>

      {canWrite && !order.cancelled && (
        <footer className="space-y-2 border-t border-slate-200 bg-white p-4">
          {order.currentStage === "created" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => onEdit(order.publicId)}><Edit3 className="mr-2 h-4 w-4" />Editar</Button>
              <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => onConfirm(order)}>Confirmar</Button>
            </div>
          ) : next ? (
            <Button className="w-full bg-blue-600 text-white hover:bg-blue-700" onClick={() => onTransition(order, next, false)}>
              {nextActionLabel(next)} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {correction ? (
              <Button variant="outline" size="sm" onClick={() => onTransition(order, correction, true)}>
                <RotateCcw className="mr-2 h-4 w-4" />Corrigir etapa
              </Button>
            ) : <span />}
            {canCancel && (
              <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800" disabled={order.paidCents > 0} title={order.paidCents > 0 ? "Há recebimentos registrados; estorno ainda não está disponível." : undefined} onClick={() => onCancel(order)}>
                <XCircle className="mr-2 h-4 w-4" />Cancelar
              </Button>
            )}
          </div>
          {order.paidCents > 0 && canCancel && <p className="text-center text-xs text-slate-500">Cancelamento bloqueado: há recebimentos e o estorno ainda não está disponível.</p>}
        </footer>
      )}
    </aside>
  );
}

function SaleTimeline({ stage, cancelled }: { stage: Stage; cancelled: boolean }) {
  const current = stageOrder.indexOf(stage);
  return (
    <div className="mt-4 min-w-0 pb-1">
      <ol className="grid w-full min-w-0 grid-cols-6" aria-label="Timeline das etapas da venda">
        {stageOrder.map((value, index) => {
          const completed = index < current;
          const active = index === current;
          return (
            <li key={value} className="relative text-center">
              {index > 0 && <span className={cn("absolute right-1/2 top-2.5 h-0.5 w-full", index <= current ? "bg-blue-600" : "bg-slate-200")} />}
              <span className={cn(
                "relative z-10 mx-auto flex h-5 w-5 items-center justify-center rounded-full",
                completed ? "bg-blue-600 text-white" : active ? "border-[3px] border-blue-500 bg-white" : "bg-slate-200",
                cancelled && active && "border-rose-500"
              )}>
                {completed && <Check className="h-3 w-3" />}
              </span>
              <span className={cn("mt-2 block text-[9px] font-semibold leading-3", active ? "text-blue-700" : "text-slate-500")}>{stageLabels[value]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SaleFormDialog({
  form,
  setForm,
  customerSearch,
  setCustomerSearch,
  customerPage,
  setCustomerPage,
  catalogSearch,
  setCatalogSearch,
  catalogPage,
  setCatalogPage,
  customers,
  catalog,
  busy,
  onSubmit,
}: {
  form: SalesForm | null;
  setForm: React.Dispatch<React.SetStateAction<SalesForm | null>>;
  customerSearch: string;
  setCustomerSearch: (value: string) => void;
  customerPage: number;
  setCustomerPage: React.Dispatch<React.SetStateAction<number>>;
  catalogSearch: string;
  setCatalogSearch: (value: string) => void;
  catalogPage: number;
  setCatalogPage: React.Dispatch<React.SetStateAction<number>>;
  customers: { data?: CustomerResults; isLoading: boolean };
  catalog: { data?: CatalogResults; isLoading: boolean };
  busy: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  if (!form) return null;
  const totals = calculateSalesFormTotals(form);
  const patchItem = (index: number, patch: Record<string, unknown>) =>
    setForm(current =>
      current
        ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }
        : current
    );
  return (
    <Dialog open onOpenChange={open => !open && setForm(null)}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto bg-white p-0">
        <DialogHeader className="border-b border-slate-200 px-6 py-5">
          <DialogTitle>{form.publicId ? "Editar venda" : "Nova venda"}</DialogTitle>
          <p className="text-sm text-slate-600">Defina cliente, variações, valores e os endereços históricos desta venda.</p>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-6 px-6 pb-6">
          <section className="pt-5">
            <h3 className="text-sm font-bold text-slate-900">Cliente</h3>
            <label className="relative mt-2 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input className="pl-9" placeholder="Buscar por nome, documento ou código" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} />
            </label>
            {form.crmClientId && <p className="mt-2 text-sm font-semibold text-blue-800">Selecionado: {form.customerName ?? form.crmClientId}</p>}
            <div className="mt-2 grid max-h-36 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-1 [scrollbar-width:thin] sm:grid-cols-2">
              {customers.isLoading ? <p className="p-3 text-sm text-slate-500">Buscando clientes…</p> : customers.data?.items.map(customer => (
                <button
                  type="button"
                  key={customer.crmClientId}
                  className={cn("rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500", form.crmClientId === customer.crmClientId && "bg-blue-50 text-blue-900")}
                  onClick={() => {
                    const address: SalesAddress = {
                      recipientName: customer.responsibleName || customer.customerName,
                      postalCode: customer.postalCode || "",
                      street: customer.address || "",
                      number: "",
                      complement: "",
                      district: "",
                      city: customer.city || "",
                      state: customer.state || "",
                    };
                    setForm(current => current ? { ...current, crmClientId: customer.crmClientId, customerName: customer.customerName, shippingAddress: address, billingAddress: { ...address } } : current);
                  }}
                >
                  <strong className="block truncate">{customer.customerName}</strong>
                  <span className="text-xs text-slate-500">{customer.document || customer.crmClientId}</span>
                </button>
              ))}
            </div>
            <SearchPager
              page={customerPage}
              total={customers.data?.total ?? 0}
              pageSize={customers.data?.pageSize ?? 12}
              onPage={setCustomerPage}
            />
          </section>

          <section>
            <div className="flex items-end justify-between gap-3">
              <div><h3 className="text-sm font-bold text-slate-900">Produtos e variações</h3><p className="mt-1 text-xs text-slate-500">O saldo exibido é informativo; a confirmação não reserva estoque.</p></div>
            </div>
            <label className="relative mt-2 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input className="pl-9" placeholder="Buscar produto, variação, SKU ou código" value={catalogSearch} onChange={event => setCatalogSearch(event.target.value)} />
            </label>
            <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-2 [scrollbar-width:thin] sm:grid-cols-2">
              {catalog.isLoading ? <p className="p-3 text-sm text-slate-500">Buscando produtos…</p> : catalog.data?.items.map(product => {
                const used = form.items.some(item => item.inventoryItemPublicId === product.inventoryItemPublicId);
                return (
                  <button
                    type="button"
                    key={product.inventoryItemPublicId}
                    disabled={used}
                    className="flex items-center gap-3 rounded-lg border border-slate-100 p-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => setForm(current => current ? { ...current, items: [...current.items, {
                      productPublicId: product.productPublicId,
                      inventoryItemPublicId: product.inventoryItemPublicId,
                      productName: product.name,
                      variantName: product.variantAttributes || product.variantName,
                      sku: product.sku,
                      unit: product.unit,
                      imagePath: product.canonicalImage?.thumbnailPath,
                      availableQuantity: product.availableQuantity,
                      quantity: "1.000",
                      unitPriceCents: product.salePriceCents,
                      discountCents: 0,
                    }] } : current)}
                  >
                    <ProductThumb imagePath={product.canonicalImage?.thumbnailPath} name={product.name} />
                    <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-900">{product.name}</strong><span className="block truncate text-xs text-slate-500">{product.variantAttributes || product.variantName || product.sku} · disponível {formatQuantity(product.availableQuantity)}</span></span>
                    <Plus className="h-4 w-4 text-blue-700" />
                  </button>
                );
              })}
            </div>
            <SearchPager
              page={catalogPage}
              total={catalog.data?.total ?? 0}
              pageSize={catalog.data?.pageSize ?? 12}
              onPage={setCatalogPage}
            />
            <div className="mt-3 space-y-2">
              {form.items.length ? form.items.map((item, index) => (
                <div key={`${item.inventoryItemPublicId}-${index}`} className="grid items-end gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[minmax(190px,1fr)_100px_130px_120px_36px]">
                  <div className="flex min-w-0 items-center gap-3 self-center">
                    <ProductThumb imagePath={item.imagePath} name={item.productName ?? "Produto"} />
                    <div className="min-w-0"><strong className="block truncate text-sm text-slate-900">{item.productName ?? item.productPublicId}</strong><span className="block truncate text-xs text-slate-500">{item.variantName || item.sku} · disponível {item.availableQuantity ? formatQuantity(item.availableQuantity) : "—"}</span></div>
                  </div>
                  <MoneyOrQuantity label="Quantidade" value={item.quantity} onChange={value => patchItem(index, { quantity: value })} />
                  <MoneyOrQuantity money label="Preço unit." value={item.unitPriceCents} onChange={value => patchItem(index, { unitPriceCents: value })} />
                  <MoneyOrQuantity money label="Desconto" value={item.discountCents ?? 0} onChange={value => patchItem(index, { discountCents: value })} />
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remover ${item.productName ?? "produto"}`} className="text-rose-700" onClick={() => setForm(current => current ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              )) : <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Nenhum produto adicionado.</p>}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <AddressFields title="Endereço de entrega" address={form.shippingAddress ?? blankSalesAddress()} onChange={shippingAddress => setForm(current => current ? { ...current, shippingAddress } : current)} />
            <div>
              <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-900">Endereço de cobrança</h3><button type="button" className="text-xs font-semibold text-blue-700 underline-offset-4 hover:underline" onClick={() => setForm(current => current ? { ...current, billingAddress: { ...(current.shippingAddress ?? blankSalesAddress()) } } : current)}>Usar o de entrega</button></div>
              <AddressFields address={form.billingAddress ?? blankSalesAddress()} onChange={billingAddress => setForm(current => current ? { ...current, billingAddress } : current)} />
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-semibold text-slate-700">Previsão de entrega<Input className="mt-1" type="date" value={form.expectedDate} onChange={event => setForm(current => current ? { ...current, expectedDate: event.target.value } : current)} /></label>
            <MoneyOrQuantity money label="Desconto da venda" value={form.orderDiscountCents ?? 0} onChange={value => setForm(current => current ? { ...current, orderDiscountCents: value } : current)} />
            <MoneyOrQuantity money label="Frete" value={form.freightCents ?? 0} onChange={value => setForm(current => current ? { ...current, freightCents: value } : current)} />
            <div className="rounded-lg bg-slate-950 p-3 text-white"><span className="text-xs text-slate-300">Total</span><strong className="mt-1 block text-lg tabular-nums">{money.format(totals.totalCents / 100)}</strong></div>
          </section>
          <label className="block text-xs font-semibold text-slate-700">Observações<textarea className="mt-1 min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={form.notes} onChange={event => setForm(current => current ? { ...current, notes: event.target.value } : current)} /></label>

          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t border-slate-200 bg-white px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button type="submit" disabled={busy || !form.crmClientId || !form.items.length || totals.totalCents <= 0}>{busy ? "Salvando…" : "Salvar rascunho"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmationState = {
  publicId: string;
  idempotencyKey: string;
  totalCents: number;
  paymentMethod: string;
  categoryPublicId: string;
  financialAccountPublicId: string;
  installmentCount: number;
  firstDueDate: string;
};

function ConfirmationDialog({ state, setState, categories, accounts, paymentMethods, busy, onConfirm }: {
  state: ConfirmationState | null;
  setState: React.Dispatch<React.SetStateAction<ConfirmationState | null>>;
  categories: Array<{ publicId: string; name: string }>;
  accounts: Array<{ publicId: string; name: string }>;
  paymentMethods: string[];
  busy: boolean;
  onConfirm: (state: ConfirmationState) => void;
}) {
  if (!state) return null;
  const installments = splitInstallments(state.totalCents, state.installmentCount, state.firstDueDate);
  return (
    <Dialog open onOpenChange={open => !open && setState(null)}>
      <DialogContent className="max-w-xl bg-white">
        <DialogHeader><DialogTitle>Confirmar venda e criar títulos</DialogTitle><p className="text-sm text-slate-600">A confirmação e os títulos serão gravados na mesma transação. Esta etapa não reserva estoque.</p></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Forma de pagamento<select className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm" value={state.paymentMethod} onChange={event => setState({ ...state, paymentMethod: event.target.value })}>{paymentMethods.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-700">Categoria financeira<select required className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm" value={state.categoryPublicId} onChange={event => setState({ ...state, categoryPublicId: event.target.value })}><option value="">Selecione</option>{categories.map(value => <option key={value.publicId} value={value.publicId}>{value.name}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-700">Conta prevista<select className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm" value={state.financialAccountPublicId} onChange={event => setState({ ...state, financialAccountPublicId: event.target.value })}><option value="">Sem conta definida</option>{accounts.map(value => <option key={value.publicId} value={value.publicId}>{value.name}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-700">Número de parcelas<Input className="mt-1" type="number" min={1} max={120} value={state.installmentCount} onChange={event => setState({ ...state, installmentCount: Math.max(1, Number(event.target.value)) })} /></label>
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Primeiro vencimento<Input className="mt-1" type="date" value={state.firstDueDate} onChange={event => setState({ ...state, firstDueDate: event.target.value })} /></label>
        </div>
        <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3 [scrollbar-width:thin]">
          {installments.map((entry, index) => <div key={entry.dueDate} className="flex justify-between gap-3 text-sm"><span>{index + 1}/{installments.length} · {date.format(new Date(`${entry.dueDate}T12:00:00`))}</span><strong className="tabular-nums">{money.format(entry.amountCents / 100)}</strong></div>)}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-sm"><strong>Total exato</strong><strong className="tabular-nums">{money.format(installments.reduce((sum, item) => sum + item.amountCents, 0) / 100)}</strong></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button disabled={busy || !state.categoryPublicId || !state.paymentMethod || !installments.length} onClick={() => onConfirm(state)}>{busy ? "Confirmando…" : "Confirmar e criar títulos"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ReasonState = { publicId: string; reason: string };
function ReasonDialog({ title, description, confirmLabel, state, setState, busy, destructive, onConfirm }: {
  title: string;
  description: string;
  confirmLabel: string;
  state: ReasonState | null;
  setState: React.Dispatch<React.SetStateAction<ReasonState | null>>;
  busy: boolean;
  destructive?: boolean;
  onConfirm: (state: ReasonState) => void;
}) {
  if (!state) return null;
  return (
    <Dialog open onOpenChange={open => !open && setState(null)}><DialogContent className="bg-white"><DialogHeader><DialogTitle>{title}</DialogTitle><p className="text-sm leading-6 text-slate-600">{description}</p></DialogHeader><label className="text-sm font-semibold text-slate-700">Motivo<textarea autoFocus className="mt-1 min-h-24 w-full rounded-md border border-input px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={state.reason} onChange={event => setState({ ...state, reason: event.target.value })} /></label><DialogFooter><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button className={destructive ? "bg-rose-600 text-white hover:bg-rose-700" : undefined} disabled={busy || state.reason.trim().length < 3} onClick={() => onConfirm(state)}>{busy ? "Processando…" : confirmLabel}</Button></DialogFooter></DialogContent></Dialog>
  );
}

type TransitionState = ReasonState & {
  idempotencyKey: string;
  fromStage: Stage;
  toStage: Stage;
  correction: boolean;
};
function TransitionDialog({ state, setState, busy, onConfirm }: {
  state: TransitionState | null;
  setState: React.Dispatch<React.SetStateAction<TransitionState | null>>;
  busy: boolean;
  onConfirm: (state: TransitionState) => void;
}) {
  if (!state) return null;
  const shipping = state.fromStage === "separation" && state.toStage === "shipped";
  return (
    <Dialog open onOpenChange={open => !open && setState(null)}><DialogContent className="bg-white"><DialogHeader><DialogTitle>{state.correction ? "Corrigir etapa logística" : `Mover para ${stageLabels[state.toStage]}`}</DialogTitle><p className="text-sm leading-6 text-slate-600">{shipping ? "O estoque será revalidado e baixado atomicamente. Se algum item não tiver saldo, nada será alterado." : state.correction ? "A correção será registrada com ator, data, etapa anterior, nova etapa e motivo. Nenhum movimento de estoque será repetido." : "A mudança será registrada na timeline auditada."}</p></DialogHeader>{state.correction && <label className="text-sm font-semibold text-slate-700">Motivo obrigatório<textarea autoFocus className="mt-1 min-h-24 w-full rounded-md border border-input px-3 py-2 text-sm" value={state.reason} onChange={event => setState({ ...state, reason: event.target.value })} /></label>}<DialogFooter><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button disabled={busy || (state.correction && state.reason.trim().length < 3)} onClick={() => onConfirm(state)}>{busy ? "Atualizando…" : shipping ? "Revalidar e enviar" : "Confirmar etapa"}</Button></DialogFooter></DialogContent></Dialog>
  );
}

type AddressCorrectionState = { publicId: string; shippingAddress: SalesAddress; billingAddress: SalesAddress; reason: string };
function AddressCorrectionDialog({ state, setState, busy, onConfirm }: {
  state: AddressCorrectionState | null;
  setState: React.Dispatch<React.SetStateAction<AddressCorrectionState | null>>;
  busy: boolean;
  onConfirm: (state: AddressCorrectionState) => void;
}) {
  if (!state) return null;
  return (
    <Dialog open onOpenChange={open => !open && setState(null)}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto bg-white"><DialogHeader><DialogTitle>Corrigir endereço histórico</DialogTitle><p className="text-sm text-slate-600">Permitido até Separação. Os valores anterior e novo serão mantidos na auditoria.</p></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><AddressFields title="Entrega" address={state.shippingAddress} onChange={shippingAddress => setState({ ...state, shippingAddress })} /><AddressFields title="Cobrança" address={state.billingAddress} onChange={billingAddress => setState({ ...state, billingAddress })} /></div><label className="text-sm font-semibold text-slate-700">Motivo da correção<textarea className="mt-1 min-h-20 w-full rounded-md border border-input px-3 py-2 text-sm" value={state.reason} onChange={event => setState({ ...state, reason: event.target.value })} /></label><DialogFooter><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button disabled={busy || state.reason.trim().length < 3} onClick={() => onConfirm(state)}>{busy ? "Salvando…" : "Salvar correção"}</Button></DialogFooter></DialogContent></Dialog>
  );
}

function AddressFields({ title, address, onChange }: { title?: string; address: SalesAddress; onChange: (address: SalesAddress) => void }) {
  const field = (key: keyof SalesAddress, value: string) => onChange({ ...address, [key]: value });
  return (
    <fieldset className="grid grid-cols-6 gap-2 rounded-lg border border-slate-200 p-3">
      {title && <legend className="px-1 text-sm font-bold text-slate-900">{title}</legend>}
      <label className="col-span-6 text-xs font-semibold text-slate-700">Destinatário<Input className="mt-1" value={address.recipientName} onChange={event => field("recipientName", event.target.value)} /></label>
      <label className="col-span-2 text-xs font-semibold text-slate-700">CEP<Input className="mt-1" value={address.postalCode} onChange={event => field("postalCode", event.target.value)} /></label>
      <label className="col-span-4 text-xs font-semibold text-slate-700">Logradouro<Input className="mt-1" value={address.street} onChange={event => field("street", event.target.value)} /></label>
      <label className="col-span-2 text-xs font-semibold text-slate-700">Número<Input className="mt-1" value={address.number} onChange={event => field("number", event.target.value)} /></label>
      <label className="col-span-4 text-xs font-semibold text-slate-700">Complemento<Input className="mt-1" value={address.complement} onChange={event => field("complement", event.target.value)} /></label>
      <label className="col-span-3 text-xs font-semibold text-slate-700">Bairro<Input className="mt-1" value={address.district} onChange={event => field("district", event.target.value)} /></label>
      <label className="col-span-2 text-xs font-semibold text-slate-700">Cidade<Input className="mt-1" value={address.city} onChange={event => field("city", event.target.value)} /></label>
      <label className="col-span-1 text-xs font-semibold text-slate-700">UF<Input className="mt-1 uppercase" maxLength={2} value={address.state} onChange={event => field("state", event.target.value.toUpperCase())} /></label>
    </fieldset>
  );
}

function MoneyOrQuantity({ label, value, onChange, money: monetary }: { label: string; value: string | number; onChange: (value: never) => void; money?: boolean }) {
  return (
    <label className="text-xs font-semibold text-slate-700">{label}<Input className="mt-1 tabular-nums" type="number" min={0} step={monetary ? "0.01" : "0.001"} value={monetary ? (Number(value) / 100).toFixed(2) : value} onChange={event => onChange((monetary ? Math.round(Number(event.target.value) * 100) : event.target.value) as never)} /></label>
  );
}

function ProductThumb({ imagePath, name }: { imagePath?: string | null; name: string }) {
  return imagePath ? (
    <img src={productMediaUrl(imagePath)} alt="" className="h-10 w-10 shrink-0 rounded-md bg-slate-100 object-cover" />
  ) : (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500" aria-label={`Sem imagem para ${name}`}><PackageOpen className="h-5 w-5" /></span>
  );
}

function SearchPager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-600">
      <Button type="button" size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(value => value - 1)}>Anterior</Button>
      <span className="tabular-nums">{page} / {totalPages}</span>
      <Button type="button" size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onPage(value => value + 1)}>Próxima</Button>
    </div>
  );
}

function PaymentBadge({ value }: { value: string }) {
  const classes = value === "paid" ? "bg-emerald-100 text-emerald-800" : value === "partial" ? "bg-amber-100 text-amber-900" : "bg-rose-100 text-rose-800";
  return <span className={cn("inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold", classes)}>{paymentLabels[value as keyof typeof paymentLabels] ?? value}</span>;
}

function StageBadge({ stage, cancelled }: { stage: Stage; cancelled?: boolean }) {
  return <span className={cn("inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold", cancelled ? "bg-slate-100 text-slate-700" : stage === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800")}>{stageLabels[stage]}</span>;
}

function InfoRow({ icon: Icon, label, value, detail }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail?: string }) {
  return <div className="grid grid-cols-[28px_1fr] gap-3"><Icon className="mt-0.5 h-5 w-5 text-slate-500" /><div><span className="block text-xs font-medium text-slate-500">{label}</span><strong className="mt-0.5 block text-slate-900">{value}</strong>{detail && <span className="block text-xs text-slate-500">{detail}</span>}</div></div>;
}

const saleDocumentTypeLabels = {
  invoice: "Nota fiscal",
  content_declaration: "Declaração de conteúdo",
  other: "Outros",
} as const;

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SaleDocuments({ salePublicId, canWrite }: { salePublicId: string; canWrite: boolean }) {
  const utils = trpc.useUtils();
  const query = trpc.erp.sales.documents.list.useQuery({ salePublicId });
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [documentType, setDocumentType] = React.useState<keyof typeof saleDocumentTypeLabels>("invoice");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const uploadAttemptRef = React.useRef<string | null>(null);
  const refresh = async () => {
    await utils.erp.sales.invalidate();
  };
  const upload = trpc.erp.sales.documents.upload.useMutation({
    onSuccess: async () => {
      setOpen(false);
      setFile(null);
      setDescription("");
      setError("");
      uploadAttemptRef.current = null;
      await refresh();
    },
    onError: mutationError => setError(mutationError.message || "Não foi possível anexar o documento."),
  });
  const remove = trpc.erp.sales.documents.delete.useMutation({
    onSuccess: refresh,
    onError: mutationError => setError(mutationError.message || "Não foi possível remover o documento."),
  });
  const choose = (selected?: File) => {
    if (!selected) return;
    if (selected.size > 20 * 1024 * 1024) {
      setError("O arquivo excede o limite máximo de 20 MB.");
      return;
    }
    setFile(selected);
    setError("");
    uploadAttemptRef.current = crypto.randomUUID();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Selecione um arquivo para anexar.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Falha ao ler o arquivo."));
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
      reader.readAsDataURL(file);
    }).catch(readError => {
      setError(readError instanceof Error ? readError.message : "Falha ao ler o arquivo.");
      return null;
    });
    const base64 = dataUrl?.split(",")[1];
    if (!base64) return;
    const idempotencyKey = uploadAttemptRef.current ?? crypto.randomUUID();
    uploadAttemptRef.current = idempotencyKey;
    await upload.mutateAsync({
      salePublicId,
      idempotencyKey,
      documentType,
      fileName: file.name,
      description: description.trim() || null,
      mimeType: file.type || "application/octet-stream",
      base64,
    }).catch(() => undefined);
  };

  return (
    <section aria-label="Documentos privados da venda">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Paperclip className="h-4 w-4 text-slate-500" />Documentos</h3>
        {canWrite && <button type="button" className="text-xs font-semibold text-blue-700 hover:underline" onClick={() => { setError(""); uploadAttemptRef.current = null; setOpen(true); }}><UploadCloud className="mr-1 inline h-3.5 w-3.5" />Anexar</button>}
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">Arquivos privados vinculados ao pedido e exibidos no cadastro do cliente sem duplicação física.</p>
      {error && !open && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{error}</p>}
      {query.isLoading ? <p className="mt-3 text-xs text-slate-500">Carregando documentos…</p> : query.isError ? <p role="alert" className="mt-3 text-xs text-rose-700">Não foi possível carregar os documentos. <button className="font-semibold underline" onClick={() => void query.refetch()}>Tentar novamente</button></p> : query.data?.length ? (
        <div className="mt-3 space-y-2">
          {query.data.map(document => (
            <article key={document.publicId} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-xs text-slate-900">{document.fileName}</strong>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{document.documentTypeLabel} · {fileSize(document.sizeBytes)}</span>
                </div>
                <a href={`${document.downloadUrl}?preview=1`} target="_blank" rel="noreferrer" aria-label={`Visualizar ${document.fileName}`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700"><Eye className="h-3.5 w-3.5" /></a>
                <a href={document.downloadUrl} aria-label={`Baixar ${document.fileName}`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700"><Download className="h-3.5 w-3.5" /></a>
                {canWrite && <button type="button" disabled={remove.isPending} aria-label={`Remover ${document.fileName}`} className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50" onClick={() => window.confirm(`Remover “${document.fileName}” deste pedido?`) && remove.mutate({ salePublicId, documentPublicId: document.publicId })}><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            </article>
          ))}
        </div>
      ) : <p className="mt-3 rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500">Nenhum documento anexado.</p>}

      <Dialog open={open} onOpenChange={value => { if (!upload.isPending) { setOpen(value); if (!value) uploadAttemptRef.current = null; } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Anexar documento à venda</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={event => void submit(event)}>
            <input ref={inputRef} type="file" className="hidden" accept="application/pdf,image/png,image/jpeg,image/webp,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => choose(event.target.files?.[0])} />
            <button type="button" className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-4 text-center hover:border-blue-400 hover:bg-blue-50" onClick={() => inputRef.current?.click()}>
              <UploadCloud className="mb-2 h-6 w-6 text-blue-600" />
              <span className="max-w-full truncate text-sm font-semibold text-slate-800">{file?.name ?? "Selecionar arquivo"}</span>
              <span className="mt-1 text-xs text-slate-500">PDF, imagens, DOCX, XLSX, CSV ou TXT · até 20 MB</span>
            </button>
            <label className="block text-xs font-semibold text-slate-700">Categoria<select className="mt-1 min-h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={documentType} onChange={event => setDocumentType(event.target.value as keyof typeof saleDocumentTypeLabels)}>{Object.entries(saleDocumentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block text-xs font-semibold text-slate-700">Descrição <span className="font-normal text-slate-400">(opcional)</span><Input className="mt-1" maxLength={500} value={description} onChange={event => setDescription(event.target.value)} /></label>
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={upload.isPending} onClick={() => { setOpen(false); uploadAttemptRef.current = null; }}>Cancelar</Button><Button type="submit" disabled={!file || upload.isPending}>{upload.isPending ? "Anexando…" : "Anexar documento"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AddressSummary({ address }: { address: SalesAddress | null }) {
  if (!address) return <p className="mt-2 text-xs leading-5 text-amber-800">Endereço histórico não registrado nesta venda legada.</p>;
  const line = [address.street, address.number, address.complement].filter(Boolean).join(", ");
  const city = [address.district, address.city, address.state].filter(Boolean).join(" · ");
  return <address className="mt-2 not-italic text-xs leading-5 text-slate-600"><strong className="block text-slate-800">{address.recipientName || "Destinatário não informado"}</strong>{line || "Logradouro não informado"}<br />{city || "Cidade não informada"}{address.postalCode ? <><br />CEP {address.postalCode}</> : null}</address>;
}

function State({ title, description, retry, error }: { title: string; description?: string; retry?: () => void; error?: boolean }) {
  return <div role={error ? "alert" : "status"} className={cn("rounded-xl p-10 text-center", error ? "bg-rose-50 text-rose-900" : "border border-slate-200 bg-white text-slate-700")}><AlertCircle className={cn("mx-auto mb-3 h-6 w-6", error ? "text-rose-600" : "text-slate-400")} /><p className="font-semibold">{title}</p>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}{retry && <Button variant="outline" className="mt-4" onClick={retry}>Tentar novamente</Button>}</div>;
}

function formatQuantity(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function nextActionLabel(stage: Stage) {
  if (stage === "separation") return "Iniciar separação";
  if (stage === "shipped") return "Marcar como enviado";
  if (stage === "received") return "Marcar como recebido";
  if (stage === "completed") return "Concluir venda";
  return `Mover para ${stageLabels[stage]}`;
}

function eventLabel(eventType: string, toStage: string | null) {
  if (eventType === "created" || eventType === "draft") return "Venda criada";
  if (eventType === "updated") return "Rascunho atualizado";
  if (eventType === "confirmed") return "Venda confirmada";
  if (eventType === "cancelled") return "Venda cancelada";
  if (eventType === "address_corrected") return "Endereço corrigido";
  if (eventType === "payment_registered") return "Recebimento registrado";
  if (eventType === "document_added") return "Documento anexado";
  if (eventType === "document_removed") return "Documento removido";
  if (eventType === "stage_transition" && toStage && toStage in stageLabels) return `Etapa alterada para ${stageLabels[toStage as Stage]}`;
  return "Evento registrado";
}
