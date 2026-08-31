import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { CustomerType, CrmWhatsAppIntent } from "../../../shared/crm";
import { customerTypeToCsv } from "../../../shared/crm";
import { isValidCpf, isValidCnpj, suggestCustomerType } from "../../../shared/br-documents";
import { normalizeContactPhone, sameContactPhone } from "../../../shared/contact-phone";
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
  Download,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  PlusCircle,
} from "lucide-react";

function cn(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function safeLifecycleMessage(error: unknown) {
  const message = typeof error === "object" && error && "message" in error ? String(error.message) : "";
  const allowed = [
    "Este cliente possui histórico ou vínculos e não pode ser excluído. Arquive o cadastro para preservá-los.",
    "O cliente foi alterado por outra pessoa. Atualize a página e tente novamente.",
    "Esta ação não está disponível no estado atual do cliente.",
    "Somente administradores podem excluir clientes definitivamente.",
  ];
  return allowed.includes(message) ? message : "Não foi possível concluir a ação. Tente novamente.";
}

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type CrmClient = {
  crmClientId: string;
  companyName: string;
  customerType: CustomerType | null;
  responsibleName: string | null;
  cpfCnpj: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
  status: "lead" | "ativo" | "inativo" | "cancelado" | "inadimplente";
  origin: "whatsapp" | "instagram" | "facebook" | "site" | "indicacao" | "outro";
  internalResponsible: string | null;
  tags: string | null;
  observations: string | null;
  contactsJson: string | null;
  lastInteractionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lifecycleState: "active" | "inactive" | "archived";
  preArchiveState: "active" | "inactive" | null;
  lifecycleChangedAt: Date | null;
  archivedAt: Date | null;
  lifecycleVersion: number;
};

type ClientTab = "geral" | "chamados" | "conversas" | "timeline" | "financeiro" | "rastreamento" | "arquivos";
type AdditionalContact = { phone: string; whatsapp: string; description?: string };

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
export type CrmClientFormData = {
  customerType: CustomerType | null;
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
  contacts: Array<{ phone: string; whatsapp: string; description?: string }>;
};

const EMPTY_FORM: CrmClientFormData = {
  customerType: null,
  companyName: "", responsibleName: "", cpfCnpj: "", phone: "", whatsapp: "",
  email: "", address: "", city: "", state: "", cep: "",
  status: "lead", origin: "outro", internalResponsible: "", tags: "", observations: "",
  contacts: [],
};

const visualString = (value: unknown) => typeof value === "string" ? value : "";

function contactsForForm(value: unknown): CrmClientFormData["contacts"] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(contact => ({
      phone: visualString(contact?.phone), whatsapp: visualString(contact?.whatsapp), description: visualString(contact?.description),
    })) : [];
  } catch { return []; }
}

function editableClient(client: CrmClient): CrmClientFormData {
  return {
    customerType: client.customerType,
    companyName: visualString(client.companyName),
    responsibleName: visualString(client.responsibleName),
    cpfCnpj: visualString(client.cpfCnpj),
    phone: visualString(client.phone),
    whatsapp: visualString(client.whatsapp),
    email: visualString(client.email),
    address: visualString(client.address),
    city: visualString(client.city),
    state: visualString(client.state),
    cep: visualString(client.cep),
    status: client.status ?? "lead",
    origin: client.origin ?? "outro",
    internalResponsible: visualString(client.internalResponsible),
    tags: visualString(client.tags),
    observations: visualString(client.observations),
    contacts: contactsForForm(client.contactsJson),
  };
}

