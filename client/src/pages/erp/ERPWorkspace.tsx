import React from "react";
import { io } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/conversationDateTime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, Boxes, Image as ImageIcon, LayoutGrid, LayoutList, PackagePlus, Search, Trash2, TrendingDown, Upload, WalletCards } from "lucide-react";
import { SuppliersPage } from "./SuppliersPage";
import { ClientesPage } from "../ClientesPage";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";
import { PurchasesPage } from "./PurchasesPage";
import { SalesPage } from "./SalesPage";
import { FinancePage } from "./FinancePage";
import { FiscalPage } from "./FiscalPage";
import { ReportsPage } from "./ReportsPage";
import type { ModuleTopbarItem } from "@/components/ModuleTopbar";
import { ErpPageHeader } from "@/components/erp/ErpPageHeader";
import { Pagination } from "@/components/erp/Pagination";
import { ErpEmptyState } from "@/components/erp/ErpEmptyState";
import { ProductDetailPanel } from "./ProductDetailPanel";
import { productMediaUrl } from "@/lib/trpc-url";
import {
  ProductFormDialog,
  type ProductForm,
  emptyProduct,
  prepareProductCommand,
} from "./ProductFormDialog";

export type ErpSection = "summary" | "clients" | "products" | "stock" | "suppliers" | "purchases" | "sales" | "finance" | "fiscal" | "reports";
const planned = ["Integrações"];

export function getErpTopbarItems({
  canAccessClients,
  canAccessFinance,
  canAccessFiscal,
  canAccessReports,
  onNavigate,
}: {
  canAccessClients: boolean;
  canAccessFinance: boolean;
  canAccessFiscal: boolean;
  canAccessReports: boolean;
  onNavigate: (section: ErpSection) => void;
}): ModuleTopbarItem[] {
  const available = [
    {id:"summary" as const,label:"Resumo"},
    {id:"clients" as const,label:"Clientes",hidden:!canAccessClients},
    {id:"products" as const,label:"Produtos"},
    {id:"stock" as const,label:"Estoque"},
    {id:"suppliers" as const,label:"Fornecedores"},
    {id:"purchases" as const,label:"Compras"},
    {id:"sales" as const,label:"Vendas"},
    {id:"finance" as const,label:"Financeiro",hidden:!canAccessFinance},
    {id:"fiscal" as const,label:"Fiscal",hidden:!canAccessFiscal},
    {id:"reports" as const,label:"Relatórios",hidden:!canAccessReports},
  ];

  return [
    ...available.map(item => ({ ...item, onSelect: () => onNavigate(item.id) })),
    ...planned.map(label => ({ id: `planned-${label}`, label, disabled: true, unavailableReason: "Em preparação" })),
  ];
}
type StockForm = { productPublicId: string; type: "manual_in" | "manual_out" | "adjustment_in" | "adjustment_out"; quantity: string; reason: string; idempotencyKey: string };
type StockFilterType = "all" | "initial" | "manual_in" | "manual_out" | "adjustment_in" | "adjustment_out" | "purchase_in" | "sale_out" | "reversal";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const cents = (value: string) => { const normalized = value.replace(/\./g, "").replace(",", "."); const parsed = Number(normalized); return Number.isFinite(parsed) ? Math.round(parsed * 100) : -1; };
const formatQuantity = (value: string) => Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const newKey = () => crypto.randomUUID();

function useErpRealtime() {
  const utils = trpc.useUtils();
  React.useEffect(() => {
    const socket = io(window.location.origin, { path: "/api/ws/whatsapp", withCredentials: true });
    let refreshTimer: number | undefined;
    const refresh = () => { window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(() => void utils.erp.reports.invalidate(), 250); };
    const refreshSuppliers = () => { refresh(); };
    socket.on("connect", refresh);
    socket.on("erp:product.changed", refresh);
    socket.on("erp:stock.changed", refresh);
    socket.on("erp:supplier.changed", refreshSuppliers);
    socket.on("erp:purchase.changed", refresh);
    socket.on("erp:sale.changed", refresh);
    socket.on("erp:finance.entry.changed", refresh);
    socket.on("erp:finance.account.changed", refresh);
    socket.on("erp:fiscal.document.changed", refresh);
    socket.on("erp:fiscal.settings.changed", refresh);
    return () => {
      window.clearTimeout(refreshTimer);
      socket.off("connect", refresh);
      socket.off("erp:product.changed", refresh);
      socket.off("erp:stock.changed", refresh);
      socket.off("erp:supplier.changed", refreshSuppliers);
      socket.off("erp:purchase.changed", refresh);
      socket.off("erp:sale.changed", refresh);
      socket.off("erp:finance.entry.changed", refresh);
      socket.off("erp:finance.account.changed", refresh);
      socket.off("erp:fiscal.document.changed", refresh);
      socket.off("erp:fiscal.settings.changed", refresh);
      socket.disconnect();
    };
  }, [utils]);
}

