import { expect, test, type Page } from "@playwright/test";

const session = {
  clientId: "tickets-customer-tenant",
  company: "Tenant controlado",
  permissions: ["chamados"],
  userName: "Operadora Teste",
  userEmail: "operadora@example.invalid",
  userRole: "agent",
  modules: ["chamados"],
  expiresAt: Date.now() + 3_600_000,
};

const customers = [
  { id: "crm-person", type: "person", name: "Maria Souza", responsibleName: "", document: "52998224725", phone: "11999999999" },
  { id: "crm-company", type: "company", name: "ACME Tecnologia Ltda", responsibleName: "Bruno Lima", document: "12345678000190", phone: "1133334444" },
];

const result = (json: unknown) => ({ result: { data: { json } } });

function inputAt(raw: unknown, index: number, batch: boolean): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  if (batch) return (raw as Record<string, { json?: Record<string, unknown> }>)[String(index)]?.json ?? {};
  return (raw as { json?: Record<string, unknown> }).json ?? raw as Record<string, unknown>;
}

async function prepare(page: Page, createdInputs: Array<Record<string, unknown>>) {
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
    try { parsedInput = JSON.parse(rawInput); } catch { /* fixture controlada */ }

    const payloads = procedures.map((procedure, index) => {
      const input = inputAt(parsedInput, index, batch);
      if (procedure.includes("megadesk.refreshSession")) return result({ ok: true, session });
      if (procedure.includes("chamados.list")) return result({ chamados: [], total: 0, limit: 20, offset: 0 });
      if (procedure.includes("chamados.getStatusCounts")) return result({ total: 0, open: 0, in_progress: 0, waiting: 0, closed: 0 });
      if (procedure.includes("chamados.searchCustomers")) {
        const query = String(input.query ?? "").replace(/\D/g, "").length >= 10
          ? String(input.query ?? "").replace(/\D/g, "")
          : String(input.query ?? "").toLocaleLowerCase();
        const matches = customers.filter(customer => [customer.name.toLocaleLowerCase(), customer.document, customer.phone.replace(/\D/g, "")]
          .some(value => value.includes(query)));
        return result({ customers: matches });
      }
      if (procedure.includes("chamados.create")) {
        createdInputs.push(input);
        return result({ chamado: { id: "ticket-created", number: 77 }, message: "Chamado #77 criado com sucesso" });
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

test("Novo Chamado selects one canonical ERP customer and submits only its ID", async ({ page }) => {
  const createdInputs: Array<Record<string, unknown>> = [];
  await prepare(page, createdInputs);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Novo Chamado", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Novo Chamado" });
  const customer = dialog.getByRole("combobox", { name: /Cliente/ });
  const create = dialog.getByRole("button", { name: /Criar Chamado/ });
  await expect(customer).toHaveAttribute("placeholder", "Buscar cliente por nome, CPF/CNPJ, telefone...");
  await expect(dialog.getByText("Empresa", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Nome do Cliente", { exact: true })).toHaveCount(0);
  await expect(create).toBeDisabled();

  await customer.fill("Maria");
  await expect(dialog.getByRole("option", { name: /Maria Souza/ })).toContainText("52998224725");
  await customer.fill("12345678000190");
  await expect(dialog.getByRole("option", { name: /ACME Tecnologia Ltda/ })).toContainText("1133334444");
  await customer.fill("1133334444");
  await expect(dialog.getByRole("option", { name: /ACME Tecnologia Ltda/ })).toBeVisible();
  await customer.fill("cliente inexistente");
  await expect(dialog.getByText("Nenhum cliente encontrado. Cadastre o cliente em ERP > Clientes para abrir o chamado.")).toBeVisible();

  await customer.fill("ACME");
  await dialog.getByRole("option", { name: /ACME Tecnologia Ltda/ }).click();
  await expect(customer).toHaveValue("ACME Tecnologia Ltda");
  await expect(create).toBeEnabled();
  await dialog.getByPlaceholder("Ex: Problema com login").fill("Falha no acesso ao portal");
  await create.click();

  await expect.poll(() => createdInputs.length).toBe(1);
  expect(createdInputs[0]).toMatchObject({ customerId: "crm-company", title: "Falha no acesso ao portal", priority: "media" });
  expect(createdInputs[0]).not.toHaveProperty("customerName");
  expect(createdInputs[0]).not.toHaveProperty("company");
  expect(createdInputs[0]).not.toHaveProperty("customerCNPJ");
});

test("Novo Chamado remains inside a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, []);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Novo Chamado", exact: true }).click();
  const box = await page.getByRole("dialog", { name: "Novo Chamado" }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
