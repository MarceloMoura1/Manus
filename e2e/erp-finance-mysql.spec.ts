import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { validateTestDatabaseUrl } from "../server/test-integration-gates";
const enabled = process.env.RUN_DATABASE_INTEGRATION === "1";
const databaseUrl = process.env.TEST_DATABASE_URL;
const passwordA = process.env.E2E_PASSWORD_A;
const passwordB = process.env.E2E_PASSWORD_B;
const tenantA = "e2e-finance-a";
const tenantB = "e2e-finance-b";
const users = {
  admin: "finance-admin-a@example.invalid",
  manager: "finance-manager-a@example.invalid",
  viewer: "finance-viewer-a@example.invalid",
  agent: "finance-agent-a@example.invalid",
  tenantB: "finance-admin-b@example.invalid",
};
let pool: Pool;
const contexts = new Set<BrowserContext>();

async function scalar(sql: string, values: unknown[] = []) {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, values);
  return Number(rows[0]?.total ?? 0);
}

async function closeContext(context: BrowserContext) {
  try {
    await context.close();
  } finally {
    contexts.delete(context);
  }
}

async function cleanup() {
  const tenants = [tenantA, tenantB];
  for (const sql of [
    "DELETE FROM erp_financial_ledger WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_settlements WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_entries WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_categories WHERE client_id IN (?,?)",
    "DELETE FROM erp_financial_accounts WHERE client_id IN (?,?)",
    "DELETE FROM erp_purchase_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_sale_orders WHERE client_id IN (?,?)",
    "DELETE FROM erp_suppliers WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_crm_clients WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_operational_sessions WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_domain_client_users WHERE client_id IN (?,?)",
    "DELETE FROM megadesk_domain_clients WHERE client_id IN (?,?)",
  ]) await pool.execute(sql, tenants);
}

async function fixtures() {
  await cleanup();
  const [hashA, hashB] = await Promise.all([
    bcrypt.hash(passwordA!, 8),
    bcrypt.hash(passwordB!, 8),
  ]);
  await pool.execute(
    `INSERT INTO megadesk_domain_clients
      (client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json)
     VALUES (?, 'finance-internal-a', 'finance_a', 'Finance A', 'Fixture', '00000000000', 'Test', 'active', 'test', 1, 'finance-a', '["erp"]', '{}'),
            (?, 'finance-internal-b', 'finance_b', 'Finance B', 'Fixture', '00000000000', 'Test', 'active', 'test', 1, 'finance-b', '["erp"]', '{}')`,
    [tenantA, tenantB]
  );
  await pool.execute(
    `INSERT INTO megadesk_domain_client_users
      (user_id,client_id,name,email,role,status,permissions_json,password_hash)
     VALUES ('finance-admin-a',?,'Finance Admin A',?,'admin','active','["erp"]',?),
            ('finance-manager-a',?,'Finance Manager A',?,'manager','active','["erp"]',?),
            ('finance-viewer-a',?,'Finance Viewer A',?,'viewer','active','["erp"]',?),
            ('finance-agent-a',?,'Finance Agent A',?,'agent','active','["erp"]',?),
            ('finance-admin-b',?,'Finance Admin B',?,'admin','active','["erp"]',?)`,
    [tenantA,users.admin,hashA,tenantA,users.manager,hashA,tenantA,users.viewer,hashA,tenantA,users.agent,hashA,tenantB,users.tenantB,hashB]
  );
}