function StateMessage({ title, retry }: { title: string; retry?: () => void }) {
  return <ErpEmptyState title={title} action={retry ? { label: "Tentar novamente", onClick: retry } : undefined} />;
}

export function ERPWorkspace({ section, onNavigate, canAccessClients, canAccessFinance, canAccessFiscal, canAccessReports, initialCrmClientId, onClientNavigate, whatsappConnected, canStartConversation }: { section: ErpSection; onNavigate: (section: ErpSection) => void; canAccessClients: boolean; canAccessFinance: boolean; canAccessFiscal: boolean; canAccessReports: boolean; initialCrmClientId?: string; onClientNavigate: (intent: CrmWhatsAppIntent) => void; whatsappConnected: boolean; canStartConversation: boolean }) {
  useErpRealtime();
  const denied = <div role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-xl font-bold text-slate-900">Acesso indisponível</h1><p className="mt-2 text-sm text-slate-600">Este módulo não está disponível para o seu perfil.</p></div>;
  const content = section === "summary" ? <Summary onNavigate={onNavigate}/> : section === "clients" ? canAccessClients ? <ClientesPage initialSelectedId={initialCrmClientId} onNavigate={onClientNavigate} whatsappConnected={whatsappConnected} canStartConversation={canStartConversation}/> : denied : section === "products" ? <Products/> : section === "suppliers" ? <SuppliersPage/> : section === "purchases" ? <PurchasesPage/> : section === "sales" ? <SalesPage/> : section === "finance" ? canAccessFinance ? <FinancePage/> : denied : section === "fiscal" ? canAccessFiscal ? <FiscalPage/> : denied : section === "reports" ? canAccessReports ? <ReportsPage/> : denied : <Stock/>;
  return <div className="min-w-0 max-w-full" data-testid="erp-workspace">{content}</div>;
}

function Summary({ onNavigate }: { onNavigate: (section: ErpSection) => void }) {
  const query = trpc.erp.summary.useQuery();
  if (query.isLoading) return <StateMessage title="Carregando resumo do ERP…"/>;
  if (query.error) return <StateMessage title="Não foi possível carregar o resumo." retry={() => void query.refetch()}/>;
  if (!query.data) return null;
  const data = query.data;
  const cards = [
    ["Produtos ativos", data.metrics.activeProducts, Boxes], ["Produtos inativos", data.metrics.inactiveProducts, Boxes],
    ["Estoque baixo", data.metrics.lowProducts, TrendingDown], ["Sem estoque", data.metrics.emptyProducts, AlertCircle],
    ["Valor pelo custo", money.format(data.metrics.costValueCents / 100), WalletCards], ["Potencial de venda", money.format(data.metrics.saleValueCents / 100), WalletCards],
  ] as const;
  return <div className="space-y-6" data-testid="erp-summary-page">
    <header><h1 className="text-2xl font-bold text-slate-900">Resumo do ERP</h1></header>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label,value,Icon]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Icon className="mb-3 h-5 w-5 text-blue-600"/><p className="text-sm text-slate-500">{label}</p><p className="mt-1 break-words text-2xl font-bold text-slate-900">{value}</p></article>)}</div>
    {data.metrics.activeProducts + data.metrics.inactiveProducts === 0 ? <StateMessage title="Nenhum produto cadastrado. Cadastre o primeiro produto para iniciar o estoque."/> : <div className="grid gap-6 lg:grid-cols-2"><section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Estoque crítico</h2>{data.critical.length ? data.critical.map(product => <p key={product.publicId} className="mt-3 flex flex-wrap justify-between gap-2 text-sm"><span>{product.name}</span><span>{formatQuantity(product.quantity)} / mín. {formatQuantity(product.minimumStock)}</span></p>) : <p className="mt-3 text-sm text-slate-500">Nenhum alerta.</p>}</section><section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Movimentações recentes</h2>{data.recent.length ? data.recent.map(item => <p key={item.publicId} className="mt-3 text-sm">{item.productName}: {item.direction === "in" ? "+" : "-"}{formatQuantity(item.quantity)}</p>) : <p className="mt-3 text-sm text-slate-500">Nenhuma movimentação.</p>}</section></div>}
    {data.canWrite && <div className="flex flex-wrap gap-3"><Button onClick={() => onNavigate("products")}><PackagePlus className="mr-2 h-4 w-4"/>Cadastrar produto</Button><Button variant="outline" onClick={() => onNavigate("stock")}>Movimentar estoque</Button></div>}
  </div>;
}

