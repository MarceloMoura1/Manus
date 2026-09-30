import React from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  FileText,
  PackageCheck,
  Plus,
  Search,
  ShoppingCart,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErpEmptyState } from "@/components/erp/ErpEmptyState";
import { Pagination } from "@/components/erp/Pagination";

type PurchaseWorkspacePageProps = {
  onNavigate?: (section: "finance" | "stock") => void;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const safeDate = (value?: string | null) =>
  value
    ? shortDate.format(new Date(`${value.slice(0, 10)}T12:00:00`))
    : "Sem prazo";
const formatMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : money.format(cents / 100);
const cents = (value: string) =>
  Math.max(0, Math.round(Number(value.replace(",", ".")) * 100) || 0);
const previewLineCents = (quantity: string, unitCostCents: number) => {
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(quantity)) return 0;
  const [whole, fraction = ""] = quantity.split(".");
  const quantityMillis = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
  return Number((quantityMillis * BigInt(unitCostCents) + 500n) / 1_000n);
};
const emptyRequestItems = () => [
  { productPublicId: "", description: "", quantity: "1.000", cost: "0" },
];
const emptyOrderItems = () => [
  { productPublicId: "", quantity: "1.000", cost: "0" },
];
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";

const orderLabels: Record<string, string> = {
  draft: "Rascunho",
  approved: "Confirmado",
  received: "Recebido",
  cancelled: "Cancelado",
};
const requestLabels: Record<string, string> = {
  draft: "Rascunho",
  pending_approval: "Aguardando aprovação",
  approved: "Aprovada",
  rejected: "Reprovada",
  cancelled: "Cancelada",
};

function Status({
  value,
  request = false,
}: {
  value: string;
  request?: boolean;
}) {
  const tone =
    value === "received" || value === "approved"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
      : value === "pending_approval"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
        : value === "cancelled" || value === "rejected"
          ? "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {(request ? requestLabels : orderLabels)[value] ?? value}
    </span>
  );
}

