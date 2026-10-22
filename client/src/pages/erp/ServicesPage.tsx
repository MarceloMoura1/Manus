import React, { useState, useMemo } from "react";
import {
  Wrench,
  Plus,
  Search,
  Filter,
  Clock,
  DollarSign,
  Edit3,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Tag,
  FileText,
  Check,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pagination } from "@/components/erp/Pagination";
import { ErpPageHeader } from "@/components/erp/ErpPageHeader";
import { ErpEmptyState } from "@/components/erp/ErpEmptyState";
import { toast } from "sonner";

export function formatEstimatedMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours > 0 && remaining > 0) return `${hours}h ${remaining}min`;
  if (hours > 0) return `${hours}h`;
  return `${remaining}min`;
}

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatServicePrice(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "R$ 0,00";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "R$ 0,00";
  return moneyFormatter.format(num);
}

type ServiceFormState = {
  id?: number;
  name: string;
  code: string;
  category: string;
  price: string;
  estimatedCost: string;
  estimatedMinutes: string;
  description: string;
  isActive: boolean;
};

const initialFormState: ServiceFormState = {
  name: "",
  code: "",
  category: "",
  price: "",
  estimatedCost: "",
  estimatedMinutes: "",
  description: "",
  isActive: true,
};

export function ServicesPage() {
  const utils = trpc.useUtils();

  // Search & Filter state
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Dialog state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceFormState | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Query categories
  const categoriesQuery = trpc.erp.services.categories.useQuery();
  const availableCategories = categoriesQuery.data ?? [];

  // Query services
  const servicesQuery = trpc.erp.services.list.useQuery({
    query: query || undefined,
    category: selectedCategory || undefined,
    activeOnly: activeFilter === "active" ? true : activeFilter === "inactive" ? false : undefined,
    page,
    pageSize,
  });

  // Mutations
  const createMutation = trpc.erp.services.create.useMutation({
    onSuccess: () => {
      toast.success("Serviço cadastrado com sucesso!");
      setModalOpen(false);
      setEditingService(null);
      void utils.erp.services.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao cadastrar serviço.");
    },
  });

  const updateMutation = trpc.erp.services.update.useMutation({
    onSuccess: () => {
      toast.success("Serviço atualizado com sucesso!");
      setModalOpen(false);
      setEditingService(null);
      void utils.erp.services.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao atualizar serviço.");
    },
  });

  const toggleActiveMutation = trpc.erp.services.toggleActive.useMutation({
    onSuccess: (data) => {
      toast.success(data.isActive ? "Serviço ativado!" : "Serviço inativado!");
      void utils.erp.services.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao alterar status do serviço.");
    },
  });

  const deleteMutation = trpc.erp.services.delete.useMutation({
    onSuccess: () => {
      toast.success("Serviço excluído com sucesso!");
      setDeleteConfirmId(null);
      void utils.erp.services.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao excluir serviço.");
    },
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // Handlers
  const openCreateModal = () => {
    setEditingService({ ...initialFormState });
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (service: any) => {
    setEditingService({
      id: service.id,
      name: service.name,
      code: service.code ?? "",
      category: service.category ?? "",
      price: service.price,
      estimatedCost: service.estimatedCost === "0.00" ? "" : service.estimatedCost,
      estimatedMinutes: service.estimatedMinutes ? String(service.estimatedMinutes) : "",
      description: service.description ?? "",
      isActive: service.isActive,
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService) return;

    const errors: Record<string, string> = {};
    if (!editingService.name.trim()) {
      errors.name = "O nome do serviço é obrigatório.";
    }
    if (!editingService.price.trim()) {
      errors.price = "O preço padrão é obrigatório.";
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    if (editingService.id) {
      updateMutation.mutate({
        id: editingService.id,
        name: editingService.name.trim(),
        code: editingService.code.trim() || null,
        category: editingService.category.trim() || null,
        price: editingService.price,
        estimatedCost: editingService.estimatedCost.trim() || "0.00",
        estimatedMinutes: editingService.estimatedMinutes ? Number(editingService.estimatedMinutes) : null,
        description: editingService.description.trim() || null,
        isActive: editingService.isActive,
      });
    } else {
      createMutation.mutate({
        name: editingService.name.trim(),
        code: editingService.code.trim() || null,
        category: editingService.category.trim() || null,
        price: editingService.price,
        estimatedCost: editingService.estimatedCost.trim() || "0.00",
        estimatedMinutes: editingService.estimatedMinutes ? Number(editingService.estimatedMinutes) : null,
        description: editingService.description.trim() || null,
        isActive: editingService.isActive,
      });
    }
  };

  const services = servicesQuery.data?.items ?? [];
  const totalCount = servicesQuery.data?.total ?? 0;
  const activeCount = useMemo(() => services.filter((s) => s.isActive).length, [services]);

  return (
    <div className="space-y-6" data-testid="erp-services-page">
      {/* Header */}
      <ErpPageHeader
        eyebrow="MÓDULO ERP"
        title="Catálogo de Serviços"
        description="Gerenciamento de serviços, mão de obra e precificação operacional multi-nicho."
        actions={
          <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm">
            <Plus className="mr-2 h-4 w-4" />
            Novo Serviço
          </Button>
        }
      />

      {/* Filter and Metrics Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Search Bar */}
          <div className="relative flex-1 min-w-[280px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por nome, código ou descrição..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              className="pl-10 h-10 rounded-xl bg-slate-50/80 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Filters & Status */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Category Dropdown */}
            <div className="relative min-w-[160px]">
              <select
                aria-label="Filtrar por Categoria"
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setPage(1);
                }}
                className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/80 px-3 pr-8 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
              >
                <option value="">Todas as Categorias</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none text-slate-400" />
            </div>

            {/* Status Pills */}
            <div className="flex items-center rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("all");
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeFilter === "all"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("active");
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeFilter === "active"
                    ? "bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-400"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                Ativos
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("inactive");
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeFilter === "inactive"
                    ? "bg-white text-slate-700 shadow-sm dark:bg-slate-700 dark:text-slate-300"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                Inativos
              </button>
            </div>

            {/* Clear filters button */}
            {(query || selectedCategory || activeFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setSelectedCategory("");
                  setActiveFilter("all");
                  setPage(1);
                }}
                className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Limpar Filtros
              </Button>
            )}
          </div>
        </div>

        {/* Counter strip */}
        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          <span>
            Total cadastrado: <strong className="text-slate-800 dark:text-slate-200 font-semibold">{totalCount}</strong>
          </span>
          <span>•</span>
          <span>
            Nesta página: <strong className="text-slate-800 dark:text-slate-200 font-semibold">{services.length}</strong>
          </span>
        </div>
      </div>

      {/* Main Table / List */}
      {servicesQuery.isLoading ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-r-transparent" />
          <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-400">Carregando catálogo de serviços...</p>
        </div>
      ) : services.length === 0 ? (
        <ErpEmptyState
          title={query || selectedCategory || activeFilter !== "all" ? "Nenhum serviço encontrado para estes filtros" : "Nenhum serviço cadastrado"}
          description={
            query || selectedCategory || activeFilter !== "all"
              ? "Tente ajustar os termos de pesquisa ou remover os filtros aplicados."
              : "Cadastre os serviços oferecidos pela sua empresa para compor orçamentos, ordens de serviço e vendas."
          }
          action={{
            label: query || selectedCategory || activeFilter !== "all" ? "Limpar filtros" : "+ Cadastrar Primeiro Serviço",
            onClick: () => {
              if (query || selectedCategory || activeFilter !== "all") {
                setQuery("");
                setSelectedCategory("");
                setActiveFilter("all");
              } else {
                openCreateModal();
              }
            },
          }}
        />
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-800">
                <tr>
                  <th className="py-3.5 px-4 font-semibold text-slate-700 dark:text-slate-300">Serviço / Código</th>
                  <th className="py-3.5 px-4 font-semibold text-slate-700 dark:text-slate-300">Categoria</th>
                  <th className="py-3.5 px-4 font-semibold text-slate-700 dark:text-slate-300">Preço Padrão</th>
                  <th className="py-3.5 px-4 font-semibold text-slate-700 dark:text-slate-300">Tempo Estimado</th>
                  <th className="py-3.5 px-4 font-semibold text-slate-700 dark:text-slate-300">Status</th>
                  <th className="py-3.5 px-4 text-right font-semibold text-slate-700 dark:text-slate-300">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {services.map((service) => (
                  <tr key={service.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    {/* Serviço / Código */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                          <Wrench className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{service.name}</p>
                          {service.code && (
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                              SKU/Cód: {service.code}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Categoria */}
                    <td className="py-4 px-4">
                      {service.category ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          <Tag className="h-3 w-3" />
                          {service.category}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>

                    {/* Preço Padrão */}
                    <td className="py-4 px-4">
                      <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                        {formatServicePrice(service.price)}
                      </div>
                      {service.estimatedCost && service.estimatedCost !== "0.00" && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Custo: {formatServicePrice(service.estimatedCost)}
                        </div>
                      )}
                    </td>

                    {/* Tempo Estimado */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 text-xs">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {formatEstimatedMinutes(service.estimatedMinutes)}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          service.isActive
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {service.isActive ? (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Ativo
                          </>
                        ) : (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                            Inativo
                          </>
                        )}
                      </span>
                    </td>

                    {/* Ações */}
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(service)}
                          className="h-8 w-8 p-0 text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
                          title="Editar serviço"
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActiveMutation.mutate({ id: service.id })}
                          className={`h-8 px-2 text-xs font-semibold ${
                            service.isActive
                              ? "text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400"
                              : "text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400"
                          }`}
                          title={service.isActive ? "Inativar serviço" : "Ativar serviço"}
                        >
                          {service.isActive ? "Inativar" : "Ativar"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirmId(service.id)}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                          title="Excluir serviço"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards View */}
          <div className="grid gap-3 md:hidden">
            {services.map((service) => (
              <div
                key={service.id}
                className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                      <Wrench className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100 truncate">{service.name}</h4>
                      {service.code && (
                        <p className="font-mono text-xs text-slate-500">Cód: {service.code}</p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      service.isActive
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {service.isActive ? "Ativo" : "Inativo"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="text-slate-500 block">Preço Padrão:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                      {formatServicePrice(service.price)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Tempo Estimado:</span>
                    <span className="text-slate-700 dark:text-slate-300">
                      {formatEstimatedMinutes(service.estimatedMinutes)}
                    </span>
                  </div>
                  {service.category && (
                    <div className="col-span-2">
                      <span className="text-slate-500 block">Categoria:</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">{service.category}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditModal(service)}
                    className="h-8 text-xs"
                  >
                    <Edit3 className="mr-1 h-3.5 w-3.5" /> Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActiveMutation.mutate({ id: service.id })}
                    className="h-8 text-xs"
                  >
                    {service.isActive ? "Inativar" : "Ativar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteConfirmId(service.id)}
                    className="h-8 w-8 p-0 text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {servicesQuery.data && servicesQuery.data.totalPages > 1 && (
            <Pagination page={page} totalPages={servicesQuery.data.totalPages} onPage={setPage} />
          )}
        </>
      )}

      {/* Modal de Cadastro / Edição */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
              <Wrench className="h-5 w-5 text-blue-600" />
              {editingService?.id ? "Editar Serviço" : "Novo Serviço"}
            </DialogTitle>
          </DialogHeader>

          {editingService && (
            <form onSubmit={handleFormSubmit} className="space-y-4 pt-2">
              {/* Nome */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Nome do Serviço <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="Ex: Troca de Óleo, Alinhamento 3D, Formatação..."
                  value={editingService.name}
                  onChange={(e) => {
                    setEditingService({ ...editingService, name: e.target.value });
                    if (formErrors.name) setFormErrors({ ...formErrors, name: "" });
                  }}
                  className="rounded-xl"
                  required
                />
                {formErrors.name && <p className="mt-1 text-xs text-red-500">{formErrors.name}</p>}
              </div>

              {/* Código & Categoria */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                    Código / SKU Interno
                  </label>
                  <Input
                    type="text"
                    placeholder="Ex: SRV-01"
                    value={editingService.code}
                    onChange={(e) => setEditingService({ ...editingService, code: e.target.value })}
                    className="rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                    Categoria
                  </label>
                  <Input
                    type="text"
                    list="services-category-suggestions"
                    placeholder="Ex: Mecânica, Mão de Obra..."
                    value={editingService.category}
                    onChange={(e) => setEditingService({ ...editingService, category: e.target.value })}
                    className="rounded-xl"
                  />
                  <datalist id="services-category-suggestions">
                    {availableCategories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Preço & Custo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                    Preço Padrão (R$) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">R$</span>
                    <Input
                      type="text"
                      placeholder="0,00"
                      value={editingService.price}
                      onChange={(e) => {
                        setEditingService({ ...editingService, price: e.target.value });
                        if (formErrors.price) setFormErrors({ ...formErrors, price: "" });
                      }}
                      className="rounded-xl pl-9 font-mono"
                      required
                    />
                  </div>
                  {formErrors.price && <p className="mt-1 text-xs text-red-500">{formErrors.price}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                    Custo Estimado (R$)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">R$</span>
                    <Input
                      type="text"
                      placeholder="0,00"
                      value={editingService.estimatedCost}
                      onChange={(e) => setEditingService({ ...editingService, estimatedCost: e.target.value })}
                      className="rounded-xl pl-9 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Tempo Estimado em Minutos */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Tempo Estimado (em Minutos)
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    type="number"
                    min="0"
                    placeholder="Ex: 60 para 1 hora, 90 para 1h 30m..."
                    value={editingService.estimatedMinutes}
                    onChange={(e) => setEditingService({ ...editingService, estimatedMinutes: e.target.value })}
                    className="rounded-xl pl-9 font-mono"
                  />
                </div>
                {editingService.estimatedMinutes && Number(editingService.estimatedMinutes) > 0 && (
                  <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                    Equivalente: {formatEstimatedMinutes(Number(editingService.estimatedMinutes))}
                  </p>
                )}
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Descrição e Escopo
                </label>
                <textarea
                  rows={3}
                  placeholder="Detalhes sobre o que está incluso na execução deste serviço..."
                  value={editingService.description}
                  onChange={(e) => setEditingService({ ...editingService, description: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              {/* Status Ativo / Inativo */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="service-is-active"
                  checked={editingService.isActive}
                  onChange={(e) => setEditingService({ ...editingService, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="service-is-active" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  Serviço Ativo para Orçamentos e Vendas
                </label>
              </div>

              <DialogFooter className="pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalOpen(false)}
                  disabled={isSubmitting}
                  className="rounded-xl"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                >
                  {isSubmitting ? "Salvando..." : editingService.id ? "Atualizar Serviço" : "Cadastrar Serviço"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmação de Exclusão */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-red-600">
              <AlertCircle className="h-5 w-5" />
              Confirmar Exclusão
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Tem certeza de que deseja excluir este serviço do catálogo? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
              disabled={deleteMutation.isPending}
              className="rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteConfirmId) {
                  deleteMutation.mutate({ id: deleteConfirmId });
                }
              }}
              className="rounded-xl font-semibold"
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir Definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
