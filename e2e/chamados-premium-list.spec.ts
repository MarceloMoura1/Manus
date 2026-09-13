import { expect, test, type Page } from "@playwright/test";

const session = {
  clientId: "tickets-controlled-tenant",
  company: "Tenant Chamados",
  permissions: ["chamados"],
  userName: "Marcelo Operador",
  userEmail: "marcelo@example.invalid",
  userRole: "agent",
  modules: ["chamados"],
  expiresAt: Date.now() + 3_600_000,
};

const allTickets = [
  {
    id: "ticket-marcelo",
    number: 42,
    customerName: "Cliente Alpha",
    company: "Empresa Alpha",
    title: "Prioridade alta",
    assignedTo: "Marcelo Operador",
    assignedToUserId: "operator-marcelo",
    collaborators: [],
    priority: "alta",
    status: "open",
    createdAt: "2026-09-12T10:00:00.000Z",
  },
  {
    id: "ticket-collaborator",
    number: 43,
    customerName: "Cliente Beta",
    company: "Empresa Beta",
    title: "Colaborador canônico",
    assignedTo: "Outro Operador",
    assignedToUserId: "operator-other",
    collaborators: [{ userId: "operator-marcelo", userName: "Marcelo Operador" }],
    priority: "media",
    status: "waiting",
    createdAt: "2026-09-11T10:00:00.000Z",
  },
  {
    id: "ticket-future-active",
    number: 44,
    customerName: "Cliente Gamma",
    company: "Empresa Gamma",
    title: "Status ativo futuro",
    assignedTo: "Outro Operador",
    assignedToUserId: "operator-other",
    collaborators: [],
    priority: "baixa",
    status: "triage",
    createdAt: "2026-09-10T10:00:00.000Z",
  },
  {
    id: "ticket-closed-mine",
    number: 45,
    customerName: "Cliente Fechado Meu",
    company: "Empresa Encerrada Minha",
    title: "Chamado encerrado do operador",
    assignedTo: "Marcelo Operador",
    assignedToUserId: "operator-marcelo",
    collaborators: [],
    priority: "media",
    status: "closed",
    createdAt: "2026-09-09T10:00:00.000Z",
  },
  {
    id: "ticket-closed-other",
    number: 46,
    customerName: "Teste Cliente Fechado",
    company: "Empresa Encerrada",
    title: "Chamado encerrado de outro operador",
    assignedTo: "Outro Operador",
    assignedToUserId: "operator-other",
    collaborators: [],
    priority: "baixa",
    status: "closed",
    createdAt: "2026-09-08T10:00:00.000Z",
  },
  ...Array.from({ length: 20 }, (_, index) => ({
    id: `ticket-page-${index + 1}`,
    number: 100 + index,
    customerName: `Cliente Página ${String(index + 1).padStart(2, "0")}`,
    company: "Empresa Paginação",
    title: `Chamado ativo paginado ${index + 1}`,
    assignedTo: "Outro Operador",
    assignedToUserId: "operator-other",
    collaborators: [],
    priority: "media",
    status: index % 2 === 0 ? "open" : "in_progress",
    createdAt: `2026-08-${String(20 - index).padStart(2, "0")}T10:00:00.000Z`,
  })),
];

const result = (json: unknown) => ({ result: { data: { json } } });

function getInput(raw: unknown, index: number, batch: boolean): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  if (batch) {
    const entry = (raw as Record<string, { json?: Record<string, unknown> }>)[String(index)];
    return entry?.json ?? {};
  }
  const value = raw as { json?: Record<string, unknown> };
  return value.json ?? (raw as Record<string, unknown>);
}

