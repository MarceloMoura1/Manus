import React from "react";
import { io } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/conversationDateTime";
import type { ModuleTopbarItem } from "@/components/ModuleTopbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertCircle,
  BarChart3,
  Boxes,
  DollarSign,
  Eye,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  LayoutList,
  MoreHorizontal,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Power,
  Receipt,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  TrendingDown,
  Truck,
  Upload,
  Users,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SuppliersPage } from "./SuppliersPage";
import { ClientesPage } from "../ClientesPage";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";
import { PurchasesPage } from "./PurchasesPage";
import { SalesPage } from "./SalesPage";
import { FinancePage } from "./FinancePage";
import { FiscalPage } from "./FiscalPage";
import { ReportsPage } from "./ReportsPage";
import { StockPage } from "./StockPage";
import { ServicesPage } from "./ServicesPage";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  formatCategoryOptionLabel,
} from "./ProductFormDialog";

export type ErpSection = "summary" | "clients" | "products" | "services" | "stock" | "suppliers" | "purchases" | "sales" | "finance" | "fiscal" | "reports";
const planned = ["Integrações"];

export function getErpTopbarItems({
  canAccessClients,
  canAccessSales,
  canAccessFinance,
  canAccessFiscal,
  canAccessReports,
  onNavigate,
}: {
  canAccessClients: boolean;
  canAccessSales: boolean;
  canAccessFinance: boolean;
  canAccessFiscal: boolean;
  canAccessReports: boolean;
  onNavigate: (section: ErpSection) => void;
}): ModuleTopbarItem[] {
  const available = [
    { id:"summary" as const, label: "Resumo", icon: LayoutDashboard },
    { id:"products" as const, label: "Produtos", icon: Package },
    { id:"services" as const, label: "Serviços", icon: Wrench },
    { id:"stock" as const, label: "Estoque", icon: Boxes },
    { id:"sales" as const, label: "Vendas", icon: ShoppingCart, hidden: !canAccessSales },
    { id:"purchases" as const, label: "Compras", icon: ShoppingBag },
    { id:"finance" as const, label: "Financeiro", icon: DollarSign, hidden: !canAccessFinance },
    { id:"fiscal" as const, label: "Fiscal", icon: Receipt, hidden: !canAccessFiscal },
    { id:"reports" as const, label: "Relatórios", icon: BarChart3, hidden: !canAccessReports },
    { id:"suppliers" as const, label: "Fornecedores", icon: Truck },
    ...(canAccessClients ? [{ id:"clients" as const, label: "Clientes", icon: Users }] : []),
  ];

  return [
    ...available.map(item => ({ ...item, onSelect: () => onNavigate(item.id) })),
    ...planned.map(label => ({ id: `planned-${label}`, label, disabled: true, unavailableReason: "Em preparação" })),
  ];
}
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const cents = (value: string) => { const normalized = value.replace(/\./g, "").replace(",", "."); const parsed = Number(normalized); return Number.isFinite(parsed) ? Math.round(parsed * 100) : -1; };
const formatQuantity = (value: string) => Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function useErpRealtime() {
  const utils = trpc.useUtils();
  React.useEffect(() => {
    const socket = io(window.location.origin, { path: "/api/ws/whatsapp", withCredentials: true });
    let refreshTimer: number | undefined;
    const refresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void utils.erp.invalidate(), 250);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const refreshSuppliers = () => { refresh(); };
    socket.on("connect", refresh);
    socket.on("erp:product.changed", refresh);
    socket.on("erp:service.changed", refresh);
    socket.on("erp:stock.changed", refresh);
    socket.on("erp:supplier.changed", refreshSuppliers);
    socket.on("erp:purchase.changed", refresh);
    socket.on("erp:sale.changed", refresh);
    socket.on("erp:finance.entry.changed", refresh);
    socket.on("erp:finance.account.changed", refresh);
    socket.on("erp:fiscal.document.changed", refresh);
    socket.on("erp:fiscal.settings.changed", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(refreshTimer);
      socket.off("connect", refresh);
      socket.off("erp:product.changed", refresh);
      socket.off("erp:service.changed", refresh);
      socket.off("erp:stock.changed", refresh);
      socket.off("erp:supplier.changed", refreshSuppliers);
      socket.off("erp:purchase.changed", refresh);
      socket.off("erp:sale.changed", refresh);
      socket.off("erp:finance.entry.changed", refresh);
      socket.off("erp:finance.account.changed", refresh);
      socket.off("erp:fiscal.document.changed", refresh);
      socket.off("erp:fiscal.settings.changed", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      socket.disconnect();
    };
  }, [utils]);
}

