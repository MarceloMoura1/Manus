import React, { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { CrmWhatsAppIntent, CustomerType } from "../../../../shared/crm";
import {
  Users,
  Target,
  Search,
  Plus,
  Phone,
  Mail,
  Building2,
  Calendar,
  Filter,
  CheckCircle2,
  Clock,
  ArrowRight,
  UserCheck,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Edit3,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Globe,
  Instagram,
  Facebook,
  Smartphone,
  Share2,
  Tag,
  FileText,
  AlertCircle,
  X,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { LeadView, LeadOrigin, LeadContactItem } from "../../../../server/modules/crm/leads/contracts";

interface LeadsPageProps {
  onNavigate?: (section: any) => void;
  onClientNavigate?: (intent: CrmWhatsAppIntent) => void;
  whatsappConnected?: boolean;
  canStartConversation?: boolean;
}

const ORIGIN_CONFIG: Record<LeadOrigin, { label: string; icon: React.ReactNode; color: string }> = {
  whatsapp: {
    label: "WhatsApp",
    icon: <Smartphone className="w-3.5 h-3.5" />,
    color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
  },
  instagram: {
    label: "Instagram",
    icon: <Instagram className="w-3.5 h-3.5" />,
    color: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/40 dark:text-pink-400 dark:border-pink-800",
  },
  facebook: {
    label: "Facebook",
    icon: <Facebook className="w-3.5 h-3.5" />,
    color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
  },
  site: {
    label: "Site",
    icon: <Globe className="w-3.5 h-3.5" />,
    color: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800",
  },
  indicacao: {
    label: "Indicação",
    icon: <Share2 className="w-3.5 h-3.5" />,
    color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800",
  },
  outro: {
    label: "Outro",
    icon: <Tag className="w-3.5 h-3.5" />,
    color: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  },
};

export function LeadsPage({
  onNavigate,
  onClientNavigate,
  whatsappConnected,
  canStartConversation,
}: LeadsPageProps) {
  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [originFilter, setOriginFilter] = useState<LeadOrigin | "all">("all");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Estados dos modais
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isConvertOpen, setIsConvertOpen] = useState(false);

  const [selectedLead, setSelectedLead] = useState<LeadView | null>(null);
  const [timelineNote, setTimelineNote] = useState("");

  // Formulário de Criação / Edição
  const [formCompany, setFormCompany] = useState("");
  const [formCustomerType, setFormCustomerType] = useState<CustomerType>("company");
  const [formResponsible, setFormResponsible] = useState("");
  const [formCpfCnpj, setFormCpfCnpj] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formWhatsapp, setFormWhatsapp] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formOrigin, setFormOrigin] = useState<LeadOrigin>("outro");
  const [formInternalResponsible, setFormInternalResponsible] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formObservations, setFormObservations] = useState("");
  const [formContacts, setFormContacts] = useState<LeadContactItem[]>([]);

  // Formulário de Conversão
  const [convertDoc, setConvertDoc] = useState("");
  const [convertNotes, setConvertNotes] = useState("");

  // Query tRPC
  const utils = trpc.useUtils();
  const leadsQuery = trpc.crm.leads.list.useQuery({
    search: searchTerm || undefined,
    origin: originFilter !== "all" ? originFilter : undefined,
    internalResponsible: responsibleFilter || undefined,
    page,
    pageSize,
  });

  const timelineQuery = trpc.crm.leads.timeline.useQuery(
    { crmClientId: selectedLead?.crmClientId || "" },
    { enabled: Boolean(selectedLead && isDetailOpen) }
  );

  // Mutações tRPC
  const createMutation = trpc.crm.leads.create.useMutation({
    onSuccess: () => {
      toast.success("Lead cadastrado com sucesso!");
      setIsCreateOpen(false);
      resetForm();
      utils.crm.leads.list.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao cadastrar lead.");
    },
  });

  const updateMutation = trpc.crm.leads.update.useMutation({
    onSuccess: () => {
      toast.success("Lead atualizado com sucesso!");
      setIsEditOpen(false);
      utils.crm.leads.list.invalidate();
      if (selectedLead) {
        utils.crm.leads.getById.invalidate({ crmClientId: selectedLead.crmClientId });
      }
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao atualizar lead.");
    },
  });

  const convertMutation = trpc.crm.leads.convert.useMutation({
    onSuccess: (data) => {
      toast.success(`Lead convertido com sucesso em Cliente Ativo: ${data.companyName}`);
      setIsConvertOpen(false);
      setIsDetailOpen(false);
      utils.crm.leads.list.invalidate();
      utils.crm.list.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Falha na conversão do lead.");
    },
  });

  const addNoteMutation = trpc.crm.leads.addNote.useMutation({
    onSuccess: () => {
      toast.success("Nota adicionada ao histórico!");
      setTimelineNote("");
      if (selectedLead) {
        utils.crm.leads.timeline.invalidate({ crmClientId: selectedLead.crmClientId });
      }
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao adicionar nota.");
    },
  });

  const resetForm = () => {
    setFormCompany("");
    setFormCustomerType("company");
    setFormResponsible("");
    setFormCpfCnpj("");
    setFormPhone("");
    setFormWhatsapp("");
    setFormEmail("");
    setFormOrigin("outro");
    setFormInternalResponsible("");
    setFormTags("");
    setFormObservations("");
    setFormContacts([]);
  };

  const openCreateModal = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const openEditModal = (lead: LeadView) => {
    setSelectedLead(lead);
    setFormCompany(lead.companyName);
    setFormCustomerType((lead.customerType as CustomerType) || "company");
    setFormResponsible(lead.responsibleName);
    setFormCpfCnpj(lead.cpfCnpj || "");
    setFormPhone(lead.phone || "");
    setFormWhatsapp(lead.whatsapp || "");
    setFormEmail(lead.email || "");
    setFormOrigin(lead.origin);
    setFormInternalResponsible(lead.internalResponsible);
    setFormTags(lead.tags);
    setFormObservations(lead.observations);
    setFormContacts(lead.contacts || []);
    setIsEditOpen(true);
  };

  const openDetailModal = (lead: LeadView) => {
    setSelectedLead(lead);
    setIsDetailOpen(true);
  };

  const openConvertModal = (lead: LeadView) => {
    setSelectedLead(lead);
    setConvertDoc(lead.cpfCnpj || "");
    setConvertNotes("");
    setIsConvertOpen(true);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCompany.trim()) {
      toast.error("Nome ou Razão Social é obrigatório.");
      return;
    }
    createMutation.mutate({
      companyName: formCompany.trim(),
      customerType: formCustomerType,
      responsibleName: formResponsible.trim(),
      cpfCnpj: formCpfCnpj.trim(),
      phone: formPhone.trim(),
      whatsapp: formWhatsapp.trim(),
      email: formEmail.trim(),
      origin: formOrigin,
      internalResponsible: formInternalResponsible.trim(),
      tags: formTags.trim(),
      observations: formObservations.trim(),
      contacts: formContacts,
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || !formCompany.trim()) {
      toast.error("Nome ou Razão Social é obrigatório.");
      return;
    }
    updateMutation.mutate({
      crmClientId: selectedLead.crmClientId,
      companyName: formCompany.trim(),
      customerType: formCustomerType,
      responsibleName: formResponsible.trim(),
      cpfCnpj: formCpfCnpj.trim(),
      phone: formPhone.trim(),
      whatsapp: formWhatsapp.trim(),
      email: formEmail.trim(),
      origin: formOrigin,
      internalResponsible: formInternalResponsible.trim(),
      tags: formTags.trim(),
      observations: formObservations.trim(),
      contacts: formContacts,
    });
  };

  const handleConvertSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    convertMutation.mutate({
      crmClientId: selectedLead.crmClientId,
      cpfCnpj: convertDoc.trim() || undefined,
      notes: convertNotes.trim() || undefined,
    });
  };

  const handleAddContact = () => {
    setFormContacts([
      ...formContacts,
      { name: "", role: "", phone: "", whatsapp: "", email: "", description: "" },
    ]);
  };

  const handleRemoveContact = (index: number) => {
    setFormContacts(formContacts.filter((_, idx) => idx !== index));
  };

  const handleContactChange = (index: number, field: keyof LeadContactItem, value: string) => {
    const updated = [...formContacts];
    updated[index] = { ...updated[index], [field]: value };
    setFormContacts(updated);
  };

  const handleStartWhatsApp = (lead: LeadView) => {
    const phoneToUse = lead.whatsapp || lead.phone;
    if (!phoneToUse) {
      toast.error("Lead não possui telefone ou WhatsApp cadastrado.");
      return;
    }
    if (onClientNavigate) {
      onClientNavigate({
        channel: "whatsapp",
        phone: phoneToUse,
        crmClientId: lead.crmClientId,
      });
    } else {
      toast.info("WhatsApp disponível no menu lateral de Atendimento.");
    }
  };

  const leads = leadsQuery.data?.leads || [];
  const totalLeads = leadsQuery.data?.total || 0;
  const totalPages = leadsQuery.data?.totalPages || 1;

  return (
    <div className="space-y-6" data-testid="crm-leads-page">
      {/* Cabeçalho */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Leads & Prospecção B2B
            </h1>
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              {totalLeads} {totalLeads === 1 ? "lead ativo" : "leads ativos"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Qualificação comercial, múltiplos contatos por empresa e conversão direta para clientes ativos.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => leadsQuery.refetch()}
            className="border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${leadsQuery.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>

          <Button
            onClick={openCreateModal}
            className="bg-blue-600 text-white hover:bg-blue-700"
            size="sm"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Novo Lead
          </Button>
        </div>
      </header>

      {/* Barra de Filtros e Pesquisa */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Pesquisar por empresa, decisor, e-mail ou telefone..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={originFilter}
            onChange={(e) => {
              setOriginFilter(e.target.value as any);
              setPage(1);
            }}
            className="rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-xs font-medium text-slate-700 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
          >
            <option value="all">Todas as Origens</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="site">Site</option>
            <option value="indicacao">Indicação</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="outro">Outro</option>
          </select>

          <input
            type="text"
            placeholder="Filtrar por responsável..."
            value={responsibleFilter}
            onChange={(e) => {
              setResponsibleFilter(e.target.value);
              setPage(1);
            }}
            className="w-40 rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
          />
        </div>
      </div>

      {/* Conteúdo: Lista de Leads */}
      {leadsQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/40"
            />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <Users className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">
            Nenhum lead encontrado
          </h3>
          <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
            {searchTerm || originFilter !== "all" || responsibleFilter
              ? "Tente ajustar os filtros ou o termo de busca para localizar os contatos."
              : "Cadastre seu primeiro contato comercial ou importe contatos para iniciar a prospecção."}
          </p>
          <Button
            onClick={openCreateModal}
            size="sm"
            className="mt-5 bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Cadastrar Novo Lead
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3">
            {leads.map((lead) => {
              const originCfg = ORIGIN_CONFIG[lead.origin] || ORIGIN_CONFIG.outro;
              const hasContacts = lead.contacts && lead.contacts.length > 0;

              return (
                <div
                  key={lead.crmClientId}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-800"
                >
                  <div className="flex flex-1 items-start gap-3.5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                      <Building2 className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {lead.companyName}
                        </h4>

                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${originCfg.color}`}
                        >
                          {originCfg.icon}
                          {originCfg.label}
                        </span>

                        {hasContacts && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {lead.contacts.length} {lead.contacts.length === 1 ? "contato B2B" : "contatos B2B"}
                          </span>
                        )}

                        {lead.internalResponsible && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            Resp: <strong>{lead.internalResponsible}</strong>
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        {lead.responsibleName && (
                          <span className="flex items-center gap-1">
                            <span className="font-medium text-slate-700 dark:text-slate-300">Decisor:</span>
                            {lead.responsibleName}
                          </span>
                        )}

                        {(lead.phone || lead.whatsapp) && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-slate-400" />
                            {lead.whatsapp || lead.phone}
                          </span>
                        )}

                        {lead.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-slate-400" />
                            {lead.email}
                          </span>
                        )}

                        <span className="text-[11px] text-slate-400">
                          Criado em: {new Date(lead.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                      </div>

                      {lead.observations && (
                        <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 line-clamp-1 italic">
                          "{lead.observations}"
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Ações do Card */}
                  <div className="mt-4 flex shrink-0 items-center gap-2 sm:mt-0 sm:pl-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStartWhatsApp(lead)}
                      className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
                      title="Conversar no WhatsApp"
                    >
                      <Smartphone className="h-3.5 w-3.5 sm:mr-1.5" />
                      <span className="hidden sm:inline">WhatsApp</span>
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDetailModal(lead)}
                      className="border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <FileText className="h-3.5 w-3.5 sm:mr-1.5" />
                      <span className="hidden sm:inline">Histórico</span>
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditModal(lead)}
                      className="border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      size="sm"
                      onClick={() => openConvertModal(lead)}
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      title="Converter em Cliente Ativo"
                    >
                      <UserCheck className="h-3.5 w-3.5 sm:mr-1.5" />
                      <span className="hidden sm:inline">Converter</span>
                    </Button>

                    {onNavigate && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onNavigate("pipeline")}
                        className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400"
                        title="Abrir Funil de Vendas / Criar Oportunidade"
                      >
                        <Target className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline">Oportunidade</span>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Página {page} de {totalPages} ({totalLeads} no total)
              </span>

              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Cadastro / Edição de Lead */}
      <Dialog
        open={isCreateOpen || isEditOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setIsEditOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditOpen ? "Editar Lead" : "Cadastrar Novo Lead"}</DialogTitle>
            <DialogDescription>
              Preencha os dados do contato comercial e equipe decisora para qualificação B2B.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={isEditOpen ? handleEditSubmit : handleCreateSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nome ou Razão Social *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex.: MegaCorp Indústria ou João da Silva"
                  value={formCompany}
                  onChange={(e) => setFormCompany(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Tipo de Entidade
                </label>
                <select
                  value={formCustomerType}
                  onChange={(e) => setFormCustomerType(e.target.value as CustomerType)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                >
                  <option value="company">Pessoa Jurídica (Empresa B2B)</option>
                  <option value="person">Pessoa Física (Profissional / B2C)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Contato / Decisor
                </label>
                <input
                  type="text"
                  placeholder="Ex.: Carlos Mendes (Diretor)"
                  value={formResponsible}
                  onChange={(e) => setFormResponsible(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  WhatsApp Principal
                </label>
                <input
                  type="text"
                  placeholder="(11) 98765-4321"
                  value={formWhatsapp}
                  onChange={(e) => setFormWhatsapp(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  E-mail
                </label>
                <input
                  type="email"
                  placeholder="contato@empresa.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Origem do Lead
                </label>
                <select
                  value={formOrigin}
                  onChange={(e) => setFormOrigin(e.target.value as LeadOrigin)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="site">Site</option>
                  <option value="indicacao">Indicação</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="outro">Outro</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Responsável Interno
                </label>
                <input
                  type="text"
                  placeholder="Vendedor / Operador"
                  value={formInternalResponsible}
                  onChange={(e) => setFormInternalResponsible(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  CPF ou CNPJ (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="00.000.000/0001-00"
                  value={formCpfCnpj}
                  onChange={(e) => setFormCpfCnpj(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Observações de Qualificação
              </label>
              <textarea
                rows={2}
                placeholder="Principais dores, orçamento estimado, urgência ou contexto de prospecção..."
                value={formObservations}
                onChange={(e) => setFormObservations(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              />
            </div>

            {/* Seção B2B: Múltiplos Contatos */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="flex items-center justify-between">
                <div>
                  <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                    Equipe e Contatos Adicionais (B2B)
                  </h5>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Cadastre compradores, gerentes ou técnicos da mesma empresa.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddContact}
                  className="h-7 text-xs"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Adicionar Contato
                </Button>
              </div>

              {formContacts.length > 0 && (
                <div className="mt-3 space-y-2">
                  {formContacts.map((contact, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <input
                        type="text"
                        placeholder="Nome"
                        value={contact.name || ""}
                        onChange={(e) => handleContactChange(idx, "name", e.target.value)}
                        className="w-1/4 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                      />
                      <input
                        type="text"
                        placeholder="Cargo"
                        value={contact.role || ""}
                        onChange={(e) => handleContactChange(idx, "role", e.target.value)}
                        className="w-1/4 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                      />
                      <input
                        type="text"
                        placeholder="WhatsApp / Fone"
                        value={contact.whatsapp || contact.phone || ""}
                        onChange={(e) => handleContactChange(idx, "whatsapp", e.target.value)}
                        className="w-1/4 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                      />
                      <input
                        type="text"
                        placeholder="E-mail"
                        value={contact.email || ""}
                        onChange={(e) => handleContactChange(idx, "email", e.target.value)}
                        className="w-1/4 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveContact(idx)}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreateOpen(false);
                  setIsEditOpen(false);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Salvando..."
                  : isEditOpen
                  ? "Salvar Alterações"
                  : "Criar Lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Detalhes e Linha do Tempo */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          {selectedLead && (
            <div>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle>{selectedLead.companyName}</DialogTitle>
                  <div className="flex items-center gap-2">
                    {onNavigate && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setIsDetailOpen(false);
                          onNavigate("pipeline");
                        }}
                        className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400"
                      >
                        <Target className="mr-1.5 h-3.5 w-3.5" />
                        Criar Oportunidade
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        setIsDetailOpen(false);
                        openConvertModal(selectedLead);
                      }}
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                      Converter em Cliente
                    </Button>
                  </div>
                </div>
                <DialogDescription>
                  Histórico de interações, anotações comerciais e contatos vinculados.
                </DialogDescription>
              </DialogHeader>

              {/* Informações Resumidas */}
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                <div>
                  <span className="text-slate-500">Decisor:</span>{" "}
                  <strong>{selectedLead.responsibleName || "Não informado"}</strong>
                </div>
                <div>
                  <span className="text-slate-500">WhatsApp:</span>{" "}
                  <strong>{selectedLead.whatsapp || selectedLead.phone || "Não informado"}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Origem:</span>{" "}
                  <strong className="capitalize">{selectedLead.origin}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Responsável:</span>{" "}
                  <strong>{selectedLead.internalResponsible || "Sem atribuição"}</strong>
                </div>
              </div>

              {/* Contatos Adicionais B2B */}
              {selectedLead.contacts && selectedLead.contacts.length > 0 && (
                <div className="mt-4">
                  <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                    Contatos da Empresa ({selectedLead.contacts.length})
                  </h5>
                  <div className="mt-2 space-y-1.5">
                    {selectedLead.contacts.map((c, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div>
                          <strong>{c.name || "Sem nome"}</strong>
                          {c.role && <span className="text-slate-500"> ({c.role})</span>}
                        </div>
                        <div className="text-slate-600 dark:text-slate-300">
                          {c.whatsapp || c.phone || c.email}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Inserir Nota na Linha do Tempo */}
              <div className="mt-4">
                <h5 className="text-xs font-bold text-slate-900 dark:text-white">Adicionar Nota Comercial</h5>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    placeholder="Registrar ligação, retorno agendado ou feedback..."
                    value={timelineNote}
                    onChange={(e) => setTimelineNote(e.target.value)}
                    className="flex-1 rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-900 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                  <Button
                    size="sm"
                    disabled={!timelineNote.trim() || addNoteMutation.isPending}
                    onClick={() => {
                      if (!timelineNote.trim()) return;
                      addNoteMutation.mutate({
                        crmClientId: selectedLead.crmClientId,
                        note: timelineNote.trim(),
                      });
                    }}
                    className="bg-blue-600 text-white"
                  >
                    Salvar
                  </Button>
                </div>
              </div>

              {/* Timeline */}
              <div className="mt-4">
                <h5 className="text-xs font-bold text-slate-900 dark:text-white mb-2">Linha do Tempo</h5>
                {timelineQuery.isLoading ? (
                  <p className="text-xs text-slate-400">Carregando histórico...</p>
                ) : (timelineQuery.data?.entries || []).length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Nenhum evento registrado ainda.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {(timelineQuery.data?.entries || []).map((entry: any, idx: number) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-950/40"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>{entry.author || "Sistema"}</span>
                          <span>{new Date(entry.createdAt).toLocaleString("pt-BR")}</span>
                        </div>
                        <p className="mt-1 text-slate-800 dark:text-slate-200">{entry.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: Conversão de Lead em Cliente Ativo */}
      <Dialog open={isConvertOpen} onOpenChange={setIsConvertOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Converter Lead em Cliente Ativo</DialogTitle>
            <DialogDescription>
              Esta ação promove o Lead a Cliente com status <strong>Ativo</strong>, mantendo histórico, arquivos e conversas associadas.
            </DialogDescription>
          </DialogHeader>

          {selectedLead && (
            <form onSubmit={handleConvertSubmit} className="space-y-3 pt-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                <p>
                  <strong>Empresa:</strong> {selectedLead.companyName}
                </p>
                {selectedLead.responsibleName && (
                  <p className="mt-0.5">
                    <strong>Contato:</strong> {selectedLead.responsibleName}
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  CPF ou CNPJ para Faturamento (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="00.000.000/0001-00"
                  value={convertDoc}
                  onChange={(e) => setConvertDoc(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nota de Fechamento / Conversão
                </label>
                <input
                  type="text"
                  placeholder="Ex.: Proposta aprovada em reunião comercial..."
                  value={convertNotes}
                  onChange={(e) => setConvertNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsConvertOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={convertMutation.isPending}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {convertMutation.isPending ? "Convertendo..." : "Confirmar Conversão"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