async function prepareTickets(page: Page, listInputs: Array<Record<string, unknown>>, countScopes: string[]) {
  const ticketsState = allTickets.map(ticket => ({
    ...ticket,
    collaborators: ticket.collaborators.map(collaborator => ({ ...collaborator })),
  }));

  await page.addInitScript(value => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(value));
    localStorage.setItem("megadesk_active_page_v1", "tickets");
    localStorage.setItem("megadesk_theme", "light");
  }, session);

  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(url.pathname).replace(/^.*\/api\/trpc\//, "").split(",");
    const batch = url.searchParams.get("batch") === "1";
    const rawInput = url.searchParams.get("input") ?? route.request().postData() ?? "{}";
    let parsedInput: unknown = {};
    try { parsedInput = JSON.parse(rawInput); } catch { /* controlled empty fixture */ }

    const payloads = procedures.map((procedure, index) => {
      const input = getInput(parsedInput, index, batch);
      if (procedure.includes("megadesk.refreshSession")) return result({ ok: true, session });
      if (procedure.includes("chamados.list")) {
        listInputs.push(input);
        const mine = input.scope === "mine";
        const selectedStatus = String(input.status ?? "total");
        const search = String(input.search ?? "").trim().toLocaleLowerCase();
        const limit = Number(input.limit ?? 20);
        const offset = Number(input.offset ?? 0);
        const scoped = ticketsState.filter(ticket => !mine
          || ticket.assignedToUserId === "operator-marcelo"
          || ticket.collaborators.some(collaborator => collaborator.userId === "operator-marcelo"));
        const statusFiltered = scoped.filter(ticket => selectedStatus === "total"
          ? ticket.status !== "closed"
          : ticket.status === selectedStatus);
        const searched = search
          ? statusFiltered.filter(ticket => [ticket.customerName, ticket.company, ticket.title, String(ticket.number)]
            .some(value => value.toLocaleLowerCase().includes(search)))
          : statusFiltered;
        const chamados = searched.slice(offset, offset + limit);
        return result({ chamados, total: searched.length, limit, offset });
      }
      if (procedure.includes("chamados.getStatusCounts")) {
        countScopes.push(String(input.scope ?? "all"));
        const mine = input.scope === "mine";
        const scoped = ticketsState.filter(ticket => !mine
          || ticket.assignedToUserId === "operator-marcelo"
          || ticket.collaborators.some(collaborator => collaborator.userId === "operator-marcelo"));
        return result({
          total: scoped.filter(ticket => ticket.status !== "closed").length,
          open: scoped.filter(ticket => ticket.status === "open").length,
          in_progress: scoped.filter(ticket => ticket.status === "in_progress").length,
          waiting: scoped.filter(ticket => ticket.status === "waiting").length,
          closed: scoped.filter(ticket => ticket.status === "closed").length,
        });
      }
      if (procedure.includes("chamados.update")) {
        const ticket = ticketsState.find(candidate => candidate.id === input.chamadoId);
        if (ticket && typeof input.status === "string") ticket.status = input.status;
        return result({ ok: true });
      }
      if (procedure.includes("chamados.addActivity")) return result({ id: "activity-close" });
      if (procedure.includes("megadeskSettings.listTicketStatuses")) return result([]);
      return result({ ok: true });
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(batch ? payloads : payloads[0]),
    });
  });
}

