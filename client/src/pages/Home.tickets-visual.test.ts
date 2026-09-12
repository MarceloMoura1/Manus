import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/contexts/ThemeContext";

const ticketState = vi.hoisted(() => ({
  tickets: [] as Array<Record<string, unknown>>,
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
      useUtils: () => ({ chamados: { list: { invalidate }, getStatusCounts: { invalidate } } }),
      chamados: {
        list: { useQuery: () => query({ chamados: ticketState.tickets, total: ticketState.tickets.length }) },
        getStatusCounts: { useQuery: () => query({ total: ticketState.tickets.length, open: 1, in_progress: 1, waiting: 0, closed: 0 }) },
        getCollaborators: { useQuery: () => query({ collaborators: [] }) },
        update: { useMutation: mutation },
        addActivity: { useMutation: mutation },
        editActivity: { useMutation: mutation },
        create: { useMutation: mutation },
        updateCollaborators: { useMutation: mutation },
        registerActivity: { useMutation: mutation },
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

import { TicketsPage } from "./Home";

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
});

describe("Chamados visual workspace", () => {
  it("restores the original light surfaces, card animation, search, table and pagination", () => {
    ticketState.tickets = [{
      id: "ticket-1",
      number: 42,
      customerName: "Cliente Exemplo",
      company: "Empresa Exemplo",
      title: "Solicitação de suporte",
      assignedTo: "Ana Operadora",
      status: "open",
      createdAt: "2026-09-12T10:00:00.000Z",
    }];

    const markup = renderTickets();

    expect(markup).toContain("Chamados:</label>");
    expect(markup).toContain("Novo Chamado");
    expect(markup).toContain("Cliente Exemplo");
    expect(markup).toContain("Solicitação de suporte");
    expect(markup).toContain("Abertos");
    expect(markup).toContain("from-slate-50 to-slate-100");
    expect(markup).toContain("from-blue-50 to-blue-100");
    expect(markup).toContain("from-amber-50 to-amber-100");
    expect(markup).toContain("from-orange-50 to-orange-100");
    expect(markup).toContain("from-emerald-50 to-emerald-100");
    expect(markup).toContain("hover:scale-102 hover:-translate-y-1");
    expect(markup).toContain("group-hover:scale-110");
    expect(markup).not.toContain("dark:from-slate-900");
    expect(markup).toContain("pl-10");
    expect(markup).toContain("bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2");
    expect(markup).toContain('class="bg-white rounded-lg border border-slate-200 overflow-hidden"');
    expect(markup).toContain('class="bg-slate-50 border-b border-slate-200"');
    expect(markup).toContain("px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700");
    expect(markup).toContain("flex items-center justify-between mt-6 px-6 py-4 bg-slate-50");
  });

  it("keeps the original empty state in the light table", () => {
    const markup = renderTickets();

    expect(markup).toContain("Nenhum chamado encontrado");
    expect(markup).toContain("px-4 py-8 text-center text-slate-500");
    expect(markup).not.toContain("Ajuste os filtros ou crie um novo chamado para começar.");
  });

  it("keeps the menu action local to the mobile Tickets header instead of mounting the shared topbar", () => {
    const markup = renderTickets(true);

    expect(markup).toContain('aria-label="Abrir menu principal"');
    expect(markup).toContain("lg:hidden");
    expect(markup).not.toContain('data-testid="module-topbar-shell"');
  });
});
