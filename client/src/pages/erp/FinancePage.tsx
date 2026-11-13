import React, { useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  Filter,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wallet,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const today = () => new Date().toISOString().slice(0, 10);
const toCents = (v: string) =>
  Math.round(Number(String(v).replace(/\./g, "").replace(",", ".")) * 100);

const settlementKeys = new Map<string, string>();
const settlementKey = (publicId: string) => {
  let key = settlementKeys.get(publicId);
  if (!key) {
    key = crypto.randomUUID();
    settlementKeys.set(publicId, key);
  }
  return key;
};

type Mode = "entry" | "account" | "category" | "source" | null;

export function FinancePage() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<
    "payable" | "receivable" | undefined
  >();
  const [status, setStatus] = useState<
    "open" | "settled" | "cancelled" | undefined
  >();
  const [mode, setMode] = useState<Mode>(null);
  const [selected, setSelected] = useState<any>(null);

  const options = trpc.erp.finance.options.useQuery();
  const summary = trpc.erp.finance.summary.useQuery({});
  const list = trpc.erp.finance.list.useQuery({
    search,
    direction,
    status,
    sort: "dueDate",
    directionSort: "asc",
    page,
    pageSize: 20,
  });

  const refresh = () => void utils.erp.finance.invalidate();

  const accountActive = trpc.erp.finance.accounts.setActive.useMutation({
    onSuccess: refresh,
  });
  const categoryActive = trpc.erp.finance.categories.setActive.useMutation({
    onSuccess: refresh,
  });

  if (options.error?.data?.code === "FORBIDDEN") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-xs"
      >
        <h1 className="text-xl font-bold text-slate-900">Acesso indisponível</h1>
        <p className="mt-2 text-sm text-slate-500">
          Financeiro não está disponível para seu perfil.
        </p>
      </div>
    );
  }

  if (options.isLoading || summary.isLoading) {
    return (
      <div
        role="status"
        className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-xs"
      >
        <RefreshCw className="mx-auto size-6 animate-spin text-blue-600" />
        <p className="mt-2 text-sm font-medium">Carregando Financeiro…</p>
      </div>
    );
  }

  if (options.error || summary.error || list.error) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center shadow-xs"
      >
        <AlertCircle className="mx-auto size-6 text-red-600" />
        <p className="mt-2 font-semibold text-red-800">
          Não foi possível carregar o Financeiro.
        </p>
        <Button variant="outline" className="mt-4" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    );
  }

  const s = summary.data as any;
  const canWrite = Boolean(options.data?.canWrite);

  // Total balance across accounts
  const totalBalanceCents = (s?.accounts ?? []).reduce(
    (acc: number, cur: any) => acc + Number(cur.currentBalanceCents ?? 0),
    0
  );

  return (
    <section
      className="min-w-0 space-y-6 pb-12"
      data-testid="erp-finance-page"
    >
      {/* Header & Quick Actions */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 shadow-xs">
              <DollarSign className="size-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Financeiro
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Controle de fluxo de caixa, contas a pagar, a receber e conciliação bancária.
          </p>
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="bg-blue-600 font-semibold shadow-xs hover:bg-blue-700 text-xs"
              onClick={() => setMode("entry")}
            >
              <Plus className="mr-1.5 size-3.5" />
              Novo título
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setMode("source")}
            >
              Gerar de pedido
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setMode("account")}
            >
              Nova conta
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setMode("category")}
            >
              Nova categoria
            </Button>
          </div>
        )}
      </header>

      {!canWrite && (
        <p
          role="status"
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-medium text-slate-600"
        >
          Acesso somente leitura.
        </p>
      )}

      {/* Primary Financial KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wider">
              Saldo Consolidado
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Wallet className="size-4" />
            </span>
          </div>
          <strong className="mt-2 block text-2xl font-bold text-slate-900">
            {money.format(totalBalanceCents / 100)}
          </strong>
          <span className="mt-1 block text-xs text-slate-500">
            {(s?.accounts ?? []).length} conta(s) bancária(s) ativas
          </span>
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wider">
              A Receber em Aberto
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <ArrowDownLeft className="size-4" />
            </span>
          </div>
          <strong className="mt-2 block text-2xl font-bold text-emerald-700">
            {money.format(Number(s?.openReceivable ?? 0) / 100)}
          </strong>
          <span className="mt-1 block text-xs text-slate-500">
            Vencidos:{" "}
            <strong className="text-amber-700">
              {money.format(Number(s?.overdueReceivable ?? 0) / 100)}
            </strong>
          </span>
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wider">
              A Pagar em Aberto
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
              <ArrowUpRight className="size-4" />
            </span>
          </div>
          <strong className="mt-2 block text-2xl font-bold text-rose-700">
            {money.format(Number(s?.openPayable ?? 0) / 100)}
          </strong>
          <span className="mt-1 block text-xs text-slate-500">
            Vencidos:{" "}
            <strong className="text-red-700">
              {money.format(Number(s?.overduePayable ?? 0) / 100)}
            </strong>
          </span>
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wider">
              Resultado Realizado
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
              <CheckCircle2 className="size-4" />
            </span>
          </div>
          <strong
            className={`mt-2 block text-2xl font-bold ${
              Number(s?.realizedNetCents ?? 0) >= 0
                ? "text-emerald-700"
                : "text-red-700"
            }`}
          >
            {money.format(Number(s?.realizedNetCents ?? 0) / 100)}
          </strong>
          <span className="mt-1 block text-xs text-slate-500">
            Recebido: {money.format(Number(s?.settledReceivable ?? 0) / 100)} |
            Pago: {money.format(Number(s?.settledPayable ?? 0) / 100)}
          </span>
        </article>
      </div>

      {/* Accounts Balances Bar */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              Saldos das contas
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            Clique na conta para consultar o extrato (Ledger)
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {(s?.accounts ?? []).map((a: any) => (
            <button
              key={a.publicId}
              type="button"
              className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-left transition hover:border-blue-300 hover:bg-white hover:shadow-xs"
              onClick={() => setSelected({ kind: "ledger", ...a })}
            >
              <div className="min-w-0 pr-2">
                <span className="block truncate text-xs font-semibold text-slate-900">
                  {a.name}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  {a.type === "cash" ? "Caixa Físico" : "Conta Bancária"}
                </span>
              </div>
              <strong className="text-sm font-bold text-slate-900 shrink-0">
                {money.format(Number(a.currentBalanceCents) / 100)}
              </strong>
            </button>
          ))}
        </div>
      </section>

      {/* Accordion: Accounts and Categories Management */}
      <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs group">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900 flex items-center justify-between">
          <span>Gerenciar contas e categorias</span>
          <span className="text-xs text-blue-600 group-open:rotate-180 transition-transform">
            ▼
          </span>
        </summary>
        <div className="mt-4 grid gap-6 md:grid-cols-2 pt-3 border-t border-slate-100">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Contas financeiras
            </h3>
            <div className="space-y-1.5 divide-y divide-slate-100">
              {options.data?.accounts.map((a: any) => (
                <div
                  key={a.publicId}
                  className="flex items-center justify-between py-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-800">{a.name}</span>
                    <span
                      className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        a.active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {a.active ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() =>
                        accountActive.mutate({
                          publicId: a.publicId,
                          active: !a.active,
                        })
                      }
                    >
                      {a.active ? "Inativar" : "Ativar"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Categorias
            </h3>
            <div className="space-y-1.5 divide-y divide-slate-100">
              {options.data?.categories.map((c: any) => (
                <div
                  key={c.publicId}
                  className="flex items-center justify-between py-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-800">{c.name}</span>
                    <span className="ml-2 text-[10px] text-slate-500">
                      {c.direction === "payable"
                        ? "Despesa"
                        : c.direction === "receivable"
                          ? "Receita"
                          : "Ambas"}
                    </span>
                    <span
                      className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        c.active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {c.active ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() =>
                        categoryActive.mutate({
                          publicId: c.publicId,
                          active: !c.active,
                        })
                      }
                    >
                      {c.active ? "Inativar" : "Ativar"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </details>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
          <Input
            aria-label="Buscar título"
            placeholder="Buscar por descrição, número ou parte…"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-8 text-xs"
          />
        </div>

        <select
          aria-label="Direção"
          value={direction ?? ""}
          onChange={e => {
            setDirection((e.target.value || undefined) as any);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs focus:border-blue-600 focus:outline-none"
        >
          <option value="">Pagar e receber</option>
          <option value="payable">Pagar</option>
          <option value="receivable">Receber</option>
        </select>

        <select
          aria-label="Status"
          value={status ?? ""}
          onChange={e => {
            setStatus((e.target.value || undefined) as any);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs focus:border-blue-600 focus:outline-none"
        >
          <option value="">Todos</option>
          <option value="open">Aberto</option>
          <option value="settled">Liquidado</option>
          <option value="cancelled">Cancelado</option>
        </select>

        {(search || direction || status) && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-slate-500 hover:text-slate-800"
            onClick={() => {
              setSearch("");
              setDirection(undefined);
              setStatus(undefined);
              setPage(1);
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Entries Table */}
      {!list.data?.items.length ? (
        <div
          role="status"
          className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-xs"
        >
          <CreditCard className="mx-auto size-8 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-800">
            Nenhum título encontrado.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Lance títulos de despesa ou receita, ou gere títulos a partir de compras e vendas.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="grid grid-cols-1 gap-3 lg:hidden">
            {list.data.items.map((e: any) => (
              <button
                key={e.publicId}
                type="button"
                className="min-w-0 rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-xs transition hover:border-blue-300"
                onClick={() => setSelected(e)}
              >
                <div className="flex items-center justify-between">
                  <strong className="text-xs font-bold text-slate-900">
                    {e.documentNumber} · {e.direction === "payable" ? "Pagar" : "Receber"}
                  </strong>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      e.overdue
                        ? "bg-red-100 text-red-700"
                        : e.status === "settled"
                          ? "bg-emerald-100 text-emerald-700"
                          : e.status === "cancelled"
                            ? "bg-slate-100 text-slate-500"
                            : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {e.overdue ? "Vencido" : e.status}
                  </span>
                </div>
                <span className="block truncate text-xs text-slate-600 mt-1">
                  {e.description}
                </span>
                <div className="mt-2 flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                  <span className="text-slate-400">Venc: {e.dueDate}</span>
                  <strong className="text-sm font-bold text-slate-900">
                    {money.format(e.amountCents / 100)}
                  </strong>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs lg:block">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="p-3.5">Número</th>
                  <th className="p-3.5">Descrição</th>
                  <th className="p-3.5">Parte</th>
                  <th className="p-3.5">Vencimento</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data.items.map((e: any) => (
                  <tr
                    key={e.publicId}
                    className="cursor-pointer transition hover:bg-slate-50/80"
                    tabIndex={0}
                    onClick={() => setSelected(e)}
                    onKeyDown={x => x.key === "Enter" && setSelected(e)}
                  >
                    <td className="p-3.5 font-bold text-slate-900">
                      {e.documentNumber}
                    </td>
                    <td className="p-3.5 max-w-xs truncate text-slate-700">
                      {e.description}
                    </td>
                    <td className="p-3.5 text-slate-600">
                      {e.partyName || "—"}
                    </td>
                    <td className="p-3.5 text-slate-600 font-medium">
                      {e.dueDate}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          e.overdue
                            ? "bg-red-100 text-red-700"
                            : e.status === "settled"
                              ? "bg-emerald-100 text-emerald-700"
                              : e.status === "cancelled"
                                ? "bg-slate-100 text-slate-500"
                                : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {e.overdue ? "Vencido" : e.status}
                      </span>
                    </td>
                    <td
                      className={`p-3.5 text-right font-bold text-sm ${
                        e.direction === "receivable"
                          ? "text-emerald-700"
                          : "text-slate-900"
                      }`}
                    >
                      {money.format(e.amountCents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pagination */}
      <nav
        aria-label="Paginação"
        className="flex items-center justify-between gap-2 pt-2"
      >
        <span className="text-xs text-slate-500">
          Página {page} de {list.data?.totalPages || 1}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= (list.data?.totalPages || 1)}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </Button>
        </div>
      </nav>

      {/* Dialogs */}
      <CreateDialog
        mode={mode}
        close={() => setMode(null)}
        options={options.data}
        done={refresh}
      />
      <Detail
        selected={selected}
        canWrite={canWrite}
        close={() => setSelected(null)}
        done={refresh}
      />
    </section>
  );
}

function CreateDialog({
  mode,
  close,
  options,
  done,
}: {
  mode: Mode;
  close: () => void;
  options: any;
  done: () => void;
}) {
  const [f, setF] = useState<any>({
    direction: "payable",
    type: "bank",
    amount: "0,00",
    issueDate: today(),
    dueDate: today(),
    sourceType: "purchase_order",
    allowNegative: false,
  });

  const ok = () => {
    done();
    close();
  };

  const account = trpc.erp.finance.accounts.create.useMutation({
    onSuccess: ok,
  });
  const category = trpc.erp.finance.categories.create.useMutation({
    onSuccess: ok,
  });
  const manual = trpc.erp.finance.createManual.useMutation({ onSuccess: ok });
  const purchase = trpc.erp.finance.fromPurchase.useMutation({ onSuccess: ok });
  const sale = trpc.erp.finance.fromSale.useMutation({ onSuccess: ok });

  React.useEffect(() => {
    setF({
      direction: "payable",
      type: "bank",
      amount: "0,00",
      issueDate: today(),
      dueDate: today(),
      sourceType: "purchase_order",
      allowNegative: false,
    });
  }, [mode]);

  if (!mode) return null;

  const field = (label: string, key: string, type = "text") => (
    <label className="text-xs font-semibold text-slate-700 block">
      {label}
      <Input
        type={type}
        value={f[key] ?? ""}
        onChange={e => setF({ ...f, [key]: e.target.value })}
        className="mt-1 text-xs"
      />
    </label>
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "account") {
      account.mutate({
        name: f.name,
        type: f.type,
        initialBalanceCents: toCents(f.amount),
        allowNegative: Boolean(f.allowNegative),
      });
    } else if (mode === "category") {
      category.mutate({ name: f.name, direction: f.direction });
    } else if (mode === "entry") {
      manual.mutate({
        documentNumber: f.documentNumber,
        direction: f.direction,
        description: f.description,
        amountCents: toCents(f.amount),
        dueDate: f.dueDate,
        issueDate: f.issueDate,
        categoryPublicId: f.categoryPublicId,
        financialAccountPublicId: f.accountPublicId || null,
        supplierPublicId: null,
        crmClientId: null,
        partyName: f.partyName || null,
        notes: f.notes || null,
      });
    } else {
      const p = {
        sourcePublicId: f.sourcePublicId,
        dueDate: f.dueDate,
        categoryPublicId: f.categoryPublicId,
        financialAccountPublicId: f.accountPublicId || null,
        notes: f.notes || null,
      };
      (f.sourceType === "purchase_order" ? purchase : sale).mutate(p);
    }
  };

  return (
    <Dialog open onOpenChange={x => !x && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900">
            {mode === "account"
              ? "Nova conta"
              : mode === "category"
                ? "Nova categoria"
                : mode === "source"
                  ? "Gerar título de pedido"
                  : "Novo título manual"}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Preencha os dados necessários para o registro financeiro.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid max-h-[70vh] gap-3.5 overflow-y-auto py-2 text-xs"
          onSubmit={submit}
        >
          {mode === "account" ? (
            <>
              {field("Nome da conta", "name")}
              <label className="text-xs font-semibold text-slate-700 block">
                Tipo
                <select
                  value={f.type}
                  onChange={e => setF({ ...f, type: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-xs"
                >
                  <option value="bank">Banco</option>
                  <option value="cash">Caixa Físico</option>
                </select>
              </label>
              {field("Saldo inicial (R$)", "amount")}
              <label className="flex items-center gap-2 text-xs text-slate-700 mt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={f.allowNegative}
                  onChange={e =>
                    setF({ ...f, allowNegative: e.target.checked })
                  }
                  className="rounded text-blue-600"
                />
                Permitir saldo negativo
              </label>
            </>
          ) : mode === "category" ? (
            <>
              {field("Nome da categoria", "name")}
              <Direction f={f} setF={setF} both />
            </>
          ) : (
            <>
              {mode === "source" ? (
                <>
                  <label className="text-xs font-semibold text-slate-700 block">
                    Origem
                    <select
                      value={f.sourceType}
                      onChange={e =>
                        setF({ ...f, sourceType: e.target.value })
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-xs"
                    >
                      <option value="purchase_order">Compra recebida</option>
                      <option value="sales_order">Venda concluída</option>
                    </select>
                  </label>
                  {field("ID público do pedido", "sourcePublicId")}
                </>
              ) : (
                <>
                  {field("Número", "documentNumber")}
                  <Direction f={f} setF={setF} />
                  {field("Descrição", "description")}
                  {field("Valor (R$)", "amount")}
                  {field("Emissão", "issueDate", "date")}
                  {field("Parte (opcional)", "partyName")}
                </>
              )}
              {field("Vencimento", "dueDate", "date")}
              <label className="text-xs font-semibold text-slate-700 block">
                Categoria
                <select
                  required
                  value={f.categoryPublicId ?? ""}
                  onChange={e =>
                    setF({ ...f, categoryPublicId: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-xs"
                >
                  <option value="">Selecione</option>
                  {options?.categories
                    .filter((x: any) => x.active)
                    .map((x: any) => (
                      <option key={x.publicId} value={x.publicId}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700 block">
                Conta prevista
                <select
                  value={f.accountPublicId ?? ""}
                  onChange={e =>
                    setF({ ...f, accountPublicId: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-xs"
                >
                  <option value="">Nenhuma</option>
                  {options?.accounts.map((x: any) => (
                    <option key={x.publicId} value={x.publicId}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              {field("Observações", "notes")}
            </>
          )}

          <Button
            type="submit"
            className="mt-3 bg-blue-600 font-semibold text-xs shadow-xs hover:bg-blue-700"
          >
            Salvar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Direction({
  f,
  setF,
  both = false,
}: {
  f: any;
  setF: (x: any) => void;
  both?: boolean;
}) {
  return (
    <label className="text-xs font-semibold text-slate-700 block">
      Direção
      <select
        value={f.direction}
        onChange={e => setF({ ...f, direction: e.target.value })}
        className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-xs"
      >
        <option value="payable">Pagar</option>
        <option value="receivable">Receber</option>
        {both && <option value="both">Ambas</option>}
      </select>
    </label>
  );
}

function Detail({
  selected,
  canWrite,
  close,
  done,
}: {
  selected: any;
  canWrite: boolean;
  close: () => void;
  done: () => void;
}) {
  const options = trpc.erp.finance.options.useQuery(undefined, {
    enabled: Boolean(selected && selected.kind !== "ledger"),
  });
  const ledger = trpc.erp.finance.accounts.ledger.useQuery(
    { publicId: selected?.publicId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: selected?.kind === "ledger" }
  );
  const settle = trpc.erp.finance.settle.useMutation({
    onSuccess: () => {
      toast.success("Título liquidado com sucesso!");
      done();
      close();
    },
  });
  const cancel = trpc.erp.finance.cancel.useMutation({
    onSuccess: () => {
      toast.success("Título cancelado.");
      done();
      close();
    },
  });
  const update = trpc.erp.finance.update.useMutation({
    onSuccess: () => {
      toast.success("Título atualizado.");
      done();
      close();
    },
  });

  const [account, setAccount] = useState("");

  if (!selected) return null;

  const edit = () => {
    const description = prompt("Descrição", selected.description);
    const dueDate = prompt("Vencimento (AAAA-MM-DD)", selected.dueDate);
    if (description && dueDate) {
      update.mutate({
        publicId: selected.publicId,
        description,
        dueDate,
        categoryPublicId: selected.category.publicId,
        financialAccountPublicId: selected.financialAccount?.publicId ?? null,
        notes: selected.notes ?? null,
      });
    }
  };

  return (
    <Dialog open onOpenChange={x => !x && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900">
            {selected.kind === "ledger"
              ? `Ledger · ${selected.name}`
              : selected.documentNumber}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {selected.kind === "ledger"
              ? "Histórico de movimentações da conta"
              : "Detalhes do lançamento financeiro"}
          </DialogDescription>
        </DialogHeader>

        {selected.kind === "ledger" ? (
          <div className="max-h-96 overflow-y-auto space-y-2 py-2 text-xs">
            {ledger.data?.map((x: any) => (
              <div
                key={x.publicId}
                className="flex items-center justify-between border-b border-slate-100 py-2"
              >
                <div>
                  <span className="font-semibold text-slate-800">{x.type}</span>
                  <span className="block text-[10px] text-slate-400">
                    Saldo após:{" "}
                    {money.format(Number(x.resultingBalanceCents) / 100)}
                  </span>
                </div>
                <strong
                  className={`text-sm ${
                    Number(x.amountCents) >= 0
                      ? "text-emerald-700"
                      : "text-red-700"
                  }`}
                >
                  {money.format(Number(x.amountCents) / 100)}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4 py-2 text-xs">
            <div className="rounded-xl bg-slate-50 p-3 space-y-1.5">
              <p className="font-semibold text-slate-900 text-sm">
                {selected.description}
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500">Vencimento:</span>
                <span className="font-semibold text-slate-700">
                  {selected.dueDate}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Valor do título:</span>
                <strong className="text-base text-blue-700">
                  {money.format(selected.amountCents / 100)}
                </strong>
              </div>
            </div>

            {canWrite && selected.status === "open" && (
              <div className="space-y-3 pt-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Conta para liquidação
                  <select
                    aria-label="Conta para liquidação"
                    value={account}
                    onChange={e => setAccount(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-xs"
                  >
                    <option value="">Selecione a conta para baixa</option>
                    {options.data?.accounts
                      .filter((x: any) => x.active)
                      .map((x: any) => (
                        <option key={x.publicId} value={x.publicId}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </label>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={edit}
                  >
                    Editar título
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-xs text-white"
                    disabled={!account || settle.isPending}
                    onClick={() =>
                      confirm("Confirmar liquidação integral?") &&
                      settle.mutate({
                        publicId: selected.publicId,
                        financialAccountPublicId: account,
                        idempotencyKey: settlementKey(selected.publicId),
                      })
                    }
                  >
                    {settle.isPending ? "Baixando…" : "Liquidar integralmente"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="text-xs"
                    disabled={cancel.isPending}
                    onClick={() => {
                      const reason = prompt("Motivo do cancelamento");
                      if (reason && confirm("Confirmar cancelamento?")) {
                        cancel.mutate({
                          publicId: selected.publicId,
                          reason,
                        });
                      }
                    }}
                  >
                    Cancelar título
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
