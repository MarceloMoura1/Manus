import { expect, test, type Page } from "@playwright/test";

const commercialClient = {
  crmClientId: "crm-11111111-1111-4111-8111-111111111111",
  companyName: "Cliente compartilhado",
  responsibleName: "Responsável",
  cpfCnpj: "12345678000190",
  phone: "11999990000",
  whatsapp: "11999990000",
  email: "cliente@example.invalid",
  address: "Rua Segura, 10",
  city: "São Paulo",
  state: "SP",
  cep: "01001000",
  status: "ativo",
  origin: "site",
  internalResponsible: "Gestor",
  tags: "prioritário",
  observations: "Fixture controlada",
  contactsJson: "[]",
  lastInteractionAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const result = (json: unknown) => ({ result: { data: { json } } });

async function prepare(page: Page, role: "admin" | "manager" | "agent" | "viewer" = "admin") {
  const allowed = role === "admin" || role === "manager";
  const refreshedSession = {
    company: "Tenant controlado",
    permissions: allowed ? ["clients"] : ["active-attendance"],
    userName: "Usuário controlado",
    userEmail: `${role}@example.invalid`,
    userRole: role,
    plan: "test",
    modules: allowed ? ["clients"] : ["active-attendance"],
    expiresAt: Date.now() + 3_600_000,
  };
  await page.addInitScript(({ selectedRole, canAccess }) => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify({
      clientId: "tenant-must-not-leave-browser",
      company: "Tenant controlado",
      permissions: canAccess ? ["clients"] : ["active-attendance"],
      userName: "Usuário controlado",
      userEmail: `${selectedRole}@example.invalid`,
      userRole: selectedRole,
      plan: "test",
      modules: canAccess ? ["clients"] : ["active-attendance"],
      expiresAt: Date.now() + 3_600_000,
    }));
  }, { selectedRole: role, canAccess: allowed });

  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(url.pathname).replace(/^.*\/api\/trpc\//, "").split(",");
    const response = (name: string) => name.includes("megadesk.refreshSession")
      ? { ok: true, session: refreshedSession }
      : name.includes("crm.list")
      ? { clients: [commercialClient] }
      : name.includes("crm.create")
        ? { success: true, crmClientId: commercialClient.crmClientId }
        : name.includes("crm.update") || name.includes("crm.addTimelineEntry")
          ? { success: true }
          : name.includes("crm.getTimeline")
            ? { entries: [] }
            : name.includes("crm.getChamados")
              ? { chamados: [{ id: "ticket-public", number: 101, customerName: commercialClient.responsibleName, company: commercialClient.companyName, title: "Chamado vinculado", status: "open", priority: "normal", createdAt: "2026-01-01" }] }
              : name.includes("crm.getConversas")
                ? { conversas: [{ id: "conversation-public", customerName: commercialClient.responsibleName, phone: commercialClient.phone, company: commercialClient.companyName, status: "open", lastMessage: "Olá", timeLabel: "agora", createdAt: "2026-01-01" }] }
                : name.includes("evolution.getStatus")
                  ? { status: "disconnected" }
                  : null;
    const payloads = procedures.map((name) => result(response(name)));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(url.searchParams.get("batch") === "1" ? payloads : payloads[0]),
    });
  });
}

test.describe("central Clients controlled", () => {
  test("opens the stable route and never sends the tenant in CRM input", async ({ page }) => {
    await prepare(page, "admin");
    const crmRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      const procedures = decodeURIComponent(url.pathname).replace(/^.*\/api\/trpc\//, "").split(",");
      const encodedInput = url.searchParams.get("input") ?? request.postData();
      if (!encodedInput) return;
      const input = JSON.parse(encodedInput);
      procedures.forEach((procedure, index) => {
        if (procedure.startsWith("crm.")) crmRequests.push(JSON.stringify(input[index] ?? input));
      });
    });
    await page.goto("/clientes");
    await expect(page).toHaveURL(/\/clientes$/);
    await expect(page.getByTestId("clients-page")).toBeVisible();
    await expect(page.getByText("Cliente compartilhado")).toBeVisible();
    expect(crmRequests.join("\n")).not.toContain("tenant-must-not-leave-browser");
    await expect(page.getByTitle("Excluir")).toHaveCount(0);
  });

  test("keeps manager write actions and supports history navigation", async ({ page }) => {
    await prepare(page, "manager");
    await page.goto("/");
    await page.getByTitle("Clientes").click();
    await expect(page).toHaveURL(/\/clientes$/);
    await expect(page.getByRole("button", { name: "Novo" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.goForward();
    await expect(page.getByTestId("clients-page")).toBeVisible();
  });

  for (const role of ["agent", "viewer"] as const) {
    test(`keeps Clients unavailable to ${role}`, async ({ page }) => {
      await prepare(page, role);
      await page.goto("/clientes");
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId("clients-page")).toHaveCount(0);
      await expect(page.getByTitle("Clientes")).toHaveCount(0);
    });
  }

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    test(`remains usable without horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await prepare(page, "admin");
      await page.goto("/clientes");
      await expect(page.getByTestId("clients-page")).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
