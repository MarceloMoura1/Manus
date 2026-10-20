import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { CrmWhatsAppIntent } from "../../../../shared/crm";
import {
  FileText,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Download,
  Share2,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  TrendingUp,
  DollarSign,
  Building2,
  Calendar,
  Trash2,
  Edit2,
  Eye,
  FileCheck,
  Send,
  Sparkles,
  Layers,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ProposalsPageProps {
  onNavigate?: (section: any) => void;
  onClientNavigate?: (intent: CrmWhatsAppIntent) => void;
  whatsappConnected?: boolean;
  canStartConversation?: boolean;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; badgeVariant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: {
    label: "Rascunho",
    color: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    badgeVariant: "secondary",
  },
  negotiation: {
    label: "Em Negociação",
    color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
    badgeVariant: "outline",
  },
  approved: {
    label: "Aprovada",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
    badgeVariant: "default",
  },
  converted: {
    label: "Convertida em Venda",
    color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800",
    badgeVariant: "default",
  },
  lost: {
    label: "Recusada / Perdida",
    color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800",
    badgeVariant: "destructive",
  },
  cancelled: {
    label: "Cancelada",
    color: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    badgeVariant: "secondary",
  },
};

type ItemInput = {
  productPublicId: string;
  productName: string;
  quantity: string;
  unitPriceCents: number;
  discountCents: number;
};

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ProposalsPage({
  onNavigate,
  onClientNavigate,
  whatsappConnected,
  canStartConversation,
}: ProposalsPageProps) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);

  // Modal States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [statusChangeModal, setStatusChangeModal] = useState<{
    open: boolean;
    proposalPublicId: string;
    toStatus: "draft" | "negotiation" | "approved" | "lost" | "cancelled";
    title: string;
  }>({
    open: false,
    proposalPublicId: "",
    toStatus: "negotiation",
    title: "",
  });
  const [statusReason, setStatusReason] = useState("");

  // Create Form State
  const [formCrmClientId, setFormCrmClientId] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formPaymentTerms, setFormPaymentTerms] = useState("À vista via Pix ou Boleto 15 dias");
  const [formExpectedDate, setFormExpectedDate] = useState(
    new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  );
  const [formOrderDiscount, setFormOrderDiscount] = useState("0");
  const [formFreight, setFormFreight] = useState("0");
  const [formItems, setFormItems] = useState<ItemInput[]>([]);

  // Catalog search inside modal
  const [catalogSearch, setCatalogSearch] = useState("");

  const utils = trpc.useUtils();

  // Queries
  const { data: listData, isLoading, refetch, isFetching } = trpc.crm.proposals.list.useQuery(
    {
      search: search.trim() || undefined,
      commercialStatus: filterStatus !== "all" ? (filterStatus as any) : undefined,
    },
    { refetchOnWindowFocus: false }
  );

  const { data: clientsData } = trpc.crm.list.useQuery(
    { lifecycle: "active" },
    { staleTime: 60_000 }
  );

  const { data: catalogData } = trpc.crm.proposals.catalog.useQuery(
    { search: catalogSearch.trim() },
    { enabled: isCreateOpen, staleTime: 30_000 }
  );

  const { data: selectedDetail, isLoading: isLoadingDetail } = trpc.crm.proposals.detail.useQuery(
    { publicId: selectedProposalId! },
    { enabled: !!selectedProposalId && isDetailOpen }
  );

  const proposals = useMemo(() => listData?.items || [], [listData]);
  const clients = useMemo(() => (clientsData?.clients || []) as any[], [clientsData]);
  const catalogProducts = useMemo(() => catalogData?.items || [], [catalogData]);

  // Mutations
  const createMutation = trpc.crm.proposals.create.useMutation({
    onSuccess: () => {
      toast.success("Proposta comercial criada com sucesso!");
      utils.crm.proposals.list.invalidate();
      closeCreateModal();
    },
    onError: err => {
      toast.error(err.message || "Erro ao criar proposta.");
    },
  });

  const statusMutation = trpc.crm.proposals.updateCommercialStatus.useMutation({
    onSuccess: () => {
      toast.success("Status da proposta comercial atualizado!");
      utils.crm.proposals.list.invalidate();
      if (selectedProposalId) utils.crm.proposals.detail.invalidate({ publicId: selectedProposalId });
      setStatusChangeModal(prev => ({ ...prev, open: false }));
      setStatusReason("");
    },
    onError: err => {
      toast.error(err.message || "Erro ao atualizar status.");
    },
  });

  const convertMutation = trpc.crm.proposals.convertQuoteToSale.useMutation({
    onSuccess: () => {
      toast.success("Proposta convertida com sucesso em Pedido de Venda!");
      utils.crm.proposals.list.invalidate();
      if (selectedProposalId) utils.crm.proposals.detail.invalidate({ publicId: selectedProposalId });
      setIsDetailOpen(false);
    },
    onError: err => {
      toast.error(err.message || "Erro ao converter proposta.");
    },
  });

  const generatePdfMutation = trpc.crm.proposals.generatePdf.useMutation({
    onSuccess: res => {
      toast.success("PDF da proposta gerado com sucesso!");
      utils.crm.proposals.list.invalidate();
      if (selectedProposalId) utils.crm.proposals.detail.invalidate({ publicId: selectedProposalId });
      if (res?.document?.downloadUrl) {
        window.open(res.document.downloadUrl, "_blank");
      }
    },
    onError: err => {
      toast.error(err.message || "Erro ao gerar PDF.");
    },
  });

  // Totals of Form
  const formCalculations = useMemo(() => {
    let subtotalCents = 0;
    for (const it of formItems) {
      const q = parseFloat(it.quantity) || 0;
      const lineGross = Math.round(q * it.unitPriceCents);
      const lineNet = Math.max(0, lineGross - it.discountCents);
      subtotalCents += lineNet;
    }

    const discountCents = Math.round((parseFloat(formOrderDiscount.replace(",", ".")) || 0) * 100);
    const freightCents = Math.round((parseFloat(formFreight.replace(",", ".")) || 0) * 100);
    const totalCents = Math.max(0, subtotalCents - discountCents + freightCents);

    return {
      subtotalCents,
      discountCents,
      freightCents,
      totalCents,
    };
  }, [formItems, formOrderDiscount, formFreight]);

  // Metrics
  const metrics = useMemo(() => {
    let totalCentsInNegotiation = 0;
    let countNegotiation = 0;
    let countApproved = 0;
    let countConverted = 0;
    let countLost = 0;

    for (const p of proposals) {
      const status = p.commercialStatus || "draft";
      if (status === "negotiation" || status === "draft") {
        countNegotiation++;
        totalCentsInNegotiation += p.totalCents || 0;
      } else if (status === "approved") {
        countApproved++;
      } else if (status === "converted") {
        countConverted++;
      } else if (status === "lost") {
        countLost++;
      }
    }

    const totalDecided = countApproved + countConverted + countLost;
    const winRate = totalDecided > 0 ? Math.round(((countApproved + countConverted) / totalDecided) * 100) : 0;

    return {
      total: proposals.length,
      negotiation: countNegotiation,
      totalInNegotiation: totalCentsInNegotiation,
      approved: countApproved,
      converted: countConverted,
      winRate,
    };
  }, [proposals]);

  const openCreateModal = () => {
    setFormCrmClientId("");
    setFormNotes("");
    setFormPaymentTerms("À vista via Pix ou Boleto 15 dias");
    setFormExpectedDate(new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString().slice(0, 10));
    setFormOrderDiscount("0");
    setFormFreight("0");
    setFormItems([]);
    setIsCreateOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
  };

  const handleAddItemFromCatalog = (product: any) => {
    const pId = product.productPublicId || product.publicId || product.inventoryItemPublicId;
    const existingIndex = formItems.findIndex(it => it.productPublicId === pId);
    if (existingIndex >= 0) {
      const updated = [...formItems];
      const curQ = parseFloat(updated[existingIndex].quantity) || 1;
      updated[existingIndex].quantity = String(curQ + 1);
      setFormItems(updated);
    } else {
      setFormItems(prev => [
        ...prev,
        {
          productPublicId: pId,
          productName: product.name,
          quantity: "1",
          unitPriceCents: product.salePriceCents ?? product.priceCents ?? 0,
          discountCents: 0,
        },
      ]);
    }
  };

  const handleRemoveItem = (index: number) => {
    setFormItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof ItemInput, value: any) => {
    setFormItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCrmClientId) {
      toast.error("Selecione um cliente para vincular à proposta.");
      return;
    }
    if (formItems.length === 0) {
      toast.error("Adicione pelo menos um item à proposta.");
      return;
    }

    createMutation.mutate({
      documentType: "quote",
      crmClientId: formCrmClientId,
      commercialDate: new Date().toISOString().slice(0, 10),
      expectedDate: formExpectedDate || undefined,
      paymentTerms: formPaymentTerms.trim() || undefined,
      notes: formNotes.trim() || undefined,
      orderDiscountCents: formCalculations.discountCents,
      freightCents: formCalculations.freightCents,
      chargesCents: 0,
      items: formItems.map(it => ({
        productPublicId: it.productPublicId,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        discountCents: it.discountCents,
      })),
    });
  };

  // WhatsApp Intent Share
  const handleShareWhatsApp = (proposal: any) => {
    if (!onClientNavigate) {
      toast.error("Módulo de WhatsApp não configurado.");
      return;
    }
    const client = clients.find(c => c.crmClientId === proposal.crmClientId);
    const phone = client?.whatsapp || client?.phone || "";

    onClientNavigate({
      crmClientId: proposal.crmClientId,
      phone,
      channel: "whatsapp",
    });
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Propostas Comerciais
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Elabore orçamentos com catálogo de produtos, gere PDFs, compartilhe via WhatsApp e converta em pedidos.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={openCreateModal} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4" />
            Nova Proposta
          </Button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total de Propostas</span>
          <span className="text-2xl font-bold text-slate-900 dark:text-white mt-1 block">{metrics.total}</span>
        </div>

        <div className="p-4 rounded-xl border bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800">
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Em Negociação</span>
          <span className="text-xl font-bold text-blue-700 dark:text-blue-300 mt-1 block">
            {formatMoney(metrics.totalInNegotiation)}
          </span>
          <span className="text-[11px] text-blue-600/80 mt-0.5 block">{metrics.negotiation} orçamentos</span>
        </div>

        <div className="p-4 rounded-xl border bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800">
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Aprovadas</span>
          <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1 block">
            {metrics.approved}
          </span>
          <span className="text-[11px] text-emerald-600/80 mt-0.5 block">Prontas para venda</span>
        </div>

        <div className="p-4 rounded-xl border bg-purple-50/50 border-purple-200 dark:bg-purple-950/20 dark:border-purple-800">
          <span className="text-xs font-medium text-purple-600 dark:text-purple-400">Convertidas em Venda</span>
          <span className="text-2xl font-bold text-purple-700 dark:text-purple-300 mt-1 block">
            {metrics.converted}
          </span>
          <span className="text-[11px] text-purple-600/80 mt-0.5 block">Faturamento fechado</span>
        </div>

        <div className="p-4 rounded-xl border bg-indigo-50/50 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-800">
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Taxa de Sucesso</span>
          <span className="text-2xl font-bold text-indigo-700 dark:text-indigo-300 mt-1 block">
            {metrics.winRate}%
          </span>
          <span className="text-[11px] text-indigo-600/80 mt-0.5 block">Aprovação / Decididas</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por número, cliente ou observações..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {["all", "draft", "negotiation", "approved", "converted", "lost"].map(statusKey => {
            const label =
              statusKey === "all"
                ? "Todas"
                : STATUS_CONFIG[statusKey]?.label || statusKey;
            const active = filterStatus === statusKey;
            return (
              <button
                key={statusKey}
                type="button"
                onClick={() => setFilterStatus(statusKey)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table of Proposals */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-sm text-slate-500">Carregando propostas comerciais...</p>
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center bg-white/50 dark:bg-slate-900/50">
          <FileText className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Nenhuma proposta comercial encontrada
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
            Gere orçamentos e envie propostas para seus clientes diretamente pelo CRM.
          </p>
          <Button onClick={openCreateModal} className="mt-4 gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> Criar Primeira Proposta
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">
                <tr>
                  <th scope="col" className="px-4 py-3.5">Número</th>
                  <th scope="col" className="px-4 py-3.5">Cliente / Lead</th>
                  <th scope="col" className="px-4 py-3.5">Status</th>
                  <th scope="col" className="px-4 py-3.5 text-right">Valor Total</th>
                  <th scope="col" className="px-4 py-3.5">Condição</th>
                  <th scope="col" className="px-4 py-3.5">Validade</th>
                  <th scope="col" className="px-4 py-3.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {proposals.map(p => {
                  const statusConf = STATUS_CONFIG[p.commercialStatus || "draft"] || STATUS_CONFIG.draft;
                  return (
                    <tr
                      key={p.publicId}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-4 py-3.5 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        #{p.orderNumber || p.publicId.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {p.customerName || "Cliente não informado"}
                        </div>
                        {p.sellerName && (
                          <div className="text-xs text-slate-400">Por {p.sellerName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusConf.color}`}
                        >
                          {statusConf.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatMoney(p.totalCents || 0)}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 dark:text-slate-400 max-w-[200px] truncate">
                        {p.paymentTerms || "Não especificado"}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {p.expectedDate
                          ? new Date(p.expectedDate).toLocaleDateString("pt-BR")
                          : "Indefinida"}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedProposalId(p.publicId);
                              setIsDetailOpen(true);
                            }}
                            className="h-8 px-2 text-xs gap-1 text-slate-600 hover:text-slate-900 dark:text-slate-300"
                            title="Ver Detalhes"
                          >
                            <Eye className="w-3.5 h-3.5" /> Detalhes
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            disabled={generatePdfMutation.isPending}
                            onClick={() =>
                              generatePdfMutation.mutate({ publicId: p.publicId })
                            }
                            className="h-8 px-2 text-xs gap-1 text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:border-indigo-800"
                            title="Gerar / Baixar PDF"
                          >
                            <Download className="w-3.5 h-3.5" /> PDF
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleShareWhatsApp(p)}
                            className="h-8 px-2 text-xs gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-800"
                            title="Enviar por WhatsApp"
                          >
                            <Share2 className="w-3.5 h-3.5" /> WhatsApp
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Nova Proposta */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleCreateSubmit}>
            <DialogHeader>
              <DialogTitle>Nova Proposta Comercial</DialogTitle>
              <DialogDescription>
                Selecione o cliente, adicione os produtos do catálogo e configure as condições de venda.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-4">
              {/* Client Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Cliente / Lead Comprador *
                  </label>
                  <select
                    required
                    value={formCrmClientId}
                    onChange={e => setFormCrmClientId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  >
                    <option value="">Selecione um cliente...</option>
                    {clients.map(c => (
                      <option key={c.crmClientId} value={c.crmClientId}>
                        {c.companyName} {c.status === "lead" ? "(Lead)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Validade da Proposta
                  </label>
                  <input
                    type="date"
                    value={formExpectedDate}
                    onChange={e => setFormExpectedDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                  />
                </div>
              </div>

              {/* Catalog Search & Add Items */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-900/50 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-indigo-600" /> Itens e Produtos da Proposta
                  </h4>
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar produto no catálogo..."
                      value={catalogSearch}
                      onChange={e => setCatalogSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                    />
                  </div>
                </div>

                {/* Catalog items dropdown / list */}
                {catalogSearch.trim() && catalogProducts.length > 0 && (
                  <div className="max-h-36 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 space-y-1 shadow-md">
                    {catalogProducts.map(p => (
                      <div
                        key={p.productPublicId || p.inventoryItemPublicId}
                        className="flex items-center justify-between p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-xs"
                      >
                        <span className="font-medium text-slate-900 dark:text-white truncate">
                          {p.name} {p.sku ? `(${p.sku})` : ""}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600 dark:text-slate-400">
                            {formatMoney(p.salePriceCents || 0)}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              handleAddItemFromCatalog(p);
                              setCatalogSearch("");
                            }}
                            className="h-6 px-2 text-[11px] bg-indigo-600 hover:bg-indigo-700 text-white"
                          >
                            + Adicionar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Items Table */}
                {formItems.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-400 border border-dashed rounded-lg bg-white dark:bg-slate-900">
                    Nenhum produto adicionado à proposta. Use a busca acima para incluir itens do catálogo.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase font-semibold">
                        <tr>
                          <th className="p-2">Item</th>
                          <th className="p-2 w-20">Qtd</th>
                          <th className="p-2 w-28">Preço Unit (R$)</th>
                          <th className="p-2 w-28">Desconto (R$)</th>
                          <th className="p-2 w-28 text-right">Total Linha</th>
                          <th className="p-2 w-10 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {formItems.map((item, idx) => {
                          const q = parseFloat(item.quantity) || 0;
                          const gross = Math.round(q * item.unitPriceCents);
                          const net = Math.max(0, gross - item.discountCents);
                          return (
                            <tr key={idx}>
                              <td className="p-2 font-medium text-slate-900 dark:text-white truncate max-w-[200px]">
                                {item.productName}
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="0.001"
                                  step="any"
                                  value={item.quantity}
                                  onChange={e => handleItemChange(idx, "quantity", e.target.value)}
                                  className="w-16 px-1.5 py-1 text-xs border rounded bg-white dark:bg-slate-900 dark:text-white"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={(item.unitPriceCents / 100).toFixed(2)}
                                  onChange={e =>
                                    handleItemChange(
                                      idx,
                                      "unitPriceCents",
                                      Math.round(parseFloat(e.target.value || "0") * 100)
                                    )
                                  }
                                  className="w-24 px-1.5 py-1 text-xs border rounded bg-white dark:bg-slate-900 dark:text-white"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={(item.discountCents / 100).toFixed(2)}
                                  onChange={e =>
                                    handleItemChange(
                                      idx,
                                      "discountCents",
                                      Math.round(parseFloat(e.target.value || "0") * 100)
                                    )
                                  }
                                  className="w-24 px-1.5 py-1 text-xs border rounded bg-white dark:bg-slate-900 dark:text-white"
                                />
                              </td>
                              <td className="p-2 text-right font-semibold text-slate-900 dark:text-white">
                                {formatMoney(net)}
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(idx)}
                                  className="text-slate-400 hover:text-rose-600 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Financial Totals & Conditions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Condições de Pagamento
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 50% de entrada + 50% na entrega, 30 dias..."
                      value={formPaymentTerms}
                      onChange={e => setFormPaymentTerms(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Observações / Escopo da Proposta
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Garantias, prazos de entrega, termos contratuais..."
                      value={formNotes}
                      onChange={e => setFormNotes(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>Subtotal dos Itens:</span>
                    <span className="font-medium text-slate-900 dark:text-white">
                      {formatMoney(formCalculations.subtotalCents)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <span>Desconto Geral (R$):</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formOrderDiscount}
                      onChange={e => setFormOrderDiscount(e.target.value)}
                      className="w-24 px-1.5 py-0.5 text-xs text-right border rounded bg-white dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <span>Frete (R$):</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formFreight}
                      onChange={e => setFormFreight(e.target.value)}
                      className="w-24 px-1.5 py-0.5 text-xs text-right border rounded bg-white dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between text-sm font-bold text-slate-900 dark:text-white">
                    <span>Total da Proposta:</span>
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {formatMoney(formCalculations.totalCents)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeCreateModal}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {createMutation.isPending && <RefreshCw className="w-4 h-4 animate-spin mr-2" />}
                Salvar Proposta Comercial
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Detalhes da Proposta */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {isLoadingDetail || !selectedDetail ? (
            <div className="py-12 text-center text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              Carregando dados da proposta...
            </div>
          ) : (
            <div>
              <DialogHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <DialogTitle className="text-xl">
                    Proposta Comercial #{selectedDetail.orderNumber}
                  </DialogTitle>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      STATUS_CONFIG[selectedDetail.commercialStatus || "draft"]?.color || ""
                    }`}
                  >
                    {STATUS_CONFIG[selectedDetail.commercialStatus || "draft"]?.label ||
                      selectedDetail.commercialStatus}
                  </span>
                </div>
                <DialogDescription>
                  Cliente: <strong>{selectedDetail.customerName}</strong> • Emissão:{" "}
                  {selectedDetail.commercialDate
                    ? new Date(selectedDetail.commercialDate).toLocaleDateString("pt-BR")
                    : "-"}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4 text-xs">
                {/* Items */}
                <div className="border rounded-xl p-3 bg-slate-50 dark:bg-slate-900/50">
                  <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">
                    Itens Inclusos
                  </h4>
                  <table className="w-full text-left">
                    <thead className="text-slate-400 border-b pb-1">
                      <tr>
                        <th className="py-1">Produto</th>
                        <th className="py-1">Qtd</th>
                        <th className="py-1 text-right">Preço Unit</th>
                        <th className="py-1 text-right">Desconto</th>
                        <th className="py-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {selectedDetail.items?.map((item: any, i: number) => (
                        <tr key={i}>
                          <td className="py-1.5 font-medium text-slate-900 dark:text-white">
                            {item.productName}
                          </td>
                          <td className="py-1.5">{item.quantity}</td>
                          <td className="py-1.5 text-right">{formatMoney(item.unitPriceCents)}</td>
                          <td className="py-1.5 text-right">{formatMoney(item.discountCents)}</td>
                          <td className="py-1.5 text-right font-bold text-slate-900 dark:text-white">
                            {formatMoney(item.lineTotalCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mt-3 pt-3 border-t flex justify-end gap-6 text-sm">
                    <span className="text-slate-500">Total Líquido:</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">
                      {formatMoney(selectedDetail.totalCents)}
                    </span>
                  </div>
                </div>

                {/* Terms and notes */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 border rounded-xl">
                    <span className="font-semibold block text-slate-600 dark:text-slate-400">
                      Condições de Pagamento
                    </span>
                    <p className="mt-1 text-slate-900 dark:text-white">
                      {selectedDetail.paymentTerms || "Não especificado"}
                    </p>
                  </div>
                  <div className="p-3 border rounded-xl">
                    <span className="font-semibold block text-slate-600 dark:text-slate-400">
                      Observações
                    </span>
                    <p className="mt-1 text-slate-900 dark:text-white">
                      {selectedDetail.notes || "Nenhuma observação informada."}
                    </p>
                  </div>
                </div>

                {/* Generated Documents (PDFs) */}
                {selectedDetail.documents && selectedDetail.documents.length > 0 && (
                  <div className="border rounded-xl p-3">
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">
                      Documentos Gerados
                    </h4>
                    <div className="space-y-1">
                      {selectedDetail.documents.map((doc: any) => (
                        <div
                          key={doc.publicId}
                          className="flex items-center justify-between p-2 rounded bg-slate-50 dark:bg-slate-800"
                        >
                          <span className="font-medium text-slate-900 dark:text-white">
                            {doc.fileName}
                          </span>
                          <a
                            href={doc.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold"
                          >
                            <Download className="w-3.5 h-3.5" /> Baixar PDF
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                {/* State transition triggers */}
                {selectedDetail.commercialStatus === "draft" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      statusMutation.mutate({
                        publicId: selectedDetail.publicId,
                        toStatus: "negotiation",
                      })
                    }
                  >
                    Iniciar Negociação
                  </Button>
                )}

                {selectedDetail.commercialStatus === "negotiation" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-rose-600 hover:bg-rose-50 border-rose-200"
                      onClick={() =>
                        statusMutation.mutate({
                          publicId: selectedDetail.publicId,
                          toStatus: "lost",
                          reason: "Cliente recusou proposta",
                        })
                      }
                    >
                      Marcar como Recusada
                    </Button>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() =>
                        statusMutation.mutate({
                          publicId: selectedDetail.publicId,
                          toStatus: "approved",
                        })
                      }
                    >
                      Aprovar Proposta
                    </Button>
                  </>
                )}

                {selectedDetail.commercialStatus === "approved" && (
                  <Button
                    size="sm"
                    className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
                    disabled={convertMutation.isPending}
                    onClick={() => convertMutation.mutate({ publicId: selectedDetail.publicId })}
                  >
                    {convertMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <FileCheck className="w-4 h-4" /> Converter em Venda
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generatePdfMutation.mutate({ publicId: selectedDetail.publicId })}
                  disabled={generatePdfMutation.isPending}
                  className="gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Gerar Novo PDF
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
