import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Bike,
  CheckCircle2,
  ChefHat,
  Clock,
  MapPin,
  MessageCircle,
  Package,
  PartyPopper,
  Receipt,
  ShieldCheck,
  Store,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

const formatRelativeAgo = (iso?: string | null) => {
  if (!iso) return "agora";
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 10) return "agora";
  if (sec < 60) return `há ${sec}s`;
  return `há ${Math.floor(sec / 60)}min`;
};

function getProgressStep(deliveryStatus: string, stageLabel: string): number {
  if (deliveryStatus === "delivered") return 4;
  if (deliveryStatus === "in_route") return 3;
  const lower = stageLabel.toLowerCase();
  if (deliveryStatus === "assigned" || lower.includes("preparo") || lower.includes("pronto")) return 2;
  return 1;
}

function PublicRouteMap({
  motoboyLocation,
  destinationLocation,
  motoboyFirstName,
}: {
  motoboyLocation: { lat: number; lng: number; updatedAt: string | null } | null;
  destinationLocation: { lat: number; lng: number } | null;
  motoboyFirstName: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialCenter: L.LatLngExpression = motoboyLocation
      ? [motoboyLocation.lat, motoboyLocation.lng]
      : destinationLocation
        ? [destinationLocation.lat, destinationLocation.lng]
        : [-25.4284, -49.2733];

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: 15,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19,
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const pts: L.LatLngExpression[] = [];

    if (destinationLocation) {
      const dest: L.LatLngExpression = [destinationLocation.lat, destinationLocation.lng];
      pts.push(dest);
      const destIcon = L.divIcon({
        className: "public-dest-pin",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9999px;background:#ef4444;color:#fff;border:3px solid #fff;box-shadow:0 6px 16px rgba(0,0,0,0.28);font-size:17px;">📍</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });
      L.marker(dest, { icon: destIcon }).addTo(group);
    }

    if (motoboyLocation) {
      const mb: L.LatLngExpression = [motoboyLocation.lat, motoboyLocation.lng];
      pts.push(mb);
      const mbIcon = L.divIcon({
        className: "public-motoboy-pin",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:9999px;background:#059669;color:#fff;border:3px solid #fff;box-shadow:0 8px 20px rgba(5,150,105,0.45),0 0 0 6px rgba(16,185,129,0.25);font-size:20px;">🛵</div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
      L.marker(mb, { icon: mbIcon })
        .bindPopup(`<strong>🛵 ${motoboyFirstName || "Entregador"}</strong>`)
        .addTo(group);

      if (destinationLocation) {
        L.polyline([mb, [destinationLocation.lat, destinationLocation.lng]], {
          color: "#059669",
          weight: 4,
          opacity: 0.85,
          dashArray: "8 6",
        }).addTo(group);
      }
    }

    if (pts.length === 1) {
      map.setView(pts[0], 16, { animate: fittedRef.current });
      fittedRef.current = true;
    } else if (pts.length === 2 && !fittedRef.current) {
      map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16 });
      fittedRef.current = true;
    }
  }, [motoboyLocation, destinationLocation, motoboyFirstName]);

  return (
    <div className="relative h-[44vh] min-h-[280px] max-h-[420px] w-full bg-slate-100">
      <div ref={containerRef} data-testid="public-live-map" className="h-full w-full z-0" />
    </div>
  );
}

export function PublicDeliveryTrackingPage({ token }: { token: string }) {
  const validFormat = token.trim().length >= 16 && token.trim().length <= 64;

  const trackQuery = trpc.delivery.publicTrackByToken.useQuery(
    { token: token.trim() },
    {
      enabled: validFormat,
      refetchInterval: (query) => {
        const state = query.state.data?.state;
        return state === "active" ? 5_000 : false;
      },
      refetchOnWindowFocus: true,
      retry: false,
    }
  );

  const data = trackQuery.data;
  const restaurantName = data?.restaurant?.name || "Acompanhamento de Pedido";

  useEffect(() => {
    if (data?.restaurant?.name) {
      document.title = `Acompanhe seu pedido • ${data.restaurant.name}`;
    } else {
      document.title = "Acompanhamento de Pedido";
    }
  }, [data?.restaurant?.name]);

  // Carregando
  if (validFormat && trackQuery.isLoading) {
    return (
      <div
        data-testid="public-tracking-loading"
        className="min-h-screen w-full bg-slate-50 flex flex-col items-center justify-center p-6 text-center"
      >
        <div className="h-14 w-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center animate-pulse mb-4">
          <Bike className="h-7 w-7" />
        </div>
        <p className="text-base font-bold text-slate-800">Carregando status do seu pedido...</p>
        <p className="text-xs text-slate-500 mt-1">Conectando ao acompanhamento ao vivo.</p>
      </div>
    );
  }

  // Expirado ou Inválido (tela neutra elegante, sem erro técnico nem marca externa)
  if (!validFormat || trackQuery.isError || !data || data.state === "not_found" || data.state === "expired") {
    return (
      <div
        data-testid="public-tracking-expired"
        className="min-h-screen w-full bg-slate-50 flex flex-col items-center justify-center p-6"
      >
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm space-y-4">
          {data?.restaurant?.logoUrl ? (
            <img
              src={data.restaurant.logoUrl}
              alt={restaurantName}
              className="h-14 w-14 rounded-2xl object-cover mx-auto border border-slate-100"
            />
          ) : (
            <div className="h-14 w-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
              <Clock className="h-7 w-7" />
            </div>
          )}
          <div className="space-y-1.5">
            <h1 className="text-xl font-extrabold text-slate-900">
              Link de rastreamento expirado
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Este link temporário não está mais ativo. Por segurança, o acompanhamento expira automaticamente após a conclusão da entrega.
            </p>
          </div>
          {data?.restaurant?.whatsappPhone && (
            <a
              href={`https://wa.me/${data.restaurant.whatsappPhone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 transition"
            >
              <MessageCircle className="h-4 w-4" />
              Falar com {data.restaurant.name}
            </a>
          )}
        </div>
      </div>
    );
  }

  const { restaurant, order } = data;
  if (!restaurant || !order) return null;

  // Tela Celebratória: Pedido Entregue (janela de 30 min)
  if (data.state === "delivered_recent") {
    return (
      <div
        data-testid="public-tracking-delivered"
        className="min-h-screen w-full bg-gradient-to-b from-emerald-50 via-white to-slate-50 flex flex-col items-center justify-center p-5"
      >
        <div className="w-full max-w-md rounded-3xl border border-emerald-200 bg-white p-7 text-center shadow-lg space-y-5">
          <div className="flex flex-col items-center gap-3">
            {restaurant.logoUrl ? (
              <img
                src={restaurant.logoUrl}
                alt={restaurant.name}
                className="h-16 w-16 rounded-2xl object-cover border border-slate-100 shadow-xs"
              />
            ) : (
              <div className="h-16 w-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                <PartyPopper className="h-8 w-8" />
              </div>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              Entregue com sucesso
            </span>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900">
              Pedido entregue! Bom apetite!
            </h1>
            <p className="text-sm text-slate-600">
              Obrigado por pedir com <strong className="text-slate-900">{restaurant.name}</strong>.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Pedido</span>
              <strong className="font-mono text-slate-900">
                {order.ticketNumber ? `#${String(order.ticketNumber).padStart(4, "0")}` : "Concluído"}
              </strong>
            </div>
            {order.itemsSummary && (
              <p className="text-slate-700 pt-1 border-t border-slate-200/70 whitespace-pre-wrap">
                {order.itemsSummary}
              </p>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-slate-200/70">
              <span className="text-slate-500">Total ({order.paymentMethod})</span>
              <strong className="text-sm text-slate-900">{formatBRL(order.orderTotal)}</strong>
            </div>
          </div>

          {restaurant.whatsappPhone && (
            <a
              href={`https://wa.me/${restaurant.whatsappPhone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 transition"
            >
              <MessageCircle className="h-4 w-4" />
              Falar com {restaurant.name}
            </a>
          )}
        </div>
      </div>
    );
  }

  // Tela Ativa estilo iFood / 99
  const step = getProgressStep(order.deliveryStatus, order.stageLabel);
  const isInRoute = order.deliveryStatus === "in_route";
  const steps = [
    { num: 1, label: "Pedido Recebido", icon: Receipt },
    { num: 2, label: "Em Preparo", icon: ChefHat },
    { num: 3, label: "Saiu p/ Entrega", icon: Bike },
    { num: 4, label: "Entregue", icon: CheckCircle2 },
  ];

  return (
    <div
      data-testid="public-tracking-active"
      className="min-h-screen w-full bg-slate-100 text-slate-900 flex flex-col"
    >
      {/* Header Exclusivo do Restaurante (ZERO menção a sistemas internos) */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 backdrop-blur px-4 py-3 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          {restaurant.logoUrl ? (
            <img
              src={restaurant.logoUrl}
              alt={restaurant.name}
              className="h-10 w-10 rounded-xl object-cover border border-slate-200 shrink-0"
            />
          ) : (
            <div className="h-10 w-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Store className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-slate-900 truncate">{restaurant.name}</h1>
            <p className="text-xs text-slate-500">
              {order.ticketNumber
                ? `Pedido #${String(order.ticketNumber).padStart(4, "0")}`
                : "Acompanhamento em tempo real"}
            </p>
          </div>
        </div>

        {restaurant.whatsappPhone && (
          <a
            href={`https://wa.me/${restaurant.whatsappPhone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 shrink-0"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Ajuda
          </a>
        )}
      </header>

      {/* Mapa ao Vivo no Topo (quando em rota) */}
      {isInRoute && (
        <PublicRouteMap
          motoboyLocation={order.motoboyLocation}
          destinationLocation={order.destinationLocation}
          motoboyFirstName={order.motoboyFirstName}
        />
      )}

      {/* Bottom Sheet / Cartão Principal */}
      <main
        className={`relative z-10 mx-auto w-full max-w-xl flex-1 px-4 pb-8 ${
          isInRoute ? "-mt-5" : "pt-5"
        } space-y-4`}
      >
        {/* Status Principal + Previsão + Barra de Progresso 4 Etapas */}
        <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-md space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                {isInRoute ? "A caminho do seu endereço" : order.stageLabel}
              </span>
              <h2 className="mt-1.5 text-xl font-black text-slate-900">
                {isInRoute
                  ? "Seu pedido saiu para entrega!"
                  : step === 2
                    ? "Seu pedido está sendo preparado"
                    : "Recebemos o seu pedido!"}
              </h2>
            </div>

            {isInRoute && order.estimatedMinutes && (
              <div className="rounded-2xl bg-slate-900 px-3.5 py-2 text-center text-white shrink-0">
                <span className="block text-[10px] font-bold uppercase text-slate-400">
                  Previsão
                </span>
                <span className="text-lg font-black leading-none">
                  ~{order.estimatedMinutes} min
                </span>
              </div>
            )}
          </div>

          {/* Barra de Progresso em 4 Etapas */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {steps.map((s) => {
              const Icon = s.icon;
              const done = step >= s.num;
              const current = step === s.num;
              return (
                <div key={s.num} className="flex flex-col items-center text-center gap-1.5">
                  <div
                    className={`h-2 w-full rounded-full transition-all ${
                      done ? "bg-emerald-500" : "bg-slate-200"
                    }`}
                  />
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full ${
                      current
                        ? "bg-emerald-600 text-white shadow-sm"
                        : done
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <span
                    className={`text-[10px] leading-tight font-bold ${
                      done ? "text-slate-900" : "text-slate-400"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Código de Confirmação de 4 Dígitos em Destaque */}
        {order.deliveryCode && (
          <section
            data-testid="public-delivery-code-box"
            className="rounded-3xl border-2 border-emerald-500/40 bg-emerald-50/70 p-5 text-center shadow-xs space-y-2"
          >
            <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Código de Confirmação
            </p>
            <div className="mx-auto inline-flex items-center justify-center rounded-2xl bg-white border border-emerald-200 px-6 py-3 shadow-xs">
              <span className="font-mono text-4xl font-black tracking-[0.35em] text-emerald-700 pl-[0.35em]">
                {order.deliveryCode}
              </span>
            </div>
            <p className="text-xs font-medium text-emerald-900">
              Informe este código ao entregador ao receber seu pedido.
            </p>
          </section>
        )}

        {/* Cartão do Entregador (apenas primeiro nome) */}
        {order.motoboyFirstName && (
          <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl">
                🛵
              </div>
              <div>
                <span className="block text-[11px] font-bold uppercase text-slate-400">
                  Entregador
                </span>
                <p className="text-base font-extrabold text-slate-900">{order.motoboyFirstName}</p>
              </div>
            </div>
            {isInRoute && order.motoboyLocation && (
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-[11px] font-bold text-emerald-700">
                GPS {formatRelativeAgo(order.motoboyLocation.updatedAt)}
              </span>
            )}
          </section>
        )}

        {/* Resumo Seguro do Pedido & Endereço Mascarado */}
        <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-start gap-3">
            <MapPin className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <span className="block text-[11px] font-bold uppercase text-slate-400">
                Endereço de Entrega
              </span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {order.deliveryAddressMasked}
              </p>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 flex items-start gap-3">
            <Package className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-2">
              <span className="block text-[11px] font-bold uppercase text-slate-400">
                Resumo do Pedido
              </span>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {order.itemsSummary || "Pedido confirmado pelo restaurante."}
              </p>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-sm">
                <span className="text-slate-500">Total ({order.paymentMethod})</span>
                <strong className="text-base font-black text-slate-900">
                  {formatBRL(order.orderTotal)}
                </strong>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