export function ProductThumbnail({
  product,
  className = "h-16 w-16",
  version = 0,
}: {
  product: { publicId: string; name: string; hasImage?: boolean | null; updatedAt?: string | Date };
  className?: string;
  version?: number;
}) {
  const [failed, setFailed] = React.useState(false);
  const resolvedVersion = version || (product.updatedAt ? new Date(product.updatedAt).getTime() : 0);
  React.useEffect(() => setFailed(false), [product.publicId, product.hasImage, resolvedVersion]);
  const frame = `${className} shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm`;
  if (!product.hasImage || failed) {
    return (
      <div
        className={`${frame} flex items-center justify-center`}
        data-testid="product-image-placeholder"
        aria-label={`Sem foto para ${product.name}`}
      >
        <ImageIcon className="h-5 w-5 text-slate-400" />
      </div>
    );
  }
  return (
    <img
      src={productMediaUrl(`/api/products/${product.publicId}/image?variant=thumbnail&v=${resolvedVersion}`)}
      crossOrigin="use-credentials"
      alt={`Foto de ${product.name}`}
      loading="lazy"
      decoding="async"
      className={`${frame} object-cover`}
      onError={() => setFailed(true)}
    />
  );
}

function Products() {
  const utils = trpc.useUtils();
  const [viewMode, setViewMode] = React.useState<"table" | "cards">("table");
  const [search,setSearch]=React.useState(""); const [active,setActive]=React.useState<"all"|"active"|"inactive">("all"); const [category,setCategory]=React.useState(""); const [stock,setStock]=React.useState<"all"|"empty"|"low"|"normal">("all"); const [sort,setSort]=React.useState<"name"|"sku"|"createdAt"|"stock">("name"); const [direction,setDirection]=React.useState<"asc"|"desc">("asc"); const [page,setPage]=React.useState(1); const [pageSize,setPageSize]=React.useState(20); const [form,setForm]=React.useState<ProductForm|null>(null); const [message,setMessage]=React.useState(""); const [photo,setPhoto]=React.useState<File|null>(null); const [photoPreview,setPhotoPreview]=React.useState<string|null>(null); const [removePhoto,setRemovePhoto]=React.useState(false); const [mediaPending,setMediaPending]=React.useState(false); const [mediaVersions,setMediaVersions]=React.useState<Record<string,number>>({});
  const [selectedProductPublicId, setSelectedProductPublicId] = React.useState<string | null>(null);
  React.useEffect(()=>()=>{if(photoPreview?.startsWith("blob:"))URL.revokeObjectURL(photoPreview)},[photoPreview]);
  const resetPage = () => setPage(1);
  const query = trpc.erp.products.list.useQuery({ search, active: active === "all" ? undefined : active === "active", category: category || undefined, stock, sort, direction, page, pageSize });
  const done = async (text:string) => { setForm(null); setMessage(text); await utils.erp.invalidate(); };
  const create = trpc.erp.products.create.useMutation();
  const update = trpc.erp.products.update.useMutation();
  const status = trpc.erp.products.setActive.useMutation({ onSuccess: async () => { setMessage("Status atualizado com sucesso."); await utils.erp.invalidate(); } });
  const submittingRef = React.useRef(false);
  const pending=create.isPending||update.isPending||mediaPending;
  const clearPhoto=()=>{if(photoPreview?.startsWith("blob:"))URL.revokeObjectURL(photoPreview);setPhoto(null);setPhotoPreview(null);setRemovePhoto(false)};
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if(!form || pending || submittingRef.current) return;
    submittingRef.current = true;
    const command = prepareProductCommand(form);
    if (command.costPriceCents < 0 || command.salePriceCents < 0) {
      submittingRef.current = false;
      setMessage("Informe valores monetários válidos.");
      return;
    }
    const isNew = !form.publicId;
    try {
      const product = form.publicId
        ? await update.mutateAsync({ ...command, publicId: form.publicId })
        : await create.mutateAsync(command);

      // Once persisted, immediately bind publicId so any retry acts as update
      if (isNew && product?.publicId) {
        setForm(curr => curr ? { ...curr, publicId: product.publicId } : null);
      }

      let photoUploadWarning: string | null = null;
      if (photo || removePhoto) {
        setMediaPending(true);
        try {
          const response = await fetch(productMediaUrl(`/api/products/${product.publicId}/image`),
            photo
              ? {
                  method: "PUT",
                  credentials: "include",
                  headers: {
                    "Content-Type": photo.type || "application/octet-stream",
                    "x-client-attempt-id": crypto.randomUUID(),
                  },
                  body: photo,
                }
              : { method: "DELETE", credentials: "include" }
          );
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            photoUploadWarning = body.error || "Não foi possível salvar a foto.";
          } else {
            setMediaVersions(current => ({
              ...current,
              [product.publicId]: (current[product.publicId] ?? 0) + 1,
            }));
          }
        } catch (mediaErr) {
          photoUploadWarning = mediaErr instanceof Error ? mediaErr.message : "Falha na comunicação de mídia.";
        }
      }
      clearPhoto();
      if (photoUploadWarning) {
        await done(
          isNew
            ? `Produto cadastrado com sucesso! Aviso de foto: ${photoUploadWarning}`
            : `Produto atualizado com sucesso! Aviso de foto: ${photoUploadWarning}`
        );
      } else {
        await done(isNew ? "Produto cadastrado com sucesso." : "Produto atualizado com sucesso.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar o produto.");
    } finally {
      submittingRef.current = false;
      setMediaPending(false);
    }
  };
  const edit = (product: NonNullable<typeof query.data>["items"][number]) => {
    clearPhoto();
    setPhotoPreview(
      product.hasImage
        ? productMediaUrl(`/api/products/${product.publicId}/image?variant=thumbnail&v=${mediaVersions[product.publicId] ?? 0}`)
        : null
    );
    setForm({
      publicId: product.publicId,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? "",
      category: product.categoryRelational?.name ?? product.category ?? "",
      categoryPublicId: product.categoryPublicId ?? product.categoryRelational?.publicId ?? null,
      brandPublicId: product.brandPublicId ?? product.brand?.publicId ?? null,
      unit: product.unit,
      cost: (product.costPriceCents / 100).toFixed(2).replace(".", ","),
      sale: (product.salePriceCents / 100).toFixed(2).replace(".", ","),
      minimumStock: product.minimumStock,
      description: product.description ?? "",
    });
  };
  const reset = () => { setSearch("");setActive("all");setCategory("");setStock("all");setSort("name");setDirection("asc");setPage(1); };
  const canWrite=query.data?.canWrite===true;

  if (selectedProductPublicId) {
    return (
      <ProductDetailPanel
        productPublicId={selectedProductPublicId}
        onBack={() => {
          setSelectedProductPublicId(null);
          void query.refetch();
        }}
        onEdit={(prod) => {
          setSelectedProductPublicId(null);
          clearPhoto();
          setPhotoPreview(null);
          setForm({
            publicId: prod.publicId,
            name: prod.name,
            sku: prod.sku,
            barcode: prod.barcode ?? "",
            category: prod.categoryRelational?.name ?? prod.category ?? "",
            categoryPublicId: prod.categoryPublicId ?? prod.categoryRelational?.publicId ?? null,
            brandPublicId: prod.brandPublicId ?? prod.brand?.publicId ?? null,
            unit: prod.unit,
            cost: (prod.costPriceCents / 100).toFixed(2).replace(".", ","),
            sale: (prod.salePriceCents / 100).toFixed(2).replace(".", ","),
            minimumStock: prod.minimumStock,
            description: prod.description ?? "",
          });
        }}
        onProductMediaChanged={(pubId) => {
          setMediaVersions((prev) => ({
            ...prev,
            [pubId]: (prev[pubId] ?? 0) + 1,
          }));
          void utils.erp.products.list.invalidate();
          void query.refetch();
        }}
        canWrite={canWrite}
      />
    );
  }

  return <div className="space-y-5" data-testid="erp-products-page">
    <ErpPageHeader title="Produtos" eyebrow="Catálogo" actions={canWrite&&<Button onClick={()=>{clearPhoto();setForm({...emptyProduct})}}>Novo produto</Button>} />
    <section aria-label="Visão do catálogo" className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-950 to-slate-800 p-5 text-white shadow-sm">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-200">Catálogo visual</p>
        <p className="mt-2 text-sm text-slate-200">Fotos, preço e disponibilidade reunidos para uma leitura rápida.</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center rounded-xl bg-white/10 p-1 border border-white/10" role="group" aria-label="Modo de visualização">
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              viewMode === "table"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-300 hover:text-white"
            }`}
            data-testid="view-mode-table"
          >
            <LayoutList className="h-4 w-4" />
            Lista
          </button>
          <button
            type="button"
            onClick={() => setViewMode("cards")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              viewMode === "cards"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-300 hover:text-white"
            }`}
            data-testid="view-mode-cards"
          >
            <LayoutGrid className="h-4 w-4" />
            Catálogo visual
          </button>
        </div>
        <p className="text-3xl font-bold tracking-tight">{query.data?.total ?? 0}<span className="ml-2 text-sm font-medium text-slate-300">itens</span></p>
      </div>
    </section>

    {message&&<p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
    <div className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className="relative sm:col-span-2"><span className="sr-only">Pesquisar produtos</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/><Input className="pl-9" value={search} onChange={e=>{setSearch(e.target.value);resetPage()}} placeholder="Nome, SKU ou código de barras"/></label>
      <Filter label="Filtrar status" value={active} onChange={value=>{setActive(value as typeof active);resetPage()}} options={[["all","Todos"],["active","Ativos"],["inactive","Inativos"]]}/>
      <Input aria-label="Filtrar categoria" value={category} onChange={e=>{setCategory(e.target.value);resetPage()}} placeholder="Categoria"/>
      <Filter label="Filtrar estoque" value={stock} onChange={value=>{setStock(value as typeof stock);resetPage()}} options={[["all","Todo estoque"],["empty","Saldo zero"],["low","Estoque baixo"],["normal","Estoque normal"]]}/>
      <Filter label="Ordenar produtos" value={sort} onChange={value=>{setSort(value as typeof sort);resetPage()}} options={[["name","Nome"],["sku","SKU"],["createdAt","Cadastro"],["stock","Saldo"]]}/>
      <Filter label="Direção da ordenação" value={direction} onChange={value=>{setDirection(value as typeof direction);resetPage()}} options={[["asc","Crescente"],["desc","Decrescente"]]}/>
      <Filter label="Itens por página" value={String(pageSize)} onChange={value=>{setPageSize(Number(value));resetPage()}} options={[["10","10 por página"],["20","20 por página"],["50","50 por página"]]}/>
      <Button variant="outline" onClick={reset}>Limpar filtros</Button>
    </div>
    {query.isLoading ? (
      <StateMessage title="Carregando produtos…"/>
    ) : query.error ? (
      <StateMessage title={query.error.message||"Erro ao carregar produtos."} retry={()=>void query.refetch()}/>
    ) : query.data?.items.length === 0 ? (
      <StateMessage title={search||category||active!=="all"||stock!=="all"?"Nenhum produto corresponde aos filtros.":"Nenhum produto cadastrado."}/>
    ) : viewMode === "cards" ? (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="catalog-visual-grid">
        {query.data?.items.map(product => (
          <article
            key={product.publicId}
            data-testid="product-catalog-card"
            onClick={() => setSelectedProductPublicId(product.publicId)}
            className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-400 hover:shadow-lg transition-all duration-200 cursor-pointer"
          >
            <div>
              <div className="overflow-hidden rounded-xl bg-slate-100 mb-3 aspect-[4/3] flex items-center justify-center">
                <ProductThumbnail product={product} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200" version={mediaVersions[product.publicId]}/>
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-950 text-sm">{product.name}</p>
                  <p className="mt-0.5 truncate text-xs font-mono text-slate-500">{product.sku}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${product.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-600"}`}>
                  {product.active ? "Ativo" : "Inativo"}
                </span>
              </div>
              {product.category && (
                <p className="mt-1.5 text-xs text-slate-500 truncate">{product.category}</p>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-end justify-between gap-2">
              <div>
                <span className="text-[11px] text-slate-400 block font-medium">Preço de venda</span>
                <span className="text-base font-bold text-slate-900">{money.format(product.salePriceCents/100)}</span>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-slate-400 block font-medium">Saldo</span>
                <span className="text-xs font-bold text-slate-700">{formatQuantity(product.quantity)} {product.unit}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    ) : (
      <>
        <div className="hidden overflow-x-auto rounded-2xl border bg-white md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50">
              <tr>{["Produto","SKU","Categoria","Custo","Venda","Saldo","Mínimo","Status","Ações"].map(x=><th key={x} className="p-3">{x}</th>)}</tr>
            </thead>
            <tbody>
              {query.data?.items.map(product => (
                <tr key={product.publicId} className="border-t">
                  <td className="p-3 font-medium">
                    <div className="flex items-center gap-3">
                      <ProductThumbnail product={product} version={mediaVersions[product.publicId]}/>
                      <span>{product.name}</span>
                    </div>
                  </td>
                  <td className="p-3">{product.sku}</td>
                  <td className="p-3">{product.category??"—"}</td>
                  <td className="p-3">{money.format(product.costPriceCents/100)}</td>
                  <td className="p-3">{money.format(product.salePriceCents/100)}</td>
                  <td className="p-3">{formatQuantity(product.quantity)}</td>
                  <td className="p-3">{formatQuantity(product.minimumStock)}</td>
                  <td className="p-3">{product.active?"Ativo":"Inativo"}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={()=>setSelectedProductPublicId(product.publicId)}>Detalhes</Button>
                      {canWrite && (
                        <>
                          <Button size="sm" variant="outline" onClick={()=>edit(product)}>Editar</Button>
                          <Button size="sm" variant="outline" onClick={()=>status.mutate({publicId:product.publicId,active:!product.active})} disabled={status.isPending}>{product.active?"Inativar":"Ativar"}</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 md:hidden">
          {query.data?.items.map(product => (
            <article key={product.publicId} className="rounded-2xl border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <ProductThumbnail product={product} className="h-16 w-16" version={mediaVersions[product.publicId]}/>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{product.name}</p>
                    <p className="truncate text-xs text-slate-500">{product.sku}</p>
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{product.active?"Ativo":"Inativo"}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-slate-500">Categoria</dt><dd>{product.category??"—"}</dd></div>
                <div><dt className="text-slate-500">Saldo</dt><dd>{formatQuantity(product.quantity)}</dd></div>
                <div><dt className="text-slate-500">Custo</dt><dd>{money.format(product.costPriceCents/100)}</dd></div>
                <div><dt className="text-slate-500">Venda</dt><dd>{money.format(product.salePriceCents/100)}</dd></div>
              </dl>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={()=>setSelectedProductPublicId(product.publicId)}>Detalhes</Button>
                {canWrite && (
                  <>
                    <Button size="sm" variant="outline" onClick={()=>edit(product)}>Editar</Button>
                    <Button size="sm" variant="outline" onClick={()=>status.mutate({publicId:product.publicId,active:!product.active})}>{product.active?"Inativar":"Ativar"}</Button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </>
    )}
    {query.data&&<Pagination page={page} totalPages={query.data.totalPages} onPage={setPage}/>}
    <ProductFormDialog
      open={Boolean(form)}
      onOpenChange={open => {
        if (!open) {
          clearPhoto();
          setForm(null);
        }
      }}
      form={form}
      setForm={setForm}
      onSubmit={submit}
      pending={pending}
      errorMessage={create.error?.message ?? update.error?.message}
      photoPreview={photoPreview}
      removePhoto={removePhoto}
      onPhotoSelect={file => {
        if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
        setPhoto(file);
        setPhotoPreview(URL.createObjectURL(file));
        setRemovePhoto(false);
      }}
      onPhotoRemove={() => {
        if (window.confirm("Remover a foto principal deste produto?")) {
          setPhoto(null);
          setPhotoPreview(null);
          setRemovePhoto(true);
        }
      }}
    />
  </div>;
}

function Stock() {
  const utils=trpc.useUtils(); const [page,setPage]=React.useState(1); const [pageSize,setPageSize]=React.useState(20); const [search,setSearch]=React.useState(""); const [productFilter,setProductFilter]=React.useState(""); const [typeFilter,setTypeFilter]=React.useState<StockFilterType>("all"); const [from,setFrom]=React.useState(""); const [to,setTo]=React.useState(""); const [form,setForm]=React.useState<StockForm|null>(null); const [reverse,setReverse]=React.useState<{publicId:string;reason:string;idempotencyKey:string}|null>(null); const [detail,setDetail]=React.useState<string|null>(null); const [message,setMessage]=React.useState("");
  const products=trpc.erp.products.list.useQuery({search:"",active:true,stock:"all",sort:"name",direction:"asc",page:1,pageSize:100});
  const summary=trpc.erp.summary.useQuery();
  const movements=trpc.erp.stock.list.useQuery({search,productPublicId:productFilter||undefined,type:typeFilter==="all"?undefined:typeFilter,from:from?new Date(from+"T00:00:00.000Z").toISOString():undefined,to:to?new Date(to+"T23:59:59.999Z").toISOString():undefined,page,pageSize});
  const move=trpc.erp.stock.move.useMutation({onSuccess:async()=>{setForm(null);setMessage("Movimentação registrada com sucesso.");await utils.erp.invalidate();}});
  const reverseMutation=trpc.erp.stock.reverse.useMutation({onSuccess:async()=>{setReverse(null);setMessage("Movimentação revertida com sucesso.");await utils.erp.invalidate();}});
  const selected=products.data?.items.find(item=>item.publicId===form?.productPublicId); const projected=form&&selected?(Number(selected.quantity)+(form.type.endsWith("out")?-1:1)*Number(form.quantity||0)):null;
  const canWrite=products.data?.canWrite===true; const submit=(event:React.FormEvent)=>{event.preventDefault();if(!form||move.isPending)return;move.mutate(form);};
  const reset=()=>{setSearch("");setProductFilter("");setTypeFilter("all");setFrom("");setTo("");setPage(1);};
  return <div className="space-y-5" data-testid="erp-stock-page">
    <ErpPageHeader title="Estoque" eyebrow="Operação" actions={canWrite&&<Button onClick={()=>setForm({productPublicId:"",type:"manual_in",quantity:"",reason:"",idempotencyKey:newKey()})}>Nova movimentação</Button>} />
    <section aria-label="Panorama do inventário" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[["Produtos ativos",summary.data?.metrics.activeProducts,"bg-slate-950 text-white"],["Estoque crítico",summary.data?.metrics.lowProducts,"bg-amber-50 text-amber-950"],["Sem saldo",summary.data?.metrics.emptyProducts,"bg-rose-50 text-rose-950"],["Valor em custo",money.format((summary.data?.metrics.costValueCents??0)/100),"bg-blue-50 text-blue-950"]].map(([label,value,tone])=><article key={label as string} className={`rounded-3xl border border-slate-200 p-5 shadow-sm ${tone as string}`}><p className="text-xs font-bold uppercase tracking-[0.14em] opacity-65">{label as string}</p><p className="mt-3 text-3xl font-bold tracking-tight">{value as React.ReactNode}</p></article>)}
    </section>
    {summary.data?.critical.length?<section aria-label="Itens críticos" className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700">Prioridade de reposição</p><h2 className="mt-1 text-lg font-bold tracking-tight text-amber-950">Itens com estoque crítico</h2></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-amber-800">{summary.data.critical.length} itens</span></div><div className="mt-4 grid gap-2 md:grid-cols-3">{summary.data.critical.slice(0,3).map(product=><div key={product.publicId} className="rounded-2xl border border-amber-100 bg-white/80 p-3"><p className="truncate text-sm font-bold text-slate-900">{product.name}</p><p className="mt-1 text-xs text-slate-600">Saldo {formatQuantity(product.quantity)} · mínimo {formatQuantity(product.minimumStock)}</p></div>)}</div></section>:null}
    {message&&<p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{products.data?.items.map(product=><article key={product.publicId} className="rounded-2xl border bg-white p-4"><p className="font-semibold">{product.name}</p><p className="text-xs text-slate-500">{product.sku}</p><p className="mt-3 text-xl font-bold">{formatQuantity(product.quantity)} <span className="text-sm font-normal">{product.unit}</span></p><p className="text-xs text-slate-500">Mínimo: {formatQuantity(product.minimumStock)}</p></article>)}</section>
    <div className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <Input aria-label="Pesquisar histórico" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Produto ou SKU"/>
      <Filter label="Filtrar produto" value={productFilter} onChange={value=>{setProductFilter(value);setPage(1)}} options={[["","Todos os produtos"],...(products.data?.items.map(item=>[item.publicId,item.name] as [string,string])??[])]}/>
      <Filter label="Filtrar tipo" value={typeFilter} onChange={value=>{setTypeFilter(value as StockFilterType);setPage(1)}} options={[["all","Todos os tipos"],["manual_in","Entrada"],["manual_out","Saída"],["adjustment_in","Ajuste positivo"],["adjustment_out","Ajuste negativo"],["reversal","Reversão"]]}/>
      <Filter label="Movimentos por página" value={String(pageSize)} onChange={value=>{setPageSize(Number(value));setPage(1)}} options={[["10","10 por página"],["20","20 por página"],["50","50 por página"]]}/>
      <label className="text-sm">De<Input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}}/></label><label className="text-sm">Até<Input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1)}}/></label><Button variant="outline" onClick={reset}>Limpar filtros</Button>
    </div>
    {movements.isLoading?<StateMessage title="Carregando movimentações…"/>:movements.error?<StateMessage title={movements.error.message||"Erro ao carregar movimentações."} retry={()=>void movements.refetch()}/>:movements.data?.items.length===0?<StateMessage title={search||productFilter||typeFilter!=="all"||from||to?"Nenhum movimento corresponde aos filtros.":"Nenhuma movimentação registrada."}/>:<div className="hidden overflow-x-auto rounded-2xl border bg-white md:block"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50"><tr>{["Data","Produto","Tipo","Quantidade","Anterior","Posterior","Motivo","Estado","Detalhes",...(canWrite?["Ações"]:[])].map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{movements.data?.items.map(item=><React.Fragment key={item.publicId}><tr className="border-t"><td className="p-3">{formatDateTime(item.createdAt)}</td><td className="p-3">{item.productName}<span className="block text-xs text-slate-500">{item.sku}</span></td><td className="p-3">{item.type}</td><td className="p-3">{item.direction==="in"?"+":"-"}{formatQuantity(item.quantity)}</td><td className="p-3">{formatQuantity(item.previousBalance)}</td><td className="p-3">{formatQuantity(item.resultingBalance)}</td><td className="p-3">{item.reason}</td><td className="p-3">{item.reversed?<span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">Revertido</span>:item.type==="reversal"?<span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800">Reversão</span>:"Confirmado"}</td><td className="p-3"><Button size="sm" variant="outline" onClick={()=>setDetail(detail===item.publicId?null:item.publicId)}>{detail===item.publicId?"Fechar":"Ver"}</Button></td>{canWrite&&<td className="p-3">{item.type!=="reversal"&&!item.reversed&&<Button size="sm" variant="outline" onClick={()=>setReverse({publicId:item.publicId,reason:"",idempotencyKey:newKey()})}>Reverter</Button>}</td>}</tr>{detail===item.publicId&&<tr className="border-t bg-slate-50"><td colSpan={canWrite?10:9} className="p-4 text-sm">Operador: {item.createdBy} · Referência: {item.referenceId??"—"}{item.reversalPublicId&&<> · Reversão: {item.reversalPublicId}</>}</td></tr>}</React.Fragment>)}</tbody></table></div>}
    {movements.data?.items.length?<div className="grid gap-3 md:hidden">{movements.data.items.map(item=><article key={item.publicId} className="rounded-2xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.productName}</p><p className="text-xs text-slate-500">{item.sku} · {formatDateTime(item.createdAt)}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{item.reversed?"Revertido":item.type==="reversal"?"Reversão":"Confirmado"}</span></div><p className="mt-3 text-lg font-bold">{item.direction==="in"?"+":"-"}{formatQuantity(item.quantity)}</p><p className="text-sm text-slate-600">{formatQuantity(item.previousBalance)} → {formatQuantity(item.resultingBalance)}</p><p className="mt-2 text-sm">{item.reason}</p><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={()=>setDetail(detail===item.publicId?null:item.publicId)}>{detail===item.publicId?"Fechar":"Detalhes"}</Button>{canWrite&&item.type!=="reversal"&&!item.reversed&&<Button size="sm" variant="outline" onClick={()=>setReverse({publicId:item.publicId,reason:"",idempotencyKey:newKey()})}>Reverter</Button>}</div>{detail===item.publicId&&<p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">Operador: {item.createdBy} · Referência: {item.referenceId??"—"}</p>}</article>)}</div>:null}
    {movements.data&&<Pagination page={page} totalPages={movements.data.totalPages} onPage={setPage}/>}
    <Dialog open={Boolean(form)} onOpenChange={open=>!open&&setForm(null)}><DialogContent className="max-h-[90vh] overflow-y-auto bg-white"><DialogHeader><DialogTitle>Registrar movimentação</DialogTitle></DialogHeader>{form&&<form onSubmit={submit} className="space-y-4"><label className="block text-sm">Produto<select required className="mt-1 w-full rounded-lg border p-2" value={form.productPublicId} onChange={e=>setForm({...form,productPublicId:e.target.value})}><option value="">Selecione</option>{products.data?.items.map(p=><option key={p.publicId} value={p.publicId}>{p.name} — saldo {formatQuantity(p.quantity)}</option>)}</select></label><label className="block text-sm">Operação<select className="mt-1 w-full rounded-lg border p-2" value={form.type} onChange={e=>setForm({...form,type:e.target.value as StockForm["type"]})}><option value="manual_in">Entrada manual</option><option value="manual_out">Saída manual</option><option value="adjustment_in">Ajuste positivo</option><option value="adjustment_out">Ajuste negativo</option></select></label><Field label="Quantidade" value={form.quantity} onChange={quantity=>setForm({...form,quantity})}/><Field label="Motivo" value={form.reason} onChange={reason=>setForm({...form,reason})}/>{selected&&<p className="rounded-lg bg-slate-50 p-3 text-sm">Saldo atual: {formatQuantity(selected.quantity)} · projetado: {projected===null?"—":projected.toLocaleString("pt-BR",{maximumFractionDigits:3})}</p>}{move.error&&<p role="alert" className="text-sm text-red-600">{move.error.message}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setForm(null)}>Cancelar</Button><Button type="submit" disabled={move.isPending||!form.productPublicId}>{move.isPending?"Confirmando…":"Confirmar movimentação"}</Button></div></form>}</DialogContent></Dialog>
    <Dialog open={Boolean(reverse)} onOpenChange={open=>!open&&setReverse(null)}><DialogContent className="bg-white"><DialogHeader><DialogTitle>Confirmar reversão</DialogTitle></DialogHeader>{reverse&&<form onSubmit={event=>{event.preventDefault();if(!reverseMutation.isPending)reverseMutation.mutate({movementPublicId:reverse.publicId,reason:reverse.reason,idempotencyKey:reverse.idempotencyKey})}} className="space-y-4"><Field label="Motivo da reversão" value={reverse.reason} onChange={reason=>setReverse({...reverse,reason})}/>{reverseMutation.error&&<p role="alert" className="text-sm text-red-600">{reverseMutation.error.message}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setReverse(null)}>Cancelar</Button><Button type="submit" disabled={reverseMutation.isPending||reverse.reason.trim().length<3}>{reverseMutation.isPending?"Revertendo…":"Confirmar reversão"}</Button></div></form>}</DialogContent></Dialog>
  </div>;
}

function Field({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) { const id=React.useId(); return <label htmlFor={id} className="text-sm">{label}<Input id={id} className="mt-1" value={value} onChange={e=>onChange(e.target.value)} required={label==="Nome"||label==="SKU"||label==="Quantidade"||label==="Motivo"||label==="Motivo da reversão"}/></label>; }
function Filter({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options:Array<[string,string]>}) { return <select aria-label={label} className="min-h-10 rounded-lg border px-3" value={value} onChange={e=>onChange(e.target.value)}>{options.map(([key,text])=><option key={key||"all"} value={key}>{text}</option>)}</select>; }
