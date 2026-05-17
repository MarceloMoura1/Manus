import React, { useState, useMemo, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Building2,
  Phone,
  Mail,
  MapPin,
  Search,
  Plus,
  User,
  Tag,
  FileText,
  MessageCircle,
  Ticket,
  DollarSign,
  Package,
  Paperclip,
  Clock,
  Edit3,
  Trash2,
  X,
  ChevronRight,
  Briefcase,
  Hash,
  Globe,
  Instagram,
  Facebook,
  Smartphone,
  CheckCircle,
  XCircle,
  AlertCircle,
  MinusCircle,
  TrendingDown,
  UploadCloud,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  PlusCircle,
} from "lucide-react";

function cn(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

// ─── Tipos ────────────────────────────────────────────────────────────────────
type CrmClient = {
  crmClientId: string;
  clientId: string;
  companyName: string;
  responsibleName: string;
  cpfCnpj: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  state: string;
  cep: string;
  status: "lead" | "ativo" | "inativo" | "cancelado" | "inadimplente";
  origin: "whatsapp" | "instagram" | "facebook" | "site" | "indicacao" | "outro";
  internalResponsible: string;
  tags: string;
  observations: string;
  lastInteractionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ClientTab = "geral" | "chamados" | "conversas" | "timeline" | "financeiro" | "rastreamento" | "arquivos";

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  lead:        { label: "Lead",        color: "bg-blue-100 text-blue-700 border-blue-200",    icon: <TrendingDown className="w-3 h-3" /> },
  ativo:       { label: "Ativo",       color: "bg-green-100 text-green-700 border-green-200", icon: <CheckCircle className="w-3 h-3" /> },
  inativo:     { label: "Inativo",     color: "bg-slate-100 text-slate-600 border-slate-200", icon: <MinusCircle className="w-3 h-3" /> },
  cancelado:   { label: "Cancelado",   color: "bg-red-100 text-red-700 border-red-200",       icon: <XCircle className="w-3 h-3" /> },
  inadimplente:{ label: "Inadimplente",color: "bg-orange-100 text-orange-700 border-orange-200", icon: <AlertCircle className="w-3 h-3" /> },
};

const ORIGIN_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  whatsapp:  { label: "WhatsApp",  icon: <Smartphone className="w-3.5 h-3.5" /> },
  instagram: { label: "Instagram", icon: <Instagram className="w-3.5 h-3.5" /> },
  facebook:  { label: "Facebook",  icon: <Facebook className="w-3.5 h-3.5" /> },
  site:      { label: "Site",      icon: <Globe className="w-3.5 h-3.5" /> },
  indicacao: { label: "Indicação", icon: <User className="w-3.5 h-3.5" /> },
  outro:     { label: "Outro",     icon: <Hash className="w-3.5 h-3.5" /> },
};

// ─── Componente de Badge de Status ────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-slate-100 text-slate-600 border-slate-200", icon: null };
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border", cfg.color)}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ─── Formulário de Cadastro ────────────────────────────────────────────────────
type FormData = {
  companyName: string;
  responsibleName: string;
  cpfCnpj: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  state: string;
  cep: string;
  status: "lead" | "ativo" | "inativo" | "cancelado" | "inadimplente";
  origin: "whatsapp" | "instagram" | "facebook" | "site" | "indicacao" | "outro";
  internalResponsible: string;
  tags: string;
  observations: string;
};

const EMPTY_FORM: FormData = {
  companyName: "", responsibleName: "", cpfCnpj: "", phone: "", whatsapp: "",
  email: "", address: "", city: "", state: "", cep: "",
  status: "lead", origin: "outro", internalResponsible: "", tags: "", observations: "",
};

