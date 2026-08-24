import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.TEST_DATABASE_URL;
const passwordA = process.env.E2E_PASSWORD_A;
const passwordB = process.env.E2E_PASSWORD_B;
const sharedEmail = "session-shared@example.invalid";
let pool: Pool;

type LoginFixtureRow = RowDataPacket & {
  client_id: string;
  tenant_status: string;
  access_released: number;
  user_id: string;
  user_status: string;
  password_hash: string;
};

async function resetFixtures() {
  await pool.execute("DELETE FROM megadesk_operational_sessions WHERE client_id IN ('e2e-session-a','e2e-session-b')");
  await pool.execute("DELETE FROM megadesk_domain_conversations WHERE client_id IN ('e2e-session-a','e2e-session-b')");
  await pool.execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN ('e2e-session-a','e2e-session-b')");
  await pool.execute("DELETE FROM megadesk_domain_clients WHERE client_id IN ('e2e-session-a','e2e-session-b')");
  const [hashA, hashB] = await Promise.all([bcrypt.hash(passwordA!, 8), bcrypt.hash(passwordB!, 8)]);
  await pool.execute("INSERT INTO megadesk_domain_clients (client_id,internal_id,tenant_database_name,company,contact,phone,plan,status,status_type,access_released,api_token,modules_json,integrations_json) VALUES ('e2e-session-a','e2e-internal-a','e2e_session_db_a','Empresa Fixture A','Fixture','00000000000','Test','active','test',1,'e2e-a','[\"conversations\"]','{}'),('e2e-session-b','e2e-internal-b','e2e_session_db_b','Empresa Fixture B','Fixture','00000000000','Test','active','test',1,'e2e-b','[\"conversations\"]','{}')");
  await pool.execute("INSERT INTO megadesk_domain_client_users (user_id,client_id,name,email,role,status,permissions_json,password_hash) VALUES ('e2e-user-a','e2e-session-a','Usuário Fixture A',?,'agent','active','[]',?),('e2e-user-b','e2e-session-b','Usuário Fixture B',?,'manager','active','[]',?)", [sharedEmail, hashA, sharedEmail, hashB]);
  await pool.execute("INSERT INTO megadesk_domain_conversations (conversation_id,client_id,customer_name,phone,company,status,last_message,last_message_from,time_label,messages_json,unread_count,ia_active) VALUES ('e2e-conversation-a','e2e-session-a','Cliente Fixture A','00000000001','Empresa Fixture Cliente','open','Mensagem fictícia','customer','agora','[]',1,0)");
}

async function validateLoginFixtures() {
  expect(passwordA).toBeTruthy();
  expect(passwordB).toBeTruthy();
  expect(passwordA).not.toBe(passwordB);
  const [rows] = await pool.execute<LoginFixtureRow[]>(
    `SELECT c.client_id,c.status tenant_status,c.access_released,
            u.user_id,u.status user_status,u.password_hash
       FROM megadesk_domain_clients c
       INNER JOIN megadesk_domain_client_users u ON u.client_id=c.client_id
      WHERE u.email=? AND c.client_id IN ('e2e-session-a','e2e-session-b')
      ORDER BY c.client_id`,
    [sharedEmail],
  );
  expect(rows).toHaveLength(2);
  expect(rows.map(row => ({
    clientId: row.client_id,
    tenantStatus: row.tenant_status,
    accessReleased: Number(row.access_released),
    userId: row.user_id,
    userStatus: row.user_status,
  }))).toEqual([
    { clientId: "e2e-session-a", tenantStatus: "active", accessReleased: 1, userId: "e2e-user-a", userStatus: "active" },
    { clientId: "e2e-session-b", tenantStatus: "active", accessReleased: 1, userId: "e2e-user-b", userStatus: "active" },
  ]);
  expect(await bcrypt.compare(passwordA!, rows[0].password_hash)).toBe(true);
  expect(await bcrypt.compare(passwordA!, rows[1].password_hash)).toBe(false);
  expect(await bcrypt.compare(passwordB!, rows[1].password_hash)).toBe(true);
  expect(await bcrypt.compare(passwordB!, rows[0].password_hash)).toBe(false);
}

