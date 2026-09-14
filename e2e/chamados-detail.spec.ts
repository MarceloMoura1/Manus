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
    {
      id: "activity-close",
      date: Date.UTC(2026, 8, 13, 14, 25, 0),
      description: "Chamado encerrado após validação.",
      attendant: "Sistema",
      actionType: "close",
    },
    {
      id: "activity-create",
      date: Date.UTC(2026, 8, 12, 10, 0, 0),
      description: "Chamado criado.",
      attendant: "Marcelo Moura",
      actionType: "register",
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

const replacementCustomer = {
  id: "crm-replacement",
  type: "person",
  name: "Marina Cliente",
  document: "52998224725",
  phone: "11977776666",
  email: "marina@example.invalid",
  source: "erp",
};

const result = (json: unknown) => ({ result: { data: { json } } });

async function expectOpaqueSurface(locator: ReturnType<Page["getByTestId"]>) {
  await expect(locator).toHaveCSS("opacity", "1");
  const backgroundColor = await locator.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(backgroundColor).toMatch(/^(rgb|oklch)\(/);
  expect(backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(backgroundColor).not.toContain("/ 0");
}

async function expectDetailWorkspaceToCover(detail: ReturnType<Page["getByTestId"]>, underlying: ReturnType<Page["locator"]>) {
  const covered = await underlying.evaluate(element => {
    const workspace = document.querySelector<HTMLElement>("[data-testid='ticket-detail-shell']");
    const bounds = element.getBoundingClientRect();
    if (!workspace || bounds.width === 0 || bounds.height === 0) return false;
    const topElement = document.elementFromPoint(bounds.left + Math.min(8, bounds.width / 2), bounds.top + Math.min(8, bounds.height / 2));
    return Boolean(topElement && workspace.contains(topElement));
  });

  await expect(detail).toBeVisible();
  expect(covered).toBe(true);
}

async function prepareDetail(page: Page) {
  let currentCollaborators = [...ticket.collaborators];
  let collaboratorUpdates = 0;
  let currentTicket: any = { ...ticket, activities: [...ticket.activities] };
  let currentCustomer: any = { ...canonicalCustomer };
  let currentAttachments: any[] = [];
  const updateRequests: string[] = [];

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
      if (procedure.includes("chamados.list")) return result({ chamados: [currentTicket], total: 1, limit: 20, offset: 0 });
      if (procedure.includes("chamados.getDetail")) return result({ chamado: { ...currentTicket, collaborators: currentCollaborators, customer: currentCustomer } });
      if (procedure.includes("chamados.getStatusCounts")) return result({ total: 1, open: 1, in_progress: 0, waiting: 0, closed: 0 });
      if (procedure.includes("chamados.getCollaborators")) return result({ collaborators: currentCollaborators });
      if (procedure.includes("chamados.getAttachments")) return result(currentAttachments);
      if (procedure.includes("chamados.searchCustomers")) return result({ customers: [replacementCustomer] });
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
        return result({ chamado: { ...currentTicket, collaborators: currentCollaborators }, message: "Colaboradores atualizados com sucesso" });
      }
      if (procedure.includes("chamados.update")) {
        updateRequests.push(route.request().postData() || "");
        currentTicket = {
          ...currentTicket,
          customerId: replacementCustomer.id,
          customerName: replacementCustomer.name,
          customerPhone: replacementCustomer.phone,
          customerEmail: replacementCustomer.email,
          customerCNPJ: replacementCustomer.document,
          company: replacementCustomer.name,
          title: "Título editado",
          observations: "Observação editada",
          priority: "media",
        };
        currentCustomer = { ...replacementCustomer };
        return result({ chamado: { ...currentTicket, collaborators: currentCollaborators, customer: currentCustomer }, message: "Chamado atualizado com sucesso" });
      }
      if (procedure.includes("chamados.registerActivity")) {
        currentTicket = {
          ...currentTicket,
          activities: [...currentTicket.activities, {
            id: "activity-new-note",
            date: Date.UTC(2026, 8, 13, 15, 0, 0),
            description: "Registro visual validado",
            attendant: session.userName,
            actionType: "note",
          }],
        };
        return result({ ok: true });
      }
      if (procedure.includes("chamados.uploadAttachment")) {
        currentAttachments = [{
          attachmentId: "22222222-2222-4222-8222-222222222222",
          fileName: "evidence.txt",
          fileSize: 17,
          mimeType: "text/plain",
          uploadedBy: session.userName,
          createdAt: "2026-09-13T15:10:00.000Z",
          state: "active",
          canView: true,
          legacy: false,
        }];
        currentTicket = {
          ...currentTicket,
          activities: [...currentTicket.activities, {
            id: "activity-attachment",
            date: Date.UTC(2026, 8, 13, 15, 10, 0),
            description: "Agente Detail anexou evidence.txt.",
            attendant: session.userName,
            actionType: "attachment_added",
            metadata: {
              eventType: "attachment_added",
              attachmentId: currentAttachments[0].attachmentId,
              fileName: currentAttachments[0].fileName,
              mimeType: currentAttachments[0].mimeType,
              size: currentAttachments[0].fileSize,
              sha256: "a".repeat(64),
            },
          }],
        };
        return result({
          success: true,
          attachmentId: currentAttachments[0].attachmentId,
          reused: false,
          chamado: currentTicket,
        });
      }
      return result({ ok: true });
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(batch ? payloads : payloads[0]),
    });
  });

  return { updateRequests };
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
  await expect(page.getByTestId("ticket-detail-status")).toContainText("Aberto");
  const header = page.getByTestId("ticket-detail-header");
  const customerCard = page.getByTestId("ticket-customer-card");
  const actionBar = page.getByTestId("ticket-action-bar");
  await expect(header.getByRole("button", { name: "Voltar", exact: true })).toBeVisible();
  await expect(header.getByTestId("ticket-status-control")).toContainText("Aberto");
  await expect(header.getByRole("button", { name: "Encerrar Chamado", exact: true })).toBeVisible();
  await expect(customerCard.getByTestId("ticket-customer-main-icon")).toBeVisible();
  await expect(customerCard.getByText("ERP", { exact: true })).toBeVisible();
  const customerBox = await customerCard.boundingBox();
  const customerIconBox = await customerCard.getByTestId("ticket-customer-main-icon").boundingBox();
  expect(customerBox).not.toBeNull();
  expect(customerIconBox).not.toBeNull();
  expect(customerBox!.height).toBeLessThanOrEqual(100);
  expect(customerIconBox!.width).toBeGreaterThanOrEqual(54);
  const customerDataTops = await customerCard.getByTestId("ticket-customer-data").locator(":scope > div").evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().top)));
  expect(new Set(customerDataTops).size).toBe(1);
  const visualActionOrder = await actionBar.locator("[data-action]").evaluateAll(elements => elements
    .map(element => ({ action: element.getAttribute("data-action"), left: element.getBoundingClientRect().left }))
    .sort((left, right) => left.left - right.left)
    .map(item => item.action));
  expect(visualActionOrder).toEqual(["status", "collaborators", "edit", "register", "forward", "attachments"]);
  await expect(actionBar).not.toContainText("Dossiê");
  await expect(page.getByTestId("ticket-attachments-action")).toBeEnabled();
  const actionHeights = await actionBar.locator("[data-action]").evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().height)));
  expect(new Set(actionHeights)).toEqual(new Set([58]));
  const separatorHeights = await actionBar.locator("[role='separator']").evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().height)));
  expect(separatorHeights).toHaveLength(6);
  expect(new Set(separatorHeights).size).toBe(1);
  const actionCenter = await page.getByTestId("ticket-edit-action").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return Math.round(bounds.top + bounds.height / 2);
  });
  const colabsCenter = await page.getByTestId("ticket-detail-collaborators").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return Math.round(bounds.top + bounds.height / 2);
  });
  expect(Math.abs(actionCenter - colabsCenter)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("ticket-detail-collaborators").getByTitle("Agente Dois")).toHaveText("AD");
  await expect(page.getByTestId("ticket-add-collaborator")).toBeVisible();
  await expectOpaqueSurface(detail);
  await expectOpaqueSurface(page.getByTestId("ticket-customer-card"));
  await expectOpaqueSurface(page.getByTestId("ticket-action-bar"));
  await expectOpaqueSurface(page.getByTestId("ticket-history-panel"));
  await expectOpaqueSurface(page.getByTestId("ticket-details-panel"));
  await expectOpaqueSurface(page.getByTestId("timeline-activity-surface-activity-note"));
  await expectOpaqueSurface(page.getByTestId("ticket-initial-message"));
  const whiteSurfaceColors = await Promise.all([
    page.getByTestId("ticket-customer-card"),
    page.getByTestId("ticket-action-bar"),
    page.getByTestId("ticket-history-panel"),
    page.getByTestId("ticket-details-panel"),
  ].map(locator => locator.evaluate(element => getComputedStyle(element).backgroundColor)));
  expect(new Set(whiteSurfaceColors).size).toBe(1);
  const eventAccentColors = await Promise.all([
    "activity-note",
    "activity-forward",
    "activity-close",
    "activity-create",
  ].map(id => page.getByTestId(`timeline-activity-header-${id}`).evaluate(element => getComputedStyle(element).backgroundColor)));
  expect(new Set(eventAccentColors).size).toBe(4);
  await expect(page.getByTestId("timeline-activity-header-activity-note").getByText("Nota", { exact: true })).toBeVisible();
  await expect(page.getByTestId("timeline-activity-header-activity-forward").getByText("Sistema", { exact: true })).toBeVisible();
  await expect(page.getByTestId("timeline-activity-header-activity-close").getByText("Sistema", { exact: true })).toBeVisible();
  await expect(page.getByTestId("timeline-activity-header-activity-create").getByText("Criação", { exact: true })).toBeVisible();
  await expectDetailWorkspaceToCover(detail, page.locator("tbody"));
  await expectDetailWorkspaceToCover(detail, page.getByText("Mostrando 1 a 1 de 1 chamados", { exact: true }));

  const boxes = await Promise.all([sidebar.boundingBox(), detail.boundingBox()]);
  expect(boxes[0]).not.toBeNull();
  expect(boxes[1]).not.toBeNull();
  expect(boxes[1]!.x).toBeGreaterThanOrEqual(boxes[0]!.x + boxes[0]!.width - 1);
  await expect(detail).toHaveCSS("position", "absolute");

  await page.getByTestId("ticket-status-action").click();
  await expect(page.getByRole("option", { name: "Em Progresso" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("ticket-edit-action").click();
  await expect(page.getByRole("heading", { name: "Editar Chamado" })).toBeVisible();
  await page.getByRole("heading", { name: "Editar Chamado" }).locator("..").getByRole("button").click();
  await page.getByTestId("ticket-register-action").click();
  await expect(page.getByRole("heading", { name: "Registrar Atividade" })).toBeVisible();
  await page.getByRole("heading", { name: "Registrar Atividade" }).locator("..").getByRole("button").click();
  await page.getByTestId("ticket-forward-action").click();
  await expect(page.getByRole("heading", { name: "Encaminhar Chamado" })).toBeVisible();
  await page.getByRole("heading", { name: "Encaminhar Chamado" }).locator("..").getByRole("button").click();
  await page.getByTestId("ticket-attachments-action").click();
  const attachmentModal = page.getByRole("dialog", { name: "Anexar arquivo" });
  await expect(attachmentModal).toBeVisible();
  await attachmentModal.getByTestId("ticket-attachment-file").setInputFiles({
    name: "evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("ticket evidence\n"),
  });
  await expect(attachmentModal.getByTestId("ticket-attachment-preview")).toContainText("evidence.txt");
  await attachmentModal.getByRole("button", { name: "Anexar", exact: true }).click();
  await expect(attachmentModal).toHaveCount(0);
  const attachment = page.getByTestId("ticket-attachments-list");
  await expect(attachment).toContainText("evidence.txt");
  await expect(attachment.getByTestId("ticket-attachment-view-22222222-2222-4222-8222-222222222222"))
    .toHaveAttribute("href", `/api/chamados/${ticket.id}/attachments/22222222-2222-4222-8222-222222222222/file`);
  await expect(page.getByTestId("timeline-activity-activity-attachment").getByRole("link", { name: "Visualizar arquivo" }))
    .toHaveAttribute("href", `/api/chamados/${ticket.id}/attachments/22222222-2222-4222-8222-222222222222/file`);

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
  const actionBar = page.getByTestId("ticket-action-bar");
  await expect(actionBar).toBeVisible();
  const mobileActions = await actionBar.locator("[data-action]").evaluateAll(elements => elements
    .map(element => ({ action: element.getAttribute("data-action"), left: element.getBoundingClientRect().left }))
    .sort((left, right) => left.left - right.left)
    .map(item => item.action));
  expect(mobileActions).toEqual(["status", "collaborators", "edit", "register", "forward", "attachments"]);
  expect(await actionBar.evaluate(element => element.scrollWidth >= element.clientWidth)).toBe(true);

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

test("ticket edit selects a canonical customer and never reveals collaborators after save", async ({ page }) => {
  const tracker = await prepareDetail(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("tbody").getByText("Snapshot antigo", { exact: true }).click();

  let mainFrameNavigations = 0;
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  // Reproduz o estado antigo que ficava escondido sob Editar.
  await page.getByTestId("ticket-manage-collaborators").click();
  await expect(page.getByRole("heading", { name: "Gerenciar Colaboradores" })).toBeVisible();
  await page.getByTestId("ticket-edit-action").click();

  await expect(page.getByRole("heading", { name: "Gerenciar Colaboradores" })).toHaveCount(0);
  const editModal = page.getByTestId("ticket-edit-modal");
  const customerInput = editModal.getByRole("combobox", { name: "Cliente" });
  await expect(customerInput).toHaveValue("Empresa Canônica Ltda");
  await customerInput.fill("Marina");
  await page.getByRole("option", { name: /Marina Cliente/ }).click();
  await editModal.getByLabel("Título", { exact: true }).fill("Título editado");
  await editModal.getByLabel("Observações", { exact: true }).fill("Observação editada");
  await editModal.getByRole("button", { name: /Salvar/ }).click();

  await expect(page.getByTestId("ticket-edit-modal")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gerenciar Colaboradores" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "#0042 · Marina Cliente" })).toBeVisible();
  await expect(page.getByText("52998224725", { exact: true })).toBeVisible();
  await expect(page.getByText("11977776666", { exact: true })).toBeVisible();
  await expect(page.getByText("marina@example.invalid", { exact: true })).toBeVisible();
  expect(tracker.updateRequests.join("\n")).toContain('"customerId":"crm-replacement"');
  expect(tracker.updateRequests.join("\n")).not.toContain("clientName");
  expect(mainFrameNavigations).toBe(0);

  await page.getByTestId("ticket-manage-collaborators").click();
  await expect(page.getByRole("heading", { name: "Gerenciar Colaboradores" })).toBeVisible();
});

test("ticket edit customer selector remains usable on mobile", async ({ page }) => {
  await prepareDetail(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("tbody").getByText("Snapshot antigo", { exact: true }).click();
  await page.getByTestId("ticket-edit-action").click();

  const modal = page.getByTestId("ticket-edit-modal");
  const input = modal.getByRole("combobox", { name: "Cliente" });
  await expect(modal).toBeVisible();
  const modalBox = await modal.boundingBox();
  expect(modalBox).not.toBeNull();
  expect(modalBox!.x).toBeGreaterThanOrEqual(0);
  expect(modalBox!.x + modalBox!.width).toBeLessThanOrEqual(390);

  await input.fill("Marina");
  await expect(page.getByRole("option", { name: /Marina Cliente/ })).toBeVisible();
  await page.getByRole("option", { name: /Marina Cliente/ }).click();
  await expect(input).toHaveValue("Marina Cliente");

  await modal.getByRole("button", { name: "Fechar edição do chamado" }).click();
  await page.getByTestId("ticket-register-action").click();
  const registerModal = page.getByTestId("register-activity-modal");
  await expect(registerModal).toBeVisible();
  const registerBox = await registerModal.boundingBox();
  expect(registerBox).not.toBeNull();
  expect(registerBox!.x).toBeGreaterThanOrEqual(0);
  expect(registerBox!.x + registerBox!.width).toBeLessThanOrEqual(390);
  expect(registerBox!.height).toBeLessThanOrEqual(844);
  await expect(registerModal.getByRole("button", { name: "Registrar", exact: true })).toBeVisible();
  await expect(registerModal.getByRole("button", { name: "Cancelar", exact: true })).toBeVisible();
});

test("register activity modal has light computed surfaces and preserves its complete flow", async ({ page }) => {
  await prepareDetail(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("tbody").getByText("Snapshot antigo", { exact: true }).click();
  await page.getByTestId("ticket-register-action").click();

  const backdrop = page.getByTestId("register-activity-backdrop");
  const modal = page.getByTestId("register-activity-modal");
  const textarea = page.getByTestId("register-activity-description");
  await expect(modal).toBeVisible();
  const colors = await Promise.all([
    backdrop.evaluate(element => getComputedStyle(element).backgroundColor),
    modal.evaluate(element => getComputedStyle(element).backgroundColor),
    textarea.evaluate(element => getComputedStyle(element).backgroundColor),
    textarea.evaluate(element => getComputedStyle(element).color),
    textarea.evaluate(element => getComputedStyle(element, "::placeholder").color),
  ]);
  expect(colors[0]).not.toBe("rgb(0, 0, 0)");
  expect(colors[0]).not.toBe("rgba(0, 0, 0, 1)");
  expect(colors[1]).toBe("rgb(255, 255, 255)");
  expect(colors[2]).toBe("rgb(255, 255, 255)");
  expect(colors[3]).not.toBe("rgb(255, 255, 255)");
  expect(colors[4]).not.toBe(colors[2]);

  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByTestId("ticket-register-action").click();
  await page.getByRole("button", { name: "Fechar registro de atividade" }).click();
  await expect(modal).toHaveCount(0);
  await page.getByTestId("ticket-register-action").click();
  await textarea.fill("Registro visual validado");
  await modal.getByRole("button", { name: "Registrar", exact: true }).click();

  await expect(modal).toHaveCount(0);
  await expect(page.getByText("Registro visual validado", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Agente Detail", { exact: true }).first()).toBeVisible();
});
