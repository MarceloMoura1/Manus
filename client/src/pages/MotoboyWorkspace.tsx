import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bike,
  Building,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Home as HomeIcon,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export type MotoboyView = "deliveries" | "earnings";
type HistoryPeriod = "today" | "week" | "month" | "custom";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

function isAlreadyPaid(paymentMethod: string): boolean {
  const normalized = paymentMethod
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    normalized.includes("pago") ||
    normalized.includes("online") ||
    normalized.includes("quitado")
  );
}

function buildWazeUrl(address: string, lat?: number | null, lng?: number | null): string {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

function buildGoogleMapsUrl(address: string, lat?: number | null, lng?: number | null): string {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

function buildWhatsAppLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return `https://wa.me/${normalized}`;
}

const ADDRESS_TYPE_META: Record<string, { label: string; badgeClass: string }> = {
  casa: { label: "CASA", badgeClass: "bg-emerald-600 text-white" },
  apartamento: { label: "APARTAMENTO", badgeClass: "bg-indigo-600 text-white" },
  comercial: { label: "COMERCIAL", badgeClass: "bg-amber-600 text-white" },
  outro: { label: "OUTRO", badgeClass: "bg-slate-700 text-white" },
};

export function MotoboyWorkspace({
  activeView,
  onSwitchView,
  userName,
  companyName,
}: {
  activeView: MotoboyView;
  onSwitchView: (view: MotoboyView) => void;
  userName?: string;
  companyName?: string;
}) {
  const utils = trpc.useUtils();
  const [period, setPeriod] = useState<HistoryPeriod>("today");
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [customStart, setCustomStart] = useState<string>(todayIso);
  const [customEnd, setCustomEnd] = useState<string>(todayIso);
  const [codeByTicket, setCodeByTicket] = useState<Record<string, string>>({});

  // Estado de telemetria GPS ao vivo
  const [gpsStatus, setGpsStatus] = useState<"idle" | "active" | "error">("idle");
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);
  const [lastGpsSentAt, setLastGpsSentAt] = useState<number | null>(null);
  const [secondsSinceGps, setSecondsSinceGps] = useState<number>(0);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const lastEmitRef = useRef<number>(0);
  const wakeLockSentinelRef = useRef<any>(null);

  const queueQuery = trpc.delivery.myQueue.useQuery(undefined, {
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const historyQuery = trpc.delivery.myHistory.useQuery(
    {
      period,
      ...(period === "custom" ? { startDate: customStart, endDate: customEnd } : {}),
    },
    {
      enabled: activeView === "earnings",
      refetchOnWindowFocus: false,
    }
  );

  const updateLocationMutation = trpc.delivery.updateMotoboyLocation.useMutation();
  const acceptOrderMutation = trpc.delivery.acceptOrder.useMutation({
    onSuccess: async () => {
      toast.success("Corrida aceita! Status atualizado automaticamente para Pronto p/ Motoboy.");
      await utils.delivery.myQueue.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Não foi possível aceitar a corrida.");
    },
  });

  const startRouteMutation = trpc.delivery.startRoute.useMutation({
    onSuccess: async (res) => {
      if (res.whatsappSent) {
        toast.success("Rota iniciada! Cliente notificado no WhatsApp com o link ao vivo.");
      } else {
        toast.warning("Rota iniciada! GPS ativo (WhatsApp não conseguiu enviar agora).");
      }
      await utils.delivery.myQueue.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Não foi possível iniciar a rota.");
    },
  });

  const completeDeliveryMutation = trpc.delivery.completeDelivery.useMutation({
    onSuccess: async (res, vars) => {
      toast.success(`Entrega concluída! +${formatBRL(res.deliveryFeeEarned)} adicionados aos seus ganhos.`);
      setCodeByTicket((prev) => {
        const next = { ...prev };
        delete next[vars.ticketId];
        return next;
      });
      await Promise.all([
        utils.delivery.myQueue.invalidate(),
        utils.delivery.myHistory.invalidate(),
      ]);
    },
    onError: (err) => {
      toast.error(err.message || "Código inválido ou erro ao finalizar entrega.");
    },
  });

  const orders = queueQuery.data?.orders ?? [];
  const activeRouteOrder = useMemo(
    () => orders.find((o) => o.deliveryStatus === "in_route") ?? null,
    [orders]
  );
  const hasActiveRoute = Boolean(activeRouteOrder);
  const activeOrderId = activeRouteOrder?.id ?? null;

  // Ticker de 1s para exibir "Atualizado há Xs"
  useEffect(() => {
    if (!lastGpsSentAt) return;
    const interval = window.setInterval(() => {
      setSecondsSinceGps(Math.max(0, Math.floor((Date.now() - lastGpsSentAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [lastGpsSentAt]);

  // Telemetria GPS ao vivo + Screen Wake Lock enquanto houver entrega em rota
  useEffect(() => {
    if (!hasActiveRoute) {
      setGpsStatus("idle");
      setGpsErrorMsg(null);
      if (wakeLockSentinelRef.current) {
        wakeLockSentinelRef.current.release?.().catch(() => {});
        wakeLockSentinelRef.current = null;
        setWakeLockActive(false);
      }
      return;
    }

    let cancelled = false;

    const acquireWakeLock = async () => {
      try {
        const wl = (navigator as any)?.wakeLock;
        if (wl && typeof wl.request === "function") {
          const sentinel = await wl.request("screen");
          if (cancelled) {
            await sentinel.release?.().catch(() => {});
            return;
          }
          wakeLockSentinelRef.current = sentinel;
          setWakeLockActive(true);
          sentinel.addEventListener?.("release", () => {
            if (!cancelled) setWakeLockActive(false);
          });
        }
      } catch {
        setWakeLockActive(false);
      }
    };

    void acquireWakeLock();
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && hasActiveRoute) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    let watchId: number | null = null;
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      setGpsStatus("active");
      setGpsErrorMsg(null);
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const now = Date.now();
          if (now - lastEmitRef.current < 4_800) return;
          lastEmitRef.current = now;
          setGpsStatus("active");
          setGpsErrorMsg(null);
          updateLocationMutation.mutate(
            {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              speed: pos.coords.speed ?? null,
              heading: pos.coords.heading ?? null,
              activeOrderId,
            },
            {
              onSuccess: () => {
                setLastGpsSentAt(Date.now());
                setSecondsSinceGps(0);
              },
            }
          );
        },
        (err) => {
          setGpsStatus("error");
          setGpsErrorMsg(err.message || "Permita o acesso ao GPS no navegador.");
        },
        { enableHighAccuracy: true, maximumAge: 3_000, timeout: 15_000 }
      );
    } else {
      setGpsStatus("error");
      setGpsErrorMsg("Geolocalização não suportada neste navegador.");
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (watchId !== null && typeof navigator !== "undefined" && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (wakeLockSentinelRef.current) {
        wakeLockSentinelRef.current.release?.().catch(() => {});
        wakeLockSentinelRef.current = null;
        setWakeLockActive(false);
      }
    };
  }, [hasActiveRoute, activeOrderId]);

  const historyData = historyQuery.data;

  return (
    <div
      data-testid="motoboy-workspace"
      className="min-h-full w-full bg-slate-950 text-slate-100 pb-20"
    >
      {/* Cabeçalho Mobile de Alto Contraste */}
      <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Bike className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h1 className="text-base font-extrabold text-white truncate">
                  {companyName || "Modo Motoboy"}
                </h1>
                <p className="text-xs text-slate-400 truncate">
                  Entregador: {userName || "Motoboy"}
                </p>
              </div>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void queueQuery.refetch();
              if (activeView === "earnings") void historyQuery.refetch();
            }}
            className="h-9 border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${queueQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Indicador Discreto de GPS Ao Vivo */}
        {hasActiveRoute && (
          <div
            data-testid="motoboy-gps-banner"
            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
              gpsStatus === "error"
                ? "border-rose-500/40 bg-rose-950/50 text-rose-200"
                : "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Radio
                className={`h-4 w-4 shrink-0 ${
                  gpsStatus === "error" ? "text-rose-400" : "text-emerald-400 animate-pulse"
                }`}
              />
              <span className="truncate">
                {gpsStatus === "error"
                  ? `GPS indisponível: ${gpsErrorMsg}`
                  : lastGpsSentAt
                    ? `GPS Ao Vivo • Atualizado há ${secondsSinceGps}s`
                    : "GPS Ao Vivo • Obtendo sinal..."}
              </span>
            </div>
            {wakeLockActive && (
              <span className="shrink-0 rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                Tela ativa
              </span>
            )}
          </div>
        )}

        {/* Abas Superiores Exclusivas do Motoboy */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="motoboy-tab-deliveries"
            onClick={() => onSwitchView("deliveries")}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition cursor-pointer ${
              activeView === "deliveries"
                ? "bg-emerald-500 text-slate-950 shadow-md"
                : "bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800"
            }`}
          >
            <Bike className="h-4 w-4" />
            <span>Minhas Entregas</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
                activeView === "deliveries"
                  ? "bg-slate-950/20 text-slate-950"
                  : "bg-slate-800 text-emerald-400"
              }`}
            >
              {orders.length}
            </span>
          </button>

          <button
            type="button"
            data-testid="motoboy-tab-earnings"
            onClick={() => onSwitchView("earnings")}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition cursor-pointer ${
              activeView === "earnings"
                ? "bg-emerald-500 text-slate-950 shadow-md"
                : "bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800"
            }`}
          >
            <Wallet className="h-4 w-4" />
            <span>Corridas &amp; Ganhos</span>
          </button>
        </div>
      </div>

      {/* ─── VISÃO 1: MINHAS ENTREGAS ─────────────────────────────────────── */}
      {activeView === "deliveries" && (
        <div className="mx-auto max-w-xl px-4 pt-4 space-y-4">
          {queueQuery.isLoading ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center text-sm text-slate-400">
              Carregando suas entregas...
            </div>
          ) : orders.length === 0 ? (
            <div
              data-testid="motoboy-queue-empty"
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center space-y-3"
            >
              <Bike className="h-10 w-10 text-emerald-500/70 mx-auto" />
              <h2 className="text-lg font-bold text-white">Nenhuma entrega na sua fila</h2>
              <p className="text-sm text-slate-400">
                Assim que o restaurante atribuir um pedido para você, ele aparecerá automaticamente aqui.
              </p>
            </div>
          ) : (
            orders.map((order, idx) => {
              const isInRoute = order.deliveryStatus === "in_route";
              const paid = isAlreadyPaid(order.paymentMethod);
              const addrMeta = ADDRESS_TYPE_META[order.addressType] ?? ADDRESS_TYPE_META.outro;
              const codeValue = codeByTicket[order.ticketId] ?? "";

              return (
                <article
                  key={order.id}
                  data-testid={`motoboy-order-card-${order.ticketId}`}
                  className={`rounded-2xl border-2 p-4 space-y-4 shadow-lg ${
                    isInRoute
                      ? "border-emerald-500 bg-slate-900"
                      : "border-slate-800 bg-slate-900/80"
                  }`}
                >
                  {/* Topo do Card: Ordem na Fila + Status + Taxa */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-xl bg-amber-400 px-2.5 text-sm font-black text-slate-950">
                        #{order.routeSequence || idx + 1}
                      </span>
                      <div>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                            isInRoute
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                          }`}
                        >
                          {isInRoute ? "🛵 EM ROTA" : "⏳ AGUARDANDO SAÍDA"}
                        </span>
                        {order.ticketNumber && (
                          <span className="ml-2 text-xs font-mono text-slate-400">
                            Ticket #{String(order.ticketNumber).padStart(4, "0")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="block text-[10px] font-bold uppercase text-slate-400">
                        Sua taxa
                      </span>
                      <span className="text-base font-black text-emerald-400">
                        {formatBRL(order.deliveryFee)}
                      </span>
                    </div>
                  </div>

                  {/* Cliente + Botões Rápidos Ligar / WhatsApp */}
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/70 border border-slate-800 p-3">
                    <div className="min-w-0">
                      <p className="text-base font-bold text-white truncate">{order.customerName}</p>
                      <p className="text-xs font-mono text-slate-400">{order.customerPhone}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`tel:${order.customerPhone.replace(/\D/g, "")}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-slate-100 border border-slate-700 active:scale-95"
                        title="Ligar para o cliente"
                        aria-label="Ligar para o cliente"
                      >
                        <Phone className="h-5 w-5" />
                      </a>
                      <a
                        href={buildWhatsAppLink(order.customerPhone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white active:scale-95"
                        title="Abrir WhatsApp do cliente"
                        aria-label="Abrir WhatsApp do cliente"
                      >
                        <MessageCircle className="h-5 w-5" />
                      </a>
                    </div>
                  </div>

                  {/* Endereço em Alto Contraste + Tipo Casa/Apto + Complemento */}
                  <div className="rounded-xl border border-slate-700 bg-slate-950 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                        <MapPin className="h-4 w-4 text-rose-400" />
                        Endereço de Entrega
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-black tracking-wide ${addrMeta.badgeClass}`}
                      >
                        {order.addressType === "apartamento" ? (
                          <Building className="h-3.5 w-3.5" />
                        ) : (
                          <HomeIcon className="h-3.5 w-3.5" />
                        )}
                        {addrMeta.label}
                      </span>
                    </div>

                    <p className="text-base font-bold leading-snug text-white">
                      {order.deliveryAddress}
                    </p>

                    {order.addressComplement && (
                      <div className="rounded-xl border border-amber-400/50 bg-amber-500/15 px-3 py-2.5">
                        <span className="block text-[11px] font-black uppercase tracking-wider text-amber-300">
                          Bloco / Apto / Referência
                        </span>
                        <p className="text-sm font-bold text-amber-100 mt-0.5">
                          {order.addressComplement}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Itens + Pagamento (Cobrar na Entrega vs Já Pago) */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <Package className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-slate-200 whitespace-pre-wrap leading-snug">
                        {order.itemsSummary || "Pedido sem resumo detalhado."}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                      <div>
                        <span className="block text-[11px] text-slate-400">Valor do Pedido</span>
                        <strong className="text-base font-extrabold text-white">
                          {formatBRL(order.orderTotal)}
                        </strong>
                      </div>

                      <div className="text-right">
                        <span
                          className={`inline-flex items-center rounded-lg px-3 py-1 text-xs font-black uppercase ${
                            paid
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-amber-500/20 text-amber-300 border border-amber-400/50"
                          }`}
                        >
                          {paid ? "✓ JÁ PAGO" : "💰 COBRAR NA ENTREGA"}
                        </span>
                        <span className="block text-xs text-slate-300 mt-1 font-medium">
                          {order.paymentMethod}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* AÇÕES DA CORRIDA */}
                  {!isInRoute ? (
                    <div className="space-y-2.5">
                      {!order.acceptedAt ? (
                        <Button
                          type="button"
                          data-testid={`motoboy-accept-order-${order.ticketId}`}
                          disabled={acceptOrderMutation.isPending}
                          onClick={() => acceptOrderMutation.mutate({ ticketId: order.ticketId })}
                          className="w-full h-14 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-base font-black gap-2 shadow-lg cursor-pointer"
                        >
                          <CheckCircle2 className="h-5 w-5" />
                          {acceptOrderMutation.isPending ? "ACEITANDO CORRIDA..." : "ACEITAR CORRIDA"}
                        </Button>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-extrabold text-emerald-300">
                          <CheckCircle2 className="h-4 w-4" />
                          CORRIDA ACEITA • PRONTO PARA SAIR
                        </div>
                      )}
                      <Button
                        type="button"
                        data-testid={`motoboy-start-route-${order.ticketId}`}
                        disabled={startRouteMutation.isPending}
                        onClick={() => startRouteMutation.mutate({ ticketId: order.ticketId })}
                        className="w-full h-14 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-base font-black gap-2 shadow-lg cursor-pointer"
                      >
                        <Play className="h-5 w-5 fill-current" />
                        {startRouteMutation.isPending ? "INICIANDO ROTA..." : "INICIAR ROTA"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Botões grandes de Navegação Externa */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <a
                          href={buildWazeUrl(
                            order.deliveryAddress,
                            order.destinationLat,
                            order.destinationLng
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-13 items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-sm font-black shadow-md active:scale-[0.98]"
                        >
                          <Navigation className="h-4 w-4" />
                          Abrir no Waze
                        </a>
                        <a
                          href={buildGoogleMapsUrl(
                            order.deliveryAddress,
                            order.destinationLat,
                            order.destinationLng
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-13 items-center justify-center gap-2 rounded-xl bg-white hover:bg-slate-100 text-slate-950 text-sm font-black shadow-md active:scale-[0.98]"
                        >
                          <MapPin className="h-4 w-4 text-rose-600" />
                          Google Maps
                        </a>
                      </div>

                      {/* Confirmação por Código de 4 Dígitos */}
                      <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3.5 space-y-3">
                        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-300">
                          <ShieldCheck className="h-4 w-4" />
                          Código de Confirmação do Cliente (4 dígitos)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={4}
                          data-testid={`motoboy-code-input-${order.ticketId}`}
                          placeholder="0000"
                          value={codeValue}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                            setCodeByTicket((prev) => ({ ...prev, [order.ticketId]: digits }));
                          }}
                          className="w-full h-14 rounded-xl border-2 border-emerald-500/50 bg-slate-950 text-center font-mono text-3xl font-black tracking-[0.5em] text-white placeholder:text-slate-700 focus:border-emerald-400 focus:outline-none"
                        />
                        <Button
                          type="button"
                          data-testid={`motoboy-complete-btn-${order.ticketId}`}
                          disabled={completeDeliveryMutation.isPending || codeValue.length !== 4}
                          onClick={() =>
                            completeDeliveryMutation.mutate({
                              ticketId: order.ticketId,
                              deliveryCode: codeValue,
                            })
                          }
                          className="w-full h-14 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-base font-black gap-2 cursor-pointer"
                        >
                          <CheckCircle2 className="h-5 w-5" />
                          {completeDeliveryMutation.isPending
                            ? "VALIDANDO CÓDIGO..."
                            : "FINALIZAR ENTREGA"}
                        </Button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      )}

      {/* ─── VISÃO 2: MINHAS CORRIDAS & GANHOS ────────────────────────────── */}
      {activeView === "earnings" && (
        <div className="mx-auto max-w-xl px-4 pt-4 space-y-4">
          {/* Seletor de Período */}
          <div className="grid grid-cols-4 gap-1.5 rounded-2xl border border-slate-800 bg-slate-900 p-1.5">
            {(
              [
                { id: "today", label: "Hoje" },
                { id: "week", label: "Semana" },
                { id: "month", label: "Mês" },
                { id: "custom", label: "Período" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriod(opt.id)}
                className={`h-10 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                  period === opt.id
                    ? "bg-emerald-500 text-slate-950"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {period === "custom" && (
            <div className="grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-800 bg-slate-900 p-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Data inicial
                </label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Data final
                </label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"
                />
              </div>
            </div>
          )}

          {/* KPIs de Entregas e Ganhos */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400">
                <CheckCircle2 className="h-4 w-4 text-sky-400" />
                Entregas
              </div>
              <p className="text-3xl font-black text-white">
                {historyData?.summary.totalDeliveries ?? 0}
              </p>
              <span className="text-xs text-slate-400">concluídas no período</span>
            </div>

            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-emerald-300">
                <DollarSign className="h-4 w-4 text-emerald-400" />
                Total de Ganhos
              </div>
              <p className="text-2xl sm:text-3xl font-black text-emerald-400">
                {formatBRL(historyData?.summary.totalEarnings ?? 0)}
              </p>
              <span className="text-xs text-emerald-200/70">soma das taxas de entrega</span>
            </div>
          </div>

          {/* Lista de Corridas Concluídas */}
          <div className="space-y-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 px-1">
              <Calendar className="h-3.5 w-3.5" />
              Extrato de Corridas Concluídas
            </h2>

            {historyQuery.isLoading ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-400">
                Carregando extrato...
              </div>
            ) : (historyData?.items.length ?? 0) === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-400">
                Nenhuma entrega concluída neste período.
              </div>
            ) : (
              historyData!.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-bold text-white truncate">
                      {item.customerName}
                      {item.ticketNumber ? (
                        <span className="ml-2 text-xs font-mono text-slate-400">
                          #{String(item.ticketNumber).padStart(4, "0")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-400 truncate">{item.deliveryAddress}</p>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(item.deliveredAt || item.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-sm font-black text-emerald-400">
                      +{formatBRL(item.deliveryFee)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

