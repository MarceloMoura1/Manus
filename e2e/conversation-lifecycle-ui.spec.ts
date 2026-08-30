import { expect, test, type Page } from "@playwright/test";

const session = { clientId: "tenant-ui", company: "UI", permissions: ["conversations", "active-attendance"],
  userName: "Agent", userEmail: "agent@example.test", userRole: "agent", modules: ["conversations"],
  expiresAt: Date.now() + 3_600_000 };
const conversation = { id: "conv-ui", publicCode: "CV-260829000000-TEST", contactId: "contact-ui", crmClientId: "crm-ui",
  customerName: "Cliente UI", customerPhone: "5541999999999", companyText: null, companyName: "Empresa CRM UI", lastMessage: "Mensagem legada",
  lastMessageAt: new Date().toISOString(), unreadCount: 1, status: "open", assignedUserId: "user-ui",
  assignedUserName: "Agent", lastMessageFrom: "customer" };

async function mockedPage(page: Page, deepLink = false) {
  const calls: string[] = [];
  const listInputs: Array<{ viewMode: string; status: string; search?: string }> = [];
  await page.addInitScript(value => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(value));
    localStorage.setItem("megadesk_active_page_v1", "conversations");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { (window as typeof window & { __copiedConversationId?: string }).__copiedConversationId = text; },
    } });
  }, session);
  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(url.pathname).replace(/^.*\/api\/trpc\//, "").split(",");
    calls.push(...names);
    const rawInput = url.searchParams.get("input");
    const parsedInput = rawInput ? JSON.parse(rawInput) : {};
    names.forEach((name, index) => {
      if (!name.includes("conversations.list")) return;
      const input = (parsedInput[index]?.json ?? parsedInput.json) as { viewMode: string; status: string; search?: string } | undefined;
      if (input) listInputs.push(input);
    });
    const result = (name: string) => name.includes("refreshSession") ? { ok: true, session }
      : name.includes("conversations.list") ? [conversation]
      : name.includes("conversations.counts") ? { active: 3, closed: 4, waiting: 2, mine: 1 }
      : name.includes("conversations.eligibleUsers") ? [{ id: "user-ui", name: "Agent", email: "agent@example.test", role: "agent" }]
      : name.includes("conversations.messages") ? { source: "legacy_json", messages: [{ id: "legacy-1", from: "customer", text: "Mensagem legada", type: "text", timestamp: new Date().toISOString() }] }
      : name.includes("conversations.companyCandidates") ? { items: [{ id: "crm-ui", name: "Empresa CRM UI", document: "12345678000190", customerType: "company" }], hasMore: false }
      : name.includes("conversations.historyDetail") ? { conversation: { id: "conv-old", publicCode: "CV-HIST-1", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, messages: [{ id: "history-message", from: "customer", type: "text", text: "Mensagem histórica", timestamp: new Date().toISOString() }] }
      : name.includes("conversations.history") ? [{ id: "conv-old", publicCode: "CV-HIST-1", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, { id: conversation.id, publicCode: conversation.publicCode, status: "open", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }]
      : name.includes("conversations.linkedTickets") ? []
      : name.includes("conversations.updateContact") ? { contactId: conversation.contactId, displayName: "Cliente Editado", companyText: "Empresa Informada", canonicalPhone: conversation.customerPhone, crmClientId: conversation.crmClientId }
      : { ok: true };
    const body = names.map(name => ({ result: { data: { json: result(name) } } }));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(url.searchParams.get("batch") === "1" ? body : body[0]) });
  });
  await page.goto(deepLink ? "/?conversationId=conv-ui" : "/", { waitUntil: "domcontentloaded" });
  return { calls, listInputs };
}

