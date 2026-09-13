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
  activities: [
    {
      id: "activity-note",
      date: Date.UTC(2026, 8, 13, 14, 12, 0),
      description: "Lembra que eu comentei que o acesso voltou a funcionar?",
      attendant: "Marcelo Moura",
      actionType: "note",
    },
    {
      id: "activity-forward",
      date: Date.UTC(2026, 8, 13, 14, 20, 0),
      description: "Pedro Ferrari foi adicionado como participante.",
      attendant: "Marcelo Moura",
      actionType: "forward",
    },
  ],
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
  let currentCollaborators = [...ticket.collaborators];
  let collaboratorUpdates = 0;

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
      if (procedure.includes("chamados.getDetail")) return result({ chamado: { ...ticket, collaborators: currentCollaborators, customer: canonicalCustomer } });
      if (procedure.includes("chamados.getStatusCounts")) return result({ total: 1, open: 1, in_progress: 0, waiting: 0, closed: 0 });
      if (procedure.includes("chamados.getCollaborators")) return result({ collaborators: currentCollaborators });
      if (procedure.includes("megadeskSettings.listTicketStatuses")) return result([]);
      if (procedure.includes("megadesk.getClientUsers")) return result([
        { userId: "operator-two", name: "Agente Dois", email: "dois@example.invalid", role: "agent" },
        { userId: "operator-three", name: "Agente Três", email: "tres@example.invalid", role: "agent" },
      ]);
      if (procedure.includes("chamados.updateCollaborators")) {
        collaboratorUpdates += 1;
        currentCollaborators = collaboratorUpdates === 1
          ? [
              { userId: "operator-two", userName: "Agente Dois" },
              { userId: "operator-three", userName: "Agente Três" },
            ]
          : [{ userId: "operator-three", userName: "Agente Três" }];
        return result({ chamado: { ...ticket, collaborators: currentCollaborators }, message: "Colaboradores atualizados com sucesso" });
      }
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
  const note = page.getByTestId("timeline-activity-activity-note");
  await expect(note).toContainText("Lembra que eu comentei que o acesso voltou a funcionar?");
  await expect(note.getByTestId("timeline-activity-author-activity-note")).toHaveText("Marcelo Moura");
  await expect(note).not.toContainText(/registrou uma nota/i);
  await expect(note).not.toContainText(/^Atendente$/);
  await expect(page.getByTestId("timeline-activity-activity-forward")).toContainText("Marcelo Moura encaminhou o chamado.");
  await expect(page.getByTestId("timeline-activity-activity-forward")).toContainText("Pedro Ferrari foi adicionado como participante.");
  await expect(page.getByRole("button", { name: "Encerrar Chamado", exact: true })).toBeVisible();
  await expect(detail.locator("section[aria-labelledby='ticket-history-heading']").getByText("Mensagem Inicial", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("ticket-initial-message")).toHaveText("Mensagem inicial preservada");
  await expect(page.getByTestId("ticket-initial-message")).toHaveCSS("white-space", "pre-wrap");
  await expect(page.getByTestId("ticket-status-control")).toHaveAttribute("data-status", "open");
  await expect(page.getByTestId("ticket-status-control")).toHaveClass(/bg-blue-50/);
  await expect(page.getByTestId("ticket-detail-priority")).toHaveClass(/bg-red-50/);
  await expect(detail).toHaveClass(/bg-slate-100\/70/);
  await expect(page.getByTestId("ticket-customer-card")).toHaveClass(/bg-sky-50\/70/);
  await expect(page.getByTestId("ticket-action-bar")).toHaveClass(/bg-white\/70/);
  await expect(page.getByTestId("ticket-history-panel")).toHaveClass(/bg-sky-50\/35/);
  await expect(page.getByTestId("ticket-details-panel")).toHaveClass(/bg-slate-50\/80/);
  await expect(page.getByTestId("ticket-initial-message")).toHaveClass(/border-sky-100/);

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

test("ticket collaborators update in detail and toolbar without a reload", async ({ page }) => {
  await prepareDetail(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("tbody").getByText("Snapshot antigo", { exact: true }).click();

  let mainFrameNavigations = 0;
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  await expect(page.getByTestId("ticket-detail-participants")).toHaveText("Agente Dois");
  await expect(page.getByTestId("ticket-detail-collaborators")).toHaveText(/Colabs:/);

  await page.getByTestId("ticket-manage-collaborators").click();
  await page.getByLabel("Agente Três", { exact: true }).check();
  await page.getByRole("button", { name: /Salvar/ }).click();

  await expect(page.getByTestId("ticket-detail-participants")).toContainText("Agente Dois");
  await expect(page.getByTestId("ticket-detail-participants")).toContainText("Agente Três");
  await expect(page.getByTestId("ticket-detail-collaborators").getByTitle("Agente Três")).toBeVisible();

  await page.getByTestId("ticket-manage-collaborators").click();
  await page.getByLabel("Agente Dois", { exact: true }).uncheck();
  await page.getByRole("button", { name: /Salvar/ }).click();

  await expect(page.getByTestId("ticket-detail-participants")).toHaveText("Agente Três");
  await expect(page.getByTestId("ticket-detail-collaborators").getByTitle("Agente Dois")).toHaveCount(0);
  expect(mainFrameNavigations).toBe(0);
});
