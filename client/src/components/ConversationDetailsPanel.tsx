import React from "react";
import { Check, ChevronDown, Copy, Pencil, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ConversationMedia } from "@/components/ConversationMedia";

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
  status?: string | null;
  assignedTo?: string | null;
  createdAt?: string | Date | null;
  closedAt?: string | Date | null;
};

const initialSections = ["attendance", "contact", "history"];

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

export function ConversationDetailsPanel({ conversation, open, onClose, onContactUpdated, onCrmLinked, onNavigate, onToast }:
  { conversation: Conversation; open: boolean; onClose: () => void; onContactUpdated: (contact: { displayName: string; companyText: string | null }) => void; onCrmLinked: (crm: { crmClientId: string | null; companyName?: string | null }) => void; onNavigate: (route: string, detail?: Record<string, unknown>) => void; onToast: (message: string, type?: "success" | "error") => void }) {
  const [sections, setSections] = React.useState(() => new Set(initialSections));
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const companyInputRef = React.useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = React.useState(false);
  const [editingCompany, setEditingCompany] = React.useState(false);
  const [name, setName] = React.useState(conversation.name ?? "");
  const [companyText, setCompanyText] = React.useState(conversation.companyText ?? "");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [linking, setLinking] = React.useState(false);
  const [crmSearch, setCrmSearch] = React.useState("");
  const [crmOffset, setCrmOffset] = React.useState(0);
  const [pendingCrm, setPendingCrm] = React.useState<any | null>(null);
  const [confirmUnlink, setConfirmUnlink] = React.useState(false);
  const [historyId, setHistoryId] = React.useState<string | null>(null);
  const utils = trpc.useUtils();
  const updateContact = trpc.conversations.updateContact.useMutation();
  const linkCrm = trpc.conversations.linkCrm.useMutation();
  const candidates = trpc.conversations.companyCandidates.useQuery({ search: crmSearch, limit: 10, offset: crmOffset }, { enabled: open && linking });
  const historyDetail = trpc.conversations.historyDetail.useQuery({ conversationId: historyId ?? "" }, { enabled: !!historyId });
  const history = trpc.conversations.history.useQuery({ contactId: conversation.contactId ?? "" }, { enabled: open && !!conversation.contactId });
  const tickets = trpc.conversations.linkedTickets.useQuery({ conversationId: conversation.id }, { enabled: open });
  const toggle = (id: string) => setSections(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const status = conversation.status === "bot" ? "BOT/Aguardando" : conversation.status === "closed" ? "Encerrada" : "Aberta";
  const navigate = (route: string, detail: Record<string, unknown> = {}) => onNavigate(route, { conversationId: conversation.id, contactId: conversation.contactId, crmClientId: conversation.crmClientId, companyName: conversation.companyName, contactName: conversation.name, phone: conversation.phone, ...detail });

  React.useEffect(() => {
    setEditingName(false); setEditingCompany(false); setFormError(null);
    setName(conversation.name ?? ""); setCompanyText(conversation.companyText ?? "");
  }, [conversation.id, conversation.name, conversation.companyText]);
  React.useEffect(() => { if (editingName) nameInputRef.current?.focus(); }, [editingName]);
  React.useEffect(() => { if (editingCompany) companyInputRef.current?.focus(); }, [editingCompany]);

  const save = async (fields: { displayName?: string; companyText?: string | null }) => {
    if (!conversation.contactId || updateContact.isPending) return;
    setFormError(null);
    try {
      const updated = await updateContact.mutateAsync({ contactId: conversation.contactId, ...fields });
      setName(updated.displayName); setCompanyText(updated.companyText ?? "");
      onContactUpdated({ displayName: updated.displayName, companyText: updated.companyText });
      await utils.conversations.list.invalidate();
      setEditingName(false); setEditingCompany(false);
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
    await navigator.clipboard.writeText(conversation.publicCode ?? "");
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  };
  const applyCrm = async (crmClientId: string | null, companyName?: string | null) => {
    if (!conversation.contactId || linkCrm.isPending) return;
    try {
      await linkCrm.mutateAsync({ contactId: conversation.contactId, crmClientId });
      onCrmLinked({ crmClientId, companyName });
      await Promise.all([utils.conversations.list.invalidate(), utils.conversations.linkedTickets.invalidate()]);
      setPendingCrm(null); setLinking(false); setConfirmUnlink(false);
      onToast(crmClientId ? "Empresa vinculada ao contato." : "Vínculo removido.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Não foi possível alterar o vínculo.", "error");
    }
  };
  React.useEffect(() => {
    if (!historyId) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setHistoryId(null); };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [historyId]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && window.innerWidth < 1280) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    if (window.innerWidth < 1280) requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
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
        {editingName ? <div onKeyDown={event => keys(event, () => void save({ displayName: name }), () => { setName(conversation.name ?? ""); setEditingName(false); setFormError(null); })}>
          <label htmlFor="contact-name" className="mb-1 block text-xs font-medium">Nome</label>
          <input ref={nameInputRef} id="contact-name" value={name} maxLength={180} disabled={updateContact.isPending} onChange={event => setName(event.target.value)} className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
          <div className="mt-2 flex gap-2"><button type="button" disabled={updateContact.isPending || !name.trim()} onClick={() => void save({ displayName: name })} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-semibold text-white disabled:opacity-60"><Check className="h-3.5 w-3.5" />{updateContact.isPending ? "Salvando…" : "Salvar"}</button><button type="button" disabled={updateContact.isPending} onClick={() => { setName(conversation.name ?? ""); setEditingName(false); setFormError(null); }} className="min-h-9 rounded-lg px-2.5 text-xs font-semibold hover:bg-slate-100">Cancelar</button></div>
        </div> : <div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><strong className="block truncate text-slate-800">{conversation.name || "Contato sem nome"}</strong><span className="block text-xs">{conversation.phone || "Telefone indisponível"}</span></div><button type="button" onClick={() => setEditingName(true)} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Pencil className="h-3.5 w-3.5" />Editar</button></div>}
        <div className="border-t border-slate-100 pt-3">
          {editingCompany ? <div onKeyDown={event => keys(event, () => void save({ companyText }), () => { setCompanyText(conversation.companyText ?? ""); setEditingCompany(false); setFormError(null); })}>
            <label htmlFor="contact-company" className="mb-1 block text-xs font-medium">Nome da empresa</label>
            <input ref={companyInputRef} id="contact-company" value={companyText} maxLength={255} disabled={updateContact.isPending} onChange={event => setCompanyText(event.target.value)} className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50" />
            <p className="mt-1 text-[11px] text-slate-500">Informação declarada pelo contato; não cria cadastro empresarial.</p>
            <div className="mt-2 flex gap-2"><button type="button" disabled={updateContact.isPending} onClick={() => void save({ companyText })} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-semibold text-white disabled:opacity-60"><Check className="h-3.5 w-3.5" />{updateContact.isPending ? "Salvando…" : "Salvar"}</button><button type="button" disabled={updateContact.isPending} onClick={() => { setCompanyText(conversation.companyText ?? ""); setEditingCompany(false); setFormError(null); }} className="min-h-9 rounded-lg px-2.5 text-xs font-semibold hover:bg-slate-100">Cancelar</button></div>
          </div> : conversation.companyText ? <div><span className="block text-[11px] font-medium text-slate-500">Empresa informada</span><div className="flex min-w-0 items-center justify-between gap-2"><span className="min-w-0 truncate text-slate-800">{conversation.companyText}</span><span className="flex shrink-0"><button type="button" aria-label="Editar empresa informada" onClick={() => setEditingCompany(true)} className="min-h-9 rounded-lg p-2 text-blue-700 hover:bg-blue-50"><Pencil className="h-3.5 w-3.5" /></button><button type="button" aria-label="Remover empresa informada" disabled={updateContact.isPending} onClick={() => void save({ companyText: null })} className="min-h-9 rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-60"><Trash2 className="h-3.5 w-3.5" /></button></span></div><p className="text-[11px] text-slate-500">Informação do contato</p></div>
            : <button type="button" onClick={() => setEditingCompany(true)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">+ Adicionar empresa</button>}
        </div>
        {conversation.crmClientId && <div className="rounded-lg bg-blue-50 px-2.5 py-2 text-xs text-blue-800"><span className="block font-semibold">Cliente vinculado</span><span className="block truncate">{conversation.companyName || conversation.company || "Cadastro CRM vinculado"}</span></div>}
        {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}
      </Section>
      <Section id="client" title="Cliente" open={sections.has("client")} onToggle={() => toggle("client")}>
        {conversation.crmClientId ? <div className="space-y-2"><div className="rounded-lg bg-blue-50 p-2"><strong className="block text-blue-900">{conversation.companyName || "Empresa vinculada"}</strong><span className="text-xs text-blue-700">Vinculada ao CRM</span></div><div className="flex flex-wrap gap-2"><button onClick={() => navigate("erp-clients", { crmClientId: conversation.crmClientId })}>Visualizar perfil</button><button onClick={() => setLinking(true)}>Alterar vínculo</button><button onClick={() => setConfirmUnlink(true)} className="text-red-600">Remover vínculo</button></div></div> : <div><p>Contato ainda não vinculado</p><button onClick={() => setLinking(true)} className="mt-2 text-blue-700">+ Vincular a uma empresa</button></div>}
        {linking && <div className="space-y-2 border-t pt-3"><label htmlFor="crm-search" className="text-xs">Buscar por nome/documento</label><input id="crm-search" value={crmSearch} onChange={e => { setCrmSearch(e.target.value); setCrmOffset(0); }} className="min-h-10 w-full rounded-lg border px-3" /><QueryState loading={candidates.isLoading} error={candidates.isError} empty={!candidates.data?.items.length} emptyText="Nenhuma empresa encontrada."><ul className="max-h-48 space-y-1 overflow-auto">{candidates.data?.items.map((item: any) => <li key={item.id}><button onClick={() => setPendingCrm(item)} className="w-full rounded-lg border p-2 text-left"><strong className="block">{item.name}</strong><span className="text-xs">{item.document ? `•••${String(item.document).replace(/\D/g, "").slice(-4)}` : "Documento não informado"}</span></button></li>)}</ul></QueryState><div className="flex justify-between text-xs"><button disabled={!crmOffset} onClick={() => setCrmOffset(Math.max(0, crmOffset - 10))}>Anterior</button><button disabled={!candidates.data?.hasMore} onClick={() => setCrmOffset(crmOffset + 10)}>Próxima</button><button onClick={() => setLinking(false)}>Cancelar</button></div></div>}
        {pendingCrm && <div role="alertdialog" aria-label="Confirmar vínculo" className="rounded-lg border p-3"><strong>{pendingCrm.name}</strong><p className="text-xs">Confirmar vínculo?</p><button disabled={linkCrm.isPending} onClick={() => void applyCrm(pendingCrm.id, pendingCrm.name)} className="mr-2 mt-2 rounded bg-blue-600 p-2 text-white">Confirmar</button><button onClick={() => setPendingCrm(null)}>Cancelar</button></div>}
        {confirmUnlink && <div role="alertdialog" aria-label="Confirmar remoção" className="rounded-lg border p-3"><p>Remover somente o vínculo CRM?</p><button disabled={linkCrm.isPending} onClick={() => void applyCrm(null)} className="mr-2 mt-2 text-red-600">Remover vínculo</button><button onClick={() => setConfirmUnlink(false)}>Cancelar</button></div>}
      </Section>
      <Section id="tickets" title="Chamados" open={sections.has("tickets")} onToggle={() => toggle("tickets")}>
        {!conversation.crmClientId && <p className="text-xs">Vincule o contato a uma empresa para abrir chamados pelo CRM.</p>}<div className="grid grid-cols-2 gap-2"><button type="button" disabled={!conversation.crmClientId} onClick={() => navigate("tickets", { mode: "create" })} className="min-h-10 rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white disabled:opacity-50">Abrir chamado</button><button type="button" onClick={() => navigate("tickets")} className="min-h-10 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-700">Visualizar chamados</button></div>
        <QueryState loading={tickets.isLoading} error={tickets.isError} empty={!tickets.data?.length} emptyText="Nenhum chamado vinculado."><ul className="space-y-2">{tickets.data?.map((ticket: any) => <li key={ticket.id}><button type="button" onClick={() => navigate("tickets", { ticketId: ticket.id })} className="w-full rounded-lg border border-slate-200 p-2 text-left hover:bg-slate-50"><strong className="block text-xs text-slate-800">CH-{ticket.number} · {ticket.title}</strong><span className="text-xs">{ticket.status}</span></button></li>)}</ul></QueryState>
      </Section>
      <Section id="history" title="Histórico de conversas" open={sections.has("history")} onToggle={() => toggle("history")}>
        <QueryState loading={history.isLoading} error={history.isError} empty={!history.data?.length} emptyText="Nenhum atendimento anterior."><ol className="space-y-2">{history.data?.map((item: any) => <li key={item.id}><button type="button" aria-current={item.id === conversation.id ? "true" : undefined} disabled={item.id === conversation.id} onClick={() => setHistoryId(item.id)} className={cn("w-full rounded-lg border p-3 text-left", item.id === conversation.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50")}><strong className="block text-xs">{item.publicCode}</strong><span className="text-xs">{dateTime(item.startedAt)} · {item.status}</span>{item.id === conversation.id && <span className="block text-xs font-semibold text-blue-700">Conversa atual</span>}</button></li>)}</ol></QueryState>
      </Section>
    </div>
  </aside>;
  const historyModal = historyId && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-0 sm:p-4" onMouseDown={e => { if (e.currentTarget === e.target) setHistoryId(null); }}><div role="dialog" aria-modal="true" aria-labelledby="history-title" className="flex h-full w-full flex-col overflow-hidden bg-white sm:h-[88vh] sm:max-w-5xl sm:rounded-2xl"><header className="flex justify-between border-b p-4"><div><span className="text-xs font-semibold text-blue-700">Somente leitura</span><h2 id="history-title" className="text-lg font-semibold">{historyDetail.data?.conversation.customerName || "Conversa anterior"}</h2><p className="text-xs">{historyDetail.data?.conversation.publicCode} · {historyDetail.data?.conversation.status} · {dateTime(historyDetail.data?.conversation.startedAt)}</p><p className="text-xs">Responsável: {historyDetail.data?.conversation.assignedUserName || "Não atribuído"}</p></div><button autoFocus aria-label="Fechar histórico" onClick={() => setHistoryId(null)}><X /></button></header><div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4"><QueryState loading={historyDetail.isLoading} error={historyDetail.isError} empty={!historyDetail.data?.messages.length} emptyText="Nenhuma mensagem."><div className="space-y-3">{historyDetail.data?.messages.map((msg: any, i: number) => { const out = msg.direction === "outbound" || msg.from === "agent"; return <div key={msg.id || i} className={cn("flex", out ? "justify-end" : "justify-start")}><div className={cn("max-w-[85%] rounded-2xl p-3", out ? "bg-blue-600 text-white" : "bg-slate-100")}>{msg.type === "text" || !msg.type ? <p>{msg.text}</p> : <ConversationMedia conversationId={historyId} message={msg} fallback={<span>{msg.text || "Mídia indisponível"}</span>} />}<span className="block text-[10px] opacity-70">{msg.agentName || msg.sender} · {dateTime(msg.timestamp)}</span></div></div>; })}</div></QueryState></div><footer className="border-t p-3 text-right"><button onClick={() => setHistoryId(null)} className="rounded bg-slate-900 px-4 py-2 text-white">Voltar para o atendimento</button></footer></div></div>;
  return <>{<button type="button" aria-label="Fechar detalhes da conversa" onClick={onClose} className="absolute inset-0 z-40 bg-slate-950/20 min-[1280px]:hidden" />}{panel}{historyModal}</>;
}