function ClientFormModal({
  clientId,
  onClose,
  onSaved,
  editData,
}: {
  clientId: string;
  onClose: () => void;
  onSaved: () => void;
  editData?: CrmClient | null;
}) {
  const [form, setForm] = useState<FormData>(editData ? {
    companyName: editData.companyName,
    responsibleName: editData.responsibleName,
    cpfCnpj: editData.cpfCnpj,
    phone: editData.phone,
    whatsapp: editData.whatsapp,
    email: editData.email,
    address: editData.address,
    city: editData.city,
    state: editData.state,
    cep: editData.cep,
    status: editData.status,
    origin: editData.origin,
    internalResponsible: editData.internalResponsible,
    tags: editData.tags,
    observations: editData.observations,
  } : EMPTY_FORM);

  const createMutation = trpc.crm.create.useMutation({
    onSuccess() { toast.success("Cliente cadastrado com sucesso!"); onSaved(); onClose(); },
    onError(err) { toast.error(err.message); },
  });

  const sessionUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("megadesk_session_v1") ?? "{}"); } catch { return {}; }
  }, []);

  const updateMutation = trpc.crm.update.useMutation({
    onSuccess() { toast.success("Cliente atualizado com sucesso!"); onSaved(); onClose(); },
    onError(err) { toast.error(err.message); },
  });

  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.companyName.trim()) { toast.error("Nome da empresa é obrigatório."); return; }
    if (editData) {
      updateMutation.mutate({ clientId, crmClientId: editData.crmClientId, data: form, editedBy: sessionUser.userName ?? sessionUser.email ?? "Usuário" });
    } else {
      createMutation.mutate({ clientId, data: form });
    }
  }

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {editData ? "Editar Cliente" : "Cadastrar Novo Cliente"}
              </h2>
              <p className="text-sm text-slate-500">Preencha os dados do cliente</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Dados Básicos */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" /> Dados Básicos
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Empresa *</label>
                <input type="text" value={form.companyName} onChange={e => setField("companyName", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="Ex: Empresa XYZ Ltda" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Responsável</label>
                <input type="text" value={form.responsibleName} onChange={e => setField("responsibleName", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="João Silva" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">CPF / CNPJ</label>
                <input type="text" value={form.cpfCnpj} onChange={e => setField("cpfCnpj", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="00.000.000/0001-00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
                <input type="text" value={form.phone} onChange={e => setField("phone", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="(11) 9999-9999" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp</label>
                <input type="text" value={form.whatsapp} onChange={e => setField("whatsapp", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="(11) 9999-9999" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                <input type="email" value={form.email} onChange={e => setField("email", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="contato@empresa.com.br" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Endereço</label>
                <input type="text" value={form.address} onChange={e => setField("address", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="Rua, número, bairro" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cidade</label>
                <input type="text" value={form.city} onChange={e => setField("city", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="São Paulo" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Estado</label>
                  <input type="text" value={form.state} onChange={e => setField("state", e.target.value.toUpperCase().slice(0, 2))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    placeholder="SP" maxLength={2} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">CEP</label>
                  <input type="text" value={form.cep} onChange={e => setField("cep", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    placeholder="00000-000" />
                </div>
              </div>
            </div>
          </section>

          {/* Informações Comerciais */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-slate-400" /> Informações Comerciais
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select value={form.status} onChange={e => setField("status", e.target.value as FormData["status"])}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white">
                  <option value="lead">Lead</option>
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                  <option value="cancelado">Cancelado</option>
                  <option value="inadimplente">Inadimplente</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Origem</label>
                <select value={form.origin} onChange={e => setField("origin", e.target.value as FormData["origin"])}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="site">Site</option>
                  <option value="indicacao">Indicação</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Responsável Interno</label>
                <input type="text" value={form.internalResponsible} onChange={e => setField("internalResponsible", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="Nome do atendente responsável" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
                <input type="text" value={form.tags} onChange={e => setField("tags", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="vip, prioritário, parceiro (separados por vírgula)" />
              </div>
            </div>
          </section>

          {/* Observações */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" /> Observações Internas
            </h3>
            <textarea
              value={form.observations}
              onChange={e => setField("observations", e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
              placeholder="Ex: Cliente prefere contato após 18h. Solicitar aprovação antes da produção..."
            />
          </section>

          {/* Botões */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors font-medium text-sm">
              Cancelar
            </button>
            <button type="submit" disabled={isLoading}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-60 flex items-center justify-center gap-2">
              {isLoading ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Salvando...</>
              ) : (
                <>{editData ? <><Edit3 className="w-4 h-4" /> Salvar Alterações</> : <><Plus className="w-4 h-4" /> Cadastrar Cliente</>}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Painel de Detalhes do Cliente ─────────────────────────────────────────────
function ClientDetailPanel({
  client,
  clientId,
  onEdit,
  onDelete,
  onClose,
}: {
  client: CrmClient;
  clientId: string;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ClientTab>("geral");
  const [newTimelineNote, setNewTimelineNote] = useState("");

  const tabs: { id: ClientTab; label: string; icon: React.ReactNode }[] = [
    { id: "geral",        label: "Geral",        icon: <User className="w-4 h-4" /> },
    { id: "chamados",     label: "Chamados",     icon: <Ticket className="w-4 h-4" /> },
    { id: "conversas",    label: "Conversas",    icon: <MessageCircle className="w-4 h-4" /> },
    { id: "timeline",    label: "Timeline",     icon: <Clock className="w-4 h-4" /> },
    { id: "financeiro",   label: "Financeiro",   icon: <DollarSign className="w-4 h-4" /> },
    { id: "rastreamento", label: "Rastreamento", icon: <Package className="w-4 h-4" /> },
    { id: "arquivos",     label: "Arquivos",     icon: <Paperclip className="w-4 h-4" /> },
  ];

  // Queries das abas
  const chamadosQuery = trpc.crm.getChamados.useQuery(
    { clientId, crmClientId: client.crmClientId },
    { enabled: activeTab === "chamados", refetchOnWindowFocus: false }
  );
  const conversasQuery = trpc.crm.getConversas.useQuery(
    { clientId, crmClientId: client.crmClientId },
    { enabled: activeTab === "conversas", refetchOnWindowFocus: false }
  );
  const timelineQuery = trpc.crm.getTimeline.useQuery(
    { clientId, crmClientId: client.crmClientId },
    { enabled: activeTab === "timeline", refetchOnWindowFocus: false }
  );
  const addTimelineMutation = trpc.crm.addTimelineEntry.useMutation({
    onSuccess() { timelineQuery.refetch(); setNewTimelineNote(""); toast.success("Nota adicionada!"); },
    onError(err) { toast.error(err.message); },
  });

  const tags = client.tags ? client.tags.split(",").map(t => t.trim()).filter(Boolean) : [];

  return (
    <div className="flex flex-col h-full">
      {/* Header do painel */}
      <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 leading-tight">{client.companyName}</h2>
              {client.responsibleName && (
                <p className="text-sm text-slate-500 flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> {client.responsibleName}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Editar">
              <Edit3 className="w-4 h-4 text-slate-500" />
            </button>
            <button onClick={onDelete} className="p-2 hover:bg-red-50 rounded-lg transition-colors" title="Excluir">
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Fechar">
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={client.status} />
          {client.origin && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
              {ORIGIN_CONFIG[client.origin]?.icon}
              {ORIGIN_CONFIG[client.origin]?.label ?? client.origin}
            </span>
          )}
          {tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
              <Tag className="w-3 h-3" /> {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 px-4 pt-3 border-b border-slate-200 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors whitespace-nowrap border-b-2",
              activeTab === tab.id
                ? "text-blue-600 border-blue-500 bg-blue-50"
                : "text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conteúdo das abas */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === "geral" && (
          <div className="space-y-5">
            {/* Informações de contato */}
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contato</h4>
              <div className="space-y-2">
                {client.phone && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span>{client.phone}</span>
                  </div>
                )}
                {client.whatsapp && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <Smartphone className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span>{client.whatsapp}</span>
                    <span className="text-xs text-green-600 font-medium">WhatsApp</span>
                  </div>
                )}
                {client.email && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span>{client.email}</span>
                  </div>
                )}
                {client.cpfCnpj && (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <Hash className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span>{client.cpfCnpj}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Endereço */}
            {(client.address || client.city) && (
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Endereço</h4>
                <div className="flex items-start gap-2 text-sm text-slate-700">
                  <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span>
                    {[client.address, client.city, client.state, client.cep].filter(Boolean).join(", ")}
                  </span>
                </div>
              </div>
            )}

            {/* Responsável interno */}
            {client.internalResponsible && (
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Responsável Interno</h4>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <User className="w-4 h-4 text-slate-400" />
                  <span>{client.internalResponsible}</span>
                </div>
              </div>
            )}

            {/* Observações */}
            {client.observations && (
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Observações Internas</h4>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-sm text-amber-800 whitespace-pre-wrap">{client.observations}</p>
                </div>
              </div>
            )}

            {/* Datas */}
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Histórico</h4>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Cadastrado em {new Date(client.createdAt).toLocaleDateString("pt-BR")}</span>
                </div>
                {client.lastInteractionAt && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Última interação em {new Date(client.lastInteractionAt).toLocaleDateString("pt-BR")}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "chamados" && (
          <div className="space-y-3">
            {chamadosQuery.isLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
              </div>
            ) : (chamadosQuery.data?.chamados ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <Ticket className="w-12 h-12 text-slate-200 mb-3" />
                <p className="text-slate-500 font-medium text-sm">Nenhum chamado vinculado</p>
                <p className="text-slate-400 text-xs mt-1">Chamados com o nome ou empresa deste cliente aparecerão aqui.</p>
              </div>
            ) : (
              (chamadosQuery.data?.chamados ?? []).map(c => (
                <div key={c.id} className="border border-slate-200 rounded-xl p-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">#{c.number} — {c.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{c.customerName} · {c.company}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-xs font-medium",
                        c.status === "open" ? "bg-blue-100 text-blue-700" :
                        c.status === "in_progress" ? "bg-yellow-100 text-yellow-700" :
                        c.status === "waiting" ? "bg-orange-100 text-orange-700" :
                        "bg-slate-100 text-slate-600"
                      )}>
                        {c.status === "open" ? "Aberto" : c.status === "in_progress" ? "Em andamento" : c.status === "waiting" ? "Aguardando" : "Fechado"}
                      </span>
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-xs font-medium",
                        c.priority === "critica" ? "bg-red-100 text-red-700" :
                        c.priority === "alta" ? "bg-orange-100 text-orange-700" :
                        c.priority === "media" ? "bg-yellow-100 text-yellow-700" :
                        "bg-slate-100 text-slate-600"
                      )}>
                        {c.priority}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{new Date(c.createdAt).toLocaleDateString("pt-BR")}</p>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "conversas" && (
          <div className="space-y-3">
            {conversasQuery.isLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
              </div>
            ) : (conversasQuery.data?.conversas ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <MessageCircle className="w-12 h-12 text-slate-200 mb-3" />
                <p className="text-slate-500 font-medium text-sm">Nenhuma conversa vinculada</p>
                <p className="text-slate-400 text-xs mt-1">Conversas com o telefone ou empresa deste cliente aparecerão aqui.</p>
              </div>
            ) : (
              (conversasQuery.data?.conversas ?? []).map(c => (
                <div key={c.id} className="border border-slate-200 rounded-xl p-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">{c.customerName}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{c.phone} · {c.company}</p>
                      {c.lastMessage && <p className="text-xs text-slate-400 mt-1 truncate">{c.lastMessage}</p>}
                    </div>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0",
                      c.status === "open" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                    )}>
                      {c.status === "open" ? "Aberta" : "Fechada"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{c.timeLabel ?? new Date(c.createdAt).toLocaleDateString("pt-BR")}</p>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "timeline" && (
          <div className="space-y-4">
            {/* Adicionar nota */}
            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
              <p className="text-xs font-semibold text-slate-500 mb-2">Adicionar nota ou registro</p>
              <textarea
                value={newTimelineNote}
                onChange={e => setNewTimelineNote(e.target.value)}
                placeholder="Descreva uma interação, ligação, reunião..."
                className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
              />
              <button
                onClick={() => {
                  if (!newTimelineNote.trim()) return;
                  const session = JSON.parse(localStorage.getItem("megadesk_session_v1") ?? "{}");
                  addTimelineMutation.mutate({
                    clientId,
                    crmClientId: client.crmClientId,
                    description: newTimelineNote.trim(),
                    author: session.userName ?? "Usuário",
                    type: "note",
                  });
                }}
                disabled={addTimelineMutation.isPending || !newTimelineNote.trim()}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium disabled:opacity-60"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                {addTimelineMutation.isPending ? "Salvando..." : "Adicionar"}
              </button>
            </div>

            {/* Entradas da timeline */}
            {timelineQuery.isLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
              </div>
            ) : (timelineQuery.data?.entries ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <Clock className="w-10 h-10 text-slate-200 mb-2" />
                <p className="text-slate-400 text-sm">Nenhum registro ainda</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(timelineQuery.data?.entries ?? []).map((entry: any) => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
                        entry.type === "edit" ? "bg-blue-100" :
                        entry.type === "note" ? "bg-amber-100" :
                        entry.type === "status_change" ? "bg-green-100" : "bg-slate-100"
                      )}>
                        {entry.type === "edit" ? <Edit3 className="w-3.5 h-3.5 text-blue-600" /> :
                         entry.type === "note" ? <MessageSquare className="w-3.5 h-3.5 text-amber-600" /> :
                         entry.type === "status_change" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> :
                         <Clock className="w-3.5 h-3.5 text-slate-500" />}
                      </div>
                      <div className="w-px flex-1 bg-slate-200 mt-1" />
                    </div>
                    <div className="flex-1 pb-3">
                      <p className="text-sm text-slate-800">{entry.description}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {entry.author} · {new Date(entry.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "financeiro" && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <DollarSign className="w-12 h-12 text-slate-200 mb-3" />
            <p className="text-slate-500 font-medium text-sm">Histórico Financeiro</p>
            <p className="text-slate-400 text-xs mt-1">Disponível quando o ERP estiver integrado.</p>
          </div>
        )}

        {activeTab === "rastreamento" && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Package className="w-12 h-12 text-slate-200 mb-3" />
            <p className="text-slate-500 font-medium text-sm">Rastreamento de Pedidos</p>
            <p className="text-slate-400 text-xs mt-1">Os pedidos e rastreamentos deste cliente aparecerão aqui.</p>
          </div>
        )}

        {activeTab === "arquivos" && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Paperclip className="w-12 h-12 text-slate-200 mb-3" />
            <p className="text-slate-500 font-medium text-sm">Arquivos e Documentos</p>
            <p className="text-slate-400 text-xs mt-1">Contratos, PDFs, comprovantes e imagens aparecerão aqui.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Página Principal ──────────────────────────────────────────────────────────
export function ClientesPage() {
  const session = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("megadesk_session_v1") ?? "{}");
    } catch { return {}; }
  }, []);
  const clientId: string = session.clientId ?? "";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState<CrmClient | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<{ imported: number; errors: number; errorMessages: string[] } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const importCsvMutation = trpc.crm.importCsv.useMutation({
    onSuccess(result) {
      setCsvResult(result);
      setCsvImporting(false);
      refetch();
      toast.success(`Importação concluída: ${result.imported} clientes importados${result.errors > 0 ? `, ${result.errors} erros` : "."}`);
    },
    onError(err) { setCsvImporting(false); toast.error(err.message); },
  });

  const handleCsvFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvImporting(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast.error("CSV vazio ou sem dados."); setCsvImporting(false); return; }
      const headers = lines[0].split(";").map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(line => {
        const cols = line.split(";");
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = (cols[i] ?? "").trim(); });
        return obj;
      }).filter(r => r["empresa"] || r["companyname"] || r["nome_empresa"]);
      if (rows.length === 0) { toast.error("Nenhum dado válido encontrado. Verifique o CSV."); setCsvImporting(false); return; }
      const mapped = rows.map(r => ({
        companyName: r["empresa"] || r["companyname"] || r["nome_empresa"] || "",
        responsibleName: r["responsavel"] || r["responsiblename"] || r["contato"] || "",
        cpfCnpj: r["cnpj"] || r["cpf"] || r["cpfcnpj"] || "",
        phone: r["telefone"] || r["phone"] || "",
        whatsapp: r["whatsapp"] || "",
        email: r["email"] || "",
        address: r["endereco"] || r["address"] || "",
        city: r["cidade"] || r["city"] || "",
        state: (r["estado"] || r["state"] || "").slice(0, 2),
        cep: r["cep"] || "",
        status: r["status"] || "lead",
        origin: r["origem"] || r["origin"] || "outro",
        observations: r["observacoes"] || r["observations"] || "",
      }));
      importCsvMutation.mutate({ clientId, rows: mapped });
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }, [clientId, importCsvMutation]);

  const { data, isLoading, refetch } = trpc.crm.list.useQuery(
    { clientId, search: search.trim() || undefined },
    { enabled: !!clientId, refetchOnWindowFocus: false }
  );

  const deleteMutation = trpc.crm.delete.useMutation({
    onSuccess() { toast.success("Cliente excluído."); refetch(); setDeleteConfirm(null); setSelectedClientId(null); },
    onError(err) { toast.error(err.message); },
  });

  const clients: CrmClient[] = (data?.clients ?? []) as CrmClient[];

  const filteredClients = useMemo(() => {
    if (statusFilter === "todos") return clients;
    return clients.filter(c => c.status === statusFilter);
  }, [clients, statusFilter]);

  const selectedClient = filteredClients.find(c => c.crmClientId === selectedClientId) ?? null;

  if (!clientId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-500">Sessão inválida. Faça login novamente.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* ─── Lista de Clientes (esquerda) ─── */}
      <div className={cn(
        "flex flex-col border-r border-slate-200 bg-white transition-all duration-200",
        selectedClient ? "w-80 flex-shrink-0" : "flex-1"
      )}>
        {/* Header da lista */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-slate-900">Clientes</h2>
            <div className="flex items-center gap-1.5">
              {/* Botão de importar CSV */}
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleCsvFile}
              />
              <button
                onClick={() => csvInputRef.current?.click()}
                disabled={csvImporting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium disabled:opacity-60"
                title="Importar clientes via CSV"
              >
                {csvImporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {csvImporting ? "Importando..." : "CSV"}
              </button>
              <button
                onClick={() => { setEditClient(null); setShowModal(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Novo
              </button>
            </div>
          </div>

          {/* Busca */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone, CNPJ..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          {/* Filtros de status */}
          <div className="flex gap-1 overflow-x-auto pb-1">
            {["todos", "lead", "ativo", "inativo", "cancelado", "inadimplente"].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                  statusFilter === s
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {s === "todos" ? "Todos" : STATUS_CONFIG[s]?.label ?? s}
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center p-4">
              <Building2 className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-slate-500 font-medium text-sm">
                {search ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
              </p>
              <p className="text-slate-400 text-xs mt-1">
                {search ? "Tente outro termo de busca" : "Clique em \"Novo Cliente\" para começar"}
              </p>
            </div>
          ) : (
            filteredClients.map(client => (
              <button
                key={client.crmClientId}
                onClick={() => setSelectedClientId(client.crmClientId)}
                className={cn(
                  "w-full text-left p-4 border-b border-slate-100 transition-all duration-150",
                  selectedClientId === client.crmClientId
                    ? "bg-blue-50 border-l-4 border-l-blue-500"
                    : "hover:bg-slate-50 border-l-4 border-l-transparent"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm truncate">{client.companyName}</p>
                    {client.responsibleName && (
                      <p className="text-xs text-slate-500 truncate mt-0.5">{client.responsibleName}</p>
                    )}
                    {client.phone && (
                      <p className="text-xs text-slate-400 truncate mt-0.5">{client.phone}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <StatusBadge status={client.status} />
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Contador */}
        {filteredClients.length > 0 && (
          <div className="p-3 border-t border-slate-100 bg-slate-50">
            <p className="text-xs text-slate-400 text-center">
              {filteredClients.length} cliente{filteredClients.length !== 1 ? "s" : ""}
              {statusFilter !== "todos" ? ` com status "${STATUS_CONFIG[statusFilter]?.label}"` : ""}
            </p>
          </div>
        )}
      </div>

      {/* ─── Painel de Detalhes (direita) ─── */}
      {selectedClient ? (
        <div className="flex-1 bg-white overflow-hidden">
          <ClientDetailPanel
            client={selectedClient}
            clientId={clientId}
            onEdit={() => { setEditClient(selectedClient); setShowModal(true); }}
            onDelete={() => setDeleteConfirm(selectedClient.crmClientId)}
            onClose={() => setSelectedClientId(null)}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-slate-50">
          <div className="text-center">
            <Building2 className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-900 mb-2">Selecione um cliente</h3>
            <p className="text-slate-500 text-sm">Clique em um cliente da lista para ver os detalhes</p>
          </div>
        </div>
      )}

      {/* ─── Modal de Cadastro/Edição ─── */}
      {showModal && (
        <ClientFormModal
          clientId={clientId}
          onClose={() => { setShowModal(false); setEditClient(null); }}
          onSaved={() => refetch()}
          editData={editClient}
        />
      )}

      {/* ─── Modal de Confirmação de Exclusão ─── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Excluir Cliente</h3>
                <p className="text-sm text-slate-500">Esta ação não pode ser desfeita.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors font-medium text-sm">
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate({ clientId, crmClientId: deleteConfirm })}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-medium text-sm disabled:opacity-60">
                {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
