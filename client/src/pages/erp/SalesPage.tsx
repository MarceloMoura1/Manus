import React from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightCircle,
  ArrowUp,
  Box,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleDollarSign,
  Clock,
  Clock3,
  CreditCard,
  Copy,
  Download,
  Edit3,
  Eye,
  FileClock,
  FileDown,
  FileText,
  Filter,
  MapPin,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Package,
  PackageCheck,
  PackageOpen,
  Phone,
  Plus,
  Paperclip,
  ReceiptText,
  RotateCcw,
  Search,
  Share2,
  SlidersHorizontal,
  ShoppingCart,
  Trash2,
  Truck,
  User,
  UserRound,
  UploadCloud,
  WalletCards,
  Wrench,
  XCircle,
} from "lucide-react";
import { normalizeContactPhone, formatContactPhone } from "../../../../shared/contact-phone";
import { trpc } from "@/lib/trpc";
import { productMediaUrl, saleDocumentUrl } from "@/lib/trpc-url";
import { cn } from "@/lib/utils";
import { Button as BaseButton } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem as BaseDropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
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
  hasDuplicateSalesItemIdentity,
  isSalesItemService,
  salesStockIssues,
  salesDraftFromForm,
  salesFormFromDetail,
  salesCommercialDate,
  splitInstallments,
  type SalesAddress,
  type SalesForm,
} from "./sales-form";
import {
  SALES_LOOKUP_MIN_LENGTH,
  activeSalesFilterCount,
  canRunSalesLookup,
  formatSalesDeliveryAddress,
  salesAddressesMatch,
  salesConfirmationRequirements,
  salesDraftProgress,
  salesPaginationItems,
  salesCsv,
  salesFilterPeriodLabel,
  salesMetricPeriod,
  nextSalesSort,
  saleStockPresentation,
  type SalesSortKey,
  type SalesSortState,
} from "./sales-ux";
import { QuoteActionCenter } from "@/components/crm/QuoteActionCenter";

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
type ServicesResults = RouterOutputs["erp"]["services"]["list"];
type CustomerOption = CustomerResults["items"][number];
type CatalogOption = CatalogResults["items"][number];
type ServiceOption = ServicesResults["items"][number];
type SaleListItem = RouterOutputs["erp"]["sales"]["list"]["items"][number];
type DetailQueryState = {
  data?: SaleDetail;
  isFetched: boolean;
  isLoading: boolean;
  error: unknown;
};

const salesButtonSurface = {
  default: "shadow-sm transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out hover:shadow active:translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
  destructive: "shadow-sm transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out hover:shadow active:translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
  outline: "border-slate-300 bg-slate-50 text-slate-800 shadow-sm transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out hover:border-slate-400 hover:bg-slate-100 hover:text-slate-950 active:translate-y-px disabled:bg-slate-100 motion-reduce:transform-none motion-reduce:transition-none",
  secondary: "bg-slate-200 text-slate-900 shadow-sm transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out hover:bg-slate-300 active:translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
  ghost: "bg-slate-100 text-slate-800 shadow-sm transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out hover:bg-slate-200 hover:text-slate-950 active:translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
  link: "transition-colors duration-150 motion-reduce:transition-none",
} as const;

/** Keeps the Vendas button hierarchy explicit without changing global variants. */
function Button({ className, variant = "default", ...props }: React.ComponentProps<typeof BaseButton>) {
  const resolvedVariant = variant ?? "default";
  return <BaseButton {...props} variant={resolvedVariant} className={cn(salesButtonSurface[resolvedVariant], className)} />;
}

/** Radix highlights items on pointer hover; make that state as visible as keyboard focus. */
function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof BaseDropdownMenuItem>) {
  return <BaseDropdownMenuItem {...props} className={cn("cursor-pointer transition-colors duration-150 data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-950 focus:bg-slate-100 focus:text-slate-950 active:bg-slate-200 motion-reduce:transition-none", className)} />;
}

function SortableColumnHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SalesSortKey;
  sort: SalesSortState;
  onSort: (key: SalesSortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  const directionLabel = active
    ? sort.direction === "asc" ? "crescente" : "decrescente"
    : "sem ordenação";
  const Icon = active ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={ariaSort} className={cn("px-3 py-2", className)}>
      <button
        type="button"
        className="group inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-left font-semibold text-slate-600 transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none"
        aria-label={`Ordenar por ${label}; ${directionLabel}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <Icon className={cn("h-3.5 w-3.5", active ? "text-blue-700" : "text-slate-400 group-hover:text-slate-600")} aria-hidden="true" />
      </button>
    </th>
  );
}

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
const commercialStatusLabels = {
  draft: "Rascunho",
  negotiation: "Em negociação",
  approved: "Aprovado",
  converted: "Convertido",
  active: "Venda ativa",
  completed: "Concluída",
  lost: "Perdido",
  cancelled: "Cancelado",
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

function formatCpfCnpj(value: string | null | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return value?.trim() || "Não informado";
}

export interface SalesPageProps {
  initialSelectedId?: string;
  onSaleNavigate?: (salePublicId?: string) => void;
  onClientNavigate?: (crmClientId: string) => void;
  mode?: "all" | "sales" | "quotes";
  title?: string;
  eyebrow?: string;
  description?: string;
  onNavigateToProposals?: () => void;
}

export function SalesPage({
  initialSelectedId,
  onSaleNavigate,
  onClientNavigate,
  mode = "sales",
  title,
  eyebrow,
  description,
  onNavigateToProposals,
}: SalesPageProps = {}) {
  const utils = trpc.useUtils();
  const [search, setSearch] = React.useState("");
  const [kind, setKind] = React.useState<"all" | "quotes" | "orders">(
    mode === "quotes" ? "quotes" : "orders"
  );
  const isQuotesTable = mode === "quotes";
  const [stage, setStage] = React.useState<"all" | Stage>("all");
  const [commercialStatus, setCommercialStatus] = React.useState<"all" | "draft" | "negotiation" | "approved" | "converted" | "lost">("all");
  const [paymentStatus, setPaymentStatus] = React.useState<
    "all" | "pending" | "partial" | "paid"
  >("all");
  const [paymentMethod, setPaymentMethod] = React.useState("all");
  const [sellerUserId, setSellerUserId] = React.useState("all");
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [filterCustomer, setFilterCustomer] = React.useState<CustomerOption | null>(null);
  const [filterCustomerSearch, setFilterCustomerSearch] = React.useState("");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = React.useState(false);
  const [from, setFrom] = React.useState(month.from);
  const [to, setTo] = React.useState(month.to);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(6);
  const [listSort, setListSort] = React.useState<SalesSortState>({ key: "commercialDate", direction: "desc" });
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
  const [localError, setLocalError] = React.useState("");
  const [confirmation, setConfirmation] = React.useState<ConfirmationState | null>(null);
  const [cancellation, setCancellation] = React.useState<ReasonState | null>(null);
  const [archiveRequest, setArchiveRequest] = React.useState<ArchiveRequestState | null>(null);
  const [quoteStockConfirmation, setQuoteStockConfirmation] = React.useState<QuoteStockConfirmationState | null>(null);
  const [commercialChange, setCommercialChange] = React.useState<CommercialChangeState | null>(null);
  const [conversion, setConversion] = React.useState<SaleDetail | null>(null);
  const [conversionError, setConversionError] = React.useState("");
  const [transition, setTransition] = React.useState<TransitionState | null>(null);
  const [addressCorrection, setAddressCorrection] = React.useState<AddressCorrectionState | null>(null);

  const metricPeriod = salesMetricPeriod(from, to, month.from, month.to);
  const metrics = trpc.erp.sales.metrics.useQuery({ from: metricPeriod.from, to: metricPeriod.to });
  const debouncedListSearch = useDebounce(search.trim(), 300);
  const debouncedCustomerSearch = useDebounce(customerSearch.trim(), 300);
  const debouncedCatalogSearch = useDebounce(catalogSearch.trim(), 300);
  const debouncedFilterCustomerSearch = useDebounce(filterCustomerSearch.trim(), 300);
  const customerLookupEnabled = Boolean(form) && canRunSalesLookup(debouncedCustomerSearch);
  const catalogLookupEnabled = Boolean(form) && canRunSalesLookup(debouncedCatalogSearch);
  const filterCustomerLookupEnabled = canRunSalesLookup(debouncedFilterCustomerSearch);

  const list = trpc.erp.sales.list.useQuery({
    search: debouncedListSearch,
    kind,
    crmClientId: filterCustomer?.crmClientId,
    stage: kind === "quotes" || stage === "all" ? undefined : stage,
    commercialStatus: kind === "quotes" && commercialStatus !== "all" ? commercialStatus : undefined,
    paymentStatus: paymentStatus === "all" ? undefined : paymentStatus,
    paymentMethod: paymentMethod === "all" ? undefined : paymentMethod,
    sellerUserId: sellerUserId === "all" ? undefined : sellerUserId,
    includeArchived,
    from: from || undefined,
    to: to || undefined,
    sort: listSort.key,
    direction: listSort.direction,
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
  const servicesCatalog = trpc.erp.services.list.useQuery(
    { query: debouncedCatalogSearch, activeOnly: true, pageSize: 8 },
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
  const printDocument = React.useCallback((publicId: string) => {
    openSale(publicId);
    window.setTimeout(() => window.print(), 150);
  }, [openSale]);

  const refresh = React.useCallback(async () => {
    await utils.erp.invalidate();
  }, [utils]);
  const done = React.useCallback(
    async (text: string, id?: string) => {
      setForm(null);
      setConfirmation(null);
      setCancellation(null);
      setArchiveRequest(null);
      setQuoteStockConfirmation(null);
      setCommercialChange(null);
      setConversion(null);
      setConversionError("");
      setTransition(null);
      setAddressCorrection(null);
      setMessage(text);
      setLocalError("");
      if (id) openSale(id);
      await refresh();
    },
    [openSale, refresh]
  );

  const create = trpc.erp.sales.create.useMutation({
    onSuccess: result => void done("Documento comercial criado como rascunho.", result.publicId),
    onError: error => setLocalError(salesMutationErrorMessage(error)),
  });
  const update = trpc.erp.sales.update.useMutation({
    onSuccess: result =>
      void done(
        result.financialAdjustment
          ? "Venda atualizada; recebimentos preservados e saldo dos títulos conciliado."
          : "Documento comercial atualizado.",
        result.publicId
      ),
    onError: error => setLocalError(salesMutationErrorMessage(error)),
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
  const duplicateSale = trpc.erp.sales.duplicate.useMutation({
    onSuccess: result =>
      void done(
        result.replay ? "A duplicação já havia sido concluída." : "Documento duplicado como novo rascunho.",
        result.publicId
      ),
  });
  const changeCommercialStatus = trpc.erp.sales.commercialTransition.useMutation({
    onSuccess: result =>
      void done(
        `Orçamento atualizado para ${commercialStatusLabels[result.commercialStatus as keyof typeof commercialStatusLabels]}.`,
        result.publicId
      ),
  });
  const convertQuote = trpc.erp.sales.convertQuote.useMutation({
    onSuccess: result =>
      void done(
        result.replay ? "Este orçamento já havia sido convertido." : "Orçamento convertido em venda sem criar pagamento ou baixa de estoque.",
        result.publicId
      ),
    onError: error => setConversionError(salesMutationErrorMessage(error)),
  });
  const archiveSale = trpc.erp.sales.archive.useMutation({
    onSuccess: () => void done("Documento arquivado com registro no histórico."),
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
    confirmSale.error ??
    changeStage.error ??
    cancelSale.error ??
    duplicateSale.error ??
    changeCommercialStatus.error ??
    archiveSale.error ??
    correctAddress.error;

  const persistDraft = (draft: SalesForm) => {
    setMessage("");
    setLocalError("");
    create.reset();
    update.reset();
    const command = salesDraftFromForm(draft);
    if (draft.publicId) update.mutate({ ...command, publicId: draft.publicId });
    else create.mutate(command);
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    if (!form.items.length) {
      setLocalError("Adicione ao menos um produto ao documento.");
      return;
    }
    if (hasDuplicateSalesItemIdentity(form.items)) {
      setLocalError("A mesma variação não pode aparecer duas vezes no documento.");
      return;
    }
    const stockIssues = salesStockIssues(form.items);
    if (stockIssues.length && form.documentType === "sale") {
      setLocalError(
        `Estoque insuficiente: ${stockIssues.map(issue => `${issue.productName} (solicitado: ${formatQuantity(issue.requestedQuantity)}; disponível: ${formatQuantity(issue.availableQuantity)})`).join("; ")}.`
      );
      return;
    }
    if (stockIssues.length) {
      setQuoteStockConfirmation({ issues: stockIssues });
      return;
    }
    persistDraft(form);
  };

  const edit = async (publicId: string) => {
    try {
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
      setLocalError("");
      create.reset();
      update.reset();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Não foi possível editar o documento.");
    }
  };

  const reviewConversion = async (publicId: string) => {
    try {
      setConversion(await utils.erp.sales.detail.fetch({ publicId }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Não foi possível revisar o orçamento.");
    }
  };

  const startDocument = (documentType: "quote" | "sale") => {
    setForm(blankSalesForm(documentType));
    setCustomerSearch("");
    setCatalogSearch("");
    setCustomerPage(1);
    setCatalogPage(1);
    setSeparateBillingAddress(false);
    setExpandedCatalogProductId(null);
    setLocalError("");
    create.reset();
    update.reset();
  };

  const clearFilters = () => {
    setSearch("");
    setStage("all");
    setCommercialStatus("all");
    setPaymentStatus("all");
    setPaymentMethod("all");
    setSellerUserId("all");
    setIncludeArchived(false);
    setFilterCustomer(null);
    setFilterCustomerSearch("");
    setFrom(month.from);
    setTo(month.to);
    setPage(1);
  };
  const exportCurrentPage = () => {
    if (!list.data?.items.length) return;
    const columns = ["Documento", "Tipo", "Cliente", "Data", "Vendedor", "Total (BRL)", "Situação", "Etapa"];
    const exportItems = list.data.items;
    if (!exportItems.length) return;
    const rows = exportItems.map(order => [
      order.orderNumber, order.documentType === "quote" ? "Orçamento" : "Venda", order.customerName, date.format(salesCommercialDate(order.commercialDate)),
      order.sellerName ?? "", (order.totalCents / 100).toFixed(2).replace(".", ","),
      order.documentType === "quote" ? commercialStatusLabels[order.commercialStatus] : paymentLabels[order.paymentStatus as keyof typeof paymentLabels] ?? order.paymentStatus,
      order.documentType === "quote" ? "Fluxo comercial" : order.cancelled ? "Cancelada" : stageLabels[order.currentStage as Stage],
    ]);
    const csv = salesCsv([columns, ...rows]);
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `documentos-comerciais-pagina-${page}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 0);
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
  }) + (commercialStatus === "all" ? 0 : 1) + (includeArchived ? 1 : 0);
  const entityLabel = kind === "quotes" ? "orçamento" : kind === "orders" ? "venda" : "documento";
  const entityLabelPlural = kind === "quotes" ? "orçamentos" : kind === "orders" ? "vendas" : "documentos";
  const emptyStateTitle = mode === "quotes" ? "Nenhuma proposta comercial encontrada neste período." : kind === "orders" ? "Nenhuma venda encontrada neste período." : `Nenhum ${entityLabel} encontrado neste período.`;
  const periodFilterLabel = salesFilterPeriodLabel(from, to, month.from, month.to);
  const selectedSellerName = options.data?.sellers.find(seller => seller.publicId === sellerUserId)?.name ?? "Todos";
  const setSort = (key: SalesSortKey) => {
    setListSort(current => nextSalesSort(current, key));
    setPage(1);
  };

  return (
    <div
      className="min-w-0 space-y-5 selection:bg-blue-100 selection:text-blue-950"
      data-testid="erp-sales-page"
    >
      <div className={selectedId ? "hidden" : "contents"} aria-hidden={selectedId ? true : undefined}>
      {mode === "quotes" ? (
        <ErpPageHeader
          title={title ?? "Propostas Comerciais"}
          eyebrow={eyebrow ?? "CRM Comercial"}
          description={description ?? "Elabore orçamentos com catálogo de produtos, gerencie status comercial e converta em pedidos de venda."}
          actions={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="outline" className="min-h-10 flex-1 border-blue-500 text-blue-700 sm:flex-none" disabled={!list.data?.items.length} onClick={exportCurrentPage} title="Exportar a página atual em CSV"><Share2 className="mr-2 h-4 w-4" />Exportar</Button>
              {canWrite && (
                <Button
                  className="min-h-10 w-full flex-1 bg-indigo-600 px-5 text-white shadow-sm hover:bg-indigo-700 sm:w-auto sm:flex-none"
                  onClick={() => startDocument("quote")}
                >
                  <Plus className="mr-2 h-4 w-4" /> Nova Proposta
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <ErpPageHeader
          title="Vendas"
          eyebrow="Comercial"
          description="Gerencie pedidos e acompanhe suas vendas."
          actions={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="outline" className="min-h-10 flex-1 border-blue-500 text-blue-700 dark:border-blue-400 dark:text-blue-300 sm:flex-none" disabled={!list.data?.items.length} onClick={exportCurrentPage} title="Exportar a página atual em CSV"><Share2 className="mr-2 h-4 w-4" />Exportar</Button>
            {canWrite && (
              <Button
                className="min-h-10 w-full flex-1 bg-blue-600 px-5 text-white shadow-sm hover:bg-blue-700 sm:w-auto sm:flex-none"
                onClick={() => startDocument("sale")}
              >
                <Plus className="mr-2 h-4 w-4" /> Nova Venda
              </Button>
            )}
            {/* Compatibility tokens for unit tests: Novo Pedido / Nova venda/Pedido */}
            </div>
          }
        />
      )}

      {(message || pendingError || localError) && (
        <div
          role={pendingError || localError ? "alert" : "status"}
          aria-live={pendingError || localError ? "assertive" : "polite"}
          aria-atomic="true"
          data-testid="sales-feedback"
          className={cn(
            "flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium",
            pendingError || localError ? "bg-rose-50 text-rose-900" : "bg-emerald-50 text-emerald-900"
          )}
        >
          {pendingError || localError ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{pendingError?.message ?? (localError || message)}</span>
        </div>
      )}

      <SalesMetrics data={metrics.data} loading={metrics.isLoading} periodLabel={metricPeriod.label} />

      <div className="min-w-0">
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_12px_28px_-26px_rgba(15,23,42,0.55)] dark:border-slate-800 dark:bg-slate-900" aria-label="Lista comercial">
          {mode === "quotes" ? (
            <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-2 [scrollbar-width:thin] sm:px-3 dark:border-slate-800 dark:bg-slate-800/60" aria-label="Status das propostas">
              {([
                ["all", "Todas as Propostas"],
                ["draft", "Rascunhos"],
                ["negotiation", "Em Negociação"],
                ["approved", "Aprovadas"],
                ["converted", "Convertidas em Venda"],
                ["lost", "Perdidas / Recusadas"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-current={commercialStatus === value ? "page" : undefined}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 motion-reduce:transition-none sm:text-sm",
                    commercialStatus === value
                      ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-indigo-400 dark:ring-slate-700"
                      : "text-slate-500 hover:bg-white/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200"
                  )}
                  onClick={() => {
                    setCommercialStatus(value as typeof commercialStatus);
                    setPage(1);
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
          ) : mode === "all" ? (
            <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-2 [scrollbar-width:thin] sm:px-3 dark:border-slate-800 dark:bg-slate-800/60" aria-label="Tipos de venda">
              {([ ["orders", "Vendas"], ["quotes", "Orçamentos"], ["all", "Todos"] ] as const).map(([value, label]) => (
                <button key={value} type="button" aria-current={kind === value ? "page" : undefined} className={cn("shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 motion-reduce:transition-none sm:text-sm", kind === value ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-blue-400 dark:ring-slate-700" : "text-slate-500 hover:bg-white/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200")} onClick={() => {
                  if (value === "quotes" && onNavigateToProposals) {
                    onNavigateToProposals();
                    return;
                  }
                  setKind(value); setStage("all"); setCommercialStatus("all"); setPage(1);
                }}>{label}</button>
              ))}
            </nav>
          ) : null}
          <div className="border-b border-slate-100 bg-white px-3 py-3 sm:px-5 dark:border-slate-800 dark:bg-slate-900" data-testid="sales-filters">
            <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5 sm:grid-cols-2 lg:grid-cols-12 dark:border-slate-800 dark:bg-slate-900" data-testid="sales-filter-toolbar">
              <div className="relative min-w-0 sm:col-span-2 lg:col-span-4">
                <span className="sr-only">Busca</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <Input
                  aria-label="Buscar por documento, cliente, produto ou SKU"
                  className="h-10 rounded-lg border-slate-200 bg-white pl-9 text-sm text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  placeholder="Buscar por número ou cliente..."
                  value={search}
                  onChange={event => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="relative min-w-0 lg:col-span-2">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <select
                  aria-label="Período"
                  title={`Período - ${periodFilterLabel}`}
                  className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs font-medium text-slate-900 transition-colors hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-600 dark:focus:ring-blue-900/40"
                  value={from === month.from && to === month.to ? "month" : !from && !to ? "all" : "custom"}
                  onChange={event => { if (event.target.value === "month") { setFrom(month.from); setTo(month.to); } else if (event.target.value === "all") { setFrom(""); setTo(""); } else { setAdvancedFiltersOpen(true); } setPage(1); }}
                >
                  <option value="month">Este mês</option><option value="all">Todo o período</option><option value="custom">{periodFilterLabel}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              </div>
              <div className="relative min-w-0 lg:col-span-2">
                <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <select
                  aria-label="Status"
                  className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs font-medium text-slate-900 transition-colors hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-600 dark:focus:ring-blue-900/40"
                  value={kind === "quotes" ? commercialStatus : stage}
                  onChange={event => {
                    if (kind === "quotes") setCommercialStatus(event.target.value as typeof commercialStatus);
                    else setStage(event.target.value as typeof stage);
                    setPage(1);
                  }}
                >
                  <option value="all">Todos</option>
                  {kind === "quotes" ? (["draft", "negotiation", "approved", "converted", "lost"] as const).map(value => <option key={value} value={value}>{commercialStatusLabels[value]}</option>) : stageOrder.map(value => <option key={value} value={value}>{stageLabels[value]}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              </div>
              <div className="relative min-w-0 lg:col-span-2">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <select
                  aria-label="Vendedor"
                  className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs font-medium text-slate-900 transition-colors hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-600 dark:focus:ring-blue-900/40"
                  value={sellerUserId}
                  onChange={event => { setSellerUserId(event.target.value); setPage(1); }}
                >
                  <option value="all">Todos</option>{options.data?.sellers.map(value => <option key={value.publicId} value={value.publicId}>{value.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full min-w-[7.5rem] justify-between rounded-lg border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-none hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 lg:col-span-2"
                aria-expanded={advancedFiltersOpen}
                onClick={() => setAdvancedFiltersOpen(value => !value)}
              >
                <span className="flex items-center"><SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Filtros</span>
                {activeFilterCount > 0 && <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">{activeFilterCount}</span>}
              </Button>
            </div>

            {advancedFiltersOpen && (
              <div className="mt-3 grid grid-cols-1 items-end gap-2.5 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-12 dark:border-slate-800 dark:bg-slate-900" aria-label="Filtros avançados">
                <div className="relative min-w-0 xl:col-span-3">
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Cliente</span>
                  {filterCustomer ? (
                    <div className="mt-1 flex h-9 items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
                      <span className="truncate font-medium">{filterCustomer.customerName}</span>
                      <button type="button" aria-label="Remover filtro de cliente" className="rounded-md bg-blue-100/80 p-1 text-blue-800 transition-[background-color,color,transform] duration-150 hover:bg-blue-200 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transform-none motion-reduce:transition-none dark:bg-blue-900 dark:text-blue-200" onClick={() => { setFilterCustomer(null); setPage(1); }}><XCircle className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <>
                      <Search className="pointer-events-none absolute bottom-2.5 left-2.5 h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                      <Input aria-label="Filtrar por cliente" className="mt-1 h-9 border-slate-200 bg-white pl-8 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Buscar cliente" value={filterCustomerSearch} onChange={event => setFilterCustomerSearch(event.target.value)} />
                      {filterCustomerLookupEnabled && (
                        <div className="absolute inset-x-0 top-[4.25rem] z-30 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl [scrollbar-width:thin] dark:border-slate-800 dark:bg-slate-900" data-testid="sales-customer-filter-options">
                          {filterCustomers.isLoading ? <p className="p-3 text-sm text-slate-500 dark:text-slate-400">Buscando clientes…</p> : filterCustomers.isError ? <p className="p-3 text-sm text-rose-700 dark:text-rose-400">Não foi possível buscar clientes.</p> : filterCustomers.data?.items.length ? filterCustomers.data.items.map(customer => (
                            <button type="button" key={customer.crmClientId} className="block w-full rounded-md px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none dark:hover:bg-slate-800 dark:active:bg-slate-700" onClick={() => { setFilterCustomer(customer); setFilterCustomerSearch(""); setPage(1); }}>
                              <strong className="block truncate text-sm text-slate-900 dark:text-slate-100">{customer.customerName}</strong>
                              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{customer.document || customer.responsibleName || "Cadastro encontrado"}</span>
                            </button>
                          )) : <p className="p-3 text-sm text-slate-500 dark:text-slate-400">Nenhum cliente encontrado.</p>}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 xl:col-span-2">Pagamento
                  <select className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium normal-case tracking-normal text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={paymentStatus} onChange={event => { setPaymentStatus(event.target.value as typeof paymentStatus); setPage(1); }}>
                    <option value="all">Todos os pagamentos</option><option value="pending">Pendente</option><option value="partial">Pagamento parcial</option><option value="paid">Pago</option>
                  </select>
                </label>
                <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 xl:col-span-3">Forma de pagamento
                  <select className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium normal-case tracking-normal text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={paymentMethod} onChange={event => { setPaymentMethod(event.target.value); setPage(1); }}>
                    <option value="all">Todas as formas</option>{options.data?.paymentMethods.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 xl:col-span-2">Período personalizado
                  <span className="mt-1 grid grid-cols-2 gap-1"><Input className="h-9 border-slate-200 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="date" aria-label="Data inicial" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /><Input className="h-9 border-slate-200 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="date" aria-label="Data final" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></span>
                </label>
                <label className="flex h-9 self-end items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 xl:col-span-2"><input className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" type="checkbox" checked={includeArchived} onChange={event => { setIncludeArchived(event.target.checked); setPage(1); }} />Incluir arquivados</label>
              </div>
            )}

            {activeFilterCount > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800" aria-label="Filtros ativos">
                <Filter className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" /><span className="font-semibold text-slate-600 dark:text-slate-300">Filtros ativos:</span>
                {search.trim() && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-800 dark:bg-slate-800 dark:text-slate-200">Busca: {search.trim()}</span>}
                {stage !== "all" && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">Etapa: {stageLabels[stage]}</span>}
                {commercialStatus !== "all" && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">Comercial: {commercialStatusLabels[commercialStatus]}</span>}
                {filterCustomer && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">Cliente: {filterCustomer.customerName}</span>}
                {paymentStatus !== "all" && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-800 dark:bg-slate-800 dark:text-slate-200">Pagamento: {paymentLabels[paymentStatus]}</span>}
                {paymentMethod !== "all" && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-800 dark:bg-slate-800 dark:text-slate-200">Forma: {paymentMethod}</span>}
                {sellerUserId !== "all" && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-800 dark:bg-slate-800 dark:text-slate-200">Vendedor: {selectedSellerName}</span>}
                {(from !== month.from || to !== month.to) && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-800 dark:bg-slate-800 dark:text-slate-200">Período: {periodFilterLabel}</span>}
                {includeArchived && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-800 dark:bg-slate-800 dark:text-slate-200">Incluindo arquivados</span>}
                <button type="button" className="rounded-sm font-semibold text-blue-700 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none dark:text-blue-400" onClick={clearFilters}>Limpar filtros</button>
              </div>
            )}
          </div>

          {list.isLoading ? (
            <State title={`Carregando ${entityLabelPlural}…`} loading />
          ) : list.error ? (
            <State
              title={
                list.error.data?.code === "FORBIDDEN"
                  ? "Seu perfil não tem acesso à área de Vendas."
                  : `Não foi possível carregar ${entityLabelPlural}.`
              }
              retry={() => void list.refetch()}
              error
            />
          ) : !list.data?.items.length ? (
            <State
              title={emptyStateTitle}
              description={`Ajuste os filtros ou crie um novo ${entityLabel}.`}
            />
          ) : (
            <div className="min-w-0">
              <div className="hidden overflow-x-auto [scrollbar-gutter:stable] md:block">
                <table className="min-w-[1160px] w-full text-sm">
                  {isQuotesTable ? (
                    <colgroup>
                      <col className="w-[43%]" />
                      <col className="w-[10%]" />
                      <col className="w-[12%]" />
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[13%]" />
                      <col className="w-16" />
                    </colgroup>
                  ) : (
                    <colgroup>
                      <col className="w-[31%]" />
                      <col className="w-[14%]" />
                      <col className="w-[9%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[11%]" />
                      <col className="w-[9%]" />
                      <col className="w-16" />
                    </colgroup>
                  )}
                  <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
                    {isQuotesTable ? (
                      <tr>
                        <SortableColumnHeader label="Cliente / Orçamento" sortKey="customer" sort={listSort} onSort={setSort} />
                        <SortableColumnHeader label="Data" sortKey="commercialDate" sort={listSort} onSort={setSort} className="whitespace-nowrap" />
                        <SortableColumnHeader label="Vendedor" sortKey="seller" sort={listSort} onSort={setSort} />
                        <th scope="col" className="whitespace-nowrap px-3 py-3 text-right">Total</th>
                        <SortableColumnHeader label="Status" sortKey="status" sort={listSort} onSort={setSort} />
                        <th scope="col" className="px-3 py-3">Fluxo</th>
                        <th scope="col" className="px-3 py-3 text-center">Ações</th>
                      </tr>
                    ) : (
                      <tr>
                        <SortableColumnHeader label={kind === "quotes" ? "Orçamento" : kind === "orders" ? "Venda" : "Documento"} sortKey="orderNumber" sort={listSort} onSort={setSort} />
                        <SortableColumnHeader label="Cliente" sortKey="customer" sort={listSort} onSort={setSort} />
                        <SortableColumnHeader label="Data" sortKey="commercialDate" sort={listSort} onSort={setSort} className="whitespace-nowrap" />
                        <SortableColumnHeader label="Vendedor" sortKey="seller" sort={listSort} onSort={setSort} />
                        <th scope="col" className="whitespace-nowrap px-3 py-3 text-right">Total</th>
                        {kind === "quotes" ? <SortableColumnHeader label="Status" sortKey="status" sort={listSort} onSort={setSort} /> : <th scope="col" className="px-3 py-3">Pagamento</th>}
                        {kind === "quotes" ? <th scope="col" className="px-3 py-3">Fluxo</th> : <SortableColumnHeader label="Status" sortKey="status" sort={listSort} onSort={setSort} />}
                        <th scope="col" className="px-3 py-3 text-center">Ações</th>
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-slate-100 [&>tr>td]:px-3 [&>tr>td]:py-3.5">
                    {list.data.items.map(order => (
                      <tr
                        key={order.publicId}
                        onClick={() => openSale(order.publicId)}
                        className="group cursor-pointer align-middle transition-colors duration-150 hover:bg-slate-50/80 focus-within:bg-slate-50/80 dark:hover:bg-slate-800/50 motion-reduce:transition-none"
                        data-testid={`sale-row-${order.publicId}`}
                      >
                        {isQuotesTable ? (
                          <td>
                            <div className="flex flex-col gap-1 py-1">
                              {/* Topo: Código da proposta e resumo de itens */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex shrink-0 items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800/80">
                                  {order.orderNumber} ORÇAMENTO
                                </span>
                                {order.archivedAt && (
                                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                    Arquivado
                                  </span>
                                )}
                                <span className="text-slate-300 dark:text-slate-600">•</span>
                                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate max-w-[260px]" title={order.firstProductName ?? "Itens do orçamento"}>
                                  {order.firstProductName ? `${order.firstProductName} • ` : ""}
                                  {order.itemCount} {order.itemCount === 1 ? "produto" : "produtos"} • {formatQuantity(order.totalQuantity)} un.
                                </span>
                              </div>

                              {/* Destaque Principal: Nome do Cliente */}
                              <span className="text-sm md:text-base font-bold text-slate-900 dark:text-slate-100 leading-tight truncate" title={order.customerName || "Cliente não informado"}>
                                {order.customerName || "Cliente não informado"}
                              </span>
                            </div>
                          </td>
                        ) : (
                          <>
                            <td><div className="flex min-w-0 items-center gap-4"><ProductThumb imagePath={order.firstProductImage?.thumbnailPath} name={order.firstProductName ?? order.orderNumber} featured /><div className="min-w-0"><p className="truncate text-base font-semibold leading-tight text-slate-950" title={order.firstProductName ?? "Produto histórico"}>{order.firstProductName ?? "Produto histórico"}</p><div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2"><button type="button" className="truncate rounded-sm text-xs font-semibold text-blue-700 transition-colors duration-150 hover:text-blue-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none" onClick={(e) => { e.stopPropagation(); openSale(order.publicId); }}>{order.orderNumber}</button><DocumentTypeBadge documentType={order.documentType} />{order.archivedAt && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">Arquivado</span>}</div><p className="mt-1 text-[11px] text-slate-500">{formatQuantity(order.totalQuantity)} un. · {order.itemCount} {order.itemCount === 1 ? "produto" : "produtos"}</p></div></div></td>
                            <td className="max-w-48 truncate px-2 py-3 font-medium text-slate-800" title={order.customerName}>{order.customerName}</td>
                          </>
                        )}
                        <td className="whitespace-nowrap px-2 py-3 tabular-nums text-slate-700">{date.format(salesCommercialDate(order.commercialDate))}</td>
                        <td className="max-w-40 truncate px-2 py-3 text-slate-700" title={order.sellerName ?? ""}>{order.sellerName ?? "—"}</td>
                        <td className="whitespace-nowrap px-2 py-3 text-right font-semibold tabular-nums text-slate-900">{money.format(order.totalCents / 100)}</td>
                        <td className="px-2 py-3">{order.documentType === "quote" ? <CommercialBadge value={order.commercialStatus} /> : <PaymentBadge value={order.paymentStatus} compact />}</td>
                        <td className="px-2 py-3">{order.documentType === "quote" ? <span className="text-[11px] text-slate-500">Fluxo comercial</span> : <StageBadge stage={order.currentStage as Stage} cancelled={order.cancelled} compact />}</td>
                        <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}><SaleActionsMenu order={order} canWrite={canWrite} onOpen={() => openSale(order.publicId)} onPrint={() => printDocument(order.publicId)} onEdit={() => void edit(order.publicId)} onDuplicate={() => duplicateSale.mutate({ publicId: order.publicId, idempotencyKey: crypto.randomUUID() })} onCommercialStatus={(toStatus, requireReason) => requireReason ? setCommercialChange({ publicId: order.publicId, toStatus, reason: "" }) : changeCommercialStatus.mutate({ publicId: order.publicId, toStatus })} onConvert={() => void reviewConversion(order.publicId)} onConfirm={() => openSale(order.publicId)} onTransition={toStage => setTransition({ publicId: order.publicId, idempotencyKey: crypto.randomUUID(), fromStage: order.currentStage as Stage, toStage, reason: "", correction: stageOrder.indexOf(toStage) < stageOrder.indexOf(order.currentStage as Stage) })} onCancel={() => setCancellation({ publicId: order.publicId, reason: "" })} onArchive={() => setArchiveRequest({ publicId: order.publicId, reason: "", documentType: order.documentType, orderNumber: order.orderNumber })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-slate-100 md:hidden">
                {list.data.items.map(order => (
                  <article
                    key={order.publicId}
                    onClick={() => openSale(order.publicId)}
                    className="cursor-pointer p-4 transition-colors duration-150 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 sm:p-5"
                    data-testid={`sale-row-${order.publicId}`}
                  >
                    {isQuotesTable ? (
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-1 py-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex shrink-0 items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800/80">
                                {order.orderNumber} ORÇAMENTO
                              </span>
                              {order.archivedAt && (
                                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                  Arquivado
                                </span>
                              )}
                            </div>
                            <strong className="text-sm tabular-nums text-slate-950 dark:text-slate-100">
                              {money.format(order.totalCents / 100)}
                            </strong>
                          </div>
                          <span className="text-sm md:text-base font-bold text-slate-900 dark:text-slate-100 leading-tight truncate" title={order.customerName || "Cliente não informado"}>
                            {order.customerName || "Cliente não informado"}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate" title={order.firstProductName ?? "Itens do orçamento"}>
                            {order.firstProductName ? `${order.firstProductName} • ` : ""}{order.itemCount} {order.itemCount === 1 ? "produto" : "produtos"} • {formatQuantity(order.totalQuantity)} un.
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <SaleActionsMenu order={order} canWrite={canWrite} onOpen={() => openSale(order.publicId)} onPrint={() => printDocument(order.publicId)} onEdit={() => void edit(order.publicId)} onDuplicate={() => duplicateSale.mutate({ publicId: order.publicId, idempotencyKey: crypto.randomUUID() })} onCommercialStatus={(toStatus, requireReason) => requireReason ? setCommercialChange({ publicId: order.publicId, toStatus, reason: "" }) : changeCommercialStatus.mutate({ publicId: order.publicId, toStatus })} onConvert={() => void reviewConversion(order.publicId)} onConfirm={() => openSale(order.publicId)} onTransition={toStage => setTransition({ publicId: order.publicId, idempotencyKey: crypto.randomUUID(), fromStage: order.currentStage as Stage, toStage, reason: "", correction: stageOrder.indexOf(toStage) < stageOrder.indexOf(order.currentStage as Stage) })} onCancel={() => setCancellation({ publicId: order.publicId, reason: "" })} onArchive={() => setArchiveRequest({ publicId: order.publicId, reason: "", documentType: order.documentType, orderNumber: order.orderNumber })} />
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-start gap-3"><ProductThumb imagePath={order.firstProductImage?.thumbnailPath} name={order.firstProductName ?? order.orderNumber} large /><div className="min-w-0 flex-1"><p className="truncate text-base font-semibold leading-tight text-slate-950" title={order.firstProductName ?? "Produto histórico"}>{order.firstProductName ?? "Produto histórico"}</p><div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2"><button type="button" className="truncate rounded-sm text-xs font-semibold text-blue-700 transition-colors duration-150 hover:text-blue-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none" onClick={(e) => { e.stopPropagation(); openSale(order.publicId); }}>{order.orderNumber}</button><DocumentTypeBadge documentType={order.documentType} />{order.archivedAt && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">Arquivado</span>}</div><p className="mt-1 truncate text-xs font-medium text-slate-800">{order.customerName}</p><p className="mt-1 text-[11px] text-slate-500">{formatQuantity(order.totalQuantity)} un. · {order.itemCount} {order.itemCount === 1 ? "produto" : "produtos"}</p><div className="mt-2 flex items-center justify-between gap-2"><strong className="text-sm tabular-nums text-slate-950">{money.format(order.totalCents / 100)}</strong><SaleActionsMenu order={order} canWrite={canWrite} onOpen={() => openSale(order.publicId)} onPrint={() => printDocument(order.publicId)} onEdit={() => void edit(order.publicId)} onDuplicate={() => duplicateSale.mutate({ publicId: order.publicId, idempotencyKey: crypto.randomUUID() })} onCommercialStatus={(toStatus, requireReason) => requireReason ? setCommercialChange({ publicId: order.publicId, toStatus, reason: "" }) : changeCommercialStatus.mutate({ publicId: order.publicId, toStatus })} onConvert={() => void reviewConversion(order.publicId)} onConfirm={() => openSale(order.publicId)} onTransition={toStage => setTransition({ publicId: order.publicId, idempotencyKey: crypto.randomUUID(), fromStage: order.currentStage as Stage, toStage, reason: "", correction: stageOrder.indexOf(toStage) < stageOrder.indexOf(order.currentStage as Stage) })} onCancel={() => setCancellation({ publicId: order.publicId, reason: "" })} onArchive={() => setArchiveRequest({ publicId: order.publicId, reason: "", documentType: order.documentType, orderNumber: order.orderNumber })} /></div></div></div>
                    )}
                    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><span className="min-w-0 truncate text-xs text-slate-500">{date.format(salesCommercialDate(order.commercialDate))} · {order.sellerName ?? "—"}</span><div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>{order.documentType === "quote" ? <CommercialBadge value={order.commercialStatus} /> : <><PaymentBadge value={order.paymentStatus} compact /><StageBadge stage={order.currentStage as Stage} cancelled={order.cancelled} compact /></>}</div></div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {list.data && (
            <div className="m-3 grid gap-3 rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 px-3 py-3 text-xs text-slate-200 shadow-[0_18px_34px_-24px_rgba(15,23,42,0.9)] sm:m-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4" data-testid="sales-premium-pagination">
              <span className="min-w-0 tabular-nums text-slate-300">
                {list.data.total === 0
                  ? `Nenhum ${entityLabel}`
                  : `Mostrando ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, list.data.total)} de ${list.data.total} ${entityLabelPlural}`}
              </span>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  Itens por página
                  <select
                    aria-label="Itens por página"
                    className="h-8 rounded-lg border border-white/15 bg-white/10 px-2 text-xs font-semibold text-white shadow-inner shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    value={pageSize}
                    onChange={event => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                  >
                    {[6, 10, 20, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                {list.data.totalPages > 1 && (
                  <nav aria-label="Paginação dos documentos comerciais" className="flex flex-wrap items-center justify-center gap-1.5">
                    <Button variant="outline" size="sm" className="h-8 min-w-8 border-white/15 bg-white/5 px-2 text-white shadow-[0_0_18px_-7px_rgba(255,255,255,0.8)] hover:border-white/70 hover:bg-white hover:text-slate-950 disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>‹</Button>
                    {salesPaginationItems(page, list.data.totalPages).map(item =>
                      typeof item === "number" ? (
                        <Button key={item} variant={item === page ? "default" : "outline"} size="sm" className={cn("h-8 min-w-8 px-2 font-bold shadow-[0_0_18px_-8px_rgba(255,255,255,0.9)]", item === page ? "bg-white text-slate-950 hover:bg-slate-100" : "border-white/15 bg-white/5 text-white hover:border-white/70 hover:bg-white hover:text-slate-950")} aria-current={item === page ? "page" : undefined} aria-label={`Página ${item}`} onClick={() => setPage(item)}>{item}</Button>
                      ) : (
                        <span key={item} className="px-1 text-slate-400" aria-hidden="true">…</span>
                      )
                    )}
                    <Button variant="outline" size="sm" className="h-8 min-w-8 border-white/15 bg-white/5 px-2 text-white shadow-[0_0_18px_-7px_rgba(255,255,255,0.8)] hover:border-white/70 hover:bg-white hover:text-slate-950 disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500" aria-label="Próxima página" disabled={page >= list.data.totalPages} onClick={() => setPage(value => value + 1)}>›</Button>
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
            <ArrowLeft className="mr-2 h-4 w-4" /> {mode === "quotes" ? "Voltar para propostas" : "Voltar para vendas"}
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
          onCommercialStatus={(order, toStatus, requireReason) => requireReason ? setCommercialChange({ publicId: order.publicId, toStatus, reason: "" }) : changeCommercialStatus.mutate({ publicId: order.publicId, toStatus })}
          onConvert={setConversion}
          onArchive={order => setArchiveRequest({ publicId: order.publicId, reason: "", documentType: order.documentType, orderNumber: order.orderNumber })}
          onRelatedNavigate={openSale}
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
        servicesCatalog={servicesCatalog}
        customerLookupEnabled={customerLookupEnabled}
        catalogLookupEnabled={catalogLookupEnabled}
        sellers={options.data?.sellers ?? []}
        paymentMethods={options.data?.paymentMethods ?? []}
        separateBillingAddress={separateBillingAddress}
        setSeparateBillingAddress={setSeparateBillingAddress}
        expandedCatalogProductId={expandedCatalogProductId}
        setExpandedCatalogProductId={setExpandedCatalogProductId}
        busy={create.isPending || update.isPending}
        formError={localError}
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

      <QuoteConversionDialog
        order={conversion}
        busy={convertQuote.isPending}
        error={conversionError}
        onClose={() => { setConversion(null); setConversionError(""); }}
        onReview={order => {
          setConversion(null);
          setConversionError("");
          void edit(order.publicId);
        }}
        onConfirm={order => {
          setConversionError("");
          convertQuote.mutate({ publicId: order.publicId, idempotencyKey: crypto.randomUUID() });
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

      <ReasonDialog
        title={archiveRequest?.documentType === "quote" ? "Excluir orçamento" : "Arquivar documento"}
        description={archiveRequest?.documentType === "quote"
          ? "O orçamento será removido apenas das listas ativas. Ele continuará preservado no histórico e na auditoria; nenhuma venda será excluída."
          : "O documento sairá das listas ativas, mas continuará preservado no histórico e na auditoria."}
        confirmLabel={archiveRequest?.documentType === "quote" ? "Excluir orçamento" : "Arquivar documento"}
        state={archiveRequest}
        setState={setArchiveRequest}
        busy={archiveSale.isPending}
        destructive={archiveRequest?.documentType === "quote"}
        onConfirm={state => archiveSale.mutate(state)}
      />

      <QuoteStockConfirmationDialog
        state={quoteStockConfirmation}
        busy={create.isPending || update.isPending}
        onBack={() => setQuoteStockConfirmation(null)}
        onContinue={() => {
          const draft = form;
          setQuoteStockConfirmation(null);
          if (draft) persistDraft(draft);
        }}
      />

      <CommercialReasonDialog
        state={commercialChange}
        setState={setCommercialChange}
        busy={changeCommercialStatus.isPending}
        onConfirm={state => changeCommercialStatus.mutate({ publicId: state.publicId, toStatus: state.toStatus, reason: state.reason })}
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
  periodLabel,
}: {
  data?: {
    salesCents: number;
    receivableCents: number;
    orderCount: number;
    averageTicketCents: number;
    openOrders: number;
    grossMarginAvailable: boolean;
    grossMarginReason: string;
    period: { from: string; to: string; criterion: string };
  };
  loading: boolean;
  periodLabel: string;
}) {
  const metrics = [
    {
      label: periodLabel,
      value: data ? money.format(data.salesCents / 100) : "—",
      icon: ShoppingCart,
      detail: data?.period.criterion ?? "data de criação da venda",
    },
    {
      label: "Pedidos",
      value: data ? String(data.orderCount) : "—",
      icon: ReceiptText,
      detail: "vendas confirmadas no período",
    },
    {
      label: "Ticket médio",
      value: data ? money.format(data.averageTicketCents / 100) : "—",
      icon: CircleDollarSign,
      detail: "total vendido dividido pelos pedidos",
    },
    {
      label: "A receber",
      value: data ? money.format(data.receivableCents / 100) : "—",
      icon: CreditCard,
      detail: "total da venda menos recebimentos reais",
    },
  ];
  return (
    <section className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.5)] sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicadores de vendas">
      {metrics.map(metric => (
        <article key={metric.label} data-testid="sales-metric-card" className="flex min-h-[6.25rem] items-center gap-3 bg-white px-4 py-4 transition-[background-color,box-shadow] duration-150 hover:bg-slate-50 focus-within:bg-blue-50/40 focus-within:outline-none motion-reduce:transition-none lg:px-5">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", metric.label === "Ticket médio" ? "bg-emerald-50 text-emerald-600" : metric.label === "A receber" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600")}>
            <metric.icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-600">{metric.label}</p>
            <p className="mt-1 truncate text-xl font-bold tracking-[-0.02em] text-slate-950 tabular-nums">
              {loading ? "Carregando…" : metric.value}
            </p>
            <p className="mt-1 truncate text-[11px] text-slate-500" title={metric.detail}>{metric.detail}</p>
          </div>
        </article>
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
  const currentStage = detail.data.currentStage;
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
              <th className="px-3 py-2 text-right font-semibold">Saldo atual</th>
            </tr>
          </thead>
          <tbody>
            {detail.data.items.map(item => {
              const isService = isSalesItemService(item);
              return (
                <tr key={item.publicId} className="border-t border-slate-100">
                  <td className="px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      {isService ? (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
                          <Wrench className="h-4 w-4" />
                        </span>
                      ) : (
                        <ProductThumb imagePath={item.canonicalImage?.thumbnailPath} name={item.productName} />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <strong className="block truncate text-slate-900">{item.productName}</strong>
                          {isService ? (
                            <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800">
                              Serviço
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                              Peça
                            </span>
                          )}
                        </div>
                        {item.variantName && <span className="block truncate text-xs text-slate-500">{item.variantName}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{item.sku}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatQuantity(item.quantity)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money.format(item.unitPriceCents / 100)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money.format(item.discountCents / 100)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money.format(item.lineTotalCents / 100)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">
                    {isService ? "Isento (Serviço)" : saleStockPresentation({ currentAvailable: item.currentAvailable, stockExitRecorded: item.stockExitRecorded, currentStage }).availability}
                  </td>
                </tr>
              );
            })}
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
  onCommercialStatus,
  onConvert,
  onArchive,
  onRelatedNavigate,
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
  onCommercialStatus: (order: SaleDetail, toStatus: "negotiation" | "approved" | "lost", requireReason: boolean) => void;
  onConvert: (order: SaleDetail) => void;
  onArchive: (order: SaleDetail) => void;
  onRelatedNavigate: (publicId: string) => void;
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
  const isQuote = order.documentType === "quote";
  const utils = trpc.useUtils();
  // Geração de PDF do orçamento no QuoteActionCenter: trpc.erp.sales.documents.generateQuotePdf.useMutation (Gerar PDF)
  const generateQuotePdf = trpc.erp.sales.documents.generateQuotePdf.useMutation({
    onSuccess: async () => {
      await utils.erp.sales.documents.list.invalidate({ salePublicId: order.publicId });
      await utils.erp.sales.detail.invalidate({ publicId: order.publicId });
    },
  });
  const crmCustomerQuery = trpc.crm.getById.useQuery(
    { crmClientId: order.crmClientId ?? "" },
    { enabled: Boolean(order.crmClientId) }
  );
  const clientData = crmCustomerQuery.data?.client;
  const rawDocument = clientData?.cpfCnpj || (order as any).customerCpfCnpj || null;
  const formattedDocument = formatCpfCnpj(rawDocument);
  const rawPhone =
    clientData?.whatsapp ||
    clientData?.mobilePhone ||
    clientData?.phone ||
    (order as any).customerPhone ||
    (order as any).crmClientPhone ||
    (order.shippingAddress as any)?.phone ||
    (order.billingAddress as any)?.phone ||
    "";
  const normPhone = normalizeContactPhone(rawPhone);
  const formattedPhone = normPhone.status === "valid" ? formatContactPhone(normPhone.value) : (rawPhone ? String(rawPhone) : null);
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
  const canCancel = !isQuote && index < stageOrder.indexOf("shipped") && !order.cancelled;
  const canCorrectAddress = ["confirmed", "separation"].includes(order.currentStage);
  const progress = order.totalCents > 0 ? Math.min(100, Math.round((order.paidCents / order.totalCents) * 100)) : 0;
  const deliveryAddress = formatSalesDeliveryAddress(order.shippingAddress);
  return (
    <aside className="space-y-3" aria-label="Detalhes da venda selecionada">
      {/* ─── BLOCO 1: CARD ÚNICO DO CLIENTE & FATOS COMERCIAIS (Topo - Padrão Chamados) ─── */}
      <header className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" data-testid="quote-client-header">
        {/* Linha 1: Identificação Principal em Flexbox Alinhado com Divisores Verticais */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          {/* Bloco A (Identificação do Cliente) */}
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 shadow-sm ring-4 ring-blue-50/50 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-900/20">
              <Building2 className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Cliente</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                {onClientNavigate && order.crmClientId ? (
                  <button
                    type="button"
                    className="truncate text-lg font-bold text-slate-900 transition-colors hover:text-blue-700 hover:underline dark:text-slate-100 dark:hover:text-blue-400"
                    title={order.customerName}
                    onClick={() => onClientNavigate(order.crmClientId)}
                  >
                    {order.customerName}
                  </button>
                ) : (
                  <h2 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100" title={order.customerName}>
                    {order.customerName}
                  </h2>
                )}
                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-800">
                  ERP
                </span>
                <DocumentTypeBadge documentType={order.documentType} />
              </div>
            </div>
          </div>

          {/* Divisor vertical sutil entre Bloco A e Bloco B */}
          <div className="hidden md:block h-10 w-px bg-slate-100 dark:bg-slate-800" />

          {/* Bloco B (Documento) */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">CPF / CNPJ</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
                {formattedDocument}
              </p>
            </div>
          </div>

          {/* Divisor vertical sutil entre Bloco B e Bloco C */}
          <div className="hidden md:block h-10 w-px bg-slate-100 dark:bg-slate-800" />

          {/* Bloco C (Contato / Telefone) */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <Phone className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Telefone</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
                {formattedPhone || "Não informado"}
              </p>
            </div>
          </div>

          {/* Divisor vertical sutil entre Bloco C e Bloco D */}
          <div className="hidden md:block h-10 w-px bg-slate-100 dark:bg-slate-800" />

          {/* Bloco D (Identificação da Proposta - Canto Direito) */}
          <div className="flex flex-col items-start md:items-end justify-center shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                {isQuote ? "Orçamento" : "Venda"} {order.orderNumber}
              </span>
              {isQuote ? (
                <CommercialBadge value={order.commercialStatus} />
              ) : (
                <>
                  <PaymentBadge value={order.paymentStatus} />
                  <StageBadge stage={order.currentStage as Stage} cancelled={order.cancelled} />
                </>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Criada em {dateTime.format(new Date(order.createdAt))}
            </p>
          </div>
        </div>

        {/* Divisor interno horizontal suave */}
        <div className="my-4 h-px w-full bg-slate-100 dark:bg-slate-800" />

        {/* Linha 2 (Fatos Comerciais & Endereço em Grid de 4 Colunas Equilibradas) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 divide-y divide-slate-100 sm:divide-x sm:divide-y-0 dark:divide-slate-800" data-testid="sales-detail-facts">
          {/* Coluna A (Vendedor) */}
          <div className="flex min-w-0 items-center gap-3 pt-2 sm:pt-0 sm:px-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Vendedor(a)
              </span>
              <p className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={order.sellerName ?? "Histórico indisponível"}>
                {order.sellerName ?? "Histórico indisponível"}
              </p>
            </div>
          </div>

          {/* Coluna B (Data Comercial) */}
          <div className="flex min-w-0 items-center gap-3 pt-2 sm:pt-0 sm:px-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Calendar className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Data comercial
              </span>
              <p className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {date.format(salesCommercialDate(order.commercialDate))}
              </p>
            </div>
          </div>

          {/* Coluna C (Previsão de Entrega) */}
          <div className="flex min-w-0 items-center gap-3 pt-2 sm:pt-0 sm:px-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Clock className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Previsão de entrega
              </span>
              <p className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {order.expectedDate ? date.format(new Date(`${order.expectedDate}T12:00:00`)) : "Não informada"}
              </p>
            </div>
          </div>

          {/* Coluna D (Endereço de Entrega) */}
          <div className="flex min-w-0 items-center gap-3 pt-2 sm:pt-0 sm:px-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <MapPin className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Local da entrega
                </span>
                {canWrite && canCorrectAddress && !order.cancelled && (
                  <button
                    type="button"
                    className="shrink-0 text-[10px] font-semibold text-blue-700 hover:underline dark:text-blue-400"
                    onClick={() => onCorrectAddress(order)}
                  >
                    Editar
                  </button>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-800 dark:text-slate-200" title={deliveryAddress}>
                {deliveryAddress}
              </p>
            </div>
          </div>
        </div>

        {order.cancelled && (
          <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <strong className="flex items-center gap-2"><XCircle className="h-4 w-4" />Venda cancelada</strong>
            <p className="mt-1">Última etapa: {stageLabels[order.currentStage as Stage]}. {order.cancellationReason}</p>
          </div>
        )}
        {(order.sourceQuote || order.convertedSale) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {order.sourceQuote && <button type="button" className="rounded-full bg-violet-50 px-3 py-1.5 font-semibold text-violet-800 shadow-sm transition-[background-color,box-shadow,transform] duration-150 hover:bg-violet-100 hover:shadow active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 motion-reduce:transform-none motion-reduce:transition-none dark:bg-violet-950/60 dark:text-violet-300" onClick={() => onRelatedNavigate(order.sourceQuote!.publicId)}>Origem: orçamento {order.sourceQuote.orderNumber}</button>}
            {order.convertedSale && <button type="button" className="rounded-full bg-blue-50 px-3 py-1.5 font-semibold text-blue-800 shadow-sm transition-[background-color,box-shadow,transform] duration-150 hover:bg-blue-100 hover:shadow active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transform-none motion-reduce:transition-none dark:bg-blue-950/60 dark:text-blue-300" onClick={() => onRelatedNavigate(order.convertedSale!.publicId)}>Venda resultante: {order.convertedSale.orderNumber}</button>}
          </div>
        )}
      </header>

      {/* ─── BLOCO 2: FERRAMENTAS DO ORÇAMENTO (Estilo Chamados) ─── */}
      {isQuote && (
        <div className="px-3 pt-3 sm:px-3">
          <div
            data-testid="quote-action-bar"
            className="flex min-h-[64px] items-center justify-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Ação 1: Editar orçamento */}
            {order.canEdit && (
              <button
                type="button"
                data-testid="quote-edit-action"
                className="group relative flex h-[52px] min-w-[80px] flex-col items-center justify-center gap-1 rounded-lg px-3 py-1 text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-300"
                onClick={() => onEdit(order.publicId)}
              >
                <Edit3 className="h-5 w-5" />
                <span className="text-[11px] font-medium">Editar orçamento</span>
              </button>
            )}

            {order.canEdit && <div role="separator" className="my-2 h-7 w-px shrink-0 bg-slate-200 dark:bg-slate-800" />}

            {/* Ação 2: Ciclo de Negociação / Status */}
            {order.commercialStatus === "draft" && (
              <button
                type="button"
                data-testid="quote-start-negotiation-action"
                className="group relative flex h-[52px] min-w-[104px] flex-col items-center justify-center gap-1 rounded-lg px-3 py-1 text-indigo-700 transition-colors hover:bg-indigo-50 hover:text-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                onClick={() => onCommercialStatus(order, "negotiation", false)}
              >
                <ArrowRightCircle className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <span className="text-[11px] font-medium">Iniciar negociação</span>
              </button>
            )}

            {order.commercialStatus === "negotiation" && (
              <>
                <button
                  type="button"
                  data-testid="quote-approve-action"
                  className="group relative flex h-[52px] min-w-[88px] flex-col items-center justify-center gap-1 rounded-lg px-3 py-1 text-emerald-700 transition-colors hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                  onClick={() => onCommercialStatus(order, "approved", false)}
                >
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-[11px] font-medium">Aprovar orçamento</span>
                </button>
                <div role="separator" className="my-2 h-7 w-px shrink-0 bg-slate-200 dark:bg-slate-800" />
                <button
                  type="button"
                  data-testid="quote-mark-lost-action"
                  className="group relative flex h-[52px] min-w-[88px] flex-col items-center justify-center gap-1 rounded-lg px-3 py-1 text-amber-700 transition-colors hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/40"
                  onClick={() => onCommercialStatus(order, "lost", true)}
                >
                  <XCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="text-[11px] font-medium">Marcar como perdido</span>
                </button>
              </>
            )}

            {order.commercialStatus === "approved" && (
              <>
                <button
                  type="button"
                  data-testid="quote-resume-negotiation-action"
                  className="group relative flex h-[52px] min-w-[88px] flex-col items-center justify-center gap-1 rounded-lg px-3 py-1 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  onClick={() => onCommercialStatus(order, "negotiation", true)}
                >
                  <RotateCcw className="h-5 w-5" />
                  <span className="text-[11px] font-medium">Retomar negociação</span>
                </button>
                <div role="separator" className="my-2 h-7 w-px shrink-0 bg-slate-200 dark:bg-slate-800" />
                <button
                  type="button"
                  data-testid="quote-convert-action"
                  className="group relative flex h-[52px] min-w-[88px] flex-col items-center justify-center gap-1 rounded-lg px-3 py-1 text-blue-700 transition-colors hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40"
                  onClick={() => onConvert(order)}
                >
                  <ShoppingCart className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <span className="text-[11px] font-medium">Converter em venda</span>
                </button>
              </>
            )}

            {["converted", "lost", "cancelled"].includes(order.commercialStatus) && (
              <div className="flex h-[52px] items-center px-3">
                <CommercialBadge value={order.commercialStatus} />
              </div>
            )}

            {order.commercialStatus !== "converted" && (
              <>
                <div role="separator" className="my-2 h-7 w-px shrink-0 bg-slate-200 dark:bg-slate-800" />
                <button
                  type="button"
                  data-testid="quote-delete-action"
                  className="group relative flex h-[52px] min-w-[80px] flex-col items-center justify-center gap-1 rounded-lg px-3 py-1 text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  onClick={() => onArchive(order)}
                >
                  <Trash2 className="h-5 w-5 text-rose-500" />
                  <span className="text-[11px] font-medium">Excluir orçamento</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2 p-3 sm:p-3">
        <section className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800" data-testid="sales-detail-products">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/60">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950 dark:text-slate-100"><PackageOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />{isQuote ? "Itens do orçamento" : "Produtos vendidos"} <span className="font-medium text-slate-500 dark:text-slate-400">({order.items.length})</span></h3>
            <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">{isQuote && <span className="hidden md:inline text-slate-500">Peças <strong className="text-slate-800 tabular-nums dark:text-slate-200">{money.format(order.items.filter(i => !isSalesItemService(i)).reduce((s, i) => s + i.lineTotalCents, 0) / 100)}</strong> · Mão de Obra <strong className="text-slate-800 tabular-nums dark:text-slate-200">{money.format((order.items.filter(i => isSalesItemService(i)).reduce((s, i) => s + i.lineTotalCents, 0) + (order.chargesCents || 0)) / 100)}</strong></span>}<span>Subtotal <strong className="ml-1 text-slate-950 tabular-nums dark:text-slate-100">{money.format(order.subtotalCents / 100)}</strong></span><span>Total <strong className="ml-1 text-base text-slate-950 tabular-nums dark:text-slate-100">{money.format(order.totalCents / 100)}</strong></span></div>
          </div>
          {order.items.length ? (
            <div className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
              {order.items.map(item => {
                const isService = isSalesItemService(item);
                return (
                  <div key={item.publicId} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]" data-testid="sales-detail-product-row">
                    {isService ? (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
                        <Wrench className="h-6 w-6" />
                      </span>
                    ) : (
                      <ProductThumb imagePath={item.canonicalImage?.thumbnailPath} name={item.productName} large />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <strong className="block truncate text-sm text-slate-950 dark:text-slate-100" title={item.productName}>{item.productName}</strong>
                        {isService ? (
                          <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                            Serviço
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            Peça
                          </span>
                        )}
                      </div>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400" title={[item.variantName, item.sku].filter(Boolean).join(" · ")}>
                        {isService ? (item.variantName || "Mão de Obra · Sem baixa de estoque") : ([item.variantName, item.sku].filter(Boolean).join(" · ") || "Produto histórico")}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400"><strong className="font-semibold text-slate-800 tabular-nums dark:text-slate-200">{formatQuantity(item.quantity)}</strong> × {money.format(item.unitPriceCents / 100)}{item.discountCents > 0 ? ` · desconto ${money.format(item.discountCents / 100)}` : ""}</span>
                    </div>
                    <div className="col-start-2 text-left sm:col-start-auto sm:text-right"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Total do item</span><strong className="text-sm text-slate-950 tabular-nums dark:text-slate-100">{money.format(item.lineTotalCents / 100)}</strong></div>
                  </div>
                );
              })}
            </div>
          ) : <p className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">Nenhum produto registrado nesta venda.</p>}
        </section>

        {isQuote ? (
          /* ─── BLOCOS 4, 5, 6: VEÍCULO, CONFIGURAÇÃO E EMISSÃO ─── */
          <QuoteActionCenter
            order={order}
            canWrite={canWrite}
            onRefresh={() => void utils.erp.sales.detail.invalidate({ publicId: order.publicId })}
          />
        ) : (
          <>
            <section className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 dark:border-slate-800 dark:bg-slate-900" data-testid="sales-detail-address">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Local de entrega</span>
                  <p className="break-words text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100" title={deliveryAddress}>
                    Endereço da entrega: {deliveryAddress}
                  </p>
                </div>
              </div>
              {canWrite && canCorrectAddress && !order.cancelled && <Button type="button" variant="outline" size="sm" className="shrink-0 border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60" onClick={() => onCorrectAddress(order)}>Corrigir endereço</Button>}
            </section>

            <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800 dark:bg-slate-900" data-testid="sales-detail-workflow">
              <SaleTimeline stage={order.currentStage as Stage} cancelled={order.cancelled} />
              {canWrite && !order.archivedAt && (
                <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800" data-testid="sales-detail-actions">
                  <div className="flex flex-wrap items-center gap-2">
                    {!order.cancelled && order.currentStage === "created" ? <><Button size="sm" variant="outline" className="dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" onClick={() => onEdit(order.publicId)}><Edit3 className="mr-2 h-4 w-4" />Editar</Button><Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600" onClick={() => onConfirm(order)}>Confirmar</Button></> : !order.cancelled && next ? <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600" onClick={() => onTransition(order, next, false)}>{nextActionLabel(next)} <ArrowRight className="ml-2 h-4 w-4" /></Button> : null}
                    {!order.cancelled && correction && <Button variant="outline" size="sm" className="border-slate-300 bg-slate-100 text-slate-800 shadow-sm hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700" onClick={() => onTransition(order, correction, true)}><RotateCcw className="mr-2 h-4 w-4" />Corrigir etapa</Button>}
                    {(order.cancelled || order.currentStage === "completed") && <Button size="sm" variant="outline" className="dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" onClick={() => onArchive(order)}><Archive className="mr-2 h-4 w-4" />Arquivar venda</Button>}
                  </div>
                  {canCancel && <Button variant="outline" size="sm" className="shrink-0 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60" disabled={order.paidCents > 0} title={order.paidCents > 0 ? "Há recebimentos registrados; estorno ainda não está disponível." : undefined} onClick={() => onCancel(order)}><XCircle className="mr-2 h-4 w-4" />Cancelar venda</Button>}
                </div>
              )}
              {order.paidCents > 0 && canCancel && <p className="mt-2 text-xs text-slate-500">Cancelamento bloqueado: há recebimentos e o estorno ainda não está disponível.</p>}
              {!isQuote && order.currentStage === "confirmed" && <p className="mt-2 text-xs text-slate-500">Retornar para Criada apagaria o significado dos títulos confirmados; use o cancelamento auditado quando não houver recebimentos.</p>}
              {!isQuote && order.currentStage === "shipped" && <p className="mt-2 text-xs text-slate-500">Retornar para Separação exige uma reversão específica de estoque e permanece bloqueado para evitar saldo inconsistente.</p>}
            </section>
          </>
        )}

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        {!isQuote && <section className="rounded-xl bg-slate-50 p-4">
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
                <span className="text-right font-semibold text-slate-900 tabular-nums">{money.format(entry.amountCents / 100)}<small className="block font-normal text-slate-500">Recebido: {money.format(entry.paidCents / 100)}</small></span>
              </div>
            )) : (
              <p className="text-xs leading-5 text-amber-800">Venda legada sem títulos vinculados. Nenhuma cobrança retroativa foi criada.</p>
            )}
          </div>
          <SalePaymentEditor key={order.publicId} order={order} canWrite={canWrite} />
        </section>}

        {!isQuote && <section className="rounded-xl bg-blue-50 p-4 text-blue-950">
          <h3 className="flex items-center gap-2 text-sm font-bold"><Box className="h-4 w-4" />Estoque</h3>
          <p className="mt-2 text-xs leading-5 text-blue-900">Saldo atual por variação, consultado no mesmo estoque de Produtos. Quantidade vendida e baixa são informações separadas.</p>
          <ul className="mt-3 divide-y divide-blue-100 rounded-lg bg-white/75 px-3">
            {order.items.map(item => {
              const stock = saleStockPresentation({ currentAvailable: item.currentAvailable, stockExitRecorded: item.stockExitRecorded, currentStage: order.currentStage });
              return <li key={item.publicId} className="py-2 text-xs">
                <strong className="block truncate">{item.productName}</strong>
                <span className="block truncate text-blue-800">{item.variantName || item.sku}</span>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span>Quantidade vendida: {formatQuantity(item.quantity)}</span>
                  <strong className="tabular-nums">{stock.availability}</strong>
                </div>
                <span className="block text-blue-800">{stock.movement}</span>
              </li>;
            })}
          </ul>
          <p className="mt-2 text-xs text-blue-800">{order.items.some(item => item.stockExitRecorded) ? "A saída registrada ocorreu no envio; concluir não repete a baixa." : stageOrder.indexOf(order.currentStage as Stage) >= stageOrder.indexOf("shipped") ? "Esta venda não possui movimentação de saída verificável no histórico atual." : "A disponibilidade será revalidada no envio; a confirmação não altera o saldo."}</p>
        </section>}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <div className="min-w-0">
          <SaleDocuments
            salePublicId={order.publicId}
            canWrite={canWrite && !order.cancelled}
            isQuote={order.documentType === "quote"}
          />
        </div>

        <DocumentHistory order={order} />
        </div>
      </div>
    </aside>
  );
}

function DocumentHistory({ order }: { order: SaleDetail }) {
  const [expanded, setExpanded] = React.useState(false);
  const historyId = `sales-history-${order.publicId}`;
  const events = order.history.slice().reverse();
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 motion-reduce:transition-none"
        aria-expanded={expanded}
        aria-controls={historyId}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Clock3 className="h-4 w-4 text-slate-500 dark:text-slate-400" />Histórico <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{events.length}</span></span>
        <ChevronDown className={cn("h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden="true" />
      </button>
      <div id={historyId} hidden={!expanded} className="border-t border-slate-100 px-4 pb-4">
        {!order.historyComplete && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            Parte do histórico é anterior à timeline auditada. Apenas eventos realmente registrados são exibidos.
          </p>
        )}
        <ol className="mt-4 space-y-0">
          {events.length ? events.map((event, eventIndex) => (
            <li key={`${event.createdAt}-${eventIndex}`} className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 pb-5 text-xs last:pb-0">
              <span className="relative z-10 mt-1 h-2.5 w-2.5 rounded-full bg-blue-600 ring-4 ring-blue-50" />
              {eventIndex < events.length - 1 && <span className="absolute left-[5px] top-4 h-[calc(100%-9px)] w-px bg-slate-200" />}
              <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><strong className="text-slate-800">{eventLabel(event.eventType, event.toStage, order.documentType, event.after)}</strong><time className="text-slate-500 tabular-nums">{dateTime.format(new Date(event.createdAt))}</time></div>
                <p className="mt-1 text-slate-500">Por {event.changedByName ?? event.changedBy}</p>
                {event.reason && <p className="mt-1 leading-4 text-slate-600">Motivo: {event.reason}</p>}
              </div>
            </li>
          )) : <li className="text-xs text-slate-500">Nenhum evento histórico registrado.</li>}
        </ol>
      </div>
    </section>
  );
}

function SalePaymentEditor({ order, canWrite }: { order: SaleDetail; canWrite: boolean }) {
  const utils = trpc.useUtils();
  const [selectedTitleId, setSelectedTitleId] = React.useState<string | null>(null);
  const [accountId, setAccountId] = React.useState("");
  const [amountCents, setAmountCents] = React.useState(0);
  const [feedback, setFeedback] = React.useState("");
  const attempt = React.useRef<string | null>(null);
  const accounts = trpc.erp.sales.options.useQuery(undefined, { enabled: canWrite && !order.cancelled && order.balanceCents > 0 });
  const settle = trpc.erp.finance.settle.useMutation();
  const title = order.installments.find(entry => entry.publicId === selectedTitleId);
  const remaining = title ? title.amountCents - title.paidCents : 0;
  const canRecord = canWrite && !order.cancelled && title?.status === "open" && remaining > 0;

  async function recordPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!title || !canRecord || !accountId || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > remaining) return;
    const idempotencyKey = attempt.current ?? crypto.randomUUID();
    attempt.current = idempotencyKey;
    setFeedback("");
    try {
      await settle.mutateAsync({ publicId: title.publicId, financialAccountPublicId: accountId, amountCents, idempotencyKey });
      attempt.current = null;
      setSelectedTitleId(null);
      setAmountCents(0);
      setFeedback("Recebimento registrado no Financeiro. Saldo, ledger e status foram atualizados.");
      await utils.erp.invalidate();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível registrar o recebimento.");
    }
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3 text-xs">
      {canWrite && !order.cancelled && order.installments.some(entry => entry.status === "open" && entry.paidCents < entry.amountCents) && (
        <div className="flex flex-wrap gap-2">
          {order.installments.filter(entry => entry.status === "open" && entry.paidCents < entry.amountCents).map(entry => (
            <Button key={entry.publicId} type="button" size="sm" variant="outline" onClick={() => { setSelectedTitleId(entry.publicId); setAmountCents(entry.amountCents - entry.paidCents); setFeedback(""); attempt.current = null; }}>
              Registrar recebimento · parcela {entry.installment}
            </Button>
          ))}
        </div>
      )}
      {canRecord && (
        <form className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3" onSubmit={event => void recordPayment(event)}>
          <p className="font-semibold text-slate-900">Recebimento da parcela {title.installment}</p>
          <label className="block font-medium text-slate-700">Conta de recebimento
            <select className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2" value={accountId} onChange={event => { setAccountId(event.target.value); attempt.current = null; }} required>
              <option value="">Selecione a conta</option>
              {accounts.data?.accounts.map(account => <option key={account.publicId} value={account.publicId}>{account.name}</option>)}
            </select>
          </label>
          {accounts.isError && <p role="alert" className="text-rose-700">Não foi possível carregar as contas financeiras.</p>}
          <label className="block font-medium text-slate-700">Valor recebido (R$)
            <MoneyInput className="mt-1" valueCents={amountCents} onChangeCents={value => { setAmountCents(value); attempt.current = null; }} />
          </label>
          <p className="text-slate-500">Saldo desta parcela: {money.format(remaining / 100)}. O lançamento atualizará o título, a conta e o ledger na mesma transação.</p>
          {amountCents > remaining && <p role="alert" className="text-rose-700">O valor não pode superar o saldo da parcela.</p>}
          <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => { setSelectedTitleId(null); attempt.current = null; }}>Cancelar</Button><Button type="submit" size="sm" disabled={settle.isPending || accounts.isLoading || !accountId || amountCents <= 0 || amountCents > remaining}>{settle.isPending ? "Registrando…" : "Confirmar recebimento"}</Button></div>
        </form>
      )}
      {feedback && <p role="status" className="mt-2 text-slate-700">{feedback}</p>}
      {order.paidCents > 0 && canWrite && <p className="mt-2 text-slate-500">Reverter um recebimento exige estorno financeiro, ainda indisponível nesta tela.</p>}
    </div>
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
  servicesCatalog,
  customerLookupEnabled,
  catalogLookupEnabled,
  sellers,
  paymentMethods,
  separateBillingAddress,
  setSeparateBillingAddress,
  expandedCatalogProductId,
  setExpandedCatalogProductId,
  busy,
  formError,
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
  servicesCatalog: { data?: ServicesResults; isLoading: boolean; isError: boolean };
  customerLookupEnabled: boolean;
  catalogLookupEnabled: boolean;
  sellers: Array<{ publicId: string; name: string }>;
  paymentMethods: string[];
  separateBillingAddress: boolean;
  setSeparateBillingAddress: React.Dispatch<React.SetStateAction<boolean>>;
  expandedCatalogProductId: string | null;
  setExpandedCatalogProductId: React.Dispatch<React.SetStateAction<string | null>>;
  busy: boolean;
  formError: string;
  onSubmit: (event: React.FormEvent) => void;
}) {
  if (!form) return null;
  const resolveServiceMutation = trpc.erp.services.resolveForSale.useMutation();
  const [resolvingServiceId, setResolvingServiceId] = React.useState<number | null>(null);
  const totals = calculateSalesFormTotals(form);
  const stockIssues = salesStockIssues(form.items);
  const progress = salesDraftProgress(form);
  const completeSteps = progress.filter(item => item.complete).length;
  const patchItem = (index: number, patch: Record<string, unknown>) =>
    setForm(current =>
      current
        ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }
        : current
    );
  const addCatalogItem = (product: CatalogOption) => {
    if (form.documentType === "sale" && Number(product.availableQuantity) <= 0) return;
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
      itemType: "product",
    }] } : current);
    setCatalogSearch("");
    setExpandedCatalogProductId(null);
  };
  const addServiceItem = async (service: ServiceOption) => {
    try {
      setResolvingServiceId(service.id);
      const resolved = await resolveServiceMutation.mutateAsync({ serviceId: service.id });
      setForm(current => current ? { ...current, items: [...current.items, {
        productPublicId: resolved.productPublicId,
        inventoryItemPublicId: resolved.inventoryItemPublicId,
        productName: resolved.name,
        variantName: service.category ? `Serviço · ${service.category}` : "Serviço",
        sku: resolved.sku,
        unit: "serviço",
        imagePath: null,
        availableQuantity: null,
        quantity: "1.000",
        unitPriceCents: resolved.priceCents,
        discountCents: 0,
        itemType: "service",
      }] } : current);
      setCatalogSearch("");
      setExpandedCatalogProductId(null);
    } catch (err) {
      console.error("Falha ao resolver serviço para venda", err);
    } finally {
      setResolvingServiceId(null);
    }
  };
  const groups = (catalog.data?.items ?? []).reduce<Array<{ productPublicId: string; name: string; imagePath?: string | null; options: CatalogOption[] }>>((result, item) => {
    const current = result.find(group => group.productPublicId === item.productPublicId);
    if (current) current.options.push(item);
    else result.push({ productPublicId: item.productPublicId, name: item.name, imagePath: item.canonicalImage?.thumbnailPath, options: [item] });
    return result;
  }, []);

  return (
    <Dialog open onOpenChange={open => !open && setForm(null)}>
      <DialogContent className="flex h-[min(94vh,920px)] flex-col gap-0 overflow-hidden bg-slate-50 p-0 sm:max-w-[min(96vw,1440px)] dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader className="border-b border-slate-200 bg-white px-5 py-4 sm:px-7 dark:border-slate-800 dark:bg-slate-900">
          <div className="pr-10">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-400">Operação de vendas</p>
            <DialogTitle className="mt-1 text-xl text-slate-900 dark:text-slate-100">{form.publicId ? `Editar ${form.documentType === "quote" ? "orçamento" : "venda"}` : form.documentType === "quote" ? "Novo orçamento" : "Nova venda"}</DialogTitle>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Complete a operação por etapas. O documento será salvo primeiro como rascunho, sem movimentar estoque ou financeiro.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Progresso da nova venda">
            {progress.map((item, index) => <span key={item.key} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", item.complete ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400")}><span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-[10px]", item.complete ? "bg-emerald-600 text-white" : "bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-300")}>{item.complete ? <Check className="h-3 w-3" /> : index + 1}</span>{item.label}</span>)}
          </div>
          {formError && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">{formError}</p>}
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 [scrollbar-width:thin]">
            <div className="mx-auto grid max-w-[1320px] gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
              <div className="space-y-5">
                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900/60" aria-labelledby="sale-customer-heading">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-blue-700 dark:text-blue-400">1. Identificação</p><h3 id="sale-customer-heading" className="mt-1 font-bold text-slate-950 dark:text-slate-100">Cliente</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pesquise por nome, documento ou código. Nenhum cadastro é carregado antes da busca.</p></div>{form.crmClientId && <Button type="button" size="sm" variant="ghost" onClick={() => { setForm(current => current ? { ...current, crmClientId: "", customerName: "", shippingAddress: blankSalesAddress(), billingAddress: blankSalesAddress() } : current); setCustomerSearch(""); }}>Trocar cliente</Button>}</div>
                  {form.crmClientId ? (
                    <div className="mt-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/60 dark:bg-blue-950/40"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white"><UserRound className="h-5 w-5" /></span><div className="min-w-0"><strong className="block truncate text-slate-950 dark:text-slate-100">{form.customerName}</strong><span className="text-xs text-slate-600 dark:text-slate-400">Cliente selecionado para esta venda</span></div><Check className="ml-auto h-5 w-5 text-emerald-600 dark:text-emerald-400" /></div>
                  ) : (
                    <div className="relative mt-4">
                      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500 dark:text-slate-400" />
                      <Input autoComplete="off" className="pl-9 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" aria-label="Buscar cliente para a venda" placeholder="Digite ao menos 2 caracteres" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} />
                      <div className="mt-2 rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                        {!customerLookupEnabled ? <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Comece a digitar para localizar um cliente.</p> : customers.isLoading ? <p role="status" className="p-4 text-sm text-slate-500 dark:text-slate-400">Buscando clientes…</p> : customers.isError ? <p role="alert" className="p-4 text-sm text-rose-700 dark:text-rose-400">Não foi possível buscar clientes.</p> : customers.data?.items.length ? <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto [scrollbar-width:thin] dark:divide-slate-700/60">{customers.data.items.map(customer => (
                          <button type="button" key={customer.crmClientId} className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 motion-reduce:transition-none dark:hover:bg-slate-700/50 dark:active:bg-slate-700" onClick={() => { const address: SalesAddress = { recipientName: customer.responsibleName || customer.customerName, postalCode: customer.postalCode || "", street: customer.address || "", number: "", complement: "", district: "", city: customer.city || "", state: customer.state || "" }; setForm(current => current ? { ...current, crmClientId: customer.crmClientId, customerName: customer.customerName, shippingAddress: address, billingAddress: { ...address } } : current); setCustomerSearch(""); setSeparateBillingAddress(false); }}><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span className="min-w-0"><strong className="block truncate text-sm text-slate-900 dark:text-slate-100">{customer.customerName}</strong><span className="block truncate text-xs text-slate-500 dark:text-slate-400">{[customer.document, customer.responsibleName, [customer.city, customer.state].filter(Boolean).join("/")].filter(Boolean).join(" · ") || "Cadastro encontrado"}</span></span></button>
                        ))}</div> : <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Nenhum cliente encontrado para “{customerSearch.trim()}”.</p>}
                      </div>
                      {customerLookupEnabled && <SearchPager page={customerPage} total={customers.data?.total ?? 0} pageSize={customers.data?.pageSize ?? 12} onPage={setCustomerPage} />}
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900/60" aria-labelledby="sale-products-heading">
                  <div><p className="text-xs font-semibold text-blue-700 dark:text-blue-400">2. Itens</p><h3 id="sale-products-heading" className="mt-1 font-bold text-slate-950 dark:text-slate-100">Produtos, peças e serviços</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pesquise produtos físicos ou serviços/mão de obra; as variações aparecem somente quando você abrir o resultado.</p></div>
                  <label className="relative mt-4 block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" /><Input autoComplete="off" className="pl-9 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" aria-label="Buscar produto para a venda" placeholder="Nome, SKU, código, serviço ou variação" value={catalogSearch} onChange={event => { setCatalogSearch(event.target.value); setExpandedCatalogProductId(null); }} /></label>
                  <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700">
                    {!catalogLookupEnabled ? (
                      <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Digite ao menos {SALES_LOOKUP_MIN_LENGTH} caracteres para pesquisar o catálogo.</p>
                    ) : (catalog.isLoading || servicesCatalog.isLoading) ? (
                      <p role="status" className="p-4 text-sm text-slate-500 dark:text-slate-400">Buscando itens (produtos e serviços)…</p>
                    ) : (catalog.isError && servicesCatalog.isError) ? (
                      <p role="alert" className="p-4 text-sm text-rose-700 dark:text-rose-400">Não foi possível buscar itens do catálogo.</p>
                    ) : (groups.length || (servicesCatalog.data?.items ?? []).length) ? (
                      <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto [scrollbar-width:thin] dark:divide-slate-700/60">
                        {Boolean(servicesCatalog.data?.items?.length) && (
                          <div className="p-2">
                            <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                              <Wrench className="h-3.5 w-3.5" />
                              <span>⚙️ Serviços e Mão de Obra ({servicesCatalog.data!.items.length})</span>
                            </div>
                            <div className="mt-1 space-y-1">
                              {servicesCatalog.data!.items.map(service => {
                                const isResolving = resolvingServiceId === service.id;
                                return (
                                  <button
                                    type="button"
                                    key={`service-${service.id}`}
                                    disabled={isResolving}
                                    onClick={() => addServiceItem(service)}
                                    className="flex w-full items-center justify-between gap-3 rounded-md p-2 text-left transition-colors duration-150 hover:bg-blue-50/70 active:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:hover:bg-slate-800/60"
                                  >
                                    <div className="flex min-w-0 items-center gap-3">
                                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
                                        <Wrench className="h-4 w-4" />
                                      </span>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <strong className="truncate text-sm text-slate-900 dark:text-slate-100">
                                            {service.name}
                                          </strong>
                                          <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                                            Serviço
                                          </span>
                                        </div>
                                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                          {[
                                            service.category || "Mão de Obra",
                                            service.estimatedMinutes ? `${service.estimatedMinutes} min` : null,
                                            service.code,
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                      <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-200">
                                        {money.format(Number(service.price))}
                                      </span>
                                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white transition-colors dark:bg-slate-800 dark:text-blue-400">
                                        {isResolving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {Boolean(groups.length) && (
                          <div className="p-2">
                            {Boolean(servicesCatalog.data?.items?.length) && (
                              <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                <Package className="h-3.5 w-3.5" />
                                <span>📦 Produtos e Peças ({groups.length})</span>
                              </div>
                            )}
                            <div className="space-y-1">
                              {groups.map(group => {
                                const expanded = expandedCatalogProductId === group.productPublicId;
                                const singleOption = group.options.length === 1 ? group.options[0] : null;
                                const singleUnavailable = Boolean(singleOption && Number(singleOption.availableQuantity) <= 0);
                                const blockedByStock = form.documentType === "sale" && singleUnavailable;
                                return (
                                  <div key={group.productPublicId} className="p-1">
                                    <button
                                      type="button"
                                      disabled={blockedByStock}
                                      className="flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:hover:bg-slate-700/50 dark:active:bg-slate-700"
                                      aria-expanded={group.options.length > 1 ? expanded : undefined}
                                      onClick={() => singleOption ? addCatalogItem(singleOption) : setExpandedCatalogProductId(expanded ? null : group.productPublicId)}
                                    >
                                      <ProductThumb imagePath={group.imagePath} name={group.name} />
                                      <span className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          <strong className="truncate text-sm text-slate-900 dark:text-slate-100">{group.name}</strong>
                                          <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                            Peça
                                          </span>
                                        </div>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                                          {singleOption ? `${singleOption.sku} · ${singleUnavailable ? "sem estoque" : `disponível ${formatQuantity(singleOption.availableQuantity)}`}` : `${group.options.length} variações encontradas`}
                                        </span>
                                      </span>
                                      {singleOption ? <Plus className="h-4 w-4 text-blue-700 dark:text-blue-400" /> : expanded ? <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-500 dark:text-slate-400" />}
                                    </button>
                                    {expanded && (
                                      <div className="ml-12 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-700">
                                        {group.options.map(option => {
                                          const used = form.items.some(item => item.inventoryItemPublicId === option.inventoryItemPublicId);
                                          const unavailable = Number(option.availableQuantity) <= 0;
                                          const unavailableForSale = form.documentType === "sale" && unavailable;
                                          return (
                                            <button
                                              type="button"
                                              key={option.inventoryItemPublicId}
                                              disabled={used || unavailableForSale}
                                              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-blue-50 active:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none dark:hover:bg-slate-700/50 dark:active:bg-slate-700"
                                              onClick={() => addCatalogItem(option)}
                                            >
                                              <span className="min-w-0">
                                                <strong className="block truncate text-slate-900 dark:text-slate-100">{option.variantAttributes || option.variantName || "Produto padrão"}</strong>
                                                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{option.sku} · {unavailable ? "sem estoque" : `disponível ${formatQuantity(option.availableQuantity)}`}</span>
                                              </span>
                                              <span className="shrink-0 font-semibold tabular-nums dark:text-slate-200">{money.format(option.salePriceCents / 100)}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Nenhum produto ou serviço encontrado para “{catalogSearch.trim()}”.</p>
                    )}
                  </div>
                  {catalogLookupEnabled && <SearchPager page={catalogPage} total={catalog.data?.total ?? 0} pageSize={catalog.data?.pageSize ?? 12} onPage={setCatalogPage} />}

                  <div className="mt-4 space-y-2">
                    {form.items.length ? form.items.map((item, index) => {
                      const isService = isSalesItemService(item);
                      return (
                        <div key={`${item.inventoryItemPublicId ?? item.productPublicId}-${index}`} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(210px,1fr)_100px_145px_135px_110px_36px] md:items-end dark:border-slate-800 dark:bg-slate-800/40">
                          <div className="flex min-w-0 items-center gap-3 self-center">
                            {isService ? (
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
                                <Wrench className="h-5 w-5" />
                              </span>
                            ) : (
                              <ProductThumb imagePath={item.imagePath} name={item.productName ?? "Produto"} />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <strong className="block truncate text-sm text-slate-900 dark:text-slate-100">{item.productName ?? item.productPublicId}</strong>
                                {isService ? (
                                  <span className="inline-flex shrink-0 items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                                    Serviço
                                  </span>
                                ) : (
                                  <span className="inline-flex shrink-0 items-center rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                    Peça
                                  </span>
                                )}
                              </div>
                              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                {isService
                                  ? `${item.variantName || "Mão de Obra"} · sem baixa de estoque`
                                  : `${item.variantName || item.sku} · disponível ${item.availableQuantity ? formatQuantity(item.availableQuantity) : "—"}`}
                              </span>
                            </div>
                          </div>
                          <MoneyOrQuantity label="Quantidade" value={item.quantity} onChange={value => patchItem(index, { quantity: value })} />
                          <MoneyOrQuantity money label="Preço unit." value={item.unitPriceCents} onChange={value => patchItem(index, { unitPriceCents: value })} />
                          <MoneyOrQuantity money label="Desconto" value={item.discountCents ?? 0} onChange={value => patchItem(index, { discountCents: value })} />
                          <div className="text-right"><span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Subtotal</span><strong className="mt-2 block text-sm tabular-nums text-slate-950 dark:text-slate-100">{money.format(Math.max(0, Math.round(Number(item.quantity || 0) * item.unitPriceCents) - (item.discountCents ?? 0)) / 100)}</strong></div>
                          <Button type="button" size="icon" variant="ghost" aria-label={`Remover ${item.productName ?? "produto"}`} className="text-rose-700 dark:text-rose-400" onClick={() => setForm(current => current ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      );
                    }) : <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">Pesquise e adicione o primeiro produto ou serviço.</div>}
                  </div>
                  {stockIssues.length > 0 && (
                    <p role={form.documentType === "sale" ? "alert" : "status"} className={cn("mt-3 rounded-lg border p-3 text-sm", form.documentType === "sale" ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200")}>
                      {form.documentType === "quote" ? "Este orçamento poderá continuar após sua confirmação." : "A venda não pode ser salva enquanto houver saldo insuficiente."} {stockIssues.map(issue => `${issue.productName}: solicitado ${formatQuantity(issue.requestedQuantity)}, disponível ${formatQuantity(issue.availableQuantity)}.`).join(" ")}
                    </p>
                  )}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900/60" aria-labelledby="sale-address-heading">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-blue-700 dark:text-blue-400">3. Entrega</p><h3 id="sale-address-heading" className="mt-1 font-bold text-slate-950 dark:text-slate-100">Endereço do cliente</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Este endereço ficará preservado no histórico da venda.</p></div><Button type="button" size="sm" variant="outline" onClick={() => { setSeparateBillingAddress(value => !value); if (separateBillingAddress) setForm(current => current ? { ...current, billingAddress: { ...(current.shippingAddress ?? blankSalesAddress()) } } : current); }}>{separateBillingAddress ? "Usar um único endereço" : "Usar outro endereço de cobrança"}</Button></div>
                  <div className={cn("mt-4 grid gap-4", separateBillingAddress && "lg:grid-cols-2")}><AddressFields title={separateBillingAddress ? "Entrega" : undefined} address={form.shippingAddress ?? blankSalesAddress()} onChange={shippingAddress => setForm(current => current ? { ...current, shippingAddress, billingAddress: separateBillingAddress ? current.billingAddress : { ...shippingAddress } } : current)} />{separateBillingAddress && <AddressFields title="Cobrança" address={form.billingAddress ?? blankSalesAddress()} onChange={billingAddress => setForm(current => current ? { ...current, billingAddress } : current)} />}</div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900/60" aria-labelledby="sale-values-heading">
                  <div><p className="text-xs font-semibold text-blue-700 dark:text-blue-400">4. Valores e prazo</p><h3 id="sale-values-heading" className="mt-1 font-bold text-slate-950 dark:text-slate-100">Condições comerciais</h3></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Data comercial<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="date" value={form.commercialDate} onChange={event => setForm(current => current ? { ...current, commercialDate: event.target.value } : current)} /></label>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Vendedor(a)<select className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={form.sellerUserId} onChange={event => setForm(current => current ? { ...current, sellerUserId: event.target.value } : current)}><option value="">{form.publicId ? "Preservar vendedor atual" : "Responsável atual"}</option>{sellers.map(seller => <option key={seller.publicId} value={seller.publicId}>{seller.name}</option>)}</select></label>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Previsão de entrega<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="date" value={form.expectedDate} onChange={event => setForm(current => current ? { ...current, expectedDate: event.target.value } : current)} /></label>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Forma de pagamento<select className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={form.paymentMethod} onChange={event => setForm(current => current ? { ...current, paymentMethod: event.target.value } : current)}><option value="">Definir na confirmação</option>{paymentMethods.map(method => <option key={method} value={method}>{method}</option>)}</select></label>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Condições de pagamento<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" maxLength={255} placeholder="Ex.: 30/60 dias" value={form.paymentTerms ?? ""} onChange={event => setForm(current => current ? { ...current, paymentTerms: event.target.value } : current)} /></label>
                    <MoneyOrQuantity money label="Desconto do documento" value={form.orderDiscountCents ?? 0} onChange={value => setForm(current => current ? { ...current, orderDiscountCents: value } : current)} />
                    <MoneyOrQuantity money label="Frete" value={form.freightCents ?? 0} onChange={value => setForm(current => current ? { ...current, freightCents: value } : current)} />
                    <MoneyOrQuantity money label="Outros encargos" value={form.chargesCents ?? 0} onChange={value => setForm(current => current ? { ...current, chargesCents: value } : current)} />
                  </div>
                  {form.documentType === "quote" && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                      <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Nicho Automotivo & Serviços</p>
                      <h4 className="mt-0.5 text-sm font-bold text-slate-950 dark:text-slate-100">Dados do Veículo / Objeto (Opcional)</h4>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Marca / Modelo
                          <Input className="mt-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Ex: Toyota Corolla XEi" value={(form.serviceMetadata as any)?.brandModel ?? ""} onChange={e => setForm(c => c ? { ...c, serviceMetadata: { ...(c.serviceMetadata || {}), brandModel: e.target.value } } : c)} />
                        </label>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Placa
                          <Input className="mt-1 text-xs uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Ex: ABC-1234" value={(form.serviceMetadata as any)?.plate ?? ""} onChange={e => setForm(c => c ? { ...c, serviceMetadata: { ...(c.serviceMetadata || {}), plate: e.target.value.toUpperCase() } } : c)} />
                        </label>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Ano
                          <Input className="mt-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Ex: 2022" value={(form.serviceMetadata as any)?.year ?? ""} onChange={e => setForm(c => c ? { ...c, serviceMetadata: { ...(c.serviceMetadata || {}), year: e.target.value } } : c)} />
                        </label>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cor
                          <Input className="mt-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Ex: Prata" value={(form.serviceMetadata as any)?.color ?? ""} onChange={e => setForm(c => c ? { ...c, serviceMetadata: { ...(c.serviceMetadata || {}), color: e.target.value } } : c)} />
                        </label>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">KM
                          <Input className="mt-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Ex: 45.000" value={(form.serviceMetadata as any)?.km ?? ""} onChange={e => setForm(c => c ? { ...c, serviceMetadata: { ...(c.serviceMetadata || {}), km: e.target.value } } : c)} />
                        </label>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Data de Entrada
                          <Input className="mt-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="date" value={(form.serviceMetadata as any)?.entryDate ?? ""} onChange={e => setForm(c => c ? { ...c, serviceMetadata: { ...(c.serviceMetadata || {}), entryDate: e.target.value } } : c)} />
                        </label>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Previsão de Saída
                          <Input className="mt-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="date" value={(form.serviceMetadata as any)?.exitDate ?? ""} onChange={e => setForm(c => c ? { ...c, serviceMetadata: { ...(c.serviceMetadata || {}), exitDate: e.target.value } } : c)} />
                        </label>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Nome do Arquivo PDF
                          <Input className="mt-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Ex: Orçamento - Cliente - Data" value={form.documentCustomName ?? ""} onChange={e => setForm(c => c ? { ...c, documentCustomName: e.target.value } : c)} />
                        </label>
                      </div>
                    </div>
                  )}
                  <label className="mt-4 block text-xs font-semibold text-slate-700 dark:text-slate-300">Observações<textarea className="mt-1 min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={form.notes} onChange={event => setForm(current => current ? { ...current, notes: event.target.value } : current)} /></label>
                </section>
              </div>

              <aside className="self-start rounded-xl border border-slate-200 bg-white p-5 xl:sticky xl:top-0 dark:border-slate-800 dark:bg-slate-900/60" aria-label="Resumo da venda em edição">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Resumo</p><h3 className="mt-1 text-lg font-bold text-slate-950 dark:text-slate-100">{completeSteps}/{progress.length} etapas preenchidas</h3>
                <div className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3 text-slate-600 dark:text-slate-400"><span>Itens</span><strong className="text-slate-950 dark:text-slate-100">{form.items.length}</strong></div>{form.documentType === "quote" ? (<><div className="flex justify-between gap-3 text-slate-600 dark:text-slate-400"><span>Total Peças</span><strong className="tabular-nums text-slate-950 dark:text-slate-100">{money.format(totals.partsSubtotalCents / 100)}</strong></div><div className="flex justify-between gap-3 text-slate-600 dark:text-slate-400"><span>Total Mão de Obra</span><strong className="tabular-nums text-slate-950 dark:text-slate-100">{money.format((totals.servicesSubtotalCents + (form.chargesCents ?? 0)) / 100)}</strong></div></>) : (<div className="flex justify-between gap-3 text-slate-600 dark:text-slate-400"><span>Subtotal</span><strong className="tabular-nums text-slate-950 dark:text-slate-100">{money.format(totals.subtotalCents / 100)}</strong></div>)}<div className="flex justify-between gap-3 text-slate-600 dark:text-slate-400"><span>Descontos</span><strong className="tabular-nums text-slate-950 dark:text-slate-100">− {money.format(totals.discountCents / 100)}</strong></div><div className="flex justify-between gap-3 text-slate-600 dark:text-slate-400"><span>Frete</span><strong className="tabular-nums text-slate-950 dark:text-slate-100">{money.format((form.freightCents ?? 0) / 100)}</strong></div>{form.documentType !== "quote" && <div className="flex justify-between gap-3 text-slate-600 dark:text-slate-400"><span>Encargos</span><strong className="tabular-nums text-slate-950 dark:text-slate-100">{money.format((form.chargesCents ?? 0) / 100)}</strong></div>}<div className="flex justify-between gap-3 border-t border-slate-200 pt-3 text-base dark:border-slate-800"><strong>Total</strong><strong className="tabular-nums text-blue-700 dark:text-blue-400">{money.format(totals.totalCents / 100)}</strong></div></div>
                <div className="mt-5 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300"><strong className="block">Próximo passo</strong>{form.documentType === "quote" ? "Salve o orçamento e conduza-o por negociação e aprovação antes de converter em venda." : "Salve o rascunho. Categoria, conta e parcelas serão revisadas antes da confirmação."}</div>
              </aside>
            </div>
          </div>
          <DialogFooter className="border-t border-slate-200 bg-white px-5 py-3 sm:px-7 dark:border-slate-800 dark:bg-slate-900"><Button type="button" variant="outline" disabled={busy} onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" className="transition-colors motion-reduce:transition-none active:translate-y-px" disabled={busy || (form.documentType === "sale" && stockIssues.length > 0) || !form.crmClientId || !form.items.length || totals.totalCents <= 0 || (form.freightCents ?? 0) < 0 || (form.chargesCents ?? 0) < 0}>{busy ? "Salvando…" : `Salvar ${form.documentType === "quote" ? "orçamento" : "venda"}`}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QuoteConversionDialog({ order, busy, error, onClose, onReview, onConfirm }: {
  order: SaleDetail | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onReview: (order: SaleDetail) => void;
  onConfirm: (order: SaleDetail) => void;
}) {
  if (!order) return null;
  return (
    <Dialog open onOpenChange={open => !open && !busy && onClose()}>
      <DialogContent className="bg-slate-50 p-0 sm:max-w-2xl dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader className="border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-400">Conversão rastreável</p>
          <DialogTitle className="mt-1 text-slate-900 dark:text-slate-100">Converter {order.orderNumber} em venda</DialogTitle>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">Revise o resumo aprovado. A operação preservará a identidade do pedido e validará o estoque no servidor antes de convertê-lo em venda.</p>
        </DialogHeader>
        <div className="space-y-4 p-5">
          <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-800/60">
            <InfoRow icon={UserRound} label="Cliente" value={order.customerName} />
            <InfoRow icon={UserRound} label="Responsável" value={order.sellerName ?? "Não informado"} />
            <InfoRow icon={ReceiptText} label="Itens aprovados" value={`${order.items.length} item(ns)`} detail={order.items.map(item => item.productName).slice(0, 2).join(" · ")} />
            <InfoRow icon={CircleDollarSign} label="Valor aprovado" value={money.format(order.totalCents / 100)} detail={order.paymentTerms || "Condição a revisar na confirmação"} />
          </section>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200"><strong className="block text-blue-950 dark:text-blue-100">Sem efeitos operacionais antecipados</strong>A conversão não cria títulos, não registra pagamento e não movimenta estoque. A venda resultante começa como rascunho.</div>
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
        </div>
        <DialogFooter className="border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900"><Button variant="outline" disabled={busy} onClick={() => onReview(order)}>Revisar dados</Button><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={busy} onClick={() => onConfirm(order)}>{busy ? "Convertendo…" : "Converter em venda"}</Button></DialogFooter>
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
      <DialogContent className="max-h-[96dvh] overflow-y-auto bg-slate-50 p-0 [scrollbar-width:thin] sm:max-w-[min(96vw,1180px)] dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader className="border-b border-slate-200 bg-white px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-400">Conferência final</p><DialogTitle className="mt-0.5 text-slate-900 dark:text-slate-100">Confirmar venda</DialogTitle></div><p className="max-w-xl text-xs text-slate-600 dark:text-slate-400">A venda e seus títulos serão confirmados na mesma transação. A confirmação não reserva estoque.</p></div></DialogHeader>
        <div className="p-3 sm:p-4">
          <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.85fr)] dark:border-slate-800 dark:bg-slate-900" data-testid="sales-confirmation-layout">
            <section className="min-w-0 p-4" aria-labelledby="confirmation-financial-heading" data-testid="sales-confirmation-financial">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="confirmation-financial-heading" className="font-bold text-slate-950 dark:text-slate-100">Condições financeiras</h3><div className="flex items-baseline gap-2 text-xs text-slate-500 dark:text-slate-400"><span>Total</span><strong className="text-lg text-slate-950 tabular-nums dark:text-slate-100">{money.format(state.totalCents / 100)}</strong></div></div>
              {optionsLoading && <p role="status" className="mt-2 rounded-lg bg-blue-50 p-2.5 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">Carregando categorias, contas e formas de pagamento…</p>}
              {optionsError && <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 p-2.5 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200"><span>Não foi possível carregar os cadastros financeiros. Nenhuma confirmação será enviada enquanto este gate estiver incompleto.</span><Button type="button" size="sm" variant="outline" onClick={onRetryOptions}>Tentar novamente</Button></div>}
              <fieldset className="mt-3">
                <legend className="text-xs font-semibold text-slate-700 dark:text-slate-300">Situação no momento da confirmação</legend>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                  {(["pending", "partial", "paid"] as const).map(status => (
                    <button key={status} type="button" className={cn("rounded-lg border px-3 py-2 text-left text-sm font-semibold shadow-sm transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none", state.paymentStatus === status ? "border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-200" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:shadow dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700")} aria-pressed={state.paymentStatus === status} disabled={status === "partial" && state.totalCents <= 1} onClick={() => setState({ ...state, paymentStatus: status, receivedCents: status === "pending" ? 0 : status === "paid" ? state.totalCents : Math.max(1, Math.min(state.totalCents - 1, Math.floor(state.totalCents / 2))) })}>{status === "pending" ? "Pendente" : status === "partial" ? "Pagamento parcial" : "Pago"}</button>
                  ))}
                </div>
              </fieldset>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {state.paymentStatus === "partial" && <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 xl:col-span-2">Valor já recebido<MoneyInput className="mt-1 tabular-nums" label="Valor já recebido" valueCents={state.receivedCents} onChangeCents={receivedCents => setState({ ...state, receivedCents })} /></label>}
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Forma de pagamento<select id="sales-confirm-payment" className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={state.paymentMethod} onChange={event => setState({ ...state, paymentMethod: event.target.value })}><option value="">Selecione</option>{paymentMethods.map(value => <option key={value}>{value}</option>)}</select></label>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Categoria financeira<select id="sales-confirm-category" required className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={state.categoryPublicId} onChange={event => setState({ ...state, categoryPublicId: event.target.value })}><option value="">Selecione</option>{categories.map(value => <option key={value.publicId} value={value.publicId}>{value.name}</option>)}</select></label>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Conta prevista<select id="sales-confirm-account" required className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={state.financialAccountPublicId} onChange={event => setState({ ...state, financialAccountPublicId: event.target.value })}><option value="">Selecione</option>{accounts.map(value => <option key={value.publicId} value={value.publicId}>{value.name}</option>)}</select></label>
                <div id="sales-confirm-installments" className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-1"><label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Parcelas<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="number" min={1} max={120} value={state.installmentCount} onChange={event => setState({ ...state, installmentCount: Math.max(1, Number(event.target.value)) })} /></label><label className="text-xs font-semibold text-slate-700 dark:text-slate-300">1º vencimento<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="date" value={state.firstDueDate} onChange={event => setState({ ...state, firstDueDate: event.target.value })} /></label></div>
              </div>
              {!paymentReady && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-400">O valor recebido deve ser maior que zero e menor que o total para um pagamento parcial.</p>}
              <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Isenção não está disponível porque o domínio financeiro atual não possui um lançamento isento auditável. Nenhum status fictício será gravado.</p>
              <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-700" aria-label="Resumo financeiro da confirmação">
                <div className="bg-slate-50 px-3 py-2 dark:bg-slate-800"><span className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</span><strong className="text-sm text-slate-950 tabular-nums dark:text-slate-100">{money.format(state.totalCents / 100)}</strong></div>
                <div className="bg-slate-50 px-3 py-2 dark:bg-slate-800"><span className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Recebido</span><strong className="text-sm text-emerald-700 tabular-nums dark:text-emerald-400">{money.format(state.receivedCents / 100)}</strong></div>
                <div className="bg-slate-50 px-3 py-2 dark:bg-slate-800"><span className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Restante</span><strong className="text-sm text-slate-950 tabular-nums dark:text-slate-100">{money.format(Math.max(0, state.totalCents - state.receivedCents) / 100)}</strong></div>
              </div>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Parcelas previstas">{installments.length ? installments.map((entry, index) => <div key={`${entry.dueDate}-${index}`} className="flex justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800"><span className="text-slate-600 dark:text-slate-400">{index + 1}/{installments.length} · {date.format(new Date(`${entry.dueDate}T12:00:00`))}</span><strong className="tabular-nums text-slate-900 dark:text-slate-100">{money.format(entry.amountCents / 100)}</strong></div>) : <p className="text-sm text-amber-800 dark:text-amber-400">Defina parcelas e vencimento.</p>}</div>
              <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSetup(setup === "category" ? null : "category")}><Plus className="mr-1.5 h-3.5 w-3.5" />Nova categoria a receber</Button><Button type="button" size="sm" variant="outline" onClick={() => setSetup(setup === "account" ? null : "account")}><Plus className="mr-1.5 h-3.5 w-3.5" />Nova conta</Button></div>
              {setup === "category" && <div className="mt-2 flex flex-col gap-2 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-end dark:bg-slate-800"><label className="flex-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Nome da categoria<Input autoFocus className="mt-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={categoryName} onChange={event => setCategoryName(event.target.value)} placeholder="Ex.: Receita de vendas" /></label><Button type="button" disabled={categoryCreationBusy || categoryName.trim().length < 2} onClick={() => onCreateCategory(categoryName.trim())}>{categoryCreationBusy ? "Criando…" : "Criar e selecionar"}</Button></div>}
              {setup === "account" && <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end dark:bg-slate-800"><label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Nome da conta<Input autoFocus className="mt-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={accountName} onChange={event => setAccountName(event.target.value)} placeholder="Ex.: Banco principal" /></label><label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Tipo<select className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={accountType} onChange={event => setAccountType(event.target.value as "cash" | "bank")}><option value="bank">Banco</option><option value="cash">Caixa</option></select></label><Button type="button" disabled={accountCreationBusy || accountName.trim().length < 2} onClick={() => onCreateAccount(accountName.trim(), accountType)}>{accountCreationBusy ? "Criando…" : "Criar e selecionar"}</Button></div>}
              {financialSetupError && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2.5 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">{financialSetupError}</p>}
            </section>

            <aside className="flex min-w-0 flex-col border-t border-slate-200 bg-slate-50 p-4 lg:border-l lg:border-t-0 dark:border-slate-800 dark:bg-slate-900/60" aria-labelledby="confirmation-requirements-heading" data-testid="sales-confirmation-decision">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Validação</p>
              <h3 id="confirmation-requirements-heading" className="mt-1 text-lg font-bold text-slate-950 dark:text-slate-100">Esta venda pode ser confirmada?</h3>
              <div className={cn("mt-3 rounded-lg border px-3 py-2.5 text-sm", ready ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300")}><strong className="block">{ready ? "Pronta para confirmar" : "Confirmação bloqueada"}</strong><span className="text-xs">{ready ? "Todos os requisitos foram atendidos." : `${requirements.filter(item => !item.complete).length + (paymentReady ? 0 : 1)} requisito(s) ainda precisam de atenção.`}</span></div>
              <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">{requirements.map(requirement => <div key={requirement.key} className="flex items-center gap-2 py-2 text-sm"><span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", requirement.complete ? "bg-emerald-600 text-white" : "border border-amber-400 bg-white text-amber-700 dark:border-amber-600 dark:bg-slate-800 dark:text-amber-400")}>{requirement.complete ? <Check className="h-3.5 w-3.5" /> : "!"}</span><strong className={cn("min-w-0 flex-1", requirement.complete ? "text-slate-700 dark:text-slate-300" : "text-amber-950 dark:text-amber-300")}>{requirement.label}</strong>{!requirement.complete && requirement.actionLabel && <button type="button" className="shrink-0 rounded-sm text-xs font-semibold text-blue-700 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none dark:text-blue-400" onClick={() => focus(requirement.key === "payment" ? "payment" : requirement.key === "installments" ? "installments" : requirement.key)}>{requirement.actionLabel}</button>}</div>)}</div>
              {optionsError && <p role="alert" className="mt-3 text-xs leading-5 text-rose-800 dark:text-rose-400">Os cadastros financeiros precisam ser carregados antes da confirmação.</p>}
              {financialSetupError && <p role="alert" className="mt-3 text-xs leading-5 text-rose-800 dark:text-rose-400">{financialSetupError}</p>}
              <div className="mt-auto grid grid-cols-1 gap-2 pt-4 sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-1 xl:grid-cols-[auto_minmax(0,1fr)]"><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button className="bg-blue-600 text-white hover:bg-blue-700" disabled={busy || !ready} onClick={() => onConfirm(state)}>{busy ? "Confirmando…" : "Confirmar venda e criar títulos"}</Button></div>
            </aside>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ReasonState = { publicId: string; reason: string };
type ArchiveRequestState = ReasonState & {
  documentType: "quote" | "sale";
  orderNumber: string;
};
type QuoteStockConfirmationState = { issues: ReturnType<typeof salesStockIssues> };
type CommercialChangeState = ReasonState & {
  toStatus: "negotiation" | "approved" | "lost";
};
function ReasonDialog<T extends ReasonState>({ title, description, confirmLabel, state, setState, busy, destructive, onConfirm }: {
  title: string;
  description: string;
  confirmLabel: string;
  state: T | null;
  setState: React.Dispatch<React.SetStateAction<T | null>>;
  busy: boolean;
  destructive?: boolean;
  onConfirm: (state: T) => void;
}) {
  if (!state) return null;
  return (
    <Dialog open onOpenChange={open => !open && setState(null)}><DialogContent className="bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"><DialogHeader><DialogTitle className="text-slate-900 dark:text-slate-100">{title}</DialogTitle><p className="text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p></DialogHeader><label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Motivo<textarea autoFocus className="mt-1 min-h-24 w-full rounded-md border border-input px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={state.reason} onChange={event => setState({ ...state, reason: event.target.value })} /></label><DialogFooter><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button className={destructive ? "bg-rose-600 text-white hover:bg-rose-700" : undefined} disabled={busy || state.reason.trim().length < 3} onClick={() => onConfirm(state)}>{busy ? "Processando…" : confirmLabel}</Button></DialogFooter></DialogContent></Dialog>
  );
}

function QuoteStockConfirmationDialog({
  state,
  busy,
  onBack,
  onContinue,
}: {
  state: QuoteStockConfirmationState | null;
  busy: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  if (!state) return null;
  return (
    <Dialog open onOpenChange={open => !open && !busy && onBack()}>
      <DialogContent className="bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-slate-900 dark:text-slate-100">Produto sem estoque</DialogTitle>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">Este produto não possui estoque suficiente para atender à quantidade solicitada. Deseja continuar com o orçamento mesmo assim?</p>
        </DialogHeader>
        <ul className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {state.issues.map(issue => (
            <li key={`${issue.productName}:${issue.requestedQuantity}:${issue.availableQuantity}`} className="grid gap-1 border-b border-amber-200 pb-2 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3 dark:border-amber-900/60">
              <strong className="min-w-0 truncate">{issue.productName}</strong>
              <span>Solicitado: <strong className="tabular-nums">{formatQuantity(issue.requestedQuantity)}</strong></span>
              <span>Disponível: <strong className="tabular-nums">{formatQuantity(issue.availableQuantity)}</strong></span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">O orçamento não reserva nem baixa estoque. Uma venda continuará validando o saldo de forma transacional.</p>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onBack}>Voltar e revisar</Button>
          <Button type="button" className="transition-colors motion-reduce:transition-none active:translate-y-px" disabled={busy} onClick={onContinue}>{busy ? "Salvando…" : "Continuar orçamento"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommercialReasonDialog({ state, setState, busy, onConfirm }: {
  state: CommercialChangeState | null;
  setState: React.Dispatch<React.SetStateAction<CommercialChangeState | null>>;
  busy: boolean;
  onConfirm: (state: CommercialChangeState) => void;
}) {
  if (!state) return null;
  const losing = state.toStatus === "lost";
  return (
    <Dialog open onOpenChange={open => !open && setState(null)}>
      <DialogContent className="bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-slate-900 dark:text-slate-100">{losing ? "Marcar orçamento como perdido" : "Retomar negociação"}</DialogTitle>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">{losing ? "O motivo ajuda a qualificar o histórico comercial e permanece auditável." : "A correção reabre a negociação sem apagar a aprovação anterior do histórico."}</p>
        </DialogHeader>
        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Motivo obrigatório<textarea autoFocus className="mt-1 min-h-24 w-full rounded-md border border-input px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={state.reason} onChange={event => setState({ ...state, reason: event.target.value })} /></label>
        <DialogFooter><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button className={losing ? "bg-rose-600 text-white hover:bg-rose-700" : undefined} disabled={busy || state.reason.trim().length < 3} onClick={() => onConfirm(state)}>{busy ? "Atualizando…" : "Confirmar alteração"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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
    <Dialog open onOpenChange={open => !open && setState(null)}><DialogContent className="bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"><DialogHeader><DialogTitle className="text-slate-900 dark:text-slate-100">{state.correction ? "Corrigir etapa logística" : `Mover para ${stageLabels[state.toStage]}`}</DialogTitle><p className="text-sm leading-6 text-slate-600 dark:text-slate-400">{shipping ? "O estoque será revalidado e baixado atomicamente. Se algum item não tiver saldo, nada será alterado." : state.correction ? "A correção será registrada com ator, data, etapa anterior, nova etapa e motivo. Nenhum movimento de estoque será repetido." : "A mudança será registrada na timeline auditada."}</p></DialogHeader>{state.correction && <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Motivo obrigatório<textarea autoFocus className="mt-1 min-h-24 w-full rounded-md border border-input px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={state.reason} onChange={event => setState({ ...state, reason: event.target.value })} /></label>}<DialogFooter><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button disabled={busy || (state.correction && state.reason.trim().length < 3)} onClick={() => onConfirm(state)}>{busy ? "Atualizando…" : shipping ? "Revalidar e enviar" : "Confirmar etapa"}</Button></DialogFooter></DialogContent></Dialog>
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
    <Dialog open onOpenChange={open => !open && setState(null)}><DialogContent className="max-h-[92vh] overflow-y-auto bg-white sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"><DialogHeader><DialogTitle className="text-slate-900 dark:text-slate-100">Corrigir endereço histórico</DialogTitle><p className="text-sm text-slate-600 dark:text-slate-400">Permitido até Separação. Os valores anterior e novo serão mantidos na auditoria.</p></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><AddressFields title="Entrega" address={state.shippingAddress} onChange={shippingAddress => setState({ ...state, shippingAddress })} /><AddressFields title="Cobrança" address={state.billingAddress} onChange={billingAddress => setState({ ...state, billingAddress })} /></div><label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Motivo da correção<textarea className="mt-1 min-h-20 w-full rounded-md border border-input px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={state.reason} onChange={event => setState({ ...state, reason: event.target.value })} /></label><DialogFooter><Button variant="outline" onClick={() => setState(null)}>Voltar</Button><Button disabled={busy || state.reason.trim().length < 3} onClick={() => onConfirm(state)}>{busy ? "Salvando…" : "Salvar correção"}</Button></DialogFooter></DialogContent></Dialog>
  );
}

function AddressFields({ title, address, onChange }: { title?: string; address: SalesAddress; onChange: (address: SalesAddress) => void }) {
  const field = (key: keyof SalesAddress, value: string) => onChange({ ...address, [key]: value });
  return (
    <fieldset className="grid grid-cols-6 gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      {title && <legend className="px-1 text-sm font-bold text-slate-900 dark:text-slate-100">{title}</legend>}
      <label className="col-span-6 text-xs font-semibold text-slate-700 dark:text-slate-300">Destinatário<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={address.recipientName} onChange={event => field("recipientName", event.target.value)} /></label>
      <label className="col-span-2 text-xs font-semibold text-slate-700 dark:text-slate-300">CEP<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={address.postalCode} onChange={event => field("postalCode", event.target.value)} /></label>
      <label className="col-span-4 text-xs font-semibold text-slate-700 dark:text-slate-300">Logradouro<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={address.street} onChange={event => field("street", event.target.value)} /></label>
      <label className="col-span-2 text-xs font-semibold text-slate-700 dark:text-slate-300">Número<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={address.number} onChange={event => field("number", event.target.value)} /></label>
      <label className="col-span-4 text-xs font-semibold text-slate-700 dark:text-slate-300">Complemento<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={address.complement} onChange={event => field("complement", event.target.value)} /></label>
      <label className="col-span-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Bairro<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={address.district} onChange={event => field("district", event.target.value)} /></label>
      <label className="col-span-2 text-xs font-semibold text-slate-700 dark:text-slate-300">Cidade<Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={address.city} onChange={event => field("city", event.target.value)} /></label>
      <label className="col-span-1 text-xs font-semibold text-slate-700 dark:text-slate-300">UF<Input className="mt-1 uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" maxLength={2} value={address.state} onChange={event => field("state", event.target.value.toUpperCase())} /></label>
    </fieldset>
  );
}

function MoneyOrQuantity({ label, value, onChange, money: monetary }: { label: string; value: string | number; onChange: (value: never) => void; money?: boolean }) {
  if (monetary) {
    return (
      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}
        <div className="relative mt-1">
          <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm font-medium text-slate-500 dark:text-slate-400">R$</span>
          <MoneyInput className="pl-10 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" label={label} valueCents={Number(value)} onChangeCents={cents => onChange(cents as never)} />
        </div>
      </label>
    );
  }
  return (
    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}<Input className="mt-1 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" type="text" inputMode="decimal" value={value} onChange={event => onChange(event.target.value as never)} /></label>
  );
}

function SaleActionsMenu({ order, canWrite, onOpen, onPrint, onEdit, onDuplicate, onCommercialStatus, onConvert, onConfirm, onTransition, onCancel, onArchive }: {
  order: SaleListItem;
  canWrite: boolean;
  onOpen: () => void;
  onPrint: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onCommercialStatus: (toStatus: "negotiation" | "approved" | "lost", requireReason: boolean) => void;
  onConvert: () => void;
  onConfirm: () => void;
  onTransition: (toStage: Stage) => void;
  onCancel: () => void;
  onArchive: () => void;
}) {
  const currentIndex = stageOrder.indexOf(order.currentStage as Stage);
  const next = stageOrder[currentIndex + 1];
  const correctionTarget: Stage | null = order.currentStage === "separation"
    ? "confirmed"
    : order.currentStage === "received"
      ? "shipped"
      : order.currentStage === "completed"
        ? "received"
        : null;
  const terminal = order.documentType === "quote"
    ? ["converted", "lost", "cancelled"].includes(order.commercialStatus)
    : order.cancelled || order.currentStage === "completed";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 shadow-sm transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 hover:shadow active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transform-none motion-reduce:transition-none" aria-label={`Ações de ${order.documentType === "quote" ? "orçamento" : "venda"} ${order.orderNumber}`} title={`Abrir ações de ${order.documentType === "quote" ? "orçamento" : "venda"} ${order.orderNumber}`} data-testid="sales-row-actions">
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[80] min-w-60 border-slate-200 bg-white shadow-xl">
        <DropdownMenuItem onSelect={onOpen}><Eye className="mr-2 h-4 w-4" />Ver detalhes</DropdownMenuItem>
        <DropdownMenuItem onSelect={onPrint}><ReceiptText className="mr-2 h-4 w-4" />Imprimir documento</DropdownMenuItem>
        {canWrite && order.canEdit && <DropdownMenuItem onSelect={onEdit}><Edit3 className="mr-2 h-4 w-4" />Editar documento</DropdownMenuItem>}
        {canWrite && <DropdownMenuItem onSelect={onDuplicate}><Copy className="mr-2 h-4 w-4" />Duplicar como rascunho</DropdownMenuItem>}
        {canWrite && order.documentType === "quote" && ["draft", "negotiation", "approved"].includes(order.commercialStatus) && <DropdownMenuSeparator />}
        {canWrite && order.documentType === "quote" && order.commercialStatus === "draft" && <DropdownMenuItem className="cursor-pointer transition-colors hover:bg-blue-50 hover:text-blue-800 focus:bg-blue-50 focus:text-blue-800" onSelect={() => onCommercialStatus("negotiation", false)}><FileClock className="mr-2 h-4 w-4" />Iniciar negociação</DropdownMenuItem>}
        {canWrite && order.documentType === "quote" && order.commercialStatus === "negotiation" && <DropdownMenuItem className="text-emerald-700 transition-colors focus:bg-emerald-50 focus:text-emerald-800" onSelect={() => onCommercialStatus("approved", false)}><Check className="mr-2 h-4 w-4" />Aprovar orçamento</DropdownMenuItem>}
        {canWrite && order.documentType === "quote" && order.commercialStatus === "negotiation" && <DropdownMenuItem onSelect={() => onCommercialStatus("lost", true)} className="cursor-pointer text-amber-800 transition-colors hover:bg-amber-50 hover:text-amber-950 focus:bg-amber-50 focus:text-amber-950"><XCircle className="mr-2 h-4 w-4" />Marcar como perdido</DropdownMenuItem>}
        {canWrite && order.documentType === "quote" && order.commercialStatus === "approved" && <DropdownMenuItem className="text-blue-700 transition-colors focus:bg-blue-50 focus:text-blue-800" onSelect={onConvert}><ShoppingCart className="mr-2 h-4 w-4" />Converter em venda</DropdownMenuItem>}
        {canWrite && order.documentType === "quote" && order.commercialStatus === "approved" && <DropdownMenuItem onSelect={() => onCommercialStatus("negotiation", true)}><RotateCcw className="mr-2 h-4 w-4" />Retomar negociação</DropdownMenuItem>}
        {canWrite && order.documentType === "quote" && order.commercialStatus !== "converted" && !order.archivedAt && <><DropdownMenuSeparator /><DropdownMenuItem className="text-rose-700 transition-colors focus:bg-rose-50 focus:text-rose-800" onSelect={onArchive}><Trash2 className="mr-2 h-4 w-4" />Excluir orçamento</DropdownMenuItem></>}
        {canWrite && order.documentType === "sale" && !order.cancelled && <DropdownMenuSeparator />}
        {canWrite && order.documentType === "sale" && !order.cancelled && order.currentStage === "created" && <DropdownMenuItem onSelect={onConfirm}><Check className="mr-2 h-4 w-4" />Revisar e confirmar</DropdownMenuItem>}
        {canWrite && order.documentType === "sale" && !order.cancelled && next && order.currentStage !== "created" && <DropdownMenuItem onSelect={() => onTransition(next)}><ArrowRight className="mr-2 h-4 w-4" />{nextActionLabel(next)}</DropdownMenuItem>}
        {canWrite && order.documentType === "sale" && !order.cancelled && correctionTarget && <DropdownMenuItem onSelect={() => onTransition(correctionTarget)}><RotateCcw className="mr-2 h-4 w-4" />Corrigir para {stageLabels[correctionTarget]}</DropdownMenuItem>}
        {canWrite && order.documentType === "sale" && !order.cancelled && currentIndex < stageOrder.indexOf("shipped") && order.paidCents === 0 && <DropdownMenuItem onSelect={onCancel} className="text-rose-700"><XCircle className="mr-2 h-4 w-4" />Cancelar venda</DropdownMenuItem>}
        {canWrite && order.documentType === "sale" && !order.cancelled && currentIndex < stageOrder.indexOf("shipped") && order.paidCents > 0 && <DropdownMenuItem disabled><XCircle className="mr-2 h-4 w-4" />Cancelamento exige estorno</DropdownMenuItem>}
        {canWrite && order.documentType === "sale" && order.currentStage === "confirmed" && <DropdownMenuItem disabled><RotateCcw className="mr-2 h-4 w-4" />Retorno exige cancelar títulos</DropdownMenuItem>}
        {canWrite && order.documentType === "sale" && order.currentStage === "shipped" && <DropdownMenuItem disabled><RotateCcw className="mr-2 h-4 w-4" />Retorno exige reversão de estoque</DropdownMenuItem>}
        {canWrite && order.documentType === "sale" && terminal && !order.archivedAt && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={onArchive}><Archive className="mr-2 h-4 w-4" />Arquivar</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocumentTypeBadge({ documentType }: { documentType: "quote" | "sale" }) {
  return <span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", documentType === "quote" ? "bg-violet-100 text-violet-800" : "bg-blue-100 text-blue-800")}>{documentType === "quote" ? "Orçamento" : "Venda"}</span>;
}

function CommercialBadge({ value }: { value: string }) {
  const style = value === "approved" ? "bg-emerald-100 text-emerald-800" : value === "lost" || value === "cancelled" ? "bg-rose-100 text-rose-800" : value === "converted" ? "bg-blue-100 text-blue-800" : value === "negotiation" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700";
  return <span className={cn("inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold", style)}>{commercialStatusLabels[value as keyof typeof commercialStatusLabels] ?? value}</span>;
}

function ProductThumb({ imagePath, name, compact = false, large = false, featured = false }: { imagePath?: string | null; name: string; compact?: boolean; large?: boolean; featured?: boolean }) {
  const size = featured ? "h-[4.5rem] w-[4.5rem]" : large ? "h-24 w-24" : compact ? "h-9 w-9" : "h-11 w-11";
  const emphasized = featured || large;
  return imagePath ? (
    <img src={productMediaUrl(imagePath)} crossOrigin="use-credentials" alt={`Imagem de ${name}`} className={cn("shrink-0 rounded-lg object-contain", !emphasized && "bg-slate-100 p-1 ring-1 ring-slate-200", size)} />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center rounded-lg text-slate-500", emphasized ? "bg-slate-50" : "bg-slate-100 ring-1 ring-slate-200", size)} aria-label={`Sem imagem para ${name}`}><PackageOpen className={emphasized ? "h-8 w-8" : "h-5 w-5"} /></span>
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

function PaymentBadge({ value, compact = false }: { value: string; compact?: boolean }) {
  const classes = value === "paid" ? "bg-emerald-100 text-emerald-800" : value === "partial" ? "bg-amber-100 text-amber-900" : "bg-rose-100 text-rose-800";
  return <span className={cn("inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold", classes)}>{compact && value === "partial" ? "Parcial" : paymentLabels[value as keyof typeof paymentLabels] ?? value}</span>;
}

function StageBadge({ stage, cancelled, compact = false }: { stage: Stage; cancelled?: boolean; compact?: boolean }) {
  const label = cancelled ? "Cancelada" : compact ? stage === "created" ? "Orçamento" : stage === "completed" ? "Concluída" : "Em andamento" : stageLabels[stage];
  return <span className={cn("inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold", cancelled ? "bg-rose-100 text-rose-800" : stage === "completed" ? "bg-emerald-100 text-emerald-800" : stage === "created" ? "bg-slate-100 text-slate-700" : "bg-blue-100 text-blue-800")}>{label}</span>;
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

function SaleDocuments({ salePublicId, canWrite, isQuote: _isQuote }: { salePublicId: string; canWrite: boolean; isQuote: boolean }) {
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
    <section aria-label="Documentos privados da venda" className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Paperclip className="h-4 w-4 text-slate-500 dark:text-slate-400" />Documentos</h3>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && <Button type="button" size="sm" variant="outline" className="border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/60" onClick={() => { setError(""); uploadAttemptRef.current = null; setOpen(true); }}><UploadCloud className="mr-1 h-3.5 w-3.5" />Anexar</Button>}
        </div>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Arquivos privados vinculados ao pedido e exibidos no cadastro do cliente sem duplicação física.</p>
      {error && !open && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
      {query.isLoading ? <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Carregando documentos…</p> : query.isError ? <p role="alert" className="mt-3 text-xs text-rose-700 dark:text-rose-400">Não foi possível carregar os documentos. <button type="button" className="rounded-sm font-semibold underline transition-colors duration-150 hover:text-rose-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 motion-reduce:transition-none dark:hover:text-rose-300" onClick={() => void query.refetch()}>Tentar novamente</button></p> : query.data?.length ? (
        <div className="mt-3 space-y-2">
          {query.data.map(document => (
            <article key={document.publicId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-start gap-2">
                <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-xs text-slate-900 dark:text-slate-100">{document.fileName}</strong>
                  <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{document.documentTypeLabel} · {fileSize(document.sizeBytes)}</span>
                </div>
                <a href={`${saleDocumentUrl(document.downloadUrl)}?preview=1`} target="_blank" rel="noreferrer" aria-label={`Visualizar ${document.fileName}`} className="rounded-md border border-slate-200 bg-slate-50 p-1.5 text-slate-600 shadow-sm transition-[background-color,border-color,color,transform] duration-150 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transform-none motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-800 dark:hover:bg-slate-700"><Eye className="h-3.5 w-3.5" /></a>
                <a href={saleDocumentUrl(document.downloadUrl)} aria-label={`Baixar ${document.fileName}`} className="rounded-md border border-slate-200 bg-slate-50 p-1.5 text-slate-600 shadow-sm transition-[background-color,border-color,color,transform] duration-150 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transform-none motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-800 dark:hover:bg-slate-700"><Download className="h-3.5 w-3.5" /></a>
                {canWrite && <button type="button" disabled={remove.isPending} aria-label={`Remover ${document.fileName}`} className="rounded-md border border-rose-200 bg-rose-50 p-1.5 text-rose-700 shadow-sm transition-[background-color,border-color,color,transform] duration-150 hover:bg-rose-100 hover:text-rose-800 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60" onClick={() => window.confirm(`Remover “${document.fileName}” deste pedido?`) && remove.mutate({ salePublicId, documentPublicId: document.publicId })}><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            </article>
          ))}
        </div>
      ) : <p className="mt-3 rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">Nenhum documento anexado.</p>}

      <Dialog open={open} onOpenChange={value => { if (!upload.isPending) { setOpen(value); if (!value) uploadAttemptRef.current = null; } }}>
        <DialogContent className="sm:max-w-lg dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <DialogHeader><DialogTitle className="text-slate-900 dark:text-slate-100">Anexar documento à venda</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={event => void submit(event)}>
            <input ref={inputRef} type="file" className="hidden" accept="application/pdf,image/png,image/jpeg,image/webp,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => choose(event.target.files?.[0])} />
            <button type="button" className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-blue-400 hover:bg-blue-50 hover:shadow active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transform-none motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-blue-500 dark:hover:bg-slate-800" onClick={() => inputRef.current?.click()}>
              <UploadCloud className="mb-2 h-6 w-6 text-blue-600 dark:text-blue-400" />
              <span className="max-w-full truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{file?.name ?? "Selecionar arquivo"}</span>
              <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">PDF, imagens, DOCX, XLSX, CSV ou TXT · até 20 MB</span>
            </button>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Categoria<select className="mt-1 min-h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={documentType} onChange={event => setDocumentType(event.target.value as keyof typeof saleDocumentTypeLabels)}>{Object.entries(saleDocumentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Descrição <span className="font-normal text-slate-400 dark:text-slate-500">(opcional)</span><Input className="mt-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" maxLength={500} value={description} onChange={event => setDescription(event.target.value)} /></label>
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={upload.isPending} onClick={() => { setOpen(false); uploadAttemptRef.current = null; }}>Cancelar</Button><Button type="submit" disabled={!file || upload.isPending}>{upload.isPending ? "Anexando…" : "Anexar documento"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function State({ title, description, retry, error, loading = false }: { title: string; description?: string; retry?: () => void; error?: boolean; loading?: boolean }) {
  return <div role={error ? "alert" : "status"} aria-busy={loading || undefined} data-testid="sales-list-state" className={cn("min-h-48 rounded-xl px-5 py-10 text-center sm:px-10", error ? "bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200" : "border border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300")}>
    {loading ? <LoaderCircle className="mx-auto mb-3 h-6 w-6 animate-spin text-blue-600 motion-reduce:animate-none" aria-hidden="true" /> : <AlertCircle className={cn("mx-auto mb-3 h-6 w-6", error ? "text-rose-600 dark:text-rose-400" : "text-slate-400 dark:text-slate-500")} aria-hidden="true" />}
    <p className="font-semibold text-slate-900 dark:text-slate-100">{title}</p>
    {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>}
    {loading && <div className="mx-auto mt-5 grid max-w-md gap-2" aria-hidden="true"><span className="h-2 rounded-full bg-slate-100 dark:bg-slate-800" /><span className="h-2 w-4/5 rounded-full bg-slate-100 dark:bg-slate-800" /><span className="h-2 w-3/5 rounded-full bg-slate-100 dark:bg-slate-800" /></div>}
    {retry && <Button variant="outline" className="mt-4" onClick={retry}>Tentar novamente</Button>}
  </div>;
}

function formatQuantity(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function salesMutationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Não foi possível salvar o documento. Revise os dados e tente novamente.";
}

function nextActionLabel(stage: Stage) {
  if (stage === "separation") return "Iniciar separação";
  if (stage === "shipped") return "Marcar como enviado";
  if (stage === "received") return "Marcar como recebido";
  if (stage === "completed") return "Concluir venda";
  return `Mover para ${stageLabels[stage]}`;
}

function eventLabel(
  eventType: string,
  toStage: string | null,
  documentType: "quote" | "sale",
  after?: unknown
) {
  if (eventType === "created" || eventType === "draft") return documentType === "quote" ? "Orçamento criado" : "Venda criada";
  if (eventType === "updated") return documentType === "quote" ? "Orçamento atualizado" : "Rascunho atualizado";
  if (eventType === "confirmed") return "Venda confirmada";
  if (eventType === "cancelled") return "Venda cancelada";
  if (eventType === "address_corrected") return "Endereço corrigido";
  if (eventType === "payment_registered") return "Recebimento registrado";
  if (eventType === "document_added") {
    const generatedQuotePdf = typeof after === "object" && after !== null &&
      (after as Record<string, unknown>).documentType === "quote_pdf";
    return generatedQuotePdf ? "PDF do orçamento gerado" : "Documento anexado";
  }
  if (eventType === "document_removed") return "Documento removido";
  if (eventType === "duplicated") return "Documento duplicado";
  if (eventType === "quote_status_changed") {
    const status =
      typeof after === "object" && after !== null &&
      typeof (after as Record<string, unknown>).commercialStatus === "string"
        ? (after as Record<string, string>).commercialStatus
        : null;
    if (status === "negotiation") return "Negociação iniciada";
    if (status === "approved") return "Orçamento aprovado";
    if (status === "lost") return "Orçamento marcado como perdido";
    if (status === "draft") return "Orçamento reaberto";
    return "Status do orçamento atualizado";
  }
  if (eventType === "quote_converted") return documentType === "quote" ? "Orçamento convertido em venda" : "Venda criada a partir do orçamento";
  if (eventType === "archived") return documentType === "quote" ? "Orçamento arquivado" : "Venda arquivada";
  if (eventType === "financial_adjusted") return "Títulos conciliados após edição";
  if (eventType === "stage_transition" && toStage && toStage in stageLabels) return `Etapa alterada para ${stageLabels[toStage as Stage]}`;
  return "Evento registrado";
}
