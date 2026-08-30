import React from "react";
import { ChevronDown, Copy, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Conversation = {
  id: string;
  publicCode?: string | null;
  contactId?: string | null;
  crmClientId?: string | null;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
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
  return <section className="border-b border-slate-200">
    <button type="button" aria-expanded={open} aria-controls={`${id}-content`} onClick={onToggle}
      className="flex min-h-12 w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
      <span>{title}</span><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
    {open && <div id={`${id}-content`} className="space-y-3 px-4 pb-4 text-sm text-slate-600">{children}</div>}
  </section>;
}

function QueryState({ loading, error, empty, emptyText, children }: React.PropsWithChildren<{ loading: boolean; error: boolean; empty: boolean; emptyText: string }>) {
  if (loading) return <p role="status" className="text-xs text-slate-500">Carregando…</p>;
  if (error) return <p role="alert" className="text-xs text-red-600">Não foi possível carregar esta seção.</p>;
  if (empty) return <p className="text-xs text-slate-500">{emptyText}</p>;
  return <>{children}</>;
}

export function ConversationDetailsPanel({ conversation, open, onClose, onSelectConversation, onEditContact, onNavigate }:
  { conversation: Conversation; open: boolean; onClose: () => void; onSelectConversation: (item: any) => void; onEditContact: () => void; onNavigate: (route: string, detail?: Record<string, unknown>) => void }) {
  const [sections, setSections] = React.useState(() => new Set(initialSections));
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const history = trpc.conversations.history.useQuery({ contactId: conversation.contactId ?? "" }, { enabled: open && !!conversation.contactId });
  const tickets = trpc.conversations.linkedTickets.useQuery({ conversationId: conversation.id }, { enabled: open });
  const toggle = (id: string) => setSections(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const status = conversation.status === "bot" ? "BOT/Aguardando" : conversation.status === "closed" ? "Encerrada" : "Aberta";
  const navigate = (route: string, detail: Record<string, unknown> = {}) => onNavigate(route, { conversationId: conversation.id, contactId: conversation.contactId, crmClientId: conversation.crmClientId, phone: conversation.phone, ...detail });

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && window.innerWidth < 1280) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    if (window.innerWidth < 1280) requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  const panel = <aside id="conversation-details-panel" aria-label="Detalhes da conversa" data-testid="conversation-details-panel"
    className="absolute inset-y-0 right-0 z-50 flex w-full max-w-[340px] flex-col border-l border-slate-200 bg-white shadow-2xl min-[1280px]:relative min-[1280px]:z-auto min-[1280px]:w-[clamp(300px,24vw,340px)] min-[1280px]:flex-none min-[1280px]:shadow-none"
    style={{ paddingRight: "env(safe-area-inset-right)" }}>
    <header className="flex min-h-16 items-center justify-between border-b border-slate-200 px-4">
      <div><h2 className="font-semibold text-slate-900">Detalhes da conversa</h2><p className="text-xs text-slate-500">Informações e vínculos</p></div>
      <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Fechar detalhes da conversa" title="Fechar detalhes da conversa"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 min-[1280px]:hidden"><X className="h-5 w-5" /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
      <Section id="attendance" title="Atendimento" open={sections.has("attendance")} onToggle={() => toggle("attendance")}>
        <div><span className="block text-xs text-slate-500">Protocolo</span><div className="flex items-center justify-between gap-2"><strong className="break-all text-slate-800">{conversation.publicCode}</strong><button type="button" aria-label="Copiar protocolo" onClick={() => void navigator.clipboard.writeText(conversation.publicCode ?? "")} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Copy className="h-3.5 w-3.5" />Copiar</button></div></div>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 text-xs"><dt>Status</dt><dd className="text-right font-medium text-slate-800">{status}</dd><dt>Responsável</dt><dd className="text-right font-medium text-slate-800">{conversation.assignedTo || "Não atribuído"}</dd><dt>Início</dt><dd className="text-right">{dateTime(conversation.createdAt)}</dd>{conversation.closedAt && <><dt>Encerramento</dt><dd className="text-right">{dateTime(conversation.closedAt)}</dd></>}</dl>
      </Section>
      <Section id="contact" title="Contato" open={sections.has("contact")} onToggle={() => toggle("contact")}>
        <div><strong className="block text-slate-800">{conversation.name || "Contato sem nome"}</strong><span className="block text-xs">{conversation.phone}</span>{conversation.company && <span className="block text-xs">{conversation.company}</span>}</div>
        <div className="grid gap-1"><button type="button" onClick={onEditContact} className="min-h-10 rounded-lg px-2 text-left font-medium text-blue-700 hover:bg-blue-50">Editar contato</button><button type="button" onClick={onEditContact} className="min-h-10 rounded-lg px-2 text-left font-medium text-blue-700 hover:bg-blue-50">Vincular contato a uma empresa</button></div>
      </Section>
      <Section id="client" title="Cliente" open={sections.has("client")} onToggle={() => toggle("client")}>
        <button type="button" onClick={() => navigate("erp-clients")} className="min-h-10 w-full rounded-lg px-2 text-left font-medium text-blue-700 hover:bg-blue-50">{conversation.crmClientId ? "Visualizar perfil" : "Cadastrar cliente"}</button>
      </Section>
      <Section id="tickets" title="Chamados" open={sections.has("tickets")} onToggle={() => toggle("tickets")}>
        <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => navigate("tickets", { mode: "create" })} className="min-h-10 rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white">Abrir chamado</button><button type="button" onClick={() => navigate("tickets")} className="min-h-10 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-700">Visualizar chamados</button></div>
        <QueryState loading={tickets.isLoading} error={tickets.isError} empty={!tickets.data?.length} emptyText="Nenhum chamado vinculado."><ul className="space-y-2">{tickets.data?.map((ticket: any) => <li key={ticket.id}><button type="button" onClick={() => navigate("tickets", { ticketId: ticket.id })} className="w-full rounded-lg border border-slate-200 p-2 text-left hover:bg-slate-50"><strong className="block text-xs text-slate-800">CH-{ticket.number} · {ticket.title}</strong><span className="text-xs">{ticket.status}</span></button></li>)}</ul></QueryState>
      </Section>
      <Section id="history" title="Histórico de conversas" open={sections.has("history")} onToggle={() => toggle("history")}>
        <QueryState loading={history.isLoading} error={history.isError} empty={!history.data?.length} emptyText="Nenhum atendimento anterior."><ol className="space-y-2">{history.data?.map((item: any) => <li key={item.id}><button type="button" aria-current={item.id === conversation.id ? "true" : undefined} onClick={() => onSelectConversation(item)} className={cn("w-full rounded-lg border p-3 text-left hover:bg-slate-50", item.id === conversation.id ? "border-blue-300 bg-blue-50" : "border-slate-200")}><span className="flex justify-between gap-2 text-xs"><strong className="text-slate-800">{item.publicCode}</strong><span>{dateTime(item.startedAt)}</span></span><span className="mt-1 block text-xs">{item.status === "bot" ? "BOT/Aguardando" : item.status === "closed" ? "Encerrada" : "Aberta"}{item.assignedUserName ? ` · ${item.assignedUserName}` : ""}</span>{item.id === conversation.id && <span className="mt-1 block text-xs font-semibold text-blue-700">Conversa atual</span>}</button></li>)}</ol></QueryState>
      </Section>
    </div>
  </aside>;
  return <>{<button type="button" aria-label="Fechar detalhes da conversa" onClick={onClose} className="absolute inset-0 z-40 bg-slate-950/20 min-[1280px]:hidden" />}{panel}</>;
}
