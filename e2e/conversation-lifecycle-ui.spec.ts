import { expect, test, type Page } from "@playwright/test";

const session = { clientId: "tenant-ui", company: "UI", permissions: ["conversations", "active-attendance"],
  userName: "Agent", userEmail: "agent@example.test", userRole: "agent", modules: ["conversations"],
  expiresAt: Date.now() + 3_600_000 };
const conversation = { id: "conv-ui", publicCode: "CV-260829000000-TEST", contactId: "contact-ui",
  customerName: "Cliente UI", customerPhone: "5541999999999", companyName: "Empresa UI", lastMessage: "Mensagem legada",
  lastMessageAt: new Date().toISOString(), unreadCount: 1, status: "open", assignedUserId: "user-ui",
  assignedUserName: "Agent", lastMessageFrom: "customer" };

async function mockedPage(page: Page, deepLink = false) {
  const calls: string[] = [];
  await page.addInitScript(value => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(value));
    localStorage.setItem("megadesk_active_page_v1", "conversations");
  }, session);
  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(url.pathname).replace(/^.*\/api\/trpc\//, "").split(",");
    calls.push(...names);
    const result = (name: string) => name.includes("refreshSession") ? { ok: true, session }
      : name.includes("conversations.list") ? [conversation]
      : name.includes("conversations.counts") ? { active: 1, closed: 1, waiting: 0, mine: 1 }
      : name.includes("conversations.eligibleUsers") ? [{ id: "user-ui", name: "Agent", email: "agent@example.test", role: "agent" }]
      : name.includes("conversations.messages") ? { source: "legacy_json", messages: [{ id: "legacy-1", from: "customer", text: "Mensagem legada", type: "text", timestamp: new Date().toISOString() }] }
      : { ok: true };
    const body = names.map(name => ({ result: { data: { json: result(name) } } }));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(url.searchParams.get("batch") === "1" ? body : body[0]) });
  });
  await page.goto(deepLink ? "/?conversationId=conv-ui" : "/", { waitUntil: "domcontentloaded" });
  return calls;
}

test.describe("restored conversation layout with WIP lifecycle", () => {
  test("keeps the baseline two-column contract on the canonical backend", async ({ page }) => {
    const calls = await mockedPage(page, true);
    await expect(page.getByTestId("conversation-list-panel")).toBeVisible();
    await expect(page.getByText("Cliente UI", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("conversation-chat-panel")).toBeVisible();
    await expect(page.getByText("Mensagem legada").last()).toBeVisible();
    for (const label of ["Todas", "Minhas", "Encerradas", "Abertas", "BOT/Aguardando"]) {
      await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
    await expect(page.getByTestId("conversation-list-panel")).toHaveClass(/min-\[900px\]:w-\[420px\]/);
    await expect(page.locator(".fixed.inset-0.z-40")).toHaveCount(0);
    const all = page.getByRole("button", { name: "Todas" });
    await expect(all.locator("xpath=following-sibling::button[1]")).toHaveAccessibleName("Minhas");
    await expect(all.locator("xpath=following-sibling::button[2]")).toHaveAccessibleName(/Encerradas/);
    const open = page.getByRole("button", { name: /Abertas/ });
    await expect(open.locator("xpath=following-sibling::button[1]")).toHaveAccessibleName("BOT/Aguardando");
    await expect(page.getByRole("button", { name: /Encerradas/ })).toContainText("1");
    await expect(open).toContainText("1");
    await all.click();
    await expect(all).toHaveClass(/bg-blue-600/);
    await page.getByRole("button", { name: "Minhas" }).click();
    await expect(page.getByRole("button", { name: "Minhas" })).toHaveClass(/bg-blue-600/);
    const closed = page.getByRole("button", { name: /Encerradas/ });
    await closed.click();
    await expect(closed).toHaveClass(/bg-blue-600/);
    await open.click();
    await expect(open).toHaveClass(/bg-emerald-500/);
    const bot = page.getByRole("button", { name: "BOT/Aguardando" });
    await bot.click();
    await expect(bot).toHaveClass(/bg-blue-600/);
    await page.goto("/?conversationId=conv-ui");
    await expect(page.getByTestId("conversation-chat-panel")).toBeVisible();
    expect(calls.some(name => name.includes("conversations.list"))).toBe(true);
    expect(calls.some(name => name.includes("megadesk.getConversations"))).toBe(false);
  });

  test("exposes filters and actions to keyboard focus", async ({ page }) => {
    await mockedPage(page, true);
    const all = page.getByRole("button", { name: "Todas" });
    await all.focus();
    await expect(all).toBeFocused();
    await expect(page.getByRole("button", { name: "Transferir" })).toBeVisible();
    await expect(page.getByText("Mais ações")).toBeVisible();
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`remains usable at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockedPage(page);
      await page.getByText("Cliente UI").click();
      await expect(page.getByTestId("conversation-composer")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
