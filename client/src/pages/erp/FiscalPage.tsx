import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErpPageHeader } from "@/components/erp/ErpPageHeader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
const money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }),
  today = () => new Date().toISOString().slice(0, 10);
function State({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div role="status" className="rounded-2xl border bg-white p-8 text-center">
      <AlertCircle className="mx-auto h-6 w-6" />
      <p className="mt-2">{text}</p>
      {retry && (
        <Button variant="outline" className="mt-3" onClick={retry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
export function FiscalPage() {
  const utils = trpc.useUtils(),
    [tab, setTab] = React.useState<
      "summary" | "settings" | "products" | "documents"
    >("summary"),
    summary = trpc.erp.fiscal.summary.useQuery(),
    settings = trpc.erp.fiscal.settings.get.useQuery(),
    [page, setPage] = React.useState(1),
    [search, setSearch] = React.useState(""),
    [type, setType] = React.useState<
      "sale" | "purchase" | "manual" | undefined
    >(),
    [status, setStatus] = React.useState<
      "draft" | "ready_for_integration" | "cancelled" | undefined
    >(),
    [source, setSource] = React.useState<
      "with_source" | "manual" | undefined
    >(),
    [from, setFrom] = React.useState(""),
    [to, setTo] = React.useState(""),
    [sort, setSort] = React.useState<
      "issueDate" | "createdAt" | "number" | "total"
    >("issueDate"),
    [direction, setDirection] = React.useState<"asc" | "desc">("desc"),
    documents = trpc.erp.fiscal.documents.list.useQuery(
      {
        search,
        type,
        status,
        source,
        from: from || undefined,
        to: to || undefined,
        sort,
        direction,
        page,
        pageSize: 20,
      },
      { enabled: tab === "documents", retry: false }
    ),
    products = trpc.erp.fiscal.products.list.useQuery(
      { search: "", incomplete: true, page: 1, pageSize: 20 },
      { enabled: tab === "products" }
    ),
    [dialog, setDialog] = React.useState<
      "settings" | "source" | "manual" | null
    >(null),
    [selected, setSelected] = React.useState<any>(null),
    dialogTrigger = React.useRef<HTMLButtonElement | null>(null),
    detailTrigger = React.useRef<HTMLElement | null>(null);
  const refresh = () => utils.erp.fiscal.invalidate();
  const closeDialog = () => {
      setDialog(null);
      requestAnimationFrame(() => dialogTrigger.current?.focus());
    },
    closeDetail = () => {
      setSelected(null);
      requestAnimationFrame(() => detailTrigger.current?.focus());
    };
  if (summary.isLoading) return <State text="Carregando módulo Fiscal…" />;
  if (summary.error)
    return (
      <State
        text="Não foi possível carregar o Fiscal."
        retry={() => void summary.refetch()}
      />
    );
  const canWrite = summary.data?.canWrite === true;
  return (
    <div data-testid="erp-fiscal-page" className="min-w-0 space-y-5">
      <ErpPageHeader title="Fiscal" />
      <div
        role="alert"
        className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm"
      >
        <strong>Emissão fiscal eletrônica ainda não configurada.</strong>
        <p className="text-sm">
          Estes registros não são notas fiscais autorizadas e não possuem
          validade fiscal.
        </p>
      </div>
      <nav aria-label="Seções fiscais" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2 shadow-sm">
        {[
          ["summary", "Resumo fiscal"],
          ["settings", "Configuração fiscal"],
          ["products", "Produtos incompletos"],
          ["documents", "Documentos internos"],
        ].map(([id, label]) => (
          <Button
            key={id}
            className="rounded-xl"
            variant={tab === id ? "default" : "outline"}
            onClick={() => setTab(id as typeof tab)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === "summary" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Documentos", summary.data?.documents],
            ["Rascunhos", summary.data?.drafts],
            ["Preparados para integração", summary.data?.ready],
            ["Produtos incompletos", summary.data?.incompleteProducts],
          ].map(([label, value]) => (
            <article
              key={String(label)}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-sm text-slate-500">{label}</p>
              <strong className="text-2xl">{Number(value ?? 0)}</strong>
            </article>
          ))}
        </div>
      )}
      {tab === "settings" && (
        <section className="rounded-2xl border bg-white p-5">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <h2 className="font-bold">Perfil fiscal da empresa</h2>
              <p className="text-sm text-slate-600">
                Status: {(settings.data as any)?.status ?? "incomplete"}.
                “Preparado” significa apenas cadastro mínimo para integração
                futura.
              </p>
            </div>
            {canWrite && (
              <Button
                onClick={event => {
                  dialogTrigger.current = event.currentTarget;
                  setDialog("settings");
                }}
              >
                {settings.data ? "Editar configuração" : "Configurar"}
              </Button>
            )}
          </div>
          {!settings.data && (
            <p className="mt-5 text-sm">Configuração fiscal incompleta.</p>
          )}
        </section>
      )}
      {tab === "products" &&
        (products.isLoading ? (
          <State text="Carregando produtos…" />
        ) : products.error ? (
          <State
            text="Erro ao carregar produtos."
            retry={() => void products.refetch()}
          />
        ) : !products.data?.items.length ? (
          <State text="Nenhum produto com cadastro fiscal incompleto." />
        ) : (
          <div className="grid gap-3">
            {products.data.items.map((p: any) => (
              <article
                key={p.productPublicId}
                className="rounded-xl border bg-white p-4"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <strong>{p.name}</strong>
                    <p className="text-sm text-slate-500">
                      {p.sku} · NCM {p.ncm || "não informado"}
                    </p>
                  </div>
                  {canWrite && <ProductEdit product={p} done={refresh} />}
                </div>
              </article>
            ))}
          </div>
        ))}
      {tab === "documents" && (
        <>
          <div className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
            <Input
              aria-label="Número interno ou contraparte"
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <select
              aria-label="Tipo"
              value={type ?? ""}
              onChange={e => {
                setType((e.target.value || undefined) as typeof type);
                setPage(1);
              }}
            >
              <option value="">Todos os tipos</option>
              <option value="sale">Venda</option>
              <option value="purchase">Compra</option>
              <option value="manual">Manual</option>
            </select>
            <select
              aria-label="Origem"
              value={source ?? ""}
              onChange={e => {
                setSource((e.target.value || undefined) as typeof source);
                setPage(1);
              }}
            >
              <option value="">Todas as origens</option>
              <option value="with_source">Compra ou venda</option>
              <option value="manual">Manual</option>
            </select>
            <Input
              aria-label="Data inicial"
              type="date"
              value={from}
              onChange={e => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
            <Input
              aria-label="Data final"
              type="date"
              value={to}
              onChange={e => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
            <select
              aria-label="Ordenar por"
              value={sort}
              onChange={e => {
                setSort(e.target.value as typeof sort);
                setPage(1);
              }}
            >
              <option value="issueDate">Data</option>
              <option value="number">Número</option>
              <option value="createdAt">Criação</option>
              <option value="total">Total</option>
            </select>
            <select
              aria-label="Direção"
              value={direction}
              onChange={e => {
                setDirection(e.target.value as typeof direction);
                setPage(1);
              }}
            >
              <option value="desc">Decrescente</option>
              <option value="asc">Crescente</option>
            </select>
            <select
              aria-label="Estado"
              value={status ?? ""}
              onChange={e => {
                setStatus((e.target.value || undefined) as typeof status);
                setPage(1);
              }}
            >
              <option value="">Todos os estados</option>
              <option value="draft">Rascunho</option>
              <option value="ready_for_integration">
                Preparado para integração
              </option>
              <option value="cancelled">Cancelado</option>
            </select>
            {canWrite && (
              <div className="flex gap-2">
                <Button
                  onClick={event => {
                    dialogTrigger.current = event.currentTarget;
                    setDialog("source");
                  }}
                >
                  Da origem
                </Button>
                <Button
                  variant="outline"
                  onClick={event => {
                    dialogTrigger.current = event.currentTarget;
                    setDialog("manual");
                  }}
                >
                  Manual
                </Button>
              </div>
            )}
          </div>
          {documents.isLoading ? (
            <State text="Carregando documentos…" />
          ) : documents.error ? (
            <State
              text="Erro ao carregar documentos."
              retry={() => void documents.refetch()}
            />
          ) : !documents.data?.items.length ? (
            <State
              text={
                search || type || status || source || from || to
                  ? "Nenhum documento corresponde aos filtros."
                  : "Nenhum documento fiscal interno."
              }
            />
          ) : (
            <>
              <div className="grid gap-3 lg:hidden">
                {documents.data.items.map((d: any) => (
                  <button
                    className="rounded-xl border bg-white p-4 text-left"
                    key={d.publicId}
                    onClick={event => {
                      detailTrigger.current = event.currentTarget;
                      setSelected(d);
                    }}
                  >
                    <strong>{d.internalNumber}</strong>
                    <span className="block">
                      {d.partyName} · {money.format(d.totalCents / 100)}
                    </span>
                  </button>
                ))}
              </div>
              <div className="hidden overflow-x-auto rounded-2xl border bg-white lg:block">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr>
                      <th className="p-3 text-left">Número interno</th>
                      <th>Tipo</th>
                      <th>Contraparte</th>
                      <th>Data</th>
                      <th>Estado</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.data.items.map((d: any) => (
                      <tr
                        tabIndex={0}
                        className="cursor-pointer border-t"
                        key={d.publicId}
                        onClick={event => {
                          detailTrigger.current = event.currentTarget;
                          setSelected(d);
                        }}
                        onKeyDown={event => {
                          if (event.key === "Enter") {
                            detailTrigger.current = event.currentTarget;
                            setSelected(d);
                          }
                        }}
                      >
                        <td className="p-3">{d.internalNumber}</td>
                        <td>{d.type}</td>
                        <td>{d.partyName}</td>
                        <td>{d.internalIssueDate}</td>
                        <td>{d.status}</td>
                        <td>{money.format(d.totalCents / 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </Button>
                <span>
                  Página {page} de {documents.data.totalPages}
                </span>
                <Button
                  variant="outline"
                  disabled={page >= documents.data.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Próxima
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {dialog === "settings" && (
        <SettingsDialog
          current={settings.data}
          close={closeDialog}
          done={refresh}
        />
      )}{" "}
      {(dialog === "source" || dialog === "manual") && (
        <CreateDocument mode={dialog} close={closeDialog} done={refresh} />
      )}{" "}
      {selected && (
        <Detail
          id={selected.publicId}
          canWrite={canWrite}
          close={closeDetail}
          done={refresh}
        />
      )}
    </div>
  );
}
function SettingsDialog({
  current,
  close,
  done,
}: {
  current: any;
  close: () => void;
  done: () => void;
}) {
  const [f, setF] = React.useState<any>({
      taxRegime: current?.taxRegime ?? "simples_nacional",
      taxpayerIndicator: current?.taxpayerIndicator ?? "non_taxpayer",
      stateRegistration: current?.stateRegistration ?? "",
      municipalRegistration: current?.municipalRegistration ?? "",
      mainCnae: current?.mainCnae ?? "",
      ibgeCityCode: current?.ibgeCityCode ?? "",
      environment: current?.environment ?? "homologation",
      provider: "none",
    }),
    save = trpc.erp.fiscal.settings.save.useMutation({
      onSuccess: () => {
        done();
        close();
      },
    });
  return (
    <Dialog open onOpenChange={x => !x && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configuração fiscal</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={e => {
            e.preventDefault();
            save.mutate({
              ...f,
              stateRegistration: f.stateRegistration || null,
              municipalRegistration: f.municipalRegistration || null,
              mainCnae: f.mainCnae || null,
              ibgeCityCode: f.ibgeCityCode || null,
            });
          }}
        >
          <label>
            Regime tributário
            <select
              value={f.taxRegime}
              onChange={e => setF({ ...f, taxRegime: e.target.value })}
            >
              {[
                "mei",
                "simples_nacional",
                "lucro_presumido",
                "lucro_real",
                "other",
              ].map(x => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Indicador de contribuinte
            <select
              value={f.taxpayerIndicator}
              onChange={e => setF({ ...f, taxpayerIndicator: e.target.value })}
            >
              {["taxpayer", "exempt", "non_taxpayer"].map(x => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {[
            ["Inscrição estadual", "stateRegistration"],
            ["Inscrição municipal", "municipalRegistration"],
            ["CNAE principal", "mainCnae"],
            ["Município IBGE", "ibgeCityCode"],
          ].map(([l, k]) => (
            <label key={k}>
              {l}
              <Input
                value={f[k]}
                onChange={e => setF({ ...f, [k]: e.target.value })}
              />
            </label>
          ))}
          <label>
            Ambiente
            <select
              value={f.environment}
              onChange={e => setF({ ...f, environment: e.target.value })}
            >
              <option value="homologation">Homologação</option>
              <option value="production">
                Produção (somente configuração)
              </option>
            </select>
          </label>
          <Button type="submit">Salvar configuração</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function ProductEdit({ product, done }: { product: any; done: () => void }) {
  const [open, setOpen] = React.useState(false),
    trigger = React.useRef<HTMLButtonElement | null>(null),
    [f, setF] = React.useState<any>(product),
    save = trpc.erp.fiscal.products.save.useMutation({
      onSuccess: () => {
        done();
        setOpen(false);
        requestAnimationFrame(() => trigger.current?.focus());
      },
    });
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <>
      <Button ref={trigger} variant="outline" onClick={() => setOpen(true)}>
        Editar perfil fiscal
      </Button>
      {open && (
        <Dialog open onOpenChange={changeOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Perfil fiscal · {product.name}</DialogTitle>
            </DialogHeader>
            <form
              className="grid gap-3"
              onSubmit={e => {
                e.preventDefault();
                save.mutate({
                  productPublicId: product.productPublicId,
                  ncm: f.ncm || null,
                  cest: f.cest || null,
                  defaultOutboundCfop: f.defaultOutboundCfop || null,
                  defaultInboundCfop: f.defaultInboundCfop || null,
                  goodsOrigin: f.goodsOrigin || null,
                  fiscalUnit: f.fiscalUnit || "UN",
                  gtin: f.gtin || null,
                  serviceCode: f.serviceCode || null,
                  operationNature: f.operationNature || null,
                  internalNotes: f.internalNotes || null,
                });
              }}
            >
              {[
                ["NCM", "ncm"],
                ["CEST", "cest"],
                ["CFOP saída", "defaultOutboundCfop"],
                ["CFOP entrada", "defaultInboundCfop"],
                ["Origem da mercadoria", "goodsOrigin"],
                ["Unidade fiscal", "fiscalUnit"],
                ["GTIN/EAN", "gtin"],
                ["Código de serviço", "serviceCode"],
                ["Natureza da operação", "operationNature"],
                ["Observações fiscais internas", "internalNotes"],
              ].map(([l, k]) => (
                <label key={k}>
                  {l}
                  <Input
                    value={f[k] ?? ""}
                    onChange={e => setF({ ...f, [k]: e.target.value })}
                  />
                </label>
              ))}
              <Button type="submit">Salvar perfil</Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
function CreateDocument({
  mode,
  close,
  done,
}: {
  mode: "source" | "manual";
  close: () => void;
  done: () => void;
}) {
  const [f, setF] = React.useState<any>({
      type: "sale",
      internalIssueDate: today(),
      quantity: "1",
      unitAmount: "0,00",
    }),
    idempotencyKey = React.useState(() => crypto.randomUUID())[0],
    source = trpc.erp.fiscal.documents.createSource.useMutation({
      onSuccess: () => {
        done();
        close();
      },
    }),
    manual = trpc.erp.fiscal.documents.createManual.useMutation({
      onSuccess: () => {
        done();
        close();
      },
    });
  return (
    <Dialog open onOpenChange={x => !x && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "source"
              ? "Documento interno por origem"
              : "Documento interno manual"}
          </DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={e => {
            e.preventDefault();
            if (mode === "source")
              source.mutate({
                type: f.type,
                sourcePublicId: f.sourcePublicId,
                internalIssueDate: f.internalIssueDate,
                internalNotes: f.internalNotes || null,
                idempotencyKey,
              });
            else
              manual.mutate({
                internalIssueDate: f.internalIssueDate,
                partyName: f.partyName,
                partyDocument: f.partyDocument || null,
                internalNotes: f.internalNotes || null,
                idempotencyKey,
                items: [
                  {
                    productPublicId: null,
                    name: f.itemName,
                    sku: f.sku || null,
                    quantityMillis: Math.round(
                      Number(f.quantity.replace(",", ".")) * 1000
                    ),
                    unitAmountCents: Math.round(
                      Number(f.unitAmount.replace(".", "").replace(",", ".")) *
                        100
                    ),
                  },
                ],
              });
          }}
        >
          {mode === "source" && (
            <>
              <label>
                Origem
                <select
                  value={f.type}
                  onChange={e => setF({ ...f, type: e.target.value })}
                >
                  <option value="sale">Venda fulfilled</option>
                  <option value="purchase">Compra received</option>
                </select>
              </label>
              <label>
                ID público da origem
                <Input
                  required
                  value={f.sourcePublicId ?? ""}
                  onChange={e => setF({ ...f, sourcePublicId: e.target.value })}
                />
              </label>
            </>
          )}
          {mode === "manual" && (
            <>
              {[
                ["Contraparte", "partyName"],
                ["Documento da contraparte", "partyDocument"],
                ["Item", "itemName"],
                ["SKU", "sku"],
                ["Quantidade", "quantity"],
                ["Valor unitário", "unitAmount"],
              ].map(([l, k]) => (
                <label key={k}>
                  {l}
                  <Input
                    required={[
                      "partyName",
                      "itemName",
                      "quantity",
                      "unitAmount",
                    ].includes(k)}
                    value={f[k] ?? ""}
                    onChange={e => setF({ ...f, [k]: e.target.value })}
                  />
                </label>
              ))}
            </>
          )}
          <label>
            Data interna
            <Input
              type="date"
              value={f.internalIssueDate}
              onChange={e => setF({ ...f, internalIssueDate: e.target.value })}
            />
          </label>
          <label>
            Observações internas
            <Input
              value={f.internalNotes ?? ""}
              onChange={e => setF({ ...f, internalNotes: e.target.value })}
            />
          </label>
          <Button type="submit">Criar documento interno</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function Detail({
  id,
  canWrite,
  close,
  done,
}: {
  id: string;
  canWrite: boolean;
  close: () => void;
  done: () => void;
}) {
  const readyIdempotencyKey = React.useState(() => crypto.randomUUID())[0],
    q = trpc.erp.fiscal.documents.detail.useQuery({ publicId: id }),
    ready = trpc.erp.fiscal.documents.ready.useMutation({
      onSuccess: () => {
        done();
        close();
      },
    }),
    cancel = trpc.erp.fiscal.documents.cancel.useMutation({
      onSuccess: () => {
        done();
        close();
      },
    });
  return (
    <Dialog open onOpenChange={x => !x && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {q.data?.internalNumber ?? "Documento interno"}
          </DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <State text="Carregando detalhe…" />
        ) : q.error ? (
          <State
            text="Erro ao carregar detalhe."
            retry={() => void q.refetch()}
          />
        ) : (
          q.data && (
            <div className="space-y-4">
              <p>
                {q.data.partyName} · {money.format(q.data.totalCents / 100)}
              </p>
              <ul>
                {q.data.items.map((x: any) => (
                  <li key={x.publicId}>
                    {x.name} · {x.quantityMillis / 1000} ·{" "}
                    {money.format(x.lineTotalCents / 100)}
                  </li>
                ))}
              </ul>
              <section>
                <h3 className="font-bold">Histórico</h3>
                {q.data.history.map((x: any, i: number) => (
                  <p key={i}>
                    {x.toStatus} · {x.createdAt}
                  </p>
                ))}
              </section>
              {canWrite && q.data.status === "draft" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      ready.mutate({
                        publicId: id,
                        idempotencyKey: readyIdempotencyKey,
                      })
                    }
                  >
                    Preparar para integração
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      const reason = window.prompt("Motivo do cancelamento");
                      if (reason) cancel.mutate({ publicId: id, reason });
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
