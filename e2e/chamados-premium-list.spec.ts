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
    id: "ticket-other",
    number: 44,
    customerName: "Cliente Gamma",
    company: "Empresa Gamma",
    title: "Outro responsável",
    assignedTo: "Outro Operador",
    assignedToUserId: "operator-other",
    collaborators: [],
    priority: "baixa",
    status: "closed",
    createdAt: "2026-09-10T10:00:00.000Z",
  },
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
        const tickets = mine ? allTickets.filter(ticket => ticket.id !== "ticket-other") : allTickets;
        return result({ chamados: tickets, total: tickets.length, limit: input.limit ?? 20, offset: input.offset ?? 0 });
      }
      if (procedure.includes("chamados.getStatusCounts")) {
        countScopes.push(String(input.scope ?? "all"));
        return result(input.scope === "mine"
          ? { total: 2, open: 1, in_progress: 0, waiting: 1, closed: 0 }
          : { total: 3, open: 1, in_progress: 0, waiting: 1, closed: 1 });
      }
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

test("Chamados preserves the premium list while cards, scope and backend sorting stay operational", async ({ page }) => {
  const listInputs: Array<Record<string, unknown>> = [];
  const countScopes: string[] = [];
  await prepareTickets(page, listInputs, countScopes);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ticket-scope-control")).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo Chamado" })).toBeVisible();
  await expect(page.getByText("Cliente Alpha", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: /^Total/ })).toContainText("3");
  await expect(page.getByRole("button", { name: /^Abertos/ })).toContainText("1");
  await expect(page.getByRole("button", { name: /^Aguardando/ })).toContainText("1");
  await expect(page.getByRole("button", { name: /^Fechados/ })).toContainText("1");
  await expect.poll(() => listInputs.some(input => input.scope === "all" && input.sortBy === "createdAt" && input.sortDirection === "desc")).toBe(true);
  await expect.poll(() => countScopes).toContain("all");

  await page.getByRole("button", { name: "Meus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Meus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Cliente Alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("Cliente Beta", { exact: true })).toBeVisible();
  await expect(page.getByText("Cliente Gamma", { exact: true })).toHaveCount(0);
  await expect.poll(() => listInputs.some(input => input.scope === "mine")).toBe(true);
  await expect.poll(() => countScopes).toContain("mine");

  const prioritySort = page.getByRole("button", { name: "Ordenar por Prioridade" });
  await prioritySort.click();
  await expect(page.getByRole("columnheader", { name: /Prioridade/ })).toHaveAttribute("aria-sort", "descending");
  await expect.poll(() => listInputs.some(input => input.sortBy === "priority" && input.sortDirection === "desc")).toBe(true);
  await prioritySort.click();
  await expect(page.getByRole("columnheader", { name: /Prioridade/ })).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => listInputs.some(input => input.sortBy === "priority" && input.sortDirection === "asc")).toBe(true);
});