function StateMessage({ title, retry }: { title: string; retry?: () => void }) {
  return <ErpEmptyState title={title} action={retry ? { label: "Tentar novamente", onClick: retry } : undefined} />;
}

export function ERPWorkspace({ section, onNavigate, canAccessClients, canAccessSales, canAccessFinance, canAccessFiscal, canAccessReports, canPermanentlyDeleteClients, initialCrmClientId, initialSalePublicId, onClientNavigate, onNavigateToClient, onNavigateToSale, onNavigateToProposals, whatsappConnected, canStartConversation }: { section: ErpSection; onNavigate: (section: ErpSection) => void; canAccessClients: boolean; canAccessSales: boolean; canAccessFinance: boolean; canAccessFiscal: boolean; canAccessReports: boolean; canPermanentlyDeleteClients: boolean; initialCrmClientId?: string; initialSalePublicId?: string; onClientNavigate: (intent: CrmWhatsAppIntent) => void; onNavigateToClient: (crmClientId: string) => void; onNavigateToSale: (salePublicId?: string) => void; onNavigateToProposals?: () => void; whatsappConnected: boolean; canStartConversation: boolean }) {
  useErpRealtime();
  const denied = <div role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-xl font-bold text-slate-900">Acesso indisponível</h1><p className="mt-2 text-sm text-slate-600">Este módulo não está disponível para o seu perfil.</p></div>;
  const content = section === "summary" ? <Summary onNavigate={onNavigate}/> : section === "clients" ? canAccessClients ? <ClientesPage initialSelectedId={initialCrmClientId} onNavigate={onClientNavigate} onSaleNavigate={salePublicId => onNavigateToSale(salePublicId)} canAccessSales={canAccessSales} whatsappConnected={whatsappConnected} canStartConversation={canStartConversation} canPermanentlyDelete={canPermanentlyDeleteClients}/> : denied : section === "products" ? <Products/> : section === "services" ? <ServicesPage/> : section === "suppliers" ? <SuppliersPage onNavigate={onNavigate} whatsappConnected={whatsappConnected} canStartConversation={canStartConversation} onClientNavigate={onClientNavigate}/> : section === "purchases" ? <PurchasesPage onNavigate={onNavigate}/> : section === "sales" ? canAccessSales ? <SalesPage initialSelectedId={initialSalePublicId} onSaleNavigate={onNavigateToSale} onClientNavigate={onNavigateToClient} onNavigateToProposals={onNavigateToProposals}/> : denied : section === "finance" ? canAccessFinance ? <FinancePage/> : denied : section === "fiscal" ? canAccessFiscal ? <FiscalPage/> : denied : section === "reports" ? canAccessReports ? <ReportsPage/> : denied : <StockPage/>;
  return <div className="min-w-0 max-w-full w-full min-h-screen bg-slate-950 dark:bg-slate-950 pb-12 text-slate-100" data-testid="erp-workspace">{content}</div>;
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
  const frame = `${className} shrink-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-sm`;
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

function StockBadge({ quantity, minimumStock }: { quantity: string; minimumStock: string }) {
  const qty = Number(quantity);
  const min = Number(minimumStock);
  const isZero = qty <= 0;
  const isLow = !isZero && qty <= min;

  if (isZero) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
        0 un. (Zerado)
      </span>
    );
  }
  if (isLow) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
        {formatQuantity(quantity)} (Baixo)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
      {formatQuantity(quantity)}
    </span>
  );
}

function ProductsGlowPagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newSize: number) => void;
}) {
  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const getPageNumbers = () => {
    const delta = 1;
    const range: number[] = [];
    const rangeWithDots: Array<number | string> = [];
    let l: number | undefined;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
        range.push(i);
      }
    }

    for (const i of range) {
      if (l !== undefined) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push("…");
        }
      }
      rangeWithDots.push(i);
      l = i;
    }

    return rangeWithDots;
  };

  return (
    <div
      data-testid="products-glow-pagination"
      className="bg-slate-950/95 border-t border-t-white/30 border-x border-b border-white/10 rounded-2xl px-6 py-3 my-4 flex flex-wrap items-center justify-between gap-4 text-slate-300 shadow-[0_-6px_25px_rgba(255,255,255,0.12),0_15px_35px_rgba(0,0,0,0.8)]"
    >
      <span className="text-xs font-medium text-slate-300 tabular-nums">
        Mostrando <strong className="text-white">{start}–{end}</strong> de <strong className="text-white">{total}</strong> produtos
      </span>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          Itens por página
          <select
            aria-label="Itens por página"
            className="h-8 rounded-lg border border-slate-800 bg-slate-900 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            value={pageSize}
            onChange={e => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1);
            }}
          >
            {[10, 20, 50, 100].map(val => (
              <option key={val} value={val} className="bg-slate-900 text-slate-200">
                {val}
              </option>
            ))}
          </select>
        </label>

        {totalPages > 1 && (
          <nav aria-label="Navegação de páginas" className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Página anterior"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
            >
              ‹
            </button>

            {getPageNumbers().map((item, idx) =>
              typeof item === "number" ? (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onPageChange(item)}
                  aria-current={item === page ? "page" : undefined}
                  className={`flex h-8 min-w-8 px-2 items-center justify-center rounded-lg text-xs font-bold transition-all ${
                    item === page
                      ? "bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.45)]"
                      : "border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {item}
                </button>
              ) : (
                <span key={idx} className="px-1 text-slate-500">
                  {item}
                </span>
              )
            )}

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Próxima página"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
            >
              ›
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}

function Products() {
  const utils = trpc.useUtils();
  const [viewMode, setViewMode] = React.useState<"table" | "cards">("table");
  const [search, setSearch] = React.useState("");
  const [active, setActive] = React.useState<"all" | "active" | "inactive">("all");
  const [category, setCategory] = React.useState("");
  const [stock, setStock] = React.useState<"all" | "empty" | "low" | "normal">("all");
  const [sort, setSort] = React.useState<"name" | "sku" | "createdAt" | "stock">("name");
  const [direction, setDirection] = React.useState<"asc" | "desc">("asc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [form, setForm] = React.useState<ProductForm | null>(null);
  const [message, setMessage] = React.useState("");
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = React.useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = React.useState(false);
  const [mediaPending, setMediaPending] = React.useState(false);
  const [mediaVersions, setMediaVersions] = React.useState<Record<string, number>>({});
  const [selectedProductPublicId, setSelectedProductPublicId] = React.useState<string | null>(null);

  // Requirement 1: Explicit delete control states
  const [productToDelete, setProductToDelete] = React.useState<{ publicId: string; name: string } | null>(null);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = React.useState(false);
  const [deleteDependencies, setDeleteDependencies] = React.useState<{ salesCount: number; stockCount: number } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = React.useState("");

  React.useEffect(() => () => {
    if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const resetPage = () => setPage(1);

  const query = trpc.erp.products.list.useQuery({
    search,
    active: active === "all" ? undefined : active === "active",
    category: category || undefined,
    stock,
    sort,
    direction,
    page,
    pageSize,
  });

  const categoriesQuery = trpc.erp.categories.list.useQuery(
    { pageSize: 100 },
    { staleTime: 60_000 }
  );

  const done = async (text: string) => {
    setForm(null);
    setMessage(text);
    await utils.erp.invalidate();
  };

  const create = trpc.erp.products.create.useMutation();
  const update = trpc.erp.products.update.useMutation();
  const status = trpc.erp.products.setActive.useMutation({
    onSuccess: async () => {
      toast.success("Status do produto atualizado.");
      await utils.erp.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao atualizar status.");
    },
  });

  const deleteMutation = trpc.erp.products.deleteProduct.useMutation({
    onSuccess: async (res) => {
      if (res.hasDependencies && !res.success) {
        setDeleteDependencies({
          salesCount: res.salesCount,
          stockCount: res.stockCount,
        });
        return;
      }
      toast.success("Produto excluído com sucesso");
      setIsDeleteAlertOpen(false);
      setProductToDelete(null);
      setDeleteDependencies(null);
      setDeleteConfirmText("");
      if (selectedProductPublicId === productToDelete?.publicId) {
        setSelectedProductPublicId(null);
      }
      await utils.erp.products.list.invalidate();
      await utils.erp.summary.invalidate();
      void query.refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Não foi possível excluir o produto.");
    },
  });

  const handleDeleteRequest = (product: { publicId: string; name: string }) => {
    setProductToDelete(product);
    setDeleteConfirmText("");
    setIsDeleteAlertOpen(true);
    setDeleteDependencies(null);
    void utils.erp.products.checkDependencies.fetch({ publicId: product.publicId })
      .then((deps) => {
        if (deps?.hasDependencies) {
          setDeleteDependencies({ salesCount: deps.salesCount, stockCount: deps.stockCount });
        }
      })
      .catch(() => {});
  };

  const handleConfirmDelete = () => {
    if (!productToDelete) return;
    if (deleteConfirmText !== "EXCLUIR") return;
    deleteMutation.mutate({
      publicId: productToDelete.publicId,
      force: true,
      hardDelete: true,
    });
  };

  const submittingRef = React.useRef(false);
  const pending = create.isPending || update.isPending || mediaPending;
  const clearPhoto = () => {
    if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    setPhoto(null);
    setPhotoPreview(null);
    setRemovePhoto(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || pending || submittingRef.current) return;
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

      if (isNew && product?.publicId) {
        setForm(curr => (curr ? { ...curr, publicId: product.publicId } : null));
      }

      let photoUploadWarning: string | null = null;
      if (photo || removePhoto) {
        setMediaPending(true);
        try {
          const response = await fetch(
            productMediaUrl(`/api/products/${product.publicId}/image`),
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

  const reset = () => {
    setSearch("");
    setActive("all");
    setCategory("");
    setStock("all");
    setSort("name");
    setDirection("asc");
    setPage(1);
  };

  const canWrite = query.data?.canWrite === true;

  const deleteDialogNode = (
    <Dialog
      open={isDeleteAlertOpen && Boolean(productToDelete)}
      onOpenChange={open => {
        if (!open) {
          setIsDeleteAlertOpen(false);
          setProductToDelete(null);
          setDeleteDependencies(null);
          setDeleteConfirmText("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold text-lg">
            <AlertCircle className="h-5 w-5" /> Excluir produto definitivamente
          </DialogTitle>
        </DialogHeader>
        <div className="py-3 text-sm text-slate-600 dark:text-slate-300 space-y-3">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 space-y-1.5">
            <p className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" /> O produto será ocultado do catálogo; seu histórico será preservado.
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              O produto <strong className="text-slate-900 dark:text-white">&quot;{productToDelete?.name}&quot;</strong> não aparecerá entre produtos ativos ou inativos.
            </p>
          </div>

          {deleteDependencies && (deleteDependencies.salesCount > 0 || deleteDependencies.stockCount > 0) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-1">
              <p className="font-semibold text-amber-600 dark:text-amber-400 text-xs flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> Registros vinculados detectados
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                Este produto possui{" "}
                <strong className="text-rose-600 dark:text-rose-400">
                  {deleteDependencies.salesCount > 0 && `${deleteDependencies.salesCount} vínculo(s) em vendas/pedidos`}
                  {deleteDependencies.salesCount > 0 && deleteDependencies.stockCount > 0 && " e "}
                  {deleteDependencies.stockCount > 0 && `${deleteDependencies.stockCount} em saldo de estoque`}
                </strong>
                . Os registros vinculados permanecerão preservados.
              </p>
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <label htmlFor="delete-product-confirm-input" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Para confirmar, digite <span className="font-bold text-rose-600 dark:text-rose-400 font-mono">EXCLUIR</span> abaixo:
            </label>
            <Input
              id="delete-product-confirm-input"
              data-testid="delete-product-confirm-input"
              className="h-9 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono tracking-wider text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-rose-500"
              placeholder="Digite EXCLUIR"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter className="flex gap-2 sm:justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button
            variant="outline"
            onClick={() => {
              setIsDeleteAlertOpen(false);
              setProductToDelete(null);
              setDeleteDependencies(null);
              setDeleteConfirmText("");
            }}
            disabled={deleteMutation.isPending}
            className="dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            className="bg-rose-600 hover:bg-rose-700 text-white font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleConfirmDelete}
            disabled={deleteMutation.isPending || deleteConfirmText !== "EXCLUIR"}
            data-testid="confirm-delete-product-button"
          >
            {deleteMutation.isPending ? "Excluindo…" : "Confirmar Exclusão"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (selectedProductPublicId) {
    return (
      <>
        <ProductDetailPanel
          productPublicId={selectedProductPublicId}
          onBack={() => {
            setSelectedProductPublicId(null);
            void query.refetch();
          }}
          onDelete={(prod) => {
            handleDeleteRequest(prod);
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
        {deleteDialogNode}
      </>
    );
  }

  return (
    <div className="space-y-5 min-h-full bg-slate-950 dark:bg-slate-950 text-slate-100" data-testid="erp-products-page">
      {/* 1. Cabeçalho e Ação Principal */}
      <ErpPageHeader
        title="Produtos"
        eyebrow="Catálogo"
        description="Gerencie seu catálogo físico, serviços e preços"
        actions={
          canWrite && (
            <button
              type="button"
              onClick={() => {
                clearPhoto();
                setForm({ ...emptyProduct });
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded-xl shadow-[0_0_15px_rgba(37,99,235,0.35)] transition-all flex items-center cursor-pointer"
            >
              <Plus className="w-4 h-4 mr-2" />
              <span>Novo produto</span>
            </button>
          )
        }
      />

      {/* 2. Barra Superior de Visualização */}
      <section aria-label="Visão do catálogo" className="flex flex-wrap items-center justify-between gap-4 border border-slate-700/80 rounded-2xl bg-slate-900/90 px-6 py-4 text-white shadow-sm">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-400">Catálogo visual</p>
          <p className="mt-1 text-sm text-slate-300">Fotos, preço e disponibilidade reunidos para uma leitura rápida.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-slate-800/80 border border-slate-700/60 p-1 rounded-xl flex items-center gap-1" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                viewMode === "table"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "bg-transparent text-slate-300 hover:text-white"
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
                  : "bg-transparent text-slate-300 hover:text-white"
              }`}
              data-testid="view-mode-cards"
            >
              <LayoutGrid className="h-4 w-4" />
              Catálogo visual
            </button>
          </div>
          <div className="rounded-xl bg-slate-800/80 border border-slate-700/80 px-3.5 py-1.5 flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-white">{query.data?.total ?? 0}</span>
            <span className="text-xs font-medium text-slate-400">itens</span>
          </div>
        </div>
      </section>

      {message && <p role="status" className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 p-3 text-xs text-blue-800 dark:text-blue-300">{message}</p>}

      {/* 3. Barra de Filtros Unificada */}
      <div className="grid gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:grid-cols-2 xl:grid-cols-4 shadow-xs">
        <div className="relative sm:col-span-2">
          <label htmlFor="search-products-input" className="sr-only">Buscar produtos</label>
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <Input
            id="search-products-input"
            className="pl-10 h-10 rounded-xl border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 text-xs focus-visible:ring-2 focus-visible:ring-blue-500"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              resetPage();
            }}
            placeholder="Buscar por nome, SKU ou código de barras..."
          />
        </div>

        <select
          aria-label="Filtrar categoria"
          className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          value={category}
          onChange={e => {
            setCategory(e.target.value);
            resetPage();
          }}
        >
          <option value="" className="bg-white dark:bg-slate-900">Todas as categorias</option>
          {categoriesQuery.data?.items.map(cat => (
            <option key={cat.publicId} value={cat.name} className="bg-white dark:bg-slate-900">
              {formatCategoryOptionLabel(cat)}
            </option>
          ))}
        </select>

        <Filter
          label="Filtrar estoque"
          value={stock}
          onChange={value => {
            setStock(value as typeof stock);
            resetPage();
          }}
          options={[
            ["all", "Todo estoque"],
            ["empty", "Saldo zero"],
            ["low", "Estoque baixo"],
            ["normal", "Estoque normal"],
          ]}
        />

        <Filter
          label="Filtrar status"
          value={active}
          onChange={value => {
            setActive(value as typeof active);
            resetPage();
          }}
          options={[
            ["all", "Todos os status"],
            ["active", "Ativos"],
            ["inactive", "Inativos"],
          ]}
        />

        <Filter
          label="Ordenar produtos"
          value={sort}
          onChange={value => {
            setSort(value as typeof sort);
            resetPage();
          }}
          options={[
            ["name", "Nome"],
            ["sku", "SKU"],
            ["createdAt", "Cadastro"],
            ["stock", "Saldo"],
          ]}
        />

        <Filter
          label="Direção da ordenação"
          value={direction}
          onChange={value => {
            setDirection(value as typeof direction);
            resetPage();
          }}
          options={[
            ["asc", "Crescente"],
            ["desc", "Decrescente"],
          ]}
        />

        <Button
          variant="outline"
          onClick={reset}
          className="h-10 rounded-xl border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5"
        >
          <X className="h-3.5 w-3.5 text-slate-400" />
          Limpar filtros
        </Button>
      </div>

      {query.isLoading ? (
        <StateMessage title="Carregando produtos…" />
      ) : query.error ? (
        <StateMessage title={query.error.message || "Erro ao carregar produtos."} retry={() => void query.refetch()} />
      ) : query.data?.items.length === 0 ? (
        <StateMessage title={search || category || active !== "all" || stock !== "all" ? "Nenhum produto corresponde aos filtros." : "Nenhum produto cadastrado."} />
      ) : viewMode === "cards" ? (
        /* 5. Catálogo Visual (Grade de Cards) */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="catalog-visual-grid">
          {query.data?.items.map(product => (
            <article
              key={product.publicId}
              data-testid="product-catalog-card"
              onClick={() => setSelectedProductPublicId(product.publicId)}
              className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-all duration-200 cursor-pointer"
            >
              <div className="relative">
                <div className="relative h-44 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                  <ProductThumbnail
                    product={product}
                    className="h-44 w-full object-cover rounded-t-xl group-hover:scale-105 transition-transform duration-300"
                    version={mediaVersions[product.publicId]}
                  />
                  <div className="absolute top-2.5 right-2.5 z-10" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/60 text-white backdrop-blur-md hover:bg-slate-900/80 transition-colors shadow-sm"
                          aria-label={`Ações para ${product.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
                        <DropdownMenuItem onClick={() => setSelectedProductPublicId(product.publicId)} className="cursor-pointer text-xs">
                          <Eye className="mr-2 h-4 w-4 text-slate-500" />
                          Ver detalhes
                        </DropdownMenuItem>
                        {canWrite && (
                          <>
                            <DropdownMenuItem onClick={() => edit(product)} className="cursor-pointer text-xs">
                              <Pencil className="mr-2 h-4 w-4 text-slate-500" />
                              Editar produto
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => status.mutate({ publicId: product.publicId, active: !product.active })} className="cursor-pointer text-xs">
                              <Power className="mr-2 h-4 w-4 text-slate-500" />
                              {product.active ? "Inativar" : "Ativar"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="dark:bg-slate-800" />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRequest(product);
                              }}
                              className="cursor-pointer text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus:text-rose-600 dark:focus:text-rose-400 focus:bg-rose-50 dark:focus:bg-rose-950/40"
                            >
                              <Trash2 className="mr-2 h-4 w-4 text-rose-500" />
                              Excluir produto
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="absolute top-2.5 left-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold backdrop-blur-md shadow-xs ${product.active ? "bg-emerald-500/80 text-white" : "bg-slate-700/80 text-slate-200"}`}>
                      {product.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <p className="truncate font-bold text-slate-900 dark:text-slate-100 text-sm leading-snug">{product.name}</p>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono">{product.sku}</span>
                    {product.category && <span className="truncate max-w-[120px]">{product.category}</span>}
                  </div>
                  <div className="mt-3">
                    <StockBadge quantity={product.quantity} minimumStock={product.minimumStock} />
                  </div>
                </div>
              </div>

              <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 flex items-end justify-between">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block tracking-wider">Preço de venda</span>
                  <span className="text-base font-extrabold text-slate-900 dark:text-slate-100">{money.format(product.salePriceCents / 100)}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block tracking-wider">Custo</span>
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{money.format(product.costPriceCents / 100)}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        /* 4. Visualização em Lista (Tabela Premium) */
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 md:block shadow-xs">
            <table className="w-full min-w-[800px] text-left text-xs">
              <thead className="bg-slate-800/50 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3.5 pl-4">Produto</th>
                  <th className="p-3.5">SKU</th>
                  <th className="p-3.5">Categoria</th>
                  <th className="p-3.5">Custo</th>
                  <th className="p-3.5">Venda</th>
                  <th className="p-3.5">Saldo</th>
                  <th className="p-3.5">Mínimo</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 pr-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {query.data?.items.map(product => (
                  <tr
                    key={product.publicId}
                    onClick={() => setSelectedProductPublicId(product.publicId)}
                    className="cursor-pointer hover:bg-slate-800/60 transition-colors"
                  >
                    <td className="p-3 font-medium">
                      <div className="flex items-center gap-3">
                        <ProductThumbnail
                          product={product}
                          className="w-16 h-16 rounded-xl object-cover border border-slate-700 shadow-md shrink-0"
                          version={mediaVersions[product.publicId]}
                        />
                        <div className="min-w-0 max-w-xs">
                          <p className="text-lg font-bold text-slate-100 block mb-0.5 tracking-tight truncate">{product.name}</p>
                          <span className="text-xs text-slate-400 truncate block mt-0.5">{product.category || "Sem categoria"}</span>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 font-mono text-xs text-slate-300">{product.sku}</td>
                    <td className="p-3 text-xs text-slate-300">{product.category ?? "—"}</td>
                    <td className="p-3 text-xs text-slate-400">{money.format(product.costPriceCents / 100)}</td>
                    <td className="p-3 text-sm font-bold text-slate-100">{money.format(product.salePriceCents / 100)}</td>
                    <td className="p-3">
                      <StockBadge quantity={product.quantity} minimumStock={product.minimumStock} />
                    </td>
                    <td className="p-3 text-xs text-slate-400">{formatQuantity(product.minimumStock)}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                          product.active
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {product.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="p-3 pr-4 text-right" onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 rounded-lg hover:bg-slate-800 text-slate-300"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Ações para {product.name}</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
                          <DropdownMenuItem
                            onClick={() => setSelectedProductPublicId(product.publicId)}
                            className="cursor-pointer text-xs"
                          >
                            <Eye className="mr-2 h-4 w-4 text-slate-500" />
                            Ver detalhes
                          </DropdownMenuItem>
                          {canWrite && (
                            <>
                              <DropdownMenuItem
                                onClick={() => edit(product)}
                                className="cursor-pointer text-xs"
                              >
                                <Pencil className="mr-2 h-4 w-4 text-slate-500" />
                                Editar produto
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => status.mutate({ publicId: product.publicId, active: !product.active })}
                                className="cursor-pointer text-xs"
                              >
                                <Power className="mr-2 h-4 w-4 text-slate-500" />
                                {product.active ? "Inativar produto" : "Ativar produto"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="dark:bg-slate-800" />
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteRequest(product);
                                }}
                                className="cursor-pointer text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus:text-rose-600 dark:focus:text-rose-400 focus:bg-rose-50 dark:focus:bg-rose-950/40"
                              >
                                <Trash2 className="mr-2 h-4 w-4 text-rose-500" />
                                Excluir produto
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {query.data?.items.map(product => (
              <article
                key={product.publicId}
                onClick={() => setSelectedProductPublicId(product.publicId)}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs cursor-pointer hover:border-blue-400 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProductThumbnail
                      product={product}
                      className="w-16 h-16 rounded-xl object-cover border border-slate-700 shadow-md shrink-0"
                      version={mediaVersions[product.publicId]}
                    />
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-slate-900 dark:text-slate-100 block mb-0.5 tracking-tight truncate">{product.name}</p>
                      <p className="truncate text-xs text-slate-400">{product.category || "Sem categoria"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        product.active
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {product.active ? "Ativo" : "Inativo"}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <DropdownMenuItem onClick={() => setSelectedProductPublicId(product.publicId)}>
                          <Eye className="mr-2 h-4 w-4" /> Ver detalhes
                        </DropdownMenuItem>
                        {canWrite && (
                          <>
                            <DropdownMenuItem onClick={() => edit(product)}>
                              <Pencil className="mr-2 h-4 w-4" /> Editar produto
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => status.mutate({ publicId: product.publicId, active: !product.active })}>
                              <Power className="mr-2 h-4 w-4" /> {product.active ? "Inativar" : "Ativar"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRequest(product);
                              }}
                              className="text-rose-600 dark:text-rose-400"
                            >
                              <Trash2 className="mr-2 h-4 w-4 text-rose-500" /> Excluir produto
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs border-t border-slate-100 dark:border-slate-800/80 pt-2">
                  <div><dt className="text-slate-400">Categoria</dt><dd className="font-medium text-slate-700 dark:text-slate-300">{product.category ?? "—"}</dd></div>
                  <div><dt className="text-slate-400">Saldo</dt><dd><StockBadge quantity={product.quantity} minimumStock={product.minimumStock} /></dd></div>
                  <div><dt className="text-slate-400">Custo</dt><dd className="font-medium text-slate-700 dark:text-slate-300">{money.format(product.costPriceCents / 100)}</dd></div>
                  <div><dt className="text-slate-400">Venda</dt><dd className="font-bold text-slate-900 dark:text-slate-100">{money.format(product.salePriceCents / 100)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}

      {/* 4. Rodapé de Paginação Glow */}
      {query.data && (
        <ProductsGlowPagination
          page={page}
          pageSize={pageSize}
          total={query.data.total}
          totalPages={query.data.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

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

      {deleteDialogNode}
    </div>
  );
}

function Filter({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options:Array<[string,string]>}) { return <select aria-label={label} className="min-h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 px-3 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer" value={value} onChange={e=>onChange(e.target.value)}>{options.map(([key,text])=><option key={key||"all"} value={key} className="bg-white dark:bg-slate-900">{text}</option>)}</select>; }