test.describe("restored conversation layout with WIP lifecycle", () => {
  test("keeps the baseline two-column contract on the canonical backend", async ({ page }) => {
    const { calls, listInputs } = await mockedPage(page, true);
    await expect(page.getByTestId("conversation-list-panel")).toBeVisible();
    await expect(page.getByText("Cliente UI", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("conversation-chat-panel")).toBeVisible();
    await expect(page.getByText("Mensagem legada").last()).toBeVisible();
    await expect(page.getByTestId("conversation-list-panel").getByText(conversation.publicCode, { exact: true })).toHaveCount(0);
    await expect(page.getByText(conversation.publicCode, { exact: true })).toBeHidden();
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
    const mine = page.getByRole("button", { name: "Minhas" });
    const closed = page.getByRole("button", { name: "Encerradas", exact: true });
    const bot = page.getByRole("button", { name: "BOT/Aguardando" });
    await expect(closed).toHaveText("Encerradas");
    await expect(open).toContainText("3");
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(open).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "all", status: "active" });

    await mine.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(open).toContainText("1");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "mine", status: "active" });
    await bot.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(bot).toHaveAttribute("aria-pressed", "true");
    await expect(open).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/conversationScope=mine.*conversationInbox=bot/);
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "waiting", status: "active" });

    await open.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(open).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "mine", status: "active" });
    await closed.click();
    await expect(closed).toHaveAttribute("aria-pressed", "true");
    await expect(mine).toHaveAttribute("aria-pressed", "false");
    await expect(open).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "all", status: "closed" });
    await all.click();
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(open).toHaveAttribute("aria-pressed", "true");
    await expect(closed).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "all", status: "active" });

    await closed.click();
    await mine.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(open).toHaveAttribute("aria-pressed", "true");
    await expect(closed).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "mine", status: "active" });

    await closed.click();
    await open.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(open).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /Filtros/ }).click();
    await page.getByPlaceholder("Nome, empresa ou telefone...").fill(conversation.publicCode);
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ search: conversation.publicCode });
    const detailsToggle = page.getByRole("button", { name: "Abrir detalhes da conversa" });
    await expect(detailsToggle).toHaveAttribute("aria-expanded", "false");
    await detailsToggle.click();
    await expect(page.getByTestId("conversation-details-panel")).toBeVisible();
    await expect(page.locator('[data-testid^="details-section-"]')).toHaveCount(5);
    await expect(page.getByText("Cliente vinculado")).toBeVisible();
    await expect(page.getByText("Empresa CRM UI", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fechar detalhes da conversa" }).first()).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#attendance-content").getByText(conversation.publicCode, { exact: true })).toBeVisible();
    const copyId = page.getByRole("button", { name: "Copiar ID da conversa" });
    await copyId.focus();
    await expect(copyId).toBeFocused();
    await copyId.click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __copiedConversationId?: string }).__copiedConversationId)).toBe(conversation.publicCode);
    await expect(copyId).toContainText("Copiado");

    await page.getByRole("button", { name: "+ Adicionar empresa" }).click();
    const companyInput = page.getByLabel("Nome da empresa");
    await expect(companyInput).toBeFocused();
    await companyInput.fill("Empresa Informada");
    await companyInput.press("Escape");
    await expect(page.getByTestId("conversation-details-panel")).toBeVisible();
    await page.getByRole("button", { name: "+ Adicionar empresa" }).click();
    await page.getByLabel("Nome da empresa").fill("Empresa Informada");
    await page.getByLabel("Nome da empresa").press("Enter");
    await expect(page.getByText("Empresa Informada", { exact: true })).toBeVisible();
    await expect(page.getByTestId("conversation-details-panel")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Minhas" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Abertas/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("navigation").first().getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "MegaDesk" })).toBeVisible();
    const openRemountStart = listInputs.length;
    await page.getByRole("button", { name: "Conversas Central de atendimento" }).click();
    await expect(page.getByRole("button", { name: "Minhas" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Abertas/ })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "mine", status: "active" });
    expect(listInputs.slice(openRemountStart).some(input => input.viewMode === "all")).toBe(false);

    await page.getByRole("button", { name: "BOT/Aguardando" }).click();
    await page.goBack();
    await expect(page.getByRole("button", { name: /Abertas/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Minhas" })).toHaveAttribute("aria-pressed", "true");
    await page.goForward();
    await expect(page.getByRole("button", { name: "BOT/Aguardando" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("navigation").first().getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "MegaDesk" })).toBeVisible();
    const botRemountStart = listInputs.length;
    await page.getByRole("button", { name: "Conversas Central de atendimento" }).click();
    await expect(page.getByRole("button", { name: "Minhas" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "BOT/Aguardando" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "waiting", status: "active" });
    expect(listInputs.slice(botRemountStart).some(input => input.viewMode === "all")).toBe(false);
    await expect(page.getByTestId("conversation-chat-panel")).toBeVisible();
    expect(calls.some(name => name.includes("conversations.list"))).toBe(true);
    expect(calls.some(name => name.includes("megadesk.getConversations"))).toBe(false);
  });

  test("falls back invalid persisted filters to Todas and Abertas", async ({ page }) => {
    await mockedPage(page);
    await page.goto("/?conversationScope=invalid&conversationInbox=invalid");
    await expect(page.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Abertas/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/conversationScope=all.*conversationInbox=open/);
  });

  test("exposes filters and actions to keyboard focus", async ({ page }) => {
    await mockedPage(page, true);
    const all = page.getByRole("button", { name: "Todas" });
    await all.focus();
    await expect(all).toBeFocused();
    await expect(page.getByRole("button", { name: "Transferir" })).toBeVisible();
    const details = page.locator('button[aria-controls="conversation-details-panel"]');
    await expect(details).toBeVisible();
    await details.focus();
    await expect(details).toBeFocused();
    await details.press("Enter");
    await expect(details).toHaveAttribute("aria-expanded", "true");
    await details.press("Space");
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await page.setViewportSize({ width: 768, height: 1024 });
    await details.click();
    await expect(page.getByTestId("conversation-details-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("conversation-details-panel")).toHaveCount(0);
  });

  test("opens prior history read-only without changing the operational conversation", async ({ page }) => {
    const { calls } = await mockedPage(page, true);
    await page.locator('button[aria-controls="conversation-details-panel"]').click();
    await page.getByRole("button", { name: /CV-HIST-1/ }).click();
    const modal = page.getByRole("dialog", { name: /Cliente UI/ });
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Somente leitura")).toBeVisible();
    await expect(modal.getByText("Mensagem histórica", { exact: true })).toBeVisible();
    await expect(modal.getByTestId("conversation-composer")).toHaveCount(0);
    await expect(page.getByTestId("conversation-chat-panel").getByText("Mensagem legada")).toBeVisible();
    expect(calls.some(name => name.includes("conversations.claim") || name.includes("conversations.transfer") || name.includes("conversations.close") || name.includes("conversations.reopen"))).toBe(false);
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId("conversation-chat-panel").getByText("Mensagem legada")).toBeVisible();
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`remains usable at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockedPage(page);
      await page.getByText("Cliente UI").click();
      await expect(page.getByTestId("conversation-composer")).toBeVisible();
      await page.locator('button[aria-controls="conversation-details-panel"]').click();
      await expect(page.getByTestId("conversation-details-panel")).toBeVisible();
      await expect(page.getByTestId("conversation-composer")).toBeVisible();
      await page.getByRole("button", { name: /CV-HIST-1/ }).click();
      await expect(page.getByRole("dialog", { name: /Cliente UI/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