function MetricRail({ data, canViewValues }: { data?: any; canViewValues: boolean }) {
  const values = [
    [
      "Aprovações",
      data?.pendingApprovals ?? 0,
      "Solicitações que precisam de decisão",
    ],
    ["A receber", data?.awaitingReceipt ?? 0, "Pedidos confirmados com saldo"],
    ["Em atraso", data?.overdueOrders ?? 0, "Prazo de entrega vencido"],
    ...(canViewValues
      ? [
          [
            "Comprado no mês",
            formatMoney(data?.purchasedMonthCents ?? 0),
            "Pedidos não cancelados",
          ],
          [
            "Contas a pagar",
            formatMoney(data?.payablePendingCents ?? 0),
            "Saldo financeiro em aberto",
          ],
        ]
      : []),
  ];
  return (
    <section
      aria-label="Resumo de compras"
      className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-[0_14px_36px_-24px_rgba(15,23,42,0.8)] dark:bg-slate-900"
    >
      <div className="grid divide-y divide-white/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
        {values.map(([label, value, hint]) => (
          <div key={String(label)} className="min-w-0 px-4 py-4 xl:px-5">
            <p className="text-xs font-medium text-slate-300">{label}</p>
            <p className="mt-1 truncate text-xl font-bold tabular-nums tracking-[-0.02em]">
              {value}
            </p>
            <p className="mt-1 truncate text-[11px] text-slate-400">{hint}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function QueryState({
  loading,
  error,
  empty,
  retry,
  children,
}: {
  loading: boolean;
  error?: unknown;
  empty: boolean;
  retry: () => void;
  children: React.ReactNode;
}) {
  if (loading)
    return (
      <div
        aria-busy="true"
        className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950"
      >
        {[1, 2, 3].map(item => (
          <div
            key={item}
            className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900"
          />
        ))}
      </div>
    );
  if (error)
    return (
      <ErpEmptyState
        title="Não foi possível carregar Compras"
        description="A conexão falhou. Tente novamente sem perder seus filtros."
        action={{ label: "Tentar novamente", onClick: retry }}
      />
    );
  if (empty)
    return (
      <ErpEmptyState
        title="Nenhum registro por aqui"
        description="Ajuste os filtros ou inicie um novo fluxo de compra."
      />
    );
  return <>{children}</>;
}

export function PurchasesWorkspacePage({
  onNavigate,
}: PurchaseWorkspacePageProps) {
  const utils = trpc.useUtils();
  const [section, setSection] = React.useState<"orders" | "requests">("orders");
  const [search, setSearch] = React.useState("");
  const [orderView, setOrderView] = React.useState<
    | "all"
    | "open"
    | "awaiting_receipt"
    | "partial"
    | "received"
    | "overdue"
    | "cancelled"
  >("all");
  const [requestStatus, setRequestStatus] = React.useState<
    "all" | "draft" | "pending_approval" | "approved" | "rejected" | "cancelled"
  >("all");
  const [page, setPage] = React.useState(1);
  const [requestPage, setRequestPage] = React.useState(1);
  const [orderId, setOrderId] = React.useState<string | null>(null);
  const [requestId, setRequestId] = React.useState<string | null>(null);
  const [requestForm, setRequestForm] = React.useState(false);
  const [orderForm, setOrderForm] = React.useState(false);
  const [notice, setNotice] = React.useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const summary = trpc.erp.purchases.summary.useQuery();
  const capabilities = trpc.erp.purchases.capabilities.useQuery();
  const orders = trpc.erp.purchases.list.useQuery({
    search,
    view: orderView === "all" ? undefined : orderView,
    sort: "createdAt",
    direction: "desc",
    page,
    pageSize: 20,
  });
  const requests = trpc.erp.purchases.requests.list.useQuery({
    search,
    status: requestStatus === "all" ? undefined : requestStatus,
    page: requestPage,
    pageSize: 20,
  });
  const refresh = async (message?: string) => {
    if (message) setNotice({ tone: "success", text: message });
    await utils.erp.purchases.invalidate();
  };

  const orderFilters = [
    ["all", "Todos"],
    ["open", "Em aberto"],
    ["awaiting_receipt", "Aguardando recebimento"],
    ["partial", "Parciais"],
    ["received", "Recebidos"],
    ["overdue", "Atrasados"],
    ["cancelled", "Cancelados"],
  ] as const;
  const requestFilters = [
    ["all", "Todas"],
    ["draft", "Rascunhos"],
    ["pending_approval", "Em aprovação"],
    ["approved", "Aprovadas"],
    ["rejected", "Reprovadas"],
    ["cancelled", "Canceladas"],
  ] as const;

  return (
    <div
      className="min-w-0 space-y-5 selection:bg-blue-200 selection:text-slate-950 dark:selection:bg-blue-700"
      data-testid="erp-purchases-page"
    >
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white sm:text-3xl">
            Compras
          </h1>
          <p className="mt-1.5 max-w-[70ch] text-sm leading-6 text-slate-600 dark:text-slate-300">
            Solicite, aprove, compre, receba e acompanhe o pagamento sem perder
            o vínculo entre cada etapa.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {capabilities.data?.canCreateOrder && (
            <Button variant="outline" onClick={() => setOrderForm(true)}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Pedido direto
            </Button>
          )}
          {capabilities.data?.canCreateRequest && (
            <Button onClick={() => setRequestForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nova solicitação
            </Button>
          )}
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium ${notice.tone === "success" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100" : "bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-100"}`}
        >
          <span>{notice.text}</span>
          <button
            className="rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            onClick={() => setNotice(null)}
            aria-label="Fechar aviso"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}
      <MetricRail
        data={summary.data}
        canViewValues={capabilities.data?.canViewValues === true}
      />

      <Tabs
        value={section}
        onValueChange={value => {
          setSection(value as typeof section);
          setSearch("");
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="h-10">
            <TabsTrigger value="orders">
              <ShoppingCart className="mr-2 h-4 w-4" />
              Pedidos
            </TabsTrigger>
            <TabsTrigger value="requests">
              <ClipboardList className="mr-2 h-4 w-4" />
              Solicitações
            </TabsTrigger>
          </TabsList>
          <label className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                setPage(1);
                setRequestPage(1);
              }}
              placeholder={
                section === "orders"
                  ? "Buscar pedido ou fornecedor"
                  : "Buscar número, motivo ou solicitante"
              }
              className="pl-9"
            />
          </label>
        </div>

        <TabsContent value="orders" className="mt-4 space-y-4">
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            aria-label="Filtros de pedidos"
          >
            {orderFilters.map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setOrderView(value);
                  setPage(1);
                }}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${orderView === value ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <QueryState
            loading={orders.isLoading}
            error={orders.error}
            empty={!orders.data?.items.length}
            retry={() => void orders.refetch()}
          >
            <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 lg:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Pedido</th>
                    <th className="px-4 py-3">Fornecedor</th>
                    <th className="px-4 py-3">Entrega</th>
                    <th className="px-4 py-3">Recebimento</th>
                    {capabilities.data?.canViewValues && (
                      <>
                        <th className="px-4 py-3">Financeiro</th>
                        <th className="px-4 py-3 text-right">Total</th>
                      </>
                    )}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                  {orders.data?.items.map((order: any) => (
                    <tr
                      key={order.publicId}
                      onClick={() => setOrderId(order.publicId)}
                      className="cursor-pointer transition-colors hover:bg-blue-50/60 focus-within:bg-blue-50/60 dark:hover:bg-blue-950/20"
                    >
                      <td className="px-4 py-3.5">
                        <button className="text-left font-semibold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-white">
                          {order.orderNumber}
                        </button>
                        <div className="mt-1">
                          <Status value={order.status} />
                        </div>
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-3.5 font-medium text-slate-700 dark:text-slate-200">
                        {order.supplierName}
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-slate-300">
                        {safeDate(order.expectedDate)}
                        {order.overdue && (
                          <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Em atraso
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <Progress
                          value={order.receiptProgress}
                          className="h-1.5 w-24"
                        />
                        <span className="mt-1 block text-xs tabular-nums text-slate-500">
                          {order.receiptProgress}%
                        </span>
                      </td>
                      {capabilities.data?.canViewValues && (
                        <>
                          <td className="px-4 py-3.5">
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                              {order.financialStatus === "paid"
                                ? "Pago"
                                : order.financialStatus === "partially_paid"
                                  ? "Parcial"
                                  : order.financialStatus === "overdue"
                                    ? "Vencido"
                                    : order.financialStatus === "not_launched"
                                      ? "Não lançado"
                                      : "Em aberto"}
                            </span>
                            <span className="block text-xs tabular-nums text-slate-500">
                              {formatMoney(order.paidCents)} pagos
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right font-bold tabular-nums text-slate-950 dark:text-white">
                            {formatMoney(order.totalCents)}
                          </td>
                        </>
                      )}
                      <td className="pr-3">
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 lg:hidden">
              {orders.data?.items.map((order: any) => (
                <button
                  key={order.publicId}
                  onClick={() => setOrderId(order.publicId)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-[0_8px_24px_-22px_rgba(15,23,42,0.7)] transition hover:border-blue-300 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong className="text-slate-950 dark:text-white">
                        {order.orderNumber}
                      </strong>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {order.supplierName}
                      </p>
                    </div>
                    <Status value={order.status} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-500">
                    <span>
                      Entrega
                      <strong className="mt-0.5 block text-sm text-slate-800 dark:text-slate-200">
                        {safeDate(order.expectedDate)}
                      </strong>
                    </span>
                    {capabilities.data?.canViewValues && (
                      <span className="text-right">
                        Total
                        <strong className="mt-0.5 block text-sm tabular-nums text-slate-950 dark:text-white">
                          {formatMoney(order.totalCents)}
                        </strong>
                      </span>
                    )}
                  </div>
                  <Progress
                    value={order.receiptProgress}
                    className="mt-4 h-1.5"
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    {order.receiptProgress}% recebido
                  </span>
                </button>
              ))}
            </div>
            {orders.data && orders.data.totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={orders.data.totalPages}
                onPage={setPage}
              />
            )}
          </QueryState>
        </TabsContent>

        <TabsContent value="requests" className="mt-4 space-y-4">
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            aria-label="Filtros de solicitações"
          >
            {requestFilters.map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setRequestStatus(value);
                  setRequestPage(1);
                }}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${requestStatus === value ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <QueryState
            loading={requests.isLoading}
            error={requests.error}
            empty={!requests.data?.items.length}
            retry={() => void requests.refetch()}
          >
            <div className="grid gap-2">
              {requests.data?.items.map((request: any) => (
                <button
                  key={request.publicId}
                  onClick={() => setRequestId(request.publicId)}
                  className="group flex w-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-blue-950/20 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-slate-950 dark:text-white">
                        {request.requestNumber}
                      </strong>
                      <Status value={request.status} request />
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                        {request.priority === "urgent"
                          ? "Urgente"
                          : request.priority === "high"
                            ? "Alta"
                            : request.priority === "low"
                              ? "Baixa"
                              : "Normal"}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-sm text-slate-700 dark:text-slate-200">
                      {request.reason}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Solicitada por {request.requesterName}
                      {request.department ? ` · ${request.department}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <span className="text-xs text-slate-500">
                      {safeDate(request.createdAt)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </button>
              ))}
            </div>
            {requests.data && requests.data.totalPages > 1 && (
              <Pagination
                page={requestPage}
                totalPages={requests.data.totalPages}
                onPage={setRequestPage}
              />
            )}
          </QueryState>
        </TabsContent>
      </Tabs>

      <RequestForm
        open={requestForm}
        close={() => setRequestForm(false)}
        done={async () => {
          setRequestForm(false);
          setSection("requests");
          await refresh("Solicitação criada como rascunho.");
        }}
        fail={text => setNotice({ tone: "error", text })}
      />
      <DirectOrderForm
        open={orderForm}
        close={() => setOrderForm(false)}
        done={async () => {
          setOrderForm(false);
          setSection("orders");
          await refresh("Pedido criado como rascunho.");
        }}
        fail={text => setNotice({ tone: "error", text })}
      />
      <OrderDetail
        publicId={orderId}
        close={() => setOrderId(null)}
        done={refresh}
        fail={text => setNotice({ tone: "error", text })}
        onNavigate={onNavigate}
      />
      <RequestDetail
        publicId={requestId}
        close={() => setRequestId(null)}
        done={refresh}
        fail={text => setNotice({ tone: "error", text })}
      />
    </div>
  );
}

function RequestForm({
  open,
  close,
  done,
  fail,
}: {
  open: boolean;
  close: () => void;
  done: () => void;
  fail: (text: string) => void;
}) {
  const products = trpc.erp.products.list.useQuery(
    {
      search: "",
      active: true,
      stock: "all",
      sort: "name",
      direction: "asc",
      page: 1,
      pageSize: 100,
    },
    { enabled: open }
  );
  const [reason, setReason] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [priority, setPriority] = React.useState<
    "low" | "normal" | "high" | "urgent"
  >("normal");
  const [items, setItems] = React.useState(emptyRequestItems);
  React.useEffect(() => {
    if (!open) return;
    setReason("");
    setDepartment("");
    setPriority("normal");
    setItems(emptyRequestItems());
  }, [open]);
  const create = trpc.erp.purchases.requests.create.useMutation({
    onSuccess: done,
    onError: error => fail(errorText(error)),
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate({
      reason,
      department: department || null,
      priority,
      items: items.map(item => ({
        productPublicId: item.productPublicId || null,
        description: item.description || null,
        quantity: item.quantity,
        estimatedUnitCostCents: cents(item.cost),
      })),
    });
  };
  return (
    <Dialog open={open} onOpenChange={value => !value && close()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova solicitação de compra</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Área solicitante">
              <Input
                value={department}
                onChange={event => setDepartment(event.target.value)}
                placeholder="Ex.: Operações"
              />
            </Field>
            <Field label="Prioridade">
              <select
                value={priority}
                onChange={event =>
                  setPriority(event.target.value as typeof priority)
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="low">Baixa</option>
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </Field>
          </div>
          <Field label="Motivo da compra">
            <Textarea
              required
              minLength={3}
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="Explique a necessidade e o resultado esperado"
            />
          </Field>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Itens solicitados</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setItems(current => [
                    ...current,
                    {
                      productPublicId: "",
                      description: "",
                      quantity: "1.000",
                      cost: "0",
                    },
                  ])
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Item
              </Button>
            </div>
            {items.map((item, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900 sm:grid-cols-[1fr_7rem_8rem_auto]"
              >
                <select
                  aria-label={`Produto ${index + 1}`}
                  value={item.productPublicId}
                  onChange={event =>
                    setItems(current =>
                      current.map((row, rowIndex) =>
                        rowIndex === index
                          ? {
                              ...row,
                              productPublicId: event.target.value,
                              description: "",
                            }
                          : row
                      )
                    )
                  }
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Item não catalogado</option>
                  {products.data?.items.map(product => (
                    <option key={product.publicId} value={product.publicId}>
                      {product.name} · {product.sku}
                    </option>
                  ))}
                </select>
                {!item.productPublicId && (
                  <Input
                    aria-label={`Descrição ${index + 1}`}
                    className="sm:col-span-3"
                    required
                    value={item.description}
                    onChange={event =>
                      setItems(current =>
                        current.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, description: event.target.value }
                            : row
                        )
                      )
                    }
                    placeholder="Descrição do item"
                  />
                )}{" "}
                <Input
                      aria-label={`Quantidade ${index + 1}`}
                      required
                      value={item.quantity}
                      onChange={event =>
                        setItems(current =>
                          current.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, quantity: event.target.value }
                              : row
                          )
                        )
                      }
                />
                <Input
                      aria-label={`Custo estimado ${index + 1}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.cost}
                      onChange={event =>
                        setItems(current =>
                          current.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, cost: event.target.value }
                              : row
                          )
                        )
                      }
                />
                <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={items.length === 1}
                      onClick={() =>
                        setItems(current =>
                          current.filter((_, rowIndex) => rowIndex !== index)
                        )
                      }
                      aria-label="Remover item"
                    >
                      <XCircle className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button disabled={create.isPending}>
              {create.isPending ? "Salvando…" : "Salvar rascunho"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DirectOrderForm({
  open,
  close,
  done,
  fail,
}: {
  open: boolean;
  close: () => void;
  done: () => void;
  fail: (text: string) => void;
}) {
  const suppliers = trpc.erp.suppliers.list.useQuery(
    {
      search: "",
      active: true,
      sort: "legalName",
      direction: "asc",
      page: 1,
      pageSize: 100,
    },
    { enabled: open }
  );
  const products = trpc.erp.products.list.useQuery(
    {
      search: "",
      active: true,
      stock: "all",
      sort: "name",
      direction: "asc",
      page: 1,
      pageSize: 100,
    },
    { enabled: open }
  );
  const [supplier, setSupplier] = React.useState("");
  const [expectedDate, setExpectedDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [freight, setFreight] = React.useState("0");
  const [items, setItems] = React.useState(emptyOrderItems);
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => crypto.randomUUID());
  React.useEffect(() => {
    if (!open) return;
    setSupplier("");
    setExpectedDate("");
    setNotes("");
    setFreight("0");
    setItems(emptyOrderItems());
    setIdempotencyKey(crypto.randomUUID());
  }, [open]);
  const create = trpc.erp.purchases.create.useMutation({
    onSuccess: done,
    onError: error => fail(errorText(error)),
  });
  const total =
    items.reduce(
      (sum, item) => sum + previewLineCents(item.quantity, cents(item.cost)),
      0
    ) + cents(freight);
  return (
    <Dialog open={open} onOpenChange={value => !value && close()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Novo pedido direto</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={event => {
            event.preventDefault();
            create.mutate({
              supplierPublicId: supplier,
              expectedDate: expectedDate || null,
              notes: notes || null,
              freightCents: cents(freight),
              discountCents: 0,
              otherExpensesCents: 0,
              paymentTerms: null,
              installments: [],
               idempotencyKey,
              items: items.map(item => ({
                productPublicId: item.productPublicId,
                quantity: item.quantity,
                unitCostCents: cents(item.cost),
                discountCents: 0,
              })),
            });
          }}
          className="space-y-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fornecedor">
              <select
                required
                value={supplier}
                onChange={event => setSupplier(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione</option>
                {suppliers.data?.items.map(item => (
                  <option key={item.publicId} value={item.publicId}>
                    {item.legalName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Previsão de entrega">
              <Input
                type="date"
                value={expectedDate}
                onChange={event => setExpectedDate(event.target.value)}
              />
            </Field>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Produtos</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setItems(current => [
                    ...current,
                    { productPublicId: "", quantity: "1.000", cost: "0" },
                  ])
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Produto
              </Button>
            </div>
            {items.map((item, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900 sm:grid-cols-[1fr_7rem_9rem_auto]"
              >
                <select
                  required
                  value={item.productPublicId}
                  onChange={event =>
                    setItems(current =>
                      current.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, productPublicId: event.target.value }
                          : row
                      )
                    )
                  }
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione o produto</option>
                  {products.data?.items.map(product => (
                    <option key={product.publicId} value={product.publicId}>
                      {product.name} · {product.sku}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Quantidade"
                  required
                  value={item.quantity}
                  onChange={event =>
                    setItems(current =>
                      current.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, quantity: event.target.value }
                          : row
                      )
                    )
                  }
                />
                <Input
                  aria-label="Custo unitário"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={item.cost}
                  onChange={event =>
                    setItems(current =>
                      current.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, cost: event.target.value }
                          : row
                      )
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={items.length === 1}
                  onClick={() =>
                    setItems(current =>
                      current.filter((_, rowIndex) => rowIndex !== index)
                    )
                  }
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <Field label="Observações">
              <Textarea
                value={notes}
                onChange={event => setNotes(event.target.value)}
              />
            </Field>
            <Field label="Frete">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={freight}
                onChange={event => setFreight(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-950 px-4 py-3 text-white">
            <span className="text-sm text-slate-300">Total previsto</span>
            <strong className="tabular-nums">{formatMoney(total)}</strong>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button disabled={create.isPending}>
              {create.isPending ? "Criando…" : "Criar pedido"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrderDetail({
  publicId,
  close,
  done,
  fail,
  onNavigate,
}: {
  publicId: string | null;
  close: () => void;
  done: (message?: string) => Promise<void>;
  fail: (text: string) => void;
  onNavigate?: (section: "finance" | "stock") => void;
}) {
  const query = trpc.erp.purchases.detail.useQuery(
    { publicId: publicId! },
    { enabled: Boolean(publicId) }
  );
  const order = query.data as any;
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const approve = trpc.erp.purchases.approve.useMutation({
    onSuccess: async () =>
      done("Pedido confirmado e parcelas lançadas no Contas a Pagar."),
    onError: error => fail(errorText(error)),
  });
  const cancel = trpc.erp.purchases.cancel.useMutation({
    onSuccess: async () => {
      close();
      await done("Pedido cancelado.");
    },
    onError: error => fail(errorText(error)),
  });
  if (!publicId) return null;
  return (
    <Dialog open onOpenChange={value => !value && close()}>
      <DialogContent className="flex max-h-[94vh] flex-col overflow-hidden p-0 sm:max-w-5xl">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3 pr-7">
              <div>
                <DialogTitle>
                  {order?.orderNumber ?? "Carregando pedido…"}
                </DialogTitle>
                <p className="mt-1 text-sm text-slate-500">
                  {order?.supplierName}
                </p>
              </div>
              {order && <Status value={order.status} />}
            </div>
          </DialogHeader>
        </div>
        {query.isLoading ? (
          <div className="p-8 text-sm text-slate-500">Carregando detalhes…</div>
        ) : query.error || !order ? (
          <div className="p-8">
            <ErpEmptyState
              title="Pedido indisponível"
              action={{
                label: "Tentar novamente",
                onClick: () => void query.refetch(),
              }}
            />
          </div>
        ) : (
          <Tabs
            defaultValue="overview"
            className="min-h-0 flex-1 overflow-hidden"
          >
            <div className="overflow-x-auto border-b border-slate-200 px-5 dark:border-slate-800">
              <TabsList className="h-11 bg-transparent p-0">
                <TabsTrigger value="overview">Visão geral</TabsTrigger>
                <TabsTrigger value="items">Produtos</TabsTrigger>
                <TabsTrigger value="receipts">Recebimentos</TabsTrigger>
                {order.capabilities?.canViewValues && (
                  <TabsTrigger value="payments">Financeiro</TabsTrigger>
                )}
                <TabsTrigger value="history">Histórico</TabsTrigger>
                <TabsTrigger value="documents">Documentos</TabsTrigger>
              </TabsList>
            </div>
            <div className="max-h-[65vh] overflow-y-auto p-5">
              <TabsContent value="overview" className="mt-0 space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  {order.capabilities?.canViewValues && (
                    <Info
                      label="Valor total"
                      value={formatMoney(order.totalCents)}
                    />
                  )}
                  <Info label="Previsão" value={safeDate(order.expectedDate)} />
                  <Info
                    label="Responsável"
                    value={
                      order.responsibleName ||
                      order.createdByName ||
                      "Não atribuído"
                    }
                  />
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span>Recebimento</span>
                    <strong className="tabular-nums">
                      {order.receiptProgress}%
                    </strong>
                  </div>
                  <Progress value={order.receiptProgress} />
                </div>
                {order.notes && (
                  <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    {order.notes}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="items" className="mt-0 space-y-2">
                {order.items.map((item: any) => (
                  <div
                    key={item.publicId}
                    className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-[1fr_auto_auto]"
                  >
                    <div>
                      <strong>{item.productName}</strong>
                      <p className="text-xs text-slate-500">SKU {item.sku}</p>
                    </div>
                    <div className="text-sm tabular-nums">
                      <span className="text-slate-500">Recebido</span>
                      <strong className="ml-2">
                        {item.receivedQuantity} / {item.quantity}
                      </strong>
                    </div>
                    {order.capabilities?.canViewValues && (
                      <strong className="text-right tabular-nums">
                        {formatMoney(item.lineTotalCents)}
                      </strong>
                    )}
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="receipts" className="mt-0">
                {order.receipts.length ? (
                  <div className="space-y-3">
                    {order.receipts.map((receipt: any) => (
                      <div
                        key={receipt.publicId}
                        className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                      >
                        <div className="flex justify-between gap-3">
                          <strong>Recebimento {receipt.receiptNumber}</strong>
                          <span className="text-xs text-slate-500">
                            {safeDate(receipt.receivedAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {receipt.receivedByName}
                          {receipt.documentNumber
                            ? ` · Documento ${receipt.documentNumber}`
                            : ""}
                        </p>
                        <ul className="mt-3 space-y-1 text-sm">
                          {receipt.items.map((item: any) => (
                            <li key={item.orderItemPublicId}>
                              {item.productName} ·{" "}
                              <span className="tabular-nums">
                                {item.quantity}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ErpEmptyState
                    title="Nenhum recebimento registrado"
                    description="O estoque só será movimentado quando uma entrega for confirmada."
                  />
                )}
              </TabsContent>
              {order.capabilities?.canViewValues && (
              <TabsContent value="payments" className="mt-0">
                {order.payments.length ? (
                  <div className="space-y-2">
                    {order.payments.map((payment: any) => (
                      <div
                        key={payment.publicId}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                      >
                        <div>
                          <strong>Parcela {payment.installmentNumber}</strong>
                          <p className="text-xs text-slate-500">
                            Vence em {safeDate(payment.dueDate)} ·{" "}
                            {payment.status === "paid"
                              ? "Paga"
                              : payment.status === "partially_paid"
                                ? "Pagamento parcial"
                                : payment.status === "overdue"
                                  ? "Vencida"
                                  : "Em aberto"}
                          </p>
                        </div>
                        <div className="text-right">
                          <strong className="tabular-nums">
                            {formatMoney(payment.amountCents)}
                          </strong>
                          <p className="text-xs tabular-nums text-slate-500">
                            {formatMoney(payment.paidCents)} pagos
                          </p>
                        </div>
                      </div>
                    ))}
                    {onNavigate && (
                      <Button
                        variant="outline"
                        onClick={() => onNavigate("finance")}
                      >
                        <CircleDollarSign className="mr-2 h-4 w-4" />
                        Abrir Financeiro
                      </Button>
                    )}
                  </div>
                ) : (
                  <ErpEmptyState
                    title="Ainda sem lançamento financeiro"
                    description="As parcelas são criadas ao confirmar o pedido."
                  />
                )}
              </TabsContent>
              )}
              <TabsContent value="history" className="mt-0">
                <ol className="relative ml-2 space-y-5 border-l border-slate-200 pl-5 dark:border-slate-800">
                  {order.timeline.map((event: any) => (
                    <li key={event.publicId}>
                      <span
                        className={`absolute -left-1.5 mt-1 h-3 w-3 rounded-full ring-4 ring-white dark:ring-slate-950 ${event.actorType === "system" ? "bg-violet-500" : "bg-blue-600"}`}
                      />
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <strong className="text-sm">{event.summary}</strong>
                        <span className="text-xs text-slate-500">
                          {safeDate(event.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {event.actorType === "system"
                          ? "Sistema"
                          : event.actorName}
                      </p>
                    </li>
                  ))}
                </ol>
              </TabsContent>
              <TabsContent value="documents" className="mt-0">
                {order.documents.length ? (
                  <div className="space-y-2">
                    {order.documents.map((document: any) => (
                      <div
                        key={document.publicId}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                      >
                        <FileText className="h-5 w-5 text-blue-600" />
                        <div className="min-w-0">
                          <strong className="block truncate text-sm">
                            {document.fileName}
                          </strong>
                          <span className="text-xs text-slate-500">
                            {document.documentType} · {document.mimeType}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ErpEmptyState
                    title="Nenhum documento vinculado"
                    description="Anexe o arquivo ao fornecedor e vincule-o a este pedido."
                  />
                )}
              </TabsContent>
            </div>
          </Tabs>
        )}
        <DialogFooter className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          {order?.status === "draft" && order.capabilities?.canApprove && (
            <Button
              onClick={() => approve.mutate({ publicId })}
              disabled={approve.isPending}
            >
              <Check className="mr-2 h-4 w-4" />
              Confirmar pedido
            </Button>
          )}
          {order?.status === "approved" && order.capabilities?.canReceive && (
            <Button onClick={() => setReceiveOpen(true)}>
              <ArrowDownToLine className="mr-2 h-4 w-4" />
              Registrar recebimento
            </Button>
          )}
          {["draft", "approved"].includes(order?.status) &&
            order.capabilities?.canCancel && (
              <Button
                variant="outline"
                onClick={() => {
                  const reason = prompt("Motivo do cancelamento");
                  if (reason && confirm("Cancelar este pedido?"))
                    cancel.mutate({ publicId, reason });
                }}
              >
                Cancelar
              </Button>
            )}
          <Button variant="ghost" onClick={close}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
      <ReceiveDialog
        open={receiveOpen}
        close={() => setReceiveOpen(false)}
        order={order}
        done={async () => {
          setReceiveOpen(false);
          await query.refetch();
          await done("Recebimento registrado e estoque atualizado.");
        }}
        fail={fail}
      />
    </Dialog>
  );
}

function ReceiveDialog({
  open,
  close,
  order,
  done,
  fail,
}: {
  open: boolean;
  close: () => void;
  order: any;
  done: () => void;
  fail: (text: string) => void;
}) {
  const utils = trpc.useUtils();
  const [documentNumber, setDocumentNumber] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [quantities, setQuantities] = React.useState<Record<string, string>>(
    {}
  );
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => crypto.randomUUID());
  React.useEffect(() => {
    if (!open || !order) return;
    setDocumentNumber("");
    setNotes("");
    setIdempotencyKey(crypto.randomUUID());
    setQuantities(
      Object.fromEntries(
        order.items
          .filter((item: any) => Number(item.pendingQuantity) > 0)
          .map((item: any) => [item.publicId, item.pendingQuantity])
      )
    );
  }, [open, order]);
  const receive = trpc.erp.purchases.receive.useMutation({
    onSuccess: done,
    onError: error => fail(errorText(error)),
  });
  const closeBalance = trpc.erp.purchases.closeBalance.useMutation({
    onSuccess: async () => {
      close();
      await utils.erp.purchases.invalidate();
    },
    onError: error => fail(errorText(error)),
  });
  const canCloseBalance =
    order?.status === "approved" &&
    order?.receiptProgress > 0 &&
    order?.receiptProgress < 100 &&
    order?.capabilities?.canApprove;

  return (
    <Dialog open={open} onOpenChange={value => !value && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Registrar recebimento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Documento de entrada">
              <Input
                value={documentNumber}
                onChange={event => setDocumentNumber(event.target.value)}
                placeholder="Nota fiscal, remessa…"
              />
            </Field>
            <Field label="Observação">
              <Input
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Condição da entrega"
              />
            </Field>
          </div>
          <div className="space-y-2">
            {order?.items
              .filter((item: any) => Number(item.pendingQuantity) > 0)
              .map((item: any) => (
                <label
                  key={item.publicId}
                  className="grid grid-cols-[1fr_8rem] items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900"
                >
                  <span className="text-sm">
                    <strong className="block">{item.productName}</strong>
                    <span className="text-xs text-slate-500">
                      Saldo {item.pendingQuantity}
                    </span>
                  </span>
                  <Input
                    aria-label={`Quantidade recebida de ${item.productName}`}
                    value={quantities[item.publicId] ?? ""}
                    onChange={event =>
                      setQuantities(current => ({
                        ...current,
                        [item.publicId]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
          </div>
          {canCloseBalance && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Se o fornecedor não entregar o restante, encerre o saldo. O
              estoque recebido e os pagamentos já registrados serão preservados.
            </p>
          )}
        </div>
        <DialogFooter className="flex-wrap">
          {canCloseBalance && (
            <Button
              type="button"
              variant="outline"
              disabled={closeBalance.isPending}
              onClick={() => {
                const reason = prompt("Motivo para encerrar o saldo pendente");
                if (
                  !reason ||
                  !confirm(
                    "Encerrar definitivamente o saldo não recebido deste pedido?"
                  )
                )
                  return;
                closeBalance.mutate({
                  publicId: order.publicId,
                  reason,
                  discountCents: order.discountCents ?? 0,
                  freightCents: order.freightCents ?? 0,
                  otherExpensesCents: order.otherExpensesCents ?? 0,
                });
              }}
            >
              Encerrar saldo
            </Button>
          )}
          <Button variant="outline" onClick={close}>
            Voltar
          </Button>
          <Button
            disabled={
              receive.isPending ||
              !Object.values(quantities).some(value => Number(value) > 0)
            }
            onClick={() =>
              receive.mutate({
                publicId: order.publicId,
                idempotencyKey,
                documentNumber: documentNumber || null,
                notes: notes || null,
                items: order.items
                  .filter((item: any) => Number(quantities[item.publicId]) > 0)
                  .map((item: any) => ({
                    orderItemPublicId: item.publicId,
                    quantity: quantities[item.publicId],
                  })),
              })
            }
          >
            <PackageCheck className="mr-2 h-4 w-4" />
            Confirmar entrada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestDetail({
  publicId,
  close,
  done,
  fail,
}: {
  publicId: string | null;
  close: () => void;
  done: (message?: string) => Promise<void>;
  fail: (text: string) => void;
}) {
  const query = trpc.erp.purchases.requests.detail.useQuery(
    { publicId: publicId! },
    { enabled: Boolean(publicId) }
  );
  const request = query.data as any;
  const [directOpen, setDirectOpen] = React.useState(false);
  const [quoteOpen, setQuoteOpen] = React.useState(false);
  const submit = trpc.erp.purchases.requests.submit.useMutation({
    onSuccess: async () => {
      await query.refetch();
      await done("Solicitação enviada para aprovação.");
    },
    onError: error => fail(errorText(error)),
  });
  const decide = trpc.erp.purchases.requests.decide.useMutation({
    onSuccess: async (_, variables) => {
      await query.refetch();
      await done(
        variables.decision === "approved"
          ? "Solicitação aprovada."
          : "Solicitação reprovada."
      );
    },
    onError: error => fail(errorText(error)),
  });
  const createQuote = trpc.erp.purchases.quotes.create.useMutation({
    onSuccess: async () => {
      await query.refetch();
      setQuoteOpen(true);
      await done("Cotação iniciada.");
    },
    onError: error => fail(errorText(error)),
  });

  if (!publicId) return null;
  const finishAsOrder = async (message: string) => {
    setDirectOpen(false);
    setQuoteOpen(false);
    close();
    await done(message);
  };

  return (
    <>
      <Dialog open onOpenChange={value => !value && close()}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3 pr-7">
              <div>
                <DialogTitle>
                  {request?.requestNumber ?? "Carregando solicitação…"}
                </DialogTitle>
                <p className="mt-1 text-sm text-slate-500">
                  {request?.requesterName}
                </p>
              </div>
              {request && <Status value={request.status} request />}
            </div>
          </DialogHeader>

          {query.isLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Carregando…
            </p>
          ) : query.error || !request ? (
            <ErpEmptyState
              title="Solicitação indisponível"
              action={{
                label: "Tentar novamente",
                onClick: () => void query.refetch(),
              }}
            />
          ) : (
            <div className="space-y-5">
              <dl className="grid gap-4 sm:grid-cols-3">
                <Info
                  label="Área"
                  value={request.department || "Não informada"}
                />
                <Info
                  label="Prioridade"
                  value={
                    request.priority === "urgent"
                      ? "Urgente"
                      : request.priority === "high"
                        ? "Alta"
                        : request.priority === "low"
                          ? "Baixa"
                          : "Normal"
                  }
                />
                <Info
                  label="Responsável"
                  value={request.responsibleName || "Não atribuído"}
                />
              </dl>
              <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {request.reason}
              </div>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Itens</h3>
                <div className="space-y-2">
                  {request.items.map((item: any) => (
                    <div
                      key={item.publicId}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                    >
                      <div>
                        <strong className="text-sm">{item.description}</strong>
                        <p className="text-xs text-slate-500">
                          {item.sku ? `SKU ${item.sku} · ` : ""}
                          {item.quantity} {item.unit || "un."}
                        </p>
                      </div>
                      {request.capabilities?.canViewValues && (
                        <span className="tabular-nums text-sm font-semibold">
                          {formatMoney(item.estimatedUnitCostCents)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
              {request.quote && (
                <button
                  type="button"
                  onClick={() => setQuoteOpen(true)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-blue-50 p-4 text-left text-blue-900 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:bg-blue-950/70"
                >
                  <span className="flex items-center gap-3">
                    <FileText className="h-5 w-5" />
                    <span>
                      <strong className="block text-sm">
                        Cotação {request.quote.quoteNumber}
                      </strong>
                      <span className="text-xs">
                        {request.quote.status === "selected"
                          ? "Fornecedor selecionado"
                          : `${request.quote.proposals.length} proposta(s)`}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
              <section>
                <h3 className="mb-3 text-sm font-semibold">Linha do tempo</h3>
                <div className="space-y-3">
                  {request.timeline.map((event: any) => (
                    <div key={event.publicId} className="flex gap-3">
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${event.actorType === "system" ? "bg-violet-500" : "bg-blue-600"}`}
                      />
                      <div>
                        <p className="text-sm font-medium">{event.summary}</p>
                        <p className="text-xs text-slate-500">
                          {event.actorType === "system"
                            ? "Sistema"
                            : event.actorName}{" "}
                          · {safeDate(event.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          <DialogFooter className="flex-wrap">
            {request?.status === "draft" &&
              request.capabilities?.canEditRequest && (
                <Button
                  onClick={() =>
                    submit.mutate({
                      publicId,
                      idempotencyKey: crypto.randomUUID(),
                      reason: null,
                    })
                  }
                  disabled={submit.isPending}
                >
                  <Clock3 className="mr-2 h-4 w-4" />
                  Enviar para aprovação
                </Button>
              )}
            {request?.status === "pending_approval" &&
              request.capabilities?.canApprove && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const reason = prompt("Motivo da reprovação");
                      if (reason)
                        decide.mutate({
                          publicId,
                          decision: "rejected",
                          reason,
                          idempotencyKey: crypto.randomUUID(),
                        });
                    }}
                    disabled={decide.isPending}
                  >
                    Reprovar
                  </Button>
                  <Button
                    onClick={() =>
                      decide.mutate({
                        publicId,
                        decision: "approved",
                        reason: null,
                        idempotencyKey: crypto.randomUUID(),
                      })
                    }
                    disabled={decide.isPending}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Aprovar
                  </Button>
                </>
              )}
            {request?.status === "approved" &&
              !request.convertedToOrder &&
              request.capabilities?.canCreateOrder && (
                <>
                  {!request.quote && (
                    <Button variant="outline" onClick={() => setDirectOpen(true)}>
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Gerar pedido
                    </Button>
                  )}
                  {request.quote ? (
                    <Button onClick={() => setQuoteOpen(true)}>
                      <FileText className="mr-2 h-4 w-4" />
                      Gerenciar cotação
                    </Button>
                  ) : (
                    <Button
                      onClick={() =>
                        createQuote.mutate({ requestPublicId: publicId })
                      }
                      disabled={createQuote.isPending}
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      Iniciar cotação
                    </Button>
                  )}
                </>
              )}
            <Button variant="ghost" onClick={close}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RequestOrderDialog
        open={directOpen}
        request={request}
        close={() => setDirectOpen(false)}
        done={() => finishAsOrder("Pedido criado a partir da solicitação.")}
        fail={fail}
      />
      <QuoteDialog
        open={quoteOpen}
        quotePublicId={request?.quote?.publicId ?? null}
        requestItems={request?.items ?? []}
        capabilities={request?.capabilities}
        close={() => setQuoteOpen(false)}
        done={() =>
          finishAsOrder("Pedido criado a partir da cotação selecionada.")
        }
        fail={fail}
      />
    </>
  );
}

function RequestOrderDialog({
  open,
  request,
  close,
  done,
  fail,
}: {
  open: boolean;
  request: any;
  close: () => void;
  done: () => void;
  fail: (text: string) => void;
}) {
  const suppliers = trpc.erp.suppliers.list.useQuery(
    {
      search: "",
      active: true,
      sort: "legalName",
      direction: "asc",
      page: 1,
      pageSize: 100,
    },
    { enabled: open }
  );
  const [supplierPublicId, setSupplierPublicId] = React.useState("");
  const [expectedDate, setExpectedDate] = React.useState("");
  const [freight, setFreight] = React.useState("0");
  const [paymentTerms, setPaymentTerms] = React.useState("");
  const [costs, setCosts] = React.useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => crypto.randomUUID());
  React.useEffect(() => {
    if (!open || !request) return;
    setSupplierPublicId("");
    setExpectedDate("");
    setFreight("0");
    setPaymentTerms("");
    setIdempotencyKey(crypto.randomUUID());
    setCosts(
      Object.fromEntries(
        request.items.map((item: any) => [
          item.publicId,
          String(item.estimatedUnitCostCents / 100),
        ])
      )
    );
  }, [open, request]);
  const create = trpc.erp.purchases.requests.createOrder.useMutation({
    onSuccess: done,
    onError: error => fail(errorText(error)),
  });
  const catalogReady = Boolean(
    request?.items.every((item: any) => item.productPublicId)
  );

  return (
    <Dialog open={open} onOpenChange={value => !value && close()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Gerar pedido da solicitação</DialogTitle>
        </DialogHeader>
        {!catalogReady ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            Cadastre os itens descritivos como produtos antes de gerar o pedido.
            A solicitação permanece preservada.
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={event => {
              event.preventDefault();
              create.mutate({
                requestPublicId: request.publicId,
                supplierPublicId,
                idempotencyKey,
                responsibleUserId: null,
                notes: `Originado da ${request.requestNumber}`,
                expectedDate: expectedDate || null,
                discountCents: 0,
                freightCents: cents(freight),
                otherExpensesCents: 0,
                paymentTerms: paymentTerms || null,
                installments: [],
                items: request.items.map((item: any) => ({
                  productPublicId: item.productPublicId,
                  inventoryItemPublicId: item.inventoryItemPublicId,
                  quantity: item.quantity,
                  unitCostCents: cents(costs[item.publicId] ?? "0"),
                  discountCents: 0,
                })),
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fornecedor">
                <select
                  required
                  value={supplierPublicId}
                  onChange={event => setSupplierPublicId(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione</option>
                  {suppliers.data?.items.map(item => (
                    <option key={item.publicId} value={item.publicId}>
                      {item.legalName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Previsão de entrega">
                <Input
                  type="date"
                  value={expectedDate}
                  onChange={event => setExpectedDate(event.target.value)}
                />
              </Field>
            </div>
            <div className="space-y-2">
              {request.items.map((item: any) => (
                <label
                  key={item.publicId}
                  className="grid items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900 sm:grid-cols-[1fr_9rem]"
                >
                  <span className="text-sm">
                    <strong className="block">{item.description}</strong>
                    <span className="text-xs text-slate-500">
                      {item.quantity} {item.unit || "un."}
                    </span>
                  </span>
                  <Input
                    aria-label={`Custo unitário de ${item.description}`}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={costs[item.publicId] ?? "0"}
                    onChange={event =>
                      setCosts(current => ({
                        ...current,
                        [item.publicId]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Frete">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={freight}
                  onChange={event => setFreight(event.target.value)}
                />
              </Field>
              <Field label="Condição de pagamento">
                <Input
                  value={paymentTerms}
                  onChange={event => setPaymentTerms(event.target.value)}
                  placeholder="Ex.: 30/60 dias"
                />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Voltar
              </Button>
              <Button disabled={create.isPending}>
                {create.isPending ? "Criando…" : "Criar pedido"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuoteDialog({
  open,
  quotePublicId,
  requestItems,
  capabilities,
  close,
  done,
  fail,
}: {
  open: boolean;
  quotePublicId: string | null;
  requestItems: any[];
  capabilities?: any;
  close: () => void;
  done: () => void;
  fail: (text: string) => void;
}) {
  const quoteQuery = trpc.erp.purchases.quotes.detail.useQuery(
    { publicId: quotePublicId! },
    { enabled: open && Boolean(quotePublicId) }
  );
  const suppliers = trpc.erp.suppliers.list.useQuery(
    {
      search: "",
      active: true,
      sort: "legalName",
      direction: "asc",
      page: 1,
      pageSize: 100,
    },
    { enabled: open }
  );
  const quote = quoteQuery.data as any;
  const [supplierPublicId, setSupplierPublicId] = React.useState("");
  const [freight, setFreight] = React.useState("0");
  const [leadTimeDays, setLeadTimeDays] = React.useState("");
  const [paymentTerms, setPaymentTerms] = React.useState("");
  const [expectedDate, setExpectedDate] = React.useState("");
  const [prices, setPrices] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!open) return;
    setSupplierPublicId("");
    setFreight("0");
    setLeadTimeDays("");
    setPaymentTerms("");
    setExpectedDate("");
    setPrices(
      Object.fromEntries(
        requestItems.map(item => [
          item.publicId,
          String(item.estimatedUnitCostCents / 100),
        ])
      )
    );
  }, [open, requestItems]);
  const addProposal = trpc.erp.purchases.quotes.addProposal.useMutation({
    onSuccess: async () => {
      await quoteQuery.refetch();
      setSupplierPublicId("");
      setFreight("0");
    },
    onError: error => fail(errorText(error)),
  });
  const selectProposal = trpc.erp.purchases.quotes.selectProposal.useMutation({
    onSuccess: () => quoteQuery.refetch(),
    onError: error => fail(errorText(error)),
  });
  const createOrder = trpc.erp.purchases.quotes.createOrder.useMutation({
    onSuccess: done,
    onError: error => fail(errorText(error)),
  });

  return (
    <Dialog open={open} onOpenChange={value => !value && close()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{quote?.quoteNumber ?? "Cotação"}</DialogTitle>
        </DialogHeader>
        {quoteQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-slate-500">
            Carregando cotação…
          </p>
        ) : quoteQuery.error || !quote ? (
          <ErpEmptyState
            title="Cotação indisponível"
            action={{
              label: "Tentar novamente",
              onClick: () => void quoteQuery.refetch(),
            }}
          />
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Propostas recebidas</h3>
                <span className="text-xs text-slate-500">
                  {quote.proposals.length} fornecedor(es)
                </span>
              </div>
              {quote.proposals.length ? (
                quote.proposals.map((proposal: any) => (
                  <div
                    key={proposal.publicId}
                    className={`rounded-xl border p-4 ${proposal.selected ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" : "border-slate-200 dark:border-slate-800"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <strong>{proposal.supplierName}</strong>
                        <p className="mt-1 text-xs text-slate-500">
                          {proposal.leadTimeDays == null
                            ? "Prazo não informado"
                            : `${proposal.leadTimeDays} dia(s)`}
                          {proposal.paymentTerms
                            ? ` · ${proposal.paymentTerms}`
                            : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        {capabilities?.canViewValues && (
                          <strong className="tabular-nums">
                            {formatMoney(proposal.totalCents)}
                          </strong>
                        )}
                        {proposal.selected && (
                          <span className="mt-1 block text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            Selecionada
                          </span>
                        )}
                      </div>
                    </div>
                    {!proposal.selected &&
                      quote.status !== "selected" &&
                      capabilities?.canApprove && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() =>
                            selectProposal.mutate({
                              quotePublicId: quote.publicId,
                              proposalPublicId: proposal.publicId,
                            })
                          }
                          disabled={selectProposal.isPending}
                        >
                          Selecionar fornecedor
                        </Button>
                      )}
                  </div>
                ))
              ) : (
                <ErpEmptyState
                  title="Nenhuma proposta registrada"
                  description="Inclua preços de um fornecedor para comparar as condições."
                />
              )}
            </section>

            {quote.status !== "selected" && capabilities?.canCreateOrder && (
              <form
                className="space-y-4 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900"
                onSubmit={event => {
                  event.preventDefault();
                  addProposal.mutate({
                    quotePublicId: quote.publicId,
                    supplierPublicId,
                    freightCents: cents(freight),
                    leadTimeDays: leadTimeDays ? Number(leadTimeDays) : null,
                    paymentTerms: paymentTerms || null,
                    notes: null,
                    supplierFilePublicId: null,
                    items: requestItems.map(item => ({
                      requestItemPublicId: item.publicId,
                      unitCostCents: cents(prices[item.publicId] ?? "0"),
                      discountCents: 0,
                    })),
                  });
                }}
              >
                <h3 className="text-sm font-semibold">Adicionar proposta</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Fornecedor">
                    <select
                      required
                      value={supplierPublicId}
                      onChange={event =>
                        setSupplierPublicId(event.target.value)
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Selecione</option>
                      {suppliers.data?.items.map(item => (
                        <option key={item.publicId} value={item.publicId}>
                          {item.legalName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Prazo em dias">
                    <Input
                      type="number"
                      min="0"
                      max="3650"
                      value={leadTimeDays}
                      onChange={event => setLeadTimeDays(event.target.value)}
                    />
                  </Field>
                </div>
                <div className="space-y-2">
                  {requestItems.map(item => (
                    <label
                      key={item.publicId}
                      className="grid items-center gap-3 rounded-xl bg-white p-3 dark:bg-slate-950 sm:grid-cols-[1fr_9rem]"
                    >
                      <span className="text-sm">
                        <strong className="block">{item.description}</strong>
                        <span className="text-xs text-slate-500">
                          {item.quantity} {item.unit || "un."}
                        </span>
                      </span>
                      <Input
                        aria-label={`Preço de ${item.description}`}
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={prices[item.publicId] ?? "0"}
                        onChange={event =>
                          setPrices(current => ({
                            ...current,
                            [item.publicId]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Frete">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={freight}
                      onChange={event => setFreight(event.target.value)}
                    />
                  </Field>
                  <Field label="Condição de pagamento">
                    <Input
                      value={paymentTerms}
                      onChange={event => setPaymentTerms(event.target.value)}
                    />
                  </Field>
                </div>
                <Button disabled={addProposal.isPending}>
                  {addProposal.isPending ? "Salvando…" : "Registrar proposta"}
                </Button>
              </form>
            )}

            {quote.status === "selected" && capabilities?.canCreateOrder && (
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-slate-950 p-4 text-white">
                <Field label="Previsão de entrega">
                  <Input
                    type="date"
                    value={expectedDate}
                    onChange={event => setExpectedDate(event.target.value)}
                    className="bg-white text-slate-950"
                  />
                </Field>
                <Button
                  variant="secondary"
                  onClick={() =>
                    createOrder.mutate({
                      quotePublicId: quote.publicId,
                      responsibleUserId: null,
                      notes: `Originado da ${quote.quoteNumber}`,
                      expectedDate: expectedDate || null,
                      discountCents: 0,
                      otherExpensesCents: 0,
                      installments: [],
                    })
                  }
                  disabled={createOrder.isPending}
                >
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  {createOrder.isPending ? "Criando…" : "Gerar pedido vencedor"}
                </Button>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}
