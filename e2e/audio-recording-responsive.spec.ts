import { expect, test, type Page } from "@playwright/test";

const conversation = {
  id: "conversation-e2e",
  customerName: "Cliente Teste Responsivo",
  customerPhone: "5511000000000",
  companyName: "Empresa com nome suficientemente longo para testar truncamento",
  companyText: null,
  lastMessage: "Mensagem de teste",
  lastMessageAt: new Date().toISOString(),
  status: "open",
  unreadCount: 0,
  isUnread: false,
  lastMessageFrom: "customer",
  timestamp: 1_700_000_000_000,
  assignedTo: null,
  assignedUserId: null,
};

const publicSession = {
  clientId: "e2e-tenant",
  company: "E2E",
  permissions: ["conversations"],
  userName: "Atendente E2E",
  userEmail: "e2e@example.test",
  userRole: "agent" as const,
  plan: "test",
  modules: ["conversations"],
  expiresAt: Date.now() + 3_600_000,
};

async function preparePage(page: Page, options: { sendStatus?: number; sendMessage?: string } = {}) {
  await page.addInitScript((session) => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(session));
    localStorage.setItem("megadesk_active_page_v1", "conversations");
    Reflect.set(window, "__audioTracksStopped", 0);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => Reflect.set(window, "__audioTracksStopped", Number(Reflect.get(window, "__audioTracksStopped")) + 1) }],
        }),
      },
    });
    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      mimeType = "audio/webm;codecs=opus";
      state: "inactive" | "recording" = "inactive";
      ondataavailable: ((event: BlobEvent) => unknown) | null = null;
      onstop: ((event: Event) => unknown) | null = null;
      onerror: ((event: ErrorEvent) => unknown) | null = null;
      start() { this.state = "recording"; }
      stop() {
        if (this.state === "inactive") throw new Error("MediaRecorder.stop called twice");
        this.state = "inactive";
        setTimeout(() => this.onstop?.(new Event("stop")), 0);
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
  }, publicSession);
  let sendRequests = 0;
  await page.route("**/api/trpc/**", async route => {
    const url = route.request().url();
    if (url.includes("megadesk.sendMessage") || url.includes("megadesk.sendAttachment")) {
      sendRequests += 1;
      if (options.sendStatus) {
        await route.fulfill({
          status: options.sendStatus,
          contentType: "application/json",
          body: JSON.stringify({ error: { json: { message: options.sendMessage ?? "Falha controlada", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: options.sendStatus } } } }),
        });
        return;
      }
    }
    const procedures = decodeURIComponent(new URL(url).pathname)
      .replace(/^.*\/api\/trpc\//, "")
      .split(","),
      response = (procedure: string): unknown =>
        procedure.includes("megadesk.refreshSession")
          ? { ok: true, session: publicSession }
          : procedure.includes("conversations.list")
            ? [conversation]
            : procedure.includes("conversations.messages")
              ? { source: "legacy_json", messages: [] }
              : procedure.includes("conversations.counts")
                ? { active: 1, closed: 0, waiting: 0, mine: 0 }
                : procedure.includes("conversations.eligibleUsers")
                  ? []
              : procedure.includes("evolution.getStatus")
                ? { status: "connected" }
                : null,
      payloads = procedures.map(procedure => ({
        result: { data: { json: response(procedure) } },
      }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        new URL(url).searchParams.get("batch") === "1"
          ? payloads
          : payloads[0]
      ),
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /Cliente Teste Responsivo/ })).toBeVisible();
  return { getSendRequests: () => sendRequests };
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  return dimensions;
}

