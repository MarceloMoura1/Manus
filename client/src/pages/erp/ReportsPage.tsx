import React from "react";
import { Download, RefreshCw } from "lucide-react";
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
  executive: [], sales: ["draft", "confirmed", "fulfilled", "cancelled"],
  purchases: ["draft", "approved", "received", "cancelled"], stock: [],
  finance: ["open", "settled", "cancelled"], clients: [], suppliers: [],
  fiscal: ["draft", "ready_for_integration", "cancelled"],
};
const defaultSort = {
  sales: "date", purchases: "date", stock: "movement", finance: "dueDate",
  clients: "salesTotal", suppliers: "purchasesTotal", fiscal: "date",
} as const;
const iso = (date: Date) => date.toISOString().slice(0, 10),
  money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }),
  labels: Record<string, string> = {
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
  const [section, setSection] = React.useState<Section>("executive"),
    [from, setFrom] = React.useState(() =>
      iso(new Date(Date.now() - 29 * 86_400_000))
    ),
    [to, setTo] = React.useState(() => iso(new Date())),
    [page, setPage] = React.useState(1),
    [status, setStatus] = React.useState<Status | "">("");
  const valid = from <= to,
    query = trpc.erp.reports.report.useQuery(
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
    ),
    exportCsv = trpc.erp.reports.exportCsv.useMutation({
      onSuccess: r => {
        const blob = new Blob([r.content], { type: r.contentType }),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = r.fileName;
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  const result = query.data as any,
    data = result?.data,
    rows = Array.isArray(data) ? data : (data?.items ?? data?.rows ?? []),
    cards =
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
    <div data-testid="erp-reports-page" className="min-w-0 space-y-5">
      <ErpPageHeader title="Relatórios essenciais" />
      <nav aria-label="Seções de relatórios" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2 shadow-sm">
        {sections.map(([id, label]) => (
          <Button
            key={id}
            aria-current={section === id ? "page" : undefined}
            className="rounded-xl"
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
      <section
        aria-label="Filtros"
          className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="text-sm">
          Data inicial
          <Input
            type="date"
            value={from}
            onChange={e => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="text-sm">
          Data final
          <Input
            type="date"
            value={to}
            onChange={e => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {statuses[section].length > 0 && <label className="text-sm">
          Estado
          <select
            className="mt-1 w-full rounded-lg border p-2"
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
        </label>}
        {result?.canExport && <div className="flex items-end">
          <Button
            variant="outline"
            disabled={exportCsv.isPending || !valid}
            onClick={() =>
              exportCsv.mutate({
                section,
                from,
                to,
                status: status || undefined,
                page: 1,
                pageSize: 100,
                sort: section === "executive" ? undefined : defaultSort[section],
                direction: "desc",
                maxRows: 1000,
              })
            }
          >
            <Download className="mr-2 h-4 w-4" />
            {exportCsv.isPending ? "Exportando…" : "Exportar CSV"}
          </Button>
        </div>}
      </section>
      {!valid && (
        <p
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4"
        >
          Período inválido: a data final deve ser igual ou posterior à inicial.
        </p>
      )}
      {query.isLoading && (
        <p role="status" className="rounded-xl border bg-white p-6">
          Carregando relatório…
        </p>
      )}
      {query.isFetching && !query.isLoading && (
        <p role="status" className="text-sm">
          Atualizando dados…
        </p>
      )}
      {query.error && (
        <div role="alert" className="rounded-xl border bg-white p-6">
          Não foi possível carregar o relatório.
          <Button
            className="ml-3"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      )}
      {cards.length > 0 && (
        <section
          aria-label="Indicadores"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {cards.map(c => (
            <article key={c.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{c.label}</p>
              <strong className="text-xl">{display(c.key, c.value)}</strong>
            </article>
          ))}
        </section>
      )}
      {section === "executive" && result?.comparison && (
        <section aria-label="ComparaÃ§Ã£o com o perÃ­odo anterior" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(result.comparison).map(([key, raw]) => {
            const metric = raw as { current: number; previous: number; absoluteChange: number; percentageChange: number | null };
            return <article key={key} className="rounded-2xl border bg-white p-4">
              <p className="text-sm text-slate-500">{labels[key] ?? key}</p>
              <strong className="text-xl">{display(key, metric.current)}</strong>
              <p className="text-sm">{metric.percentageChange === null ? "Sem base de comparaÃ§Ã£o" : `${metric.percentageChange.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`}</p>
            </article>;
          })}
        </section>
      )}
      {query.data && rows.length === 0 && section !== "executive" && (
        <p className="rounded-xl border bg-white p-6">
          Nenhum dado encontrado para os filtros informados.
        </p>
      )}
      {rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border bg-white md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr>
                  {Object.keys(rows[0]).map(k => (
                    <th className="p-3" key={k}>
                      {labels[k] ?? k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any, i: number) => (
                  <tr
                    className="border-t"
                    key={row.publicId ?? `${row.status}-${i}`}
                  >
                    {Object.entries(row).map(([k, v]) => (
                      <td className="p-3" key={k}>
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
                className="rounded-xl border bg-white p-4"
                key={row.publicId ?? `${row.status}-${i}`}
              >
                {Object.entries(row).map(([k, v]) => (
                  <p className="text-sm" key={k}>
                    <span className="text-slate-500">{labels[k] ?? k}: </span>
                    {display(k, v)}
                  </p>
                ))}
              </article>
            ))}
          </div>
          <nav aria-label="Paginação" className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              Anterior
            </Button>
            <span className="self-center text-sm">Página {page}</span>
            <Button
              variant="outline"
              disabled={page >= Number(data?.totalPages ?? 1)}
              onClick={() => setPage(p => p + 1)}
            >
              Próxima
            </Button>
          </nav>
        </>
      )}
      {exportCsv.error && (
        <p role="alert">Exportação recusada: {exportCsv.error.message}</p>
      )}
    </div>
  );
}
