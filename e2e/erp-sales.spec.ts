import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";
const session = {
    clientId: "sale-e2e",
    company: "Vendas UX E2E",
    permissions: ["erp"],
    userName: "Ana Gestora",
    userEmail: "sale@example.invalid",
    userRole: "manager",
    plan: "test",
    modules: ["erp"],
    expiresAt: Date.now() + 3600000,
  },
  order = {
    publicId: "77777777-7777-4777-8777-777777777777",
    orderNumber: "VD-00128",
    crmClientId: "33333333-3333-4333-8333-333333333333",
    customerName: "Alfa Comércio",
    sellerName: "Ana Gestora",
    status: "confirmed",
    currentStage: "separation",
    cancelled: false,
    notes: "Entrega comercial",
    expectedDate: "2026-10-09",
    shippingAddress: {
      recipientName: "Alfa Comércio", postalCode: "01001-000", street: "Praça da Sé",
      number: "100", complement: "Sala 4", district: "Sé", city: "São Paulo", state: "SP",
    },
    billingAddress: {
      recipientName: "Alfa Comércio", postalCode: "01001-000", street: "Praça da Sé",
      number: "100", complement: "Sala 4", district: "Sé", city: "São Paulo", state: "SP",
    },
    subtotalCents: 285000,
    discountCents: 0,
    freightCents: 0,
    totalCents: 285000,
    paymentMethod: "Boleto bancário",
    paidCents: 95000,
    balanceCents: 190000,
    paymentStatus: "partial",
    titleCount: 3,
    itemCount: 3,
    totalQuantity: "6.000",
    firstProductName: "Monitor 24 IPS",
    confirmedAt: "2026-10-05T14:10:00.000Z",
    fulfilledAt: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: "2026-10-05T12:24:00.000Z",
    updatedAt: "2026-10-05T14:10:00.000Z",
  },
  saleItem = {
    publicId: "91111111-1111-4111-8111-111111111111",
    productPublicId: "44444444-4444-4444-8444-444444444444",
    inventoryItemPublicId: "55555555-5555-4555-8555-555555555555",
    productName: "Monitor 24 IPS",
    variantName: "Cor: Preto",
    sku: "MON-024-PRETO",
    unit: "unit",
    quantity: "2.000",
    unitPriceCents: 120000,
    discountCents: 0,
    lineTotalCents: 240000,
    currentAvailable: "18.000",
    canonicalImage: null,
  },
  customerResult = {
    items: [{
      crmClientId: order.crmClientId,
      customerName: order.customerName,
      document: "12.345.678/0001-90",
      responsibleName: "Paulo",
      address: "Praça da Sé",
      city: "São Paulo",
      state: "SP",
      postalCode: "01001-000",
    }],
    total: 1,
    page: 1,
    pageSize: 12,
  },
  catalogResult = {
    items: [
      { inventoryItemPublicId: "55555555-5555-4555-8555-555555555555", productPublicId: "44444444-4444-4444-8444-444444444444", name: "Monitor 24 IPS", sku: "MON-024-PRETO", unit: "unit", availableQuantity: "18.000", kind: "variant", variantPublicId: "66666666-6666-4666-8666-666666666661", variantName: "Preto", variantAttributes: "Cor: Preto", salePriceCents: 120000, canonicalImage: null },
      { inventoryItemPublicId: "55555555-5555-4555-8555-555555555556", productPublicId: "44444444-4444-4444-8444-444444444444", name: "Monitor 24 IPS", sku: "MON-024-PRATA", unit: "unit", availableQuantity: "7.000", kind: "variant", variantPublicId: "66666666-6666-4666-8666-666666666662", variantName: "Prata", variantAttributes: "Cor: Prata", salePriceCents: 122000, canonicalImage: null },
      { inventoryItemPublicId: "55555555-5555-4555-8555-555555555557", productPublicId: "44444444-4444-4444-8444-444444444444", name: "Monitor 24 IPS", sku: "MON-024-BRANCO", unit: "unit", availableQuantity: "0.000", kind: "variant", variantPublicId: "66666666-6666-4666-8666-666666666663", variantName: "Branco", variantAttributes: "Cor: Branco", salePriceCents: 121000, canonicalImage: null },
    ],
    total: 3,
    page: 1,
    pageSize: 12,
  },
  result = (json: unknown) => ({ result: { data: { json } } });
