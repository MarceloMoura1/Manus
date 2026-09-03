import React from "react";
import { Check, ChevronDown, Copy, Link2, Pencil, Search, UserPlus, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ConversationMedia } from "@/components/ConversationMedia";
import { ConversationActivityEvent } from "@/components/ConversationActivityEvent";
import { ClientFormModal } from "@/pages/ClientesPage";
import { useDebounce } from "@/hooks/useDebounce";
import { operatorDisplayName } from "@/lib/conversation-operator-name";
import { mergeConversationTimeline } from "@/lib/conversationTimeline";
import { replyAuthor, replyPreview, type ConversationReplyPreview } from "@/lib/conversationQuote";
import { formatContactPhone, hasHumanContactName, normalizeContactPhone } from "../../../shared/contact-phone";

type Conversation = {
  id: string;
  publicCode?: string | null;
  contactId?: string | null;
  crmClientId?: string | null;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
  companyText?: string | null;
  companyName?: string | null;
  customerType?: "person" | "company" | null;
  crmResponsibleName?: string | null;
  crmPhone?: string | null;
  crmWhatsapp?: string | null;
  crmEmail?: string | null;
  status?: string | null;
  assignedTo?: string | null;
  createdAt?: string | Date | null;
  closedAt?: string | Date | null;
};

const initialSections = ["attendance", "contact", "client", "history"];

