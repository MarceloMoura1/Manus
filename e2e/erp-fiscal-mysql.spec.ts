import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { validateTestDatabaseUrl } from "../server/test-integration-gates";
const enabled = process.env.RUN_DATABASE_INTEGRATION === "1",
  databaseUrl = process.env.TEST_DATABASE_URL,
  passwordA = process.env.E2E_PASSWORD_A,
  passwordB = process.env.E2E_PASSWORD_B,
  tenantA = "e2e-fiscal-a",
  tenantB = "e2e-fiscal-b",
  users = {
    admin: "fiscal-admin-a@example.invalid",
    manager: "fiscal-manager-a@example.invalid",
    viewer: "fiscal-viewer-a@example.invalid",
    agent: "fiscal-agent-a@example.invalid",
    tenantB: "fiscal-admin-b@example.invalid",
  };
let pool: Pool;
const contexts = new Set<BrowserContext>();
async function cleanup() {
  for (const sql of [
    "DELETE FROM erp_fiscal_operations WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_document_history WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_document_items WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_documents WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_document_sequences WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_settings_history WHERE client_id IN (?,?)",
    "DELETE FROM erp_fiscal_settings WHERE client_id IN (?,?)",
    "DELETE FROM erp_product_fiscal_profiles WHERE client_id IN (?,?)",
    "DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN (?,?)",
    "DELETE FROM erp_sale_orders WHERE client_id IN (?,?)",
    "DELETE i FROM erp_purchase_order_items i INNER JOIN erp_purchase_orders o ON o.id=i.purchase_order_id WHERE o.client_id IN (?,?)",
    "DELETE FROM erp_purchase_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_suppliers WHERE client_id IN (?,?)",
    "DELETE FROM erp_products WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_domain_client_users WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_domain_clients WHERE client_id IN (?,?)",
  ])
    await pool.execute(sql, [tenantA, tenantB]);
}
async function fixtures() {
  await cleanup();
  const [hashA, hashB] = await Promise.all([
    bcrypt.hash(passwordA!, 8),
    bcrypt.hash(passwordB!, 8),
  ]);
  await pool.execute(
    "INSERT INTO megadesk_domain_clients(client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES(?,'fiscal-a','fiscal_a','Fiscal A','Fixture','00000000000','Test','active','test',1,'fiscal-a','[\"erp\"]','{}'),(?,'fiscal-b','fiscal_b','Fiscal B','Fixture','00000000000','Test','active','test',1,'fiscal-b','[\"erp\"]','{}')",
    [tenantA, tenantB]
  );
  await pool.execute(
    "INSERT INTO megadesk_domain_client_users(user_id,client_id,name,email,role,status,permissions_json,password_hash) VALUES('fiscal-admin-a',?,'Admin',?,'admin','active','[\"erp\"]',?),('fiscal-manager-a',?,'Manager',?,'manager','active','[\"erp\"]',?),('fiscal-viewer-a',?,'Viewer',?,'viewer','active','[\"erp\"]',?),('fiscal-agent-a',?,'Agent',?,'agent','active','[\"erp\"]',?),('fiscal-admin-b',?,'Admin B',?,'admin','active','[\"erp\"]',?)",
    [
      tenantA,
      users.admin,
      hashA,
      tenantA,
      users.manager,
      hashA,
      tenantA,
      users.viewer,
      hashA,
      tenantA,
      users.agent,
      hashA,
      tenantB,
      users.tenantB,
      hashB,
    ]
  );
}
async function login(page: Page, email: string, password: string, open = true) {
  await page.goto("/");
  await page.getByPlaceholder("seu@email.com").fill(email);
  await page.getByPlaceholder("Sua senha de acesso").fill(password);
  const loginResponse = page.waitForResponse(response =>
    response.url().includes("megadesk.loginByEmail")
  );
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  const response = await loginResponse;
  if (!response.ok())
    throw new Error(`Login físico falhou com HTTP ${response.status()}.`);
  const erp = page.getByRole("button", { name: "ERP", exact: true }),
    menu = page.locator('header button[title="Abrir menu"]');
  await expect
    .poll(async () => (await erp.isVisible()) || (await menu.isVisible()))
    .toBe(true);
  if (await menu.isVisible()) await menu.click();
  await erp.click();
  if (open) {
    await page
      .getByTestId("erp-workspace")
      .getByRole("button", { name: "Fiscal", exact: true })
      .click();
    await expect(page).toHaveURL(/\/erp\/fiscal$/);
  }
}
async function scalar(sql: string, v: unknown[] = []) {
  const [r] = await pool.execute<RowDataPacket[]>(sql, v);
  return Number(r[0]?.total ?? 0);
}
async function close(c: BrowserContext) {
  try {
    await c.close();
  } finally {
    contexts.delete(c);
  }
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);
}
async function sessionCookie(context: BrowserContext) {
  const cookie = (await context.cookies()).find(
    item => item.name === "megadesk_session"
  );
  if (!cookie) throw new Error("Sessão física ausente.");
  return `${cookie.name}=${cookie.value}`;
}
async function mutation(
  context: BrowserContext,
  procedure: string,
  input: unknown
) {
  return context.request.post(`/api/trpc/${procedure}`, {
    headers: {
      Origin: "http://127.0.0.1:3327",
      Cookie: await sessionCookie(context),
    },
    data: { json: input },
  });
}
test.describe.serial("ERP Fiscal real MySQL", () => {
  test.skip(
    !enabled,
    "RUN_DATABASE_INTEGRATION ausente; nenhum banco físico é acessado."
  );
  test.beforeAll(async () => {
    if (!databaseUrl || !passwordA || !passwordB)
      throw new Error("Credenciais físicas descartáveis obrigatórias.");
    pool = mysql.createPool(validateTestDatabaseUrl(databaseUrl));
    await fixtures();
  }, 60_000);
  test.afterEach(async () => {
    await Promise.allSettled([...contexts].map(close));
  });
  test.afterAll(async () => {
    await cleanup();
    await pool.end();
  });
  test("01 admin configura perfil fiscal real sem emissão", async ({
    browser,
  }) => {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    contexts.add(c);
    const p = await c.newPage();
    await login(p, users.admin, passwordA!);
    await expect(
      p.getByText("Emissão fiscal eletrônica ainda não configurada.")
    ).toBeVisible();
    await p.getByRole("button", { name: "Configuração fiscal" }).click();
    const trigger = p.getByRole("button", { name: "Configurar" });
    await trigger.click();
    let dialog = p.getByRole("dialog", { name: "Configuração fiscal" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Regime tributário")).toBeFocused();
    await p.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    dialog = p.getByRole("dialog", { name: "Configuração fiscal" });
    const bounds = await dialog.boundingBox();
    expect(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900).toBe(
      true
    );
    await p.getByLabel("CNAE principal").fill("1234567");
    await p.getByLabel("Município IBGE").fill("3550308");
    await p.getByRole("button", { name: "Salvar configuração" }).click();
    await expect
      .poll(() =>
        scalar(
          "SELECT COUNT(*) total FROM erp_fiscal_settings WHERE client_id=? AND status='ready_for_integration'",
          [tenantA]
        )
      )
      .toBe(1);
    await expect(
      p.getByRole("button", { name: /Emitir|Autorizar|Transmitir/ })
    ).toHaveCount(0);
    await noOverflow(p);
  });
  test("02 manager cria documento manual, prepara e preserva histórico", async ({
    browser,
  }) => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    contexts.add(c);
    const p = await c.newPage();
    await login(p, users.manager, passwordA!);
    await p.getByRole("button", { name: "Documentos internos" }).click();
    await p.getByRole("button", { name: "Manual" }).click();
    const dialog = p.getByRole("dialog", {
      name: "Documento interno manual",
    });
    for (const [label, value] of [
      ["Contraparte", "Parte real"],
      ["Item", "Item real"],
      ["Quantidade", "1"],
      ["Valor unitário", "10,00"],
    ] as const)
      await dialog.getByLabel(label, { exact: true }).fill(value);
    await dialog
      .getByRole("button", { name: "Criar documento interno" })
      .click();
    await expect
      .poll(() =>
        scalar(
          "SELECT COUNT(*) total FROM erp_fiscal_documents WHERE client_id=? AND type='manual'",
          [tenantA]
        )
      )
      .toBe(1);
    await p.getByRole("button", { name: /FIS-\d{4}-\d{6}/ }).click();
    await p.getByRole("button", { name: "Preparar para integração" }).click();
    await expect
      .poll(() =>
        scalar(
          "SELECT COUNT(*) total FROM erp_fiscal_document_history WHERE client_id=?",
          [tenantA]
        )
      )
      .toBe(2);
    await noOverflow(p);
  });
  test("03 cancelamento interno não altera Financeiro", async ({ browser }) => {
    const c = await browser.newContext({
      viewport: { width: 1024, height: 768 },
    });
    contexts.add(c);
    const p = await c.newPage();
    await login(p, users.admin, passwordA!);
    await p.getByRole("button", { name: "Documentos internos" }).click();
    const before = await scalar(
      "SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=?",
      [tenantA]
    );
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT public_id FROM erp_fiscal_documents WHERE client_id=? LIMIT 1",
      [tenantA]
    );
    await pool.execute(
      "UPDATE erp_fiscal_documents SET status='draft' WHERE client_id=? AND public_id=?",
      [tenantA, rows[0].public_id]
    );
    await p.reload();
    await p.getByRole("button", { name: "Documentos internos" }).click();
    const number = String(rows[0].public_id);
    const [documentRows] = await pool.execute<RowDataPacket[]>(
      "SELECT internal_number FROM erp_fiscal_documents WHERE client_id=? AND public_id=?",
      [tenantA, number]
    );
    await p
      .getByRole("cell", { name: String(documentRows[0].internal_number) })
      .click();
    p.once("dialog", d => d.accept("Cancelamento físico"));
    await p.getByRole("button", { name: "Cancelar" }).click();
    expect(
      await scalar(
        "SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=?",
        [tenantA]
      )
    ).toBe(before);
  });
  test("04 viewer é read-only e agent bloqueado no backend e DOM", async ({
    browser,
  }) => {
    for (const [email, role, allowed] of [
      [users.viewer, "viewer", true],
      [users.agent, "agent", false],
    ] as const) {
      const c = await browser.newContext({
        viewport: { width: 768, height: 1024 },
      });
      contexts.add(c);
      const p = await c.newPage();
      await login(p, email, passwordA!, allowed);
      if (allowed) {
        await p.getByRole("button", { name: "Documentos internos" }).click();
        await expect(p.getByRole("button", { name: "Manual" })).toHaveCount(0);
      } else {
        await p.goto("/erp/fiscal");
        await expect(p.getByRole("alert")).toContainText("Acesso indisponível");
        await expect(p.getByTestId("erp-fiscal-page")).toHaveCount(0);
      }
      await noOverflow(p);
      await close(c);
    }
  });
  test("05 tenant B não vê documentos de A e sessão revogada falha", async ({
    browser,
  }) => {
    const a = await browser.newContext(),
      b = await browser.newContext();
    contexts.add(a);
    contexts.add(b);
    const pa = await a.newPage(),
      pb = await b.newPage();
    await login(pa, users.admin, passwordA!);
    await login(pb, users.tenantB, passwordB!);
    await pb.getByRole("button", { name: "Documentos internos" }).click();
    await expect(pb.getByText(/FIS-\d{4}-\d{6}/)).toHaveCount(0);
    await pool.execute(
      "UPDATE megadesk_operational_sessions SET revoked_at=NOW() WHERE client_id=?",
      [tenantA]
    );
    await pa.reload();
    await expect(pa.getByPlaceholder("seu@email.com")).toBeVisible();
    await pool.execute(
      "UPDATE megadesk_domain_clients SET access_released=0 WHERE client_id=?",
      [tenantB]
    );
    await pb.reload();
    await expect(pb.getByPlaceholder("seu@email.com")).toBeVisible();
  });
  test("06 manager configura produto e cria documentos autoritativos de Compra e Venda", async ({
    browser,
  }) => {
    const productPublicId = crypto.randomUUID(),
      supplierPublicId = crypto.randomUUID(),
      purchasePublicId = crypto.randomUUID(),
      salePublicId = crypto.randomUUID();
    const [product] = await pool.execute<any>(
      "INSERT INTO erp_products(public_id,client_id,name,sku,unit,cost_price_cents,sale_price_cents,minimum_stock,created_by,updated_by) VALUES(?,?,?,'FISCAL-E2E','unit',100,200,0,'fixture','fixture')",
      [productPublicId, tenantA, "Produto fiscal E2E"]
    );
    const [supplier] = await pool.execute<any>(
      "INSERT INTO erp_suppliers(public_id,client_id,legal_name,person_type,tax_id,active,created_by,updated_by) VALUES(?,?,?,'legal','12345678000190',1,'fixture','fixture')",
      [supplierPublicId, tenantA, "Fornecedor fiscal E2E"]
    );
    await pool.execute(
      "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,cpf_cnpj,status) VALUES('fiscal-customer-e2e',?,'Cliente fiscal E2E','12345678901','ativo')",
      [tenantA]
    );
    const [purchase] = await pool.execute<any>(
      "INSERT INTO erp_purchase_orders(public_id,client_id,order_number,supplier_id,supplier_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,'PO-FISCAL-E2E',?,'Fornecedor fiscal E2E','received',300,300,'fixture')",
      [purchasePublicId, tenantA, supplier.insertId]
    );
    const [sale] = await pool.execute<any>(
      "INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,'SO-FISCAL-E2E','fiscal-customer-e2e','Cliente fiscal E2E','fulfilled',600,600,'fixture')",
      [salePublicId, tenantA]
    );
    await pool.execute(
      "INSERT INTO erp_purchase_order_items(public_id,purchase_order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_cost_cents,line_total_cents) VALUES(UUID(),?,?,?,'FISCAL-E2E',3,100,300)",
      [purchase.insertId, product.insertId, "Produto fiscal E2E"]
    );
    await pool.execute(
      "INSERT INTO erp_sale_order_items(public_id,sale_order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price_cents,line_total_cents) VALUES(UUID(),?,?,?,'FISCAL-E2E',3,200,600)",
      [sale.insertId, product.insertId, "Produto fiscal E2E"]
    );
    const c = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    contexts.add(c);
    const p = await c.newPage();
    await login(p, users.manager, passwordA!);
    await p.getByRole("button", { name: "Produtos incompletos" }).click();
    const productCard = p
      .locator("article")
      .filter({ hasText: "Produto fiscal E2E" });
    await productCard
      .getByRole("button", { name: "Editar perfil fiscal" })
      .click();
    const profile = p.getByRole("dialog", { name: /Perfil fiscal/ });
    await profile.getByLabel("NCM").fill("12345678");
    await profile.getByLabel("CFOP saída").fill("5102");
    await profile.getByLabel("CFOP entrada").fill("1102");
    await profile.getByRole("button", { name: "Salvar perfil" }).click();
    await expect
      .poll(() =>
        scalar(
          "SELECT COUNT(*) total FROM erp_product_fiscal_profiles WHERE client_id=? AND product_id=? AND completeness='complete'",
          [tenantA, product.insertId]
        )
      )
      .toBe(1);
    for (const [type, sourcePublicId, total] of [
      ["purchase", purchasePublicId, 300],
      ["sale", salePublicId, 600],
    ] as const) {
      const response = await mutation(c, "erp.fiscal.documents.createSource", {
        type,
        sourcePublicId,
        internalIssueDate: "2026-08-25",
        internalNotes: null,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(response.status()).toBe(200);
      expect(
        await scalar(
          "SELECT COUNT(*) total FROM erp_fiscal_documents WHERE client_id=? AND type=? AND source_public_id=? AND total_cents=?",
          [tenantA, type, sourcePublicId, total]
        )
      ).toBe(1);
    }
    expect(
      (
        await mutation(c, "erp.fiscal.documents.createSource", {
          type: "sale",
          sourcePublicId: crypto.randomUUID(),
          internalIssueDate: "2026-08-25",
          internalNotes: null,
          idempotencyKey: crypto.randomUUID(),
        })
      ).status()
    ).toBe(404);
  });
  test("07 resposta perdida repete a mesma criação sem duplicar agregado", async ({
    browser,
  }) => {
    const c = await browser.newContext({
      viewport: { width: 768, height: 1024 },
    });
    contexts.add(c);
    const p = await c.newPage();
    await login(p, users.admin, passwordA!);
    await p.getByRole("button", { name: "Documentos internos" }).click();
    await p.getByRole("button", { name: "Manual" }).click();
    const dialog = p.getByRole("dialog", { name: "Documento interno manual" });
    for (const [label, value] of [
      ["Contraparte", "Resposta perdida"],
      ["Item", "Item replay"],
      ["Quantidade", "1"],
      ["Valor unitário", "25,00"],
    ] as const)
      await dialog.getByLabel(label, { exact: true }).fill(value);
    let lostBody: unknown;
    const pattern = "**/api/trpc/erp.fiscal.documents.createManual*";
    await p.route(
      pattern,
      async route => {
        lostBody = route.request().postDataJSON();
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort("failed");
      },
      { times: 1 }
    );
    await dialog
      .getByRole("button", { name: "Criar documento interno" })
      .click();
    await expect
      .poll(() =>
        scalar(
          "SELECT COUNT(*) total FROM erp_fiscal_documents WHERE client_id=? AND party_name_snapshot='Resposta perdida'",
          [tenantA]
        )
      )
      .toBe(1);
    await p.unroute(pattern);
    await dialog
      .getByRole("button", { name: "Criar documento interno" })
      .click();
    await expect(dialog).toBeHidden();
    expect(lostBody).toBeTruthy();
    expect(
      await scalar(
        "SELECT COUNT(*) total FROM erp_fiscal_documents WHERE client_id=? AND party_name_snapshot='Resposta perdida'",
        [tenantA]
      )
    ).toBe(1);
    expect(
      await scalar(
        "SELECT COUNT(*) total FROM erp_fiscal_document_history h INNER JOIN erp_fiscal_documents d ON d.id=h.fiscal_document_id WHERE d.client_id=? AND d.party_name_snapshot='Resposta perdida'",
        [tenantA]
      )
    ).toBe(1);
  });
  test("08 deep link, retry, filtros, paginação e quatro viewports permanecem funcionais", async ({
    browser,
  }) => {
    for (let i = 1; i <= 21; i++)
      await pool.execute(
        "INSERT INTO erp_fiscal_documents(public_id,client_id,internal_number,type,status,internal_issue_date,party_name_snapshot,total_cents,created_by,updated_by) VALUES(UUID(),?,?, 'manual','draft','2026-08-25',?,100,'fixture','fixture')",
        [tenantA, `FIS-2027-${String(i).padStart(6, "0")}`, `Parte página ${i}`]
      );
    for (const [index, viewport] of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ].entries()) {
      const c = await browser.newContext({ viewport });
      contexts.add(c);
      const p = await c.newPage();
      await login(p, users.admin, passwordA!, false);
      await p.goto("/erp/fiscal");
      await expect(p).toHaveURL(/\/erp\/fiscal$/);
      await p.reload();
      await expect(p.getByTestId("erp-fiscal-page")).toBeVisible();
      if (index === 0) {
        const pattern = "**/api/trpc/erp.fiscal.documents.list*";
        await p.route(
          pattern,
          route =>
            route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  json: {
                    message: "Falha física controlada",
                    code: -32603,
                    data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
                  },
                },
              }),
            }),
          { times: 1 }
        );
        await p.getByRole("button", { name: "Documentos internos" }).click();
        await expect(p.getByText("Erro ao carregar documentos.")).toBeVisible();
        await p.unroute(pattern);
        await p.getByRole("button", { name: "Tentar novamente" }).click();
      } else
        await p.getByRole("button", { name: "Documentos internos" }).click();
      await expect(p.getByText(/Página 1 de 2|Página 1 de 3/)).toBeVisible();
      await p.getByRole("button", { name: "Próxima" }).click();
      await p
        .getByLabel("Número interno ou contraparte")
        .fill("FIS-2027-000021");
      const result =
        viewport.width < 1024
          ? p.getByRole("button", { name: /FIS-2027-000021/ })
          : p.getByRole("cell", { name: "FIS-2027-000021" });
      await expect(result).toBeVisible();
      await p.getByLabel("Origem").selectOption("manual");
      await p.getByLabel("Data inicial").fill("2026-08-25");
      await p.getByLabel("Data final").fill("2026-08-25");
      await noOverflow(p);
      const main = await p.locator("main").boundingBox();
      expect(
        main && main.x >= 0 && main.x + main.width <= viewport.width + 1
      ).toBe(true);
      await close(c);
    }
  });
});
