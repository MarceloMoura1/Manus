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
const managerEmail = "sale-manager-a@example.invalid",
  agentEmail = "sale-agent-a@example.invalid",
  viewerEmail = "sale-viewer-a@example.invalid",
  tenantBEmail = "sale-admin-b@example.invalid";
const customerA = "31111111-1111-4111-8111-111111111111",
  customerB = "32222222-2222-4222-8222-222222222222",
  productA = "41111111-1111-4111-8111-111111111111",
  productA2 = "42222222-2222-4222-8222-222222222222",
  productB = "43333333-3333-4333-8333-333333333333",
  inventoryA = "51111111-1111-4111-8111-111111111111",
  inventoryA2 = "52222222-2222-4222-8222-222222222222",
  inventoryB = "53333333-3333-4333-8333-333333333333",
  categoryA = "61111111-1111-4111-8111-111111111111",
  accountA = "71111111-1111-4111-8111-111111111111";
let pool: Pool;
const contexts = new Set<BrowserContext>();
async function count(sql:string,args:unknown[]=[]){const [rows]=await pool.execute<RowDataPacket[]>(sql,args);return Number(rows[0]?.total??0);}
async function clean() {
  for (const sql of [
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_financial_ledger WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_financial_settlements WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_financial_entries WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_sale_documents WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM megadesk_crm_client_files WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_sale_order_events WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE fi FROM erp_sale_order_fulfillment_items fi INNER JOIN erp_sale_order_fulfillments f ON f.id=fi.fulfillment_id WHERE f.client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_sale_order_fulfillments WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE h FROM erp_sale_order_history h INNER JOIN erp_sale_orders o ON o.id=h.sale_order_id WHERE o.client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_sale_orders WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_sale_document_sequences WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_sale_order_sequences WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_stock_movements WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_stock_balances WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_inventory_item_balances WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_inventory_items WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_product_audit_logs WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_products WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_financial_categories WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_financial_accounts WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM megadesk_crm_clients WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM megadesk_domain_client_users WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM megadesk_domain_clients WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
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
    "INSERT INTO megadesk_domain_clients(client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES('e2e-sale-a','e2e-sale-internal-a','e2e_sale_a','Purchase Fixture A','Fixture','00000000000','Test','active','test',1,'sale-a','[\"erp\"]','{}'),('e2e-sale-b','e2e-sale-internal-b','e2e_sale_b','Purchase Fixture B','Fixture','00000000000','Test','active','test',1,'sale-b','[\"erp\"]','{}')"
  );
  await pool.execute(
    "INSERT INTO megadesk_domain_client_users(user_id,client_id,name,email,role,status,permissions_json,password_hash) VALUES('e2e-sale-manager-a','e2e-sale-a','Purchase Manager A',?,'manager','active','[\"erp\"]',?),('e2e-sale-agent-a','e2e-sale-a','Purchase Agent A',?,'agent','active','[\"erp\"]',?),('e2e-sale-viewer-a','e2e-sale-a','Purchase Viewer A',?,'viewer','active','[\"erp\"]',?),('e2e-sale-admin-b','e2e-sale-b','Purchase Admin B',?,'admin','active','[\"erp\"]',?)",
    [managerEmail, a, agentEmail, a, viewerEmail, a, tenantBEmail, b]
  );
  await pool.execute(
    "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,responsible_name,address,city,state,cep,status) VALUES(?,'e2e-sale-a','Cliente Venda A','Responsável A','Rua Sintética, 10','São Paulo','SP','01001000','ativo'),(?,'e2e-sale-b','Cliente Venda B','Responsável B','Rua Sintética, 20','São Paulo','SP','01001000','ativo')",
    [customerA, customerB]
  );
  await pool.execute(
    "INSERT INTO erp_products(public_id,client_id,name,sku,unit,cost_price_cents,sale_price_cents,minimum_stock,active,created_by) VALUES(?,'e2e-sale-a','Produto Venda A','SALE-A','unit',0,101,0,1,'fixture'),(?,'e2e-sale-a','Produto Venda A2','SALE-A2','unit',0,202,0,1,'fixture'),(?,'e2e-sale-b','Produto Venda B','SALE-B','unit',0,303,0,1,'fixture')",
    [productA, productA2, productB]
  );
  await pool.execute(
    "INSERT INTO erp_inventory_items(public_id,client_id,product_id,kind,active,created_by) SELECT ?,client_id,id,'simple',1,'fixture' FROM erp_products WHERE public_id=? UNION ALL SELECT ?,client_id,id,'simple',1,'fixture' FROM erp_products WHERE public_id=? UNION ALL SELECT ?,client_id,id,'simple',1,'fixture' FROM erp_products WHERE public_id=?",
    [inventoryA, productA, inventoryA2, productA2, inventoryB, productB]
  );
  await pool.execute(
    "INSERT INTO erp_inventory_item_balances(client_id,inventory_item_id,quantity,version) SELECT client_id,id,10,0 FROM erp_inventory_items WHERE public_id IN (?,?,?)",
    [inventoryA, inventoryA2, inventoryB]
  );
  await pool.execute(
    "INSERT INTO erp_stock_balances(client_id,product_id,quantity,version) SELECT client_id,id,10,0 FROM erp_products WHERE public_id IN (?,?,?)",
    [productA, productA2, productB]
  );
  await pool.execute(
    "INSERT INTO erp_financial_categories(public_id,client_id,name,direction) VALUES(?,'e2e-sale-a','Receita E2E','receivable')",
    [categoryA]
  );
  await pool.execute(
    "INSERT INTO erp_financial_accounts(public_id,client_id,name,type,initial_balance_cents,current_balance_cents,active,created_by) VALUES(?,'e2e-sale-a','Conta E2E','bank',0,0,1,'fixture')",
    [accountA]
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
  await page.getByRole("button", { name: "Vendas", exact: true }).click();
  await expect(page).toHaveURL(/\/erp\/vendas$/);
}
async function createDraft(page: Page, commercialDate = "2026-10-05") {
  await page.getByRole("button", { name: "Novo documento" }).click();
  await page.getByRole("menuitem", { name: "Nova venda" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova venda" });
  await dialog.getByLabel("Buscar cliente para a venda").fill("Cliente Venda A");
  await dialog.getByRole("button", { name: /Cliente Venda A/ }).click();
  await dialog.getByLabel("Buscar produto para a venda").fill("Produto Venda A");
  await dialog.getByRole("button", { name: /Produto Venda A/ }).first().click();
  await dialog.getByLabel("Quantidade").fill("2.500");
  await dialog.getByLabel("Preço unit.").fill("1,01");
  await dialog.getByLabel("Data comercial").fill(commercialDate);
  await dialog.getByRole("button", { name: "Salvar venda" }).click();
  const heading = page.getByRole("heading", { name: /^Venda V-\d+$/ });
  await expect(heading).toBeVisible();
  return (await heading.textContent())!.replace(/^Venda /, "");
}

test.describe.serial("ERP sales real MySQL", () => {
  test.beforeAll(async () => {
    if (!databaseUrl || !passwordA || !passwordB)
      throw new Error("Credenciais fÃ­sicas descartÃ¡veis obrigatÃ³rias.");
    pool = mysql.createPool(databaseUrl);
    await fixtures();
  });
  test.afterAll(async () => {
    for (const context of contexts) await context.close();
    contexts.clear();
    await clean();
    await pool.end();
  });
  test("manager creates, edits, confirms and ships through the V5 UI", async ({
    browser,
  }) => {
    const context = await newContext(browser),
      page = await context.newPage();
    try {
      await login(page, managerEmail, passwordA!);
      const orderNumber = await createDraft(page);
      if (!orderNumber) throw new Error("NÃºmero pÃºblico do pedido ausente.");
      await expect(
        page
          .getByTestId("sales-detail-facts")
          .getByText("05/10/2026", { exact: true })
      ).toBeVisible();
      await page.getByRole("button", { name: "Editar" }).click();
      const edit = page.getByRole("dialog", { name: "Editar venda" });
      await expect(edit.getByLabel("Vendedor(a)")).toHaveValue("e2e-sale-manager-a");
      await edit.getByLabel("Quantidade").fill("3.000");
      await edit.getByLabel("Observações").fill("Edição V5 física");
      await edit.getByRole("button", { name: "Salvar venda" }).click();
      await expect(edit).toBeHidden();
      await expect(page.getByRole("button", { name: "Confirmar", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Confirmar", exact: true }).click();
      const confirmation = page.getByRole("dialog", { name: "Confirmar venda" });
      await expect(confirmation.getByLabel("Categoria financeira")).toHaveValue(categoryA);
      await expect(confirmation.getByLabel("Conta prevista")).toHaveValue(accountA);
      await confirmation.getByRole("button", { name: "Confirmar venda e criar títulos" }).click();
      await expect(page.getByRole("button", { name: "Iniciar separação" })).toBeVisible();
      await page.getByRole("button", { name: "Iniciar separação" }).click();
      await page.getByRole("dialog", { name: "Mover para Separação" }).getByRole("button", { name: "Confirmar etapa" }).click();
      await expect(page.getByRole("button", { name: "Marcar como enviado" })).toBeVisible();
      await page.getByRole("button", { name: "Marcar como enviado" }).click();
      await page.getByRole("dialog", { name: "Mover para Enviado" }).getByRole("button", { name: "Revalidar e enviar" }).click();
      await expect(page.getByRole("button", { name: "Marcar como recebido" })).toBeVisible();
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT o.status,o.current_stage,o.seller_user_id,b.quantity,m.type FROM erp_sale_orders o INNER JOIN erp_sale_order_items i ON i.sale_order_id=o.id INNER JOIN erp_inventory_item_balances b ON b.client_id=o.client_id AND b.inventory_item_id=i.inventory_item_id INNER JOIN erp_stock_movements m ON m.client_id=o.client_id AND m.reference_id=o.public_id WHERE o.client_id='e2e-sale-a' AND o.order_number=?",
        [orderNumber]
      );
      expect(rows[0]).toMatchObject({
        status: "confirmed",
        current_stage: "shipped",
        seller_user_id: "e2e-sale-manager-a",
        quantity: "7.000",
        type: "sale_out",
      });
      const cookie=(await context.cookies()).find(item=>item.name==="megadesk_session"); if(!cookie) throw new Error("cookie manager ausente");
      const post=(crmClientId:string,productPublicId:string)=>context.request.post("/api/trpc/erp.sales.create",{headers:{Origin:process.env.PLAYWRIGHT_BASE_URL!,Cookie:`${cookie.name}=${cookie.value}`},data:{json:{crmClientId,items:[{productPublicId,quantity:"1",unitPriceCents:100}]}}});
      expect((await post(customerB,productA)).status()).toBe(404);
      expect((await post(customerA,productB)).status()).toBe(404);
    } finally {
      await close(context);
    }
  });
  test("mobile card keeps the commercial date and cancellation remains audited", async ({ browser }) => {
    const context = await newContext(browser, { width: 390, height: 844 }),
      page = await context.newPage();
    try {
      await login(page, managerEmail, passwordA!);
      const orderNumber = await createDraft(page, "2026-10-05");
      await page.getByRole("button", { name: "Voltar para vendas" }).click();
      const card = page.locator("article").filter({ hasText: orderNumber });
      await expect(card).toContainText("05/10/2026");
      await card.getByRole("button", { name: new RegExp(`Ações de venda ${orderNumber}`) }).click();
      await page.getByRole("menuitem", { name: "Cancelar venda" }).click();
      const cancellation = page.getByRole("dialog", { name: "Cancelar venda" });
      await cancellation.getByLabel("Motivo").fill("Cancelamento físico V5");
      await cancellation.getByRole("button", { name: "Cancelar venda" }).click();
      const cancelledLabels = page.getByText("Venda cancelada", { exact: true });
      await expect(cancelledLabels).toHaveCount(2);
      await expect(cancelledLabels.first()).toBeVisible();
      expect(await count(
        "SELECT COUNT(*) total FROM erp_sale_order_events e INNER JOIN erp_sale_orders o ON o.id=e.sale_order_id WHERE o.client_id='e2e-sale-a' AND o.order_number=? AND e.event_type='cancelled'",
        [orderNumber]
      )).toBe(1);
    } finally {
      await close(context);
    }
  });
  for (const identity of [
    { email: agentEmail, role: "agent" },
    { email: viewerEmail, role: "viewer" },
  ])
    test(`${identity.role} reads without V5 write actions`, async ({
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
          page.getByRole("button", { name: "Novo documento" })
        ).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Confirmar" })).toHaveCount(
          0
        );
        const cookie=(await context.cookies()).find(item=>item.name==="megadesk_session");
        if(!cookie) throw new Error("cookie real read-only ausente");
        const before=await count("SELECT COUNT(*) total FROM erp_sale_orders WHERE client_id='e2e-sale-a'");
        const response=await context.request.post("/api/trpc/erp.sales.create",{headers:{Origin:process.env.PLAYWRIGHT_BASE_URL!,Cookie:`${cookie.name}=${cookie.value}`},data:{json:{crmClientId:customerA,items:[{productPublicId:productA,inventoryItemPublicId:inventoryA,quantity:"1",unitPriceCents:101}]}}});
        expect(response.status()).toBe(403);
        expect(await count("SELECT COUNT(*) total FROM erp_sale_orders WHERE client_id='e2e-sale-a'")).toBe(before);
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
  test("tenant B remains isolated with V5 pagination", async ({ browser }) => {
    const context = await newContext(browser, { width: 390, height: 844 }),
      page = await context.newPage();
    try {
      for(let index=1;index<=7;index++) await pool.execute("INSERT INTO erp_sale_orders(public_id,client_id,order_number,document_type,commercial_status,commercial_date,crm_client_id,customer_name_snapshot,status,current_stage,subtotal_cents,total_cents,created_by) VALUES(?,'e2e-sale-b',?,'sale','active','2026-10-05',?,'Cliente Venda B','draft','created',?,?,'e2e-sale-admin-b')",[crypto.randomUUID(),`V-${index}`,customerB,index,index]);
      await login(page, tenantBEmail, passwordB!);
      const pagination = page.getByRole("navigation", {
          name: "Paginação dos documentos comerciais",
        }),
        next = pagination.getByRole("button", { name: "Próxima página" }),
        previous = pagination.getByRole("button", { name: "Página anterior" });
      await expect(
        pagination.getByRole("button", { name: "Página 1" })
      ).toHaveAttribute("aria-current", "page");
      const first = await page.locator("article").allTextContents();
      expect(first).toHaveLength(6);
      expect(first.join(" ")).not.toContain("Cliente Venda A");
      await next.click();
      await expect(
        pagination.getByRole("button", { name: "Página 2" })
      ).toHaveAttribute("aria-current", "page");
      const second = await page.locator("article").allTextContents();
      expect(second).toHaveLength(1);
      expect(second).not.toEqual(first);
      await previous.click();
      await expect(
        pagination.getByRole("button", { name: "Página 1" })
      ).toHaveAttribute("aria-current", "page");
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
