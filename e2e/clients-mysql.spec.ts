import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import mysql, { type Pool } from "mysql2/promise";
import bcrypt from "bcryptjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const databaseUrl = process.env.TEST_DATABASE_URL;
const passwordA = process.env.E2E_PASSWORD_A;
const passwordB = process.env.E2E_PASSWORD_B;
const screenshotDir = process.env.MEGADESK_E2E_SCREENSHOT_DIR;
const tenantA = "e2e-clients-a";
const tenantB = "e2e-clients-b";
const users = {
  admin: "clients-admin@example.invalid",
  manager: "clients-manager@example.invalid",
  agent: "clients-agent@example.invalid",
  viewer: "clients-viewer@example.invalid",
  tenantB: "clients-b@example.invalid",
};
let pool: Pool;
const contexts = new Set<BrowserContext>();

async function cleanup() {
  await pool.execute("DELETE FROM megadesk_operational_sessions WHERE client_id IN (?, ?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_crm_timeline WHERE client_id IN (?, ?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_conversations WHERE client_id IN (?, ?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_chamados WHERE clientId IN (?, ?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_crm_clients WHERE client_id IN (?, ?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN (?, ?)", [tenantA, tenantB]);
  await pool.execute("DELETE FROM megadesk_domain_clients WHERE client_id IN (?, ?)", [tenantA, tenantB]);
}

async function fixtures() {
  await cleanup();
  const [hashA, hashB] = await Promise.all([bcrypt.hash(passwordA!, 8), bcrypt.hash(passwordB!, 8)]);
  await pool.execute(
    `INSERT INTO megadesk_domain_clients
     (client_id, internal_id, tenant_database_name, company, contact, phone, plan, status, status_type, access_released, api_token, modules_json, integrations_json)
     VALUES (?, 'clients-internal-a', 'clients_a', 'Clientes A', 'Fixture', '00000000000', 'Test', 'active', 'test', 1, 'clients-token-a', '["clients","active-attendance","tickets","erp"]', '{}'),
            (?, 'clients-internal-b', 'clients_b', 'Clientes B', 'Fixture', '00000000000', 'Test', 'active', 'test', 1, 'clients-token-b', '["clients","active-attendance","tickets","erp"]', '{}')`,
    [tenantA, tenantB],
  );
  await pool.execute(
    `INSERT INTO megadesk_domain_client_users
     (user_id, client_id, name, email, role, status, permissions_json, password_hash)
     VALUES ('clients-admin-a', ?, 'Admin Clientes', ?, 'admin', 'active', '["clients","active-attendance","tickets","erp"]', ?),
            ('clients-manager-a', ?, 'Manager Clientes', ?, 'manager', 'active', '["clients","active-attendance","tickets","erp"]', ?),
            ('clients-agent-a', ?, 'Agent Clientes', ?, 'agent', 'active', '["clients"]', ?),
            ('clients-viewer-a', ?, 'Viewer Clientes', ?, 'viewer', 'active', '["clients"]', ?),
            ('clients-admin-b', ?, 'Admin Clientes B', ?, 'admin', 'active', '["clients","active-attendance","tickets","erp"]', ?)`,
    [tenantA, users.admin, hashA, tenantA, users.manager, hashA, tenantA, users.agent, hashA, tenantA, users.viewer, hashA, tenantB, users.tenantB, hashB],
  );
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("seu@email.com").fill(email);
  await page.getByPlaceholder("Sua senha de acesso").fill(password);
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  await expect(page.locator("main")).toBeVisible();
}

async function context(browser: Browser, viewport = { width: 1440, height: 900 }) {
  const value = await browser.newContext({ viewport, acceptDownloads: true });
  contexts.add(value);
  return value as BrowserContext;
}

async function closeContext(value: BrowserContext) {
  try { await value.close(); } finally { contexts.delete(value); }
}

