import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Bike,
  CheckCircle2,
  Clock,
  Crosshair,
  DollarSign,
  Download,
  Map as MapIcon,
  MapPin,
  Package,
  Radio,
  RefreshCw,
  TrendingUp,
  UserCheck,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

type TrackingTab = "live" | "payouts";
type PayoutPreset = "today" | "week" | "month" | "custom";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

const formatDateTime = (iso?: string | null) => {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatRelativeAgo = (iso?: string | null) => {
  if (!iso) return "Sem sinal GPS";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `há ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin}min`;
  return `há ${Math.floor(diffMin / 60)}h`;
};

function escapeCsvCell(value: unknown): string {
  const s = String(value ?? "");
  if (/[;"\n\r,]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

interface LiveMapProps {
  motoboys: Array<{
    userId: string;
    name: string;
    status: "in_route" | "available";
    isOnline: boolean;
    location: { lat: number; lng: number; speed: number | null; heading: number | null; updatedAt: string } | null;
    activeOrder: {
      id: string;
      ticketNumber?: number | null;
      customerName: string;
      deliveryAddress: string;
      destinationLat: number | null;
      destinationLng: number | null;
    } | null;
    queuedCount: number;
  }>;
  activeOrders: Array<{
    id: string;
    ticketId: string;
    ticketNumber?: number | null;
    customerName: string;
    deliveryAddress: string;
    deliveryStatus: string;
    routeSequence: number;
    motoboyName: string | null;
    destinationLat: number | null;
    destinationLng: number | null;
  }>;
  focusPoint: { lat: number; lng: number; token: number } | null;
}

function LiveDeliveryMap({ motoboys, activeOrders, focusPoint }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const hasAutoFittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [-25.4284, -49.2733], // Curitiba fallback padrão até receber primeira coordenada real
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
      maxZoom: 19,
    }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      hasAutoFittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const boundsPoints: L.LatLngExpression[] = [];

    // 1. Marcadores de destinos ativos (in_route / assigned)
    for (const order of activeOrders) {
      if (order.destinationLat == null || order.destinationLng == null) continue;
      const pt: L.LatLngExpression = [order.destinationLat, order.destinationLng];
      boundsPoints.push(pt);

      const isInRoute = order.deliveryStatus === "in_route";
      const pinIcon = L.divIcon({
        className: "megadesk-delivery-pin",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:${
          isInRoute ? "#0284c7" : "#7c3aed"
        };color:#fff;border:2px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:15px;">📍</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -30],
      });

      const ticketTag = order.ticketNumber ? `#${String(order.ticketNumber).padStart(4, "0")}` : "Pedido";
      L.marker(pt, { icon: pinIcon })
        .bindPopup(
          `<div style="min-width:180px;font-family:sans-serif;font-size:12px;">
            <strong>${ticketTag} · ${order.customerName}</strong><br/>
            <span>${order.deliveryAddress}</span><br/>
            <span style="color:#475569;">Motoboy: ${order.motoboyName || "Não atribuído"} (Fila #${order.routeSequence})</span>
          </div>`
        )
        .addTo(group);
    }

    // 2. Marcadores de motoboys + linha de trajeto até o destino ativo
    for (const mb of motoboys) {
      if (!mb.location) continue;
      const pt: L.LatLngExpression = [mb.location.lat, mb.location.lng];
      boundsPoints.push(pt);

      const inRoute = mb.status === "in_route";
      const bg = inRoute ? "#059669" : mb.isOnline ? "#0f172a" : "#64748b";
      const ring = mb.isOnline ? "0 0 0 4px rgba(16,185,129,0.3)" : "none";

      const mbIcon = L.divIcon({
        className: "megadesk-motoboy-pin",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:9999px;background:${bg};color:#fff;border:2.5px solid #fff;box-shadow:0 6px 16px rgba(0,0,0,0.35),${ring};font-size:18px;">🛵</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -20],
      });

      const speedKmh =
        mb.location.speed != null && Number.isFinite(mb.location.speed)
          ? `${Math.round(mb.location.speed * 3.6)} km/h`
          : "—";

      L.marker(pt, { icon: mbIcon })
        .bindPopup(
          `<div style="min-width:190px;font-family:sans-serif;font-size:12px;">
            <strong>🛵 ${mb.name}</strong><br/>
            <span>Status: <b>${inRoute ? "Em Rota" : "Disponível"}</b> (${mb.isOnline ? "GPS Online" : "Offline"})</span><br/>
            <span>Velocidade: ${speedKmh} • Atualizado ${formatRelativeAgo(mb.location.updatedAt)}</span>
            ${
              mb.activeOrder
                ? `<br/><span style="color:#0369a1;">Entregando para: ${mb.activeOrder.customerName}</span>`
                : ""
            }
          </div>`
        )
        .addTo(group);

      if (
        mb.activeOrder &&
        mb.activeOrder.destinationLat != null &&
        mb.activeOrder.destinationLng != null
      ) {
        L.polyline(
          [pt, [mb.activeOrder.destinationLat, mb.activeOrder.destinationLng]],
          {
            color: "#10b981",
            weight: 3.5,
            opacity: 0.85,
            dashArray: "8 6",
          }
        ).addTo(group);
      }
    }

    if (!hasAutoFittedRef.current && boundsPoints.length > 0) {
      if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0], 15);
      } else {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [45, 45], maxZoom: 16 });
      }
      hasAutoFittedRef.current = true;
    }
  }, [motoboys, activeOrders]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPoint) return;
    map.setView([focusPoint.lat, focusPoint.lng], 16, { animate: true });
  }, [focusPoint]);

  const handleRecenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const pts: L.LatLngExpression[] = [];
    motoboys.forEach((m) => {
      if (m.location) pts.push([m.location.lat, m.location.lng]);
    });
    activeOrders.forEach((o) => {
      if (o.destinationLat != null && o.destinationLng != null) {
        pts.push([o.destinationLat, o.destinationLng]);
      }
    });
    if (pts.length === 1) {
      map.setView(pts[0], 15, { animate: true });
    } else if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts), { padding: [45, 45], maxZoom: 16 });
    }
  };

  return (
    <div className="relative h-[520px] lg:h-[620px] w-full overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-xs">
      <div ref={containerRef} data-testid="restaurant-live-map" className="h-full w-full z-0" />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleRecenter}
        className="absolute top-3 right-3 z-[400] bg-white/95 dark:bg-slate-900/95 border-slate-300 dark:border-slate-700 text-xs font-semibold shadow-md cursor-pointer"
      >
        <Crosshair className="w-3.5 h-3.5 mr-1.5" />
        Centralizar Mapa
      </Button>
    </div>
  );
}

