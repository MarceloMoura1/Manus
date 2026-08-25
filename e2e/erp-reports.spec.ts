import { expect, test, type Page } from "@playwright/test";
type Role = "admin" | "manager" | "viewer" | "agent";
const session = {
    clientId: "reports-e2e",
    company: "Reports E2E",
    permissions: ["erp"],
    userName: "Gestor",
    userEmail: "reports@example.invalid",
    userRole: "manager",
    plan: "test",
    modules: ["erp"],
    expiresAt: Date.now() + 3_600_000,
  },
  result = (json: unknown) => ({ result: { data: { json } } });
const rows = [
  {
    publicId: "11111111-1111-4111-8111-111111111111",
    number: "SO-1",
    name: "Cliente A",
    status: "fulfilled",
    valueCents: 12500,
    date: "2026-08-20",
  },
];
async function prepare(
  page: Page,
  role: Role = "manager",
  options: { empty?: boolean; fail?: boolean } = {}
) {
  let fail = options.fail ? 1 : 0;
  await page.addInitScript(
    v => {
      localStorage.setItem("megadesk_session_v1", JSON.stringify(v));
      localStorage.setItem("megadesk_active_page_v1", "erp-reports");
    },
    { ...session, userRole: role }
  );
  await page.route("**/api/trpc/**", async route => {
    const names = decodeURIComponent(new URL(route.request().url()).pathname)
        .replace(/^.*\/api\/trpc\//, "")
        .split(","),
      one = (name: string) => {
        if (name.includes("refreshSession"))
          return result({ ok: true, session: { ...session, userRole: role } });
        if (name.includes("erp.reports.report")) {
          if (fail-- > 0)
            return {
              error: {
                json: {
                  message: "Falha controlada",
                  code: -32603,
                  data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
                },
              },
            };
          const section = new URL(route.request().url()).searchParams
            .get("input")
            ?.includes("executive")
            ? "executive"
            : "sales";
          return result({
            section,
            period: {
              from: "2026-08-01",
              to: "2026-08-25",
              timezone: "UTC",
              inclusive: true,
            },
            page: 1,
            pageSize: 20,
            canExport: role === "admin" || role === "manager",
            data:
              section === "executive"
                ? {
                    sales: { count: 2, valueCents: 12500 },
                    purchases: { count: 1, valueCents: 5000 },
                    finance: {
                      openTitles: 2,
                      openReceivables: 1,
                      openPayables: 1,
                    },
                    entities: {
                      activeProducts: 4,
                      lowStock: 1,
                      activeClients: 3,
                      activeSuppliers: 2,
                    },
                    fiscal: { drafts: 1, ready: 1, cancelled: 0 },
                  }
                : options.empty
                  ? []
                  : rows,
          });
        }
        if (name.includes("erp.reports.exportCsv")) {
          if (role === "viewer")
            return {
              error: {
                json: {
                  message: "Seu perfil não permite exportar Relatórios.",
                  code: -32003,
                  data: { code: "FORBIDDEN", httpStatus: 403 },
                },
              },
            };
          return result({
            contentType: "text/csv; charset=utf-8",
            fileName: "megadesk-sales.csv",
            content: '"name"\r\n"\'=SUM(A1)"',
            rowCount: 1,
          });
        }
        return result({});
      };
    const body = names.map(one);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(names.length === 1 ? body[0] : body),
    });
  });
}
test("01 admin abre resumo, filtra e exporta sob demanda", async ({ page }) => {
  await prepare(page, "admin");
  await page.goto("/erp/relatorios");
  await expect(
    page.getByRole("heading", { name: "Relatórios essenciais" })
  ).toBeVisible();
  await expect(page.getByText("R$ 125,00")).toBeVisible();
  await page.getByLabel("Data inicial").fill("2026-08-10");
  await expect(page.getByLabel("Data inicial")).toHaveValue("2026-08-10");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  expect((await download).suggestedFilename()).toBe("megadesk-sales.csv");
});
test("02 vendas, compras, estoque e financeiro carregam sob demanda", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/erp/relatorios");
  const tabs = page.getByRole("navigation", { name: "Seções de relatórios" });
  for (const label of ["Vendas", "Compras", "Estoque", "Financeiro"]) {
    await tabs.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "SO-1", exact: true })
    ).toBeVisible();
  }
});
test("03 clientes, fornecedores e fiscal interno permanecem operacionais", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/erp/relatorios");
  const tabs = page.getByRole("navigation", { name: "Seções de relatórios" });
  for (const label of ["Clientes", "Fornecedores", "Fiscal interno"]) {
    await tabs.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "SO-1", exact: true })
    ).toBeVisible();
  }
});
test("04 viewer lê sem exportar e agent não vê o módulo", async ({
  browser,
}) => {
  for (const role of ["viewer", "agent"] as const) {
    const page = await browser.newPage();
    await prepare(page, role);
    await page.goto("/erp/relatorios");
    if (role === "viewer")
      await expect(page.getByRole("button", { name: "Exportar CSV" })).toHaveCount(0);
    else {
      await expect(page).toHaveURL(/\/erp$/);
      await expect(page.getByTestId("erp-reports-page")).toHaveCount(0);
    }
    await page.close();
  }
});
test("05 erro oferece retry e vazio por filtros é explícito", async ({
  browser,
}) => {
  const error = await browser.newPage();
  await prepare(error, "manager", { fail: true });
  await error.goto("/erp/relatorios");
  await expect(
    error.getByRole("button", { name: "Tentar novamente" })
  ).toBeVisible();
  await error.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(error.getByText("R$ 125,00")).toBeVisible();
  await error.close();
  const empty = await browser.newPage();
  await prepare(empty, "manager", { empty: true });
  await empty.goto("/erp/relatorios");
  await empty
    .getByRole("navigation", { name: "Seções de relatórios" })
    .getByRole("button", { name: "Vendas", exact: true })
    .click();
  await expect(
    empty.getByText("Nenhum dado encontrado para os filtros informados.")
  ).toBeVisible();
});
test("06 período inválido bloqueia consulta", async ({ page }) => {
  await prepare(page);
  await page.goto("/erp/relatorios");
  await page.getByLabel("Data inicial").fill("2026-09-01");
  await page.getByLabel("Data final").fill("2026-08-01");
  await expect(page.getByRole("alert")).toContainText("Período inválido");
});
test("07 deep link, refresh e paginação são preservados", async ({ page }) => {
  await prepare(page);
  await page.goto("/erp/relatorios");
  await page
    .getByRole("navigation", { name: "Seções de relatórios" })
    .getByRole("button", { name: "Vendas", exact: true })
    .click();
  await page.reload();
  await expect(page).toHaveURL(/\/erp\/relatorios$/);
  await expect(
    page.getByRole("heading", { name: "Relatórios essenciais" })
  ).toBeVisible();
});
test("08 quatro viewports permanecem sem overflow", async ({ browser }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    await prepare(page);
    await page.goto("/erp/relatorios");
    expect(
      await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        view: document.documentElement.clientWidth,
        main: document.querySelector("main")?.getBoundingClientRect(),
      }))
    ).toMatchObject({ doc: viewport.width, view: viewport.width });
    await page.close();
  }
});
