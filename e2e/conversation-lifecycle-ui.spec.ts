import { expect, test, type Page } from "@playwright/test";

const session = { clientId: "tenant-ui", company: "UI", permissions: ["conversations", "active-attendance"],
  userName: "Agent", userEmail: "agent@example.test", userRole: "agent", modules: ["conversations"],
  expiresAt: Date.now() + 3_600_000 };
const conversation = { id: "conv-ui", publicCode: "CV-260829000000-TEST", contactId: "contact-ui", crmClientId: "crm-ui",
  customerName: "Cliente UI", customerPhone: "5541999999999", companyText: null, companyName: "Empresa CRM UI", lastMessage: "Mensagem legada",
  customerType: "company" as "person" | "company", crmResponsibleName: "Cliente UI", crmPhone: "5541999999999", crmWhatsapp: "5541999999999", crmEmail: "cliente@example.test",
  lastMessageAt: new Date().toISOString(), unreadCount: 1, status: "open", assignedUserId: "user-ui",
  assignedUserName: "Agent", lastMessageFrom: "customer" };

async function mockedPage(page: Page, deepLink = false, options: { session?: typeof session; conversation?: typeof conversation; attendanceActive?: { id: string; customerName: string; phone: string } | null } = {}) {
  const activeSession = options.session ?? session;
  const activeConversation = options.conversation ?? conversation;
  const attendanceActive = options.attendanceActive ?? null;
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
    const rawInput = url.searchParams.get("input");
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
    const result = (name: string) => name.includes("refreshSession") ? { ok: true, session: activeSession }
      : name.includes("conversations.list") ? [activeConversation]
      : name.includes("conversations.counts") ? { active: 3, closed: 4, waiting: 2, mine: 1 }
      : name.includes("conversations.eligibleUsers") ? [{ id: "user-ui", name: "Agent", email: "agent@example.test", role: "agent" }]
      : name.includes("evolution.getStatus") ? { status: "connected", providerReachable: true }
      : name.includes("conversations.messages") ? { source: "legacy_json", messages: [{ id: "legacy-1", from: "customer", text: "Mensagem legada", type: "text", timestamp: new Date().toISOString() }] }
      : name.includes("conversations.companyCandidates") ? { items: [{ id: "crm-ui", name: "Empresa CRM UI", document: "12345678000190", customerType: "company" }], hasMore: false }
      : name.includes("conversations.phoneCandidates") ? { items: [{ id: "crm-phone", name: "Cliente localizado", document: "52998224725", phone: "5541999999999", customerType: "person" }] }
      : name.includes("conversations.historyDetail") ? { conversation: { id: "conv-old", publicCode: "CV-HIST-1", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, messages: [{ id: "history-message", from: "customer", type: "text", text: "Mensagem histórica", timestamp: new Date().toISOString() }] }
      : name.includes("conversations.history") ? [{ id: "conv-old", publicCode: "CV-HIST-1", status: "closed", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }, { id: conversation.id, publicCode: conversation.publicCode, status: "open", customerName: conversation.customerName, assignedUserName: "Agent", startedAt: new Date().toISOString() }]
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
    const body = names.map(name => ({ result: { data: { json: result(name) } } }));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(url.searchParams.get("batch") === "1" ? body : body[0]) });
  });
  await page.goto(deepLink ? "/?conversationId=conv-ui" : "/", { waitUntil: "domcontentloaded" });
  return { calls, listInputs, attendanceQueries };
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
      const { calls } = await mockedPage(page);
      await expect(page.getByTestId("attendance-primary-controls")).toBeVisible();
      await expect(page.getByTestId("attendance-action-controls")).toBeVisible();
      await expect(page.getByTestId("attendance-scope-controls")).toBeVisible();
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