test.describe("Conversas responsivas e áudio seguro", () => {
  test("sessão válida alcança a mutation outbound mockada", async ({ page }) => {
    const requests = await preparePage(page);
    await page.getByRole("button", { name: /Cliente Teste Responsivo/ }).click();
    const input = page.getByPlaceholder("Digite sua mensagem...");
    await input.fill("Mensagem controlada");
    await input.press("Enter");
    await expect.poll(requests.getSendRequests).toBe(1);
    await expect(input).toHaveValue("");
  });

  test("sessão inválida preserva o texto e não produz falso sucesso", async ({ page }) => {
    const requests = await preparePage(page, { sendStatus: 401, sendMessage: "Sessão MegaDesk inválida. Faça login novamente." });
    await page.getByRole("button", { name: /Cliente Teste Responsivo/ }).click();
    const input = page.getByPlaceholder("Digite sua mensagem...");
    await input.fill("Mensagem preservada");
    await input.press("Enter");
    await expect.poll(requests.getSendRequests).toBe(1);
    await expect(input).toHaveValue("Mensagem preservada");
    await expect(page.getByText("Sessão MegaDesk inválida. Faça login novamente.")).toBeVisible();
  });

  test("390x844 usa painel único e mantém o composer e áudio acessíveis", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests = await preparePage(page);
    const list = page.getByTestId("conversation-list-panel");
    const chat = page.getByTestId("conversation-chat-panel");
    await expect(list).toBeVisible();
    await expect(chat).toBeHidden();
    const listDimensions = await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: /Cliente Teste Responsivo/ }).click();
    await expect(list).toBeHidden();
    await expect(chat).toBeVisible();
    const composer = page.getByTestId("conversation-composer");
    const composerBox = await composer.boundingBox();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.x).toBeGreaterThanOrEqual(0);
    expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(390);
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(844);
    const input = page.getByPlaceholder("Digite sua mensagem...");
    await input.focus();
    await expect(input).toBeFocused();

    await page.getByRole("button", { name: "Gravar áudio" }).click();
    const cancel = page.getByRole("button", { name: "Cancelar gravação" });
    const send = page.getByRole("button", { name: "Enviar áudio" });
    await expect(cancel).toBeVisible();
    await expect(send).toBeVisible();
    const [cancelBox, sendBox] = await Promise.all([cancel.boundingBox(), send.boundingBox()]);
    expect(cancelBox).not.toBeNull();
    expect(sendBox).not.toBeNull();
    expect(cancelBox!.x + cancelBox!.width <= sendBox!.x || sendBox!.x + sendBox!.width <= cancelBox!.x).toBe(true);
    const chatDimensions = await expectNoHorizontalOverflow(page);
    await cancel.click();
    await expect(page.getByRole("button", { name: "Gravar áudio" })).toBeVisible();

    await page.getByRole("button", { name: "Gravar áudio" }).click();
    await page.getByRole("button", { name: "Voltar para conversas" }).click();
    await expect(list).toBeVisible();
    await expect(chat).toBeHidden();
    expect(await page.evaluate(() => Number(Reflect.get(window, "__audioTracksStopped")))).toBe(2);
    expect(requests.getSendRequests()).toBe(0);
    console.log(JSON.stringify({ viewport: "390x844", listDimensions, chatDimensions, composer: composerBox }));
  });

  for (const viewport of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`${viewport.width}x${viewport.height} preserva navegação e largura`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await preparePage(page);
      const list = page.getByTestId("conversation-list-panel");
      const chat = page.getByTestId("conversation-chat-panel");
      await expect(list).toBeVisible();
      if (viewport.width < 900) await expect(chat).toBeHidden();
      else await expect(chat).toBeVisible();
      await page.getByRole("button", { name: /Cliente Teste Responsivo/ }).click();
      await expect(chat).toBeVisible();
      if (viewport.width < 900) await expect(list).toBeHidden();
      else await expect(list).toBeVisible();
      const composer = page.getByTestId("conversation-composer");
      await expect(composer).toBeVisible();
      const dimensions = await expectNoHorizontalOverflow(page);
      console.log(JSON.stringify({ viewport: `${viewport.width}x${viewport.height}`, dimensions, composer: await composer.boundingBox() }));
    });
  }
});