test("Chamados keeps closed tickets out of Total across scope, search, sorting and pagination", async ({ page }) => {
  const listInputs: Array<Record<string, unknown>> = [];
  const countScopes: string[] = [];
  await prepareTickets(page, listInputs, countScopes);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ticket-scope-control")).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo Chamado" })).toBeVisible();

  const ticketTable = page.locator("tbody");
  const search = page.getByPlaceholder(/Buscar por nome/);
  await expect(ticketTable.getByText("Cliente Alpha", { exact: true })).toBeVisible();
  await expect(ticketTable.getByText("Cliente Fechado Meu", { exact: true })).toHaveCount(0);
  await expect(ticketTable.getByText("Teste Cliente Fechado", { exact: true })).toHaveCount(0);
  await expect(ticketTable.getByText("Cliente Gamma", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Total/ })).toContainText("23");
  await expect(page.getByRole("button", { name: /^Abertos/ })).toContainText("11");
  await expect(page.getByRole("button", { name: /^Em Progresso/ })).toContainText("10");
  await expect(page.getByRole("button", { name: /^Aguardando/ })).toContainText("1");
  await expect(page.getByRole("button", { name: /^Fechados/ })).toContainText("2");
  await expect.poll(() => listInputs.some(input => input.status === "total" && input.scope === "all" && input.sortBy === "createdAt" && input.sortDirection === "desc" && input.offset === 0)).toBe(true);
  await expect.poll(() => countScopes).toContain("all");

  await page.getByRole("button", { name: /Próximo/ }).click();
  await expect.poll(() => listInputs.some(input => input.status === "total" && input.offset === 20)).toBe(true);
  await expect(ticketTable.getByText("Cliente Fechado Meu", { exact: true })).toHaveCount(0);
  await expect(ticketTable.getByText("Teste Cliente Fechado", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "1", exact: true }).click();

  await page.getByRole("button", { name: "Meus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Meus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(ticketTable.getByText("Cliente Alpha", { exact: true })).toBeVisible();
  await expect(ticketTable.getByText("Cliente Beta", { exact: true })).toBeVisible();
  await expect(ticketTable.getByText("Cliente Gamma", { exact: true })).toHaveCount(0);
  await expect(ticketTable.getByText("Cliente Fechado Meu", { exact: true })).toHaveCount(0);
  await expect.poll(() => listInputs.some(input => input.status === "total" && input.scope === "mine")).toBe(true);
  await expect.poll(() => countScopes).toContain("mine");

  await page.getByRole("button", { name: /^Fechados/ }).click();
  await expect(ticketTable.getByText("Cliente Fechado Meu", { exact: true })).toBeVisible();
  await expect(ticketTable.getByText("Cliente Alpha", { exact: true })).toHaveCount(0);
  await expect(ticketTable.getByText("Teste Cliente Fechado", { exact: true })).toHaveCount(0);
  await search.fill("Cliente Fechado Meu");
  await expect(ticketTable.getByText("Cliente Fechado Meu", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Total/ }).click();
  await expect(ticketTable.getByText("Cliente Fechado Meu", { exact: true })).toHaveCount(0);
  await search.fill("");

  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await search.fill("Teste Cliente Fechado");
  await expect(ticketTable.getByText("Teste Cliente Fechado", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Fechados/ }).click();
  await expect(ticketTable.getByText("Teste Cliente Fechado", { exact: true })).toBeVisible();
  await search.fill("");
  await page.getByRole("button", { name: /^Total/ }).click();

  await ticketTable.getByText("Cliente Alpha", { exact: true }).click();
  await page.getByRole("button", { name: "Encerrar Chamado", exact: true }).click();
  await page.getByPlaceholder("Descreva como o chamado foi resolvido...").fill("Resolvido no teste controlado");
  await page.getByRole("button", { name: "Encerrar", exact: true }).click();
  await expect(ticketTable.getByText("Cliente Alpha", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Total/ })).toContainText("22");
  await expect(page.getByRole("button", { name: /^Fechados/ })).toContainText("3");
  await page.getByRole("button", { name: /^Fechados/ }).click();
  await expect(ticketTable.getByText("Cliente Alpha", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await page.getByRole("button", { name: /^Total/ }).click();

  const prioritySort = page.getByRole("button", { name: "Ordenar por Prioridade" });
  await prioritySort.click();
  await expect(page.getByRole("columnheader", { name: /Prioridade/ })).toHaveAttribute("aria-sort", "descending");
  await expect.poll(() => listInputs.some(input => input.sortBy === "priority" && input.sortDirection === "desc")).toBe(true);
  await prioritySort.click();
  await expect(page.getByRole("columnheader", { name: /Prioridade/ })).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => listInputs.some(input => input.sortBy === "priority" && input.sortDirection === "asc")).toBe(true);
});