async function login(page: Page, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("seu@email.com").fill(sharedEmail);
  await page.getByPlaceholder("Sua senha de acesso").fill(password);
  const loginResponse = page.waitForResponse(response =>
    response.request().method() === "POST" && response.url().includes("/api/trpc/megadesk.loginByEmail"),
  );
  await page.getByRole("button", { name: "Entrar na plataforma" }).click();
  const response = await loginResponse;
  let publicCode = response.ok() ? "OK" : "UNKNOWN";
  let publicMessage = "";
  if (!response.ok()) {
    try {
      const payload = await response.json();
      const entry = Array.isArray(payload) ? payload[0] : payload;
      publicCode = String(entry?.error?.json?.data?.code ?? "UNKNOWN");
      publicMessage = String(entry?.error?.json?.message ?? "");
    } catch {
      publicCode = "UNPARSEABLE_PUBLIC_ERROR";
    }
  }
  const diagnostic = {
    endpoint: new URL(response.url()).pathname,
    status: response.status(),
    publicCode,
    publicMessage,
  };
  console.log(`AUTH_LOGIN_RESPONSE: ${JSON.stringify(diagnostic)}`);
  expect(response.status(), `Resposta pública sanitizada: ${JSON.stringify(diagnostic)}`).toBe(200);
  await expect(page.getByText(/Empresa Fixture [AB] • Usuário Fixture [AB]/)).toBeVisible();
}

async function cookieFlags(context: BrowserContext) {
  const cookie = (await context.cookies()).find(item => item.name === "megadesk_session");
  return cookie ? { present: true, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, path: cookie.path, secure: cookie.secure } : { present: false };
}

async function reloadAndObserveSessionRevalidation(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(candidate =>
      decodeURIComponent(candidate.url()).includes("megadesk.refreshSession")
    ),
    page.reload(),
  ]);
  const body = await response.json().catch(() => null),
    item = Array.isArray(body) ? body[0] : body,
    publicError = item?.error?.json;
  console.log(
    "AUTH_REFRESH_RESPONSE:",
    JSON.stringify({
      endpoint: new URL(response.url()).pathname,
      status: response.status(),
      publicCode: publicError?.data?.code ?? "OK",
      publicMessage: publicError?.message ?? "",
    })
  );
  return {
    status: response.status(),
    publicCode: publicError?.data?.code ?? "OK",
  };
}

