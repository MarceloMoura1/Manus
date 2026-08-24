import { expect, test, type Page } from "@playwright/test";
const session = {
    clientId: "sale-e2e",
    company: "Vendas E2E",
    permissions: ["erp"],
    userName: "Gestor",
    userEmail: "sale@example.invalid",
    userRole: "manager",
    plan: "test",
    modules: ["erp"],
    expiresAt: Date.now() + 3600000,
  },
  order = {
    publicId: "77777777-7777-4777-8777-777777777777",
    orderNumber: "SO-2026-000001",
    crmClientId: "33333333-3333-4333-8333-333333333333",
    customerName: "Cliente controlado",
    status: "draft",
    notes: null,
    expectedDate: null,
    subtotalCents: 1500,
    totalCents: 1500,
    confirmedAt: null,
    fulfilledAt: null,
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
    orderStatus?: "draft" | "confirmed" | "fulfilled" | "cancelled";
    onSaleListRequest?: () => void;
  } = {}
) {
  const {
    readOnly = false,
    empty = false,
    error = false,
    onSaleListRequest,
    orderStatus = "draft",
  } = options;
  await page.addInitScript(
    v => {
      localStorage.setItem("megadesk_session_v1", JSON.stringify(v));
      localStorage.setItem("megadesk_active_page_v1", "erp-sales");
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
            : n.includes("erp.sales.list")
              ? {
                  items: empty ? [] : [{ ...order, status: orderStatus }],
                  total: empty ? 0 : 1,
                  page: 1,
                  pageSize: 20,
                  totalPages: 1,
                  canWrite: !readOnly,
                }
              : n.includes("erp.sales.detail")
                ? { ...order, status: orderStatus, items: [], history: [], canWrite: !readOnly }
                : n.includes("erp.sales.options")
                  ? {
                      customers: [{ crmClientId: order.crmClientId, customerName: order.customerName }],
                      products: [{ productPublicId: "44444444-4444-4444-8444-444444444444", name: "Produto controlado", sku: "SALE-01", salePriceCents: 1250 }],
                    }
                : n.includes("erp.products.list")
                  ? {
                      items: [{ publicId: "44444444-4444-4444-8444-444444444444", name: "Produto controlado", sku: "SALE-01", salePriceCents: 1250, active: true, quantity: "10.000" }],
                      total: 1,
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
    if (error && names.some(n => n.includes("erp.sales.list"))) {
      onSaleListRequest?.();
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
  await page.goto("/erp/vendas");
}
test("sales route exposes manager workflow", async ({ page }) => {
  await prepare(page);
  await expect(page).toHaveURL(/\/erp\/vendas$/);
  await expect(page.getByTestId("erp-sales-page")).toBeVisible();
  await expect(page.getByText("SO-2026-000001")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar" })).toBeVisible();
});
test("sales creates draft and validates dynamic items", async ({ page }) => {
  await prepare(page);
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo pedido" });
  await dialog.getByLabel("Cliente").selectOption(order.crmClientId);
  await dialog.getByLabel("Produto").selectOption("44444444-4444-4444-8444-444444444444");
  await dialog.getByLabel("Quantidade").fill("2.000");
  await dialog.getByLabel("Preço unitário").fill("1250");
  await dialog.getByRole("button", { name: "Adicionar item" }).click();
  const secondItem = dialog.getByRole("group", { name: "Item 2" });
  await expect(secondItem.getByRole("button", { name: "Remover item" })).toBeVisible();
  await secondItem.getByRole("button", { name: "Remover item" }).click();
  await dialog.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Pedido criado com sucesso.")).toBeVisible();
});
test("sales confirms and fulfills through explicit confirmations", async ({ page }) => {
  await prepare(page);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Pedido confirmado com sucesso.")).toBeVisible();
  await prepare(page, { orderStatus: "confirmed" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Concluir venda" }).click();
  await expect(page.getByText("Venda concluída e estoque atualizado.")).toBeVisible();
});
test("sales read-only omits writes", async ({ page }) => {
  await prepare(page, { readOnly: true });
  await expect(page.getByRole("button", { name: "Novo pedido" })).toHaveCount(
    0
  );
  await expect(page.getByRole("button", { name: "Confirmar" })).toHaveCount(0);
});
test("sales exposes empty state", async ({ page }) => {
  await prepare(page, { empty: true });
  await expect(
    page.getByText("Nenhum pedido de venda cadastrado.")
  ).toBeVisible();
});
test("sales exposes online error and retry", async ({ page }) => {
  let attempts = 0;
  await prepare(page, {
    error: true,
    onSaleListRequest: () => {
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
  test(`sales usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await prepare(page);
    await expect(page.getByTestId("erp-sales-page")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true);
  });
