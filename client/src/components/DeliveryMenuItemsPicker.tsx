import React, { useMemo, useState } from "react";
import { Minus, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

export interface SelectedDeliveryItem {
  productPublicId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

export function computeDeliveryTotals(items: readonly SelectedDeliveryItem[], deliveryFee: number) {
  const itemsSubtotal = Number(
    items.reduce((acc, it) => acc + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0).toFixed(2)
  );
  const fee = Math.max(0, Number(deliveryFee || 0));
  const orderTotal = Number((itemsSubtotal + fee).toFixed(2));
  const summary = items
    .map((it) => `${it.quantity}x ${it.name} (${formatBRL(it.quantity * it.unitPrice)})`)
    .join(", ");
  return { itemsSubtotal, deliveryFee: fee, orderTotal, summary };
}

export function DeliveryMenuItemsPicker({
  items,
  onChange,
  deliveryFee,
  onDeliveryFeeChange,
  compact = false,
}: {
  items: SelectedDeliveryItem[];
  onChange: (next: SelectedDeliveryItem[]) => void;
  deliveryFee: string;
  onDeliveryFeeChange: (nextFee: string) => void;
  compact?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const catalogQuery = trpc.delivery.menuCatalog.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const catalog = catalogQuery.data?.items ?? [];

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog.slice(0, 30);
    return catalog
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.category || "").toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [catalog, search]);

  const addProduct = (product: { id: string; name: string; price: number }) => {
    const existing = items.find((it) => it.productPublicId === product.id);
    if (existing) {
      onChange(
        items.map((it) =>
          it.productPublicId === product.id ? { ...it, quantity: it.quantity + 1 } : it
        )
      );
    } else {
      onChange([
        ...items,
        {
          productPublicId: product.id,
          name: product.name,
          quantity: 1,
          unitPrice: product.price,
        },
      ]);
    }
    setSearch("");
    setDropdownOpen(false);
  };

  const updateQty = (productPublicId: string, delta: number) => {
    onChange(
      items
        .map((it) =>
          it.productPublicId === productPublicId
            ? { ...it, quantity: it.quantity + delta }
            : it
        )
        .filter((it) => it.quantity > 0)
    );
  };

  const removeItem = (productPublicId: string) => {
    onChange(items.filter((it) => it.productPublicId !== productPublicId));
  };

  const totals = computeDeliveryTotals(items, Number(deliveryFee || 0));

  return (
    <div data-testid="delivery-menu-picker" className="space-y-3">
      {/* Busca e Dropdown de Produtos do Cardápio (ERP > Produtos) */}
      <div className="relative">
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Itens do Cardápio (ERP &gt; Produtos)
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => window.setTimeout(() => setDropdownOpen(false), 180)}
            onChange={(e) => {
              setSearch(e.target.value);
              setDropdownOpen(true);
            }}
            placeholder={
              catalogQuery.isLoading
                ? "Carregando cardápio..."
                : catalog.length === 0
                  ? "Nenhum produto ativo em ERP > Produtos"
                  : "Buscar produto do cardápio por nome, categoria ou código..."
            }
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {dropdownOpen && (
          <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
            {catalogQuery.isLoading ? (
              <div className="px-3 py-3 text-xs text-slate-500">Carregando produtos...</div>
            ) : filteredCatalog.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500">
                {catalog.length === 0
                  ? "Cadastre pratos e bebidas em ERP > Produtos para selecioná-los aqui."
                  : "Nenhum item do cardápio encontrado com essa busca."}
              </div>
            ) : (
              filteredCatalog.map((prod) => (
                <button
                  key={prod.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addProduct(prod);
                  }}
                  className="w-full px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-emerald-50 transition cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">{prod.name}</p>
                    {prod.category && (
                      <span className="text-[10px] text-slate-500">{prod.category}</span>
                    )}
                  </div>
                  <span className="shrink-0 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-bold text-emerald-700">
                    {formatBRL(prod.price)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Lista de Itens Selecionados */}
      {items.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 divide-y divide-slate-200/80">
          {items.map((item) => (
            <div
              key={item.productPublicId}
              className={`flex items-center justify-between gap-2 ${compact ? "px-2.5 py-2" : "px-3 py-2.5"}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 truncate">{item.name}</p>
                <p className="text-[11px] text-slate-500">
                  {formatBRL(item.unitPrice)} un.
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => updateQty(item.productPublicId, -1)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                  aria-label="Diminuir quantidade"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-7 text-center text-xs font-extrabold text-slate-900">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => updateQty(item.productPublicId, 1)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                  aria-label="Aumentar quantidade"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              <div className="w-20 text-right shrink-0">
                <span className="text-xs font-extrabold text-slate-900">
                  {formatBRL(item.quantity * item.unitPrice)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => removeItem(item.productPublicId)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 cursor-pointer"
                aria-label="Remover item"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-3 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <ShoppingBag className="h-4 w-4 text-slate-400" />
          <span>Selecione um ou mais produtos do cardápio acima para montar o pedido.</span>
        </div>
      )}

      {/* Subtotal + Taxa de Entrega + Total Calculado Automaticamente */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
        <div>
          <span className="block text-[11px] font-semibold text-slate-600">Subtotal dos itens</span>
          <strong className="text-sm font-extrabold text-slate-900">
            {formatBRL(totals.itemsSubtotal)}
          </strong>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
            Taxa de entrega (R$)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={deliveryFee}
            onChange={(e) => onDeliveryFeeChange(e.target.value)}
            className="w-full h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-900"
          />
        </div>

        <div className="sm:text-right">
          <span className="block text-[11px] font-bold uppercase text-emerald-700">
            Total do Pedido
          </span>
          <strong data-testid="delivery-picker-total" className="text-base font-black text-emerald-700">
            {formatBRL(totals.orderTotal)}
          </strong>
        </div>
      </div>
    </div>
  );
}