test.describe.serial("MegaDesk secure operational session", () => {
  test.beforeAll(async ({ request }) => {
    if (!databaseUrl || !passwordA || !passwordB) throw new Error("E2E disposable credentials are required");
    pool = mysql.createPool(databaseUrl);
    await resetFixtures();
    await validateLoginFixtures();
    const cacheReset = await request.post("/api/trpc/megaadmin.logoutAdmin", { data: { json: null } });
    expect(cacheReset.status(), "Invalidação do estado de tenants após fixtures SQL").toBe(200);
  });

  test.beforeEach(async () => {
    await pool.execute("UPDATE megadesk_domain_clients SET status='active',access_released=1 WHERE client_id IN ('e2e-session-a','e2e-session-b')");
    await pool.execute("UPDATE megadesk_domain_client_users SET status='active',role=IF(client_id='e2e-session-a','agent','manager') WHERE client_id IN ('e2e-session-a','e2e-session-b')");
  });

  test.afterAll(async () => {
    await pool.execute("DELETE FROM megadesk_operational_sessions WHERE client_id IN ('e2e-session-a','e2e-session-b')");
    await pool.execute("DELETE FROM megadesk_domain_conversations WHERE client_id IN ('e2e-session-a','e2e-session-b')");
    await pool.execute("DELETE FROM megadesk_domain_client_users WHERE client_id IN ('e2e-session-a','e2e-session-b')");
    await pool.execute("DELETE FROM megadesk_domain_clients WHERE client_id IN ('e2e-session-a','e2e-session-b')");
    await pool.end();
  });

  test("logs into both isolated tenants and sets only the protected MegaDesk cookie", async ({ browser }) => {
    const contextA = await browser.newContext(); const pageA = await contextA.newPage();
    const contextB = await browser.newContext(); const pageB = await contextB.newPage();
    await login(pageA, passwordA!);
    await login(pageB, passwordB!);
    await expect(pageA.getByText("Empresa Fixture A • Usuário Fixture A")).toBeVisible();
    await expect(pageB.getByText("Empresa Fixture B • Usuário Fixture B")).toBeVisible();
    expect(await cookieFlags(contextA)).toEqual({ present: true, httpOnly: true, sameSite: "Lax", path: "/", secure: false });
    expect((await contextA.cookies()).some(cookie => cookie.name === "megaadmin_session")).toBe(false);
    const exposure = await pageA.evaluate(() => ({
      local: Object.values(localStorage).some(value => value.includes("megadesk_session=")),
      session: Object.values(sessionStorage).some(value => value.includes("megadesk_session=")),
      dom: document.documentElement.innerHTML.includes("megadesk_session="),
      url: location.href.includes("megadesk_session="),
    }));
    expect(exposure).toEqual({ local: false, session: false, dom: false, url: false });
    await contextA.close(); await contextB.close();
  });

  test("rejects wrong and ambiguous credentials with the same public error", async ({ page }) => {
    await page.goto("/");
    for (const password of ["wrong-fixture-password", passwordA!]) {
      await page.getByPlaceholder("seu@email.com").fill(password === passwordA ? "unknown@example.invalid" : sharedEmail);
      await page.getByPlaceholder("Sua senha de acesso").fill(password);
      await page.getByRole("button", { name: "Entrar na plataforma" }).click();
      await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    }
    await pool.execute("UPDATE megadesk_domain_client_users SET password_hash=(SELECT password_hash FROM (SELECT password_hash FROM megadesk_domain_client_users WHERE user_id='e2e-user-a') source) WHERE user_id='e2e-user-b'");
    await page.getByPlaceholder("seu@email.com").fill(sharedEmail);
    await page.getByPlaceholder("Sua senha de acesso").fill(passwordA!);
    await page.getByRole("button", { name: "Entrar na plataforma" }).click();
    await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    const hashB = await bcrypt.hash(passwordB!, 8);
    await pool.execute("UPDATE megadesk_domain_client_users SET password_hash=? WHERE user_id='e2e-user-b'", [hashB]);
  });

  test("preserves the authoritative tenant across refresh, new pages and forged browser state", async ({ browser }) => {
    const context = await browser.newContext(); const page = await context.newPage();
    await login(page, passwordA!);
    const refreshResponse = page.waitForResponse(response => response.url().includes("megadesk.refreshSession"));
    await page.reload();
    const refreshStatus = (await refreshResponse).status();
    expect(refreshStatus).toBe(200);
    await expect(page.getByText("Empresa Fixture A • Usuário Fixture A")).toBeVisible();
    const secondPage = await context.newPage(); await secondPage.goto("/");
    await expect(secondPage.getByText("Empresa Fixture A • Usuário Fixture A")).toBeVisible();
    await page.evaluate(() => {
      const value = JSON.parse(localStorage.getItem("megadesk_session_v1") ?? "{}");
      localStorage.setItem("megadesk_session_v1", JSON.stringify({ ...value, clientId: "e2e-session-b", company: "Empresa Fixture B" }));
    });
    await page.reload();
    await expect(page.getByText("Empresa Fixture A • Usuário Fixture A")).toBeVisible();
    const forgedStatus = await page.evaluate(async () => (await fetch("/api/trpc/megadesk.getClientUsers?input=%7B%22json%22%3A%7B%22clientId%22%3A%22e2e-session-b%22%7D%7D", { headers: { "x-tenant-id": "e2e-session-b" } })).status);
    expect(forgedStatus).toBe(403);
    const isolatedContext = await browser.newContext(); const isolatedPage = await isolatedContext.newPage(); await isolatedPage.goto("/");
    await expect(isolatedPage.getByRole("button", { name: "Entrar na plataforma" })).toBeVisible();
    await isolatedContext.close(); await context.close();
  });

  test("logs out A without affecting B and history cannot restore access", async ({ browser }) => {
    const contextA = await browser.newContext(); const pageA = await contextA.newPage();
    const contextB = await browser.newContext(); const pageB = await contextB.newPage();
    await login(pageA, passwordA!); await login(pageB, passwordB!);
    await pageA.getByTitle("Sair").click();
    await expect(pageA.getByRole("button", { name: "Entrar na plataforma" })).toBeVisible();
    expect((await contextA.cookies()).some(cookie => cookie.name === "megadesk_session")).toBe(false);
    expect((await contextA.cookies()).some(cookie => cookie.name === "megaadmin_session")).toBe(false);
    await pageA.goBack();
    await expect(pageA.getByText("Empresa Fixture A â€¢ UsuÃ¡rio Fixture A")).not.toBeVisible();
    await pageA.goto("/");
    await pageA.reload(); await expect(pageA.getByRole("button", { name: "Entrar na plataforma" })).toBeVisible();
    await expect(pageB.getByText("Empresa Fixture B • Usuário Fixture B")).toBeVisible();
    const repeated = await pageA.evaluate(async () => (await fetch("/api/trpc/megadesk.logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ json: null }) })).status);
    expect(repeated).toBe(200);
    const [rows] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) total FROM megadesk_operational_sessions WHERE client_id='e2e-session-a' AND revoked_at IS NULL");
    expect(Number(rows[0].total)).toBe(0);
    await contextA.close(); await contextB.close();
  });

  test("expires and revalidates user, tenant access and role on the next operation", async ({ page }) => {
    await login(page, passwordA!);
    await pool.execute("UPDATE megadesk_operational_sessions SET expires_at='2000-01-01 00:00:00' WHERE client_id='e2e-session-a' AND revoked_at IS NULL");
    expect(await reloadAndObserveSessionRevalidation(page)).toEqual({
      status: 401,
      publicCode: "UNAUTHORIZED",
    });
    await expect(page.getByRole("button", { name: "Entrar na plataforma" })).toBeVisible();
    await login(page, passwordA!);
    await pool.execute("UPDATE megadesk_domain_client_users SET status='blocked' WHERE user_id='e2e-user-a'");
    expect(await reloadAndObserveSessionRevalidation(page)).toEqual({
      status: 401,
      publicCode: "UNAUTHORIZED",
    });
    await expect(page.getByRole("button", { name: "Entrar na plataforma" })).toBeVisible();
    await pool.execute("UPDATE megadesk_domain_client_users SET status='active',role='agent' WHERE user_id='e2e-user-a'");
    await login(page, passwordA!);
    await pool.execute("UPDATE megadesk_domain_client_users SET role='viewer' WHERE user_id='e2e-user-a'");
    expect(await reloadAndObserveSessionRevalidation(page)).toEqual({
      status: 200,
      publicCode: "OK",
    });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("megadesk_session_v1") ?? "{}").userRole)).toBe("viewer");
    await pool.execute("UPDATE megadesk_domain_clients SET status='paused' WHERE client_id='e2e-session-a'");
    expect(await reloadAndObserveSessionRevalidation(page)).toEqual({
      status: 401,
      publicCode: "UNAUTHORIZED",
    });
    await expect(page.getByRole("button", { name: "Entrar na plataforma" })).toBeVisible();
    await pool.execute("UPDATE megadesk_domain_clients SET status='active',access_released=1 WHERE client_id='e2e-session-a'");
    await login(page, passwordA!);
    await pool.execute("UPDATE megadesk_domain_clients SET access_released=0 WHERE client_id='e2e-session-a'");
    expect(await reloadAndObserveSessionRevalidation(page)).toEqual({
      status: 401,
      publicCode: "UNAUTHORIZED",
    });
    await expect(page.getByRole("button", { name: "Entrar na plataforma" })).toBeVisible();
  });

  test("rejects external Origin without leaking internal details", async ({ page, context }) => {
    await login(page, passwordA!);
    const cookie = (await context.cookies()).find(item => item.name === "megadesk_session");
    if (!cookie) throw new Error("MegaDesk cookie missing");
    const response = await context.request.post("/api/trpc/megadesk.refreshSession", {
      headers: { Origin: "https://external.example.invalid", Cookie: `${cookie.name}=${cookie.value}` },
      data: { json: null, meta: { values: ["undefined"] } },
    });
    const responseBody = await response.json().catch(() => null),
      publicError = responseBody?.error?.json;
    console.log(
      "AUTH_EXTERNAL_ORIGIN_RESPONSE:",
      JSON.stringify({
        endpoint: "/api/trpc/megadesk.refreshSession",
        status: response.status(),
        publicCode: publicError?.data?.code ?? "UNKNOWN",
        publicMessage: publicError?.message ?? "",
      })
    );
    expect(response.status()).toBe(403);
    const publicBody = JSON.stringify(responseBody);
    expect(/token_hash|megadesk_operational_sessions|SELECT |INSERT |mysql:\/\//i.test(publicBody)).toBe(false);
  });

  test("keeps Conversations usable at 390x844 without sending messages or audio", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, passwordA!);
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await page.getByTitle("Conversas").click();
    const list = page.getByTestId("conversation-list-panel");
    await expect(list).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: /Cliente Fixture A/ }).click();
    const composer = page.getByTestId("conversation-composer");
    await expect(composer).toBeVisible();
    await expect(page.getByRole("button", { name: "Gravar áudio" })).toBeVisible();
    await page.getByRole("button", { name: "Voltar para conversas" }).click();
    await expect(list).toBeVisible();
  });
});
