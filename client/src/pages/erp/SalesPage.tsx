import React from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  AlertCircle,
  ArrowLeft,
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
  Filter,
  MapPin,
  PackageCheck,
  PackageOpen,
  Plus,
  Paperclip,
  ReceiptText,
  RotateCcw,
  Search,
  SlidersHorizontal,
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
import { MoneyInput } from "@/components/erp/MoneyInput";
import { useDebounce } from "@/hooks/useDebounce";
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
  firstSalesStockIssue,
  hasDuplicateSalesItemIdentity,
  salesDraftFromForm,
  salesFormFromDetail,
  splitInstallments,
  type SalesAddress,
  type SalesForm,
} from "./sales-form";
import {
  SALES_LOOKUP_MIN_LENGTH,
  activeSalesFilterCount,
  canRunSalesLookup,
  salesAddressesMatch,
  salesConfirmationRequirements,
  salesDraftProgress,
  salesPaginationItems,
} from "./sales-ux";

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
type CustomerOption = CustomerResults["items"][number];
type CatalogOption = CatalogResults["items"][number];
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
  onSaleNavigate,
  onClientNavigate,
}: {
  initialSelectedId?: string;
  onSaleNavigate?: (salePublicId?: string) => void;
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
  const [filterCustomer, setFilterCustomer] = React.useState<CustomerOption | null>(null);
  const [filterCustomerSearch, setFilterCustomerSearch] = React.useState("");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = React.useState(false);
  const [from, setFrom] = React.useState(month.from);
  const [to, setTo] = React.useState(month.to);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialSelectedId ?? null
  );
  const [form, setForm] = React.useState<SalesForm | null>(null);
  const [customerSearch, setCustomerSearch] = React.useState("");
  const [catalogSearch, setCatalogSearch] = React.useState("");
  const [customerPage, setCustomerPage] = React.useState(1);
  const [catalogPage, setCatalogPage] = React.useState(1);
  const [separateBillingAddress, setSeparateBillingAddress] = React.useState(false);
  const [expandedCatalogProductId, setExpandedCatalogProductId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");
  const [confirmation, setConfirmation] = React.useState<ConfirmationState | null>(null);
  const [cancellation, setCancellation] = React.useState<ReasonState | null>(null);
  const [transition, setTransition] = React.useState<TransitionState | null>(null);
  const [addressCorrection, setAddressCorrection] = React.useState<AddressCorrectionState | null>(null);

  const metrics = trpc.erp.sales.metrics.useQuery({ from, to });
  const debouncedListSearch = useDebounce(search.trim(), 300);
  const debouncedCustomerSearch = useDebounce(customerSearch.trim(), 300);
  const debouncedCatalogSearch = useDebounce(catalogSearch.trim(), 300);
  const debouncedFilterCustomerSearch = useDebounce(filterCustomerSearch.trim(), 300);
  const customerLookupEnabled = Boolean(form) && canRunSalesLookup(debouncedCustomerSearch);
  const catalogLookupEnabled = Boolean(form) && canRunSalesLookup(debouncedCatalogSearch);
  const filterCustomerLookupEnabled = canRunSalesLookup(debouncedFilterCustomerSearch);

  const list = trpc.erp.sales.list.useQuery({
    search: debouncedListSearch,
    crmClientId: filterCustomer?.crmClientId,
    stage: stage === "all" ? undefined : stage,
    paymentStatus: paymentStatus === "all" ? undefined : paymentStatus,
    paymentMethod: paymentMethod === "all" ? undefined : paymentMethod,
    sellerUserId: sellerUserId === "all" ? undefined : sellerUserId,
    from,
    to,
    sort: "createdAt",
    direction: "desc",
    page,
    pageSize,
  });
  const options = trpc.erp.sales.options.useQuery();
  const detail = trpc.erp.sales.detail.useQuery(
    { publicId: selectedId! },
    { enabled: Boolean(selectedId) }
  );
  const customers = trpc.erp.sales.customers.useQuery(
    { search: debouncedCustomerSearch, page: customerPage, pageSize: 12 },
    { enabled: customerLookupEnabled }
  );
  const catalog = trpc.erp.sales.catalog.useQuery(
    { search: debouncedCatalogSearch, page: catalogPage, pageSize: 12 },
    { enabled: catalogLookupEnabled }
  );
  const filterCustomers = trpc.erp.sales.customers.useQuery(
    { search: debouncedFilterCustomerSearch, page: 1, pageSize: 8 },
    { enabled: filterCustomerLookupEnabled }
  );

  React.useEffect(() => {
    setSelectedId(initialSelectedId ?? null);
  }, [initialSelectedId]);

  React.useEffect(() => {
    if (!list.data) return;
    const lastPage = Math.max(1, list.data.totalPages);
    if (page > lastPage) setPage(lastPage);
  }, [list.data, page]);

  const openSale = React.useCallback((publicId: string) => {
    setSelectedId(publicId);
    onSaleNavigate?.(publicId);
  }, [onSaleNavigate]);

  const closeSale = React.useCallback(() => {
    setSelectedId(null);
    onSaleNavigate?.();
  }, [onSaleNavigate]);

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
      if (id) openSale(id);
      await refresh();
    },
    [openSale, refresh]
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
  const createFinancialCategory = trpc.erp.finance.categories.create.useMutation({
    onSuccess: async result => {
      setConfirmation(current => current ? { ...current, categoryPublicId: result.publicId } : current);
      await utils.erp.sales.options.invalidate();
    },
  });
  const createFinancialAccount = trpc.erp.finance.accounts.create.useMutation({
    onSuccess: async result => {
      setConfirmation(current => current ? { ...current, financialAccountPublicId: result.publicId } : current);
      await utils.erp.sales.options.invalidate();
    },
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
    const stockIssue = firstSalesStockIssue(form.items);
    if (stockIssue) {
      setMessage(
        `Estoque insuficiente para ${stockIssue.productName}. Disponível: ${formatQuantity(stockIssue.availableQuantity)}. Solicitado: ${formatQuantity(stockIssue.requestedQuantity)}.`
      );
      return;
    }
    const command = salesDraftFromForm(form);
    if (form.publicId) update.mutate({ ...command, publicId: form.publicId });
    else create.mutate(command);
  };

  const edit = async (publicId: string) => {
    const selected = await utils.erp.sales.detail.fetch({ publicId });
    setForm(salesFormFromDetail(selected));
    setCustomerSearch("");
    setCatalogSearch("");
    setSeparateBillingAddress(
      !salesAddressesMatch(selected.shippingAddress, selected.billingAddress)
    );
    setExpandedCatalogProductId(null);
    setCustomerPage(1);
    setCatalogPage(1);
  };

  const clearFilters = () => {
    setSearch("");
    setStage("all");
    setPaymentStatus("all");
    setPaymentMethod("all");
    setSellerUserId("all");
    setFilterCustomer(null);
    setFilterCustomerSearch("");
    setFrom(month.from);
    setTo(month.to);
    setPage(1);
  };
  const activeFilterCount = activeSalesFilterCount({
    search,
    stage,
    paymentStatus,
    paymentMethod,
    sellerUserId,
    customerId: filterCustomer?.crmClientId,
    from,
    to,
    defaultFrom: month.from,
    defaultTo: month.to,
  });

  return (
    <div
      className="min-w-0 space-y-5 selection:bg-blue-100 selection:text-blue-950"
      data-testid="erp-sales-page"
    >
      <div className={selectedId ? "hidden" : "contents"} aria-hidden={selectedId ? true : undefined}>
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
                setSeparateBillingAddress(false);
                setExpandedCatalogProductId(null);
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

      <div className="min-w-0 space-y-5">
        <section className="min-w-0 space-y-3" aria-label="Lista de vendas">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_8px_24px_-22px_rgba(15,23,42,0.45)]" data-testid="sales-filters">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_170px_300px_auto_auto]">
              <label className="relative min-w-0">
                <span className="sr-only">Busca</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  aria-label="Buscar por venda, cliente, produto ou SKU"
                  className="bg-white pl-9"
                  placeholder="Buscar venda, cliente, produto ou SKU"
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
              <label className="grid grid-cols-2 gap-1" aria-label="Período das vendas">
                <Input type="date" aria-label="Data inicial" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} />
                <Input type="date" aria-label="Data final" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} />
              </label>
              <Button type="button" variant="outline" className="justify-between" aria-expanded={advancedFiltersOpen} onClick={() => setAdvancedFiltersOpen(value => !value)}>
                <SlidersHorizontal className="mr-2 h-4 w-4" /> Mais filtros
                {activeFilterCount > 0 && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">{activeFilterCount}</span>}
              </Button>
              <Button type="button" variant="ghost" className="text-slate-600" disabled={activeFilterCount === 0} onClick={clearFilters}>Limpar</Button>
            </div>

            {advancedFiltersOpen && (
              <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtros avançados">
                <div className="relative min-w-0">
                  <span className="text-xs font-semibold text-slate-600">Cliente</span>
                  {filterCustomer ? (
                    <div className="mt-1 flex h-10 items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm text-blue-950">
                      <span className="truncate font-medium">{filterCustomer.customerName}</span>
                      <button type="button" aria-label="Remover filtro de cliente" className="rounded p-1 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => { setFilterCustomer(null); setPage(1); }}><XCircle className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <>
                      <Search className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-slate-500" />
                      <Input aria-label="Filtrar por cliente" className="mt-1 pl-9" placeholder="Buscar cliente" value={filterCustomerSearch} onChange={event => setFilterCustomerSearch(event.target.value)} />
                      {filterCustomerLookupEnabled && (
                        <div className="absolute left-0 right-0 top-[4.5rem] z-30 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl [scrollbar-width:thin]">
                          {filterCustomers.isLoading ? <p className="p-3 text-sm text-slate-500">Buscando clientes…</p> : filterCustomers.isError ? <p className="p-3 text-sm text-rose-700">Não foi possível buscar clientes.</p> : filterCustomers.data?.items.length ? filterCustomers.data.items.map(customer => (
                            <button type="button" key={customer.crmClientId} className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => { setFilterCustomer(customer); setFilterCustomerSearch(""); setPage(1); }}>
                              <strong className="block truncate text-sm text-slate-900">{customer.customerName}</strong>
                              <span className="block truncate text-xs text-slate-500">{customer.document || customer.responsibleName || customer.crmClientId}</span>
                            </button>
                          )) : <p className="p-3 text-sm text-slate-500">Nenhum cliente encontrado.</p>}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <label className="text-xs font-semibold text-slate-600">Pagamento
                  <select className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800" value={paymentStatus} onChange={event => { setPaymentStatus(event.target.value as typeof paymentStatus); setPage(1); }}>
                    <option value="all">Todos os pagamentos</option><option value="pending">Pendente</option><option value="partial">Pagamento parcial</option><option value="paid">Pago</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">Forma de pagamento
                  <select className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800" value={paymentMethod} onChange={event => { setPaymentMethod(event.target.value); setPage(1); }}>
                    <option value="all">Todas as formas</option>{options.data?.paymentMethods.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">Vendedor
                  <select className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800" value={sellerUserId} onChange={event => { setSellerUserId(event.target.value); setPage(1); }}>
                    <option value="all">Todos os vendedores</option>{options.data?.sellers.map(value => <option key={value.publicId} value={value.publicId}>{value.name}</option>)}
                  </select>
                </label>
              </div>
            )}

            {activeFilterCount > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs" aria-label="Filtros ativos">
                <Filter className="h-3.5 w-3.5 text-slate-500" /><span className="font-semibold text-slate-600">Filtros ativos:</span>
                {search.trim() && <span className="rounded-full bg-slate-100 px-2.5 py-1">Busca: {search.trim()}</span>}
                {stage !== "all" && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-800">Etapa: {stageLabels[stage]}</span>}
                {filterCustomer && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-800">Cliente: {filterCustomer.customerName}</span>}
                {paymentStatus !== "all" && <span className="rounded-full bg-slate-100 px-2.5 py-1">Pagamento: {paymentLabels[paymentStatus]}</span>}
                {paymentMethod !== "all" && <span className="rounded-full bg-slate-100 px-2.5 py-1">Forma: {paymentMethod}</span>}
                {sellerUserId !== "all" && <span className="rounded-full bg-slate-100 px-2.5 py-1">Vendedor selecionado</span>}
                {(from !== month.from || to !== month.to) && <span className="rounded-full bg-slate-100 px-2.5 py-1">Período personalizado</span>}
                <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={clearFilters}>Limpar filtros</button>
              </div>
            )}
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
            <div className="overflow-visible rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_-20px_rgba(15,23,42,0.55)]">
              <div className="hidden grid-cols-[64px_minmax(190px,1.5fr)_minmax(140px,1fr)_120px_135px_120px_44px] items-center gap-3 rounded-t-xl bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600 lg:grid">
                <span>Produto</span><span>Venda</span><span>Cliente</span><span className="text-right">Total</span><span>Pagamento</span><span>Etapa</span><span className="sr-only">Ações</span>
              </div>
              <div className="divide-y divide-slate-100">
                {list.data.items.map(order => (
                  <article key={order.publicId} className="group relative p-3 transition-colors hover:bg-slate-50/80 sm:p-4 lg:grid lg:grid-cols-[64px_minmax(190px,1.5fr)_minmax(140px,1fr)_120px_135px_120px_44px] lg:items-center lg:gap-3" data-testid={`sale-row-${order.publicId}`}>
                    <button type="button" className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" aria-label={`Abrir venda ${order.orderNumber}`} onClick={() => openSale(order.publicId)} />
                    <div className="pointer-events-none relative z-10 grid grid-cols-[48px_minmax(0,1fr)] items-start gap-x-3 lg:contents">
                      <ProductThumb imagePath={order.firstProductImage?.thumbnailPath} name={order.firstProductName ?? order.orderNumber} />
                      <div className="min-w-0 lg:block">
                        <strong className="block text-sm text-blue-800">{order.orderNumber}</strong>
                        <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900">{order.firstProductName ?? "Itens históricos indisponíveis"}{order.itemCount > 1 ? ` · +${order.itemCount - 1}` : ""}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{date.format(new Date(order.createdAt))} · {order.itemCount} {order.itemCount === 1 ? "item" : "itens"}</span>
                      </div>
                      <div className="col-start-2 mt-3 min-w-0 lg:col-auto lg:mt-0"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:hidden">Cliente</span><p className="truncate text-sm font-semibold text-slate-800">{order.customerName}</p></div>
                      <div className="col-start-2 mt-3 lg:col-auto lg:mt-0 lg:text-right"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:hidden">Total</span><strong className="block text-sm tabular-nums text-slate-950">{money.format(order.totalCents / 100)}</strong></div>
                      <div className="col-start-2 mt-3 lg:col-auto lg:mt-0"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:hidden">Pagamento</span><PaymentBadge value={order.paymentStatus} /></div>
                      <div className="col-start-2 mt-3 lg:col-auto lg:mt-0"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:hidden">Etapa</span><StageBadge stage={order.currentStage as Stage} cancelled={order.cancelled} /></div>
                    </div>
                    <details className="absolute right-3 top-3 z-20 justify-self-end sm:right-4 sm:top-4 lg:relative lg:right-auto lg:top-auto lg:mt-0">
                      <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`Ações da venda ${order.orderNumber}`}><span aria-hidden="true" className="text-xl leading-none">⋯</span></summary>
                      <div className="absolute right-0 top-10 z-30 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
                        <button type="button" className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => openSale(order.publicId)}>Ver detalhes</button>
                        {canWrite && order.currentStage === "created" && !order.cancelled && <button type="button" className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => void edit(order.publicId)}>Editar rascunho</button>}
                      </div>
                    </details>
                  </article>
                ))}
              </div>
            </div>
          )}

          {list.data && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
              <span className="tabular-nums">
                {list.data.total === 0
                  ? "Nenhuma venda"
                  : `Mostrando ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, list.data.total)} de ${list.data.total} vendas`}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  Itens por página
                  <select
                    aria-label="Itens por página"
                    className="h-9 rounded-md border border-input bg-white px-2 text-sm"
                    value={pageSize}
                    onChange={event => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                  >
                    {[10, 20, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                {list.data.totalPages > 1 && (
                  <nav aria-label="Paginação das vendas" className="flex items-center gap-1">
                    <Button variant="outline" size="sm" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>‹</Button>
                    {salesPaginationItems(page, list.data.totalPages).map(item =>
                      typeof item === "number" ? (
                        <Button key={item} variant={item === page ? "default" : "outline"} size="sm" aria-current={item === page ? "page" : undefined} aria-label={`Página ${item}`} onClick={() => setPage(item)}>{item}</Button>
                      ) : (
                        <span key={item} className="px-1 text-slate-400" aria-hidden="true">…</span>
                      )
                    )}
                    <Button variant="outline" size="sm" aria-label="Próxima página" disabled={page >= list.data.totalPages} onClick={() => setPage(value => value + 1)}>›</Button>
                  </nav>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      </div>

      {selectedId && (
        <section className="min-w-0 space-y-4" aria-label="Detalhe da venda" data-testid="sales-detail-screen">
          <Button type="button" variant="ghost" className="-ml-2 text-slate-700" onClick={closeSale}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar para vendas
          </Button>
          <SaleDetailPanel
          query={detail}
          canWrite={detail.data?.canWrite === true}
          onRetry={() => void detail.refetch()}
          onEdit={id => void edit(id)}
          onConfirm={order =>
            setConfirmation({
              publicId: order.publicId,
              idempotencyKey: crypto.randomUUID(),
               totalCents: order.totalCents,
               paymentStatus: "pending",
               receivedCents: 0,
               paymentMethod: options.data?.paymentMethods[0] ?? "PIX",
              categoryPublicId: options.data?.categories[0]?.publicId ?? "",
              financialAccountPublicId: options.data?.accounts[0]?.publicId ?? "",
              installmentCount: 1,
              firstDueDate: new Date().toISOString().slice(0, 10),
              hasCustomer: Boolean(order.crmClientId),
              hasProducts: order.items.length > 0,
              hasAddress: Boolean(order.shippingAddress?.street && order.shippingAddress?.city),
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
        </section>
      )}

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
        customerLookupEnabled={customerLookupEnabled}
        catalogLookupEnabled={catalogLookupEnabled}
        separateBillingAddress={separateBillingAddress}
        setSeparateBillingAddress={setSeparateBillingAddress}
        expandedCatalogProductId={expandedCatalogProductId}
        setExpandedCatalogProductId={setExpandedCatalogProductId}
        busy={create.isPending || update.isPending}
        onSubmit={save}
      />

      <ConfirmationDialog
        state={confirmation}
        setState={setConfirmation}
        categories={options.data?.categories ?? []}
        accounts={options.data?.accounts ?? []}
        paymentMethods={options.data?.paymentMethods ?? []}
        optionsLoading={options.isLoading}
        optionsError={options.error?.message}
        onRetryOptions={() => void options.refetch()}
        busy={confirmSale.isPending}
        categoryCreationBusy={createFinancialCategory.isPending}
        accountCreationBusy={createFinancialAccount.isPending}
        financialSetupError={createFinancialCategory.error?.message ?? createFinancialAccount.error?.message}
        onCreateCategory={name => createFinancialCategory.mutate({ name, direction: "receivable" })}
        onCreateAccount={(name, type) => createFinancialAccount.mutate({ name, type, initialBalanceCents: 0, allowNegative: false })}
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
             receivedCents: state.receivedCents,
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
    <aside className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_14px_30px_-26px_rgba(15,23,42,0.65)]" aria-label="Detalhes da venda selecionada">
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

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="grid gap-4 rounded-xl border border-slate-200 p-4 text-sm xl:col-start-1 xl:row-start-1">
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

        <section className="rounded-xl border border-slate-200 p-4 xl:col-span-2 xl:row-start-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Edit3 className="h-4 w-4 text-slate-500" />Etapa da venda</h3>
          <SaleTimeline stage={order.currentStage as Stage} cancelled={order.cancelled} />
          <p className="mt-3 text-xs leading-5 text-slate-600">
            A confirmação não reserva estoque. A disponibilidade é revalidada e a baixa ocorre somente ao marcar como Enviado.
          </p>
        </section>

        <section className="rounded-xl bg-slate-50 p-4 xl:col-start-2 xl:row-start-1">
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

        <section className="rounded-xl bg-blue-50 p-4 text-blue-950 xl:col-start-2 xl:row-start-3">
          <h3 className="flex items-center gap-2 text-sm font-bold"><Box className="h-4 w-4" />Estoque</h3>
          {stageOrder.indexOf(order.currentStage as Stage) >= stageOrder.indexOf("shipped") ? (
            <p className="mt-2 text-sm">Saída registrada no envio. Concluir a venda não gera nova movimentação.</p>
          ) : (
            <p className="mt-2 text-sm">Sem reserva. O saldo permanece disponível até o envio.</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 p-4 xl:col-start-1 xl:row-start-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><MapPin className="h-4 w-4 text-slate-500" />Endereço de entrega</h3>
            {canWrite && canCorrectAddress && !order.cancelled && (
              <button type="button" className="text-xs font-semibold text-blue-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => onCorrectAddress(order)}>Corrigir</button>
            )}
          </div>
          <AddressSummary address={order.shippingAddress} />
        </section>

        <div className="min-w-0 xl:col-start-1 xl:row-start-4">
          <SaleDocuments
            salePublicId={order.publicId}
            canWrite={canWrite && !order.cancelled}
          />
        </div>

        <section className="min-w-0 rounded-xl border border-slate-200 p-4 xl:col-start-2 xl:row-start-4">
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
    <div className="mt-4 min-w-0 overflow-x-auto pb-2 [scrollbar-width:thin]">
      <ol className="grid w-full min-w-[640px] grid-cols-6 sm:min-w-0" aria-label="Timeline das etapas da venda">
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
              <span className={cn("mt-2 block text-[11px] font-semibold leading-4", active ? "text-blue-700" : "text-slate-500")}>{stageLabels[value]}</span>
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
  customerLookupEnabled,
  catalogLookupEnabled,
  separateBillingAddress,
  setSeparateBillingAddress,
  expandedCatalogProductId,
  setExpandedCatalogProductId,
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
  customers: { data?: CustomerResults; isLoading: boolean; isError: boolean };
  catalog: { data?: CatalogResults; isLoading: boolean; isError: boolean };
  customerLookupEnabled: boolean;
  catalogLookupEnabled: boolean;
  separateBillingAddress: boolean;
  setSeparateBillingAddress: React.Dispatch<React.SetStateAction<boolean>>;
  expandedCatalogProductId: string | null;
  setExpandedCatalogProductId: React.Dispatch<React.SetStateAction<string | null>>;
  busy: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  if (!form) return null;
  const totals = calculateSalesFormTotals(form);
  const stockIssue = firstSalesStockIssue(form.items);
  const progress = salesDraftProgress(form);
  const completeSteps = progress.filter(item => item.complete).length;
  const patchItem = (index: number, patch: Record<string, unknown>) =>
    setForm(current =>
      current
        ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }
        : current
    );
  const addCatalogItem = (product: CatalogOption) => {
    if (Number(product.availableQuantity) <= 0) return;
    if (form.items.some(item => item.inventoryItemPublicId === product.inventoryItemPublicId)) return;
    setForm(current => current ? { ...current, items: [...current.items, {
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
    }] } : current);
    setCatalogSearch("");
    setExpandedCatalogProductId(null);
  };
  const groups = (catalog.data?.items ?? []).reduce<Array<{ productPublicId: string; name: string; imagePath?: string | null; options: CatalogOption[] }>>((result, item) => {
    const current = result.find(group => group.productPublicId === item.productPublicId);
    if (current) current.options.push(item);
    else result.push({ productPublicId: item.productPublicId, name: item.name, imagePath: item.canonicalImage?.thumbnailPath, options: [item] });
    return result;
  }, []);

  return (
    <Dialog open onOpenChange={open => !open && setForm(null)}>
      <DialogContent className="flex h-[min(94vh,920px)] flex-col gap-0 overflow-hidden bg-slate-50 p-0 sm:max-w-[min(96vw,1440px)]">
        <DialogHeader className="border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div className="pr-10">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Operação de vendas</p>
            <DialogTitle className="mt-1 text-xl">{form.publicId ? "Editar venda" : "Nova venda"}</DialogTitle>
            <p className="mt-1 text-sm text-slate-600">Complete a operação por etapas. A venda será salva primeiro como rascunho.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Progresso da nova venda">
            {progress.map((item, index) => <span key={item.key} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", item.complete ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600")}><span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-[10px]", item.complete ? "bg-emerald-600 text-white" : "bg-slate-300 text-slate-700")}>{item.complete ? <Check className="h-3 w-3" /> : index + 1}</span>{item.label}</span>)}
          </div>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 [scrollbar-width:thin]">
            <div className="mx-auto grid max-w-[1320px] gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
              <div className="space-y-5">
                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="sale-customer-heading">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-blue-700">1. Identificação</p><h3 id="sale-customer-heading" className="mt-1 font-bold text-slate-950">Cliente</h3><p className="mt-1 text-sm text-slate-500">Pesquise por nome, documento ou código. Nenhum cadastro é carregado antes da busca.</p></div>{form.crmClientId && <Button type="button" size="sm" variant="ghost" onClick={() => { setForm(current => current ? { ...current, crmClientId: "", customerName: "", shippingAddress: blankSalesAddress(), billingAddress: blankSalesAddress() } : current); setCustomerSearch(""); }}>Trocar cliente</Button>}</div>
                  {form.crmClientId ? (
                    <div className="mt-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white"><UserRound className="h-5 w-5" /></span><div className="min-w-0"><strong className="block truncate text-slate-950">{form.customerName}</strong><span className="text-xs text-slate-600">Cliente selecionado para esta venda</span></div><Check className="ml-auto h-5 w-5 text-emerald-600" /></div>
                  ) : (
                    <div className="relative mt-4">
                      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
                      <Input autoComplete="off" className="pl-9" aria-label="Buscar cliente para a venda" placeholder="Digite ao menos 2 caracteres" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} />
                      <div className="mt-2 rounded-lg border border-slate-200 bg-white">
                        {!customerLookupEnabled ? <p className="p-4 text-sm text-slate-500">Comece a digitar para localizar um cliente.</p> : customers.isLoading ? <p role="status" className="p-4 text-sm text-slate-500">Buscando clientes…</p> : customers.isError ? <p role="alert" className="p-4 text-sm text-rose-700">Não foi possível buscar clientes.</p> : customers.data?.items.length ? <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto [scrollbar-width:thin]">{customers.data.items.map(customer => (
                          <button type="button" key={customer.crmClientId} className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" onClick={() => { const address: SalesAddress = { recipientName: customer.responsibleName || customer.customerName, postalCode: customer.postalCode || "", street: customer.address || "", number: "", complement: "", district: "", city: customer.city || "", state: customer.state || "" }; setForm(current => current ? { ...current, crmClientId: customer.crmClientId, customerName: customer.customerName, shippingAddress: address, billingAddress: { ...address } } : current); setCustomerSearch(""); setSeparateBillingAddress(false); }}><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span className="min-w-0"><strong className="block truncate text-sm text-slate-900">{customer.customerName}</strong><span className="block truncate text-xs text-slate-500">{[customer.document, customer.responsibleName, [customer.city, customer.state].filter(Boolean).join("/")].filter(Boolean).join(" · ") || customer.crmClientId}</span></span></button>
                        ))}</div> : <p className="p-4 text-sm text-slate-500">Nenhum cliente encontrado para “{customerSearch.trim()}”.</p>}
                      </div>
                      {customerLookupEnabled && <SearchPager page={customerPage} total={customers.data?.total ?? 0} pageSize={customers.data?.pageSize ?? 12} onPage={setCustomerPage} />}
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="sale-products-heading">
                  <div><p className="text-xs font-semibold text-blue-700">2. Itens</p><h3 id="sale-products-heading" className="mt-1 font-bold text-slate-950">Produtos e variações</h3><p className="mt-1 text-sm text-slate-500">Pesquise o produto; as variações aparecem somente quando você abrir o resultado.</p></div>
                  <label className="relative mt-4 block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><Input autoComplete="off" className="pl-9" aria-label="Buscar produto para a venda" placeholder="Nome, SKU, código ou variação" value={catalogSearch} onChange={event => { setCatalogSearch(event.target.value); setExpandedCatalogProductId(null); }} /></label>
                  <div className="mt-2 rounded-lg border border-slate-200">
                    {!catalogLookupEnabled ? <p className="p-4 text-sm text-slate-500">Digite ao menos {SALES_LOOKUP_MIN_LENGTH} caracteres para pesquisar o catálogo.</p> : catalog.isLoading ? <p role="status" className="p-4 text-sm text-slate-500">Buscando produtos…</p> : catalog.isError ? <p role="alert" className="p-4 text-sm text-rose-700">Não foi possível buscar produtos.</p> : groups.length ? <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto [scrollbar-width:thin]">{groups.map(group => {
                      const expanded = expandedCatalogProductId === group.productPublicId;
                      const singleOption = group.options.length === 1 ? group.options[0] : null;
                      const singleUnavailable = Boolean(singleOption && Number(singleOption.availableQuantity) <= 0);
                      return <div key={group.productPublicId} className="p-2"><button type="button" disabled={singleUnavailable} className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50" aria-expanded={group.options.length > 1 ? expanded : undefined} onClick={() => singleOption ? addCatalogItem(singleOption) : setExpandedCatalogProductId(expanded ? null : group.productPublicId)}><ProductThumb imagePath={group.imagePath} name={group.name} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-900">{group.name}</strong><span className="block text-xs text-slate-500">{singleOption ? `${singleOption.sku} · ${singleUnavailable ? "sem estoque" : `disponível ${formatQuantity(singleOption.availableQuantity)}`}` : `${group.options.length} variações encontradas`}</span></span>{singleOption ? <Plus className="h-4 w-4 text-blue-700" /> : expanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}</button>{expanded && <div className="ml-12 mt-1 space-y-1 border-l border-slate-200 pl-3">{group.options.map(option => { const used = form.items.some(item => item.inventoryItemPublicId === option.inventoryItemPublicId); const unavailable = Number(option.availableQuantity) <= 0; return <button type="button" key={option.inventoryItemPublicId} disabled={used || unavailable} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-45" onClick={() => addCatalogItem(option)}><span className="min-w-0"><strong className="block truncate text-slate-900">{option.variantAttributes || option.variantName || "Produto padrão"}</strong><span className="block truncate text-xs text-slate-500">{option.sku} · {unavailable ? "sem estoque" : `disponível ${formatQuantity(option.availableQuantity)}`}</span></span><span className="shrink-0 font-semibold tabular-nums">{money.format(option.salePriceCents / 100)}</span></button>; })}</div>}</div>;
                    })}</div> : <p className="p-4 text-sm text-slate-500">Nenhum produto encontrado para “{catalogSearch.trim()}”.</p>}
                  </div>
                  {catalogLookupEnabled && <SearchPager page={catalogPage} total={catalog.data?.total ?? 0} pageSize={catalog.data?.pageSize ?? 12} onPage={setCatalogPage} />}

                  <div className="mt-4 space-y-2">
                    {form.items.length ? form.items.map((item, index) => (
                      <div key={`${item.inventoryItemPublicId}-${index}`} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(210px,1fr)_100px_145px_135px_110px_36px] md:items-end">
                        <div className="flex min-w-0 items-center gap-3 self-center"><ProductThumb imagePath={item.imagePath} name={item.productName ?? "Produto"} /><div className="min-w-0"><strong className="block truncate text-sm text-slate-900">{item.productName ?? item.productPublicId}</strong><span className="block truncate text-xs text-slate-500">{item.variantName || item.sku} · disponível {item.availableQuantity ? formatQuantity(item.availableQuantity) : "—"}</span></div></div>
                        <MoneyOrQuantity label="Quantidade" value={item.quantity} onChange={value => patchItem(index, { quantity: value })} />
                        <MoneyOrQuantity money label="Preço unit." value={item.unitPriceCents} onChange={value => patchItem(index, { unitPriceCents: value })} />
                        <MoneyOrQuantity money label="Desconto" value={item.discountCents ?? 0} onChange={value => patchItem(index, { discountCents: value })} />
                        <div className="text-right"><span className="text-xs font-semibold text-slate-600">Subtotal</span><strong className="mt-2 block text-sm tabular-nums text-slate-950">{money.format(Math.max(0, Math.round(Number(item.quantity || 0) * item.unitPriceCents) - (item.discountCents ?? 0)) / 100)}</strong></div>
                        <Button type="button" size="icon" variant="ghost" aria-label={`Remover ${item.productName ?? "produto"}`} className="text-rose-700" onClick={() => setForm(current => current ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )) : <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Pesquise e adicione o primeiro produto da venda.</div>}
                  </div>
                  {stockIssue && (
                    <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                      Estoque insuficiente para {stockIssue.productName}. Disponível: {formatQuantity(stockIssue.availableQuantity)}. Solicitado: {formatQuantity(stockIssue.requestedQuantity)}.
                    </p>
                  )}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="sale-address-heading">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-blue-700">3. Entrega</p><h3 id="sale-address-heading" className="mt-1 font-bold text-slate-950">Endereço do cliente</h3><p className="mt-1 text-sm text-slate-500">Este endereço ficará preservado no histórico da venda.</p></div><Button type="button" size="sm" variant="outline" onClick={() => { setSeparateBillingAddress(value => !value); if (separateBillingAddress) setForm(current => current ? { ...current, billingAddress: { ...(current.shippingAddress ?? blankSalesAddress()) } } : current); }}>{separateBillingAddress ? "Usar um único endereço" : "Usar outro endereço de cobrança"}</Button></div>
                  <div className={cn("mt-4 grid gap-4", separateBillingAddress && "lg:grid-cols-2")}><AddressFields title={separateBillingAddress ? "Entrega" : undefined} address={form.shippingAddress ?? blankSalesAddress()} onChange={shippingAddress => setForm(current => current ? { ...current, shippingAddress, billingAddress: separateBillingAddress ? current.billingAddress : { ...shippingAddress } } : current)} />{separateBillingAddress && <AddressFields title="Cobrança" address={form.billingAddress ?? blankSalesAddress()} onChange={billingAddress => setForm(current => current ? { ...current, billingAddress } : current)} />}</div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="sale-values-heading">
                  <div><p className="text-xs font-semibold text-blue-700">4. Valores e prazo</p><h3 id="sale-values-heading" className="mt-1 font-bold text-slate-950">Condições comerciais</h3></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="text-xs font-semibold text-slate-700">Previsão de entrega<Input className="mt-1" type="date" value={form.expectedDate} onChange={event => setForm(current => current ? { ...current, expectedDate: event.target.value } : current)} /></label><MoneyOrQuantity money label="Desconto da venda" value={form.orderDiscountCents ?? 0} onChange={value => setForm(current => current ? { ...current, orderDiscountCents: value } : current)} /><MoneyOrQuantity money label="Frete" value={form.freightCents ?? 0} onChange={value => setForm(current => current ? { ...current, freightCents: value } : current)} /></div>
                  <label className="mt-4 block text-xs font-semibold text-slate-700">Observações<textarea className="mt-1 min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={form.notes} onChange={event => setForm(current => current ? { ...current, notes: event.target.value } : current)} /></label>
                </section>
              </div>

              <aside className="self-start rounded-xl border border-slate-200 bg-white p-5 xl:sticky xl:top-0" aria-label="Resumo da venda em edição">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Resumo</p><h3 className="mt-1 text-lg font-bold text-slate-950">{completeSteps}/{progress.length} etapas preenchidas</h3>
                <div className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3 text-slate-600"><span>Produtos</span><strong className="text-slate-950">{form.items.length}</strong></div><div className="flex justify-between gap-3 text-slate-600"><span>Subtotal</span><strong className="tabular-nums text-slate-950">{money.format(totals.subtotalCents / 100)}</strong></div><div className="flex justify-between gap-3 text-slate-600"><span>Descontos</span><strong className="tabular-nums text-slate-950">− {money.format(totals.discountCents / 100)}</strong></div><div className="flex justify-between gap-3 text-slate-600"><span>Frete</span><strong className="tabular-nums text-slate-950">{money.format((form.freightCents ?? 0) / 100)}</strong></div><div className="flex justify-between gap-3 border-t border-slate-200 pt-3 text-base"><strong>Total</strong><strong className="tabular-nums text-blue-700">{money.format(totals.totalCents / 100)}</strong></div></div>
                <div className="mt-5 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900"><strong className="block">Próximo passo</strong>Salve o rascunho. A forma de pagamento, categoria, conta prevista e parcelas serão revisadas antes da confirmação.</div>
              </aside>
            </div>
          </div>
          <DialogFooter className="border-t border-slate-200 bg-white px-5 py-3 sm:px-7"><Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" disabled={busy || Boolean(stockIssue) || !form.crmClientId || !form.items.length || totals.totalCents <= 0 || (form.freightCents ?? 0) < 0}>{busy ? "Salvando…" : "Salvar rascunho"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmationState = {
  publicId: string;
  idempotencyKey: string;
  totalCents: number;
  paymentStatus: "pending" | "partial" | "paid";
  receivedCents: number;
  paymentMethod: string;
  categoryPublicId: string;
  financialAccountPublicId: string;
  installmentCount: number;
  firstDueDate: string;
  hasCustomer: boolean;
  hasProducts: boolean;
  hasAddress: boolean;
};

function ConfirmationDialog({ state, setState, categories, accounts, paymentMethods, optionsLoading, optionsError, busy, categoryCreationBusy, accountCreationBusy, financialSetupError, onRetryOptions, onCreateCategory, onCreateAccount, onConfirm }: {
  state: ConfirmationState | null;
  setState: React.Dispatch<React.SetStateAction<ConfirmationState | null>>;
  categories: Array<{ publicId: string; name: string }>;
  accounts: Array<{ publicId: string; name: string }>;
  paymentMethods: string[];
  optionsLoading: boolean;
  optionsError?: string;
  busy: boolean;
  categoryCreationBusy: boolean;
  accountCreationBusy: boolean;
  financialSetupError?: string;
  onRetryOptions: () => void;
  onCreateCategory: (name: string) => void;
  onCreateAccount: (name: string, type: "cash" | "bank") => void;
  onConfirm: (state: ConfirmationState) => void;
}) {
  const [categoryName, setCategoryName] = React.useState("");
  const [accountName, setAccountName] = React.useState("");
  const [accountType, setAccountType] = React.useState<"cash" | "bank">("bank");
  const [setup, setSetup] = React.useState<"category" | "account" | null>(null);
  if (!state) return null;
  const installments = splitInstallments(state.totalCents, state.installmentCount, state.firstDueDate);
  const requirements = salesConfirmationRequirements(state);
  const paymentReady =
    (state.paymentStatus === "pending" && state.receivedCents === 0) ||
    (state.paymentStatus === "partial" && state.receivedCents > 0 && state.receivedCents < state.totalCents) ||
    (state.paymentStatus === "paid" && state.receivedCents === state.totalCents);
  const ready =
    requirements.every(requirement => requirement.complete) &&
    paymentReady &&
    installments.length > 0 &&
    !optionsLoading &&
    !optionsError;
  const focus = (key: string) => document.getElementById(`sales-confirm-${key}`)?.focus();
  return (
    <Dialog open onOpenChange={open => !open && setState(null)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-slate-50 p-0 [scrollbar-width:thin] sm:max-w-4xl">
        <DialogHeader className="border-b border-slate-200 bg-white px-6 py-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">Conferência final</p><DialogTitle className="mt-1">Confirmar venda</DialogTitle><p className="mt-1 text-sm text-slate-600">A venda e seus títulos serão confirmados na mesma transação. A confirmação não reserva estoque.</p></DialogHeader>
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="confirmation-requirements-heading"><h3 id="confirmation-requirements-heading" className="font-bold text-slate-950">Esta venda pode ser confirmada?</h3><div className="mt-3 space-y-2">{requirements.map(requirement => <div key={requirement.key} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm", requirement.complete ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950")}><span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", requirement.complete ? "bg-emerald-600 text-white" : "border border-amber-400 bg-white text-amber-700")}>{requirement.complete ? <Check className="h-3.5 w-3.5" /> : "!"}</span><strong className="flex-1">{requirement.label}</strong>{!requirement.complete && requirement.actionLabel && <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => focus(requirement.key === "payment" ? "payment" : requirement.key === "installments" ? "installments" : requirement.key)}>{requirement.actionLabel}</button>}</div>)}</div></section>

            <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold text-slate-950">Condições financeiras</h3>
            {optionsLoading && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Carregando categorias, contas e formas de pagamento…</p>}
            {optionsError && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-900"><span>Não foi possível carregar os cadastros financeiros. Nenhuma confirmação será enviada enquanto este gate estiver incompleto.</span><Button type="button" size="sm" variant="outline" onClick={onRetryOptions}>Tentar novamente</Button></div>}
            <fieldset className="mt-3">
              <legend className="text-xs font-semibold text-slate-700">Situação no momento da confirmação</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(["pending", "partial", "paid"] as const).map(status => (
                  <button
                    key={status}
                    type="button"
                    className={cn("rounded-lg border px-3 py-2 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500", state.paymentStatus === status ? "border-blue-500 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}
                    aria-pressed={state.paymentStatus === status}
                    disabled={status === "partial" && state.totalCents <= 1}
                    onClick={() => setState({
                      ...state,
                      paymentStatus: status,
                      receivedCents: status === "pending" ? 0 : status === "paid" ? state.totalCents : Math.max(1, Math.min(state.totalCents - 1, Math.floor(state.totalCents / 2))),
                    })}
                  >
                    {status === "pending" ? "Pendente" : status === "partial" ? "Pagamento parcial" : "Pago"}
                  </button>
                ))}
              </div>
              {state.paymentStatus === "partial" && (
                <label className="mt-3 block text-xs font-semibold text-slate-700">
                  Valor já recebido
                  <MoneyInput className="mt-1 tabular-nums" label="Valor já recebido" valueCents={state.receivedCents} onChangeCents={receivedCents => setState({ ...state, receivedCents })} />
                </label>
              )}
              {!paymentReady && <p role="alert" className="mt-2 text-sm text-rose-700">O valor recebido deve ser maior que zero e menor que o total para um pagamento parcial.</p>}
              <p className="mt-2 text-xs leading-5 text-slate-500">Isenção não está disponível porque o domínio financeiro atual não possui um lançamento isento auditável. Nenhum status fictício será gravado.</p>
            </fieldset>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">Forma de pagamento<select id="sales-confirm-payment" className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm" value={state.paymentMethod} onChange={event => setState({ ...state, paymentMethod: event.target.value })}><option value="">Selecione</option>{paymentMethods.map(value => <option key={value}>{value}</option>)}</select></label>
              <label className="text-xs font-semibold text-slate-700">Categoria financeira<select id="sales-confirm-category" required className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm" value={state.categoryPublicId} onChange={event => setState({ ...state, categoryPublicId: event.target.value })}><option value="">Selecione</option>{categories.map(value => <option key={value.publicId} value={value.publicId}>{value.name}</option>)}</select></label>
              <label className="text-xs font-semibold text-slate-700">Conta prevista<select id="sales-confirm-account" required className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm" value={state.financialAccountPublicId} onChange={event => setState({ ...state, financialAccountPublicId: event.target.value })}><option value="">Selecione</option>{accounts.map(value => <option key={value.publicId} value={value.publicId}>{value.name}</option>)}</select></label>
              <div id="sales-confirm-installments" className="grid grid-cols-2 gap-2"><label className="text-xs font-semibold text-slate-700">Parcelas<Input className="mt-1" type="number" min={1} max={120} value={state.installmentCount} onChange={event => setState({ ...state, installmentCount: Math.max(1, Number(event.target.value)) })} /></label><label className="text-xs font-semibold text-slate-700">1º vencimento<Input className="mt-1" type="date" value={state.firstDueDate} onChange={event => setState({ ...state, firstDueDate: event.target.value })} /></label></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSetup(setup === "category" ? null : "category")}><Plus className="mr-1.5 h-3.5 w-3.5" />Nova categoria a receber</Button><Button type="button" size="sm" variant="outline" onClick={() => setSetup(setup === "account" ? null : "account")}><Plus className="mr-1.5 h-3.5 w-3.5" />Nova conta</Button></div>
            {setup === "category" && <div className="mt-3 flex flex-col gap-2 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-end"><label className="flex-1 text-xs font-semibold text-slate-700">Nome da categoria<Input autoFocus className="mt-1" value={categoryName} onChange={event => setCategoryName(event.target.value)} placeholder="Ex.: Receita de vendas" /></label><Button type="button" disabled={categoryCreationBusy || categoryName.trim().length < 2} onClick={() => onCreateCategory(categoryName.trim())}>{categoryCreationBusy ? "Criando…" : "Criar e selecionar"}</Button></div>}
            {setup === "account" && <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end"><label className="text-xs font-semibold text-slate-700">Nome da conta<Input autoFocus className="mt-1" value={accountName} onChange={event => setAccountName(event.target.value)} placeholder="Ex.: Banco principal" /></label><label className="text-xs font-semibold text-slate-700">Tipo<select className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm" value={accountType} onChange={event => setAccountType(event.target.value as "cash" | "bank")}><option value="bank">Banco</option><option value="cash">Caixa</option></select></label><Button type="button" disabled={accountCreationBusy || accountName.trim().length < 2} onClick={() => onCreateAccount(accountName.trim(), accountType)}>{accountCreationBusy ? "Criando…" : "Criar e selecionar"}</Button></div>}
            {financialSetupError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{financialSetupError}</p>}
            </section>
          </div>

          <aside className="self-start rounded-xl bg-slate-950 p-5 text-white lg:sticky lg:top-0"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Resumo financeiro</p><strong className="mt-2 block text-2xl tabular-nums">{money.format(state.totalCents / 100)}</strong><div className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-sm"><div className="flex justify-between gap-3"><span className="text-slate-300">Recebido</span><strong className="tabular-nums text-emerald-300">{money.format(state.receivedCents / 100)}</strong></div><div className="flex justify-between gap-3"><span className="text-slate-300">Restante</span><strong className="tabular-nums">{money.format(Math.max(0, state.totalCents - state.receivedCents) / 100)}</strong></div></div><div className="mt-4 max-h-64 space-y-2 overflow-y-auto border-t border-slate-700 pt-4 [scrollbar-width:thin]">{installments.length ? installments.map((entry, index) => <div key={`${entry.dueDate}-${index}`} className="flex justify-between gap-3 text-sm"><span className="text-slate-300">{index + 1}/{installments.length} · {date.format(new Date(`${entry.dueDate}T12:00:00`))}</span><strong className="tabular-nums">{money.format(entry.amountCents / 100)}</strong></div>) : <p className="text-sm text-amber-200">Defina parcelas e vencimento.</p>}</div><div className={cn("mt-5 rounded-lg p-3 text-sm", ready ? "bg-emerald-500/15 text-emerald-100" : "bg-amber-500/15 text-amber-100")}><strong className="block">{ready ? "Pronta para confirmar" : "Confirmação bloqueada"}</strong>{ready ? "Todos os requisitos foram atendidos." : `${requirements.filter(item => !item.complete).length + (paymentReady ? 0 : 1)} requisito(s) ainda precisam de atenção.`}</div></aside>
        </div>
        <DialogFooter className="sticky bottom-0 border-t border-slate-200 bg-white px-6 py-4"><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button disabled={busy || !ready} onClick={() => onConfirm(state)}>{busy ? "Confirmando…" : "Confirmar venda e criar títulos"}</Button></DialogFooter>
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
    <Dialog open onOpenChange={open => !open && setState(null)}><DialogContent className="max-h-[92vh] overflow-y-auto bg-white sm:max-w-3xl"><DialogHeader><DialogTitle>Corrigir endereço histórico</DialogTitle><p className="text-sm text-slate-600">Permitido até Separação. Os valores anterior e novo serão mantidos na auditoria.</p></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><AddressFields title="Entrega" address={state.shippingAddress} onChange={shippingAddress => setState({ ...state, shippingAddress })} /><AddressFields title="Cobrança" address={state.billingAddress} onChange={billingAddress => setState({ ...state, billingAddress })} /></div><label className="text-sm font-semibold text-slate-700">Motivo da correção<textarea className="mt-1 min-h-20 w-full rounded-md border border-input px-3 py-2 text-sm" value={state.reason} onChange={event => setState({ ...state, reason: event.target.value })} /></label><DialogFooter><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button disabled={busy || state.reason.trim().length < 3} onClick={() => onConfirm(state)}>{busy ? "Salvando…" : "Salvar correção"}</Button></DialogFooter></DialogContent></Dialog>
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
  if (monetary) {
    return (
      <label className="text-xs font-semibold text-slate-700">{label}
        <div className="relative mt-1">
          <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm font-medium text-slate-500">R$</span>
          <MoneyInput className="pl-10 tabular-nums" label={label} valueCents={Number(value)} onChangeCents={cents => onChange(cents as never)} />
        </div>
      </label>
    );
  }
  return (
    <label className="text-xs font-semibold text-slate-700">{label}<Input className="mt-1 tabular-nums" type="text" inputMode="decimal" value={value} onChange={event => onChange(event.target.value as never)} /></label>
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
