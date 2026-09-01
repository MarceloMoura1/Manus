import { expect, test, type Page } from "@playwright/test";

type Item = {
  notificationId: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error" | "system";
  isRead: boolean;
  actionUrl: string | null;
  createdAt: string;
};

const result = (json: unknown) => ({ result: { data: { json } } });

function requestInput(payload: any, index: number): Record<string, unknown> {
  return payload?.[String(index)]?.json ?? payload?.json?.[String(index)] ?? payload?.json ?? {};
}

async function prepare(page: Page, options: { empty?: boolean; failList?: boolean } = {}) {
  const items: Item[] = options.empty ? [] : Array.from({ length: 21 }, (_, index) => ({
    notificationId: `notification-${String(index + 1).padStart(2, "0")}`,
    title: index === 0 ? "Falha operacional" : `Notificação ${index + 1}`,
    message: "Evento interno controlado",
    type: index === 0 ? "error" : index === 1 ? "warning" : "info",
    isRead: index > 1,
    actionUrl: index === 0 ? "/chamados?status=open" : null,
    createdAt: new Date(Date.UTC(2026, 7, 21 - index, 12)).toISOString(),
  }));
  const inputs: Record<string, unknown>[] = [];
  let listShouldFail = options.failList ?? false;
  const session = {
    clientId: "browser-tenant-must-not-be-sent",
    company: "Tenant controlado",
    permissions: ["conversations"],
    userName: "Usuário controlado",
    userEmail: "agent@example.invalid",
    userRole: "agent",
    plan: "test",
    modules: ["conversations"],
    expiresAt: Date.now() + 3_600_000,
  };
  await page.addInitScript((value) => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(value));
    localStorage.setItem("megadesk_active_page_v1", "notifications");
  }, session);
  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(url.pathname).replace(/^.*\/api\/trpc\//, "").split(",");
    const rawInput = url.searchParams.get("input") ?? route.request().postData();
    const payload = rawInput ? JSON.parse(rawInput) : {};
    const payloads = procedures.map((name, index) => {
      const input = requestInput(payload, index);
      if (name.includes("megadesk.refreshSession")) return result({ ok: true, session });
      if (name.includes("notifications.listV2")) {
        inputs.push(input);
        if (listShouldFail) {
          return { error: { json: { message: "Falha controlada", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: "notifications.listV2" } } } };
        }
        const pageNumber = Number(input.page ?? 1);
        const pageSize = Number(input.pageSize ?? 20);
        const category = typeof input.category === "string" ? input.category : null;
        const filtered = items.filter(item => (!input.unreadOnly || !item.isRead) && (!category || item.type === category));
        return result({
          items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
          total: filtered.length,
          unreadCount: items.filter(item => !item.isRead).length,
          page: pageNumber,
          pageSize,
          totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
        });
      }
      if (name.includes("notifications.markAsReadV2")) {
        const item = items.find(candidate => candidate.notificationId === input.notificationId);
        if (item) item.isRead = true;
        return result({ success: true });
      }
      if (name.includes("notifications.markAllAsReadV2")) {
        items.forEach(item => { item.isRead = true; });
        return result({ success: true });
      }
      return result(name.includes("evolution.getStatus") ? { status: "connected" } : null);
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.searchParams.get("batch") === "1" ? payloads : payloads[0]) });
  });
  return { inputs, allowListSuccess: () => { listShouldFail = false; } };
}

test("Notifications modern UI keeps identity server-side and supports its controlled workflow", async ({ page }) => {
  const audit = await prepare(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("notifications-page")).toBeVisible();
  await expect(page.getByText("Falha operacional")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir no MegaDesk" })).toHaveAttribute("href", "/chamados?status=open");
  await expect(page.locator('a[href^="http"], a[href^="//"], a[href^="javascript:"], a[href^="data:"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Não lidas", exact: true }).click();
  await expect(page.getByText("Notificação 2")).toBeVisible();
  await page.getByLabel("Categoria").selectOption("warning");
  await expect(page.getByText("Notificação 2")).toBeVisible();
  await page.getByRole("button", { name: "Marcar como lida" }).click();
  await expect(page.getByText("Nenhuma notificação não lida")).toBeVisible();

  await page.getByRole("button", { name: "Todas", exact: true }).click();
  await page.getByLabel("Categoria").selectOption("all");
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await page.getByRole("button", { name: "Próxima" }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await expect(page.getByText("Notificação 21")).toBeVisible();

  expect(audit.inputs.length).toBeGreaterThan(0);
  expect(audit.inputs.every(input => !("clientId" in input) && !("userId" in input))).toBe(true);
});

test("direct notifications route also uses the modern contract", async ({ page }) => {
  await prepare(page);
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("notifications-page")).toBeVisible();
  await expect(page.getByRole("button", { name: /Criar Notificação de Teste/i })).toHaveCount(0);
  await expect(page.getByText("Falha operacional")).toBeVisible();
});

test("shows the empty placeholder and marks all notifications as read", async ({ page }) => {
  await prepare(page, { empty: true });
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Nenhuma notificação encontrada")).toBeVisible();

  await page.unroute("**/api/trpc/**");
  await prepare(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Marcar todas como lidas" }).click();
  await expect(page.getByText("0 não lidas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Marcar todas como lidas" })).toBeDisabled();
});

test("recovers from a controlled list error", async ({ page }) => {
  const control = await prepare(page, { failList: true });
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Não foi possível carregar as notificações.")).toBeVisible({ timeout: 15_000 });
  control.allowListSuccess();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("Falha operacional")).toBeVisible();
});