function dateTime(value?: string | Date | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Section({ id, title, open, onToggle, children }: React.PropsWithChildren<{ id: string; title: string; open: boolean; onToggle: () => void }>) {
  return <section data-testid={`details-section-${id}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <button type="button" aria-expanded={open} aria-controls={`${id}-content`} onClick={onToggle}
      className="flex min-h-11 w-full items-center justify-between px-3.5 py-2.5 text-left text-sm font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
      <span>{title}</span><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
    {open && <div id={`${id}-content`} className="space-y-3 border-t border-slate-100 px-3.5 py-3 text-sm text-slate-600">{children}</div>}
  </section>;
}

function QueryState({ loading, error, empty, emptyText, children }: React.PropsWithChildren<{ loading: boolean; error: boolean; empty: boolean; emptyText: string }>) {
  if (loading) return <p role="status" className="text-xs text-slate-500">Carregando…</p>;
  if (error) return <p role="alert" className="text-xs text-red-600">Não foi possível carregar esta seção.</p>;
  if (empty) return <p className="text-xs text-slate-500">{emptyText}</p>;
  return <>{children}</>;
}

function ReadonlyQuote({ replyTo }: { replyTo: ConversationReplyPreview }) {
  return <div data-testid="history-message-quote" className="mb-2 rounded-lg border-l-2 border-current bg-black/5 px-2.5 py-2 text-xs opacity-90">
    <span className="block truncate font-bold">{replyAuthor(replyTo)}</span>
    <span className="block truncate">{replyPreview(replyTo)}</span>
  </div>;
}

export function ConversationDetailsPanel({ conversation, open, canManageClients, onClose, onContactUpdated, onCrmLinked, onNavigate, onToast }:
  { conversation: Conversation; open: boolean; canManageClients: boolean; onClose: () => void; onContactUpdated: (contact: { displayName: string; companyText: string | null }) => void; onCrmLinked: (crm: { crmClientId: string | null; companyName?: string | null }) => void; onNavigate: (route: string, detail?: Record<string, unknown>) => void; onToast: (message: string, type?: "success" | "error") => void }) {
  const [sections, setSections] = React.useState(() => new Set(initialSections));
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = React.useState(false);
  const [name, setName] = React.useState(conversation.name ?? "");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [copiedPhone, setCopiedPhone] = React.useState(false);
  const [linking, setLinking] = React.useState(false);
  const [crmSearch, setCrmSearch] = React.useState("");
  const [crmOffset, setCrmOffset] = React.useState(0);
  const debouncedCrmSearch = useDebounce(crmSearch, 300);
  const normalizedCrmSearch = debouncedCrmSearch.trim();
  const crmSearchIsValid = normalizedCrmSearch.length >= 2;
  const crmSearchIsReady = crmSearch.trim() === normalizedCrmSearch && crmSearchIsValid;
  const crmSearchInputRef = React.useRef<HTMLInputElement>(null);
  const crmLinkButtonRef = React.useRef<HTMLButtonElement>(null);
  const [pendingCrm, setPendingCrm] = React.useState<any | null>(null);
  const [confirmUnlink, setConfirmUnlink] = React.useState(false);
  const [creatingClient, setCreatingClient] = React.useState(false);
  const [createdButUnlinked, setCreatedButUnlinked] = React.useState<{ id: string; name: string } | null>(null);
  const [historyId, setHistoryId] = React.useState<string | null>(null);
  const [historyBrowserOpen, setHistoryBrowserOpen] = React.useState(false);
  const [historyPageOffset, setHistoryPageOffset] = React.useState(0);
  const [historyPageItems, setHistoryPageItems] = React.useState<any[]>([]);
  const utils = trpc.useUtils();
  const updateContact = trpc.conversations.updateContact.useMutation();
  const linkCrm = trpc.conversations.linkCrm.useMutation();
  const candidates = trpc.conversations.companyCandidates.useQuery({ search: normalizedCrmSearch, limit: 10, offset: crmOffset }, { enabled: open && linking && crmSearchIsReady });
  const phoneCandidates = trpc.conversations.phoneCandidates.useQuery({ phone: conversation.phone ?? "" }, { enabled: open && !conversation.crmClientId && !!conversation.phone });
  const historyDetail = trpc.conversations.historyDetail.useQuery({ contactId: conversation.contactId ?? "", conversationId: historyId ?? "" }, { enabled: !!historyId && !!conversation.contactId });
  const history = trpc.conversations.history.useQuery({ contactId: conversation.contactId ?? "", currentConversationId: conversation.id }, { enabled: open && !!conversation.contactId });
  const historyPage = trpc.conversations.historyPage.useQuery({ contactId: conversation.contactId ?? "", currentConversationId: conversation.id, offset: historyPageOffset }, { enabled: open && historyBrowserOpen && !!conversation.contactId });
  const tickets = trpc.conversations.linkedTickets.useQuery({ conversationId: conversation.id }, { enabled: open });
  const historyTimeline = React.useMemo(() => mergeConversationTimeline(
    historyDetail.data?.messages ?? [],
    historyDetail.data?.events ?? [],
  ), [historyDetail.data?.events, historyDetail.data?.messages]);
  const historyIndeterminate = historyDetail.data?.indeterminateHistory ?? [];
  const toggle = (id: string) => setSections(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const status = conversation.status === "bot" ? "BOT/Aguardando" : conversation.status === "closed" ? "Encerrada" : "Aberta";
  const navigate = (route: string, detail: Record<string, unknown> = {}) => onNavigate(route, { conversationId: conversation.id, contactId: conversation.contactId, crmClientId: conversation.crmClientId, companyName: conversation.companyName, contactName: conversation.name, phone: conversation.phone, ...detail });

  React.useEffect(() => {
    setEditingName(false); setFormError(null);
    setName(conversation.name ?? "");
    setCopied(false); setCopiedPhone(false);
    setLinking(false); setCrmSearch(""); setCrmOffset(0); setPendingCrm(null);
    setHistoryId(null); setHistoryBrowserOpen(false); setHistoryPageOffset(0); setHistoryPageItems([]);
  }, [conversation.id, conversation.name, conversation.companyText]);
  React.useEffect(() => {
    if (!open) { setLinking(false); setCrmSearch(""); setCrmOffset(0); setPendingCrm(null); }
  }, [open]);
  React.useEffect(() => { if (editingName) nameInputRef.current?.focus(); }, [editingName]);
  React.useEffect(() => { if (linking) requestAnimationFrame(() => crmSearchInputRef.current?.focus()); }, [linking]);
  React.useEffect(() => {
    if (!historyBrowserOpen || !historyPage.data) return;
    setHistoryPageItems(current => historyPageOffset === 0
      ? historyPage.data.items
      : [...current, ...historyPage.data.items.filter((item: any) => !current.some(existing => existing.id === item.id))]);
  }, [historyBrowserOpen, historyPage.data, historyPageOffset]);

  const closeCrmSearch = (restoreFocus = true) => {
    setLinking(false);
    setCrmSearch("");
    setCrmOffset(0);
    setPendingCrm(null);
    if (restoreFocus) requestAnimationFrame(() => crmLinkButtonRef.current?.focus());
  };
  const toggleCrmSearch = () => {
    if (linking) closeCrmSearch();
    else {
      setCrmSearch("");
      setCrmOffset(0);
      setPendingCrm(null);
      setLinking(true);
    }
  };
  const openClientForm = () => {
    if (linking) closeCrmSearch(false);
    setCreatingClient(true);
  };

  const save = async (fields: { displayName?: string }) => {
    if (!conversation.contactId || updateContact.isPending) return;
    setFormError(null);
    try {
      const updated = await updateContact.mutateAsync({ contactId: conversation.contactId, ...fields });
      setName(updated.displayName);
      onContactUpdated({ displayName: updated.displayName, companyText: updated.companyText });
      await utils.conversations.list.invalidate();
      setEditingName(false);
      onToast("Contato atualizado.");
    } catch {
      setFormError("Não foi possível salvar. Revise os dados e tente novamente.");
    }
  };
  const keys = (event: React.KeyboardEvent, submit: () => void, cancel: () => void) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
    if (event.key === "Enter") { event.preventDefault(); submit(); }
  };
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(conversation.publicCode ?? "");
      setCopied(true); window.setTimeout(() => setCopied(false), 1600);
    } catch { onToast("Não foi possível copiar o ID da conversa.", "error"); }
  };
  const copyPhone = async () => {
    const normalized = normalizeContactPhone(conversation.phone);
    if (normalized.status !== "valid" || !normalized.value) { onToast("Telefone indisponível para cópia.", "error"); return; }
    try {
      await navigator.clipboard.writeText(`+${normalized.value}`);
      setCopiedPhone(true); window.setTimeout(() => setCopiedPhone(false), 1600);
    } catch { onToast("Não foi possível copiar o telefone.", "error"); }
  };
  const applyCrm = async (crmClientId: string | null, companyName?: string | null) => {
    if (!conversation.contactId || linkCrm.isPending) return false;
    try {
      await linkCrm.mutateAsync({ contactId: conversation.contactId, crmClientId });
      onCrmLinked({ crmClientId, companyName });
      await Promise.all([utils.conversations.list.invalidate(), utils.conversations.linkedTickets.invalidate()]);
      setPendingCrm(null); setLinking(false); setCrmSearch(""); setCrmOffset(0); setConfirmUnlink(false);
      onToast(crmClientId ? "Cliente vinculado ao contato." : "Vínculo removido.");
      return true;
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Não foi possível alterar o vínculo.", "error");
      return false;
    }
  };
  React.useEffect(() => {
    if (!historyId) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setHistoryId(null); };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [historyId]);
  React.useEffect(() => {
    if (!historyBrowserOpen) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setHistoryBrowserOpen(false); };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [historyBrowserOpen]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && window.innerWidth < 1280) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    if (window.innerWidth < 1280) requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  const contactName = hasHumanContactName(conversation.name, conversation.phone) ? conversation.name!.trim() : "Contato sem nome";
  const contactPhone = formatContactPhone(conversation.phone);
  const openHistoryBrowser = () => {
    setHistoryPageItems([]);
    setHistoryPageOffset(0);
    setHistoryBrowserOpen(true);
  };
  const panel = <aside id="conversation-details-panel" aria-label="Detalhes da conversa" data-testid="conversation-details-panel"
    className="absolute inset-y-0 right-0 z-50 flex w-full max-w-[340px] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-2xl min-[1280px]:relative min-[1280px]:z-auto min-[1280px]:w-[clamp(300px,24vw,340px)] min-[1280px]:flex-none min-[1280px]:shadow-none"
    style={{ paddingRight: "env(safe-area-inset-right)" }}>
    <header className="flex min-h-16 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div><h2 className="font-semibold text-slate-900">Detalhes da conversa</h2><p className="text-xs text-slate-500">Informações e vínculos</p></div>
      <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Fechar detalhes da conversa" title="Fechar detalhes da conversa"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 min-[1280px]:hidden"><X className="h-5 w-5" /></button>
    </header>
    <div className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <Section id="attendance" title="Atendimento" open={sections.has("attendance")} onToggle={() => toggle("attendance")}>
        <div className="min-w-0"><span className="block text-[11px] font-medium text-slate-500">ID da conversa</span><div className="flex min-w-0 items-center gap-1.5"><span title={conversation.publicCode ?? undefined} className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">{conversation.publicCode}</span><button type="button" aria-label="Copiar ID da conversa" title="Copiar ID da conversa" onClick={() => void copyId()} className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Copy className="h-3.5 w-3.5" />{copied ? "Copiado" : "Copiar"}</button></div><span className="sr-only" role="status" aria-live="polite">{copied ? "ID da conversa copiado" : ""}</span></div>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 text-xs"><dt>Status</dt><dd className="text-right font-medium text-slate-800">{status}</dd><dt>Responsável</dt><dd className="text-right font-medium text-slate-800">{conversation.assignedTo || "Não atribuído"}</dd><dt>Início</dt><dd className="text-right">{dateTime(conversation.createdAt)}</dd>{conversation.closedAt && <><dt>Encerramento</dt><dd className="text-right">{dateTime(conversation.closedAt)}</dd></>}</dl>
      </Section>
      <Section id="contact" title="Contato" open={sections.has("contact")} onToggle={() => toggle("contact")}>
        {editingName && !conversation.crmClientId ? <div onKeyDown={event => keys(event, () => void save({ displayName: name }), () => { setName(conversation.name ?? ""); setEditingName(false); setFormError(null); })}>
          <label htmlFor="contact-name" className="mb-1 block text-xs font-medium">Nome</label>
          <input ref={nameInputRef} id="contact-name" value={name} maxLength={180} disabled={updateContact.isPending} onChange={event => setName(event.target.value)} className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
          <div className="mt-2 flex gap-2"><button type="button" disabled={updateContact.isPending || !name.trim()} onClick={() => void save({ displayName: name })} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-semibold text-white disabled:opacity-60"><Check className="h-3.5 w-3.5" />{updateContact.isPending ? "Salvando…" : "Salvar"}</button><button type="button" disabled={updateContact.isPending} onClick={() => { setName(conversation.name ?? ""); setEditingName(false); setFormError(null); }} className="min-h-9 rounded-lg px-2.5 text-xs font-semibold hover:bg-slate-100">Cancelar</button></div>
        </div> : <div className="space-y-3"><div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><span className="block text-[11px] font-medium text-slate-500">Nome</span><strong className="block truncate text-slate-800">{contactName}</strong>{conversation.crmClientId && <span className="block text-[11px] text-slate-500">Gerenciado pelo perfil do Cliente ERP.</span>}</div>{!conversation.crmClientId && <button type="button" onClick={() => setEditingName(true)} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Pencil className="h-3.5 w-3.5" />Editar</button>}</div><div><span className="block text-[11px] font-medium text-slate-500">Contato</span><div className="mt-1 flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 break-all text-sm font-medium text-slate-800">{contactPhone}</span><button type="button" aria-label="Copiar telefone" title="Copiar telefone" onClick={() => void copyPhone()} className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Copy className="h-3.5 w-3.5" />{copiedPhone ? "Copiado" : "Copiar"}</button></div><span className="sr-only" role="status" aria-live="polite">{copiedPhone ? "Telefone copiado" : ""}</span></div></div>}
        {conversation.companyText && <div className="border-t border-slate-100 pt-3"><span className="block text-[11px] font-medium text-slate-500">Empresa informada</span><span className="block truncate text-slate-800">{conversation.companyText}</span><p className="text-[11px] text-slate-500">Informação preservada do contato</p></div>}
        {conversation.crmClientId && <div className="rounded-lg bg-blue-50 px-2.5 py-2 text-xs text-blue-800"><span className="block font-semibold">Cliente vinculado</span><span className="block truncate">{conversation.companyName || conversation.company || "Cadastro CRM vinculado"}</span></div>}
        {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}
      </Section>
      <Section id="client" title="Cliente" open={sections.has("client")} onToggle={() => toggle("client")}>
        {conversation.crmClientId ? <div className="space-y-3">
          <div className="rounded-xl border border-blue-200 bg-blue-700 p-3 text-white"><div className="flex items-center justify-between gap-2"><strong className="text-xs uppercase tracking-wide">Dados do cliente</strong><span className="rounded-full border border-blue-300 bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase">{conversation.customerType === "company" ? "Empresa" : "Pessoa física"}</span></div>{conversation.customerType === "company" ? <div className="mt-3 space-y-2 text-xs"><div><span className="block text-blue-100">Empresa / nome fantasia</span><strong className="block break-words">{conversation.companyName || "—"}</strong></div>{conversation.crmResponsibleName && <div><span className="block text-blue-100">Contato principal</span><strong className="block break-words">{conversation.crmResponsibleName}</strong></div>}<div><span className="block text-blue-100">Telefone</span><strong className="block break-all">{formatContactPhone(conversation.crmWhatsapp || conversation.crmPhone || conversation.phone)}</strong></div>{conversation.crmEmail && <div><span className="block text-blue-100">E-mail</span><strong className="block break-all">{conversation.crmEmail}</strong></div>}</div> : <div className="mt-3 space-y-2 text-xs"><div><span className="block text-blue-100">Nome</span><strong className="block break-words">{conversation.crmResponsibleName || conversation.companyName || contactName}</strong></div><div><span className="block text-blue-100">Telefone</span><strong className="block break-all">{formatContactPhone(conversation.crmWhatsapp || conversation.crmPhone || conversation.phone)}</strong></div>{conversation.crmEmail && <div><span className="block text-blue-100">E-mail</span><strong className="block break-all">{conversation.crmEmail}</strong></div>}</div>}</div>
          <button type="button" onClick={() => navigate("erp-clients", { crmClientId: conversation.crmClientId })} className="flex min-h-10 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Visualizar perfil</button>
          <button ref={crmLinkButtonRef} type="button" aria-expanded={linking} aria-controls="crm-link-search" onClick={toggleCrmSearch} className="flex min-h-10 w-full items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span className="inline-flex items-center gap-2"><Link2 className="h-4 w-4" aria-hidden="true" />Vincular contato</span><ChevronDown className={cn("h-4 w-4 transition-transform", linking && "rotate-180")} aria-hidden="true" /></button>
          <button type="button" onClick={() => setConfirmUnlink(true)} className="min-h-9 w-full rounded-lg px-3 text-xs font-semibold text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Remover vínculo</button>
        </div> : <div className="space-y-3">
          {phoneCandidates.isLoading ? <p role="status" className="text-xs">Procurando pelo telefone…</p> : phoneCandidates.data?.items.length === 1 ? <div className="rounded-lg bg-emerald-50 p-2.5"><strong className="block text-emerald-900">Cliente encontrado pelo telefone</strong><span className="block truncate text-xs text-emerald-800">{phoneCandidates.data.items[0].name} · {phoneCandidates.data.items[0].customerType === "person" ? "Pessoa" : phoneCandidates.data.items[0].customerType === "company" ? "Empresa" : "Não definido"}</span><button type="button" className="mt-2 min-h-9 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={() => setPendingCrm(phoneCandidates.data!.items[0])}>Vincular contato</button></div> : (phoneCandidates.data?.items.length ?? 0) > 1 ? <div className="rounded-lg bg-amber-50 p-2.5"><strong className="block text-amber-900">Encontramos mais de um cadastro com este telefone</strong><button type="button" className="mt-2 min-h-9 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => { setCrmSearch(conversation.phone ?? ""); setCrmOffset(0); setLinking(true); }}>Selecionar cadastro</button></div> : <p className="text-xs text-slate-500">Cliente não cadastrado</p>}
          {canManageClients && <button type="button" onClick={openClientForm} className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><UserPlus className="h-4 w-4 text-slate-500" aria-hidden="true" />Cadastrar cliente</button>}
          <button ref={crmLinkButtonRef} type="button" aria-expanded={linking} aria-controls="crm-link-search" onClick={toggleCrmSearch} className="flex min-h-10 w-full items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span className="inline-flex items-center gap-2"><Link2 className="h-4 w-4" aria-hidden="true" />Vincular contato</span><ChevronDown className={cn("h-4 w-4 transition-transform", linking && "rotate-180")} aria-hidden="true" /></button>
        </div>}
        {createdButUnlinked && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs"><p>Cliente criado, mas não foi possível vincular o contato.</p><button className="mt-2 font-semibold text-blue-700" onClick={() => void applyCrm(createdButUnlinked.id, createdButUnlinked.name)}>Tentar vincular novamente</button></div>}
        {linking && <div id="crm-link-search" className="space-y-2 border-t border-slate-200 pt-3"><label htmlFor="crm-search" className="block text-xs font-semibold text-slate-700">Buscar</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input ref={crmSearchInputRef} id="crm-search" value={crmSearch} placeholder="Digite o nome da pessoa ou empresa" onChange={e => { setCrmSearch(e.target.value); setCrmOffset(0); }} className="min-h-10 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500" /></div>{!crmSearch.trim() ? <p className="text-xs text-slate-500">Digite para buscar um cadastro.</p> : crmSearch.trim().length < 2 ? <p className="text-xs text-slate-500">Digite pelo menos 2 caracteres.</p> : !crmSearchIsReady ? <p role="status" className="text-xs text-slate-500">Buscando…</p> : <QueryState loading={candidates.isLoading || candidates.isFetching} error={candidates.isError} empty={!candidates.data?.items.length} emptyText="Nenhum cliente encontrado."><ul className="max-h-56 space-y-2 overflow-auto pr-1">{candidates.data?.items.map((item: any) => <li key={item.id}><button type="button" onClick={() => setPendingCrm(item)} className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-left hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><strong className="block overflow-hidden text-ellipsis text-sm font-semibold leading-5 text-slate-800 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{item.name}</strong></button></li>)}</ul>{candidates.data?.items.length ? <div className="flex items-center justify-between gap-2 pt-1 text-xs"><button type="button" disabled={!crmOffset} onClick={() => setCrmOffset(Math.max(0, crmOffset - 10))} className="min-h-9 rounded-lg px-2 font-semibold disabled:opacity-40">Anterior</button><button type="button" disabled={!candidates.data?.hasMore} onClick={() => setCrmOffset(crmOffset + 10)} className="min-h-9 rounded-lg px-2 font-semibold disabled:opacity-40">Próxima</button></div> : null}</QueryState>}</div>}
        {pendingCrm && <div role="alertdialog" aria-label="Confirmar vínculo" className="rounded-lg border p-3"><strong>{pendingCrm.name}</strong><p className="text-xs">Confirmar vínculo?</p><button disabled={linkCrm.isPending} onClick={() => void applyCrm(pendingCrm.id, pendingCrm.name)} className="mr-2 mt-2 rounded bg-blue-600 p-2 text-white">Confirmar</button><button onClick={() => setPendingCrm(null)}>Cancelar</button></div>}
        {confirmUnlink && <div role="alertdialog" aria-label="Confirmar remoção" className="rounded-lg border p-3"><p>Remover somente o vínculo CRM?</p><button disabled={linkCrm.isPending} onClick={() => void applyCrm(null)} className="mr-2 mt-2 text-red-600">Remover vínculo</button><button onClick={() => setConfirmUnlink(false)}>Cancelar</button></div>}
      </Section>
      <Section id="tickets" title="Chamados" open={sections.has("tickets")} onToggle={() => toggle("tickets")}>
        {!conversation.crmClientId && <p className="text-xs">Vincule o contato a uma empresa para abrir chamados pelo CRM.</p>}<div className="grid grid-cols-2 gap-2"><button type="button" disabled={!conversation.crmClientId} onClick={() => navigate("tickets", { mode: "create" })} className="min-h-10 rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white disabled:opacity-50">Abrir chamado</button><button type="button" onClick={() => navigate("tickets")} className="min-h-10 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-700">Visualizar chamados</button></div>
        <QueryState loading={tickets.isLoading} error={tickets.isError} empty={!tickets.data?.length} emptyText="Nenhum chamado vinculado."><ul className="space-y-2">{tickets.data?.map((ticket: any) => <li key={ticket.id}><button type="button" onClick={() => navigate("tickets", { ticketId: ticket.id })} className="w-full rounded-lg border border-slate-200 p-2 text-left hover:bg-slate-50"><strong className="block text-xs text-slate-800">CH-{ticket.number} · {ticket.title}</strong><span className="text-xs">{ticket.status}</span></button></li>)}</ul></QueryState>
      </Section>
      <Section id="history" title="Histórico de conversas" open={sections.has("history")} onToggle={() => toggle("history")}>
        <QueryState loading={history.isLoading} error={history.isError} empty={!history.data?.items.length} emptyText="Nenhum atendimento anterior."><ol className="space-y-2">{history.data?.items.map((item: any) => <li key={item.id}><button type="button" onClick={() => setHistoryId(item.id)} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"><strong className="block text-xs">{item.publicCode}</strong><span className="text-xs">{dateTime(item.startedAt)} · {item.status}</span></button></li>)}</ol>{history.data?.hasMore && <button type="button" onClick={openHistoryBrowser} className="min-h-9 text-xs font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Ver todos os atendimentos</button>}</QueryState>
      </Section>
    </div>
  </aside>;
  const historyModal = historyId && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-0 sm:p-4" onMouseDown={e => { if (e.currentTarget === e.target) setHistoryId(null); }}><div role="dialog" aria-modal="true" aria-labelledby="history-title" className="flex h-full w-full flex-col overflow-hidden bg-white sm:h-[88vh] sm:max-w-5xl sm:rounded-2xl"><header className="flex justify-between border-b p-4"><div><span className="text-xs font-semibold text-blue-700">Somente leitura</span><h2 id="history-title" className="text-lg font-semibold">{historyDetail.data?.conversation.customerName || "Conversa anterior"}</h2><p className="text-xs">{historyDetail.data?.conversation.publicCode} · {historyDetail.data?.conversation.status} · {dateTime(historyDetail.data?.conversation.startedAt)}</p><p className="text-xs">Responsável: {historyDetail.data?.conversation.assignedUserName || "Não atribuído"}</p></div><button autoFocus aria-label="Fechar histórico" onClick={() => setHistoryId(null)}><X /></button></header><div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4"><QueryState loading={historyDetail.isLoading} error={historyDetail.isError} empty={!historyTimeline.length && !historyIndeterminate.length} emptyText="Nenhuma atividade ou mensagem."><div className="space-y-3">{historyTimeline.map((item: any, i: number) => { if (item.kind === "activity") return <ConversationActivityEvent key={item.id || i} event={item} compact />; const out = item.direction === "outbound" || item.from === "agent"; const senderName = out ? operatorDisplayName(item) : item.sender; return <div key={item.id || i} className={cn("flex", out ? "justify-end" : "justify-start")}><div className={cn("max-w-[85%] rounded-2xl p-3", out ? "bg-blue-600 text-white" : "bg-slate-100")}>{item.replyTo && <ReadonlyQuote replyTo={item.replyTo} />}{item.type === "text" || !item.type ? <p>{item.text}</p> : <ConversationMedia conversationId={historyId} message={item} fallback={<span>{item.text || "Mídia indisponível"}</span>} />}<span className="block text-[10px] opacity-70">{senderName} · {dateTime(item.timestamp)}</span></div></div>; })}{historyIndeterminate.length > 0 && <section aria-label="Histórico anterior sem horário confirmado" className="space-y-3 border-t border-dashed border-slate-300 pt-4"><h3 className="text-center text-xs font-semibold text-slate-500">Histórico anterior sem horário confirmado</h3>{historyIndeterminate.map((item: any, i: number) => { const out = item.direction === "outbound" || item.from === "agent"; return <div key={item.id || `indeterminate-history-${i}`} className={cn("flex", out ? "justify-end" : "justify-start")}><div className={cn("max-w-[85%] rounded-2xl p-3", out ? "bg-slate-600 text-white" : "bg-slate-100")}>{item.type === "text" || !item.type ? <p>{item.text || item.message}</p> : <ConversationMedia conversationId={historyId} message={item} fallback={<span>{item.text || item.message || "Mídia indisponível"}</span>} />}</div></div>; })}</section>}</div></QueryState></div><footer className="border-t p-3 text-right"><button onClick={() => setHistoryId(null)} className="rounded bg-slate-900 px-4 py-2 text-white">Voltar para o atendimento</button></footer></div></div>;
  const historyBrowserModal = historyBrowserOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-0 sm:p-4" onMouseDown={event => { if (event.currentTarget === event.target) setHistoryBrowserOpen(false); }}><div role="dialog" aria-modal="true" aria-labelledby="history-browser-title" className="flex h-full w-full flex-col overflow-hidden bg-white sm:h-[80vh] sm:max-w-2xl sm:rounded-2xl"><header className="flex items-start justify-between border-b p-4"><div><span className="text-xs font-semibold text-blue-700">Atendimentos anteriores</span><h2 id="history-browser-title" className="text-lg font-semibold">Histórico de {contactName}</h2><p className="text-xs text-slate-500">Selecione um atendimento para abrir em modo somente leitura.</p></div><button autoFocus aria-label="Fechar todos os atendimentos" onClick={() => setHistoryBrowserOpen(false)}><X /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-4"><QueryState loading={historyPage.isLoading && !historyPageItems.length} error={historyPage.isError} empty={!historyPageItems.length} emptyText="Nenhum atendimento anterior."><ol className="space-y-2">{historyPageItems.map(item => <li key={item.id}><button type="button" onClick={() => { setHistoryBrowserOpen(false); setHistoryId(item.id); }} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"><strong className="block text-sm text-slate-800">{item.publicCode}</strong><span className="block text-xs text-slate-600">{dateTime(item.startedAt)} · {item.status}</span><span className="block text-xs text-slate-500">Responsável: {item.assignedUserName || "Não atribuído"}</span></button></li>)}</ol>{historyPage.data?.hasMore && <button type="button" disabled={historyPage.isFetching} onClick={() => setHistoryPageOffset(offset => offset + 20)} className="mt-3 min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-blue-700 disabled:opacity-50">{historyPage.isFetching ? "Carregando…" : "Carregar mais"}</button>}</QueryState></div><footer className="border-t p-3 text-right"><button onClick={() => setHistoryBrowserOpen(false)} className="rounded bg-slate-900 px-4 py-2 text-white">Voltar para o atendimento</button></footer></div></div>;
  return <>{<button type="button" aria-label="Fechar detalhes da conversa" onClick={onClose} className="absolute inset-0 z-40 bg-slate-950/20 min-[1280px]:hidden" />}{panel}{historyBrowserModal}{historyModal}{creatingClient && <ClientFormModal initialData={{ companyName: conversation.name ?? "", phone: conversation.phone ?? "", whatsapp: conversation.phone ?? "" }} onClose={() => setCreatingClient(false)} onUseExisting={client => { setCreatingClient(false); setPendingCrm({ id: client.crmClientId, name: client.companyName }); }} onViewExisting={client => { setCreatingClient(false); navigate("erp-clients", { crmClientId: client.crmClientId }); }} onSaved={async crmClientId => { if (!crmClientId) return; const linked = await applyCrm(crmClientId, conversation.name); if (!linked) { setCreatedButUnlinked({ id: crmClientId, name: conversation.name ?? "Cliente" }); throw new Error("Cliente criado, mas não foi possível vincular o contato"); } setCreatedButUnlinked(null); await utils.crm.list.invalidate(); }} />}</>;
}
