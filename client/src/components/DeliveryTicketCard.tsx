import React, { useEffect, useState } from "react";
import {
  Bike,
  Check,
  Copy,
  ExternalLink,
  Home as HomeIcon,
  Building,
  MapPin,
  Package,
  Play,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DeliveryMenuItemsPicker,
  computeDeliveryTotals,
  type SelectedDeliveryItem,
} from "@/components/DeliveryMenuItemsPicker";

const RESTAURANT_STAGES = [
  "Novo Pedido",
  "Em Preparo",
  "Pronto p/ Motoboy",
  "Em Rota com Motoboy",
  "Entregue",
] as const;

type RestaurantStage = (typeof RESTAURANT_STAGES)[number];

const ADDRESS_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  casa: { label: "Casa", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  apartamento: { label: "Apartamento", color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  comercial: { label: "Comercial", color: "bg-amber-50 text-amber-700 border-amber-200" },
  outro: { label: "Outro", color: "bg-slate-100 text-slate-700 border-slate-200" },
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

export function DeliveryTicketCard({
  ticketId,
  customerName,
  customerPhone,
  isAdmin,
  onStatusChanged,
}: {
  ticketId: string;
  customerName: string;
  customerPhone: string;
  isAdmin: boolean;
  onStatusChanged?: () => void;
}) {
  const utils = trpc.useUtils();
  const orderQuery = trpc.delivery.getByTicket.useQuery(
    { ticketId },
    { enabled: Boolean(ticketId), refetchOnWindowFocus: false }
  );
  const motoboysQuery = trpc.delivery.listMotoboys.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const order = orderQuery.data?.order ?? null;
  const motoboys = motoboysQuery.data?.motoboys ?? [];
  const allUsers = motoboysQuery.data?.allUsers ?? [];

  const [selectedMotoboy, setSelectedMotoboy] = useState<string>("");
  const [routeSequence, setRouteSequence] = useState<string>("1");
  const [deliveryFeeInput, setDeliveryFeeInput] = useState<string>("0");
  const [copiedLink, setCopiedLink] = useState(false);

  // Formulário para vincular delivery em ticket manual ainda sem pedido de entrega
  const [selectedItems, setSelectedItems] = useState<SelectedDeliveryItem[]>([]);
  const [draft, setDraft] = useState({
    deliveryFee: "0",
    paymentMethod: "Pix",
    deliveryAddress: "",
    addressType: "casa" as "casa" | "apartamento" | "comercial" | "outro",
    addressComplement: "",
  });

  useEffect(() => {
    if (order) {
      setSelectedMotoboy(order.motoboyUserId ?? "");
      setRouteSequence(String(order.routeSequence ?? 1));
      setDeliveryFeeInput(String(order.deliveryFee ?? 0));
    }
  }, [order]);

  const upsertMutation = trpc.delivery.upsertForTicket.useMutation({
    onSuccess: async () => {
      toast.success("Dados da entrega vinculados ao ticket!");
      await utils.delivery.getByTicket.invalidate({ ticketId });
      onStatusChanged?.();
    },
    onError: (err) => toast.error(err.message || "Não foi possível salvar os dados de entrega."),
  });

  const assignMutation = trpc.delivery.assignMotoboy.useMutation({
    onSuccess: async () => {
      toast.success("Motoboy e ordem da fila atualizados!");
      await utils.delivery.getByTicket.invalidate({ ticketId });
      onStatusChanged?.();
    },
    onError: (err) => toast.error(err.message || "Falha ao atribuir motoboy."),
  });

  const stageMutation = trpc.delivery.updateStage.useMutation({
    onSuccess: async () => {
      toast.success("Status do pedido atualizado!");
      await utils.delivery.getByTicket.invalidate({ ticketId });
      onStatusChanged?.();
    },
    onError: (err) => toast.error(err.message || "Falha ao atualizar etapa."),
  });

  const startRouteMutation = trpc.delivery.startRoute.useMutation({
    onSuccess: async (res) => {
      if (res.whatsappSent) {
        toast.success("Rota iniciada! Mensagem com link e código enviada no WhatsApp do cliente.");
      } else {
        toast.warning(
          `Rota iniciada (Em Rota com Motoboy), mas o disparo WhatsApp não concluiu: ${res.whatsappError || "verifique a conexão WhatsApp"}`
        );
      }
      await utils.delivery.getByTicket.invalidate({ ticketId });
      onStatusChanged?.();
    },
    onError: (err) => toast.error(err.message || "Não foi possível iniciar a rota."),
  });

  const toggleTagMutation = trpc.delivery.toggleMotoboyTag.useMutation({
    onSuccess: async () => {
      toast.success("Perfil de motoboy atualizado na equipe!");
      await utils.delivery.listMotoboys.invalidate();
    },
    onError: (err) => toast.error(err.message || "Não foi possível atualizar a tag de motoboy."),
  });

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      toast.success("Link de acompanhamento copiado!");
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  };

  if (orderQuery.isLoading) {
    return (
      <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:mx-6 lg:mx-8">
        <p className="text-sm text-slate-500">Carregando dados da entrega e motoboy...</p>
      </section>
    );
  }

  if (!order) {
    const pickerTotals = computeDeliveryTotals(selectedItems, Number(draft.deliveryFee || 0));
    return (
      <section
        data-testid="delivery-ticket-card-empty"
        className="mx-4 mt-4 rounded-xl border border-amber-200 bg-white p-5 shadow-sm sm:mx-6 lg:mx-8 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Bike className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Dados da Entrega &amp; Motoboy</h3>
              <p className="text-xs text-slate-500">
                Selecione os produtos do cardápio (ERP &gt; Produtos) e informe o endereço para gerar o código de 4 dígitos, o link de rastreio e a venda no ERP.
              </p>
            </div>
          </div>
        </div>

        <DeliveryMenuItemsPicker
          items={selectedItems}
          onChange={setSelectedItems}
          deliveryFee={draft.deliveryFee}
          onDeliveryFeeChange={(nextFee) => setDraft((d) => ({ ...d, deliveryFee: nextFee }))}
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Forma de pagamento</label>
            <input
              type="text"
              value={draft.paymentMethod}
              onChange={(e) => setDraft((d) => ({ ...d, paymentMethod: e.target.value }))}
              placeholder="Pix, Cartão na entrega, Pago online, Dinheiro/Troco"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo de endereço</label>
            <select
              value={draft.addressType}
              onChange={(e) => setDraft((d) => ({ ...d, addressType: e.target.value as any }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value="casa">Casa</option>
              <option value="apartamento">Apartamento</option>
              <option value="comercial">Comercial</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Endereço completo</label>
            <input
              type="text"
              value={draft.deliveryAddress}
              onChange={(e) => setDraft((d) => ({ ...d, deliveryAddress: e.target.value }))}
              placeholder="Rua, número, bairro, cidade"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Complemento / Referência (bloco, apto, portão)</label>
            <input
              type="text"
              value={draft.addressComplement}
              onChange={(e) => setDraft((d) => ({ ...d, addressComplement: e.target.value }))}
              placeholder="Ex: Bloco B, Apto 302, interfone 32"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
        </div>

        <Button
          type="button"
          disabled={
            upsertMutation.isPending ||
            draft.deliveryAddress.trim().length < 3 ||
            selectedItems.length === 0
          }
          onClick={() =>
            upsertMutation.mutate({
              ticketId,
              orderSource: "manual",
              items: selectedItems,
              itemsSummary: pickerTotals.summary,
              orderTotal: pickerTotals.orderTotal,
              deliveryFee: pickerTotals.deliveryFee,
              paymentMethod: draft.paymentMethod || "A combinar",
              customerName: customerName || "Cliente",
              customerPhone: customerPhone || "0000000000",
              deliveryAddress: draft.deliveryAddress.trim(),
              addressType: draft.addressType,
              addressComplement: draft.addressComplement.trim() || null,
            })
          }
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
        >
          {upsertMutation.isPending
            ? "Salvando..."
            : `Gerar Pedido de Delivery (${formatCurrency(pickerTotals.orderTotal)}) + Venda ERP`}
        </Button>
      </section>
    );
  }

  const addrBadge = ADDRESS_TYPE_LABELS[order.addressType] ?? ADDRESS_TYPE_LABELS.outro;

  return (
    <section
      data-testid="delivery-ticket-card"
      className="mx-4 mt-4 rounded-xl border border-emerald-200 bg-white p-5 shadow-sm sm:mx-6 lg:mx-8 space-y-5"
    >
      {/* Cabeçalho + Etapa do Restaurante */}
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Bike className="h-5 w-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">Dados da Entrega &amp; Motoboy</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-slate-600">
                Origem: {order.orderSource}
              </span>
              <span className="rounded-full bg-sky-50 border border-sky-200 px-2.5 py-0.5 text-xs font-bold text-sky-700">
                {order.stageLabel}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Gerencie a preparação, atribua o motoboy e inicie a rota com disparo automático no WhatsApp.
            </p>
          </div>
        </div>

        <Button
          type="button"
          data-testid="start-delivery-route-btn"
          disabled={
            startRouteMutation.isPending ||
            order.deliveryStatus === "delivered" ||
            order.deliveryStatus === "canceled"
          }
          onClick={() => startRouteMutation.mutate({ ticketId })}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 px-4 gap-1.5 cursor-pointer"
        >
          <Play className="h-3.5 w-3.5" />
          {startRouteMutation.isPending
            ? "Iniciando rota..."
            : order.deliveryStatus === "in_route"
              ? "Reenviar Link / Em Rota"
              : "Iniciar Rota (WhatsApp)"}
        </Button>
      </div>

      {/* Etapas rápidas de status de Restaurante */}
      <div className="flex flex-wrap items-center gap-1.5">
        {RESTAURANT_STAGES.map((stage) => {
          const isActive = order.stageLabel === stage;
          return (
            <button
              key={stage}
              type="button"
              disabled={stageMutation.isPending}
              onClick={() => stageMutation.mutate({ ticketId, stageLabel: stage as RestaurantStage })}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                isActive
                  ? "border-emerald-600 bg-emerald-600 text-white shadow-xs"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"
              }`}
            >
              {stage}
            </button>
          );
        })}
      </div>

      {/* Grid: Resumo do Pedido + Endereço + Código/Link */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 1. Pedido e Valores */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 text-slate-400" />
              Pedido &amp; Pagamento
            </p>
            {order.erpSalePublicId && (
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                ERP &gt; Vendas ✓
              </span>
            )}
          </div>
          {order.items && order.items.length > 0 ? (
            <ul className="space-y-1 text-xs text-slate-800">
              {order.items.map((it, idx) => (
                <li key={`${it.productPublicId || it.name}-${idx}`} className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    <strong>{it.quantity}x</strong> {it.name}
                  </span>
                  <span className="shrink-0 font-semibold text-slate-600">
                    {formatCurrency(it.subtotal)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-800 whitespace-pre-wrap">
              {order.itemsSummary || "Sem itens detalhados."}
            </p>
          )}
          <div className="pt-2 border-t border-slate-200/80 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500 block">Total do Pedido</span>
              <strong className="text-slate-900 text-sm">{formatCurrency(order.orderTotal)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Taxa da Rota</span>
              <strong className="text-emerald-700 text-sm">{formatCurrency(order.deliveryFee)}</strong>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500 block">Pagamento</span>
              <strong className="text-slate-800">{order.paymentMethod}</strong>
            </div>
          </div>
        </div>

        {/* 2. Endereço com destaque Casa/Apto + Complemento */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-rose-500" />
              Endereço de Entrega
            </p>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${addrBadge.color}`}
            >
              {order.addressType === "apartamento" ? (
                <Building className="h-3 w-3" />
              ) : (
                <HomeIcon className="h-3 w-3" />
              )}
              {addrBadge.label}
            </span>
          </div>
          <p className="text-sm font-semibold text-slate-900">{order.deliveryAddress}</p>
          {order.addressComplement && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900">
              <span className="font-bold block text-[11px] uppercase text-indigo-700">
                Complemento / Referência
              </span>
              {order.addressComplement}
            </div>
          )}
        </div>

        {/* 3. Código 4 Dígitos & Link Temporário */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Código &amp; Rastreio Temporário
          </p>
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-white px-3 py-2">
            <span className="text-xs text-slate-500">Código de confirmação</span>
            <span
              data-testid="delivery-code-value"
              className="font-mono text-2xl font-extrabold tracking-widest text-emerald-700"
            >
              {order.deliveryCode}
            </span>
          </div>
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-slate-600 block">Link temporário do cliente</span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly
                value={order.trackingUrl}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-700"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleCopyLink(order.trackingUrl)}
                className="h-8 px-2.5 text-xs cursor-pointer"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              <a
                href={order.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 text-slate-600 hover:text-slate-900"
                title="Abrir link de rastreio"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Atribuição de Motoboy e Fila */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-700">
            Atribuição de Motoboy &amp; Ordem na Fila
          </p>
          {motoboys.length === 0 && isAdmin && allUsers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-amber-700">
              <span>Nenhum usuário marcado como motoboy ainda:</span>
              {allUsers.slice(0, 4).map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  disabled={toggleTagMutation.isPending}
                  onClick={() => toggleTagMutation.mutate({ userId: u.userId, enabled: true })}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer"
                >
                  <UserPlus className="h-3 w-3" />
                  Marcar {u.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Motoboy responsável</label>
            <select
              value={selectedMotoboy}
              onChange={(e) => setSelectedMotoboy(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
            >
              <option value="">Sem motoboy atribuído</option>
              {motoboys.map((m) => (
                <option key={m.userId} value={m.userId}>
                  🛵 {m.name} ({m.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ordem na fila</label>
            <input
              type="number"
              min="1"
              value={routeSequence}
              onChange={(e) => setRouteSequence(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Taxa da rota (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={deliveryFeeInput}
              onChange={(e) => setDeliveryFeeInput(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={assignMutation.isPending}
            onClick={() =>
              assignMutation.mutate({
                ticketId,
                motoboyUserId: selectedMotoboy || null,
                routeSequence: Math.max(1, Number(routeSequence || 1)),
                deliveryFee: Math.max(0, Number(deliveryFeeInput || 0)),
              })
            }
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
          >
            {assignMutation.isPending ? "Salvando..." : "Salvar Atribuição de Motoboy"}
          </Button>
        </div>
      </div>
    </section>
  );
}

