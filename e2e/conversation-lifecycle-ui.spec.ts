import { expect, test, type Page } from "@playwright/test";

const session = { clientId: "tenant-ui", company: "UI", permissions: ["conversations", "active-attendance"],
  userName: "Agent", userEmail: "agent@example.test", userRole: "agent", modules: ["conversations"],
  expiresAt: Date.now() + 3_600_000 };
const conversation = { id: "conv-ui", publicCode: "CV-260829000000-TEST", contactId: "contact-ui", crmClientId: "crm-ui",
  customerName: "Cliente UI", customerPhone: "5541999999999", companyText: null, companyName: "Empresa CRM UI", lastMessage: "Mensagem legada",
  customerType: "company" as "person" | "company", crmResponsibleName: "Cliente UI", crmPhone: "5541999999999", crmWhatsapp: "5541999999999", crmEmail: "cliente@example.test",
  lastMessageAt: new Date().toISOString(), unreadCount: 1, status: "open", assignedUserId: "user-ui",
  assignedUserName: "Agent", lastMessageFrom: "customer", provider: "evolution", channel: "whatsapp" };

type TimelineMessage = Record<string, unknown>;

async function mockedPage(page: Page, deepLink = false, options: { session?: typeof session; conversation?: typeof conversation; conversations?: Array<typeof conversation>; attendanceActive?: { id: string; customerName: string; phone: string } | null; transferError?: boolean; transferDelayMs?: number; sendDelayMs?: number; messages?: TimelineMessage[] } = {}) {
  const activeSession = options.session ?? session;
  const activeConversation = options.conversation ?? conversation;
  const activeConversations = options.conversations ?? [activeConversation];
  const attendanceActive = options.attendanceActive ?? null;
  const transferDelayMs = options.transferDelayMs ?? 0;
  const sendDelayMs = options.sendDelayMs ?? 0;
  const messageState: TimelineMessage[] = [...(options.messages ?? [{ id: "legacy-1", from: "customer", text: "Mensagem legada", type: "text", timestamp: new Date().toISOString() }])];
  let sentMessageCount = 0;
  const calls: string[] = [];
  const listInputs: Array<{ viewMode: string; status: string; search?: string }> = [];
  const attendanceQueries: string[] = [];
  await page.addInitScript(value => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(value));
    localStorage.setItem("megadesk_active_page_v1", "conversations");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { (window as typeof window & { __copiedConversationId?: string }).__copiedConversationId = text; },
    } });
  }, activeSession);
  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(url.pathname).replace(/^.*\/api\/trpc\//, "").split(",");
    calls.push(...names);
    const rawInput = url.searchParams.get("input") ?? route.request().postData();
    const parsedInput = rawInput ? JSON.parse(rawInput) : {};
    names.forEach((name, index) => {
      if (!name.includes("conversations.list")) return;
      const input = (parsedInput[index]?.json ?? parsedInput.json) as { viewMode: string; status: string; search?: string } | undefined;
      if (input) listInputs.push(input);
    });
    names.forEach((name, index) => {
      if (!name.includes("megadesk.attendanceRecipient")) return;
      const input = (parsedInput[index]?.json ?? parsedInput.json) as { query?: string } | undefined;
      if (input?.query) attendanceQueries.push(input.query);
    });
    if (transferDelayMs > 0 && names.some(name => name.includes("conversations.transfer"))) {
      await new Promise(resolve => setTimeout(resolve, transferDelayMs));
    }
    if (sendDelayMs > 0 && names.some(name => name.includes("megadesk.sendMessage") || name.includes("megadesk.sendAttachment"))) {
      await new Promise(resolve => setTimeout(resolve, sendDelayMs));
    }
    names.forEach((name, index) => {
      const input = (parsedInput[index]?.json ?? parsedInput.json) as Record<string, unknown> | undefined;
      if (name.includes("megadesk.sendMessage") && input) {
        sentMessageCount += 1;
        messageState.push({ id: `outbound-${sentMessageCount}`, sender: "agent", from: "agent", text: input.message,
          type: "text", timestamp: new Date().toISOString(), agentName: activeSession.userName,
          clientAttemptId: input.clientAttemptId, status: "sent" });
      }
      if (name.includes("megadesk.sendAttachment") && input) {
        sentMessageCount += 1;
        messageState.push({ id: `outbound-${sentMessageCount}`, sender: "agent", from: "agent", text: input.caption || "[Documento]",
          type: input.kind, mediaData: input.dataUrl, mimeType: input.mimeType, fileName: input.fileName,
          timestamp: new Date().toISOString(), agentName: activeSession.userName,
          clientAttemptId: input.clientAttemptId, status: "sent" });
      }
    });
    const result = (name: string) => name.includes("refreshSession") ? { ok: true, session: activeSession }
      : name.includes("conversations.list") ? activeConversations
      : name.includes("conversations.counts") ? { active: 3, closed: 4, waiting: 2, mine: 1 }
      : name.includes("conversations.eligibleUsers") ? [{ id: "user-ui", name: "Agent", email: "agent@example.test", role: "agent" }]
      : name.includes("evolution.getStatus") ? { status: "connected", providerReachable: true }
      : name.includes("conversations.messages") ? { source: "normalized", messages: messageState }
      : name.includes("conversations.companyCandidates") ? { items: [{ id: "crm-ui", name: "Empresa CRM UI", document: "12345678000190", customerType: "company" }], hasMore: false }
      : name.includes("conversations.phoneCandidates") ? { items: [{ id: "crm-phone", name: "Cliente localizado", document: "52998224725", phone: "5541999999999", customerType: "person" }] }
      : name.includes("conversations.historyDetail") ? { conversation: { id: "conv-old", publicCode: "CV-HIST-1", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, messages: [{ id: "history-message", from: "customer", type: "text", text: "Mensagem histórica", timestamp: new Date().toISOString() }] }
      : name.includes("conversations.historyPage") ? { items: [{ id: "conv-old", publicCode: "CV-HIST-1", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, { id: "conv-hist-2", publicCode: "CV-HIST-2", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, { id: "conv-hist-3", publicCode: "CV-HIST-3", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, { id: "conv-hist-4", publicCode: "CV-HIST-4", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }], hasMore: false }
      : name.includes("conversations.history") ? { items: [{ id: "conv-old", publicCode: "CV-HIST-1", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, { id: "conv-hist-2", publicCode: "CV-HIST-2", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, { id: "conv-hist-3", publicCode: "CV-HIST-3", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }], hasMore: true }
      : name.includes("conversations.linkedTickets") ? []
      : name.includes("conversations.updateContact") ? { contactId: conversation.contactId, displayName: "Cliente Editado", companyText: "Empresa Informada", canonicalPhone: conversation.customerPhone, crmClientId: conversation.crmClientId }
      : name.includes("megadesk.attendanceRecipient") ? (() => {
        const canonicalPhone = attendanceQueries.at(-1) === "11999998888" ? "5511999998888" : attendanceQueries.at(-1) ?? "";
        const isCrmPhone = canonicalPhone === "5541999999999";
        return { canonicalPhone, candidates: isCrmPhone ? [{ source: "crm", crmClientId: "crm-ui", customerType: "company", companyName: "Empresa CRM UI", responsibleName: "Cliente UI", phone: canonicalPhone, whatsapp: canonicalPhone, recipientPhone: canonicalPhone, email: "cliente@example.test" }] : [], activeConversation: attendanceActive };
      })()
      : name.includes("crm.create") ? { success: true, crmClientId: "crm-created-ui" }
      : name.includes("megadesk.createConversation") ? { conversationId: conversation.id, existing: false }
      : name.includes("megadesk.sendMessage") ? { ok: true, conversationId: conversation.id }
      : { ok: true };
    const body = names.map(name => options.transferError && name.includes("conversations.transfer")
      ? { error: { json: { message: "Não foi possível transferir a conversa", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: "conversations.transfer" } } } }
      : { result: { data: { json: result(name) } } });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(url.searchParams.get("batch") === "1" ? body : body[0]) });
  });
  await page.goto(deepLink ? "/?conversationId=conv-ui" : "/", { waitUntil: "domcontentloaded" });
  return { calls, listInputs, attendanceQueries, messageState };
}

test.describe("restored conversation layout with WIP lifecycle", () => {
  test("hides create for an already linked canonical client", async ({ page }) => {
    const managerSession = { ...session, permissions: ["conversations", "clients"], userRole: "manager" as const };
    await mockedPage(page, true, { session: managerSession });
    await page.locator('button[aria-controls="conversation-details-panel"]').click();
    const clientSection = page.locator("#client-content");
    await expect(clientSection.getByRole("button", { name: "Cadastrar cliente" })).toHaveCount(0);
    await expect(clientSection.getByRole("button", { name: "Visualizar perfil" })).toBeVisible();
  });

  test("keeps create above link with a phone candidate and renders search results as name only", async ({ page }) => {
    const managerSession = { ...session, permissions: ["conversations", "clients"], userRole: "manager" as const };
    const unlinked = { ...conversation, crmClientId: null, companyName: null };
    await mockedPage(page, true, { session: managerSession, conversation: unlinked });
    await page.locator('button[aria-controls="conversation-details-panel"]').click();
    await expect(page.getByText("Cliente encontrado pelo telefone")).toBeVisible();
    const clientSection = page.locator("#client-content");
    const create = clientSection.getByRole("button", { name: "Cadastrar cliente" });
    const toggle = clientSection.locator('button[aria-controls="crm-link-search"]');
    await expect(create).toBeVisible();
    expect(await create.evaluate((button, link) => !!(button.compareDocumentPosition(link as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await toggle.elementHandle())).toBe(true);
    await toggle.click();
    await page.getByPlaceholder("Digite o nome da pessoa ou empresa").fill("Em");
    const resultButton = page.locator("#crm-link-search li button");
    await expect(resultButton).toHaveText("Empresa CRM UI");
    await expect(resultButton).not.toContainText(/Pessoa|Empresa\s*$|1234|documento|telefone/i);
    await create.click();
    const dialog = page.getByRole("dialog", { name: "Cadastrar Novo Cliente" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Nome da empresa")).toHaveValue("Cliente UI");
    await expect(dialog.getByLabel("Telefone principal")).toHaveValue("5541999999999");
  });

  test("keeps the baseline two-column contract on the canonical backend", async ({ page }) => {
    const { calls, listInputs } = await mockedPage(page, true);
    await expect(page.getByTestId("conversation-list-panel")).toBeVisible();
    await expect(page.getByText("Cliente UI", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("conversation-chat-panel")).toBeVisible();
    await expect(page.getByText("Mensagem legada").last()).toBeVisible();
    await expect(page.getByTestId("conversation-list-panel").getByText(conversation.publicCode, { exact: true })).toHaveCount(0);
    await expect(page.getByText(conversation.publicCode, { exact: true })).toBeHidden();
    for (const label of ["Filtro", "Encerradas", "Todos", "Meus", "Novo atendimento", "BOT/Aguardando"]) {
      await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
    await expect(page.getByTestId("attendance-header").getByText("Atendimento", { exact: true })).toBeVisible();
    await expect(page.getByTestId("attendance-header").locator("svg")).toBeVisible();
    await expect(page.getByTestId("conversation-list-heading").getByText("Conversas ativas", { exact: true })).toBeVisible();
    await expect(page.getByTestId("conversation-list-count")).toHaveText("1");
    await expect(page.getByTestId("attendance-primary-controls").locator("button")).toHaveCount(1);
    await expect(page.getByTestId("attendance-action-controls").locator("button")).toHaveCount(2);
    await expect(page.getByTestId("attendance-scope-controls").locator("button")).toHaveCount(3);
    await expect(page.getByTestId("conversation-list-panel")).toHaveClass(/min-\[900px\]:w-\[420px\]/);
    await expect(page.locator(".fixed.inset-0.z-40")).toHaveCount(0);
    const all = page.getByRole("button", { name: "Todos" });
    await expect(all.locator("xpath=following-sibling::button[1]")).toHaveAccessibleName("Meus");
    await expect(page.getByTestId("attendance-action-controls").getByRole("button", { name: "Novo atendimento" })).toBeVisible();
    await expect(page.getByTestId("attendance-action-controls").getByRole("button", { name: "Encerradas" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Abertas/ })).toHaveCount(0);
    const mine = page.getByRole("button", { name: "Meus" });
    const closed = page.getByTestId("attendance-action-controls").getByRole("button", { name: "Encerradas", exact: true });
    const bot = page.getByRole("button", { name: "BOT/Aguardando" });
    await expect(closed).toHaveText("Encerradas");
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(bot).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "all", status: "active" });

    await mine.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(all).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "mine", status: "active" });
    await bot.click();
    await expect(mine).toHaveAttribute("aria-pressed", "false");
    await expect(bot).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/conversationScope=mine.*conversationInbox=bot/);
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "waiting", status: "active" });

    await closed.click();
    await expect(closed).toHaveAttribute("aria-pressed", "true");
    await expect(mine).toHaveAttribute("aria-pressed", "false");
    await expect(bot).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "all", status: "closed" });
    await all.click();
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(closed).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "all", status: "active" });

    await closed.click();
    await mine.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(closed).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "mine", status: "active" });

    await page.getByRole("button", { name: "Filtro" }).click();
    await page.getByPlaceholder("Nome, empresa ou telefone...").fill(conversation.publicCode);
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ search: conversation.publicCode });
    const detailsToggle = page.getByRole("button", { name: "Abrir detalhes da conversa" });
    await expect(detailsToggle).toHaveAttribute("aria-expanded", "false");
    await detailsToggle.click();
    await expect(page.getByTestId("conversation-details-panel")).toBeVisible();
    await expect(page.locator('[data-testid^="details-section-"]')).toHaveCount(5);
    await expect(page.getByText("Dados do cliente")).toBeVisible();
    await expect(page.locator("#client-content").getByRole("button", { name: "Cadastrar cliente" })).toHaveCount(0);
    await expect(page.locator("#client-content").getByText("Empresa CRM UI", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fechar detalhes da conversa" }).first()).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#attendance-content").getByText(conversation.publicCode, { exact: true })).toBeVisible();
    const copyId = page.getByRole("button", { name: "Copiar ID da conversa" });
    await copyId.focus();
    await expect(copyId).toBeFocused();
    await copyId.click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __copiedConversationId?: string }).__copiedConversationId)).toBe(conversation.publicCode);
    await expect(copyId).toContainText("Copiado");
    const copyPhone = page.getByRole("button", { name: "Copiar telefone" });
    await copyPhone.click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __copiedConversationId?: string }).__copiedConversationId)).toBe("+5541999999999");
    await expect(copyPhone).toContainText("Copiado");

    await expect(page.getByRole("button", { name: "+ Adicionar empresa" })).toHaveCount(0);
    await expect(page.getByLabel("Nome da empresa")).toHaveCount(0);
    await expect(page.getByTestId("conversation-details-panel")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Meus" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "BOT/Aguardando" })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("navigation").first().getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "MegaDesk" })).toBeVisible();
    const openRemountStart = listInputs.length;
    await page.getByRole("button", { name: "Atendimento Central de atendimento" }).click();
    await expect(page.getByRole("button", { name: "Meus" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "BOT/Aguardando" })).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "mine", status: "active" });
    expect(listInputs.slice(openRemountStart).some(input => input.viewMode === "all")).toBe(false);

    await page.getByRole("button", { name: "BOT/Aguardando" }).click();
    await page.goBack();
    await expect(page.getByRole("button", { name: "BOT/Aguardando" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Meus" })).toHaveAttribute("aria-pressed", "true");
    await page.goForward();
    await expect(page.getByRole("button", { name: "BOT/Aguardando" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("navigation").first().getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "MegaDesk" })).toBeVisible();
    const botRemountStart = listInputs.length;
    await page.getByRole("button", { name: "Atendimento Central de atendimento" }).click();
    await expect(page.getByRole("button", { name: "Meus" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "BOT/Aguardando" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => listInputs.at(-1)).toMatchObject({ viewMode: "waiting", status: "active" });
    expect(listInputs.slice(botRemountStart).some(input => input.viewMode === "all")).toBe(false);
    await expect(page.getByTestId("conversation-chat-panel")).toBeVisible();
    expect(calls.some(name => name.includes("conversations.list"))).toBe(true);
    expect(calls.some(name => name.includes("megadesk.getConversations"))).toBe(false);
  });

  test("renders a continuous conversation row from real channel metadata", async ({ page }) => {
    await mockedPage(page);
    const item = page.getByTestId("conversation-list-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Cliente UI");
    await expect(item.getByTestId("conversation-list-preview")).toHaveText("Mensagem legada");
    await expect(item.getByTestId("conversation-list-timestamp")).toHaveText(/^\d{2}:\d{2}$/);
    await expect(item.getByTestId("conversation-channel-badge")).toHaveAttribute("aria-label", "Canal WhatsApp");
    await expect(item.getByTestId("conversation-unread-badge")).toHaveText("1");
    await expect(item).toHaveAttribute("data-selected", "false");
    await item.click();
    await expect(item).toHaveAttribute("data-selected", "true");
  });

  test("refines the active header without replacing its real transfer or close flows", async ({ page }) => {
    const { calls } = await mockedPage(page, true);
    const header = page.getByTestId("active-conversation-header");
    await expect(header).toBeVisible();
    await expect(header.getByRole("button", { name: "Transferir", exact: true })).toHaveCount(0);
    await expect(header.locator('[title="Editar contato no painel"]')).toHaveCount(0);
    const transfer = header.getByRole("button", { name: "Transferir atendimento", exact: true });
    await expect(transfer).toHaveAttribute("title", "Transferir atendimento");
    await expect(header.getByRole("button", { name: "Encerrar atendimento", exact: true })).toBeVisible();

    await transfer.click();
    const dialog = page.getByTestId("transfer-conversation-dialog");
    await expect(dialog).toBeVisible();
    const currentUser = dialog.getByTestId("transfer-user-option");
    await expect(currentUser).toContainText("Agent");
    await expect(currentUser).toContainText("Atual");
    await expect(dialog.getByText("agent@example.test", { exact: true })).toHaveCount(0);
    await currentUser.click();
    await expect.poll(() => calls.some(name => name.includes("conversations.transfer"))).toBe(true);
    await expect(dialog).toHaveCount(0);

    const close = header.getByRole("button", { name: "Encerrar atendimento", exact: true });
    await close.click();
    await expect(page.getByText("Encerrar conversa?", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Não", exact: true }).click();
    await expect(page.getByText("Encerrar conversa?", { exact: true })).toHaveCount(0);
    await close.click();
    await page.getByRole("button", { name: "Sim", exact: true }).click();
    await expect.poll(() => calls.some(name => name.includes("conversations.close"))).toBe(true);
  });

  test("keeps transfer loading and error feedback while suppressing duplicate submits", async ({ page }) => {
    const { calls } = await mockedPage(page, true, { transferDelayMs: 500 });
    await page.getByRole("button", { name: "Transferir atendimento", exact: true }).click();
    const dialog = page.getByTestId("transfer-conversation-dialog");
    const user = dialog.getByTestId("transfer-user-option");
    await user.click();
    await expect(dialog.getByRole("status")).toHaveText("Transferindo atendimento…");
    await expect(user).toBeDisabled();
    expect(calls.filter(name => name.includes("conversations.transfer"))).toHaveLength(1);
    await expect(dialog).toHaveCount(0);

    await mockedPage(page, true, { transferError: true });
    await page.getByRole("button", { name: "Transferir atendimento", exact: true }).click();
    const failingDialog = page.getByTestId("transfer-conversation-dialog");
    await failingDialog.getByTestId("transfer-user-option").click();
    await expect(page.getByText("Não foi possível transferir a conversa", { exact: true })).toBeVisible();
    await expect(failingDialog).toBeVisible();
  });

  test("keeps contact-name editing available from the details sidebar", async ({ page }) => {
    await mockedPage(page, true, { conversation: { ...conversation, crmClientId: null, companyName: null } });
    await page.locator('button[aria-controls="conversation-details-panel"]').click();
    const details = page.getByTestId("conversation-details-panel");
    await details.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(details.getByLabel("Nome", { exact: true })).toBeVisible();
  });

  test("orders the real list locally without a conversation-list menu", async ({ page }) => {
    const older = { ...conversation, id: "conv-ui-older", customerName: "Conversa antiga", lastMessageAt: "2025-01-01T09:00:00.000Z" };
    const newer = { ...conversation, id: "conv-ui-newer", customerName: "Conversa recente", lastMessageAt: "2025-01-02T09:00:00.000Z" };
    await mockedPage(page, false, { conversations: [older, newer] });

    const items = page.getByTestId("conversation-list-item");
    await expect(page.getByTestId("conversation-list-heading").getByText("Conversas ativas", { exact: true })).toBeVisible();
    await expect(page.getByTestId("conversation-list-count")).toHaveText("2");
    await expect(items).toHaveCount(2);
    await expect(page.getByTestId("conversation-list-divider")).toHaveCount(2);
    await expect(items.first()).toContainText("Conversa recente");

    const sort = page.getByTestId("conversation-sort-button");
    await expect(sort).toHaveAccessibleName("Ordenação: mais recentes primeiro");
    await sort.click();
    await expect(sort).toHaveAccessibleName("Ordenação: mais antigas primeiro");
    await expect(items.first()).toContainText("Conversa antiga");

    await expect(page.getByTestId("conversation-list-menu-toggle")).toHaveCount(0);
    await expect(page.getByRole("menu", { name: "Opções da lista de conversas" })).toHaveCount(0);
  });

  test("does not invent a WhatsApp badge when the provider metadata is absent", async ({ page }) => {
    await mockedPage(page, false, { conversation: { ...conversation, provider: null, channel: null, unreadCount: 0 } });
    const item = page.getByTestId("conversation-list-item");
    await expect(item.getByTestId("conversation-channel-badge")).toHaveCount(0);
    await expect(item.getByTestId("conversation-unread-badge")).toHaveCount(0);
  });

  test("keeps the same list language for closed conversations", async ({ page }) => {
    await mockedPage(page, false, { conversation: { ...conversation, status: "closed", unreadCount: 0 } });
    await page.getByRole("button", { name: "Encerradas", exact: true }).click();
    await expect(page.getByTestId("conversation-list-heading").getByText("Conversas encerradas", { exact: true })).toBeVisible();
    await expect(page.getByTestId("conversation-list-count")).toHaveText("1");
    await expect(page.getByTestId("conversation-list-item")).toContainText("Cliente UI");
  });

  test("requires a name and starts an attendance from a new lightweight contact without creating a CRM client", async ({ page }) => {
    const { calls } = await mockedPage(page, true);
    await page.getByTitle("Abrir menu").click();
    const navigation = page.getByRole("navigation").first();
    await expect(navigation.getByRole("button", { name: /^Atendimento/ })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Conversas", exact: true })).toHaveCount(0);
    await expect(navigation.getByRole("button", { name: "Atendimento Ativo", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Novo atendimento" }).click();
    const flow = page.getByTestId("new-attendance-flow");
    await expect(flow).toBeVisible();
    await expect(flow.getByRole("heading", { name: "Novo atendimento" })).toBeVisible();
    const phone = flow.getByLabel("Para", { exact: true });
    await phone.fill("5541988888888");
    await expect(flow.getByText("Usar este número", { exact: true })).toBeVisible();
    expect(calls.some(name => name.includes("megadesk.createConversation"))).toBe(false);
    await flow.getByText("Usar este número", { exact: true }).click();
    await expect(flow.getByTestId("new-contact-card")).toBeVisible();
    const message = flow.getByLabel("Mensagem", { exact: true });
    await expect(message).toBeDisabled();
    await flow.getByLabel("Nome", { exact: true }).fill("João Victor");
    await expect(message).toBeEnabled();
    await message.fill("Olá, preciso de atendimento.");
    await flow.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect.poll(() => calls.some(name => name.includes("megadesk.createConversation"))).toBe(true);
    await expect.poll(() => calls.some(name => name.includes("megadesk.sendMessage"))).toBe(true);
    expect(calls.some(name => name.includes("crm.create"))).toBe(false);
    await expect(page.getByTestId("new-attendance-composer")).toHaveCount(0, { timeout: 3_000 });
    await expect(page.getByTestId("conversation-chat-panel").getByText("Mensagem legada")).toBeVisible();
  });

  test("accepts DDD plus Brazilian number without requiring +55 in the new attendance flow", async ({ page }) => {
    const { attendanceQueries } = await mockedPage(page);
    await page.getByRole("button", { name: "Novo atendimento" }).click();
    const flow = page.getByTestId("new-attendance-flow");
    await flow.getByLabel("Para", { exact: true }).fill("11999998888");
    await expect.poll(() => attendanceQueries).toContain("11999998888");
    await flow.getByText("Usar este número", { exact: true }).click();
    await expect(flow.getByTestId("new-contact-card")).toBeVisible();
  });

  test("shows CRM data in the blue customer card", async ({ page }) => {
    await mockedPage(page);
    await page.getByRole("button", { name: "Novo atendimento" }).click();
    const flow = page.getByTestId("new-attendance-flow");
    await flow.getByLabel("Para", { exact: true }).fill("5541999999999");
    await flow.getByRole("button", { name: /Cliente UI/ }).click();
    const customerCard = flow.getByTestId("existing-customer-card");
    await expect(customerCard).toBeVisible();
    await expect(customerCard).toContainText("Cliente UI");
    await expect(customerCard).toContainText("Empresa CRM UI");
    await expect(customerCard).toContainText("+55 41 99999-9999");
  });

  test("renders a linked person without company labels", async ({ page }) => {
    await mockedPage(page, true, { conversation: { ...conversation, customerName: "Pessoa UI", companyName: "Pessoa UI", customerType: "person", crmResponsibleName: "Pessoa UI" } });
    await page.locator('button[aria-controls="conversation-details-panel"]').click();
    const clientSection = page.locator("#client-content");
    await expect(clientSection.getByText("Pessoa física", { exact: true })).toBeVisible();
    await expect(clientSection.getByText("Pessoa UI", { exact: true })).toBeVisible();
    await expect(clientSection.getByText("Empresa / nome fantasia", { exact: true })).toHaveCount(0);
  });

  test("does not expose automatic CRM creation for a new lightweight contact", async ({ page }) => {
    const { calls } = await mockedPage(page);
    await page.getByRole("button", { name: "Novo atendimento" }).click();
    const flow = page.getByTestId("new-attendance-flow");
    await flow.getByLabel("Para", { exact: true }).fill("5541988888888");
    await flow.getByText("Usar este número", { exact: true }).click();
    await expect(flow.getByRole("button", { name: "Cadastrar cliente" })).toHaveCount(0);
    await flow.getByLabel("Nome", { exact: true }).fill("Contato leve");
    await expect(flow.getByLabel("Mensagem", { exact: true })).toBeEnabled();
    expect(calls.some(name => name.includes("crm.create"))).toBe(false);
    expect(calls.some(name => name.includes("megadesk.createConversation"))).toBe(false);
  });

  test("sends the first attachment through the official outbound endpoint", async ({ page }) => {
    const { calls } = await mockedPage(page);
    await page.getByRole("button", { name: "Novo atendimento" }).click();
    const flow = page.getByTestId("new-attendance-flow");
    await flow.getByLabel("Para", { exact: true }).fill("5541988888888");
    await flow.getByText("Usar este número", { exact: true }).click();
    await flow.getByLabel("Nome", { exact: true }).fill("Contato com anexo");
    await flow.locator('input[type="file"]').setInputFiles({
      name: "primeiro-contato.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("anexo controlado"),
    });
    await expect(flow.getByText("primeiro-contato.txt", { exact: true })).toBeVisible();
    await flow.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect.poll(() => calls.some(name => name.includes("megadesk.createConversation"))).toBe(true);
    await expect.poll(() => calls.some(name => name.includes("megadesk.sendAttachment"))).toBe(true);
    expect(calls.some(name => name.includes("megadesk.sendMessage"))).toBe(false);
  });

  test("records and sends the first audio through the official outbound endpoint", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }),
      } });
      class FakeMediaRecorder {
        static isTypeSupported() { return true; }
        mimeType = "audio/webm;codecs=opus";
        state: "inactive" | "recording" = "inactive";
        ondataavailable: ((event: BlobEvent) => unknown) | null = null;
        onstop: ((event: Event) => unknown) | null = null;
        onerror: ((event: ErrorEvent) => unknown) | null = null;
        start() { this.state = "recording"; }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob(["audio controlado"], { type: this.mimeType }) } as BlobEvent);
          queueMicrotask(() => this.onstop?.(new Event("stop")));
        }
      }
      Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
    });
    const { calls } = await mockedPage(page);
    await page.getByRole("button", { name: "Novo atendimento" }).click();
    const flow = page.getByTestId("new-attendance-flow");
    await flow.getByLabel("Para", { exact: true }).fill("5541988888888");
    await flow.getByText("Usar este número", { exact: true }).click();
    await flow.getByLabel("Nome", { exact: true }).fill("Contato com áudio");
    await flow.getByRole("button", { name: "Gravar áudio" }).click();
    await expect(flow.getByRole("button", { name: "Enviar áudio" })).toBeVisible();
    await flow.getByRole("button", { name: "Enviar áudio" }).click();
    await expect.poll(() => calls.some(name => name.includes("megadesk.createConversation"))).toBe(true);
    await expect.poll(() => calls.some(name => name.includes("megadesk.sendAttachment"))).toBe(true);
  });

  test("sends an attachment and recorded audio from the active attendance composer", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }),
      } });
      class FakeMediaRecorder {
        static isTypeSupported() { return true; }
        mimeType = "audio/webm;codecs=opus";
        state: "inactive" | "recording" = "inactive";
        ondataavailable: ((event: BlobEvent) => unknown) | null = null;
        onstop: ((event: Event) => unknown) | null = null;
        onerror: ((event: ErrorEvent) => unknown) | null = null;
        start() { this.state = "recording"; }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob(["audio controlado"], { type: this.mimeType }) } as BlobEvent);
          queueMicrotask(() => this.onstop?.(new Event("stop")));
        }
      }
      Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
    });
    const { calls } = await mockedPage(page);
    await page.getByText("Cliente UI", { exact: true }).first().click();
    const composer = page.getByTestId("conversation-composer");
    await composer.locator('input[type="file"]').setInputFiles({ name: "ativo.txt", mimeType: "text/plain", buffer: Buffer.from("anexo ativo") });
    await expect(composer.getByText("ativo.txt", { exact: true })).toBeVisible();
    await composer.locator("button").last().click();
    await expect.poll(() => calls.some(name => name.includes("megadesk.sendAttachment"))).toBe(true);

    await composer.getByRole("button", { name: "Gravar áudio" }).click();
    await expect(composer.getByRole("button", { name: "Enviar áudio" })).toBeVisible();
    await composer.getByRole("button", { name: "Enviar áudio" }).click();
    await expect.poll(() => calls.filter(name => name.includes("megadesk.sendAttachment")).length).toBeGreaterThanOrEqual(2);
  });

  test("blocks a new attendance when a server-side lookup finds an active one", async ({ page }) => {
    await mockedPage(page, false, { attendanceActive: { id: "conv-active-ui", customerName: "Cliente em atendimento", phone: "5541988888888" } });
    await page.getByRole("button", { name: "Novo atendimento" }).click();
    const flow = page.getByTestId("new-attendance-flow");
    await flow.getByLabel("Para", { exact: true }).fill("5541988888888");
    await flow.getByText("Usar este número", { exact: true }).click();
    await expect(flow.getByTestId("active-attendance-warning")).toBeVisible();
    await expect(flow.getByLabel("Mensagem", { exact: true })).toBeDisabled();
    await flow.getByRole("button", { name: "Abrir atendimento" }).click();
    await expect(page.getByTestId("new-attendance-composer")).toHaveCount(0);
    await expect(page.getByTestId("conversation-chat-panel")).toBeVisible();
  });

  test("routes the legacy active-attendance intent into the unified composer", async ({ page }) => {
    await mockedPage(page);
    await expect(page.getByRole("button", { name: "Novo atendimento" })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("megadesk-navigate", {
      detail: { route: "active-attendance", phone: "5541999999999" },
    })));
    const flow = page.getByTestId("new-attendance-flow");
    await expect(flow).toBeVisible();
    await expect(flow.getByLabel("Para", { exact: true })).toHaveValue("5541999999999");
    await flow.getByRole("button", { name: "Fechar novo atendimento" }).click();
    await expect(flow).toHaveCount(0);
    await expect(page.getByTestId("conversation-list-panel")).toBeVisible();
  });

  test("falls back invalid persisted filters to Todos ativos", async ({ page }) => {
    await mockedPage(page);
    await page.goto("/?conversationScope=invalid&conversationInbox=invalid");
    await expect(page.getByRole("button", { name: "Todos" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "BOT/Aguardando" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: /Abertas/ })).toHaveCount(0);
    await expect(page).toHaveURL(/conversationScope=all.*conversationInbox=open/);
  });

  test("exposes filters and actions to keyboard focus", async ({ page }) => {
    await mockedPage(page, true);
    const all = page.getByRole("button", { name: "Todos" });
    await all.focus();
    await expect(all).toBeFocused();
    await expect(page.getByRole("button", { name: "Transferir atendimento" })).toBeVisible();
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

  test("opens all prior attendances contextually without rendering the current conversation", async ({ page }) => {
    await mockedPage(page, true);
    await page.locator('button[aria-controls="conversation-details-panel"]').click();
    const details = page.getByTestId("conversation-details-panel");
    await expect(details.getByRole("button", { name: /CV-260829000000-TEST/ })).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Ver todos os atendimentos" })).toBeVisible();
    await details.getByRole("button", { name: "Ver todos os atendimentos" }).click();
    const browser = page.getByRole("dialog", { name: /Histórico de Cliente UI/ });
    await expect(browser).toBeVisible();
    await expect(browser.getByRole("button", { name: /CV-HIST-4/ })).toBeVisible();
    await browser.getByRole("button", { name: /CV-HIST-2/ }).click();
    await expect(page.getByRole("dialog", { name: "Cliente UI", exact: true })).toBeVisible();
  });

  test("opens inbound and outbound images safely, preserves video controls, and never renders an operator email", async ({ page }) => {
    const marcelo = { ...session, userName: "Marcelo Moura", userEmail: "marcelo@gmail.com" };
    const image = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    await mockedPage(page, true, { session: marcelo, messages: [
      { id: "inbound-image", from: "customer", type: "image", mediaData: image, fileName: "entrada.png", text: "Imagem recebida", timestamp: new Date().toISOString() },
      { id: "outbound-image", sender: "agent", from: "agent", type: "image", mediaData: image, fileName: "saida.png", text: "Imagem enviada", agentName: "Marcelo Moura", status: "sent", timestamp: new Date().toISOString() },
      { id: "outbound-video", sender: "agent", from: "agent", type: "video", mediaData: "data:video/mp4;base64,AAAA", fileName: "video.mp4", text: "Vídeo enviado", agentName: "Marcelo Moura", status: "delivered", timestamp: new Date().toISOString() },
      { id: "outbound-audio", sender: "agent", from: "agent", type: "audio", mediaData: "data:audio/ogg;base64,T2dnUw==", fileName: "audio.ogg", text: "[Áudio]", agentName: "Marcelo Moura", status: "read", timestamp: new Date().toISOString() },
      { id: "outbound-pending", sender: "agent", from: "agent", type: "text", text: "Aguardando confirmação", agentName: "Marcelo Moura", status: "pending", timestamp: new Date().toISOString() },
      { id: "outbound-failed", sender: "agent", from: "agent", type: "text", text: "Falhou", agentName: "Marcelo Moura", status: "failed", timestamp: new Date().toISOString() },
    ] });
    const chat = page.getByTestId("conversation-chat-panel");
    await expect(chat.getByTestId("conversation-message").getByText("Marcelo Moura", { exact: true })).toHaveCount(5);
    await expect(chat.getByText("marcelo@gmail.com", { exact: true })).toHaveCount(0);
    await expect(chat.getByLabel("Enviada")).toBeVisible();
    await expect(chat.getByLabel("Entregue")).toBeVisible();
    await expect(chat.getByLabel("Lida")).toBeVisible();
    await expect(chat.getByLabel("Enviando")).toBeVisible();
    await expect(chat.getByLabel("Falha no envio")).toBeVisible();
    await expect(chat.locator("video[controls]")).toBeVisible();

    const inbound = chat.getByRole("button", { name: "Abrir entrada.png em tamanho ampliado" });
    await inbound.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByRole("img", { name: "entrada.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await chat.getByRole("button", { name: "Abrir saida.png em tamanho ampliado" }).click();
    await expect(page.getByRole("dialog").getByRole("img", { name: "saida.png" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("reconciles each outbound attempt to one canonical bubble without merging equal messages", async ({ page }) => {
    const { messageState } = await mockedPage(page, true, { sendDelayMs: 350 });
    const composer = page.getByTestId("conversation-composer");
    const input = composer.getByPlaceholder("Digite sua mensagem...");
    await input.fill("Ok");
    await input.press("Enter");
    await expect(page.getByTestId("conversation-chat-panel").getByText("Ok", { exact: true })).toHaveCount(1);
    await page.waitForTimeout(500);
    await expect(page.getByTestId("conversation-chat-panel").getByText("Ok", { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("conversation-chat-panel").getByLabel("Enviada")).toBeVisible();
    expect(messageState.filter(message => message.text === "Ok")).toHaveLength(1);

    await input.fill("Ok");
    await input.press("Enter");
    await page.waitForTimeout(500);
    await expect(page.getByTestId("conversation-chat-panel").getByText("Ok", { exact: true })).toHaveCount(2);
    expect(messageState.filter(message => message.text === "Ok")).toHaveLength(2);
  });

  test("keeps a reader above the newest message through polling, receipt updates, and new inbound messages", async ({ page }) => {
    const messages: TimelineMessage[] = [
      { id: "receipt-target", sender: "agent", from: "agent", type: "text", text: "Mensagem enviada", agentName: "Agent", status: "sent", timestamp: new Date().toISOString() },
      ...Array.from({ length: 54 }, (_, index) => ({ id: `history-${index}`, from: "customer", type: "text", text: `Histórico ${index}`, timestamp: new Date(Date.now() + index * 1_000).toISOString() })),
    ];
    const { messageState } = await mockedPage(page, true, { messages });
    const scroll = page.getByTestId("conversation-message-scroll-region");
    await expect.poll(() => scroll.evaluate(element => element.scrollTop > 0)).toBe(true);
    await scroll.evaluate(element => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(1_200);
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeLessThan(8);

    messageState[0] = { ...messageState[0], status: "read" };
    await page.waitForTimeout(3_300);
    await expect(page.locator('[data-testid="conversation-message-receipt"][aria-label="Lida"]')).toBeVisible();
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeLessThan(8);

    messageState.push({ id: "incoming-after-scroll", from: "customer", type: "text", text: "Chegou enquanto lia", timestamp: new Date().toISOString() });
    await page.waitForTimeout(3_300);
    await expect(page.getByText("Chegou enquanto lia", { exact: true })).toBeVisible();
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeLessThan(8);

    await scroll.evaluate(element => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    messageState.push({ id: "incoming-at-bottom", from: "customer", type: "text", text: "Chegou no fim", timestamp: new Date().toISOString() });
    await page.waitForTimeout(3_300);
    await expect(page.getByText("Chegou no fim", { exact: true })).toBeVisible();
    await expect.poll(() => scroll.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(96);
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`keeps the media lightbox usable at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockedPage(page, true, { messages: [{
        id: `image-${viewport.width}`, from: "customer", type: "image", fileName: "responsiva.png",
        mediaData: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", text: "Imagem responsiva", timestamp: new Date().toISOString(),
      }] });
      await page.getByRole("button", { name: "Abrir responsiva.png em tamanho ampliado" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("img", { name: "responsiva.png" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });

    test(`remains usable at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { calls } = await mockedPage(page);
      await expect(page.getByTestId("attendance-primary-controls")).toBeVisible();
      await expect(page.getByTestId("attendance-action-controls")).toBeVisible();
      await expect(page.getByTestId("attendance-scope-controls")).toBeVisible();
      await expect(page.getByTestId("conversation-list-heading")).toBeVisible();
      const [panelBox, headerBox, filterBox, actionsBox, scopesBox, listHeadingBox] = await Promise.all([
        page.getByTestId("conversation-list-panel").boundingBox(),
        page.getByTestId("attendance-header").boundingBox(),
        page.getByTestId("attendance-primary-controls").boundingBox(),
        page.getByTestId("attendance-action-controls").boundingBox(),
        page.getByTestId("attendance-scope-controls").boundingBox(),
        page.getByTestId("conversation-list-heading").boundingBox(),
      ]);
      expect(panelBox).not.toBeNull();
      expect(headerBox).not.toBeNull();
      expect(filterBox).not.toBeNull();
      expect(actionsBox).not.toBeNull();
      expect(scopesBox).not.toBeNull();
      expect(listHeadingBox).not.toBeNull();
      expect(filterBox!.y).toBeGreaterThan(headerBox!.y);
      expect(actionsBox!.y).toBeGreaterThan(filterBox!.y);
      expect(scopesBox!.y).toBeGreaterThan(actionsBox!.y);
      expect(listHeadingBox!.y).toBeGreaterThan(scopesBox!.y);
      expect(filterBox!.width).toBeGreaterThanOrEqual(panelBox!.width - 33);
      const actionWidths = await page.getByTestId("attendance-action-controls").locator("button").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width));
      const scopeWidths = await page.getByTestId("attendance-scope-controls").locator("button").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width));
      expect(Math.abs(actionWidths[0] - actionWidths[1])).toBeLessThanOrEqual(2);
      expect(Math.max(...scopeWidths) - Math.min(...scopeWidths)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const newAttendance = page.getByTestId("attendance-action-controls").getByRole("button", { name: "Novo atendimento" });
      await expect(newAttendance.locator("span")).toHaveCSS("white-space", "nowrap");
      await newAttendance.click();
      const newAttendanceFlow = page.getByTestId("new-attendance-flow");
      const newAttendanceComposer = page.getByTestId("new-attendance-message-composer");
      await expect(newAttendanceFlow).toBeVisible();
      await expect(newAttendanceComposer).toBeVisible();
      const [flowBox, chatBox] = await Promise.all([newAttendanceFlow.boundingBox(), page.getByTestId("conversation-chat-panel").boundingBox()]);
      expect(flowBox).not.toBeNull();
      expect(chatBox).not.toBeNull();
      expect(flowBox!.x).toBe(chatBox!.x);
      expect(flowBox!.width).toBe(chatBox!.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await newAttendanceFlow.getByRole("button", { name: "Fechar novo atendimento" }).click();
      await page.getByText("Cliente UI").click();
      await expect(page.getByTestId("conversation-composer")).toBeVisible();
      const activeHeader = page.getByTestId("active-conversation-header");
      const transfer = activeHeader.getByRole("button", { name: "Transferir atendimento", exact: true });
      const close = activeHeader.getByRole("button", { name: "Encerrar atendimento", exact: true });
      await expect(transfer).toBeVisible();
      await expect(close).toBeVisible();
      const [activeHeaderBox, transferBox, closeBox] = await Promise.all([activeHeader.boundingBox(), transfer.boundingBox(), close.boundingBox()]);
      expect(activeHeaderBox).not.toBeNull();
      expect(transferBox).not.toBeNull();
      expect(closeBox).not.toBeNull();
      expect(transferBox!.x + transferBox!.width).toBeLessThanOrEqual(activeHeaderBox!.x + activeHeaderBox!.width);
      expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(activeHeaderBox!.x + activeHeaderBox!.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.locator('button[aria-controls="conversation-details-panel"]').click();
      await expect(page.getByTestId("conversation-details-panel")).toBeVisible();
      await expect(page.getByTestId("conversation-composer")).toBeVisible();
      const linkToggle = page.locator('button[aria-controls="crm-link-search"]');
      const candidateCalls = () => calls.filter(name => name.includes("conversations.companyCandidates")).length;
      expect(candidateCalls()).toBe(0);
      await expect(linkToggle).toHaveAttribute("aria-expanded", "false");
      await linkToggle.click();
      await expect(linkToggle).toHaveAttribute("aria-expanded", "true");
      const search = page.getByPlaceholder("Digite o nome da pessoa ou empresa");
      await expect(search).toBeFocused();
      await expect(page.getByText("Digite para buscar um cadastro.")).toBeVisible();
      expect(candidateCalls()).toBe(0);
      await search.fill(" ");
      await expect.poll(candidateCalls).toBe(0);
      await search.fill("E");
      await expect(page.getByText("Digite pelo menos 2 caracteres.")).toBeVisible();
      await expect.poll(candidateCalls).toBe(0);
      await search.fill("Em");
      await expect.poll(candidateCalls).toBe(1);
      await expect(page.locator("#crm-link-search").getByText("Empresa CRM UI", { exact: true })).toBeVisible();
      await search.fill("");
      await expect(page.locator("#crm-link-search").getByText("Empresa CRM UI", { exact: true })).toHaveCount(0);
      await linkToggle.click();
      await expect(linkToggle).toHaveAttribute("aria-expanded", "false");
      await expect(search).toHaveCount(0);
      await expect(linkToggle).toBeFocused();
      await linkToggle.click();
      await expect(page.getByPlaceholder("Digite o nome da pessoa ou empresa")).toHaveValue("");
      await linkToggle.click();
      await page.getByRole("button", { name: /CV-HIST-1/ }).click();
      await expect(page.getByRole("dialog", { name: /Cliente UI/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