async function login(page: Page, email: string, password: string, openFinance = true) {
  await page.goto("/");
  await page.getByPlaceholder("seu@email.com").fill(email);
  await page.getByPlaceholder("Sua senha de acesso").fill(password);
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  const erp = page.getByRole("button", { name: "ERP", exact: true });
  const menu = page.locator('header button[title="Abrir menu"]');
  await expect.poll(async () => (await erp.isVisible()) || (await menu.isVisible())).toBe(true);
  if (await menu.isVisible()) await menu.click();
  await erp.click();
  if (openFinance) {
    await page.getByTestId("erp-workspace").getByRole("button", { name: "Financeiro", exact: true }).click();
    await expect(page).toHaveURL(/\/erp\/financeiro$/);
  }
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function sessionCookie(context: BrowserContext) {
  const cookie = (await context.cookies()).find(item => item.name === "megadesk_session");
  if (!cookie) throw new Error("Sessão física ausente.");
  return `${cookie.name}=${cookie.value}`;
}

async function references(clientId = tenantA) {
  const [accounts] = await pool.execute<RowDataPacket[]>("SELECT public_id,current_balance_cents FROM erp_financial_accounts WHERE client_id=? ORDER BY id LIMIT 1", [clientId]);
  const [categories] = await pool.execute<RowDataPacket[]>("SELECT public_id,id FROM erp_financial_categories WHERE client_id=? ORDER BY id LIMIT 1", [clientId]);
  return { accountPublicId: String(accounts[0].public_id), balance: Number(accounts[0].current_balance_cents), categoryPublicId: String(categories[0].public_id), categoryId: Number(categories[0].id) };
}

async function mutation(context: BrowserContext, procedure: string, input: unknown) {
  return context.request.post(`/api/trpc/${procedure}`, { headers: { Origin: process.env.PLAYWRIGHT_BASE_URL!, Cookie: await sessionCookie(context) }, data: { json: input } });
}

async function openEntry(page: Page, documentNumber: string) {
  const card = page.getByRole("button", { name: new RegExp(`^${documentNumber} ·`) });
  await expect(card).toBeVisible();
  await card.click();
}

test.describe.serial("ERP Financeiro real MySQL", () => {
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
    await Promise.allSettled([...contexts].map(closeContext));
  });
  test.afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  test("01 admin cria conta, opening balance e categoria pela UI real", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.add(context);
    const page = await context.newPage();
    try {
      await login(page, users.admin, passwordA!);
      await page.getByRole("button", { name: "Nova conta" }).click();
      let dialog = page.getByRole("dialog", { name: "Nova conta" });
      await dialog.getByLabel("Nome").fill("Conta Financeira Real");
      await dialog.getByLabel("Saldo inicial").fill("100,00");
      await dialog.getByRole("button", { name: "Salvar" }).click();
      await page.getByRole("button", { name: "Nova categoria" }).click();
      dialog = page.getByRole("dialog", { name: "Nova categoria" });
      await dialog.getByLabel("Nome").fill("Categoria Financeira Real");
      await dialog.getByLabel("Direção").selectOption("both");
      await dialog.getByRole("button", { name: "Salvar" }).click();
      await expect.poll(() => scalar("SELECT COUNT(*) total FROM erp_financial_ledger WHERE client_id=? AND type='opening_balance' AND amount_cents=10000", [tenantA])).toBe(1);
      await expect.poll(() => scalar("SELECT COUNT(*) total FROM erp_financial_categories WHERE client_id=? AND name='Categoria Financeira Real'", [tenantA])).toBe(1);
      await noOverflow(page);
    } finally {
      await closeContext(context);
    }
  });

  test("02 admin e manager criam payable e receivable reais", async ({ browser }) => {
    for (const [email, documentNumber, direction] of [[users.admin,"REAL-PAY","payable"],[users.manager,"REAL-REC","receivable"]] as const) {
      const context = await browser.newContext(); contexts.add(context); const page = await context.newPage();
      try { await login(page,email,passwordA!); const refs=await references(); const response=await mutation(context,"erp.finance.createManual",{documentNumber,direction,description:`Título ${documentNumber}`,amountCents:2500,dueDate:"2026-09-20",issueDate:"2026-08-24",categoryPublicId:refs.categoryPublicId,financialAccountPublicId:refs.accountPublicId,supplierPublicId:null,crmClientId:null,partyName:"Parte real",notes:null}); if(response.status()!==200)throw new Error(`createManual ${documentNumber}: ${response.status()} ${await response.text()}`); }
      finally { await closeContext(context); }
    }
    expect(await scalar("SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=?",[tenantA])).toBe(2);
  });

  test("03 liquidação payable/receivable atualiza saldo e ledger", async ({ browser }) => {
    const context=await browser.newContext({viewport:{width:768,height:1024}});contexts.add(context);const page=await context.newPage();
    try { await login(page,users.manager,passwordA!); const refs=await references(); for(const number of ["REAL-PAY","REAL-REC"]){await page.getByLabel("Buscar título").fill(number);await openEntry(page,number);await page.getByLabel("Conta para liquidação").selectOption(refs.accountPublicId);page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Liquidar integralmente"}).click();await expect.poll(()=>scalar("SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND document_number=? AND status='settled'",[tenantA,number])).toBe(1);} expect(await scalar("SELECT COUNT(*) total FROM erp_financial_settlements WHERE client_id=?",[tenantA])).toBe(2);expect(await scalar("SELECT COUNT(*) total FROM erp_financial_ledger WHERE client_id=? AND type IN ('payable_settlement','receivable_settlement')",[tenantA])).toBe(2);expect((await references()).balance).toBe(10000);await noOverflow(page); }
    finally { await closeContext(context); }
  });

  test("04 resposta perdida repete mesma mutation sem duplicar settlement ou ledger", async ({ browser }) => {
    const context=await browser.newContext({viewport:{width:1024,height:768}});contexts.add(context);const page=await context.newPage();
    try { await login(page,users.admin,passwordA!);const refs=await references();expect((await mutation(context,"erp.finance.createManual",{documentNumber:"REAL-LOST",direction:"receivable",description:"Resposta perdida",amountCents:1700,dueDate:"2026-09-20",issueDate:"2026-08-24",categoryPublicId:refs.categoryPublicId,financialAccountPublicId:refs.accountPublicId,supplierPublicId:null,crmClientId:null,partyName:null,notes:null})).status()).toBe(200);await page.reload();await page.getByLabel("Buscar título").fill("REAL-LOST");await page.getByRole("cell",{name:"REAL-LOST",exact:true}).click();await page.getByLabel("Conta para liquidação").selectOption(refs.accountPublicId);let url="",body:unknown;await page.route("**/api/trpc/erp.finance.settle*",async route=>{url=route.request().url();body=route.request().postDataJSON();const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort("failed")});page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Liquidar integralmente"}).click();await expect.poll(()=>scalar("SELECT COUNT(*) total FROM erp_financial_settlements WHERE client_id=?",[tenantA])).toBe(3);await page.unroute("**/api/trpc/erp.finance.settle*");expect((await context.request.post(url,{headers:{Origin:process.env.PLAYWRIGHT_BASE_URL!,Cookie:await sessionCookie(context)},data:body})).status()).toBe(200);expect(await scalar("SELECT COUNT(*) total FROM erp_financial_settlements WHERE client_id=?",[tenantA])).toBe(3);expect(await scalar("SELECT COUNT(*) total FROM erp_financial_ledger WHERE client_id=? AND financial_entry_id IS NOT NULL",[tenantA])).toBe(3); }
    finally { await closeContext(context); }
  });

  test("05 cancelamento preserva saldo e ledger e exige motivo", async ({ browser }) => {
    const context=await browser.newContext({viewport:{width:1024,height:768}});contexts.add(context);const page=await context.newPage();
    try { await login(page,users.admin,passwordA!);const refs=await references();await mutation(context,"erp.finance.createManual",{documentNumber:"REAL-CANCEL",direction:"payable",description:"Cancelar",amountCents:500,dueDate:"2026-09-20",issueDate:"2026-08-24",categoryPublicId:refs.categoryPublicId,financialAccountPublicId:null,supplierPublicId:null,crmClientId:null,partyName:null,notes:null});await page.reload();const before=(await references()).balance,ledger=await scalar("SELECT COUNT(*) total FROM erp_financial_ledger WHERE client_id=?",[tenantA]);await page.getByLabel("Buscar título").fill("REAL-CANCEL");await page.getByRole("cell",{name:"REAL-CANCEL",exact:true}).click();page.once("dialog",d=>d.dismiss());await page.getByRole("button",{name:"Cancelar título"}).click();expect(await scalar("SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND document_number='REAL-CANCEL' AND status='open'",[tenantA])).toBe(1);const handleDialog=(d:any)=>d.type()==="prompt"?d.accept("Motivo físico"):d.accept();page.on("dialog",handleDialog);await page.getByRole("button",{name:"Cancelar título"}).click();await expect.poll(()=>scalar("SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND document_number='REAL-CANCEL' AND status='cancelled'",[tenantA])).toBe(1);page.off("dialog",handleDialog);expect((await references()).balance).toBe(before);expect(await scalar("SELECT COUNT(*) total FROM erp_financial_ledger WHERE client_id=?",[tenantA])).toBe(ledger);await noOverflow(page); }
    finally { await closeContext(context); }
  });

  test("06 viewer lê, agent não acessa e mutations manuais retornam 403", async ({ browser }) => {
    for(const [email,role,allowed] of [[users.viewer,"viewer",true],[users.agent,"agent",false]] as const){const context=await browser.newContext({viewport:allowed?{width:1024,height:768}:{width:390,height:844}});contexts.add(context);const page=await context.newPage();try{await login(page,email,passwordA!,allowed);if(allowed)await expect(page.getByText("Acesso somente leitura.")).toBeVisible();else{await page.goto("/erp/financeiro");await expect(page.getByRole("alert")).toContainText("Acesso indisponível");await expect(page.getByTestId("erp-finance-page")).toHaveCount(0);}const refs=await references();const response=await mutation(context,"erp.finance.createManual",{documentNumber:`DENIED-${role}`,direction:"payable",description:"Negado",amountCents:100,dueDate:"2026-09-20",issueDate:"2026-08-24",categoryPublicId:refs.categoryPublicId,financialAccountPublicId:null,supplierPublicId:null,crmClientId:null,partyName:null,notes:null});expect(response.status()).toBe(403);await noOverflow(page);}finally{await closeContext(context);}}
  });

  test("07 tenant B, filtros, paginação e quatro viewports permanecem isolados", async ({ browser }) => {
    const refs=await references();for(let index=0;index<21;index++)await pool.execute("INSERT INTO erp_financial_entries(public_id,client_id,document_number,direction,status,description,amount_cents,due_date,issue_date,category_id,source_type,created_by) VALUES(UUID(),?,?,'payable','open',?,100,'2026-10-01','2026-08-24',?,'manual','fixture')",[tenantA,`PAGE-${String(index).padStart(2,"0")}`,`Busca pagina ${index}`,refs.categoryId]);
    for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}]){const context=await browser.newContext({viewport});contexts.add(context);const page=await context.newPage();try{await login(page,users.admin,passwordA!);await expect(page.getByText("Página 1 de 2")).toBeVisible();await page.getByRole("button",{name:"Próxima"}).click();await expect(page.getByText("Página 2 de 2")).toBeVisible();await page.getByLabel("Buscar título").fill("PAGE-20");const result=viewport.width<1024?page.getByRole("button",{name:/^PAGE-20 ·/}):page.getByRole("cell",{name:"PAGE-20",exact:true});await expect(result).toBeVisible();await noOverflow(page);}finally{await closeContext(context);}}
    const context=await browser.newContext();contexts.add(context);const page=await context.newPage();try{await login(page,users.tenantB,passwordB!);await expect(page.getByText("Nenhum título encontrado.")).toBeVisible();expect(await scalar("SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=?",[tenantB])).toBe(0);await noOverflow(page);}finally{await closeContext(context);}
  });

  test("08 manager gera Compra/Venda autoritativas, rejeita status inválido e replay", async ({ browser }) => {
    const supplierPublicId=crypto.randomUUID(),purchase=crypto.randomUUID(),purchaseInvalid=crypto.randomUUID(),sale=crypto.randomUUID(),saleInvalid=crypto.randomUUID();
    const [supplier]=await pool.execute<any>("INSERT INTO erp_suppliers(public_id,client_id,legal_name,person_type,tax_id,active,created_by,updated_by) VALUES(?,?,'Fornecedor origem','legal','12345678000190',1,'fixture','fixture')",[supplierPublicId,tenantA]);
    await pool.execute("INSERT INTO megadesk_crm_clients(crm_client_id,client_id,company_name,status) VALUES('finance-customer-a',?,'Cliente origem','ativo')",[tenantA]);
    await pool.execute("INSERT INTO erp_purchase_orders(public_id,client_id,order_number,supplier_id,supplier_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,'PO-REAL',?,'Fornecedor origem','received',7300,7300,'fixture'),(?,?,'PO-INVALID',?,'Fornecedor origem','draft',9999,9999,'fixture')",[purchase,tenantA,supplier.insertId,purchaseInvalid,tenantA,supplier.insertId]);
    await pool.execute("INSERT INTO erp_sale_orders(public_id,client_id,order_number,crm_client_id,customer_name_snapshot,status,subtotal_cents,total_cents,created_by) VALUES(?,?,'SO-REAL','finance-customer-a','Cliente origem','fulfilled',9100,9100,'fixture'),(?,?,'SO-INVALID','finance-customer-a','Cliente origem','draft',9999,9999,'fixture')",[sale,tenantA,saleInvalid,tenantA]);
    const context=await browser.newContext();contexts.add(context);const page=await context.newPage();
    try{await login(page,users.manager,passwordA!);const refs=await references();const input=(sourcePublicId:string)=>({sourcePublicId,dueDate:"2026-09-20",categoryPublicId:refs.categoryPublicId,financialAccountPublicId:refs.accountPublicId,notes:"navegador não define valor"});expect((await mutation(context,"erp.finance.fromPurchase",input(purchase))).status()).toBe(200);expect((await mutation(context,"erp.finance.fromSale",input(sale))).status()).toBe(200);expect((await mutation(context,"erp.finance.fromPurchase",input(purchase))).status()).toBe(200);expect((await mutation(context,"erp.finance.fromPurchase",input(purchaseInvalid))).status()).toBe(409);expect((await mutation(context,"erp.finance.fromSale",input(saleInvalid))).status()).toBe(409);expect(await scalar("SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND source_public_id=? AND amount_cents=7300 AND party_name_snapshot='Fornecedor origem'",[tenantA,purchase])).toBe(1);expect(await scalar("SELECT COUNT(*) total FROM erp_financial_entries WHERE client_id=? AND source_public_id=? AND amount_cents=9100 AND party_name_snapshot='Cliente origem'",[tenantA,sale])).toBe(1);}
    finally{await closeContext(context);}
  });

  test("09 sessão revogada e tenant bloqueado não listam nem liquidam", async ({ browser }) => {
    const context=await browser.newContext();contexts.add(context);const page=await context.newPage();
    try{await login(page,users.admin,passwordA!);const cookie=await sessionCookie(context);await pool.execute("UPDATE megadesk_operational_sessions SET revoked_at=NOW() WHERE client_id=? AND revoked_at IS NULL",[tenantA]);const list=await context.request.get(`/api/trpc/erp.finance.list?input=${encodeURIComponent(JSON.stringify({json:{page:1,pageSize:20}}))}`,{headers:{Cookie:cookie}});expect(list.status()).toBe(401);const before=await scalar("SELECT COUNT(*) total FROM erp_financial_settlements WHERE client_id=?",[tenantA]);await pool.execute("UPDATE megadesk_domain_clients SET access_released=0 WHERE client_id=?",[tenantB]);const blocked=await browser.newContext();contexts.add(blocked);const blockedPage=await blocked.newPage();try{await blockedPage.goto("/");await blockedPage.getByPlaceholder("seu@email.com").fill(users.tenantB);await blockedPage.getByPlaceholder("Sua senha de acesso").fill(passwordB!);await blockedPage.getByRole("button",{name:"Entrar na plataforma"}).click();expect((await blocked.cookies()).find(item=>item.name==="megadesk_session")).toBeUndefined();const blockedList=await blocked.request.get(`/api/trpc/erp.finance.list?input=${encodeURIComponent(JSON.stringify({json:{page:1,pageSize:20}}))}`);expect(blockedList.status()).toBe(401);const [entries]=await pool.execute<RowDataPacket[]>("SELECT public_id FROM erp_financial_entries WHERE client_id=? LIMIT 1",[tenantA]);const blockedSettle=await blocked.request.post("/api/trpc/erp.finance.settle",{headers:{Origin:process.env.PLAYWRIGHT_BASE_URL!},data:{json:{publicId:String(entries[0].public_id),financialAccountPublicId:(await references()).accountPublicId,idempotencyKey:crypto.randomUUID()}}});expect(blockedSettle.status()).toBe(401);expect(await scalar("SELECT COUNT(*) total FROM erp_financial_settlements WHERE client_id=?",[tenantA])).toBe(before);}finally{await closeContext(blocked);}}
    finally{await closeContext(context);}
  });
});
