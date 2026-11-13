import React from "react";
import {
  Calendar,
  Download,
  Filter,
  Printer,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErpPageHeader } from "@/components/erp/ErpPageHeader";

type Section =
  | "executive"
  | "sales"
  | "purchases"
  | "stock"
  | "finance"
  | "clients"
  | "suppliers"
  | "fiscal";

type Status =
  | "draft"
  | "confirmed"
  | "fulfilled"
  | "approved"
  | "received"
  | "cancelled"
  | "open"
  | "settled"
  | "ready_for_integration";

const sections: Array<[Section, string]> = [
  ["executive", "Resumo executivo"],
  ["sales", "Vendas"],
  ["purchases", "Compras"],
  ["stock", "Estoque"],
  ["finance", "Financeiro"],
  ["clients", "Clientes"],
  ["suppliers", "Fornecedores"],
  ["fiscal", "Fiscal interno"],
];

const statuses: Record<Section, readonly Status[]> = {
  executive: [],
  sales: ["draft", "confirmed", "fulfilled", "cancelled"],
  purchases: ["draft", "approved", "received", "cancelled"],
  stock: [],
  finance: ["open", "settled", "cancelled"],
  clients: [],
  suppliers: [],
  fiscal: ["draft", "ready_for_integration", "cancelled"],
};

const defaultSort = {
  sales: "date",
  purchases: "date",
  stock: "movement",
  finance: "dueDate",
  clients: "salesTotal",
  suppliers: "purchasesTotal",
  fiscal: "date",
} as const;

const iso = (date: Date) => date.toISOString().slice(0, 10);

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const labels: Record<string, string> = {
  count: "Quantidade",
  valueCents: "Valor",
  openTitles: "Títulos abertos",
  openReceivables: "Contas a receber",
  openPayables: "Contas a pagar",
  receivedCents: "Recebidos",
  paidCents: "Pagos",
  balanceCents: "Saldo consolidado",
  activeProducts: "Produtos ativos",
  lowStock: "Estoque baixo",
  activeClients: "Clientes ativos",
  activeSuppliers: "Fornecedores ativos",
  drafts: "Rascunhos",
  ready: "Preparados",
  cancelled: "Cancelados",
};

const display = (key: string, value: unknown) =>
  key.toLowerCase().includes("cents")
    ? money.format(Number(value ?? 0) / 100)
    : key.toLowerCase().includes("millis")
      ? (Number(value ?? 0) / 1000).toLocaleString("pt-BR", {
          maximumFractionDigits: 3,
        })
      : String(value ?? "—");

