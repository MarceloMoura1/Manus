import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.TEST_DATABASE_URL,
  passwordA = process.env.E2E_PASSWORD_A,
  passwordB = process.env.E2E_PASSWORD_B;
const managerEmail = "purchase-manager-a@example.invalid",
  agentEmail = "purchase-agent-a@example.invalid",
  viewerEmail = "purchase-viewer-a@example.invalid",
  tenantBEmail = "purchase-admin-b@example.invalid";
let pool: Pool;
const contexts = new Set<BrowserContext>();
async function clean() {
  for (const sql of [
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE ri FROM erp_purchase_order_receipt_items ri INNER JOIN erp_purchase_order_receipts r ON r.id=ri.receipt_id WHERE r.client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE FROM erp_purchase_order_receipts WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE h FROM erp_purchase_order_history h INNER JOIN erp_purchase_orders o ON o.id=h.purchase_order_id WHERE o.client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE i FROM erp_purchase_order_items i INNER JOIN erp_purchase_orders o ON o.id=i.purchase_order_id WHERE o.client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE FROM erp_purchase_orders WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE FROM erp_purchase_order_sequences WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE FROM erp_stock_movements WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE FROM erp_stock_balances WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE FROM erp_products WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE FROM erp_suppliers WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE FROM megadesk_domain_client_users WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
    "DELETE FROM megadesk_domain_clients WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')",
  ])
    await pool.execute(sql);
}
async function fixtures() {
  await clean();
  const [a, b] = await Promise.all([
    bcrypt.hash(passwordA!, 8),
    bcrypt.hash(passwordB!, 8),
  ]);
  await pool.execute(
    "INSERT INTO megadesk_domain_clients(client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES('e2e-purchase-a','e2e-purchase-internal-a','e2e_purchase_a','Purchase Fixture A','Fixture','00000000000','Test','active','test',1,'purchase-a','[\"erp\"]','{}'),('e2e-purchase-b','e2e-purchase-internal-b','e2e_purchase_b','Purchase Fixture B','Fixture','00000000000','Test','active','test',1,'purchase-b','[\"erp\"]','{}')"
  );
  await pool.execute(
    "INSERT INTO megadesk_domain_client_users(user_id,client_id,name,email,role,status,permissions_json,password_hash) VALUES('e2e-purchase-manager-a','e2e-purchase-a','Purchase Manager A',?,'manager','active','[\"erp\"]',?),('e2e-purchase-agent-a','e2e-purchase-a','Purchase Agent A',?,'agent','active','[\"erp\"]',?),('e2e-purchase-viewer-a','e2e-purchase-a','Purchase Viewer A',?,'viewer','active','[\"erp\"]',?),('e2e-purchase-admin-b','e2e-purchase-b','Purchase Admin B',?,'admin','active','[\"erp\"]',?)",
    [managerEmail, a, agentEmail, a, viewerEmail, a, tenantBEmail, b]
  );
  await pool.execute(
    "INSERT INTO erp_suppliers(public_id,client_id,legal_name,person_type,tax_id,active,created_by) VALUES('31111111-1111-4111-8111-111111111111','e2e-purchase-a','Fornecedor Compra A','legal','12345678000190',1,'fixture'),('32222222-2222-4222-8222-222222222222','e2e-purchase-b','Fornecedor Compra B','legal','12345678000190',1,'fixture')"
  );
  await pool.execute(
    "INSERT INTO erp_products(public_id,client_id,name,sku,unit,cost_price_cents,sale_price_cents,minimum_stock,active,created_by) VALUES('41111111-1111-4111-8111-111111111111','e2e-purchase-a','Produto Compra A','PUR-A','unit',0,0,0,1,'fixture'),('42222222-2222-4222-8222-222222222222','e2e-purchase-a','Produto Compra A2','PUR-A2','unit',0,0,0,1,'fixture'),('43333333-3333-4333-8333-333333333333','e2e-purchase-b','Produto Compra B','PUR-B','unit',0,0,0,1,'fixture')"
  );
  await pool.execute(
    "INSERT INTO erp_stock_balances(client_id,product_id,quantity,version) SELECT client_id,id,0,0 FROM erp_products WHERE client_id IN ('e2e-purchase-a','e2e-purchase-b')"
  );
}
async function newContext(
  browser: Browser,
  viewport = { width: 1440, height: 900 }
) {
  const context = await browser.newContext({ viewport });
  contexts.add(context);
  return context;
}
async function close(context: BrowserContext) {
  try {
    await context.close();
  } finally {
    contexts.delete(context);
  }
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("seu@email.com").fill(email);
  await page.getByPlaceholder("Sua senha de acesso").fill(password);
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  const erp = page.getByRole("button", { name: "ERP", exact: true }),
    trigger = page.locator('header button[title="Abrir menu"]');
  await expect
    .poll(async () => (await erp.isVisible()) || (await trigger.isVisible()))
    .toBe(true);
  if (await trigger.isVisible()) await trigger.click();
  await erp.click();
  await page
    .getByTestId("erp-workspace")
    .getByRole("button", { name: "Compras", exact: true })
    .click();
  await expect(page).toHaveURL(/\/erp\/compras$/);
}
async function createDraft(page: Page) {
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo pedido" });
  await dialog
    .getByLabel("Fornecedor")
    .selectOption("31111111-1111-4111-8111-111111111111");
  const first = dialog.getByRole("group", { name: "Item 1" });
  await first
    .getByLabel("Produto")
    .selectOption("41111111-1111-4111-8111-111111111111");
  await first.getByLabel("Quantidade").fill("2.500");
  await first.getByLabel("Custo em centavos").fill("101");
  await dialog.getByRole("button", { name: "Adicionar item" }).click();
  const second = dialog.getByRole("group", { name: "Item 2" });
  await second
    .getByLabel("Produto")
    .selectOption("42222222-2222-4222-8222-222222222222");
  await second.getByRole("button", { name: "Remover item" }).click();
  await dialog.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Pedido criado com sucesso.")).toBeVisible();
  return page.getByText(/PO-\d{4}-\d{6}/).first();
}