async function openClients(page: Page) {
  const item = page.getByRole("button", { name: "Clientes", exact: true });
  if (!await item.isVisible()) await page.locator("header").getByTitle("Abrir menu").click();
  await item.click();
  await expect(page).toHaveURL(/\/clientes$/);
  await expect(page.getByTestId("clients-page")).toBeVisible();
}

async function shot(page: Page, name: string) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, name), fullPage: true });
}

test.describe.serial("Clients real MySQL journeys", () => {
  test.beforeAll(async () => {
    if (!databaseUrl || !passwordA || !passwordB) throw new Error("Disposable Clients credentials required");
    pool = mysql.createPool(databaseUrl);
    await fixtures();
  });
  test.afterEach(async () => { await Promise.allSettled([...contexts].map(closeContext)); });
  test.afterAll(async () => { await cleanup(); await pool.end(); });

  test("admin creates, edits, searches, links timeline, ticket and active attendance", async ({ browser }, testInfo) => {
    test.slow();
    const ctx = await context(browser);
    const page = await ctx.newPage();
    await login(page, users.admin, passwordA!);
    await openClients(page);
    await expect(page.getByText("Nenhum cliente cadastrado")).toBeVisible();
    await shot(page, "clients-empty-admin-1440.png");
    await page.getByRole("button", { name: "Novo" }).click();
    await expect(page.getByText("Cadastrar Novo Cliente")).toBeVisible();
    await page.getByLabel("Nome da Empresa").fill("Cliente compartilhado real");
    await page.getByLabel("Nome do Responsável").fill("Pessoa Fixture");
    await page.getByLabel("CPF / CNPJ").fill("12.345.678/0001-90");
    await page.getByLabel("Telefone principal").fill("(11) 99999-0001");
    await page.getByLabel("E-mail").fill("commercial@example.invalid");
    await page.getByLabel("Endereço").fill("Rua Real, 10");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await page.getByLabel("Telefone do contato 1").fill("11988880001");
    await page.getByLabel("Descrição do contato 1").fill("Financeiro");
    await shot(page, "clients-create-admin-1440.png");
    await page.getByRole("button", { name: "Cadastrar Cliente" }).click();
    const createdClient = page.getByText("Cliente compartilhado real", { exact: true });
    await expect(createdClient).toBeVisible();
    await createdClient.click();
    await expect(page.getByText("Rua Real, 10")).toBeVisible();
    await shot(page, "clients-details-admin-1440.png");
    await page.getByTitle("Editar").click();
    await page.getByLabel("Nome da Empresa").fill("Cliente compartilhado editado");
    await shot(page, "clients-edit-admin-1440.png");
    await page.getByRole("button", { name: "Salvar Alterações" }).click();
    await expect(page.getByRole("heading", { name: "Cliente compartilhado editado", exact: true })).toBeVisible();
    await page.getByPlaceholder("Buscar por nome, telefone, CNPJ...").fill("compartilhado editado");
    await expect(page.getByRole("button", { name: /Cliente compartilhado editado/ })).toBeVisible();
    await shot(page, "clients-search-admin-1440.png");
    const [rows] = await pool.execute<mysql.RowDataPacket[]>("SELECT crm_client_id FROM megadesk_crm_clients WHERE client_id=? AND company_name=?", [tenantA, "Cliente compartilhado editado"]);
    expect(rows).toHaveLength(1);
    const crmClientId = String(rows[0].crm_client_id);
    await pool.execute("INSERT INTO megadesk_domain_chamados(chamadoId,clientId,chamadoNumber,customerId,customerName,company,title) VALUES('clients-ticket-a',?,501,?,?,?,'Chamado do mesmo cliente')", [tenantA, crmClientId, "Pessoa Fixture", "Cliente compartilhado editado"]);
    const clientsPage = page.getByTestId("clients-page");
    await clientsPage.getByRole("button", { name: "Chamados", exact: true }).click();
    await expect(page.getByText("Chamado do mesmo cliente")).toBeVisible();
    await shot(page, "clients-ticket-linked-1440.png");
    await clientsPage.getByRole("button", { name: "Timeline", exact: true }).click();
    await page.getByPlaceholder(/Descreva uma intera/).fill("Nota real da timeline");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText("Nota real da timeline")).toBeVisible();
    await shot(page, "clients-timeline-admin-1440.png");
    await page.getByTitle("Atendimento Ativo").click();
    const attendancePhone = page.getByPlaceholder(/Digite o n.mero/);
    await attendancePhone.fill("11999990001");
    await attendancePhone.press("Enter");
    await expect(page.getByText("Cliente compartilhado editado")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver no CRM" })).toBeVisible();
    await shot(page, "clients-active-attendance-admin-1440.png");
    await page.getByRole("button", { name: "Ver no CRM" }).click();
    await expect(page).toHaveURL(/\/clientes$/);
    await expect(page.getByRole("heading", { name: "Cliente compartilhado editado", exact: true })).toBeVisible();
    const csvPath = testInfo.outputPath("clients-import.csv");
    writeFileSync(csvPath, "empresa;responsavel;telefone;email\nCliente CSV;Pessoa CSV;11977770001;csv@example.invalid", "utf8");
    await page.locator('input[type="file"]').setInputFiles(csvPath);
    await expect(page.getByRole("button", { name: /Cliente CSV/ })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTitle("Exportar clientes em CSV").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("clientes.csv");
    await expect(page.getByTitle("Excluir")).toHaveCount(0);
    await closeContext(ctx);
  });

  test("manager has full Clients access", async ({ browser }) => {
    const ctx = await context(browser, { width: 1024, height: 768 });
    const page = await ctx.newPage();
    await login(page, users.manager, passwordA!);
    await openClients(page);
    await expect(page.getByRole("button", { name: "Novo" })).toBeVisible();
    await expect(page.getByText("Cliente compartilhado editado")).toBeVisible();
    await shot(page, "clients-manager-1024.png");
    await closeContext(ctx);
  });

  for (const role of ["agent", "viewer"] as const) {
    test(`${role} has no Clients item, route or mutation`, async ({ browser }) => {
      const ctx = await context(browser, { width: 768, height: 1024 });
      const page = await ctx.newPage();
      await login(page, users[role], passwordA!);
      await expect(page.getByTitle("Clientes")).toHaveCount(0);
      await page.goto("/clientes");
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId("clients-page")).toHaveCount(0);
      const cookie = (await ctx.cookies()).find((item) => item.name === "megadesk_session");
      expect(cookie).toBeTruthy();
      const response = await ctx.request.post("/api/trpc/crm.create", {
        headers: { Origin: process.env.PLAYWRIGHT_BASE_URL!, Cookie: `${cookie!.name}=${cookie!.value}` },
        data: { json: { data: { companyName: "Negado" } } },
      });
      expect(response.status()).toBe(403);
      await shot(page, `clients-${role}-without-access-768.png`);
      await closeContext(ctx);
    });
  }

  test("tenant B stays isolated and may reuse commercial identity", async ({ browser }) => {
    const ctx = await context(browser);
    const page = await ctx.newPage();
    await login(page, users.tenantB, passwordB!);
    await openClients(page);
    await expect(page.getByText("Cliente compartilhado editado")).toHaveCount(0);
    await page.getByRole("button", { name: "Novo" }).click();
    await page.getByLabel("Nome da Empresa").fill("Cliente tenant B");
    await page.getByLabel("CPF / CNPJ").fill("12.345.678/0001-90");
    await page.getByLabel("Telefone principal").fill("11999990001");
    await page.getByRole("button", { name: "Cadastrar Cliente" }).click();
    await expect(page.getByText("Cliente tenant B", { exact: true })).toBeVisible();
    await closeContext(ctx);
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`renders Clients responsively at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
      const ctx = await context(browser, viewport);
      const page = await ctx.newPage();
      await login(page, users.admin, passwordA!);
      await openClients(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await shot(page, `clients-responsive-${viewport.width}x${viewport.height}.png`);
      await closeContext(ctx);
    });
  }
});
