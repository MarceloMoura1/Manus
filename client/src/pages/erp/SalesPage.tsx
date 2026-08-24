import React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Item = {
  productPublicId: string;
  quantity: string;
  unitPriceCents: number;
};
type Form = {
  publicId?: string;
  crmClientId: string;
  notes: string;
  expectedDate: string;
  items: Item[];
};
const blank = (): Form => ({
  crmClientId: "",
  notes: "",
  expectedDate: "",
  items: [{ productPublicId: "", quantity: "1.000", unitPriceCents: 0 }],
});
const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
export function SalesPage() {
  const fulfillmentKeys = React.useRef(new Map<string, string>()),
    utils = trpc.useUtils(),
    [search, setSearch] = React.useState(""),
    [status, setStatus] = React.useState<
      "all" | "draft" | "confirmed" | "fulfilled" | "cancelled"
    >("all"),
    [page, setPage] = React.useState(1),
    [form, setForm] = React.useState<Form | null>(null),
    [detail, setDetail] = React.useState<string | null>(null),
    [cancellation, setCancellation] = React.useState<{
      publicId: string;
      reason: string;
    } | null>(null),
    [message, setMessage] = React.useState("");
  const list = trpc.erp.sales.list.useQuery({
    search,
    status: status === "all" ? undefined : status,
    sort: "createdAt",
    direction: "desc",
    page,
    pageSize: 20,
  });
  const options = trpc.erp.sales.options.useQuery(
    undefined,
    { enabled: list.data?.canWrite === true }
  );
  const selected = trpc.erp.sales.detail.useQuery(
    { publicId: detail! },
    { enabled: Boolean(detail) }
  );
  const done = async (t: string) => {
    setForm(null);
    setMessage(t);
    await utils.erp.invalidate();
  };
  const create = trpc.erp.sales.create.useMutation({
      onSuccess: () => done("Pedido criado com sucesso."),
    }),
    update = trpc.erp.sales.update.useMutation({
      onSuccess: () => done("Rascunho atualizado com sucesso."),
    }),
    confirmSale = trpc.erp.sales.confirm.useMutation({
      onSuccess: () => done("Pedido confirmado com sucesso."),
    }),
    cancel = trpc.erp.sales.cancel.useMutation({
      onSuccess: () => done("Pedido cancelado com sucesso."),
    }),
    fulfill = trpc.erp.sales.fulfill.useMutation({
      onSuccess: (_result, variables) => {
        fulfillmentKeys.current.delete(variables.publicId);
        done("Venda concluída e estoque atualizado.");
      },
    });
  const canWrite = list.data?.canWrite === true,
    save = (e: React.FormEvent) => {
      e.preventDefault();
      if (!form) return;
      const productIds = form.items.map(item => item.productPublicId).filter(Boolean);
      if (new Set(productIds).size !== productIds.length) {
        setMessage("O mesmo produto não pode aparecer duas vezes no pedido.");
        return;
      }
      const command = {
        crmClientId: form.crmClientId,
        notes: form.notes || undefined,
        expectedDate: form.expectedDate || undefined,
        items: form.items,
      };
      form.publicId
        ? update.mutate({ ...command, publicId: form.publicId })
        : create.mutate(command);
    },
    edit = async (id: string) => {
      const x = await utils.erp.sales.detail.fetch({ publicId: id });
      setForm({
        publicId: x.publicId,
        crmClientId: x.crmClientId,
        notes: x.notes ?? "",
        expectedDate: x.expectedDate ?? "",
        items: x.items.map(i => ({
          productPublicId: i.productPublicId,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
        })),
      });
    };
  return (
    <div className="min-w-0 space-y-5" data-testid="erp-sales-page">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Vendas</h1>
          <p className="text-sm text-slate-600">
            Pedidos, aprovaÃ§Ã£o e conclusão integral.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setForm(blank())}>Novo pedido</Button>
        )}
      </header>
      {message && (
        <p role="status" className="rounded-lg bg-green-50 p-3">
          {message}
        </p>
      )}
      <div className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2">
        <Input
          aria-label="Pesquisar vendas"
          placeholder="NÃºmero ou cliente"
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Filtrar status de venda"
          className="rounded-lg border px-3"
          value={status}
          onChange={e => setStatus(e.target.value as typeof status)}
        >
          <option value="all">Todos</option>
          <option value="draft">Rascunho</option>
          <option value="confirmed">Confirmado</option>
          <option value="fulfilled">Concluído</option>
          <option value="cancelled">Cancelado</option>
        </select>
      </div>
      {list.isLoading ? (
        <State text="Carregando vendasâ€¦" />
      ) : list.error ? (
        <State
          text="NÃ£o foi possÃ­vel carregar vendas."
          retry={() => void list.refetch()}
        />
      ) : !list.data?.items.length ? (
        <State
          text={
            search || status !== "all"
              ? "Nenhum pedido corresponde aos filtros."
              : "Nenhum pedido de venda cadastrado."
          }
        />
      ) : (
        <div className="grid gap-3">
          {list.data.items.map(
            (o: NonNullable<typeof list.data>["items"][number]) => (
              <article
                className="rounded-2xl border bg-white p-4"
                key={o.publicId}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{o.orderNumber}</h2>
                    <p>{o.customerName}</p>
                  </div>
                  <div>
                    <p className="font-bold">
                      {money.format(o.totalCents / 100)}
                    </p>
                    <p>{label(o.status)}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDetail(o.publicId)}
                  >
                    Detalhes
                  </Button>
                  {canWrite && o.status === "draft" && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => void edit(o.publicId)}
                      >
                        Editar
                      </Button>
                      <Button
                        onClick={() =>
                          window.confirm("Confirmar este pedido?") &&
                          confirmSale.mutate({ publicId: o.publicId })
                        }
                      >
                        Confirmar
                      </Button>
                    </>
                  )}
                  {canWrite &&
                    (o.status === "draft" || o.status === "confirmed") && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          setCancellation({ publicId: o.publicId, reason: "" })
                        }
                      >
                        Cancelar
                      </Button>
                    )}
                  {canWrite && o.status === "confirmed" && (
                    <Button
                      onClick={() =>
                        window.confirm(
                          "Concluir venda integralmente e atualizar o estoque?"
                        ) &&
                        fulfill.mutate({
                          publicId: o.publicId,
                          idempotencyKey:
                            fulfillmentKeys.current.get(o.publicId) ??
                            (() => {
                              const key = crypto.randomUUID();
                              fulfillmentKeys.current.set(o.publicId, key);
                              return key;
                            })(),
                        })
                      }
                    >
                      Concluir venda
                    </Button>
                  )}
                </div>
              </article>
            )
          )}
        </div>
      )}
      {list.data && list.data.totalPages > 1 && (
        <nav
          aria-label="PaginaÃ§Ã£o de vendas"
          className="flex justify-end gap-2"
        >
          <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span>
            PÃ¡gina {page} de {list.data.totalPages}
          </span>
          <Button
            disabled={page === list.data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            PrÃ³xima
          </Button>
        </nav>
      )}
      <Dialog
        open={Boolean(form)}
        onOpenChange={open => !open && setForm(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle>
              {form?.publicId ? "Editar pedido" : "Novo pedido"}
            </DialogTitle>
          </DialogHeader>
          {form && (
            <form onSubmit={save} className="space-y-4">
              <label className="block">
                Cliente
                <select
                  required
                  className="w-full rounded-lg border p-2"
                  value={form.crmClientId}
                  onChange={e =>
                    setForm({ ...form, crmClientId: e.target.value })
                  }
                >
                  <option value="">Selecione</option>
                  {options.data?.customers.map(s => (
                    <option key={s.crmClientId} value={s.crmClientId}>
                      {s.customerName}
                    </option>
                  ))}
                </select>
              </label>
              {form.items.map((item, index) => (
                <fieldset
                  key={index}
                  className="grid gap-2 rounded-xl border p-3 sm:grid-cols-3"
                >
                  <legend>Item {index + 1}</legend>
                  <label>
                    Produto
                    <select
                      required
                      className="w-full rounded-lg border p-2"
                      value={item.productPublicId}
                      onChange={e =>
                        setForm({
                          ...form,
                          items: form.items.map((x, i) =>
                            i === index
                              ? { ...x, productPublicId: e.target.value }
                              : x
                          ),
                        })
                      }
                    >
                      <option value="">Selecione</option>
                      {options.data?.products.map(p => (
                        <option
                          key={p.productPublicId}
                          value={p.productPublicId}
                          disabled={form.items.some(
                            (x, i) =>
                              i !== index && x.productPublicId === p.productPublicId
                          )}
                        >
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Quantidade
                    <Input
                      value={item.quantity}
                      onChange={e =>
                        setForm({
                          ...form,
                          items: form.items.map((x, i) =>
                            i === index ? { ...x, quantity: e.target.value } : x
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Preço unitário
                    <Input
                      type="number"
                      min="0"
                      value={item.unitPriceCents}
                      onChange={e =>
                        setForm({
                          ...form,
                          items: form.items.map((x, i) =>
                            i === index
                              ? { ...x, unitPriceCents: Number(e.target.value) }
                              : x
                          ),
                        })
                      }
                    />
                  </label>
                  {form.items.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setForm({
                          ...form,
                          items: form.items.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remover item
                    </Button>
                  )}
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setForm({
                    ...form,
                    items: [
                      ...form.items,
                      {
                        productPublicId: "",
                        quantity: "1.000",
                        unitPriceCents: 0,
                      },
                    ],
                  })
                }
              >
                Adicionar item
              </Button>
              <label className="block">
                Data prevista
                <Input
                  type="date"
                  value={form.expectedDate}
                  onChange={e =>
                    setForm({ ...form, expectedDate: e.target.value })
                  }
                />
              </label>
              <label className="block">
                ObservaÃ§Ãµes
                <textarea
                  className="w-full rounded-lg border p-2"
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <p>
                Total informativo:{" "}
                {money.format(
                  form.items.reduce(
                    (sum, i) =>
                      sum + Math.round(Number(i.quantity) * i.unitPriceCents),
                    0
                  ) / 100
                )}
              </p>
              <Button disabled={create.isPending || update.isPending}>
                Salvar rascunho
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(detail)}
        onOpenChange={open => !open && setDetail(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle>Detalhes do pedido</DialogTitle>
          </DialogHeader>
          {selected.data && (
            <div>
              <p>
                {selected.data.orderNumber} Â· {label(selected.data.status)}
              </p>
              {selected.data.items.map(i => (
                <p key={i.publicId}>
                  {i.sku} Â· {i.quantity} Â·{" "}
                  {money.format(i.lineTotalCents / 100)}
                </p>
              ))}
              <h3 className="mt-3 font-semibold">HistÃ³rico</h3>
              {selected.data.history.map((h, i) => (
                <p key={i}>
                  {h.fromStatus ?? "criado"} â†’ {h.toStatus}
                </p>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(cancellation)}
        onOpenChange={open => !open && setCancellation(null)}
      >
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Cancelar pedido</DialogTitle>
          </DialogHeader>
          {cancellation && (
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                cancel.mutate(cancellation, {
                  onSuccess: () => setCancellation(null),
                });
              }}
            >
              <label className="block text-sm">
                Motivo do cancelamento
                <Input
                  required
                  minLength={3}
                  value={cancellation.reason}
                  onChange={event =>
                    setCancellation({
                      ...cancellation,
                      reason: event.target.value,
                    })
                  }
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCancellation(null)}
                >
                  Voltar
                </Button>
                <Button
                  type="submit"
                  disabled={
                    cancel.isPending || cancellation.reason.trim().length < 3
                  }
                >
                  Confirmar cancelamento
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function State({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div role="status" className="rounded-2xl border bg-white p-8 text-center">
      <p>{text}</p>
      {retry && <Button onClick={retry}>Tentar novamente</Button>}
    </div>
  );
}
function label(s: string) {
  return (
    (
      {
        draft: "Rascunho",
        confirmed: "Confirmado",
        fulfilled: "Concluído",
        cancelled: "Cancelado",
      } as Record<string, string>
    )[s] ?? s
  );
}