test.describe.serial("ERP purchases real MySQL", () => {
  test.beforeAll(async () => {
    if (!databaseUrl || !passwordA || !passwordB)
      throw new Error("Credenciais físicas descartáveis obrigatórias.");
    pool = mysql.createPool(databaseUrl);
    await fixtures();
  });
  test.afterAll(async () => {
    for (const context of contexts) await context.close();
    contexts.clear();
    await clean();
    await pool.end();
  });
  test("manager creates, edits, approves and receives with real stock ledger", async ({
    browser,
  }) => {
    const context = await newContext(browser),
      page = await context.newPage();
    try {
      await login(page, managerEmail, passwordA!);
      const number = await createDraft(page);
      await expect(number).toBeVisible();
      const orderNumber = await number.textContent();
      if (!orderNumber) throw new Error("Número público do pedido ausente.");
      await page.reload();
      const card = page.locator("article").filter({ hasText: orderNumber });
      await expect(card).toHaveCount(1);
      await card.getByRole("button", { name: "Editar" }).click();
      await page
        .getByRole("dialog", { name: "Editar pedido" })
        .getByLabel("Quantidade")
        .fill("3.000");
      await page.getByRole("button", { name: "Salvar rascunho" }).click();
      page.once("dialog", dialog => dialog.accept());
      await card.getByRole("button", { name: "Aprovar" }).click();
      await expect(
        page.getByText("Pedido aprovado com sucesso.")
      ).toBeVisible();
      page.once("dialog", dialog => dialog.accept());
      await card.getByRole("button", { name: "Receber" }).click();
      await expect(
        page.getByText("Pedido recebido e estoque atualizado.")
      ).toBeVisible();
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT o.status,b.quantity,m.type,m.previous_balance,m.resulting_balance FROM erp_purchase_orders o INNER JOIN erp_purchase_order_items i ON i.purchase_order_id=o.id INNER JOIN erp_stock_balances b ON b.product_id=i.product_id AND b.client_id=o.client_id INNER JOIN erp_stock_movements m ON m.product_id=i.product_id AND m.client_id=o.client_id WHERE o.client_id='e2e-purchase-a' AND o.order_number=?",
        [orderNumber]
      );
      expect(rows[0]).toMatchObject({
        status: "received",
        quantity: "3.000",
        type: "purchase_in",
        previous_balance: "0.000",
        resulting_balance: "3.000",
      });
    } finally {
      await close(context);
    }
  });
  test("manager cancels draft and filters status", async ({ browser }) => {
    const context = await newContext(browser),
      page = await context.newPage();
    try {
      await login(page, managerEmail, passwordA!);
      await createDraft(page);
      await page.getByRole("button", { name: "Cancelar" }).last().click();
      const dialog = page.getByRole("dialog", { name: "Cancelar pedido" });
      await dialog
        .getByLabel("Motivo do cancelamento")
        .fill("Cancelamento E2E real");
      await dialog
        .getByRole("button", { name: "Confirmar cancelamento" })
        .click();
      await expect(
        page.getByText("Pedido cancelado com sucesso.")
      ).toBeVisible();
      await page
        .getByLabel("Filtrar status de compra")
        .selectOption("cancelled");
      await expect(page.getByText("Cancelado").last()).toBeVisible();
    } finally {
      await close(context);
    }
  });
  for (const identity of [
    { email: agentEmail, role: "agent" },
    { email: viewerEmail, role: "viewer" },
  ])
    test(`${identity.role} reads without write actions`, async ({
      browser,
    }) => {
      const context = await newContext(
          browser,
          identity.role === "agent"
            ? { width: 390, height: 844 }
            : { width: 1024, height: 768 }
        ),
        page = await context.newPage();
      try {
        await login(page, identity.email, passwordA!);
        await expect(
          page.getByRole("button", { name: "Novo pedido" })
        ).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Aprovar" })).toHaveCount(
          0
        );
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth
          )
        ).toBe(true);
      } finally {
        await close(context);
      }
    });
  test("tenant B remains isolated and empty", async ({ browser }) => {
    const context = await newContext(browser, { width: 768, height: 1024 }),
      page = await context.newPage();
    try {
      await login(page, tenantBEmail, passwordB!);
      await expect(
        page.getByText("Nenhum pedido de compra cadastrado.")
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        )
      ).toBe(true);
    } finally {
      await close(context);
    }
  });
});