async function prepare(
  page: Page,
  options: {
    readOnly?: boolean;
    empty?: boolean;
    error?: boolean;
    missingFinance?: boolean;
    stage?: "created" | "separation";
    counters?: { customers: number; catalog: number };
    onSaleListRequest?: () => void;
  } = {}
) {
  const {
    readOnly = false,
    empty = false,
    error = false,
    missingFinance = false,
    counters,
    onSaleListRequest,
    stage = "separation",
  } = options;
  const activeOrder = {
    ...order,
    status: stage === "created" ? "draft" : "confirmed",
    currentStage: stage,
  };
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
      response = (n: string): unknown => {
        if (n.includes("refreshSession")) return { ok: true, session: readOnly ? { ...session, userRole: "viewer" } : session };
        if (n.includes("evolution.getStatus")) return { status: "disconnected" };
        if (n.includes("erp.sales.metrics")) return { salesCents: 8475000, receivableCents: 1842000, openOrders: 24, grossMarginPercent: null, grossMarginAvailable: false, grossMarginReason: "Custos históricos indisponíveis", period: { from: "2026-10-01", to: "2026-10-31", criterion: "data de criação da venda" } };
        if (n.includes("erp.sales.documents.list")) return [];
        if (n.includes("erp.sales.list")) return { items: empty ? [] : [activeOrder], total: empty ? 0 : 1, page: 1, pageSize: 10, totalPages: 1, canWrite: !readOnly };
        if (n.includes("erp.sales.detail")) return {
          ...activeOrder,
          items: [saleItem],
          installments: [
            { publicId: "a1111111-1111-4111-8111-111111111111", installment: 1, dueDate: "2026-10-05", amountCents: 95000, paidCents: 95000, status: "settled", paymentStatus: "paid" },
            { publicId: "a2222222-2222-4222-8222-222222222222", installment: 2, dueDate: "2026-11-05", amountCents: 95000, paidCents: 0, status: "open", paymentStatus: "pending" },
          ],
          financialHistoryAvailable: true,
          historyComplete: true,
          history: [{ source: "audit", eventType: "stage_transition", fromStage: "confirmed", toStage: stage, reason: null, changedBy: "manager-1", changedByName: "Ana Gestora", createdAt: "2026-10-05T15:00:00.000Z", before: null, after: null }],
          canWrite: !readOnly,
        };
        if (n.includes("erp.sales.options")) return { paymentMethods: ["PIX", "Boleto bancário"], sellers: [{ publicId: "manager-1", name: "Ana Gestora" }], categories: missingFinance ? [] : [{ publicId: "b1111111-1111-4111-8111-111111111111", name: "Receita de vendas" }], accounts: missingFinance ? [] : [{ publicId: "c1111111-1111-4111-8111-111111111111", name: "Banco principal", type: "bank" }], canWrite: !readOnly };
        if (n.includes("erp.sales.customers")) { if (counters) counters.customers += 1; return customerResult; }
        if (n.includes("erp.sales.catalog")) { if (counters) counters.catalog += 1; return catalogResult; }
        if (n.includes("erp.sales.create")) return { ...activeOrder, status: "draft", currentStage: "created" };
        if (n.includes("erp.summary")) return { metrics: {}, critical: [], recent: [], canWrite: !readOnly };
        return {};
      };
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

async function capture(page: Page, name: string) {
  const root = process.env.SALES_UX_SCREENSHOT_DIR;
  if (!root) return;
  const path = `${root}/${name}.png`;
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

test("sales route exposes compact overview and wide detail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  await expect(page).toHaveURL(/\/erp\/vendas$/);
  await expect(page.getByTestId("erp-sales-page")).toBeVisible();
  await expect(page.getByText("VD-00128").first()).toBeVisible();
  await expect(page.getByLabel("Timeline das etapas da venda")).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir venda VD-00128" }).click();
  await expect(page).toHaveURL(new RegExp(`/erp/vendas/${order.publicId}$`));
  const detail = page.getByTestId("sales-detail-screen");
  await expect(detail.getByLabel("Timeline das etapas da venda")).toBeVisible();
  await expect(detail.getByText("Pagamento parcial").first()).toBeVisible();
  await expect(detail.getByText("Documentos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Voltar para vendas" }).click();
  await expect(page).toHaveURL(/\/erp\/vendas$/);
  await expect(page.getByText("VD-00128").first()).toBeVisible();

  await page.goto(`/erp/vendas/${order.publicId}`);
  await expect(page.getByLabel("Timeline das etapas da venda")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Timeline das etapas da venda")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/erp\/vendas$/);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/erp/vendas/${order.publicId}$`));
  await capture(page, "sales-overview-desktop");
});
test("sales searches incrementally and reveals variants only on demand", async ({ page }) => {
  const counters = { customers: 0, catalog: 0 };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page, { stage: "created", counters });
  await page.getByRole("button", { name: "Nova venda" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova venda" });
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())?.width).toBeGreaterThan(1100);
  expect(counters).toEqual({ customers: 0, catalog: 0 });
  await capture(page, "sales-new-empty");

  await dialog.getByLabel("Buscar cliente para a venda").fill("A");
  await page.waitForTimeout(400);
  expect(counters.customers).toBe(0);
  await dialog.getByLabel("Buscar cliente para a venda").fill("Al");
  await expect(dialog.getByRole("button", { name: /Alfa Comércio/ })).toBeVisible();
  await capture(page, "sales-customer-search");
  await dialog.getByRole("button", { name: /Alfa Comércio/ }).click();

  await dialog.getByLabel("Buscar produto para a venda").fill("Mo");
  await expect(dialog.getByRole("button", { name: /Monitor 24 IPS/ }).first()).toBeVisible();
  await capture(page, "sales-product-search");
  await dialog.getByRole("button", { name: /Monitor 24 IPS/ }).first().click();
  await expect(dialog.getByRole("button", { name: /Cor: Preto/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Cor: Branco/ })).toBeDisabled();
  await capture(page, "sales-variant-selection");
  await dialog.getByRole("button", { name: /Cor: Preto/ }).click();
  await expect(dialog.getByRole("button", { name: "Remover Monitor 24 IPS" })).toBeVisible();
  await dialog.getByLabel("Quantidade").fill("19");
  await expect(dialog.getByRole("alert")).toContainText("Estoque insuficiente");
  await expect(dialog.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  await dialog.getByLabel("Quantidade").fill("2");
  await expect(dialog.getByText("Estoque insuficiente")).toHaveCount(0);
  await dialog.getByLabel("Frete").fill("125,90");
  await dialog.getByLabel("Frete").blur();
  await expect(dialog.getByLabel("Frete")).toHaveValue("125,90");
  await expect(dialog.getByRole("button", { name: "Usar outro endereço de cobrança" })).toBeVisible();
  expect(counters.customers).toBeGreaterThan(0);
  expect(counters.catalog).toBeGreaterThan(0);
  await capture(page, "sales-new-workspace-desktop");
});
test("sales confirms through the guided financial checklist", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepare(page, { stage: "created" });
  await page.getByRole("button", { name: "Abrir venda VD-00128" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirmar venda" });
  await expect(dialog.getByText("Esta venda pode ser confirmada?")).toBeVisible();
  await expect(dialog.getByLabel("Categoria financeira")).toHaveValue("b1111111-1111-4111-8111-111111111111");
  await expect(dialog.getByLabel("Conta prevista")).toHaveValue("c1111111-1111-4111-8111-111111111111");
  await expect(dialog.getByText("Isenção não está disponível")).toBeVisible();
  await dialog.getByRole("button", { name: "Pagamento parcial" }).click();
  await dialog.getByLabel("Valor já recebido").fill("950,00");
  await dialog.getByLabel("Valor já recebido").blur();
  await expect(dialog.getByText("R$ 950,00")).toBeVisible();
  await dialog.getByRole("button", { name: "Pago" }).click();
  await expect(dialog.getByText("R$ 0,00")).toBeVisible();
  await dialog.getByRole("button", { name: "Pendente" }).click();
  await expect(dialog.getByRole("button", { name: "Confirmar venda e criar títulos" })).toBeEnabled();
  await capture(page, "sales-confirmation-1366");
});
test("sales explains a blocked financial confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepare(page, { stage: "created", missingFinance: true });
  await page.getByRole("button", { name: "Abrir venda VD-00128" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirmar venda" });
  await expect(dialog.getByText("Confirmação bloqueada")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Nova categoria a receber" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Nova conta" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirmar venda e criar títulos" })).toBeDisabled();
  await capture(page, "sales-confirmation-blocked");
});
test("sales read-only omits writes", async ({ page }) => {
  await prepare(page, { readOnly: true });
  await expect(page.getByRole("button", { name: "Nova venda" })).toHaveCount(
    0
  );
  await page.getByRole("button", { name: "Abrir venda VD-00128" }).click();
  await expect(page.getByRole("button", { name: "Confirmar" })).toHaveCount(0);
});
test("sales exposes empty state", async ({ page }) => {
  await prepare(page, { empty: true });
  await expect(
    page.getByText("Nenhuma venda encontrada neste período.")
  ).toBeVisible();
});
test("sales keeps secondary filters behind an explicit control", async ({ page }) => {
  await prepare(page);
  await expect(page.getByLabel("Filtros avançados")).toHaveCount(0);
  await page.getByRole("button", { name: /Mais filtros/ }).click();
  await expect(page.getByLabel("Filtros avançados")).toBeVisible();
  await expect(page.getByLabel("Forma de pagamento")).toBeVisible();
  await capture(page, "sales-filters-open");
});
test("sales exposes online error and retry", async ({ page }) => {
  let attempts = 0;
  await prepare(page, { error: true, onSaleListRequest: () => { attempts += 1; } });
  await expect.poll(() => attempts, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
  await expect(
    page.getByRole("button", { name: "Tentar novamente" })
  ).toBeVisible({ timeout: 15_000 });
});
for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 900 },
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
    if (viewport.width === 390) await capture(page, "sales-overview-narrow");
  });
