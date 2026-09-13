import { expect, test, type Page } from "@playwright/test";

const session = {
  clientId: "tenant-detail",
  company: "Tenant Detail",
  permissions: ["chamados"],
  userName: "Agente Detail",
  userEmail: "agent@example.invalid",
  userRole: "agent",
  modules: ["chamados"],
  expiresAt: Date.now() + 3_600_000,
};

const ticket = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 42,
  customerId: "crm-customer",
  customerName: "Snapshot antigo",
  customerPhone: null,
  customerEmail: null,
  customerCNPJ: null,
  company: "Empresa antiga",
  title: "Falha de acesso",
  observations: "Mensagem inicial preservada",
  assignedTo: "Agente Detail",
  assignedToUserId: "operator-detail",
  collaborators: [{ userId: "operator-two", userName: "Agente Dois" }],
  priority: "alta",
  status: "open",
  createdAt: "2026-09-12T10:00:00.000Z",
  activities: [],
};

const canonicalCustomer = {
  id: "crm-customer",
  type: "company",
  name: "Empresa Canônica Ltda",
  document: "12345678000190",
  phone: "11999999999",
  email: "cliente@example.invalid",
  source: "erp",
};

const result = (json: unknown) => ({ result: { data: { json } } });

async function prepareDetail(page: Page) {
  await page.addInitScript(value => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(value));
    localStorage.setItem("megadesk_active_page_v1", "tickets");
    localStorage.setItem("megadesk_theme", "light");
  }, session);

  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(url.pathname).replace(/^.*\/api\/trpc\//, "").split(",");
    const batch = url.searchParams.get("batch") === "1";
    const payloads = procedures.map(procedure => {
      if (procedure.includes("megadesk.refreshSession")) return result({ ok: true, session });
      if (procedure.includes("chamados.list")) return result({ chamados: [ticket], total: 1, limit: 20, offset: 0 });
      if (procedure.includes("chamados.getDetail")) return result({ chamado: { ...ticket, customer: canonicalCustomer } });
      if (procedure.includes("chamados.getStatusCounts")) return result({ total: 1, open: 1, in_progress: 0, waiting: 0, closed: 0 });
      if (procedure.includes("chamados.getCollaborators")) return result({ collaborators: ticket.collaborators });
      if (procedure.includes("megadeskSettings.listTicketStatuses")) return result([]);
      if (procedure.includes("megadesk.getClientUsers")) return result([]);
      return result({ ok: true });
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(batch ? payloads : payloads[0]),
    });
  });
}

test("ticket detail loads canonical ERP customer and stays after the desktop sidebar", async ({ page }) => {
  await prepareDetail(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("tbody").getByText("Snapshot antigo", { exact: true }).click();

  const detail = page.getByTestId("ticket-detail-shell");
  const sidebar = page.getByLabel("Menu principal", { exact: true });
  await expect(detail).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("heading", { name: "#0042 · Empresa Canônica Ltda" })).toBeVisible();
  await expect(page.getByText("12345678000190", { exact: true })).toBeVisible();
  await expect(page.getByText("11999999999", { exact: true })).toBeVisible();
  await expect(page.getByText("cliente@example.invalid", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Histórico do Chamado" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Detalhes do Chamado" })).toBeVisible();
  await expect(page.getByText("Nenhuma atividade registrada ainda.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Encerrar Chamado", exact: true })).toBeVisible();

  const boxes = await Promise.all([sidebar.boundingBox(), detail.boundingBox()]);
  expect(boxes[0]).not.toBeNull();
  expect(boxes[1]).not.toBeNull();
  expect(boxes[1]!.x).toBeGreaterThanOrEqual(boxes[0]!.x + boxes[0]!.width - 1);
  await expect(detail).toHaveCSS("position", "absolute");

  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(page.getByTestId("ticket-detail-shell")).toHaveCount(0);

  await page.locator("tbody").getByText("Snapshot antigo", { exact: true }).click();
  await expect(page.getByTestId("ticket-detail-shell")).toBeVisible();
  await sidebar.getByTitle("Home").click();
  await expect(page.getByTestId("ticket-detail-shell")).toHaveCount(0);
});

test("ticket detail keeps mobile navigation available and stacks its content", async ({ page }) => {
  await prepareDetail(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("tbody").getByText("Snapshot antigo", { exact: true }).click();

  const detail = page.getByTestId("ticket-detail-shell");
  await expect(detail).toBeVisible();
  const detailBox = await detail.boundingBox();
  expect(detailBox).not.toBeNull();
  expect(detailBox!.x).toBeGreaterThanOrEqual(0);
  expect(detailBox!.x + detailBox!.width).toBeLessThanOrEqual(390);

  await detail.getByRole("button", { name: "Abrir menu principal" }).click();
  await expect(page.getByLabel("Menu principal", { exact: true })).toBeVisible();
});
