import { expect, test, type Page } from "@playwright/test";
const session = {
    clientId: "purchase-e2e",
    company: "Compras E2E",
    permissions: ["erp"],
    userName: "Gestor",
    userEmail: "purchase@example.invalid",
    userRole: "manager",
    plan: "test",
    modules: ["erp"],
    expiresAt: Date.now() + 3600000,
  },
  order = {
    publicId: "77777777-7777-4777-8777-777777777777",
    orderNumber: "PO-2026-000001",
    supplierPublicId: "33333333-3333-4333-8333-333333333333",
    supplierName: "Fornecedor controlado",
    status: "draft",
    notes: null,
    expectedDate: null,
    subtotalCents: 1500,
    totalCents: 1500,
    approvedAt: null,
    receivedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  result = (json: unknown) => ({ result: { data: { json } } });
async function prepare(
  page: Page,
  options: {
    readOnly?: boolean;
    empty?: boolean;
    error?: boolean;
    onPurchaseListRequest?: () => void;
  } = {}
) {
  const {
    readOnly = false,
    empty = false,
    error = false,
    onPurchaseListRequest,
  } = options;
  await page.addInitScript(
    v => {
      localStorage.setItem("megadesk_session_v1", JSON.stringify(v));
      localStorage.setItem("megadesk_active_page_v1", "erp-purchases");
    },
    readOnly ? { ...session, userRole: "viewer" } : session
  );
  await page.route("**/api/trpc/**", async route => {
    const names = decodeURIComponent(new URL(route.request().url()).pathname)
        .replace(/^.*\/api\/trpc\//, "")
        .split(","),
      response = (n: string) =>
        n.includes("refreshSession")
          ? {
              ok: true,
              session: readOnly ? { ...session, userRole: "viewer" } : session,
            }
          : n.includes("evolution.getStatus")
            ? { status: "disconnected" }
            : n.includes("erp.purchases.list")
              ? {
                  items: empty ? [] : [order],
                  total: empty ? 0 : 1,
                  page: 1,
                  pageSize: 20,
                  totalPages: 1,
                  canWrite: !readOnly,
                }
              : n.includes("erp.purchases.detail")
                ? { ...order, items: [], history: [], canWrite: !readOnly }
                : n.includes("erp.suppliers.list") ||
                    n.includes("erp.products.list")
                  ? {
                      items: [],
                      total: 0,
                      page: 1,
                      pageSize: 100,
                      totalPages: 0,
                      canWrite: !readOnly,
                    }
                  : n.includes("erp.summary")
                    ? {
                        metrics: {
                          activeProducts: 0,
                          inactiveProducts: 0,
                          lowProducts: 0,
                          emptyProducts: 0,
                          costValueCents: 0,
                          saleValueCents: 0,
                        },
                        critical: [],
                        recent: [],
                        canWrite: !readOnly,
                      }
                    : {};
    if (error && names.some(n => n.includes("erp.purchases.list"))) {
      onPurchaseListRequest?.();
      const failure = {
        error: {
          json: {
            message: "Falha controlada",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        },
      };
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify(
          names.length > 1 ? names.map(() => failure) : failure
        ),
      });
      return;
    }
    const body = names.map(n => result(response(n)));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(names.length > 1 ? body : body[0]),
    });
  });
  await page.goto("/erp/compras");
}
test("purchases route exposes manager workflow", async ({ page }) => {
  await prepare(page);
  await expect(page).toHaveURL(/\/erp\/compras$/);
  await expect(page.getByTestId("erp-purchases-page")).toBeVisible();
  await expect(page.getByText("PO-2026-000001")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar" })).toBeVisible();
});
test("purchases read-only omits writes", async ({ page }) => {
  await prepare(page, { readOnly: true });
  await expect(page.getByRole("button", { name: "Novo pedido" })).toHaveCount(
    0
  );
  await expect(page.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
});
test("purchases exposes empty state", async ({ page }) => {
  await prepare(page, { empty: true });
  await expect(
    page.getByText("Nenhum pedido de compra cadastrado.")
  ).toBeVisible();
});
test("purchases exposes online error and retry", async ({ page }) => {
  let attempts = 0;
  await prepare(page, {
    error: true,
    onPurchaseListRequest: () => {
      attempts += 1;
    },
  });
  await expect.poll(() => attempts, { timeout: 10_000 }).toBe(4);
  await expect(
    page.getByRole("button", { name: "Tentar novamente" })
  ).toBeVisible();
});
for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
])
  test(`purchases usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await prepare(page);
    await expect(page.getByTestId("erp-purchases-page")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true);
  });
