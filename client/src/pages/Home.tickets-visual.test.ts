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

function renderTickets(theme: "light" | "dark", withMobileMenu = false) {
  localStorage.setItem("megadesk_theme", theme);
  return renderToStaticMarkup(
    React.createElement(ThemeProvider, { defaultTheme: theme }, React.createElement(TicketsPage, withMobileMenu ? { onOpenMobileMenu: () => undefined } : undefined)),
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
  it("renders compact controls, five status cards and one structural table card", () => {
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

    const markup = renderTickets("light");

    expect(markup).toContain("Chamados:</label>");
    expect(markup).toContain("Novo Chamado");
    expect(markup).toContain("Cliente Exemplo");
    expect(markup).toContain("Solicitação de suporte");
    expect(markup).toContain("Abertos");
    expect(markup.match(/aria-pressed=/g)).toHaveLength(5);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("min-h-[138px]");
    expect(markup).toContain("h-12 rounded-xl border-slate-200");
    expect(markup).toContain("h-12 rounded-xl bg-blue-600");
    expect(markup).toContain("rounded-full px-3 py-1.5");
    const surfaceStart = markup.indexOf('<section data-testid="tickets-table-surface"');
    const surfaceEnd = markup.indexOf("</section>", surfaceStart);
    const footerStart = markup.indexOf('<footer data-testid="tickets-pagination-footer"');
    expect(surfaceStart).toBeGreaterThanOrEqual(0);
    expect(footerStart).toBeGreaterThan(surfaceStart);
    expect(footerStart).toBeLessThan(surfaceEnd);
    expect(markup.match(/data-testid="tickets-table-surface"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="tickets-pagination-footer"/g)).toHaveLength(1);

    const lightFooterClasses = markup.match(/<footer data-testid="tickets-pagination-footer" class="([^"]+)"/)?.[1] ?? "";
    expect(lightFooterClasses).toContain("border-slate-200 bg-white");
    expect(lightFooterClasses).not.toMatch(/bg-slate-(800|900)/);

    const selectedCardClasses = markup.match(/<button[^>]*aria-pressed="true"[^>]*class="([^"]+)"/)?.[1] ?? "";
    expect(selectedCardClasses).toContain("ring-1");
    expect(selectedCardClasses).not.toContain("ring-2");
    expect(selectedCardClasses).not.toContain("border-slate-400");
  });

  it("renders the refined empty state and local light/dark variants", () => {
    const lightMarkup = renderTickets("light");
    const darkMarkup = renderTickets("dark");

    expect(lightMarkup).toContain("Chamados:</label>");
    expect(darkMarkup).toContain("Chamados:</label>");
    expect(lightMarkup).toContain("Nenhum chamado encontrado");
    expect(lightMarkup).toContain("Ajuste os filtros ou crie um novo chamado para começar.");
    const lightFooterClasses = lightMarkup.match(/<footer data-testid="tickets-pagination-footer" class="([^"]+)"/)?.[1] ?? "";
    expect(lightFooterClasses).toBe("");

    ticketState.tickets = [{
      id: "ticket-dark",
      number: 43,
      customerName: "Cliente Escuro",
      company: "Empresa Escura",
      title: "Chamado escuro",
      assignedTo: "Ana Operadora",
      status: "open",
      createdAt: "2026-09-12T11:00:00.000Z",
    }];
    const darkTableMarkup = renderTickets("dark");
    const darkFooterClasses = darkTableMarkup.match(/<footer data-testid="tickets-pagination-footer" class="([^"]+)"/)?.[1] ?? "";
    expect(darkFooterClasses).toContain("border-slate-800 bg-slate-900");
  });

  it("keeps the menu action local to the mobile Tickets header instead of mounting the shared topbar", () => {
    const markup = renderTickets("light", true);

    expect(markup).toContain('aria-label="Abrir menu principal"');
    expect(markup).toContain("md:hidden");
    expect(markup).not.toContain('data-testid="module-topbar-shell"');
  });
});
