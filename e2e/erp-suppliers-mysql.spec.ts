import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import bcrypt from "bcryptjs";
import { io } from "socket.io-client";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const databaseUrl = process.env.TEST_DATABASE_URL;
const passwordA = process.env.E2E_PASSWORD_A;
const passwordB = process.env.E2E_PASSWORD_B;
const screenshotDir = process.env.MEGADESK_E2E_SCREENSHOT_DIR;
const adminEmail = "supplier-admin-a@example.invalid";
const viewerEmail = "supplier-viewer-a@example.invalid";
const agentEmail = "supplier-agent-a@example.invalid";
const tenantBEmail = "supplier-admin-b@example.invalid";
let pool: Pool;
const contexts = new Set<BrowserContext>();
async function shot(page: Page, name: string) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, name), fullPage: true });
}
async function clean() {
  await pool.execute(
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN ('e2e-supplier-a','e2e-supplier-b')"
  );
  await pool.execute(
    "DELETE FROM erp_suppliers WHERE client_id IN ('e2e-supplier-a','e2e-supplier-b')"
  );
  await pool.execute(
    "DELETE FROM megadesk_domain_client_users WHERE client_id IN ('e2e-supplier-a','e2e-supplier-b')"
  );
  await pool.execute(
    "DELETE FROM megadesk_domain_clients WHERE client_id IN ('e2e-supplier-a','e2e-supplier-b')"
  );
}
async function fixtures() {
  await clean();
  const [a, b] = await Promise.all([
    bcrypt.hash(passwordA!, 8),
    bcrypt.hash(passwordB!, 8),
  ]);
  await pool.execute(
    "INSERT INTO megadesk_domain_clients(client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES('e2e-supplier-a','e2e-supplier-internal-a','e2e_supplier_a','Supplier Fixture A','Fixture','00000000000','Test','active','test',1,'supplier-a','[\"erp\"]','{}'),('e2e-supplier-b','e2e-supplier-internal-b','e2e_supplier_b','Supplier Fixture B','Fixture','00000000000','Test','active','test',1,'supplier-b','[\"erp\"]','{}')"
  );
  await pool.execute(
    "INSERT INTO megadesk_domain_client_users(user_id,client_id,name,email,role,status,permissions_json,password_hash) VALUES('e2e-supplier-admin-a','e2e-supplier-a','Supplier Manager A',?,'manager','active','[\"erp\"]',?),('e2e-supplier-viewer-a','e2e-supplier-a','Supplier Viewer A',?,'viewer','active','[\"erp\"]',?),('e2e-supplier-agent-a','e2e-supplier-a','Supplier Agent A',?,'agent','active','[\"erp\"]',?),('e2e-supplier-admin-b','e2e-supplier-b','Supplier Admin B',?,'admin','active','[\"erp\"]',?)",
    [adminEmail, a, viewerEmail, a, agentEmail, a, tenantBEmail, b]
  );
}
async function context(
  browser: Browser,
  viewport = { width: 1440, height: 900 }
) {
  const value = await browser.newContext({ viewport });
  contexts.add(value);
  return value;
}
async function close(value: BrowserContext) {
  try {
    await value.close();
  } finally {
    contexts.delete(value);
  }
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("seu@email.com").fill(email);
  await page.getByPlaceholder("Sua senha de acesso").fill(password);
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  const erp = page.getByRole("button", { name: "ERP", exact: true });
  const trigger = page.locator('header button[title="Abrir menu"]');
  const invalid = page.getByText("E-mail ou senha inválidos.");
  await expect
    .poll(
      async () =>
        (await invalid.isVisible())
          ? "invalid"
          : (await erp.isVisible())
            ? "erp"
            : (await trigger.isVisible())
              ? "trigger"
              : "pending",
      { message: "login deve criar a sessão ou exibir recusa pública" }
    )
    .not.toBe("pending");
  if (await invalid.isVisible())
    throw new Error("Credencial descartável recusada pelo login.");
  if (await trigger.isVisible()) await trigger.click();
  await expect(erp).toBeVisible();
  await erp.click();
  await expect(page.getByTestId("erp-workspace")).toBeVisible();
  await page
    .getByTestId("erp-workspace")
    .getByRole("button", { name: "Fornecedores", exact: true })
    .click();
  await expect(page).toHaveURL(/\/erp\/fornecedores$/);
}
async function createSupplier(page: Page, legalName: string, taxId: string) {
  await page.getByRole("button", { name: "Novo fornecedor" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Razão social / nome").fill(legalName);
  await dialog.getByLabel("Nome fantasia").fill(`${legalName} Fantasia`);
  await dialog.getByLabel("CNPJ").fill(taxId);
  await dialog
    .getByLabel("E-mail")
    .fill(`${legalName.toLowerCase().replace(/\W/g, "-")}@example.invalid`);
  await dialog.getByLabel("Cidade").fill("Recife");
  await dialog.getByLabel("UF").fill("PE");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    page.getByText("Fornecedor cadastrado com sucesso.")
  ).toBeVisible();
}
function row(page: Page, name: string) {
  return page
    .getByTestId("erp-suppliers-page")
    .getByRole("row")
    .filter({ hasText: name });
}

test.describe.serial("ERP suppliers real MySQL", () => {
  test.beforeAll(async () => {
    if (!databaseUrl || !passwordA || !passwordB)
      throw new Error("Credenciais físicas descartáveis obrigatórias.");
    pool = mysql.createPool(databaseUrl);
    await fixtures();
  });
  test.afterAll(async () => {
    for (const value of contexts) await value.close();
    contexts.clear();
    await clean();
    await pool.end();
  });
  test("manager creates, fully edits, rejects duplicate, filters, paginates and persists", async ({
    browser,
  }) => {
    const ctx = await context(browser);
    const page = await ctx.newPage();
    try {
      await login(page, adminEmail, passwordA!);
      await shot(page, "01-workspace-empty.png");
      await page.getByRole("button", { name: "Novo fornecedor" }).click();
      await shot(page, "01-create-form.png");
      await page.getByRole("button", { name: "Cancelar" }).click();
      await createSupplier(page, "Fornecedor Alfa", "12.345.678/0001-90");
      await row(page, "Fornecedor Alfa")
        .getByRole("button", { name: "Editar" })
        .click();
      const dialog = page.getByRole("dialog");
      await shot(page, "01-edit-form.png");
      await dialog
        .getByLabel("Razão social / nome")
        .fill("Fornecedor Alfa Editado");
      await dialog.getByLabel("Contato").fill("Maria");
      await dialog.getByLabel("CEP").fill("50.000-000");
      await dialog.getByLabel("Logradouro").fill("Rua B");
      await dialog.getByLabel("Número").fill("20");
      await dialog.getByLabel("Bairro").fill("Centro");
      await dialog.getByLabel("Observações").fill("Persistência completa");
      await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
      await expect(
        page.getByText("Fornecedor atualizado com sucesso.")
      ).toBeVisible();
      await page.reload();
      await expect(row(page, "Fornecedor Alfa Editado")).toBeVisible();
      await shot(page, "02-list-filled.png");
      await page.getByRole("button", { name: "Novo fornecedor" }).click();
      await page.getByLabel("Razão social / nome").fill("Duplicado");
      await page.getByLabel("CNPJ").fill("12.345.678/0001-90");
      await page.getByRole("button", { name: "Salvar", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("já cadastrado");
      await shot(page, "03-duplicate.png");
      await page.getByRole("button", { name: "Cancelar" }).click();
      for (let i = 2; i <= 12; i++)
        await pool.execute(
          "INSERT INTO erp_suppliers(public_id,client_id,legal_name,person_type,tax_id,city,state,active,created_by) VALUES(?, 'e2e-supplier-a', ?, 'legal', ?, 'Recife', 'PE', 1, 'e2e-supplier-admin-a')",
          [
            crypto.randomUUID(),
            `Fornecedor ${String(i).padStart(2, "0")}`,
            `12345678${String(i).padStart(6, "0")}`,
          ]
        );
      await page.reload();
      await page.getByLabel("Itens por página").selectOption("10");
      await expect(page.getByText("Página 1 de 2")).toBeVisible();
      await shot(page, "04-pagination.png");
      await page.getByRole("button", { name: "Próxima" }).click();
      await expect(page.getByText("Página 2 de 2")).toBeVisible();
      await page.getByPlaceholder(/Razão social/).fill("Alfa Editado");
      await expect(row(page, "Fornecedor Alfa Editado")).toBeVisible();
      await page.getByRole("button", { name: "Limpar filtros" }).click();
      await page.getByLabel("Ordenar fornecedores").selectOption("createdAt");
      await page.getByLabel("Direção da ordenação").selectOption("desc");
      await page.getByPlaceholder(/Razão social/).fill("Alfa Editado");
      const own = row(page, "Fornecedor Alfa Editado");
      await own.getByRole("button", { name: "Inativar" }).click();
      await page.getByLabel("Filtrar status").selectOption("inactive");
      await expect(own).toBeVisible();
      await shot(page, "05-inactive.png");
      await own.getByRole("button", { name: "Ativar" }).click();
    } finally {
      await close(ctx);
    }
  });
  test("tenant B starts empty, remains isolated and reuses the document", async ({
    browser,
  }) => {
    const ctx = await context(browser);
    const page = await ctx.newPage();
    try {
      await login(page, tenantBEmail, passwordB!);
      await expect(
        page.getByText("Nenhum fornecedor cadastrado.")
      ).toBeVisible();
      await shot(page, "06-empty-tenant-b.png");
      await createSupplier(page, "Fornecedor B", "12.345.678/0001-90");
      expect(
        await pool
          .query<
            RowDataPacket[]
          >("SELECT id FROM erp_suppliers WHERE tax_id='12345678000190'")
          .then(([rows]) => rows.length)
      ).toBe(2);
      await page.getByPlaceholder(/Razão social/).fill("Fornecedor Alfa");
      await expect(
        page.getByText("Nenhum fornecedor corresponde aos filtros.")
      ).toBeVisible();
      await shot(page, "07-filter-empty.png");
    } finally {
      await close(ctx);
    }
  });
  for (const [role, email] of [
    ["viewer", viewerEmail],
    ["agent", agentEmail],
  ] as const)
    test(`${role} reads without write actions and mutation is refused`, async ({
      browser,
    }) => {
      const ctx = await context(browser, { width: 390, height: 844 });
      const page = await ctx.newPage();
      try {
        await login(page, email, passwordA!);
        for (const action of [
          "Novo fornecedor",
          "Editar",
          "Ativar",
          "Inativar",
        ])
          await expect(page.getByRole("button", { name: action })).toHaveCount(
            0
          );
        const cookie = (await ctx.cookies()).find(
          item => item.name === "megadesk_session"
        );
        expect(cookie).toBeTruthy();
        const response = await ctx.request.post(
          "/api/trpc/erp.suppliers.create",
          {
            headers: {
              Origin: process.env.PLAYWRIGHT_BASE_URL!,
              Cookie: `${cookie!.name}=${cookie!.value}`,
            },
            data: {
              json: { legalName: "Proibido", personType: "legal" },
            },
          }
        );
        expect(response.status()).toBe(403);
        await shot(page, `08-${role}-mobile.png`);
      } finally {
        await close(ctx);
      }
    });
  test("realtime refreshes only the changed tenant with a minimal payload", async ({
    browser,
  }) => {
    const ctxA = await context(browser);
    const ctxB = await context(browser);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    try {
      await login(pageA, adminEmail, passwordA!);
      await login(pageB, tenantBEmail, passwordB!);
      const cookieA = (await ctxA.cookies()).find(
        item => item.name === "megadesk_session"
      )!;
      const cookieB = (await ctxB.cookies()).find(
        item => item.name === "megadesk_session"
      )!;
      const eventsA: Record<string, unknown>[] = [];
      const eventsB: Record<string, unknown>[] = [];
      const options = (cookie: typeof cookieA) => ({
        path: "/api/ws/whatsapp",
        transports: ["websocket"] as ["websocket"],
        extraHeaders: { Cookie: `${cookie.name}=${cookie.value}` },
      });
      const socketA = io(process.env.PLAYWRIGHT_BASE_URL!, options(cookieA));
      const socketB = io(process.env.PLAYWRIGHT_BASE_URL!, options(cookieB));
      socketA.on("erp:supplier.changed", payload => eventsA.push(payload));
      socketB.on("erp:supplier.changed", payload => eventsB.push(payload));
      await Promise.all([
        new Promise<void>(resolve => socketA.once("connect", () => resolve())),
        new Promise<void>(resolve => socketB.once("connect", () => resolve())),
      ]);
      await createSupplier(pageA, "Fornecedor Realtime", "11.222.333/0001-81");
      await expect.poll(() => eventsA.length).toBeGreaterThan(0);
      expect(eventsB).toHaveLength(0);
      expect(Object.keys(eventsA[0]).sort()).toEqual([
        "occurredAt",
        "operation",
        "publicId",
      ]);
      socketA.disconnect();
      socketB.disconnect();
    } finally {
      await close(ctxA);
      await close(ctxB);
    }
  });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ])
    test(`visual layout at ${viewport.width}x${viewport.height}`, async ({
      browser,
    }) => {
      const ctx = await context(browser, viewport);
      const page = await ctx.newPage();
      try {
        await login(page, adminEmail, passwordA!);
        if (viewport.width === 1440) {
          const drawer = page.getByLabel("Menu principal");
          const openMenu = drawer.getByTitle("Abrir menu");
          if (await openMenu.isVisible()) await openMenu.click();
          await expect
            .poll(async () => (await drawer.boundingBox())?.width ?? 0)
            .toBeGreaterThan(200);
          await expect(drawer.getByRole("button", { name: "ERP", exact: true })).toHaveCount(1);
          for (const label of ["Resumo", "Produtos", "Estoque", "Fornecedores", "Compras"])
            await expect(drawer.getByRole("button", { name: label, exact: true })).toHaveCount(0);
          await shot(page, "sidebar-only-erp.png");
        }
        const geometry = await page.evaluate(() => ({
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          offenders: [...document.querySelectorAll<HTMLElement>("body *")]
            .filter(element => {
              const style = getComputedStyle(element);
              const box = element.getBoundingClientRect();
              return style.display !== "none" && box.width > 0 && box.right > innerWidth + 1;
            })
            .slice(0, 8)
            .map(element => ({ tag: element.tagName, testId: element.dataset.testid ?? null, aria: element.getAttribute("aria-label"), className: element.className.slice(0, 160), right: Math.round(element.getBoundingClientRect().right) })),
        }));
        expect(geometry, "o documento não deve exceder a viewport").toMatchObject({ viewport: viewport.width, scrollWidth: viewport.width });
        await shot(page, `viewport-${viewport.width}x${viewport.height}.png`);
        await page.getByRole("button", { name: "Novo fornecedor" }).click();
        const box = await page.getByRole("dialog").boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        await shot(page, `form-${viewport.width}x${viewport.height}.png`);
      } finally {
        await close(ctx);
      }
    });
});
