import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/contexts/ThemeContext";

const ticketState = vi.hoisted(() => ({
  tickets: [] as Array<Record<string, unknown>>,
  statusCounts: { total: 0, open: 0, in_progress: 0, waiting: 0, closed: 0 },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { user: { id: "user-1", name: "Ana Operadora" } } }),
}));

vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ isPending: false, mutateAsync: async () => undefined });
  const invalidate = async () => undefined;
  const query = (data: unknown) => ({ data, isLoading: false, refetch: async () => ({ data }) });

  return {
    trpc: {
      useUtils: () => ({ chamados: { list: { invalidate }, getStatusCounts: { invalidate }, getDetail: { invalidate } } }),
      chamados: {
        list: { useQuery: () => query({ chamados: ticketState.tickets, total: ticketState.tickets.length }) },
        getDetail: { useQuery: () => query(undefined) },
        getStatusCounts: { useQuery: () => query(ticketState.statusCounts) },
        getCollaborators: { useQuery: () => query({ collaborators: [] }) },
        update: { useMutation: mutation },
        addActivity: { useMutation: mutation },
        editActivity: { useMutation: mutation },
        create: { useMutation: mutation },
        searchCustomers: { useQuery: () => ({ ...query({ customers: [] }), isFetching: false, isError: false }) },
        updateCollaborators: { useMutation: mutation },
        registerActivity: { useMutation: mutation },
        uploadAttachment: { useMutation: mutation },
        removeAttachment: { useMutation: mutation },
        getAttachments: { useQuery: () => query([]) },
      },
      megadesk: {
        getClientUsers: { useQuery: () => query([]) },
        searchCustomerByCompany: { fetch: async () => [] },
      },
      megadeskSettings: {
        listTicketStatuses: { useQuery: () => query([]) },
      },
    },
  };
});

import { activeTicketAttachments, filterTicketsByScope, getTicketAssignees, nextTicketSort, TicketAttachmentsPanel, TicketsPage } from "./Home";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function renderTickets(withMobileMenu = false) {
  localStorage.setItem("megadesk_theme", "light");
  return renderToStaticMarkup(
    React.createElement(ThemeProvider, { defaultTheme: "light" }, React.createElement(TicketsPage, withMobileMenu ? { onOpenMobileMenu: () => undefined } : undefined)),
  );
}

beforeEach(() => {
  const local = createStorage();
  const session = createStorage();
  Object.assign(globalThis, {
    localStorage: local,
    sessionStorage: session,
    window: {
      location: { search: "", hash: "", href: "http://localhost/", origin: "http://localhost", pathname: "/" },
      localStorage: local,
      sessionStorage: session,
    },
  });
  ticketState.tickets = [];
  ticketState.statusCounts = { total: 0, open: 0, in_progress: 0, waiting: 0, closed: 0 };
});