export function RestaurantTrackingWorkspace() {
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<TrackingTab>("live");
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lng: number; token: number } | null>(null);
  const [assignChoiceByTicket, setAssignChoiceByTicket] = useState<Record<string, string>>({});
  const [showNewMotoboyModal, setShowNewMotoboyModal] = useState(false);
  const [motoboyForm, setMotoboyForm] = useState({ name: "", email: "", phone: "", password: "" });

  // Filtros de Fechamento & Repasses
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [payoutMotoboyId, setPayoutMotoboyId] = useState<string>("all");
  const [payoutPreset, setPayoutPreset] = useState<PayoutPreset>("today");
  const [customStart, setCustomStart] = useState<string>(todayIso);
  const [customEnd, setCustomEnd] = useState<string>(todayIso);

  const liveQuery = trpc.delivery.liveOverview.useQuery(undefined, {
    refetchInterval: activeTab === "live" ? 5_000 : false,
    refetchOnWindowFocus: true,
  });

  const payoutQuery = trpc.delivery.payoutReport.useQuery(
    {
      motoboyUserId: payoutMotoboyId === "all" ? undefined : payoutMotoboyId,
      preset: payoutPreset,
      ...(payoutPreset === "custom" ? { startDate: customStart, endDate: customEnd } : {}),
    },
    {
      enabled: activeTab === "payouts",
      refetchOnWindowFocus: false,
    }
  );

  const assignMutation = trpc.delivery.assignMotoboy.useMutation({
    onSuccess: async () => {
      toast.success("Motoboy atribuído ao pedido!");
      await utils.delivery.liveOverview.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Falha ao atribuir motoboy.");
    },
  });

  const quickCreateMotoboyMutation = trpc.delivery.quickCreateMotoboy.useMutation({
    onSuccess: async (res) => {
      toast.success(`Login do motoboy ${res.name} criado com sucesso!`);
      setShowNewMotoboyModal(false);
      setMotoboyForm({ name: "", email: "", phone: "", password: "" });
      await Promise.all([
        utils.delivery.liveOverview.invalidate(),
        utils.delivery.listMotoboys.invalidate(),
      ]);
    },
    onError: (err) => {
      toast.error(err.message || "Não foi possível cadastrar o motoboy.");
    },
  });

  const live = liveQuery.data;
  const motoboys = live?.motoboys ?? [];
  const activeOrders = live?.activeOrders ?? [];
  const unassignedOrders = live?.unassignedOrders ?? [];
  const onlineCount = motoboys.filter((m) => m.isOnline).length;
  const inRouteCount = motoboys.filter((m) => m.status === "in_route").length;

  const payout = payoutQuery.data;

  const handleExportCsv = () => {
    if (!payout || payout.deliveries.length === 0) {
      toast.warning("Nenhuma entrega concluída no período para exportar.");
      return;
    }
    const headers = [
      "Ticket",
      "Inicio",
      "Entrega",
      "Motoboy",
      "Cliente",
      "Endereco",
      "Pagamento",
      "Valor Pedido (R$)",
      "Taxa Rota (R$)",
    ];
    const lines = [
      headers.join(";"),
      ...payout.deliveries.map((d) =>
        [
          d.ticketNumber ? `#${String(d.ticketNumber).padStart(4, "0")}` : d.ticketId,
          formatDateTime(d.startedAt),
          formatDateTime(d.deliveredAt),
          d.motoboyName,
          d.customerName,
          d.deliveryAddress,
          d.paymentMethod,
          d.orderTotal.toFixed(2).replace(".", ","),
          d.deliveryFee.toFixed(2).replace(".", ","),
        ]
          .map(escapeCsvCell)
          .join(";")
      ),
    ];

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fechamento-motoboys-${payoutPreset}-${todayIso}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("CSV de fechamento exportado com sucesso!");
  };

  return (
    <div
      data-testid="restaurant-tracking-workspace"
      className="min-h-full w-full space-y-6 p-4 sm:p-6 bg-background text-foreground"
    >
      {/* Cabeçalho + Abas Superiores */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              <Bike className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-foreground">
                Central de Rastreamento &amp; Motoboys
              </h1>
              <p className="text-xs text-muted-foreground">
                Acompanhamento GPS em tempo real das rotas e fechamento financeiro de repasses.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/60 p-1">
            <button
              type="button"
              data-testid="tracking-tab-live"
              onClick={() => setActiveTab("live")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                activeTab === "live"
                  ? "bg-card text-emerald-600 dark:text-emerald-400 shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              Mapa ao Vivo
            </button>
            <button
              type="button"
              data-testid="tracking-tab-payouts"
              onClick={() => setActiveTab("payouts")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                activeTab === "payouts"
                  ? "bg-card text-emerald-600 dark:text-emerald-400 shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Wallet className="h-3.5 w-3.5" />
              Fechamento &amp; Repasses
            </button>
          </div>

          <Button
            type="button"
            size="sm"
            data-testid="tracking-new-motoboy-btn"
            onClick={() => setShowNewMotoboyModal(true)}
            className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
          >
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            + Novo Motoboy
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (activeTab === "live") void liveQuery.refetch();
              else void payoutQuery.refetch();
            }}
            className="h-9 text-xs cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${
                liveQuery.isFetching || payoutQuery.isFetching ? "animate-spin" : ""
              }`}
            />
            Atualizar
          </Button>
        </div>
      </div>

      {/* ─── ABA 1: MAPA AO VIVO ──────────────────────────────────────────── */}
      {activeTab === "live" && (
        <div className="space-y-5">
          {/* KPIs Rápidos */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-emerald-500" />
                Motoboys Online (GPS)
              </span>
              <p className="mt-1.5 text-2xl font-black text-foreground">
                {onlineCount} <span className="text-xs font-semibold text-muted-foreground">/ {motoboys.length}</span>
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                <Bike className="h-3.5 w-3.5 text-sky-500" />
                Em Rota Agora
              </span>
              <p className="mt-1.5 text-2xl font-black text-sky-600 dark:text-sky-400">
                {inRouteCount}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-indigo-500" />
                Entregas Ativas
              </span>
              <p className="mt-1.5 text-2xl font-black text-foreground">{activeOrders.length}</p>
            </div>
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                Aguardando Motoboy
              </span>
              <p className="mt-1.5 text-2xl font-black text-amber-600 dark:text-amber-400">
                {unassignedOrders.length}
              </p>
            </div>
          </div>

          {/* Grid Mapa + Painel Lateral */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <LiveDeliveryMap
                motoboys={motoboys}
                activeOrders={activeOrders}
                focusPoint={focusPoint}
              />
            </div>

            <div className="xl:col-span-4 space-y-4">
              {/* Lista de Motoboys */}
              <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Equipe de Entregadores ({motoboys.length})
                  </h2>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    Auto-sync 5s
                  </span>
                </div>

                {motoboys.length === 0 ? (
                  <div className="py-4 text-center space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Nenhum motoboy cadastrado ainda. Crie o login de acesso do seu entregador em 1 clique.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setShowNewMotoboyModal(true)}
                      className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      Cadastrar Primeiro Motoboy
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
                    {motoboys.map((mb) => {
                      const speedKmh =
                        mb.location?.speed != null && Number.isFinite(mb.location.speed)
                          ? `${Math.round(mb.location.speed * 3.6)} km/h`
                          : null;

                      return (
                        <div
                          key={mb.userId}
                          onClick={() => {
                            if (mb.location) {
                              setFocusPoint({
                                lat: mb.location.lat,
                                lng: mb.location.lng,
                                token: Date.now(),
                              });
                            }
                          }}
                          className={`rounded-xl border p-3 transition ${
                            mb.location ? "cursor-pointer hover:border-emerald-500/50" : ""
                          } border-border bg-muted/20 space-y-1.5`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-foreground truncate">
                              🛵 {mb.name}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                                mb.status === "in_route"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                                  : "bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              {mb.status === "in_route" ? "Em Rota" : "Disponível"}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <span
                                className={`inline-block h-2 w-2 rounded-full ${
                                  mb.isOnline ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                                }`}
                              />
                              {mb.location ? `GPS ${formatRelativeAgo(mb.location.updatedAt)}` : "Sem GPS"}
                              {speedKmh ? ` • ${speedKmh}` : ""}
                            </span>
                            <span className="font-semibold text-foreground">
                              Fila: {mb.queuedCount} {mb.queuedCount === 1 ? "pedido" : "pedidos"}
                            </span>
                          </div>

                          {mb.activeOrder && (
                            <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-800 dark:text-sky-200">
                              <strong>
                                {mb.activeOrder.ticketNumber
                                  ? `#${String(mb.activeOrder.ticketNumber).padStart(4, "0")}`
                                  : "Pedido"}{" "}
                                · {mb.activeOrder.customerName}
                              </strong>
                              <p className="truncate opacity-80">{mb.activeOrder.deliveryAddress}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Fila Geral Aguardando Atribuição */}
              <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Pedidos Aguardando Atribuição ({unassignedOrders.length})
                </h2>

                {unassignedOrders.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">
                    Todos os pedidos pendentes já estão atribuídos.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
                    {unassignedOrders.map((order) => {
                      const chosen = assignChoiceByTicket[order.ticketId] ?? "";
                      return (
                        <div
                          key={order.id}
                          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-foreground truncate">
                              {order.ticketNumber
                                ? `#${String(order.ticketNumber).padStart(4, "0")} · `
                                : ""}
                              {order.customerName}
                            </span>
                            <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                              Taxa {formatBRL(order.deliveryFee)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {order.deliveryAddress}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <select
                              value={chosen}
                              onChange={(e) =>
                                setAssignChoiceByTicket((prev) => ({
                                  ...prev,
                                  [order.ticketId]: e.target.value,
                                }))
                              }
                              className="min-w-0 flex-1 h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
                            >
                              <option value="">Escolher motoboy...</option>
                              {motoboys.map((mb) => (
                                <option key={mb.userId} value={mb.userId}>
                                  {mb.name} ({mb.status === "in_route" ? "Em rota" : "Livre"})
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              size="sm"
                              disabled={!chosen || assignMutation.isPending}
                              onClick={() =>
                                assignMutation.mutate({
                                  ticketId: order.ticketId,
                                  motoboyUserId: chosen,
                                })
                              }
                              className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 cursor-pointer"
                            >
                              <UserCheck className="h-3.5 w-3.5 mr-1" />
                              Atribuir
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── ABA 2: FECHAMENTO & REPASSES ─────────────────────────────────── */}
      {activeTab === "payouts" && (
        <div data-testid="restaurant-payouts-view" className="space-y-5">
          {/* Barra de Filtros + Exportar CSV */}
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-muted-foreground mb-1">
                  Motoboy
                </label>
                <select
                  value={payoutMotoboyId}
                  onChange={(e) => setPayoutMotoboyId(e.target.value)}
                  className="h-9 rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground min-w-[180px]"
                >
                  <option value="all">Todos os motoboys</option>
                  {motoboys.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      🛵 {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-muted-foreground mb-1">
                  Período
                </label>
                <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/50 p-1">
                  {(
                    [
                      { id: "today", label: "Hoje" },
                      { id: "week", label: "Esta Semana" },
                      { id: "month", label: "Este Mês" },
                      { id: "custom", label: "Personalizado" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPayoutPreset(opt.id)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                        payoutPreset === opt.id
                          ? "bg-emerald-600 text-white"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {payoutPreset === "custom" && (
                <div className="flex items-end gap-2">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-muted-foreground mb-1">
                      Início
                    </label>
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="h-9 rounded-xl border border-border bg-background px-2.5 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-muted-foreground mb-1">
                      Fim
                    </label>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="h-9 rounded-xl border border-border bg-background px-2.5 text-xs text-foreground"
                    />
                  </div>
                </div>
              )}
            </div>

            <Button
              type="button"
              size="sm"
              data-testid="export-payouts-csv-btn"
              onClick={handleExportCsv}
              disabled={!payout || payout.deliveries.length === 0}
              className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Exportar CSV
            </Button>
          </div>

          {/* 3 Cards de Resumo */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-sky-500" />
                Total de Entregas Concluídas
              </span>
              <p className="mt-2 text-3xl font-black text-foreground">
                {payout?.summary.totalDeliveries ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                Total a Pagar (Soma das Taxas)
              </span>
              <p className="mt-2 text-3xl font-black text-emerald-600 dark:text-emerald-400">
                {formatBRL(payout?.summary.totalPayout ?? 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-indigo-500" />
                Ticket Médio por Entrega
              </span>
              <p className="mt-2 text-3xl font-black text-foreground">
                {formatBRL(payout?.summary.averageFee ?? 0)}
              </p>
            </div>
          </div>

          {/* Resumo por Motoboy */}
          {payout && payout.byMotoboy.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Resumo de Repasse por Entregador
              </h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {payout.byMotoboy.map((m) => (
                  <button
                    key={m.motoboyUserId}
                    type="button"
                    onClick={() =>
                      setPayoutMotoboyId((curr) =>
                        curr === m.motoboyUserId ? "all" : m.motoboyUserId
                      )
                    }
                    className={`rounded-xl border p-3 text-left transition cursor-pointer ${
                      payoutMotoboyId === m.motoboyUserId
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-border bg-muted/20 hover:border-emerald-500/40"
                    }`}
                  >
                    <p className="text-sm font-bold text-foreground truncate">🛵 {m.motoboyName}</p>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {m.deliveriesCount} {m.deliveriesCount === 1 ? "entrega" : "entregas"}
                      </span>
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {formatBRL(m.totalAmount)}
                      </strong>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tabela Detalhada de Rotas Concluídas */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Ticket</th>
                    <th className="px-4 py-3">Início / Entrega</th>
                    <th className="px-4 py-3">Motoboy</th>
                    <th className="px-4 py-3">Cliente / Endereço</th>
                    <th className="px-4 py-3 text-right">Valor Pedido</th>
                    <th className="px-4 py-3 text-right">Taxa / Repasse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payoutQuery.isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Carregando fechamento de repasses...
                      </td>
                    </tr>
                  ) : !payout || payout.deliveries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhuma entrega concluída no período selecionado.
                      </td>
                    </tr>
                  ) : (
                    payout.deliveries.map((d) => (
                      <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-foreground">
                          {d.ticketNumber ? `#${String(d.ticketNumber).padStart(4, "0")}` : d.ticketId.slice(0, 8)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>{formatDateTime(d.startedAt)}</span>
                          </div>
                          <div className="text-foreground font-medium">
                            ✓ {formatDateTime(d.deliveredAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">{d.motoboyName}</td>
                        <td className="px-4 py-3 max-w-xs">
                          <p className="font-semibold text-foreground truncate">{d.customerName}</p>
                          <p className="text-muted-foreground truncate">{d.deliveryAddress}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-foreground">
                          {formatBRL(d.orderTotal)}
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold text-emerald-600 dark:text-emerald-400">
                          {formatBRL(d.deliveryFee)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {/* Modal Rápido: + Novo Motoboy */}
      {showNewMotoboyModal && (
        <div
          data-testid="quick-new-motoboy-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
                  <Bike className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-foreground">Cadastrar Novo Motoboy</h3>
                  <p className="text-xs text-muted-foreground">
                    Cria o login mobile com acesso exclusivo a entregas, GPS e ganhos.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewMotoboyModal(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                quickCreateMotoboyMutation.mutate({
                  name: motoboyForm.name.trim(),
                  email: motoboyForm.email.trim(),
                  phone: motoboyForm.phone.trim() || undefined,
                  password: motoboyForm.password,
                });
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Nome completo</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={motoboyForm.name}
                  onChange={(e) => setMotoboyForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: João Entregador"
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">E-mail de login</label>
                <input
                  type="email"
                  required
                  value={motoboyForm.email}
                  onChange={(e) => setMotoboyForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="joao.moto@restaurante.com"
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Telefone / WhatsApp (opcional)</label>
                <input
                  type="tel"
                  value={motoboyForm.phone}
                  onChange={(e) => setMotoboyForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="(41) 99999-0000"
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Senha de acesso (mín. 6 caracteres)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={motoboyForm.password}
                  onChange={(e) => setMotoboyForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs text-foreground"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewMotoboyModal(false)}
                  className="text-xs cursor-pointer"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={quickCreateMotoboyMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                >
                  {quickCreateMotoboyMutation.isPending ? "Cadastrando..." : "Criar Login de Motoboy"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

