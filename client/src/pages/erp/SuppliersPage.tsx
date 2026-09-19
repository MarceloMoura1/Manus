import React, { useState, useMemo } from "react";
import {
  Building2,
  Phone,
  Mail,
  MapPin,
  Search,
  Plus,
  User,
  FileText,
  Boxes,
  ShoppingBag,
  Paperclip,
  Clock,
  Edit3,
  X,
  ChevronRight,
  ChevronLeft,
  Hash,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCw,
  Package,
  ShieldCheck,
  Star,
  Trash2,
  Calendar,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate, formatDateTime } from "@/lib/conversationDateTime";
import { productMediaUrl } from "@/lib/trpc-url";
import { normalizeContactPhone, formatContactPhone } from "../../../../shared/contact-phone";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function cn(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatMoneyCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return moneyFormatter.format(cents / 100);
}

export function formatCpfCnpj(value: string | null | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return value?.trim() || "—";
}

export function formatCep(value: string | null | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 8) {
    return digits.replace(/(\d{5})(\d{3})/, "$1-$2");
  }
  return value?.trim() || "—";
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SupplierItem = {
  publicId: string;
  legalName: string;
  tradeName: string | null;
  personType: "legal" | "individual";
  taxId: string | null;
  stateRegistration: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  postalCode: string | null;
  street: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type SupplierTab = "geral" | "produtos" | "compras" | "timeline" | "arquivos";

export type SuppliersPageProps = {
  onNavigate?: (section: any) => void;
  whatsappConnected?: boolean;
  canStartConversation?: boolean;
  onClientNavigate?: (intent: any) => void;
  initialSelectedId?: string;
};

type SupplierFormData = {
  publicId?: string;
  legalName: string;
  tradeName: string;
  personType: "legal" | "individual";
  taxId: string;
  stateRegistration: string;
  email: string;
  phone: string;
  contactName: string;
  postalCode: string;
  street: string;
  addressNumber: string;
  addressComplement: string;
  district: string;
  city: string;
  state: string;
  notes: string;
};

const EMPTY_SUPPLIER_FORM: SupplierFormData = {
  legalName: "",
  tradeName: "",
  personType: "legal",
  taxId: "",
  stateRegistration: "",
  email: "",
  phone: "",
  contactName: "",
  postalCode: "",
  street: "",
  addressNumber: "",
  addressComplement: "",
  district: "",
  city: "",
  state: "",
  notes: "",
};

// ─── Componente Principal ─────────────────────────────────────────────────────

export function SuppliersPage({
  onNavigate,
  whatsappConnected = false,
  canStartConversation = false,
  onClientNavigate,
  initialSelectedId,
}: SuppliersPageProps = {}) {
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(initialSelectedId ?? null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editSupplierData, setEditSupplierData] = useState<SupplierItem | null>(null);

  // Consulta de fornecedores
  const suppliersQuery = trpc.erp.suppliers.list.useQuery({
    search: search.trim(),
    active: activeFilter === "all" ? undefined : activeFilter === "active",
    sort: "legalName",
    direction: "asc",
    page,
    pageSize,
  });

  const setActiveMutation = trpc.erp.suppliers.setActive.useMutation();

  const suppliers = suppliersQuery.data?.items ?? [];
  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.publicId === selectedSupplierId) ?? null,
    [suppliers, selectedSupplierId]
  );

  // Auto-selecionar o primeiro em viewport desktop se nada selecionado
  React.useEffect(() => {
    if (!selectedSupplierId && suppliers.length > 0 && typeof window !== "undefined" && window.innerWidth >= 1024) {
      setSelectedSupplierId(suppliers[0].publicId);
    }
  }, [suppliers, selectedSupplierId]);

  // Exportar CSV
  const handleExportCsv = () => {
    if (!suppliers.length) {
      toast.error("Nenhum fornecedor para exportar.");
      return;
    }
    const headers = ["Razão Social", "Nome Fantasia", "Tipo", "CNPJ/CPF", "Telefone", "E-mail", "Contato", "Cidade", "UF", "Status"];
    const rows = suppliers.map((s) => [
      `"${(s.legalName || "").replace(/"/g, '""')}"`,
      `"${(s.tradeName || "").replace(/"/g, '""')}"`,
      s.personType === "legal" ? "Pessoa Jurídica" : "Pessoa Física",
      `"${s.taxId || ""}"`,
      `"${s.phone || ""}"`,
      `"${s.email || ""}"`,
      `"${(s.contactName || "").replace(/"/g, '""')}"`,
      `"${(s.city || "").replace(/"/g, '""')}"`,
      `"${s.state || ""}"`,
      s.active ? "Ativo" : "Inativo",
    ]);
    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fornecedores_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Lista de fornecedores exportada com sucesso!");
  };

  const handleToggleActive = async (supplier: SupplierItem) => {
    try {
      await setActiveMutation.mutateAsync({
        publicId: supplier.publicId,
        active: !supplier.active,
      });
      toast.success(supplier.active ? "Fornecedor inativado com sucesso." : "Fornecedor ativado com sucesso.");
      await utils.erp.suppliers.invalidate();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível alterar o status do fornecedor.");
    }
  };

  return (
    <div
      data-testid="erp-suppliers-page"
      className="flex h-full min-w-0 flex-col gap-0 overflow-hidden rounded-[28px] border border-slate-200/80 bg-slate-100/70 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 lg:flex-row"
    >
      {/* ─── Painel Esquerdo: Lista de Fornecedores ─── */}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col bg-white dark:bg-slate-900 transition-all duration-200 lg:border-r lg:border-slate-200/80 dark:lg:border-slate-800",
          selectedSupplier ? "hidden lg:flex lg:w-80 xl:w-96 flex-shrink-0" : "flex-1"
        )}
      >
        {/* Cabeçalho da Lista */}
        <div className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 p-4 sm:p-5">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-400">
                Fornecimento
              </p>
              <div className="mt-1 flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-slate-950 dark:text-slate-50">
                  Fornecedores
                </h2>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                  {suppliersQuery.data?.total ?? suppliers.length}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                title="Exportar fornecedores em CSV"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Exportar</span>
              </button>
              {suppliersQuery.data?.canWrite !== false && (
                <button
                  type="button"
                  onClick={() => {
                    setEditSupplierData(null);
                    setShowFormModal(true);
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-blue-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Novo</span>
                </button>
              )}
            </div>
          </div>

          {/* Busca Compacta */}
          <div className="relative mb-2.5">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar fornecedor, documento, telefone..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500"
            />
          </div>

          {/* Filtros Rápidos de Status */}
          <div className="flex flex-wrap gap-1" aria-label="Filtrar fornecedores por status">
            {(
              [
                ["active", "Ativos"],
                ["inactive", "Inativos"],
                ["all", "Todos"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                aria-pressed={activeFilter === val}
                onClick={() => {
                  setActiveFilter(val);
                  setPage(1);
                }}
                className={cn(
                  "min-h-7 rounded-lg px-2.5 text-xs font-semibold transition-colors",
                  activeFilter === val
                    ? "bg-blue-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Lista com scroll */}
        <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
          {suppliersQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : suppliersQuery.isError ? (
            <div className="flex flex-col items-center justify-center p-6 text-center" role="alert">
              <AlertTriangle className="mb-2 h-8 w-8 text-amber-500" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Não foi possível carregar os fornecedores</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{suppliersQuery.error.message}</p>
              <button
                type="button"
                onClick={() => void suppliersQuery.refetch()}
                className="mt-3 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
              >
                Tentar novamente
              </button>
            </div>
          ) : suppliers.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <Building2 className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {search ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {search ? "Tente buscar com outros termos." : "Clique em \"Novo\" para cadastrar o primeiro fornecedor."}
              </p>
            </div>
          ) : (
            suppliers.map((supplier) => {
              const isSelected = selectedSupplierId === supplier.publicId;
              return (
                <button
                  key={supplier.publicId}
                  type="button"
                  onClick={() => setSelectedSupplierId(supplier.publicId)}
                  className={cn(
                    "group w-full rounded-2xl border p-3 text-left shadow-xs transition-all duration-150",
                    isSelected
                      ? "border-blue-200 bg-blue-50/80 ring-1 ring-blue-200 dark:border-blue-800 dark:bg-blue-950/40 dark:ring-blue-800"
                      : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50/80 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
                        {supplier.tradeName || supplier.legalName}
                      </p>
                      {supplier.tradeName && supplier.legalName !== supplier.tradeName && (
                        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{supplier.legalName}</p>
                      )}

                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {supplier.personType === "legal" ? "Empresa" : "Pessoa"}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold",
                            supplier.active
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          )}
                        >
                          {supplier.active ? "Ativo" : "Inativo"}
                        </span>
                        {supplier.taxId && (
                          <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 self-center ml-1">
                            {formatCpfCnpj(supplier.taxId)}
                          </span>
                        )}
                      </div>

                      {/* Informações de contato */}
                      {(supplier.phone || supplier.contactName) && (
                        <p className="mt-1.5 flex items-center gap-1 truncate text-xs text-slate-500 dark:text-slate-400">
                          <Phone className="h-3 w-3 text-slate-400 flex-shrink-0" />
                          <span>{supplier.contactName ? `${supplier.contactName} • ` : ""}{formatContactPhone(supplier.phone)}</span>
                        </p>
                      )}
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300 dark:text-slate-600 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Rodapé da Lista */}
        {suppliers.length > 0 && (
          <div className="border-t border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-2.5 text-center text-xs text-slate-500 dark:text-slate-400">
            {suppliersQuery.data?.total ?? suppliers.length} fornecedor{(suppliersQuery.data?.total ?? suppliers.length) !== 1 ? "es" : ""}
          </div>
        )}
      </div>

      {/* ─── Painel Direito: Workspace do Fornecedor ─── */}
      {selectedSupplier ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-slate-900 overflow-hidden">
          <SupplierDetailPanel
            supplier={selectedSupplier}
            onClose={() => setSelectedSupplierId(null)}
            onEdit={() => {
              setEditSupplierData(selectedSupplier);
              setShowFormModal(true);
            }}
            onToggleActive={() => handleToggleActive(selectedSupplier)}
            onNavigate={onNavigate}
            whatsappConnected={whatsappConnected}
            canStartConversation={canStartConversation}
            onClientNavigate={onClientNavigate}
          />
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center bg-slate-50/60 dark:bg-slate-950/40 p-8">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900 shadow-xs">
              <Building2 className="h-8 w-8" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Selecione um fornecedor</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Escolha um fornecedor da lista para consultar produtos, compras e informações do relacionamento.
            </p>
          </div>
        </div>
      )}

      {/* ─── Modal de Cadastro / Edição ─── */}
      {showFormModal && (
        <SupplierFormDialog
          open={showFormModal}
          onClose={() => {
            setShowFormModal(false);
            setEditSupplierData(null);
          }}
          supplier={editSupplierData}
          onSuccess={async (newPublicId) => {
            await utils.erp.suppliers.invalidate();
            setShowFormModal(false);
            setEditSupplierData(null);
            if (newPublicId) setSelectedSupplierId(newPublicId);
          }}
        />
      )}
    </div>
  );
}

// ─── Painel de Detalhes do Fornecedor ──────────────────────────────────────────

function SupplierDetailPanel({
  supplier,
  onClose,
  onEdit,
  onToggleActive,
  onNavigate,
  whatsappConnected,
  canStartConversation,
  onClientNavigate,
}: {
  supplier: SupplierItem;
  onClose: () => void;
  onEdit: () => void;
  onToggleActive: () => Promise<void>;
  onNavigate?: (section: any) => void;
  whatsappConnected: boolean;
  canStartConversation: boolean;
  onClientNavigate?: (intent: any) => void;
}) {
  const [activeTab, setActiveTab] = useState<SupplierTab>("geral");
  const [actionPending, setActionPending] = useState(false);

  const phoneNorm = normalizeContactPhone(supplier.phone);
  const hasValidPhone = phoneNorm.status === "valid";

  const handleOpenWhatsApp = () => {
    if (!hasValidPhone || !phoneNorm.value) {
      toast.error("Fornecedor não possui telefone válido para WhatsApp.");
      return;
    }
    if (canStartConversation && onClientNavigate) {
      onClientNavigate({
        crmClientId: supplier.publicId,
        phone: phoneNorm.value,
        channel: "whatsapp",
      });
      return;
    }
    window.open(`https://wa.me/${phoneNorm.value}`, "_blank", "noopener,noreferrer");
  };

  const tabs: Array<{ id: SupplierTab; label: string; icon: React.ReactNode }> = [
    { id: "geral", label: "Visão geral", icon: <FileText className="h-3.5 w-3.5" /> },
    { id: "produtos", label: "Produtos", icon: <Boxes className="h-3.5 w-3.5" /> },
    { id: "compras", label: "Compras", icon: <ShoppingBag className="h-3.5 w-3.5" /> },
    { id: "timeline", label: "Timeline", icon: <Clock className="h-3.5 w-3.5" /> },
    { id: "arquivos", label: "Arquivos", icon: <Paperclip className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho do Workspace */}
      <div className="border-b border-slate-200/80 dark:border-slate-800 bg-gradient-to-r from-slate-50/90 to-white dark:from-slate-900 dark:to-slate-900/90 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {/* Botão voltar para telas pequenas */}
            <button
              type="button"
              onClick={onClose}
              className="mr-1 mt-1 rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800 lg:hidden"
              title="Voltar para a lista"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 border border-blue-200/60 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 shadow-xs">
              <Building2 className="h-6 w-6" />
            </div>

            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-950 dark:text-slate-50 leading-tight">
                {supplier.tradeName || supplier.legalName}
              </h2>
              {supplier.tradeName && supplier.legalName !== supplier.tradeName && (
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">{supplier.legalName}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700">
                  {supplier.personType === "legal" ? "Pessoa Jurídica" : "Pessoa Física"}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-bold border",
                    supplier.active
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                      : "bg-slate-100 text-slate-600 border-slate-200/60 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                  )}
                >
                  {supplier.active ? "Ativo" : "Inativo"}
                </span>
                {supplier.taxId && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-mono font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700">
                    {formatCpfCnpj(supplier.taxId)}
                  </span>
                )}
                {supplier.city && (
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 ml-1">
                    {[supplier.city, supplier.state].filter(Boolean).join(" / ")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Ações contextuais */}
          <div className="flex items-center gap-1.5">
            {hasValidPhone && (
              <button
                type="button"
                onClick={handleOpenWhatsApp}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/80 shadow-xs"
                title="Conversar pelo WhatsApp"
              >
                <Smartphone className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="hidden sm:inline">WhatsApp</span>
              </button>
            )}

            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 shadow-xs"
              title="Editar fornecedor"
            >
              <Edit3 className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              <span>Editar</span>
            </button>

            {/* Alternar Status Contextual (Sem Zona de Risco vermelha) */}
            <button
              type="button"
              disabled={actionPending}
              onClick={async () => {
                setActionPending(true);
                try {
                  await onToggleActive();
                } finally {
                  setActionPending(false);
                }
              }}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors shadow-xs disabled:opacity-60",
                supplier.active
                  ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              )}
              title={supplier.active ? "Inativar fornecedor" : "Ativar fornecedor"}
            >
              {supplier.active ? "Inativar" : "Ativar"}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="hidden lg:flex rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              title="Fechar painel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Navegação por Abas */}
      <div className="flex gap-1 border-b border-slate-200/80 dark:border-slate-800 px-4 pt-2 overflow-x-auto bg-white dark:bg-slate-900">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors rounded-t-lg",
              activeTab === tab.id
                ? "border-blue-600 bg-blue-50/70 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-500"
                : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conteúdo Contextual da Aba */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {activeTab === "geral" && <TabOverview supplier={supplier} />}
        {activeTab === "produtos" && <TabProducts supplier={supplier} />}
        {activeTab === "compras" && <TabPurchases supplier={supplier} onNavigate={onNavigate} />}
        {activeTab === "timeline" && <TabTimeline supplier={supplier} />}
        {activeTab === "arquivos" && <TabFiles supplier={supplier} />}
      </div>
    </div>
  );
}

// ─── Aba: Visão Geral ─────────────────────────────────────────────────────────

function TabOverview({ supplier }: { supplier: SupplierItem }) {
  return (
    <div className="space-y-4">
      {/* Contato e Identificação Cadastral */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Contato */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" /> Contato
          </h4>
          <div className="space-y-2.5 text-xs">
            <div>
              <span className="text-slate-400 dark:text-slate-500">Contato principal:</span>
              <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.contactName || "—"}</p>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500">Telefone:</span>
              <p className="font-semibold text-slate-900 dark:text-slate-100">{formatContactPhone(supplier.phone)}</p>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500">E-mail:</span>
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                {supplier.email ? (
                  <a href={`mailto:${supplier.email}`} className="text-blue-600 hover:underline dark:text-blue-400">
                    {supplier.email}
                  </a>
                ) : (
                  "—"
                )}
              </p>
            </div>
          </div>
        </section>

        {/* Identificação */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5" /> Identificação Cadastral
          </h4>
          <div className="space-y-2.5 text-xs">
            <div>
              <span className="text-slate-400 dark:text-slate-500">Razão Social:</span>
              <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.legalName}</p>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500">Nome Fantasia:</span>
              <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.tradeName || "—"}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-400 dark:text-slate-500">{supplier.personType === "legal" ? "CNPJ:" : "CPF:"}</span>
                <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">{formatCpfCnpj(supplier.taxId)}</p>
              </div>
              <div>
                <span className="text-slate-400 dark:text-slate-500">Inscrição Estadual:</span>
                <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">{supplier.stateRegistration || "—"}</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Endereço */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" /> Endereço
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          <div className="sm:col-span-2">
            <span className="text-slate-400 dark:text-slate-500">Logradouro:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {[supplier.street, supplier.addressNumber].filter(Boolean).join(", ") || "—"}
            </p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">Complemento:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.addressComplement || "—"}</p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">Bairro:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.district || "—"}</p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">Cidade / UF:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {[supplier.city, supplier.state].filter(Boolean).join(" / ") || "—"}
            </p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">CEP:</span>
            <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">{formatCep(supplier.postalCode)}</p>
          </div>
        </div>
      </section>

      {/* Relacionamento Comercial */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Relacionamento Comercial
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
          <div>
            <span className="text-slate-400 dark:text-slate-500">Fornecedor desde:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{formatDate(supplier.createdAt) || "—"}</p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">Última atualização:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{formatDate(supplier.updatedAt) || "—"}</p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">Situação:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.active ? "Ativo" : "Inativo"}</p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-slate-500">Perfil:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {supplier.personType === "legal" ? "Pessoa Jurídica" : "Pessoa Física"}
            </p>
          </div>
        </div>
      </section>

      {/* Observações Internas */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" /> Observações Internas
        </h4>
        {supplier.notes ? (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed border border-slate-100 dark:border-slate-800">
            {supplier.notes}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">Nenhuma observação interna registrada.</p>
        )}
      </section>
    </div>
  );
}

// ─── Aba: Produtos ────────────────────────────────────────────────────────────

function TabProducts({ supplier }: { supplier: SupplierItem }) {
  const utils = trpc.useUtils();
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  const productsQuery = trpc.erp.productSuppliers.list.useQuery({
    supplierPublicId: supplier.publicId,
    pageSize: 100,
  });

  const setPreferredMutation = trpc.erp.productSuppliers.setPreferred.useMutation();
  const deleteMutation = trpc.erp.productSuppliers.delete.useMutation();

  const handleTogglePreferred = async (publicId: string, current: boolean) => {
    setActionPending(true);
    try {
      await setPreferredMutation.mutateAsync({
        publicId,
        isPreferred: !current,
      });
      toast.success(!current ? "Definido como fornecedor preferencial." : "Desmarcado como preferencial.");
      await utils.erp.productSuppliers.invalidate();
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar fornecedor preferencial.");
    } finally {
      setActionPending(false);
    }
  };

  const handleDisassociate = async (publicId: string, productName: string) => {
    if (!window.confirm(`Deseja realmente desvincular o produto "${productName}" deste fornecedor?`)) {
      return;
    }
    setActionPending(true);
    try {
      await deleteMutation.mutateAsync({ publicId });
      toast.success("Produto desvinculado com sucesso.");
      await utils.erp.productSuppliers.invalidate();
    } catch (err: any) {
      toast.error(err.message || "Erro ao desvincular produto.");
    } finally {
      setActionPending(false);
    }
  };

  const items = productsQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Header da aba */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Produtos Fornecidos</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Produtos que compramos ou podemos cotar com este fornecedor.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowLinkModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-blue-700"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Vincular produto</span>
        </button>
      </div>

      {/* Conteúdo */}
      {productsQuery.isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
        </div>
      ) : productsQuery.isError ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-500" />
          <p className="text-xs text-slate-600 dark:text-slate-300">{productsQuery.error.message}</p>
          <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={() => void productsQuery.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <Package className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Nenhum produto vinculado a este fornecedor</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Clique em "Vincular produto" para registrar itens comprados, referências de código e custos praticados.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.publicId}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* Imagem canônica com container profissional */}
                <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/80 flex items-center justify-center">
                  <img
                    src={productMediaUrl(`/api/products/${item.productPublicId}/image?variant=thumbnail`)}
                    crossOrigin="use-credentials"
                    alt={item.productName}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = "none";
                    }}
                  />
                  <Package className="h-5 w-5 text-slate-300 dark:text-slate-600" />
                </div>

                <div className="min-w-0 flex-1 text-xs">
                  <p className="font-bold text-slate-900 dark:text-slate-100 truncate">{item.productName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-500 dark:text-slate-400">
                    <span className="font-mono">SKU: {item.productSku}</span>
                    {item.supplierProductCode && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Cód. Fornecedor: {item.supplierProductCode}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div>
                  <span className="block text-[10px] text-slate-400 dark:text-slate-500">Custo Ref.</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {formatMoneyCents(item.costPriceCents)}
                  </span>
                </div>

                {item.isPreferred && (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    <Star className="h-3 w-3 fill-emerald-600 text-emerald-600 dark:fill-emerald-400 dark:text-emerald-400" />
                    Preferencial
                  </span>
                )}

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={() => handleTogglePreferred(item.publicId, item.isPreferred)}
                    className={cn(
                      "rounded-lg p-1.5 transition-colors",
                      item.isPreferred
                        ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                        : "text-slate-300 hover:bg-slate-100 hover:text-amber-500 dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-amber-400"
                    )}
                    title={item.isPreferred ? "Desmarcar preferencial" : "Definir como preferencial"}
                  >
                    <Star className={cn("h-4 w-4", item.isPreferred ? "fill-amber-400" : "")} />
                  </button>

                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={() => handleDisassociate(item.publicId, item.productName)}
                    className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600 transition-colors dark:text-slate-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    title="Desvincular produto"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Vincular Produto */}
      {showLinkModal && (
        <LinkProductDialog
          open={showLinkModal}
          onClose={() => setShowLinkModal(false)}
          supplier={supplier}
          onSuccess={async () => {
            await utils.erp.productSuppliers.invalidate();
            setShowLinkModal(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Modal: Vincular Produto ──────────────────────────────────────────────────

function LinkProductDialog({
  open,
  onClose,
  supplier,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  supplier: SupplierItem;
  onSuccess: () => Promise<void>;
}) {
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductPublicId, setSelectedProductPublicId] = useState<string>("");
  const [supplierProductCode, setSupplierProductCode] = useState("");
  const [costPriceStr, setCostPriceStr] = useState("");
  const [isPreferred, setIsPreferred] = useState(false);
  const [pending, setPending] = useState(false);

  const productsQuery = trpc.erp.products.list.useQuery({
    search: productSearch,
    pageSize: 20,
  });

  const createMutation = trpc.erp.productSuppliers.create.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductPublicId) {
      toast.error("Selecione um produto para vincular.");
      return;
    }

    setPending(true);
    try {
      const parsedCost = costPriceStr ? Math.round(parseFloat(costPriceStr.replace(",", ".")) * 100) : null;
      await createMutation.mutateAsync({
        supplierPublicId: supplier.publicId,
        productPublicId: selectedProductPublicId,
        supplierProductCode: supplierProductCode.trim() || null,
        costPriceCents: parsedCost && !Number.isNaN(parsedCost) && parsedCost >= 0 ? parsedCost : null,
        isPreferred,
        active: true,
      });
      toast.success("Produto vinculado com sucesso ao fornecedor!");
      await onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível vincular o produto.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 sm:max-w-lg shadow-2xl opacity-100">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            Vincular Produto ao Fornecedor
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Fornecedor Selecionado
            </label>
            <p className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2.5 font-bold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
              {supplier.tradeName || supplier.legalName}
            </p>
          </div>

          {/* Selecionar Produto */}
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Pesquisar e Selecionar Produto <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Buscar por nome ou SKU..."
              className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            />

            <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 bg-slate-50 dark:bg-slate-950/60">
              {productsQuery.isLoading ? (
                <p className="p-2 text-center text-slate-400">Buscando produtos...</p>
              ) : (productsQuery.data?.items ?? []).length === 0 ? (
                <p className="p-2 text-center text-slate-400">Nenhum produto encontrado.</p>
              ) : (
                productsQuery.data?.items.map((prod) => (
                  <button
                    key={prod.publicId}
                    type="button"
                    onClick={() => setSelectedProductPublicId(prod.publicId)}
                    className={cn(
                      "w-full rounded-lg p-2 text-left transition-colors flex items-center justify-between",
                      selectedProductPublicId === prod.publicId
                        ? "bg-blue-600 text-white font-semibold"
                        : "hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200"
                    )}
                  >
                    <span className="truncate">{prod.name}</span>
                    <span className="font-mono text-[10px] ml-2 opacity-80">{prod.sku}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Código do fornecedor */}
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Código do Produto no Fornecedor (opcional)
            </label>
            <input
              type="text"
              value={supplierProductCode}
              onChange={(e) => setSupplierProductCode(e.target.value)}
              placeholder="Ex: REF-9948, PART-01"
              className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Custo de referência */}
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Custo de Referência (R$, opcional)
            </label>
            <input
              type="text"
              value={costPriceStr}
              onChange={(e) => setCostPriceStr(e.target.value)}
              placeholder="Ex: 45,90"
              className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Preferencial */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="isPreferredCheckbox"
              checked={isPreferred}
              onChange={(e) => setIsPreferred(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isPreferredCheckbox" className="font-semibold text-slate-700 dark:text-slate-300 select-none">
              Marcar como Fornecedor Preferencial para este produto
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={pending || !selectedProductPublicId}>
              {pending ? "Vinculando..." : "Vincular Produto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Aba: Compras ─────────────────────────────────────────────────────────────

function TabPurchases({ supplier, onNavigate }: { supplier: SupplierItem; onNavigate?: (section: any) => void }) {
  const purchasesQuery = trpc.erp.purchases.list.useQuery({
    supplierPublicId: supplier.publicId,
    pageSize: 50,
  });

  const orders = purchasesQuery.data?.items ?? [];

  const metrics = useMemo(() => {
    let totalCents = 0;
    let count = orders.length;
    let lastDate: string | null = null;

    for (const ord of orders) {
      if (ord.status === "received" || ord.status === "approved") {
        totalCents += ord.totalCents;
      }
      if (!lastDate || new Date(ord.createdAt) > new Date(lastDate)) {
        lastDate = ord.createdAt;
      }
    }

    const ticketCents = count > 0 ? Math.round(totalCents / count) : 0;

    return {
      totalPurchased: formatMoneyCents(totalCents),
      lastPurchaseDate: lastDate ? formatDate(lastDate) : "—",
      ordersCount: count,
      averageTicket: formatMoneyCents(ticketCents),
    };
  }, [orders]);

  const statusMap: Record<string, { label: string; style: string }> = {
    draft: { label: "Rascunho", style: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    approved: { label: "Aprovado", style: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300" },
    received: { label: "Recebido", style: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
    cancelled: { label: "Cancelado", style: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" },
  };

  return (
    <div className="space-y-4">
      {/* Indicadores Factualmente Calculáveis */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Total Comprado</p>
          <p className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">{metrics.totalPurchased}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Última Compra</p>
          <p className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">{metrics.lastPurchaseDate}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Pedidos</p>
          <p className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">{metrics.ordersCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Ticket Médio</p>
          <p className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">{metrics.averageTicket}</p>
        </div>
      </div>

      {/* Lista de Ordens de Compra */}
      {purchasesQuery.isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
        </div>
      ) : purchasesQuery.isError ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-500" />
          <p className="text-xs text-slate-600 dark:text-slate-300">{purchasesQuery.error.message}</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Nenhum pedido de compra para este fornecedor</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Quando ordens de compra forem emitidas no módulo Compras, elas aparecerão aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => {
            const st = statusMap[order.status] || { label: order.status, style: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" };
            return (
              <div
                key={order.publicId}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">{order.orderNumber}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", st.style)}>
                      {st.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                    Emitido em: {formatDate(order.createdAt)}
                    {order.receivedAt && ` • Recebido em: ${formatDate(order.receivedAt)}`}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-right">
                  <div>
                    <span className="block text-[10px] text-slate-400 dark:text-slate-500">Valor Total</span>
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {formatMoneyCents(order.totalCents)}
                    </span>
                  </div>

                  {onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate("purchases")}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      title="Abrir no módulo Compras"
                    >
                      Ver compra
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Aba: Timeline ────────────────────────────────────────────────────────────

function TabTimeline({ supplier }: { supplier: SupplierItem }) {
  const productsQuery = trpc.erp.productSuppliers.list.useQuery({
    supplierPublicId: supplier.publicId,
    pageSize: 50,
  });

  const purchasesQuery = trpc.erp.purchases.list.useQuery({
    supplierPublicId: supplier.publicId,
    pageSize: 50,
  });

  const timelineEvents = useMemo(() => {
    type TimelineItem = {
      id: string;
      date: string;
      title: string;
      description: string;
      actor: string;
      icon: React.ReactNode;
      color: string;
    };

    const list: TimelineItem[] = [];

    // Evento 1: Fornecedor cadastrado
    list.push({
      id: `created-${supplier.publicId}`,
      date: supplier.createdAt,
      title: "Fornecedor Cadastrado",
      description: `Cadastro inicial de ${supplier.tradeName || supplier.legalName} concluído.`,
      actor: "Usuário indisponível",
      icon: <Building2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />,
      color: "bg-blue-100 dark:bg-blue-950/60",
    });

    // Evento 2: Atualização cadastral se posterior
    if (supplier.updatedAt && supplier.updatedAt !== supplier.createdAt) {
      list.push({
        id: `updated-${supplier.publicId}`,
        date: supplier.updatedAt,
        title: "Cadastro Atualizado",
        description: "Informações cadastrais ou comerciais foram atualizadas.",
        actor: "Usuário indisponível",
        icon: <Edit3 className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />,
        color: "bg-slate-100 dark:bg-slate-800",
      });
    }

    // Eventos de produtos vinculados
    for (const prod of productsQuery.data?.items ?? []) {
      list.push({
        id: `prod-${prod.publicId}`,
        date: prod.createdAt,
        title: "Produto Vinculado",
        description: `Produto "${prod.productName}" (SKU: ${prod.productSku}) associado a este fornecedor.`,
        actor: "Usuário indisponível",
        icon: <Boxes className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />,
        color: "bg-purple-100 dark:bg-purple-950/60",
      });
    }

    // Eventos de compras
    for (const po of purchasesQuery.data?.items ?? []) {
      list.push({
        id: `po-${po.publicId}`,
        date: po.createdAt,
        title: `Pedido ${po.orderNumber} Criado`,
        description: `Ordem de compra no valor de ${formatMoneyCents(po.totalCents)} emitida.`,
        actor: "Usuário indisponível",
        icon: <ShoppingBag className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />,
        color: "bg-emerald-100 dark:bg-emerald-950/60",
      });
      if (po.receivedAt) {
        list.push({
          id: `po-rec-${po.publicId}`,
          date: po.receivedAt,
          title: `Pedido ${po.orderNumber} Recebido`,
          description: "Mercadorias recebidas e integradas ao estoque.",
          actor: "Usuário indisponível",
          icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />,
          color: "bg-emerald-100 dark:bg-emerald-950/60",
        });
      }
    }

    list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return list;
  }, [supplier, productsQuery.data, purchasesQuery.data]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Timeline de Relacionamento</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Registro factual das atividades e marcos comerciais deste fornecedor.
        </p>
      </div>

      <div className="space-y-3 pt-2">
        {timelineEvents.map((ev, idx) => (
          <div key={ev.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn("flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full", ev.color)}>
                {ev.icon}
              </div>
              {idx !== timelineEvents.length - 1 && <div className="mt-1 w-px flex-1 bg-slate-200 dark:bg-slate-800" />}
            </div>

            <div className="flex-1 pb-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{ev.title}</p>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">{formatDateTime(ev.date)}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{ev.description}</p>
              <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">Responsável: {ev.actor}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Aba: Arquivos ────────────────────────────────────────────────────────────

function TabFiles({ supplier }: { supplier: SupplierItem }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Documentos e Anexos Comerciais</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Centralização de tabelas de preços, propostas, contratos e documentações fiscais.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <Paperclip className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Armazenamento de Documentos</h4>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          O MegaDesk mantém armazenamento estritamente privado, autenticado e isolado por tenant.
          O provisionamento deste repositório documental seguro para fornecedores está catalogado e
          aguardando o gate de infraestrutura correspondente.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {["Tabelas de Preços", "Catálogos em PDF", "Contratos de Fornecimento", "Documentos Fiscais / CNPJ"].map(
            (cat) => (
              <span
                key={cat}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {cat}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Cadastro / Edição de Fornecedor ───────────────────────────────────

function SupplierFormDialog({
  open,
  onClose,
  supplier,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  supplier?: SupplierItem | null;
  onSuccess: (publicId?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<SupplierFormData>(() => {
    if (supplier) {
      return {
        publicId: supplier.publicId,
        legalName: supplier.legalName,
        tradeName: supplier.tradeName || "",
        personType: supplier.personType,
        taxId: supplier.taxId || "",
        stateRegistration: supplier.stateRegistration || "",
        email: supplier.email || "",
        phone: supplier.phone || "",
        contactName: supplier.contactName || "",
        postalCode: supplier.postalCode || "",
        street: supplier.street || "",
        addressNumber: supplier.addressNumber || "",
        addressComplement: supplier.addressComplement || "",
        district: supplier.district || "",
        city: supplier.city || "",
        state: supplier.state || "",
        notes: supplier.notes || "",
      };
    }
    return { ...EMPTY_SUPPLIER_FORM };
  });

  const [pending, setPending] = useState(false);

  const createMutation = trpc.erp.suppliers.create.useMutation();
  const updateMutation = trpc.erp.suppliers.update.useMutation();

  const setField = <K extends keyof SupplierFormData>(key: K, value: SupplierFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);

    try {
      if (form.publicId) {
        const res = await updateMutation.mutateAsync({
          publicId: form.publicId,
          ...form,
        });
        toast.success("Fornecedor atualizado com sucesso!");
        await onSuccess(res.publicId);
      } else {
        const res = await createMutation.mutateAsync({
          ...form,
        });
        toast.success("Fornecedor cadastrado com sucesso!");
        await onSuccess(res.publicId);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar fornecedor.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 sm:max-w-2xl shadow-2xl opacity-100">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            {supplier ? "Editar Fornecedor" : "Novo Fornecedor"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          {/* SEÇÃO: IDENTIFICAÇÃO */}
          <section className="space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 text-[10px]">
              1. Identificação
            </h4>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tipo de Pessoa <span className="text-red-500">*</span>
                </label>
                <select
                  aria-label="Tipo de pessoa"
                  value={form.personType}
                  onChange={(e) => setField("personType", e.target.value as "legal" | "individual")}
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="legal">Pessoa Jurídica (Empresa)</option>
                  <option value="individual">Pessoa Física</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {form.personType === "legal" ? "CNPJ" : "CPF"}
                </label>
                <input
                  type="text"
                  value={form.taxId}
                  onChange={(e) => setField("taxId", e.target.value)}
                  placeholder={form.personType === "legal" ? "00.000.000/0000-00" : "000.000.000-00"}
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Razão Social / Nome Completo <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  value={form.legalName}
                  onChange={(e) => setField("legalName", e.target.value)}
                  placeholder="Nome oficial ou razão social registrada"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nome Fantasia
                </label>
                <input
                  type="text"
                  value={form.tradeName}
                  onChange={(e) => setField("tradeName", e.target.value)}
                  placeholder="Nome comercial ou de marca"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Inscrição Estadual
                </label>
                <input
                  type="text"
                  value={form.stateRegistration}
                  onChange={(e) => setField("stateRegistration", e.target.value)}
                  placeholder="Número da IE se houver"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </section>

          {/* SEÇÃO: CONTATO */}
          <section className="space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 text-[10px]">
              2. Contato
            </h4>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Telefone / Celular
                </label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="(00) 00000-0000"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Contato Principal
                </label>
                <input
                  type="text"
                  value={form.contactName}
                  onChange={(e) => setField("contactName", e.target.value)}
                  placeholder="Ex: João Silva - Representante"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  E-mail Comercial
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder="vendas@fornecedor.com.br"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </section>

          {/* SEÇÃO: ENDEREÇO */}
          <section className="space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 text-[10px]">
              3. Endereço
            </h4>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  CEP
                </label>
                <input
                  type="text"
                  value={form.postalCode}
                  onChange={(e) => setField("postalCode", e.target.value)}
                  placeholder="00000-000"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Logradouro (Rua / Av.)
                </label>
                <input
                  type="text"
                  value={form.street}
                  onChange={(e) => setField("street", e.target.value)}
                  placeholder="Ex: Av. Paulista"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Número
                </label>
                <input
                  type="text"
                  value={form.addressNumber}
                  onChange={(e) => setField("addressNumber", e.target.value)}
                  placeholder="1000"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Complemento
                </label>
                <input
                  type="text"
                  value={form.addressComplement}
                  onChange={(e) => setField("addressComplement", e.target.value)}
                  placeholder="Galpão 4, Sala 12"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Bairro
                </label>
                <input
                  type="text"
                  value={form.district}
                  onChange={(e) => setField("district", e.target.value)}
                  placeholder="Distrito Industrial"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Cidade
                </label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setField("city", e.target.value)}
                  placeholder="São Paulo"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  UF
                </label>
                <input
                  type="text"
                  maxLength={2}
                  value={form.state}
                  onChange={(e) => setField("state", e.target.value.toUpperCase())}
                  placeholder="SP"
                  className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </section>

          {/* SEÇÃO: OBSERVAÇÕES */}
          <section className="space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 text-[10px]">
              4. Observações Comerciais
            </h4>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="Ex: Prazo médio de entrega de 7 dias úteis. Pedido mínimo de R$ 1.000."
              className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950 p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </section>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={pending || !form.legalName.trim()}>
              {pending ? "Salvando..." : supplier ? "Salvar Alterações" : "Cadastrar Fornecedor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