describe("Chamados visual workspace", () => {
  it("keeps the frozen light cards and pagination while rendering the premium ticket list", () => {
    ticketState.tickets = [{
      id: "ticket-1",
      number: 42,
      customerName: "Cliente Exemplo",
      company: "Empresa Exemplo",
      title: "Solicitação de suporte",
      assignedTo: "Cristiano Costa",
      assignedToUserId: "user-cristiano",
      collaborators: [
        { userId: "user-1", userName: "Ana Operadora" },
        { userId: "user-2", userName: "Marcelo Moura" },
      ],
      priority: "alta",
      status: "open",
      createdAt: "2026-09-12T10:00:00.000Z",
    }];
    ticketState.statusCounts = { total: 17, open: 8, in_progress: 4, waiting: 3, closed: 2 };

    const markup = renderTickets();

    expect(markup).not.toContain("Chamados:</label>");
    expect(markup).toContain('data-testid="ticket-scope-control"');
    expect(markup).toContain('aria-label="Escopo dos chamados"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Todos");
    expect(markup).toContain("Meus");
    expect(markup).toContain("Novo Chamado");
    expect(markup).toContain("Cliente Exemplo");
    expect(markup).toContain("Solicitação de suporte");
    expect(markup).toContain("Abertos");
    expect(markup).toContain(">17</p>");
    expect(markup).toContain(">8</p>");
    expect(markup).toContain(">4</p>");
    expect(markup).toContain(">3</p>");
    expect(markup).toContain(">2</p>");
    expect(markup).toContain("from-slate-50 to-slate-100");
    expect(markup).toContain("from-blue-50 to-blue-100");
    expect(markup).toContain("from-amber-50 to-amber-100");
    expect(markup).toContain("from-orange-50 to-orange-100");
    expect(markup).toContain("from-emerald-50 to-emerald-100");
    expect(markup).toContain("hover:scale-102 hover:-translate-y-1");
    expect(markup).toContain("group-hover:scale-110");
    expect(markup).not.toContain("dark:from-slate-900");
    expect(markup).toContain("h-11 rounded-[10px] border-slate-200 bg-white pl-10");
    expect(markup).toContain("h-11 rounded-[10px] bg-blue-600 px-4");
    expect(markup).toContain('class="overflow-hidden rounded-[14px] border border-slate-200/80 bg-white"');
    expect(markup).toContain('class="w-full min-w-[1080px] table-fixed"');
    expect(markup).toContain('class="border-b border-slate-200/80 bg-slate-50/70"');
    expect(markup).toContain("Nome e cliente");
    expect(markup).toContain("Prioridade");
    expect(markup).toContain("h-8 w-8 shrink-0");
    expect(markup).toContain(">CE</span>");
    expect(markup).toContain(">CC</span>");
    expect(markup).toContain(">AO</span>");
    expect(markup).toContain("Cristiano Costa +2");
    expect(markup).toContain("07:00");
    expect(markup).toContain("Alta");
    expect(markup).toContain("hover:bg-slate-50/70");
    expect(markup).toContain("border-blue-200/80 bg-blue-50 text-blue-700");
    expect(markup).toContain("flex items-center justify-between mt-6 px-6 py-4 bg-slate-50");
    expect(markup).toContain('aria-sort="descending"');
    expect(markup).toContain('aria-label="Ordenar por ID"');
  });

  it("keeps Todos and Meus tied only to canonical primary and collaborator IDs", () => {
    const tickets = [
      { id: "created", assignedTo: "Marcelo Moura", assignedToUserId: "user-1", collaborators: [] },
      { id: "transferred", assignedTo: "Marcelo Moura", assignedToUserId: "user-2", collaborators: [] },
      { id: "collaborative", assignedTo: "Ana Operadora", collaborators: [{ userId: "user-1", userName: "Marcelo Moura" }] },
      { id: "same-display-name", assignedTo: "Marcelo Moura", assignedToUserId: "user-3", collaborators: [] },
    ];

    expect(filterTicketsByScope(tickets, "all", "user-1").map(ticket => ticket.id))
      .toEqual(["created", "transferred", "collaborative", "same-display-name"]);
    expect(filterTicketsByScope(tickets, "mine", "user-1").map(ticket => ticket.id))
      .toEqual(["created", "collaborative"]);
    expect(filterTicketsByScope(tickets, "mine", "user-2").map(ticket => ticket.id))
      .toEqual(["transferred"]);
  });

  it("uses predictable initial direction and reverses each ticket table sort", () => {
    expect(nextTicketSort({ key: "createdAt", direction: "desc" }, "customer"))
      .toEqual({ key: "customer", direction: "asc" });
    expect(nextTicketSort({ key: "customer", direction: "asc" }, "customer"))
      .toEqual({ key: "customer", direction: "desc" });
    expect(nextTicketSort({ key: "customer", direction: "desc" }, "priority"))
      .toEqual({ key: "priority", direction: "desc" });
    for (const key of ["number", "createdAt", "customer", "title", "assignee", "priority", "status"] as const) {
      const initial = nextTicketSort({ key: "createdAt", direction: "desc" }, key);
      expect(nextTicketSort(initial, key).direction).not.toBe(initial.direction);
    }
  });

  it("renders the current primary attendant and compacts additional canonical collaborators", () => {
    expect(getTicketAssignees({ assignedTo: "Ana Operadora", assignedToUserId: "user-ana", collaborators: [] }))
      .toEqual([{ userId: "user-ana", userName: "Ana Operadora" }]);
    expect(getTicketAssignees({ assignedTo: "Cristiano Costa", collaborators: [] }))
      .toEqual([{ userId: "", userName: "Cristiano Costa" }]);
    expect(getTicketAssignees({
      assignedTo: "Marcelo Moura",
      collaborators: [
        { userId: "user-2", userName: "Cristiano Costa" },
        { userId: "user-3", userName: "Ana Operadora" },
      ],
    }).map(assignee => assignee.userName)).toEqual(["Marcelo Moura", "Cristiano Costa", "Ana Operadora"]);
  });

  it("keeps the original empty state in the light table", () => {
    const markup = renderTickets();

    expect(markup).toContain("Nenhum chamado encontrado");
    expect(markup).toContain('colSpan="7"');
    expect(markup).toContain("px-5 py-10 text-center text-sm text-slate-500");
    expect(markup).not.toContain("Ajuste os filtros ou crie um novo chamado para começar.");
  });

  it("keeps the menu action local to the mobile Tickets header instead of mounting the shared topbar", () => {
    const markup = renderTickets(true);

    expect(markup).toContain('aria-label="Abrir menu principal"');
    expect(markup).toContain("lg:hidden");
    expect(markup).not.toContain('data-testid="module-topbar-shell"');
  });

  it("shows only active attachments in the native consultation panel", () => {
    const attachments = [
      { attachmentId: "active-1", fileName: "contrato.pdf", fileSize: 2048, mimeType: "application/pdf", uploadedBy: "Ana", createdAt: "2026-09-13T12:00:00.000Z", state: "active", canView: true },
      { attachmentId: "staged-1", fileName: "staged.pdf", fileSize: 10, mimeType: "application/pdf", uploadedBy: "Ana", createdAt: "2026-09-13T12:00:00.000Z", state: "staged", canView: false },
      { attachmentId: "legacy-1", fileName: "legacy.pdf", fileSize: 10, mimeType: "application/pdf", uploadedBy: "Ana", createdAt: "2026-09-13T12:00:00.000Z", state: "legacy", canView: false },
      { attachmentId: "pending-1", fileName: "pending.pdf", fileSize: 10, mimeType: "application/pdf", uploadedBy: "Ana", createdAt: "2026-09-13T12:00:00.000Z", state: "pending_delete", canView: false },
      { attachmentId: "deleted-1", fileName: "deleted.pdf", fileSize: 10, mimeType: "application/pdf", uploadedBy: "Ana", createdAt: "2026-09-13T12:00:00.000Z", state: "deleted", canView: false },
    ] as const;
    expect(activeTicketAttachments(attachments).map(attachment => attachment.attachmentId)).toEqual(["active-1"]);

    const markup = renderToStaticMarkup(React.createElement(TicketAttachmentsPanel, {
      open: true,
      loading: false,
      chamadoId: "ticket-1",
      attachments,
      removing: false,
      onClose: () => undefined,
      onUpload: () => undefined,
      onRemove: () => undefined,
    }));

    expect(markup).toContain("Anexos do chamado");
    expect(markup).toContain("1 anexo ativo");
    expect(markup).toContain("contrato.pdf");
    expect(markup).not.toContain("staged.pdf");
    expect(markup).not.toContain("legacy.pdf");
    expect(markup).not.toContain("pending.pdf");
    expect(markup).not.toContain("deleted.pdf");
    expect(markup).toContain("/api/chamados/ticket-1/attachments/active-1/file");
    expect(markup).toContain("Visualizar");
    expect(markup).toContain("Anexar arquivo");
    expect(markup).toContain('data-testid="ticket-attachments-panel-close"');
  });

  it("renders loading and empty attachment panel states", () => {
    const loadingMarkup = renderToStaticMarkup(React.createElement(TicketAttachmentsPanel, {
      open: true, loading: true, chamadoId: "ticket-1", attachments: [], removing: false,
      onClose: () => undefined, onUpload: () => undefined, onRemove: () => undefined,
    }));
    const emptyMarkup = renderToStaticMarkup(React.createElement(TicketAttachmentsPanel, {
      open: true, loading: false, chamadoId: "ticket-1", attachments: [], removing: false,
      onClose: () => undefined, onUpload: () => undefined, onRemove: () => undefined,
    }));

    expect(loadingMarkup).toContain("Carregando anexos...");
    expect(emptyMarkup).toContain("Nenhum anexo neste chamado.");
  });
});
