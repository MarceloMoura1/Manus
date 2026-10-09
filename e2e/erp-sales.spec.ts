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
    firstProductImage: { mediaId: "99999999-9999-4999-8999-999999999999", path: "/api/products/44444444-4444-4444-8444-444444444444/image", thumbnailPath: "/api/products/44444444-4444-4444-8444-444444444444/image?variant=thumbnail" },
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
    stockExitRecorded: false,
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
    stage?: "created" | "separation" | "shipped";
    stockAvailable?: string | null;
    stockExitRecorded?: boolean;
    counters?: { customers: number; catalog: number };
    onSaleListRequest?: () => void;
    visualRows?: boolean;
    paymentFlow?: boolean;
    exportNames?: Array<{ customerName: string; sellerName: string }>;
    metricRequests?: string[];
  } = {}
) {
  const {
    readOnly = false,
    empty = false,
    error = false,
    missingFinance = false,
    counters,
    onSaleListRequest,
    visualRows = false,
    paymentFlow = false,
    exportNames,
    metricRequests,
    stage = "separation",
    stockAvailable = "18.000",
    stockExitRecorded = false,
  } = options;
  let extraPaidCents = 0;
  const activeOrder = {
    ...order,
    status: stage === "created" ? "draft" : "confirmed",
    currentStage: stage,
  };
  const visualOrders = [
    ["VD-00128", "Alfa Comércio", "paid", "completed", 125000],
    ["VD-00127", "Studio Oliveira", "partial", "separation", 98000],
    ["VD-00126", "NovaTech", "pending", "created", 243000],
    ["VD-00125", "Casa Martins", "paid", "completed", 312000],
    ["VD-00124", "Mercado Central", "pending", "created", 89000],
    ["VD-00123", "Lima Serviços", "partial", "confirmed", 178000],
  ].map(([orderNumber, customerName, paymentStatus, currentStage, totalCents], index) => ({
    ...activeOrder,
    publicId: `77777777-7777-4777-8777-${String(index + 1).padStart(12, "0")}`,
    orderNumber,
    customerName,
    paymentStatus,
    currentStage,
    status: currentStage === "created" ? "draft" : currentStage === "completed" ? "fulfilled" : "confirmed",
    cancelled: orderNumber === "VD-00124",
    totalCents,
    createdAt: `2026-10-0${5 - Math.floor(index / 2)}T12:24:00.000Z`,
    sellerName: index % 2 ? "Ana" : "Marcelo",
  }));
  const exportOrders = exportNames?.map((names, index) => ({
    ...activeOrder,
    publicId: `77777777-7777-4777-8777-${String(index + 1).padStart(12, "0")}`,
    orderNumber: `VD-${String(index + 1).padStart(5, "0")}`,
    ...names,
  }));
  await page.addInitScript(
    v => {
      localStorage.setItem("megadesk_session_v1", JSON.stringify(v));
      localStorage.setItem("megadesk_active_page_v1", "erp-sales");
    },
    readOnly ? { ...session, userRole: "viewer" } : session
  );
  await page.route("**/api/products/**/image*", route => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#dbeafe"/><rect x="12" y="18" width="56" height="40" rx="3" fill="#1d4ed8"/><rect x="17" y="23" width="46" height="30" fill="#60a5fa"/><path d="M34 62h12M40 58v4" stroke="#1e293b" stroke-width="3"/></svg>',
  }));
  await page.route("**/api/trpc/**", async route => {
    const names = decodeURIComponent(new URL(route.request().url()).pathname)
        .replace(/^.*\/api\/trpc\//, "")
        .split(","),
      response = (n: string): unknown => {
        if (n.includes("refreshSession")) return { ok: true, session: readOnly ? { ...session, userRole: "viewer" } : session };
        if (n.includes("evolution.getStatus")) return { status: "disconnected" };
        if (n.includes("erp.sales.metrics")) {
          metricRequests?.push(decodeURIComponent(route.request().url()));
          return { salesCents: 8475000, receivableCents: 1842000, orderCount: 128, averageTicketCents: 66211, openOrders: 24, grossMarginPercent: null, grossMarginAvailable: false, grossMarginReason: "Custos históricos indisponíveis", period: { from: "2026-10-01", to: "2026-10-31", criterion: "data de criação da venda" } };
        }
        if (n.includes("erp.sales.documents.list")) return [];
        if (n.includes("erp.sales.list")) {
          const items = empty ? [] : exportOrders ?? (visualRows ? visualOrders : [activeOrder]);
          return { items, total: items.length, page: 1, pageSize: 6, totalPages: 1, canWrite: !readOnly };
        }
        if (n.includes("erp.finance.settle") && paymentFlow) {
          extraPaidCents = 50_000;
          return { publicId: "a2222222-2222-4222-8222-222222222222", paidCents: extraPaidCents, replay: false };
        }
        if (n.includes("erp.sales.detail")) return {
          ...activeOrder,
          paidCents: activeOrder.paidCents + extraPaidCents,
          balanceCents: activeOrder.balanceCents - extraPaidCents,
          items: [{ ...saleItem, currentAvailable: stockAvailable, stockExitRecorded }],
          installments: [
            { publicId: "a1111111-1111-4111-8111-111111111111", installment: 1, dueDate: "2026-10-05", amountCents: 95000, paidCents: 95000, status: "settled", paymentStatus: "paid" },
            { publicId: "a2222222-2222-4222-8222-222222222222", installment: 2, dueDate: "2026-11-05", amountCents: 95000, paidCents: extraPaidCents, status: "open", paymentStatus: extraPaidCents ? "partial" : "pending" },
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
  await expect(page.locator('tr[data-testid^="sale-row-"] img')).toBeVisible();
  await capture(page, "sales-list-desktop");
  await expect(page.getByLabel("Timeline das etapas da venda")).toHaveCount(0);
  await page.getByRole("button", { name: "VD-00128", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/erp/vendas/${order.publicId}$`));
  const detail = page.getByTestId("sales-detail-screen");
  await expect(detail.getByLabel("Timeline das etapas da venda")).toBeVisible();
  await expect(detail.getByText("Pagamento parcial").first()).toBeVisible();
  await expect(detail.getByText("Saldo disponível: 18")).toBeVisible();
  await expect(detail.getByText("Baixa de estoque ainda não realizada")).toBeVisible();
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

test("sales payment editor uses the Finance settlement and refreshes after reload", async ({ page }) => {
  await prepare(page, { paymentFlow: true });
  await page.getByRole("button", { name: "VD-00128", exact: true }).click();
  await page.getByRole("button", { name: /Registrar recebimento · parcela 2/ }).click();
  await page.getByLabel("Conta de recebimento").selectOption("c1111111-1111-4111-8111-111111111111");
  await page.getByLabel("Valor recebido (R$)").fill("500,00");
  await page.getByRole("button", { name: "Confirmar recebimento" }).click();
  await expect(page.getByText("Recebimento registrado no Financeiro.", { exact: false })).toBeVisible();
  await expect(page.getByText("R$ 1.450,00", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("R$ 1.450,00", { exact: true })).toBeVisible();
});

test("sales detail distinguishes zero stock from missing reservation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await prepare(page, { stockAvailable: "0.000" });
  await page.getByRole("button", { name: "VD-00128", exact: true }).click();
  const detail = page.getByTestId("sales-detail-screen");
  await expect(detail.getByText("Sem saldo disponível")).toBeVisible();
  await expect(detail.getByText("Quantidade vendida: 2")).toBeVisible();
  await expect(detail.getByText("Baixa de estoque ainda não realizada")).toBeVisible();
  await expect(detail.getByText("Sem reserva", { exact: false })).toHaveCount(0);
  await detail.getByText("Sem saldo disponível").scrollIntoViewIfNeeded();
  await capture(page, "sales-stock-zero");
});

test("sales detail distinguishes recorded stock exit from current balance", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await prepare(page, { stockAvailable: "8.000", stockExitRecorded: true, stage: "shipped" });
  await page.getByRole("button", { name: "VD-00128", exact: true }).click();
  const detail = page.getByTestId("sales-detail-screen");
  await expect(detail.getByText("Saldo disponível: 8")).toBeVisible();
  await expect(detail.getByText("Quantidade vendida: 2")).toBeVisible();
  await expect(detail.getByText("Baixa de estoque registrada")).toBeVisible();
  await expect(detail.getByText("A saída registrada ocorreu no envio; concluir não repete a baixa.")).toBeVisible();
  await detail.getByText("Baixa de estoque registrada").scrollIntoViewIfNeeded();
  await capture(page, "sales-stock-exit");
});

test("sales export downloads formula-safe CSV with normal text, accents, quotes and line breaks", async ({ page }) => {
  await prepare(page, { exportNames: [
    { customerName: '=HYPERLINK("https://example.invalid","abrir")', sellerName: "+COMANDO" },
    { customerName: " \t@SOMA(1,2)", sellerName: "\r\n-COMANDO" },
    { customerName: 'Árvore, "Ltda"\nFilial', sellerName: 'Ana, "Silva"' },
    { customerName: "Cliente normal", sellerName: "Marcelo" },
    { customerName: "\u0000=FÓRMULA", sellerName: "\uFEFF+FÓRMULA" },
    { customerName: "   =1+1", sellerName: "@IMPORTDATA" },
  ] });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("vendas-pagina-1.csv");
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString("utf8");
  expect(csv).toMatch(/^\uFEFF"Venda";"Cliente";"Data";"Vendedor"/);
  expect(csv).toContain('"\t\'=HYPERLINK(""https://example.invalid"",""abrir"")";"');
  expect(csv).toContain('"\t\'+COMANDO"');
  expect(csv).toContain('"\t\' \t@SOMA(1,2)"');
  expect(csv).toContain('"\t\'\r\n-COMANDO"');
  expect(csv).toContain('"Árvore, ""Ltda""\nFilial"');
  expect(csv).toContain('"Ana, ""Silva"""');
  expect(csv).toContain('"Cliente normal"');
  expect(csv).toContain('"\t\'\u0000=FÓRMULA"');
  expect(csv).toContain('"\t\'\uFEFF+FÓRMULA"');
  expect(csv).toContain('"\t\'   =1+1"');
  expect(csv).toContain('"\t\'@IMPORTDATA"');
  expect(csv).toContain('\r\n"VD-00002"');
});

test("sales download protects Unicode formula variants in customer and seller fields", async ({ page }) => {
  await prepare(page, { exportNames: [
    { customerName: "＝1+1", sellerName: "＋IMPORTDATA" },
    { customerName: "－1+1", sellerName: "＠SOMA(1,2)" },
    { customerName: " \u200B﹦1+1", sellerName: "\u00A0﹢1+1" },
    { customerName: "﹣1+1", sellerName: "\u2060⁺1+1" },
    { customerName: "−1+1", sellerName: "\u0000＝1+1" },
    { customerName: "Cliente normal", sellerName: 'Árvore, "Silva"\r\nFilial' },
  ] });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar" }).click();
  const stream = await (await downloadPromise).createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString("utf8");
  expect(csv).toMatch(/^\uFEFF"Venda";"Cliente";"Data";"Vendedor"/);
  expect(csv).toContain('"\t\'＝1+1";');
  expect(csv).toContain('"\t\'＋IMPORTDATA"');
  expect(csv).toContain('"\t\'－1+1";');
  expect(csv).toContain('"\t\'＠SOMA(1,2)"');
  expect(csv).toContain('"\t\' \u200B﹦1+1";');
  expect(csv).toContain('"\t\'\u00A0﹢1+1"');
  expect(csv).toContain('"\t\'﹣1+1";');
  expect(csv).toContain('"\t\'\u2060⁺1+1"');
  expect(csv).toContain('"\t\'−1+1";');
  expect(csv).toContain('"\t\'\u0000＝1+1"');
  expect(csv).toContain('"Cliente normal";');
  expect(csv).toContain('"Árvore, ""Silva""\r\nFilial"');
});

test("sales metric label follows the actual monthly, complete, custom and partial query bounds", async ({ page }) => {
  const metricRequests: string[] = [];
  await prepare(page, { metricRequests });
  await expect(page.getByText("Vendas no mês", { exact: true })).toBeVisible();
  await expect.poll(() => metricRequests.length).toBeGreaterThan(0);
  const period = page.getByRole("combobox", { name: "Período" });
  await period.selectOption("all");
  await expect(page.getByText("Vendas em todo o período", { exact: true })).toBeVisible();
  await expect.poll(() => metricRequests.some(url => url.includes("1000-01-01") && url.includes("9999-12-31"))).toBe(true);

  await period.selectOption("custom");
  await page.getByLabel("Data inicial").fill("2026-09-02");
  await page.getByLabel("Data final").fill("2026-09-28");
  await expect(page.getByText("Vendas de 02/09/2026 a 28/09/2026", { exact: true })).toBeVisible();
  await expect.poll(() => metricRequests.some(url => url.includes("2026-09-02") && url.includes("2026-09-28"))).toBe(true);

  await page.getByLabel("Data final").fill("");
  await expect(page.getByText("Vendas desde 02/09/2026", { exact: true })).toBeVisible();
  await expect.poll(() => metricRequests.some(url => url.includes("2026-09-02") && url.includes("9999-12-31"))).toBe(true);

  await page.getByLabel("Data inicial").fill("");
  await page.getByLabel("Data final").fill("2026-09-28");
  await expect(page.getByText("Vendas até 28/09/2026", { exact: true })).toBeVisible();
  await expect.poll(() => metricRequests.some(url => url.includes("1000-01-01") && url.includes("2026-09-28"))).toBe(true);

  await period.selectOption("month");
  await expect(page.getByText("Vendas no mês", { exact: true })).toBeVisible();
});

test("sales list keeps the approved dense desktop composition and product images", async ({ page }) => {
  await page.setViewportSize({ width: 950, height: 700 });
  await prepare(page, { visualRows: true });
  await expect(page.getByRole("table", { name: "Vendas" }).locator("tbody tr")).toHaveCount(6);
  await expect(page.getByText("Mostrando 1–6 de 6 vendas")).toBeVisible();
  await expect(page.getByRole("table", { name: "Vendas" }).locator("tbody img")).toHaveCount(6);
  expect(await page.getByRole("table", { name: "Vendas" }).locator("tbody img").first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole("table", { name: "Vendas" }).getByText("Em andamento").first()).toBeVisible();
  await capture(page, "sales-list-reference-width");
  await page.getByRole("button", { name: "Ações da venda VD-00126" }).click();
  await expect(page.getByRole("menuitem", { name: "Editar rascunho" })).toBeVisible();
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
  await page.getByRole("button", { name: "VD-00128", exact: true }).click();
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
  await page.getByRole("button", { name: "VD-00128", exact: true }).click();
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
  await page.getByRole("button", { name: "VD-00128", exact: true }).click();
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
  await page.getByRole("button", { name: /Filtros/ }).click();
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