export function ReportsPage() {
  const [section, setSection] = React.useState<Section>("executive");
  const [from, setFrom] = React.useState(() =>
    iso(new Date(Date.now() - 29 * 86_400_000))
  );
  const [to, setTo] = React.useState(() => iso(new Date()));
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<Status | "">("");

  const valid = from <= to;

  const query = trpc.erp.reports.report.useQuery(
    {
      section,
      from,
      to,
      status: status || undefined,
      page,
      pageSize: 20,
      sort: section === "executive" ? undefined : defaultSort[section],
      direction: "desc",
    },
    { enabled: valid, retry: false }
  );

  const exportCsv = trpc.erp.reports.exportCsv.useMutation({
    onSuccess: r => {
      const blob = new Blob([r.content], { type: r.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.fileName;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const setPeriodPreset = (preset: "today" | "7d" | "30d" | "month") => {
    const now = new Date();
    const end = iso(now);
    let start = end;
    if (preset === "7d") {
      start = iso(new Date(Date.now() - 6 * 86_400_000));
    } else if (preset === "30d") {
      start = iso(new Date(Date.now() - 29 * 86_400_000));
    } else if (preset === "month") {
      start = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    setFrom(start);
    setTo(end);
    setPage(1);
  };

  const result = query.data as any;
  const data = result?.data;
  const rows = Array.isArray(data) ? data : (data?.items ?? data?.rows ?? []);
  const cards =
    data && !Array.isArray(data)
      ? section === "executive"
        ? Object.entries(data).flatMap(([group, value]) =>
            Object.entries(value as object).map(([key, v]) => ({
              key: `${group}-${key}`,
              label: labels[key] ?? key,
              value: v,
            }))
          )
        : Object.entries(data.summary ?? {}).map(([key, value]) => ({
            key,
            label: labels[key] ?? key,
            value,
          }))
      : [];

  return (
    <div
      data-testid="erp-reports-page"
      className="min-w-0 space-y-5 pb-12 print:space-y-3"
    >
      <div className="print:hidden">
        <ErpPageHeader title="Relatórios essenciais" />
      </div>

      {/* Navigation Sections */}
      <nav
        aria-label="Seções de relatórios"
        className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2 shadow-xs print:hidden"
      >
        {sections.map(([id, label]) => (
          <Button
            key={id}
            aria-current={section === id ? "page" : undefined}
            className="rounded-xl text-xs font-semibold"
            variant={section === id ? "default" : "outline"}
            onClick={e => {
              setSection(id);
              setStatus("");
              setPage(1);
              (e.currentTarget as HTMLButtonElement).focus();
            }}
          >
            {label}
          </Button>
        ))}
      </nav>

      {/* Filter and Period Selection Bar */}
      <section
        aria-label="Filtros"
        className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs print:hidden"
      >
        {/* Quick Presets Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 mr-1 flex items-center gap-1">
              <Calendar className="size-3.5 text-blue-600" /> Período:
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs rounded-lg"
              onClick={() => setPeriodPreset("today")}
            >
              Hoje
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs rounded-lg"
              onClick={() => setPeriodPreset("7d")}
            >
              7 dias
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs rounded-lg"
              onClick={() => setPeriodPreset("30d")}
            >
              30 dias
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs rounded-lg"
              onClick={() => setPeriodPreset("month")}
            >
              Mês atual
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs rounded-xl"
              onClick={() => window.print()}
            >
              <Printer className="mr-1.5 size-3.5 text-slate-600" />
              Imprimir / PDF
            </Button>

            {result?.canExport && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs rounded-xl text-blue-700 border-blue-200 bg-blue-50/50 hover:bg-blue-100"
                disabled={exportCsv.isPending || !valid}
                onClick={() =>
                  exportCsv.mutate({
                    section,
                    from,
                    to,
                    status: status || undefined,
                    page: 1,
                    pageSize: 100,
                    sort:
                      section === "executive"
                        ? undefined
                        : defaultSort[section],
                    direction: "desc",
                    maxRows: 1000,
                  })
                }
              >
                <Download className="mr-1.5 size-3.5" />
                {exportCsv.isPending ? "Exportando…" : "Exportar CSV"}
              </Button>
            )}
          </div>
        </div>

        {/* Inputs Grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold text-slate-700 block">
            Data inicial
            <Input
              type="date"
              aria-label="Data inicial"
              value={from}
              onChange={e => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="mt-1 text-xs"
            />
          </label>

          <label className="text-xs font-semibold text-slate-700 block">
            Data final
            <Input
              type="date"
              aria-label="Data final"
              value={to}
              onChange={e => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="mt-1 text-xs"
            />
          </label>

          {statuses[section].length > 0 && (
            <label className="text-xs font-semibold text-slate-700 block">
              Estado
              <select
                aria-label="Estado"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-xs shadow-xs focus:border-blue-600 focus:outline-none"
                value={status}
                onChange={e => {
                  setStatus(e.target.value as Status | "");
                  setPage(1);
                }}
              >
                <option value="">Todos</option>
                {statuses[section].map(x => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      {!valid && (
        <p
          role="alert"
          className="rounded-2xl border border-red-300 bg-red-50 p-4 text-xs font-medium text-red-800"
        >
          Período inválido: a data final deve ser igual ou posterior à inicial.
        </p>
      )}

      {query.isLoading && (
        <div
          role="status"
          className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-xs"
        >
          <RefreshCw className="mx-auto size-6 animate-spin text-blue-600" />
          <p className="mt-2 text-sm font-medium">Carregando relatório…</p>
        </div>
      )}

      {query.isFetching && !query.isLoading && (
        <p role="status" className="text-xs text-slate-400">
          Atualizando dados…
        </p>
      )}

      {query.error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-xs"
        >
          <p className="font-semibold text-red-800 text-sm">
            Não foi possível carregar o relatório.
          </p>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      )}

      {/* KPI Cards */}
      {cards.length > 0 && (
        <section
          aria-label="Indicadores"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {cards.map(c => (
            <article
              key={c.key}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
            >
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                {c.label}
              </p>
              <strong className="mt-2 block text-2xl font-bold text-slate-900">
                {display(c.key, c.value)}
              </strong>
            </article>
          ))}
        </section>
      )}

      {/* Comparison Panel */}
      {section === "executive" && result?.comparison && (
        <section
          aria-label="Comparação com o período anterior"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {Object.entries(result.comparison).map(([key, raw]) => {
            const metric = raw as {
              current: number;
              previous: number;
              absoluteChange: number;
              percentageChange: number | null;
            };
            return (
              <article
                key={key}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
              >
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {labels[key] ?? key}
                </p>
                <strong className="mt-2 block text-2xl font-bold text-slate-900">
                  {display(key, metric.current)}
                </strong>
                <p className="mt-1 text-xs font-medium text-emerald-700">
                  {metric.percentageChange === null
                    ? "Sem base de comparação"
                    : `${metric.percentageChange.toLocaleString("pt-BR", {
                        maximumFractionDigits: 2,
                      })}%`}
                </p>
              </article>
            );
          })}
        </section>
      )}

      {query.data && rows.length === 0 && section !== "executive" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-xs">
          <p className="text-sm font-semibold text-slate-800">
            Nenhum dado encontrado para os filtros informados.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Altere o período ou o estado do filtro para visualizar registros.
          </p>
        </div>
      )}

      {/* Data Table */}
      {rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs md:block">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                  {Object.keys(rows[0]).map(k => (
                    <th className="p-3.5" key={k}>
                      {labels[k] ?? k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row: any, i: number) => (
                  <tr
                    className="hover:bg-slate-50/80 transition"
                    key={row.publicId ?? `${row.status}-${i}`}
                  >
                    {Object.entries(row).map(([k, v]) => (
                      <td className="p-3.5 text-slate-700" key={k}>
                        {display(k, v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {rows.map((row: any, i: number) => (
              <article
                className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs"
                key={row.publicId ?? `${row.status}-${i}`}
              >
                {Object.entries(row).map(([k, v]) => (
                  <p className="text-xs py-0.5" key={k}>
                    <span className="font-semibold text-slate-500">
                      {labels[k] ?? k}:{" "}
                    </span>
                    <span className="text-slate-800">{display(k, v)}</span>
                  </p>
                ))}
              </article>
            ))}
          </div>

          <nav
            aria-label="Paginação"
            className="flex items-center justify-between gap-2 pt-2 print:hidden"
          >
            <span className="text-xs text-slate-500">Página {page}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= Number(data?.totalPages ?? 1)}
                onClick={() => setPage(p => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </nav>
        </>
      )}

      {exportCsv.error && (
        <p
          role="alert"
          className="text-xs text-red-600 bg-red-50 p-3 rounded-xl border border-red-200"
        >
          Exportação recusada: {exportCsv.error.message}
        </p>
      )}
    </div>
  );
}
