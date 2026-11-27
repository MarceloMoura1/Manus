import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bike,
  Building,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Home as HomeIcon,
  LogOut,
  MapPin,
  MessageCircle,
  Moon,
  Navigation,
  Package,
  Phone,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sun,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export type MotoboyView = "deliveries" | "earnings";
type HistoryPeriod = "today" | "week" | "month" | "custom";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

function isAlreadyPaid(paymentMethod: string, orderSource?: string): boolean {
  const normalized = paymentMethod
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    normalized.includes("pago") ||
    normalized.includes("online") ||
    normalized.includes("quitado") ||
    normalized.includes("aprovado")
  ) {
    return true;
  }
  return (
    orderSource === "site" &&
    !normalized.includes("entrega") &&
    !normalized.includes("combinar") &&
    !normalized.includes("dinheiro")
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
  apartamento: { label: "APTO", badgeClass: "bg-indigo-600 text-white" },
  comercial: { label: "COMERCIAL", badgeClass: "bg-amber-600 text-white" },
  outro: { label: "OUTRO", badgeClass: "bg-slate-600 text-white" },
};

export function MotoboyWorkspace({
  activeView,
  onSwitchView,
  userName,
  companyName,
  theme = "light",
  onToggleTheme,
  onLogout,
}: {
  activeView: MotoboyView;
  onSwitchView: (view: MotoboyView) => void;
  userName?: string;
  companyName?: string;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  onLogout?: () => void;
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
      toast.success("Corrida aceita! Status atualizado para Pronto p/ Motoboy.");
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

  useEffect(() => {
    if (!lastGpsSentAt) return;
    const interval = window.setInterval(() => {
      setSecondsSinceGps(Math.max(0, Math.floor((Date.now() - lastGpsSentAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [lastGpsSentAt]);

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
      className="min-h-screen w-full bg-background text-foreground flex flex-col pb-24"
    >
      {/* Header Único, Compacto e Limpo (Modo Claro / Escuro + Sair) */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-xs">
        <div className="mx-auto max-w-xl flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              <Bike className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-extrabold text-foreground truncate leading-tight">
                {companyName || "Modo Motoboy"}
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                {userName || "Entregador"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                void queueQuery.refetch();
                if (activeView === "earnings") void historyQuery.refetch();
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              title="Atualizar fila"
              aria-label="Atualizar fila"
            >
              <RefreshCw className={`h-4 w-4 ${queueQuery.isFetching ? "animate-spin" : ""}`} />
            </button>

            {onToggleTheme && (
              <button
                type="button"
                data-testid="motoboy-theme-toggle"
                onClick={onToggleTheme}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                title={theme === "dark" ? "Mudar para Modo Claro" : "Mudar para Modo Escuro"}
                aria-label="Alternar tema"
              >
                {theme === "dark" ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
              </button>
            )}

            {onLogout && (
              <button
                type="button"
                data-testid="motoboy-logout-btn"
                onClick={onLogout}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-2.5 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/70 transition cursor-pointer"
                title="Sair da conta"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden xs:inline sm:inline">Sair</span>
              </button>
            )}
          </div>
        </div>

        {/* Faixa Discreta de GPS Ativo */}
        {hasActiveRoute && (
          <div className="mx-auto max-w-xl mt-2.5">
            <div
              data-testid="motoboy-gps-banner"
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                gpsStatus === "error"
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Radio
                  className={`h-3.5 w-3.5 shrink-0 ${
                    gpsStatus === "error" ? "text-rose-500" : "text-emerald-500 animate-pulse"
                  }`}
                />
                <span className="truncate">
                  {gpsStatus === "error"
                    ? `GPS indisponível: ${gpsErrorMsg}`
                    : lastGpsSentAt
                      ? `GPS Ao Vivo • Atualizado há ${secondsSinceGps}s`
                      : "GPS Ao Vivo • Conectando satélite..."}
                </span>
              </div>
              {wakeLockActive && (
                <span className="shrink-0 rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold">
                  Tela ativa
                </span>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ─── VISÃO 1: MINHAS ENTREGAS ─────────────────────────────────────── */}
      {activeView === "deliveries" && (
        <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-4 space-y-4">
          {queueQuery.isLoading ? (
            <div className="rounded-3xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-xs">
              Carregando suas entregas...
            </div>
          ) : orders.length === 0 ? (
            <div
              data-testid="motoboy-queue-empty"
              className="rounded-3xl border border-border bg-card p-10 text-center space-y-3 shadow-xs"
            >
              <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Bike className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-extrabold text-foreground">Nenhuma entrega na sua fila</h2>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Assim que o restaurante despachar um pedido para você, ele aparecerá automaticamente aqui.
              </p>
            </div>
          ) : (
            orders.map((order, idx) => {
              const isInRoute = order.deliveryStatus === "in_route";
              const isAccepted = Boolean(order.acceptedAt);
              const paid = isAlreadyPaid(order.paymentMethod, order.orderSource);
              const addrMeta = ADDRESS_TYPE_META[order.addressType] ?? ADDRESS_TYPE_META.outro;
              const codeValue = codeByTicket[order.ticketId] ?? "";

              return (
                <article
                  key={order.id}
                  data-testid={`motoboy-order-card-${order.ticketId}`}
                  className={`rounded-3xl border-2 bg-card p-4 sm:p-5 space-y-4 shadow-sm transition ${
                    isInRoute
                      ? "border-emerald-500 shadow-emerald-500/10"
                      : isAccepted
                        ? "border-sky-500/50"
                        : "border-border"
                  }`}
                >
                  {/* Topo do Card: Ordem (#1), Ticket (#0008), Status Vivo + GPS + Taxa */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-400 px-2.5 text-sm font-black text-slate-950 shadow-xs">
                        #{order.routeSequence || idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {order.ticketNumber && (
                            <span className="text-xs font-mono font-extrabold text-muted-foreground">
                              #{String(order.ticketNumber).padStart(4, "0")}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
                              isInRoute
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                                : isAccepted
                                  ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30"
                                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                            }`}
                          >
                            {isInRoute ? (
                              <>
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                EM ROTA
                              </>
                            ) : isAccepted ? (
                              "PRONTO P/ SAIR"
                            ) : (
                              "NOVA CORRIDA"
                            )}
                          </span>
                        </div>
                        {isInRoute && gpsStatus === "active" && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <Radio className="h-3 w-3 animate-pulse" />
                            GPS transmitindo ao vivo
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5">
                      <span className="block text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                        Taxa
                      </span>
                      <span className="text-sm font-black text-emerald-700 dark:text-emerald-400">
                        {formatBRL(order.deliveryFee)}
                      </span>
                    </div>
                  </div>

                  {/* Bloco Principal: Cliente + Botões Rápidos WhatsApp / Ligar */}
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 p-3.5">
                    <div className="min-w-0">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Cliente
                      </span>
                      <p className="text-base font-extrabold text-foreground truncate">
                        {order.customerName}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground">{order.customerPhone}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`tel:${order.customerPhone.replace(/\D/g, "")}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card text-foreground shadow-xs hover:bg-muted active:scale-95 transition"
                        title="Ligar para o cliente"
                        aria-label="Ligar para o cliente"
                      >
                        <Phone className="h-5 w-5" />
                      </a>
                      <a
                        href={buildWhatsAppLink(order.customerPhone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 active:scale-95 transition"
                        title="Abrir WhatsApp do cliente"
                        aria-label="Abrir WhatsApp do cliente"
                      >
                        <MessageCircle className="h-5 w-5" />
                      </a>
                    </div>
                  </div>

                  {/* Endereço Grande & Legível + Badge CASA/APTO + Bloco/Apto/Referência */}
                  <div className="rounded-2xl border border-border bg-muted/25 p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
                        <MapPin className="h-4 w-4 text-rose-500" />
                        Endereço de Entrega
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-black tracking-wide ${addrMeta.badgeClass}`}
                      >
                        {order.addressType === "apartamento" ? (
                          <Building className="h-3.5 w-3.5" />
                        ) : (
                          <HomeIcon className="h-3.5 w-3.5" />
                        )}
                        {addrMeta.label}
                      </span>
                    </div>

                    <p className="text-base sm:text-lg font-extrabold leading-snug text-foreground">
                      {order.deliveryAddress}
                    </p>

                    {order.addressComplement && (
                      <div className="rounded-xl border-2 border-amber-400/60 bg-amber-500/15 px-3.5 py-2.5">
                        <span className="block text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
                          Bloco / Apto / Referência
                        </span>
                        <p className="text-sm font-extrabold text-amber-950 dark:text-amber-100 mt-0.5">
                          {order.addressComplement}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Resumo dos Itens + Selo Claro de Pagamento */}
                  <div className="rounded-2xl border border-border bg-muted/25 p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <Package className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        {order.items && order.items.length > 0 ? (
                          <ul className="space-y-1 text-sm text-foreground">
                            {order.items.map((it: any, iIdx: number) => (
                              <li key={`${it.productPublicId || it.name}-${iIdx}`} className="flex justify-between gap-2">
                                <span className="font-medium">
                                  <strong>{it.quantity}x</strong> {it.name}
                                </span>
                                <span className="text-xs font-semibold text-muted-foreground shrink-0">
                                  {formatBRL(it.subtotal)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm font-medium text-foreground whitespace-pre-wrap leading-snug">
                            {order.itemsSummary || "Pedido sem resumo detalhado."}
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      className={`rounded-2xl border-2 p-3 flex flex-wrap items-center justify-between gap-2 ${
                        paid
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-amber-500/50 bg-amber-500/15"
                      }`}
                    >
                      <div>
                        <span
                          className={`inline-flex items-center text-xs sm:text-sm font-black uppercase tracking-wide ${
                            paid
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-amber-800 dark:text-amber-200"
                          }`}
                        >
                          {paid
                            ? "✓ PAGO ONLINE"
                            : `💰 COBRAR ${formatBRL(order.orderTotal)} NA ENTREGA`}
                        </span>
                        <span className="block text-xs font-semibold text-muted-foreground mt-0.5">
                          Forma: {order.paymentMethod}
                        </span>
                      </div>
                      <strong className="text-base font-black text-foreground">
                        {formatBRL(order.orderTotal)}
                      </strong>
                    </div>
                  </div>

                  {/* AÇÕES GRANDES E ERGONÔMICAS (OPERAÇÃO COM 1 MÃO) */}
                  {!isInRoute ? (
                    <div className="space-y-2.5 pt-1">
                      {!isAccepted ? (
                        <Button
                          type="button"
                          data-testid={`motoboy-accept-order-${order.ticketId}`}
                          disabled={acceptOrderMutation.isPending}
                          onClick={() => acceptOrderMutation.mutate({ ticketId: order.ticketId })}
                          className="w-full h-14 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-base font-black gap-2 shadow-md cursor-pointer"
                        >
                          <CheckCircle2 className="h-5 w-5" />
                          {acceptOrderMutation.isPending ? "ACEITANDO CORRIDA..." : "ACEITAR CORRIDA"}
                        </Button>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-4 w-4" />
                          CORRIDA ACEITA • PRONTO PARA SAIR
                        </div>
                      )}
                      <Button
                        type="button"
                        data-testid={`motoboy-start-route-${order.ticketId}`}
                        disabled={startRouteMutation.isPending}
                        onClick={() => startRouteMutation.mutate({ ticketId: order.ticketId })}
                        className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-base font-black gap-2 shadow-md cursor-pointer"
                      >
                        <Play className="h-5 w-5 fill-current" />
                        {startRouteMutation.isPending ? "INICIANDO ROTA..." : "INICIAR ROTA"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-2 gap-2.5">
                        <a
                          href={buildWazeUrl(
                            order.deliveryAddress,
                            order.destinationLat,
                            order.destinationLng
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-black shadow-sm active:scale-[0.98] transition"
                        >
                          <Navigation className="h-4 w-4" />
                          Abrir Waze
                        </a>
                        <a
                          href={buildGoogleMapsUrl(
                            order.deliveryAddress,
                            order.destinationLat,
                            order.destinationLng
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-13 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-background hover:bg-muted text-foreground text-sm font-black shadow-sm active:scale-[0.98] transition"
                        >
                          <MapPin className="h-4 w-4 text-rose-500" />
                          Google Maps
                        </a>
                      </div>

                      {/* Campo Grande de 4 Dígitos + Finalizar Entrega */}
                      <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3">
                        <label className="flex items-center justify-center gap-2 text-xs font-extrabold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                          <ShieldCheck className="h-4 w-4" />
                          Código de Confirmação (4 dígitos)
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
                          className="w-full h-15 rounded-2xl border-2 border-emerald-500/50 bg-card text-center font-mono text-3xl font-black tracking-[0.5em] text-foreground placeholder:text-muted-foreground/40 focus:border-emerald-500 focus:outline-none"
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
                          className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-muted disabled:text-muted-foreground text-white text-base font-black gap-2 shadow-md cursor-pointer"
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
        </main>
      )}

      {/* ─── VISÃO 2: GANHOS & EXTRATO ────────────────────────────────────── */}
      {activeView === "earnings" && (
        <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-4 space-y-4">
          {/* Seletor de Período */}
          <div className="grid grid-cols-4 gap-1.5 rounded-2xl border border-border bg-card p-1.5 shadow-xs">
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
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {period === "custom" && (
            <div className="grid grid-cols-2 gap-2.5 rounded-2xl border border-border bg-card p-3.5 shadow-xs">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  Data inicial
                </label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  Data final
                </label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                />
              </div>
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl border border-border bg-card p-4 space-y-1 shadow-xs">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-sky-500" />
                Entregas
              </div>
              <p className="text-3xl font-black text-foreground">
                {historyData?.summary.totalDeliveries ?? 0}
              </p>
              <span className="text-xs text-muted-foreground">concluídas no período</span>
            </div>

            <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-1 shadow-xs">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-emerald-700 dark:text-emerald-300">
                <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Ganhos
              </div>
              <p className="text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-400">
                {formatBRL(historyData?.summary.totalEarnings ?? 0)}
              </p>
              <span className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                soma das taxas
              </span>
            </div>
          </div>

          {/* Lista de Corridas Concluídas */}
          <div className="space-y-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 px-1">
              <Calendar className="h-3.5 w-3.5" />
              Extrato de Corridas Concluídas
            </h2>

            {historyQuery.isLoading ? (
              <div className="rounded-3xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Carregando extrato...
              </div>
            ) : (historyData?.items.length ?? 0) === 0 ? (
              <div className="rounded-3xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Nenhuma entrega concluída neste período.
              </div>
            ) : (
              historyData!.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border bg-card p-3.5 flex items-center justify-between gap-3 shadow-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-bold text-foreground truncate">
                      {item.customerName}
                      {item.ticketNumber ? (
                        <span className="ml-2 text-xs font-mono text-muted-foreground">
                          #{String(item.ticketNumber).padStart(4, "0")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{item.deliveryAddress}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(item.deliveredAt || item.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <span className="shrink-0 inline-flex rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-sm font-black text-emerald-700 dark:text-emerald-400">
                    +{formatBRL(item.deliveryFee)}
                  </span>
                </div>
              ))
            )}
          </div>
        </main>
      )}

      {/* Barra Inferior Única Estilo App Nativo (2 Abas: Entregas | Ganhos) */}
      <nav
        data-testid="motoboy-bottom-nav"
        aria-label="Navegação do Motoboy"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)] shadow-lg"
      >
        <div className="mx-auto max-w-xl grid grid-cols-2 h-16 px-3 gap-2 items-center">
          <button
            type="button"
            data-testid="motoboy-tab-deliveries"
            onClick={() => onSwitchView("deliveries")}
            className={`flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-extrabold transition cursor-pointer ${
              activeView === "deliveries"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Bike className="h-4 w-4" />
            <span>Entregas</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-black ${
                activeView === "deliveries"
                  ? "bg-white/20 text-white"
                  : "bg-muted text-foreground"
              }`}
            >
              {orders.length}
            </span>
          </button>

          <button
            type="button"
            data-testid="motoboy-tab-earnings"
            onClick={() => onSwitchView("earnings")}
            className={`flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-extrabold transition cursor-pointer ${
              activeView === "earnings"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Wallet className="h-4 w-4" />
            <span>Ganhos</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
