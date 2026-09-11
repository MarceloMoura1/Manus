import { expect, test, type Page } from "@playwright/test";

const session = {
  clientId: "attendance-theme",
  company: "Atendimento Theme",
  permissions: ["conversations", "active-attendance"],
  userName: "Agente Theme",
  userEmail: "theme@example.test",
  userRole: "agent",
  modules: ["conversations"],
  expiresAt: Date.now() + 3_600_000,
};

const conversation = {
  id: "attendance-theme-conversation",
  publicCode: "CV-THEME-001",
  contactId: "attendance-theme-contact",
  crmClientId: null,
  customerName: "Cliente Theme",
  customerPhone: "5511999999999",
  companyText: null,
  companyName: null,
  lastMessage: "Mensagem de teste",
  lastMessageAt: new Date().toISOString(),
  unreadCount: 0,
  status: "open",
  assignedUserId: "attendance-theme-agent",
  assignedUserName: "Agente Theme",
  lastMessageFrom: "customer",
  provider: "evolution",
  channel: "whatsapp",
};

async function prepareAttendance(page: Page) {
  await page.addInitScript(value => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(value));
    localStorage.setItem("megadesk_active_page_v1", "conversations");
    localStorage.setItem("megadesk_theme", "light");
  }, session);

  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(url.pathname)
      .replace(/^.*\/api\/trpc\//, "")
      .split(",");
    const response = (procedure: string): unknown => {
      if (procedure.includes("refreshSession")) return { ok: true, session };
      if (procedure.includes("conversations.list")) return [conversation];
      if (procedure.includes("conversations.counts")) return { active: 1, closed: 0, waiting: 0, mine: 0 };
      if (procedure.includes("conversations.messages")) return { source: "normalized", messages: [], events: [] };
      if (procedure.includes("conversations.eligibleUsers")) return [];
      if (procedure.includes("conversations.phoneCandidates")) return { items: [] };
      if (procedure.includes("conversations.companyCandidates")) return { items: [], hasMore: false };
      if (procedure.includes("conversations.history")) return { items: [], hasMore: false };
      if (procedure.includes("conversations.linkedTickets")) return [];
      if (procedure.includes("evolution.getStatus")) return { status: "connected", providerReachable: true };
      if (procedure.includes("megadesk.attendanceRecipient")) return { canonicalPhone: "", candidates: [], activeConversation: null };
      return { ok: true };
    };
    const body = procedures.map(procedure => ({ result: { data: { json: response(procedure) } } }));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(url.searchParams.get("batch") === "1" ? body : body[0]),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("attendance-workspace")).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
}

async function backgroundColor(page: Page, selector: string) {
  return page.locator(selector).evaluate(element => getComputedStyle(element).backgroundColor);
}

test("Atendimento follows the real sidebar toggle without reload even when browser preference is dark", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await prepareAttendance(page);

  await expect(page.getByTestId("attendance-workspace")).toHaveAttribute("data-theme", "light");
  const workspaceLight = await backgroundColor(page, '[data-testid="attendance-workspace"]');
  const panelLight = await backgroundColor(page, '[data-testid="conversation-list-panel"]');
  await page.getByRole("button", { name: /Cliente Theme/ }).click();
  await page.getByRole("button", { name: "Abrir detalhes da conversa" }).click();
  const details = page.getByTestId("conversation-details-panel");
  await expect(details).toBeVisible();
  const originalUrl = page.url();
  const detailsLight = await backgroundColor(page, '[data-testid="conversation-details-panel"]');

  await page.getByTitle("Mudar para modo escuro").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("attendance-workspace")).toHaveAttribute("data-theme", "dark");
  await expect(details).toHaveAttribute("data-theme", "dark");
  await expect(page).toHaveURL(originalUrl);
  await expect(details).toBeVisible();
  const workspaceDark = await backgroundColor(page, '[data-testid="attendance-workspace"]');
  const panelDark = await backgroundColor(page, '[data-testid="conversation-list-panel"]');
  const filterDark = await backgroundColor(page, '[data-testid="attendance-primary-controls"] button');
  const newAttendanceControlDark = await backgroundColor(page, '[data-testid="attendance-action-controls"] button:first-child');
  const inactiveScopeDark = await backgroundColor(page, '[data-testid="attendance-scope-controls"] button:nth-child(2)');
  const activeScopeDark = await backgroundColor(page, '[data-testid="attendance-scope-controls"] button[aria-pressed="true"]');
  const detailsDark = await backgroundColor(page, '[data-testid="conversation-details-panel"]');
  const approvedDarkWorkspace = "oklch(0.129 0.042 264.695)";
  const approvedDarkListPanel = "oklch(0.208 0.042 265.755)";
  expect(workspaceDark).toBe(approvedDarkWorkspace);
  expect(panelDark).toBe(approvedDarkListPanel);
  expect(panelDark).not.toBe(workspaceDark);
  expect(filterDark).not.toBe(panelDark);
  expect(newAttendanceControlDark).not.toBe(panelDark);
  expect(inactiveScopeDark).not.toBe(panelDark);
  expect(activeScopeDark).not.toBe(inactiveScopeDark);
  expect(detailsDark).not.toBe(detailsLight);
  await expect(page.getByRole("button", { name: "Todos" })).toHaveClass(/bg-sky-500/);
  await expect(page.getByTestId("attendance-action-controls").getByRole("button", { name: "Encerradas" })).not.toHaveClass(/bg-violet-600/);
  await page.getByRole("button", { name: "Encerradas" }).click();
  await expect(page.getByRole("button", { name: "Encerradas" })).toHaveClass(/bg-red-600/);
  await page.getByRole("button", { name: "Novo atendimento", exact: true }).click();
  await expect(page.getByRole("button", { name: "Novo atendimento", exact: true })).toHaveClass(/bg-blue-800/);

  await page.getByTitle("Mudar para modo claro").click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.getByTestId("attendance-workspace")).toHaveAttribute("data-theme", "light");
  await expect(details).toHaveAttribute("data-theme", "light");
  expect(await backgroundColor(page, '[data-testid="attendance-workspace"]')).toBe(workspaceLight);
  expect(await backgroundColor(page, '[data-testid="conversation-list-panel"]')).toBe(panelLight);
  expect(await backgroundColor(page, '[data-testid="attendance-primary-controls"] button')).not.toBe(filterDark);
  expect(await backgroundColor(page, '[data-testid="attendance-action-controls"] button:first-child')).not.toBe(newAttendanceControlDark);
  expect(await backgroundColor(page, '[data-testid="attendance-scope-controls"] button:nth-child(2)')).not.toBe(inactiveScopeDark);
  expect(await backgroundColor(page, '[data-testid="conversation-details-panel"]')).toBe(detailsLight);

  await page.getByRole("button", { name: "Novo atendimento", exact: true }).click();
  const newAttendance = page.getByTestId("new-attendance-flow");
  await expect(newAttendance).toBeVisible();
  const newAttendanceLight = await backgroundColor(page, '[data-testid="new-attendance-flow"]');

  await page.getByTitle("Mudar para modo escuro").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(newAttendance).toHaveAttribute("data-theme", "dark");
  await expect(newAttendance).toBeVisible();
  const newAttendanceDark = await backgroundColor(page, '[data-testid="new-attendance-flow"]');
  expect(newAttendanceDark).not.toBe(newAttendanceLight);

  await page.getByTitle("Mudar para modo claro").click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(newAttendance).toHaveAttribute("data-theme", "light");
  expect(await backgroundColor(page, '[data-testid="new-attendance-flow"]')).toBe(newAttendanceLight);
});
