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
let pool: Pool;
const contexts = new Set<BrowserContext>();
async function count(sql:string,args:unknown[]=[]){const [rows]=await pool.execute<RowDataPacket[]>(sql,args);return Number(rows[0]?.total??0);}
async function clean() {
  for (const sql of [
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE fi FROM erp_sale_order_fulfillment_items fi INNER JOIN erp_sale_order_fulfillments f ON f.id=fi.fulfillment_id WHERE f.client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_sale_order_fulfillments WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE h FROM erp_sale_order_history h INNER JOIN erp_sale_orders o ON o.id=h.sale_order_id WHERE o.client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE i FROM erp_sale_order_items i INNER JOIN erp_sale_orders o ON o.id=i.sale_order_id WHERE o.client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_sale_orders WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_sale_order_sequences WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_stock_movements WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_stock_balances WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
    "DELETE FROM erp_products WHERE client_id IN ('e2e-sale-a','e2e-sale-b')",
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
    "INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES('31111111-1111-4111-8111-111111111111','e2e-sale-a','Cliente Venda A','ativo'),('32222222-2222-4222-8222-222222222222','e2e-sale-b','Cliente Venda B','ativo')"
  );
  await pool.execute(
    "INSERT INTO erp_products(public_id,client_id,name,sku,unit,cost_price_cents,sale_price_cents,minimum_stock,active,created_by) VALUES('41111111-1111-4111-8111-111111111111','e2e-sale-a','Produto Compra A','PUR-A','unit',0,0,0,1,'fixture'),('42222222-2222-4222-8222-222222222222','e2e-sale-a','Produto Compra A2','PUR-A2','unit',0,0,0,1,'fixture'),('43333333-3333-4333-8333-333333333333','e2e-sale-b','Produto Compra B','PUR-B','unit',0,0,0,1,'fixture')"
  );
  await pool.execute(
    "INSERT INTO erp_stock_balances(client_id,product_id,quantity,version) SELECT client_id,id,10,0 FROM erp_products WHERE client_id IN ('e2e-sale-a','e2e-sale-b')"
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
    .getByRole("button", { name: "Vendas", exact: true })
    .click();
  await expect(page).toHaveURL(/\/erp\/vendas$/);
}
async function createDraft(page: Page) {
  await page.getByRole("button", { name: "Novo pedido" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo pedido" });
  await dialog
    .getByLabel("Cliente")
    .selectOption("31111111-1111-4111-8111-111111111111");
  const first = dialog.getByRole("group", { name: "Item 1" });
  await first
    .getByLabel("Produto")
    .selectOption("41111111-1111-4111-8111-111111111111");
  await first.getByLabel("Quantidade").fill("2.500");
  await first.getByLabel("Preço unitário").fill("101");
  await dialog.getByRole("button", { name: "Adicionar item" }).click();
  const second = dialog.getByRole("group", { name: "Item 2" });
  await second
    .getByLabel("Produto")
    .selectOption("42222222-2222-4222-8222-222222222222");
  await second.getByRole("button", { name: "Remover item" }).click();
  await dialog.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Pedido criado com sucesso.")).toBeVisible();
  return page.getByText(/SO-\d{4}-\d{6}/).first();
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
  test("manager creates, edits, approves and fulfills with real stock ledger", async ({
    browser,
  }) => {
    const context = await newContext(browser),
      page = await context.newPage();
    try {
      await login(page, managerEmail, passwordA!);
      const number = await createDraft(page);
      await expect(number).toBeVisible();
      const orderNumber = await number.textContent();
      if (!orderNumber) throw new Error("NÃºmero pÃºblico do pedido ausente.");
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
      await card.getByRole("button", { name: "Confirmar" }).click();
      await expect(
        page.getByText("Pedido confirmado com sucesso.")
      ).toBeVisible();
      let lostResponses = 0;
      let lostBody: unknown, lostUrl = "";
      const fulfillPattern = "**/api/trpc/erp.sales.fulfill*";
      await page.route(fulfillPattern, async route => {
        lostResponses++;
        lostBody = route.request().postDataJSON();
        lostUrl = route.request().url();
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort("failed");
      });
      page.once("dialog", dialog => dialog.accept());
      await card.getByRole("button", { name: "Concluir venda" }).click();
      await expect.poll(async () => Number((await pool.execute<RowDataPacket[]>("SELECT COUNT(*) total FROM erp_sale_order_fulfillments f INNER JOIN erp_sale_orders o ON o.id=f.sale_order_id WHERE o.client_id='e2e-sale-a' AND o.order_number=?",[orderNumber]))[0][0].total)).toBe(1);
      expect(lostResponses).toBe(1);
      await page.unroute(fulfillPattern);
      const replay=await context.request.post(lostUrl,{headers:{Origin:process.env.PLAYWRIGHT_BASE_URL!},data:lostBody});
      expect(replay.status()).toBe(200);
      await expect(card.getByText("Concluído",{exact:true})).toBeVisible();
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT o.status,b.quantity,m.type,m.previous_balance,m.resulting_balance FROM erp_sale_orders o INNER JOIN erp_sale_order_items i ON i.sale_order_id=o.id INNER JOIN erp_stock_balances b ON b.product_id=i.product_id AND b.client_id=o.client_id INNER JOIN erp_stock_movements m ON m.product_id=i.product_id AND m.client_id=o.client_id WHERE o.client_id='e2e-sale-a' AND o.order_number=?",
        [orderNumber]
      );
      expect(rows[0]).toMatchObject({
        status: "fulfilled",
        quantity: "7.000",
        type: "sale_out",
        previous_balance: "10.000",
        resulting_balance: "7.000",
      });
      expect(await count("SELECT COUNT(*) total FROM erp_sale_order_fulfillments f INNER JOIN erp_sale_orders o ON o.id=f.sale_order_id WHERE o.client_id='e2e-sale-a' AND o.order_number=?",[orderNumber])).toBe(1);
      const cookie=(await context.cookies()).find(item=>item.name==="megadesk_session"); if(!cookie) throw new Error("cookie manager ausente");
      const post=(crmClientId:string,productPublicId:string)=>context.request.post("/api/trpc/erp.sales.create",{headers:{Origin:process.env.PLAYWRIGHT_BASE_URL!,Cookie:`${cookie.name}=${cookie.value}`},data:{json:{crmClientId,items:[{productPublicId,quantity:"1",unitPriceCents:100}]}}});
      expect((await post("32222222-2222-4222-8222-222222222222","41111111-1111-4111-8111-111111111111")).status()).toBe(404);
      expect((await post("31111111-1111-4111-8111-111111111111","43333333-3333-4333-8333-333333333333")).status()).toBe(404);
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
        .getByLabel("Filtrar status de venda")
        .selectOption("cancelled");
      await expect(page.getByText("Cancelado").last()).toBeVisible();
      await page.getByLabel("Filtrar status de venda").selectOption("all");
      const insufficientNumber=await createDraft(page), insufficientText=await insufficientNumber.textContent(); if(!insufficientText) throw new Error("pedido insuficiente sem número");
      const insufficientCard=page.locator("article").filter({hasText:insufficientText}); await insufficientCard.getByRole("button",{name:"Editar"}).click(); await page.getByRole("dialog",{name:"Editar pedido"}).getByLabel("Quantidade").fill("99"); await page.getByRole("button",{name:"Salvar rascunho"}).click();
      page.once("dialog",dialog=>dialog.accept()); await insufficientCard.getByRole("button",{name:"Confirmar"}).click(); await expect(page.getByText("Pedido confirmado com sucesso.")).toBeVisible();
      const rejected=page.waitForResponse(response=>response.url().includes("erp.sales.fulfill")); page.once("dialog",dialog=>dialog.accept()); await insufficientCard.getByRole("button",{name:"Concluir venda"}).click(); expect((await rejected).status()).toBe(400); await expect(page.getByText("Venda concluída e estoque atualizado.")).toHaveCount(0);
      const [insufficientRows]=await pool.execute<RowDataPacket[]>("SELECT o.status,(SELECT COUNT(*) FROM erp_stock_movements m WHERE m.client_id=o.client_id AND m.reference_type='sale' AND m.reference_id=o.public_id) movements FROM erp_sale_orders o WHERE o.client_id='e2e-sale-a' AND o.order_number=?",[insufficientText]); expect(insufficientRows[0]).toMatchObject({status:"confirmed",movements:0});
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
        await expect(page.getByRole("button", { name: "Confirmar" })).toHaveCount(
          0
        );
        const cookie=(await context.cookies()).find(item=>item.name==="megadesk_session");
        if(!cookie) throw new Error("cookie real read-only ausente");
        const before=await count("SELECT COUNT(*) total FROM erp_sale_orders WHERE client_id='e2e-sale-a'");
        const response=await context.request.post("/api/trpc/erp.sales.create",{headers:{Origin:process.env.PLAYWRIGHT_BASE_URL!,Cookie:`${cookie.name}=${cookie.value}`},data:{json:{crmClientId:"31111111-1111-4111-8111-111111111111",items:[{productPublicId:"41111111-1111-4111-8111-111111111111",quantity:"1",unitPriceCents:100}]}}});
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
  test("tenant B remains isolated and exercises real pagination", async ({ browser }) => {
    const context = await newContext(browser, { width: 768, height: 1024 }),
      page = await context.newPage();
    try {
      for(let index=1;index<=21;index++) await pool.execute("INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,'e2e-sale-b',?,'32222222-2222-4222-8222-222222222222','Cliente Venda B','draft',?,?,'e2e-sale-admin-b')",[crypto.randomUUID(),`SO-${new Date().getUTCFullYear()}-${String(index).padStart(6,"0")}`,index,index]);
      await login(page, tenantBEmail, passwordB!);
      const next=page.getByRole("button",{name:/xima$/}), previous=page.getByRole("button",{name:"Anterior"}), pagination=page.locator("nav").filter({has:next}); await expect(pagination.getByText(/1 de 2/)).toBeVisible();
      const first=await page.locator("article").allTextContents(); expect(first).toHaveLength(20); expect(first.join(" ")).not.toContain("Cliente Venda A");
      await next.click(); await expect(pagination.getByText(/2 de 2/)).toBeVisible(); const second=await page.locator("article").allTextContents(); expect(second).toHaveLength(1); expect(second).not.toEqual(first);
      await previous.click(); await expect(pagination.getByText(/1 de 2/)).toBeVisible();
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
