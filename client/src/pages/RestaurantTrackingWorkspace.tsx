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
  Filter,
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
import { useTheme } from "@/contexts/ThemeContext";

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

const formatRouteDuration = (startedAt?: string | null) => {
  if (!startedAt) return null;
  const mins = Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
  if (mins < 60) return `${mins} min em rota`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${h}h${rem > 0 ? `${rem}m` : ""} em rota`;
};

const getInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || "")
    .join("")
    .toUpperCase() || "MB";

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
      startedAt?: string | null;
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
    motoboyUserId?: string | null;
    motoboyName: string | null;
    destinationLat: number | null;
    destinationLng: number | null;
  }>;
  focusPoint: { lat: number; lng: number; token: number } | null;
  selectedMotoboyFilter: string;
  onSelectMotoboyFilter: (userId: string) => void;
  isDarkMode: boolean;
}

function LiveDeliveryMap({
  motoboys,
  activeOrders,
  focusPoint,
  selectedMotoboyFilter,
  onSelectMotoboyFilter,
  isDarkMode,
}: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const hasAutoFittedRef = useRef(false);

  const visibleMotoboys = useMemo(
    () =>
      selectedMotoboyFilter === "all"
        ? motoboys
        : motoboys.filter((m) => m.userId === selectedMotoboyFilter),
    [motoboys, selectedMotoboyFilter]
  );

  const visibleOrders = useMemo(
    () =>
      selectedMotoboyFilter === "all"
        ? activeOrders
        : activeOrders.filter((o) => o.motoboyUserId === selectedMotoboyFilter),
    [activeOrders, selectedMotoboyFilter]
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [-25.4284, -49.2733],
      zoom: 13,
      zoomControl: true,
    });

    const primaryLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    let fallbackApplied = false;
    primaryLayer.on("tileerror", () => {
      if (fallbackApplied) return;
      fallbackApplied = true;
      L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
    });

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      hasAutoFittedRef.current = false;
    };
  }, []);

  // Aplica estilo limpo de modo escuro somente no tile pane (sem inverter pins/popups)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const tilePane = map.getPane("tilePane");
    if (!tilePane) return;
    tilePane.style.filter = isDarkMode
      ? "invert(100%) hue-rotate(180deg) brightness(92%) contrast(92%)"
      : "none";
  }, [isDarkMode]);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const boundsPoints: L.LatLngExpression[] = [];

    // 1. Destinos ativos
    for (const order of visibleOrders) {
      if (order.destinationLat == null || order.destinationLng == null) continue;
      const pt: L.LatLngExpression = [order.destinationLat, order.destinationLng];
      boundsPoints.push(pt);

      const isInRoute = order.deliveryStatus === "in_route";
      const pinIcon = L.divIcon({
        className: "megadesk-delivery-pin",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;background:${
          isInRoute ? "#0284c7" : "#7c3aed"
        };color:#fff;border:2.5px solid #fff;box-shadow:0 6px 14px rgba(0,0,0,0.32);font-size:15px;">📍</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -32],
      });

      const ticketTag = order.ticketNumber ? `#${String(order.ticketNumber).padStart(4, "0")}` : "Pedido";
      L.marker(pt, { icon: pinIcon })
        .bindPopup(
          `<div style="min-width:190px;font-family:system-ui,sans-serif;font-size:12px;line-height:1.45;">
            <strong style="font-size:13px;">${ticketTag} · ${order.customerName}</strong><br/>
            <span>${order.deliveryAddress}</span><br/>
            <span style="color:#475569;">Entregador: <b>${order.motoboyName || "Aguardando"}</b> (Fila #${order.routeSequence})</span>
          </div>`
        )
        .addTo(group);
    }

    // 2. Motoboys com anel pulsante quando em rota + trajeto tracejado
    for (const mb of visibleMotoboys) {
      if (!mb.location) continue;
      const pt: L.LatLngExpression = [mb.location.lat, mb.location.lng];
      boundsPoints.push(pt);

      const inRoute = mb.status === "in_route";
      const bg = inRoute ? "#059669" : mb.isOnline ? "#0f172a" : "#64748b";
      const ring = inRoute
        ? "0 0 0 6px rgba(16,185,129,0.35), 0 0 0 12px rgba(16,185,129,0.14)"
        : mb.isOnline
          ? "0 0 0 4px rgba(16,185,129,0.28)"
          : "none";

      const mbIcon = L.divIcon({
        className: "megadesk-motoboy-pin",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:9999px;background:${bg};color:#fff;border:3px solid #fff;box-shadow:0 8px 18px rgba(0,0,0,0.35),${ring};font-size:19px;">🛵</div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
        popupAnchor: [0, -22],
      });

      const speedKmh =
        mb.location.speed != null && Number.isFinite(mb.location.speed)
          ? `${Math.round(mb.location.speed * 3.6)} km/h`
          : "—";

      L.marker(pt, { icon: mbIcon })
        .bindPopup(
          `<div style="min-width:205px;font-family:system-ui,sans-serif;font-size:12px;line-height:1.45;">
            <strong style="font-size:13px;">🛵 ${mb.name}</strong><br/>
            <span>Status: <b>${inRoute ? "Em Rota" : "Disponível"}</b> (${mb.isOnline ? "GPS Online" : "Offline"})</span><br/>
            <span>Velocidade: ${speedKmh} • GPS ${formatRelativeAgo(mb.location.updatedAt)}</span>
            ${
              mb.activeOrder
                ? `<br/><span style="color:#0369a1;font-weight:600;">Indo para: ${mb.activeOrder.customerName}</span><br/><span style="color:#64748b;">${mb.activeOrder.deliveryAddress}</span>`
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
            weight: 4,
            opacity: 0.9,
            dashArray: "8 6",
          }
        ).addTo(group);
      }
    }

    if (!hasAutoFittedRef.current && boundsPoints.length > 0) {
      if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0], 15);
      } else {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [50, 50], maxZoom: 16 });
      }
      hasAutoFittedRef.current = true;
    }
  }, [visibleMotoboys, visibleOrders]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPoint) return;
    map.setView([focusPoint.lat, focusPoint.lng], 16, { animate: true });
  }, [focusPoint]);

  const handleRecenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const pts: L.LatLngExpression[] = [];
    visibleMotoboys.forEach((m) => {
      if (m.location) pts.push([m.location.lat, m.location.lng]);
    });
    visibleOrders.forEach((o) => {
      if (o.destinationLat != null && o.destinationLng != null) {
        pts.push([o.destinationLat, o.destinationLng]);
      }
    });
    if (pts.length === 1) {
      map.setView(pts[0], 15, { animate: true });
    } else if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 16 });
    }
  };

  return (
    <div className="relative h-[540px] lg:h-[650px] w-full overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div ref={containerRef} data-testid="restaurant-live-map" className="h-full w-full z-0" />

      {/* Barra Flutuante Superior: Filtro Rápido por Motoboy + Centralizar */}
      <div className="pointer-events-none absolute top-3 left-14 right-3 z-[400] flex flex-wrap items-center justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto max-w-[75%] rounded-2xl border border-border bg-card/95 backdrop-blur px-2 py-1.5 shadow-md">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-1" />
          <button
            type="button"
            onClick={() => onSelectMotoboyFilter("all")}
            className={`rounded-xl px-2.5 py-1 text-xs font-bold whitespace-nowrap transition cursor-pointer ${
              selectedMotoboyFilter === "all"
                ? "bg-emerald-600 text-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Todos ({motoboys.length})
          </button>
          {motoboys.map((mb) => (
            <button
              key={mb.userId}
              type="button"
              onClick={() => {
                onSelectMotoboyFilter(mb.userId);
                if (mb.location && mapRef.current) {
                  mapRef.current.setView([mb.location.lat, mb.location.lng], 16, { animate: true });
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                selectedMotoboyFilter === mb.userId
                  ? "bg-emerald-600 text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  mb.status === "in_route"
                    ? "bg-emerald-400"
                    : mb.isOnline
                      ? "bg-sky-400"
                      : "bg-slate-400"
                }`}
              />
              {mb.name.split(" ")[0]}
            </button>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleRecenter}
          className="pointer-events-auto h-9 rounded-2xl bg-card/95 backdrop-blur border-border text-foreground text-xs font-bold shadow-md cursor-pointer"
        >
          <Crosshair className="w-3.5 h-3.5 mr-1.5" />
          Centralizar
        </Button>
      </div>
    </div>
  );
}

export function RestaurantTrackingWorkspace() {
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<TrackingTab>("live");
  const [selectedMotoboyFilter, setSelectedMotoboyFilter] = useState<string>("all");
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
      className="min-h-full w-full space-y-5 p-4 sm:p-6 bg-background text-foreground"
    >
      {/* Cabeçalho Executivo — Torre de Controle */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between rounded-3xl border border-border bg-card p-4 sm:p-5 shadow-xs">
        <div className="flex items-center gap-3.5 min-w-0">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
            <Bike className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground truncate">
                Torre de Controle &amp; Rastreamento
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                AO VIVO
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Monitoramento GPS em tempo real dos entregadores, despacho rápido e fechamento financeiro.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-2xl border border-border bg-muted/60 p-1">
            <button
              type="button"
              data-testid="tracking-tab-live"
              onClick={() => setActiveTab("live")}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                activeTab === "live"
                  ? "bg-card text-emerald-600 dark:text-emerald-400 shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              Operação ao Vivo
            </button>
            <button
              type="button"
              data-testid="tracking-tab-payouts"
              onClick={() => setActiveTab("payouts")}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
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
            className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
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
            className="h-9 rounded-xl text-xs font-semibold cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${
                liveQuery.isFetching || payoutQuery.isFetching ? "animate-spin" : ""
              }`}
            />
            Atualizar
          </Button>
        </div>
      </header>

      {/* ─── ABA 1: OPERAÇÃO AO VIVO ──────────────────────────────────────── */}
      {activeTab === "live" && (
        <div className="space-y-5">
          {/* Barra Compacta de 4 KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs flex items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Motoboys Online
                </span>
                <p className="mt-1 text-2xl font-black text-foreground">
                  {onlineCount}{" "}
                  <span className="text-xs font-semibold text-muted-foreground">/ {motoboys.length}</span>
                </p>
              </div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Radio className="h-5 w-5" />
              </span>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs flex items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Em Rota Agora
                </span>
                <p className="mt-1 text-2xl font-black text-sky-600 dark:text-sky-400">
                  {inRouteCount}
                </p>
              </div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <Bike className="h-5 w-5" />
              </span>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-xs flex items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Entregas Ativas
                </span>
                <p className="mt-1 text-2xl font-black text-foreground">{activeOrders.length}</p>
              </div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                <MapPin className="h-5 w-5" />
              </span>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-xs flex items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  Aguardando Atribuição
                </span>
                <p className="mt-1 text-2xl font-black text-amber-700 dark:text-amber-400">
                  {unassignedOrders.length}
                </p>
              </div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
                <Package className="h-5 w-5" />
              </span>
            </div>
          </div>

          {/* Grid Principal: Mapa (~65%) + Painel Operacional (~35%) */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <LiveDeliveryMap
                motoboys={motoboys}
                activeOrders={activeOrders}
                focusPoint={focusPoint}
                selectedMotoboyFilter={selectedMotoboyFilter}
                onSelectMotoboyFilter={setSelectedMotoboyFilter}
                isDarkMode={isDarkMode}
              />
            </div>

            <div className="xl:col-span-4 space-y-4">
              {/* Painel de Entregadores */}
              <section className="rounded-3xl border border-border bg-card p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                    Entregadores ({motoboys.length})
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Sync 5s
                  </span>
                </div>

                {motoboys.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-5 text-center space-y-2.5">
                    <p className="text-xs text-muted-foreground">
                      Nenhum motoboy cadastrado ainda. Crie o login de acesso do entregador em 1 clique.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setShowNewMotoboyModal(true)}
                      className="h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      Cadastrar Primeiro Motoboy
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                    {motoboys.map((mb) => {
                      const speedKmh =
                        mb.location?.speed != null && Number.isFinite(mb.location.speed)
                          ? `${Math.round(mb.location.speed * 3.6)} km/h`
                          : null;
                      const routeDuration = formatRouteDuration(mb.activeOrder?.startedAt);
                      const isSelected = selectedMotoboyFilter === mb.userId;

                      return (
                        <div
                          key={mb.userId}
                          onClick={() => {
                            setSelectedMotoboyFilter((curr) => (curr === mb.userId ? "all" : mb.userId));
                            if (mb.location) {
                              setFocusPoint({
                                lat: mb.location.lat,
                                lng: mb.location.lng,
                                token: Date.now(),
                              });
                            }
                          }}
                          className={`rounded-2xl border p-3.5 transition cursor-pointer space-y-2.5 ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-500/10"
                              : "border-border bg-muted/25 hover:border-emerald-500/40 hover:bg-muted/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2.5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="relative shrink-0">
                                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-black text-xs border border-emerald-500/30">
                                  {getInitials(mb.name)}
                                </span>
                                <span
                                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${
                                    mb.isOnline ? "bg-emerald-500" : "bg-slate-400"
                                  }`}
                                />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-extrabold text-foreground truncate">
                                  {mb.name}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {mb.location ? `GPS ${formatRelativeAgo(mb.location.updatedAt)}` : "Sem GPS"}
                                  {speedKmh ? ` • ${speedKmh}` : ""}
                                </p>
                              </div>
                            </div>

                            <span
                              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${
                                mb.status === "in_route"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                                  : "bg-muted text-muted-foreground border border-border"
                              }`}
                            >
                              {mb.status === "in_route" ? "Em Rota" : "Disponível"}
                            </span>
                          </div>

                          {mb.activeOrder ? (
                            <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <strong className="text-sky-900 dark:text-sky-200 truncate">
                                  {mb.activeOrder.ticketNumber
                                    ? `#${String(mb.activeOrder.ticketNumber).padStart(4, "0")} · `
                                    : ""}
                                  {mb.activeOrder.customerName}
                                </strong>
                                {routeDuration && (
                                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                                    <Clock className="h-3 w-3" />
                                    {routeDuration}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-sky-800/80 dark:text-sky-200/80 truncate">
                                {mb.activeOrder.deliveryAddress}
                              </p>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                              <span>Sem corrida em trânsito</span>
                              <span className="font-bold text-foreground">
                                Fila: {mb.queuedCount} {mb.queuedCount === 1 ? "pedido" : "pedidos"}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Fila de Despacho Rápido */}
              <section className="rounded-3xl border border-border bg-card p-4 shadow-xs space-y-3">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Despacho Rápido ({unassignedOrders.length})
                </h2>

                {unassignedOrders.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">
                    Todos os pedidos ativos já estão atribuídos.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-[250px] overflow-y-auto pr-1">
                    {unassignedOrders.map((order) => {
                      const chosen = assignChoiceByTicket[order.ticketId] ?? "";
                      return (
                        <div
                          key={order.id}
                          className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-foreground truncate">
                              {order.ticketNumber
                                ? `#${String(order.ticketNumber).padStart(4, "0")} · `
                                : ""}
                              {order.customerName}
                            </span>
                            <span className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">
                              {formatBRL(order.deliveryFee)}
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
                              className="min-w-0 flex-1 h-8 rounded-xl border border-border bg-background px-2.5 text-xs text-foreground"
                            >
                              <option value="">Escolher entregador...</option>
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
                              className="h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 cursor-pointer"
                            >
                              <UserCheck className="h-3.5 w-3.5 mr-1" />
                              Despachar
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* ─── ABA 2: FECHAMENTO & REPASSES ─────────────────────────────────── */}
      {activeTab === "payouts" && (
        <div data-testid="restaurant-payouts-view" className="space-y-5">
          {/* Barra de Filtros + Exportar CSV */}
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-3xl border border-border bg-card p-4 shadow-xs">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-muted-foreground mb-1">
                  Entregador
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
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer ${
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
              className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Exportar CSV
            </Button>
          </div>

          {/* 3 Cards de Resumo */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-border bg-card p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-sky-500" />
                Total de Entregas Concluídas
              </span>
              <p className="mt-2 text-3xl font-black text-foreground">
                {payout?.summary.totalDeliveries ?? 0}
              </p>
            </div>
            <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Total a Pagar (Repasses)
              </span>
              <p className="mt-2 text-3xl font-black text-emerald-700 dark:text-emerald-400">
                {formatBRL(payout?.summary.totalPayout ?? 0)}
              </p>
            </div>
            <div className="rounded-3xl border border-border bg-card p-5 shadow-xs">
              <span className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-indigo-500" />
                Taxa Média por Entrega
              </span>
              <p className="mt-2 text-3xl font-black text-foreground">
                {formatBRL(payout?.summary.averageFee ?? 0)}
              </p>
            </div>
          </div>

          {/* Resumo por Motoboy */}
          {payout && payout.byMotoboy.length > 0 && (
            <div className="rounded-3xl border border-border bg-card p-4 shadow-xs space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
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
                    className={`rounded-2xl border p-3.5 text-left transition cursor-pointer ${
                      payoutMotoboyId === m.motoboyUserId
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-border bg-muted/20 hover:border-emerald-500/40"
                    }`}
                  >
                    <p className="text-sm font-extrabold text-foreground truncate">🛵 {m.motoboyName}</p>
                    <div className="mt-1.5 flex items-baseline justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {m.deliveriesCount} {m.deliveriesCount === 1 ? "corrida" : "corridas"}
                      </span>
                      <strong className="text-base font-black text-emerald-700 dark:text-emerald-400">
                        {formatBRL(m.totalAmount)}
                      </strong>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tabela Limpa de Corridas */}
          <div className="rounded-3xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="border-b border-border bg-muted/30 px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                Detalhamento de Corridas Concluídas ({payout?.deliveries.length ?? 0})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-border bg-muted/20 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">Ticket</th>
                    <th className="px-4 py-3 font-bold">Entregue em</th>
                    <th className="px-4 py-3 font-bold">Motoboy</th>
                    <th className="px-4 py-3 font-bold">Cliente &amp; Endereço</th>
                    <th className="px-4 py-3 font-bold">Pagamento</th>
                    <th className="px-4 py-3 font-bold text-right">Valor Pedido</th>
                    <th className="px-4 py-3 font-bold text-right">Repasse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payoutQuery.isLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        Carregando fechamento...
                      </td>
                    </tr>
                  ) : !payout || payout.deliveries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
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
                          {formatDateTime(d.deliveredAt)}
                        </td>
                        <td className="px-4 py-3 font-bold text-foreground">{d.motoboyName}</td>
                        <td className="px-4 py-3 max-w-[260px]">
                          <p className="font-semibold text-foreground truncate">{d.customerName}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{d.deliveryAddress}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                            {d.paymentMethod}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">
                          {formatBRL(d.orderTotal)}
                        </td>
                        <td className="px-4 py-3 text-right font-black text-emerald-700 dark:text-emerald-400">
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
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Bike className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-extrabold text-foreground">Cadastrar Novo Motoboy</h3>
                  <p className="text-xs text-muted-foreground">
                    Cria o login mobile exclusivo de entregas, GPS e extrato de ganhos.
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
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
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