export function ClientFormModal({
  onClose,
  onSaved,
  onUseExisting,
  onViewExisting,
  editData,
  initialData,
}: {
  onClose: () => void;
  onSaved: (crmClientId?: string) => void | Promise<void>;
  onUseExisting?: (client: { crmClientId: string; companyName: string }) => void | Promise<void>;
  onViewExisting?: (client: { crmClientId: string; companyName: string }) => void;
  editData?: CrmClient | null;
  initialData?: Partial<CrmClientFormData>;
}) {
  const titleId = React.useId();
  const [form, setForm] = useState<CrmClientFormData>(editData ? editableClient(editData) : { ...EMPTY_FORM, ...initialData });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateClient, setDuplicateClient] = useState<{ crmClientId: string; companyName: string; matchedField: "cpfCnpj" | "phone" } | null>(null);
  const [sameWhatsapp, setSameWhatsapp] = useState(() => editData ? sameContactPhone(editData.phone, editData.whatsapp) : true);
  const [showOtherWhatsapp, setShowOtherWhatsapp] = useState(() => !!editData?.whatsapp && !sameContactPhone(editData.phone, editData.whatsapp));
  const legacySuggestion = editData?.customerType === null ? suggestCustomerType(visualString(editData.cpfCnpj)) : null;

  const addContact = () => {
    setForm(prev => ({
      ...prev,
      contacts: [...prev.contacts, { phone: "", whatsapp: "", description: "" }]
    }));
  };

  const removeContact = (index: number) => {
    setForm(prev => ({
      ...prev,
      contacts: prev.contacts.filter((_, i) => i !== index)
    }));
  };

  const updateContact = (index: number, field: string, value: string) => {
    setForm(prev => ({
      ...prev,
      contacts: prev.contacts.map((c, i) => i === index ? { ...c, [field]: value } : c)
    }));
  };

  const createMutation = trpc.crm.create.useMutation();
  const updateMutation = trpc.crm.update.useMutation();
  const utils = trpc.useUtils();

  function setField<K extends keyof CrmClientFormData>(key: K, value: CrmClientFormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    setFieldErrors(prev => { const next = { ...prev }; delete next[key]; return next; });
    setSubmitError(null);
    setDuplicateClient(null);
  }

  function selectCustomerType(next: CustomerType) {
    if (!form.customerType || form.customerType === next) {
      setField("customerType", next);
      return;
    }
    const message = form.customerType === "company"
      ? "Ao mudar para Pessoa, o nome será reinterpretado, o responsável será removido e um CNPJ incompatível será limpo. Confirmar?"
      : "Ao mudar para Empresa, o nome será reinterpretado e um CPF incompatível será limpo. Confirmar?";
    if (!window.confirm(message)) return;
    setForm(prev => ({
      ...prev,
      customerType: next,
      responsibleName: next === "person" ? "" : prev.responsibleName,
      cpfCnpj: !prev.cpfCnpj || (next === "person" ? isValidCpf(prev.cpfCnpj) : isValidCnpj(prev.cpfCnpj)) ? prev.cpfCnpj : "",
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading) return;
    const customerType = form.customerType;
    const errors: Record<string, string> = {};
    if (!customerType) errors.customerType = "Selecione Pessoa ou Empresa.";
    if (!form.companyName.trim()) errors.companyName = customerType === "person" ? "Nome completo é obrigatório." : "Nome da empresa é obrigatório.";
    if (form.cpfCnpj && !(customerType === "person" ? isValidCpf(form.cpfCnpj) : isValidCnpj(form.cpfCnpj))) {
      errors.cpfCnpj = customerType === "person" ? "CPF inválido." : "CNPJ inválido.";
    }
    const phone = normalizeContactPhone(form.phone);
    const whatsapp = sameWhatsapp ? phone : normalizeContactPhone(form.whatsapp);
    if (phone.status === "invalid") errors.phone = "Telefone inválido.";
    if (whatsapp.status === "invalid") errors.whatsapp = "WhatsApp inválido.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = "E-mail inválido.";
    if (Object.keys(errors).length) {
      setFieldErrors(errors); setSubmitError("Revise os campos destacados.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    if (!customerType) return;
    const data = {
      ...form,
      customerType,
      companyName: form.companyName.trim(), responsibleName: form.responsibleName.trim(), cpfCnpj: form.cpfCnpj.trim(),
      phone: phone.value ?? "", whatsapp: whatsapp.value ?? "", email: form.email.trim(), address: form.address.trim(),
      city: form.city.trim(), state: form.state.trim(), cep: form.cep.trim(), internalResponsible: form.internalResponsible.trim(),
      tags: form.tags.trim(), observations: form.observations.trim(),
      contacts: form.contacts.map(contact => ({ phone: contact.phone.trim(), whatsapp: contact.whatsapp.trim(), description: contact.description?.trim() || "" })),
    };
    try {
      if (editData) {
        await updateMutation.mutateAsync({ crmClientId: editData.crmClientId, data });
        await onSaved(editData.crmClientId); toast.success("Cliente atualizado com sucesso!");
      } else {
        const result = await createMutation.mutateAsync({ data });
        await onSaved(result.crmClientId); toast.success("Cliente cadastrado com sucesso!");
      }
      onClose();
    } catch (error) {
      const code = (error as { data?: { code?: string } } | null)?.data?.code;
      if (code === "CONFLICT") {
        const duplicate = await utils.crm.findDuplicate.fetch({ cpfCnpj: data.cpfCnpj, phone: data.phone }).catch(() => null);
        setDuplicateClient(duplicate);
        const duplicateField = duplicate?.matchedField ?? (data.cpfCnpj ? "cpfCnpj" : "phone");
        setFieldErrors(prev => ({ ...prev, [duplicateField]: "Já existe um cadastro com este dado." }));
        setSubmitError("Já existe um cadastro. Vincule ou visualize o cadastro existente, ou altere os dados do novo cadastro.");
        requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
        return;
      }
      const message = "Não foi possível salvar o cliente. Tente novamente.";
      setSubmitError(message); toast.error(message);
    }
  }

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-slate-900">
                {editData ? "Editar Cliente" : "Cadastrar Novo Cliente"}
              </h2>
              <p className="text-sm text-slate-500">Preencha os dados do cliente</p>
            </div>
          </div>
          <button type="button" aria-label="Fechar cadastro de cliente" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form noValidate onSubmit={handleSubmit} className="p-6 space-y-6">
          {submitError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{submitError}</p>{duplicateClient && <div className="mt-3 flex flex-col gap-2 sm:flex-row">{onUseExisting && <button type="button" onClick={() => void onUseExisting(duplicateClient)} className="min-h-9 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white">Vincular cadastro existente</button>}{onViewExisting && <button type="button" onClick={() => onViewExisting(duplicateClient)} className="min-h-9 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-slate-700">Visualizar perfil</button>}</div>}</div>}
          {/* Dados Básicos */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" /> Dados Básicos
            </h3>
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-medium text-slate-700">Tipo de cliente *</legend>
              <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Tipo de cliente">
                {(["person", "company"] as const).map(type => <button key={type} type="button" role="radio" aria-checked={form.customerType === type} onClick={() => selectCustomerType(type)} className={cn("rounded-lg border px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500", form.customerType === type ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-700")}>{type === "person" ? "Pessoa" : "Empresa"}</button>)}
              </div>
              {fieldErrors.customerType && <p id="customer-type-error" className="mt-1 text-xs text-red-600">{fieldErrors.customerType}</p>}
              {legacySuggestion && !form.customerType && <p className="mt-2 text-sm text-amber-700">Sugestão pelo documento: {legacySuggestion === "person" ? "Pessoa" : "Empresa"}. Confirme uma opção para salvar.</p>}
            </fieldset>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">{form.customerType === "person" ? "Nome completo" : "Nome da empresa"} *</label>
                <input aria-label={form.customerType === "person" ? "Nome completo" : "Nome da empresa"} aria-invalid={!!fieldErrors.companyName} aria-describedby={fieldErrors.companyName ? "company-name-error" : undefined} autoComplete={form.customerType === "person" ? "name" : "organization"} type="text" value={form.companyName} onChange={e => setField("companyName", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                {fieldErrors.companyName && <p id="company-name-error" className="mt-1 text-xs text-red-600">{fieldErrors.companyName}</p>}
              </div>
              {form.customerType === "company" && <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Responsável</label>
                <input aria-label="Nome do Responsável" type="text" value={form.responsibleName} onChange={e => setField("responsibleName", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{form.customerType === "person" ? "CPF" : "CNPJ"} (opcional)</label>
                <input aria-label={form.customerType === "person" ? "CPF" : "CNPJ"} aria-invalid={!!fieldErrors.cpfCnpj} aria-describedby={fieldErrors.cpfCnpj ? "document-error" : undefined} inputMode="numeric" type="text" value={form.cpfCnpj} onChange={e => setField("cpfCnpj", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                {fieldErrors.cpfCnpj && <p id="document-error" className="mt-1 text-xs text-red-600">{fieldErrors.cpfCnpj}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Telefone principal (opcional)</label>
                <input aria-label="Telefone principal" aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? "phone-error" : undefined} autoComplete="tel" inputMode="tel" type="text" value={form.phone} onChange={e => setField("phone", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                {fieldErrors.phone && <p id="phone-error" className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>}
              </div>
              <div className="sm:col-span-2 space-y-2"><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={sameWhatsapp} onChange={e => { setSameWhatsapp(e.target.checked); if (e.target.checked) setShowOtherWhatsapp(false); }} /> Este número também é WhatsApp</label>{!sameWhatsapp && !showOtherWhatsapp && <button type="button" className="text-sm font-medium text-blue-600" onClick={() => setShowOtherWhatsapp(true)}>Adicionar outro número de WhatsApp</button>}{!sameWhatsapp && showOtherWhatsapp && <div><label className="block text-sm font-medium text-slate-700 mb-1">Número do WhatsApp (opcional)</label><input aria-label="Número do WhatsApp" aria-invalid={!!fieldErrors.whatsapp} aria-describedby={fieldErrors.whatsapp ? "whatsapp-error" : undefined} autoComplete="tel" inputMode="tel" value={form.whatsapp} onChange={e => setField("whatsapp", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />{fieldErrors.whatsapp && <p id="whatsapp-error" className="mt-1 text-xs text-red-600">{fieldErrors.whatsapp}</p>}</div>}</div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                <input aria-label="E-mail" aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? "email-error" : undefined} type="email" value={form.email} onChange={e => setField("email", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  autoComplete="email" />
                {fieldErrors.email && <p id="email-error" className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Endereço</label>
                <input aria-label="Endereço" type="text" value={form.address} onChange={e => setField("address", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  autoComplete="street-address" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cidade</label>
                <input aria-label="Cidade" type="text" value={form.city} onChange={e => setField("city", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  autoComplete="address-level2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Estado</label>
                  <input aria-label="Estado" type="text" value={form.state} onChange={e => setField("state", e.target.value.toUpperCase().slice(0, 2))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    autoComplete="address-level1" maxLength={2} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">CEP</label>
                  <input aria-label="CEP" type="text" value={form.cep} onChange={e => setField("cep", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    autoComplete="postal-code" />
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
                <select aria-label="Status" value={form.status} onChange={e => setField("status", e.target.value as CrmClientFormData["status"])}
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
                <select aria-label="Origem" value={form.origin} onChange={e => setField("origin", e.target.value as CrmClientFormData["origin"])}
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
                <input aria-label="Responsável Interno" type="text" value={form.internalResponsible} onChange={e => setField("internalResponsible", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
                <input aria-label="Tags" type="text" value={form.tags} onChange={e => setField("tags", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
              </div>
            </div>
          </section>

          {/* Contatos Adicionais */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400" /> Contatos Adicionais
              </h3>
              <button
                type="button"
                onClick={addContact}
                className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Adicionar
              </button>
            </div>
            {form.contacts.length > 0 ? (
              <div className="space-y-4">
                {form.contacts.map((contact, idx) => (
                  <div key={idx} className="p-4 border border-slate-200 rounded-lg bg-slate-50">
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-sm font-medium text-slate-600">Contato {idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeContact(idx)}
                        className="p-1 text-red-400 hover:bg-red-50 rounded transition-colors"
                        title="Remover contato"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Telefone</label>
                        <input
                          aria-label={`Telefone do contato ${idx + 1}`}
                          type="text"
                          value={contact.phone}
                          onChange={e => updateContact(idx, "phone", e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">WhatsApp</label>
                        <input
                          aria-label={`WhatsApp do contato ${idx + 1}`}
                          type="text"
                          value={contact.whatsapp}
                          onChange={e => updateContact(idx, "whatsapp", e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Descrição (opcional)</label>
                        <input
                          aria-label={`Descrição do contato ${idx + 1}`}
                          type="text"
                          value={contact.description || ""}
                          onChange={e => updateContact(idx, "description", e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">Nenhum contato adicional. Clique em "+ Adicionar" para adicionar um novo contato.</p>
            )}
          </section>

          {/* Observações */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" /> Observações Internas
            </h3>
            <textarea
              aria-label="Observações Internas"
              value={form.observations}
              onChange={e => setField("observations", e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
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
  onEdit,
  onClose,
  onSendMessage,
  whatsappConnected,
  canStartConversation,
  onLifecycleChanged,
  onDeleted,
}: {
  client: CrmClient;
  onEdit: () => void;
  onClose: () => void;
  onSendMessage?: (intent: CrmWhatsAppIntent) => void;
  whatsappConnected: boolean;
  canStartConversation: boolean;
  onLifecycleChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<ClientTab>("geral");
  const [newTimelineNote, setNewTimelineNote] = useState("");
  const [riskAction, setRiskAction] = useState<"deactivate" | "reactivate" | "archive" | "restore" | "delete" | null>(null);
  const [deletePhrase, setDeletePhrase] = useState("");
  const lifecycleMutation = trpc.crm.changeLifecycle.useMutation();
  const deleteMutation = trpc.crm.deletePermanently.useMutation();
  const riskPending = lifecycleMutation.isPending || deleteMutation.isPending;
  const lifecycleLabel = client.lifecycleState === "archived" ? "Arquivado" : client.lifecycleState === "inactive" ? "Inativo" : "Ativo";
  const runRiskAction = async () => {
    if (!riskAction || riskPending) return;
    try {
      if (riskAction === "delete") {
        if (deletePhrase !== "EXCLUIR") return;
        await deleteMutation.mutateAsync({ crmClientId: client.crmClientId, expectedVersion: client.lifecycleVersion });
        toast.success("Cliente excluído definitivamente.");
        await onDeleted();
      } else {
        await lifecycleMutation.mutateAsync({ crmClientId: client.crmClientId, action: riskAction, expectedVersion: client.lifecycleVersion });
        toast.success("Estado do cliente atualizado.");
        await onLifecycleChanged();
      }
      setRiskAction(null); setDeletePhrase("");
    } catch (error) { toast.error(safeLifecycleMessage(error)); }
  };

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
    { crmClientId: client.crmClientId },
    { enabled: activeTab === "chamados", refetchOnWindowFocus: false }
  );
  const conversasQuery = trpc.crm.getConversas.useQuery(
    { crmClientId: client.crmClientId },
    { enabled: activeTab === "conversas", refetchOnWindowFocus: false }
  );
  const timelineQuery = trpc.crm.getTimeline.useQuery(
    { crmClientId: client.crmClientId },
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
            <button type="button" disabled={client.lifecycleState === "archived"} onClick={onEdit} className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40" title={client.lifecycleState === "archived" ? "Restaure o cliente antes de editar" : "Editar"}>
              <Edit3 className="w-4 h-4 text-slate-500" />
            </button>
            <button type="button" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Fechar">
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={client.status} />
          <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", client.lifecycleState === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : client.lifecycleState === "inactive" ? "border-slate-200 bg-slate-100 text-slate-700" : "border-amber-200 bg-amber-50 text-amber-800")}>{lifecycleLabel}</span>
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
                  <div className="flex items-center gap-2 text-sm text-slate-700 group">
                    <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span>{client.phone}</span>
                  </div>
                )}
                {client.whatsapp && (
                  <div className="flex items-center gap-2 text-sm text-slate-700 group">
                    <Smartphone className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span>{client.whatsapp}</span>
                    <span className="text-xs text-green-600 font-medium" title="Número declarado como WhatsApp">WhatsApp</span>
                    {canStartConversation && <button
                      type="button"
                      disabled={!whatsappConnected || normalizeContactPhone(client.whatsapp).status !== "valid"}
                      onClick={() => onSendMessage?.({ crmClientId: client.crmClientId, phone: client.whatsapp ?? "", channel: "whatsapp" })}
                      className="ml-auto p-1 hover:bg-slate-100 rounded disabled:cursor-not-allowed disabled:opacity-40"
                      title={whatsappConnected ? "Iniciar atendimento pelo WhatsApp" : "WhatsApp desconectado"}
                    >
                      <MessageSquare className="w-4 h-4 text-blue-500" />
                    </button>}
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

                {/* Contatos Adicionais */}
                {client.contactsJson && (() => {
                  try {
                    const contacts = JSON.parse(client.contactsJson) as AdditionalContact[];
                    if (contacts.length > 0) {
                      return (
                        <>
                          {contacts.map((contact, idx) => (
                            <div key={idx} className="border-t border-slate-200 pt-2 mt-2">
                              {contact.description && (
                                <p className="text-xs font-medium text-slate-600 mb-1">{contact.description}</p>
                              )}
                              {contact.phone && (
                                <div className="flex items-center gap-2 text-sm text-slate-700 group">
                                  <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <span>{contact.phone}</span>
                                </div>
                              )}
                              {contact.whatsapp && (
                                <div className="flex items-center gap-2 text-sm text-slate-700 group">
                                  <Smartphone className="w-4 h-4 text-green-500 flex-shrink-0" />
                                  <span>{contact.whatsapp}</span>
                                  <span className="text-xs text-green-600 font-medium" title="Número declarado como WhatsApp">WhatsApp</span>
                                  {canStartConversation && <button
                                    type="button"
                                    disabled={!whatsappConnected || normalizeContactPhone(contact.whatsapp).status !== "valid"}
                                    onClick={() => onSendMessage?.({ crmClientId: client.crmClientId, phone: contact.whatsapp, channel: "whatsapp" })}
                                    className="ml-auto p-1 hover:bg-slate-100 rounded disabled:cursor-not-allowed disabled:opacity-40"
                                    title={whatsappConnected ? "Iniciar atendimento pelo WhatsApp" : "WhatsApp desconectado"}
                                  >
                                    <MessageSquare className="w-4 h-4 text-blue-500" />
                                  </button>}
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      );
                    }
                  } catch (e) {
                    // Se nao conseguir fazer parse, ignora
                  }
                  return null;
                })()}
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
                  addTimelineMutation.mutate({
                    crmClientId: client.crmClientId,
                    description: newTimelineNote.trim(),
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
      <section aria-labelledby="risk-zone-title" className="border-t border-red-100 bg-red-50/40 p-4">
        <h3 id="risk-zone-title" className="text-sm font-bold text-red-800">Zona de risco</h3>
        <p className="mt-1 text-xs text-slate-600">O histórico e os vínculos são preservados ao inativar ou arquivar.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {client.lifecycleState === "active" && <button type="button" onClick={() => setRiskAction("deactivate")} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold">Inativar</button>}
          {client.lifecycleState === "inactive" && <button type="button" onClick={() => setRiskAction("reactivate")} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold">Reativar</button>}
          {client.lifecycleState !== "archived" && <button type="button" onClick={() => setRiskAction("archive")} className="min-h-10 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-800">Arquivar</button>}
          {client.lifecycleState === "archived" && <button type="button" onClick={() => setRiskAction("restore")} className="min-h-10 rounded-lg border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-700">Restaurar</button>}
          <button type="button" onClick={() => setRiskAction("delete")} className="min-h-10 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white">Excluir</button>
        </div>
      </section>
      {riskAction && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !riskPending) setRiskAction(null); }} onKeyDown={event => { if (event.key === "Escape" && !riskPending) setRiskAction(null); }}>
        <div role="alertdialog" aria-modal="true" aria-labelledby="risk-dialog-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
          <h2 id="risk-dialog-title" className="text-lg font-bold text-slate-900">{riskAction === "delete" ? "Excluir cliente permanentemente" : `${riskAction === "archive" ? "Arquivar" : riskAction === "restore" ? "Restaurar" : riskAction === "deactivate" ? "Inativar" : "Reativar"} cliente`}</h2>
          <p className="mt-2 text-sm text-slate-600">{riskAction === "delete" ? "Esta ação é permanente e só será permitida se o cadastro não possuir histórico ou vínculos." : riskAction === "archive" ? "O cliente sairá das buscas padrão, mas todo o histórico será preservado." : riskAction === "deactivate" ? "Novos vínculos e operações ficarão bloqueados até a reativação." : "O cadastro voltará ao estado operacional seguro correspondente."}</p>
          {riskAction === "delete" && <label className="mt-4 block text-sm font-semibold text-slate-800">Digite EXCLUIR para confirmar<input autoFocus value={deletePhrase} onChange={event => setDeletePhrase(event.target.value)} className="mt-2 min-h-10 w-full rounded-lg border border-red-300 px-3 outline-none focus:ring-2 focus:ring-red-500" /></label>}
          <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={riskPending} onClick={() => { setRiskAction(null); setDeletePhrase(""); }} className="min-h-10 rounded-lg px-3 font-semibold">Cancelar</button><button type="button" disabled={riskPending || (riskAction === "delete" && deletePhrase !== "EXCLUIR")} onClick={() => void runRiskAction()} className="min-h-10 rounded-lg bg-red-700 px-4 font-semibold text-white disabled:opacity-50">{riskPending ? "Processando…" : "Confirmar"}</button></div>
        </div>
      </div>}
    </div>
  );
}

// ─── Página Principal ──────────────────────────────────────────────────────────
export function ClientesPage({ initialSelectedId, onNavigate, whatsappConnected = false, canStartConversation = false }: { initialSelectedId?: string; onNavigate?: (intent: CrmWhatsAppIntent) => void; whatsappConnected?: boolean; canStartConversation?: boolean } = {}) {
  const handleSendMessage = useCallback((intent: CrmWhatsAppIntent) => {
    if (onNavigate) {
      onNavigate(intent);
    }
  }, [onNavigate]);

  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<"active" | "inactive" | "archived" | "all">("active");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(initialSelectedId ?? null);
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState<CrmClient | null>(null);
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
  const exportCsvQuery = trpc.crm.exportCsv.useQuery(undefined, { enabled: false });

  const handleCsvExport = useCallback(async () => {
    const result = await exportCsvQuery.refetch();
    if (result.error || !result.data) {
      toast.error(result.error?.message ?? "Não foi possível exportar os clientes.");
      return;
    }
    const headers = ["empresa", "tipo", "responsavel", "cpf_cnpj", "telefone", "whatsapp", "email", "endereco", "cidade", "estado", "cep", "status", "origem", "observacoes"];
    const safeCell = (value: unknown) => {
      const raw = String(value ?? "");
      const formulaSafe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${formulaSafe.replace(/"/g, '""')}"`;
    };
    const rows = result.data.rows.map((row) => [row.companyName, customerTypeToCsv(row.customerType), row.responsibleName, row.cpfCnpj, row.phone, row.whatsapp, row.email, row.address, row.city, row.state, row.cep, row.status, row.origin, row.observations].map(safeCell).join(";"));
    const blob = new Blob([`\uFEFF${headers.join(";")}\n${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "clientes.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, [exportCsvQuery]);

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
        customerType: r["tipo"] || r["type"] || "",
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
      importCsvMutation.mutate({ rows: mapped });
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }, [importCsvMutation]);

  const { data, isLoading, isError, error, refetch } = trpc.crm.list.useQuery(
    { search: search.trim() || undefined, lifecycle: lifecycleFilter },
    { refetchOnWindowFocus: false }
  );

  const clients: CrmClient[] = (data?.clients ?? []) as unknown as CrmClient[];

  // Sem filtro de status, mostrar todos os clientes
  const filteredClients = useMemo(() => {
    return clients;
  }, [clients]);

  const selectedClient = filteredClients.find(c => c.crmClientId === selectedClientId) ?? null;

  // Quando initialSelectedId é passado e os dados carregam, garantir que o cliente seja encontrado
  // mesmo que esteja fora do filtro atual (resetar filtro se necessário)
  useEffect(() => {
    if (initialSelectedId && clients.length > 0 && !selectedClient) {
      const found = clients.find(c => c.crmClientId === initialSelectedId);
      if (found) {
        setSelectedClientId(initialSelectedId);
      }
    }
  }, [initialSelectedId, clients, selectedClient]);

  return (
    <div data-testid="clients-page" className="flex h-full min-w-0 flex-col gap-0 overflow-hidden lg:flex-row">
      {/* ─── Lista de Clientes (esquerda) ─── */}
      <div className={cn(
        "flex min-h-0 min-w-0 flex-col border-r border-slate-200 bg-white transition-all duration-200",
        selectedClient ? "max-h-[45%] w-full flex-shrink-0 lg:max-h-none lg:w-80" : "flex-1"
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
                type="button"
                onClick={() => void handleCsvExport()}
                disabled={exportCsvQuery.isFetching}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium disabled:opacity-60"
                title="Exportar clientes em CSV"
              >
                <Download className="w-4 h-4" />
                Exportar
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

          <div className="flex flex-wrap gap-1" aria-label="Filtrar clientes por estado">
            {([['active','Ativos'],['inactive','Inativos'],['archived','Arquivados'],['all','Todos']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={lifecycleFilter === value} onClick={() => { setLifecycleFilter(value); setSelectedClientId(null); }} className={cn("min-h-9 rounded-lg px-2.5 text-xs font-semibold", lifecycleFilter === value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700")}>{label}</button>)}
          </div>


        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center h-48 text-center p-4" role="alert">
              <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
              <p className="text-slate-700 font-medium text-sm">Não foi possível carregar os clientes</p>
              <p className="text-slate-400 text-xs mt-1">{error.message}</p>
              <button type="button" onClick={() => void refetch()} className="mt-3 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium">
                Tentar novamente
              </button>
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
                    <span className="text-[11px] font-semibold text-slate-500">{client.lifecycleState === "archived" ? "Arquivado" : client.lifecycleState === "inactive" ? "Inativo" : "Ativo"}</span>
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
            </p>
          </div>
        )}
      </div>

      {/* ─── Painel de Detalhes (direita) ─── */}
      {selectedClient ? (
        <div className="min-h-0 min-w-0 flex-1 bg-white overflow-hidden">
            <ClientDetailPanel
              client={selectedClient}
              onEdit={() => { setEditClient(selectedClient); setShowModal(true); }}
            onClose={() => setSelectedClientId(null)}
            onSendMessage={handleSendMessage}
            whatsappConnected={whatsappConnected}
            canStartConversation={canStartConversation}
            onLifecycleChanged={async () => { await refetch(); }}
            onDeleted={async () => { setSelectedClientId(null); await refetch(); }}
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
          onClose={() => { setShowModal(false); setEditClient(null); }}
          onSaved={async () => { await refetch(); }}
          onViewExisting={client => { setSelectedClientId(client.crmClientId); setShowModal(false); setEditClient(null); }}
          editData={editClient}
        />
      )}

    </div>
  );
}
