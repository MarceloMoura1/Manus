import { expect, test, type Page } from "@playwright/test";

const session = { clientId: "tenant-visual", company: "Visual", permissions: ["conversations"], userName: "Visual", userEmail: "visual@example.test", userRole: "agent", plan: "test", modules: ["conversations"], expiresAt: Date.now() + 3_600_000 };
const conversation = { id: "conv-visual", name: "Conversa Visual", phone: "000", company: "Teste", lastMessage: "Teste", status: "open", unreadCount: 0, isUnread: false, lastMessageFrom: "customer", timestamp: 1 };
type Options = { type: "image"|"audio"|"video"|"document"|"sticker"; legacy?: boolean; status?: number };

async function pageWithMedia(page: Page, options: Options) {
  await page.addInitScript(value => { localStorage.setItem("megadesk_session_v1", JSON.stringify(value)); localStorage.setItem("megadesk_active_page_v1", "conversations"); }, session);
  let bridgeCalls = 0;
  await page.route("**/api/conversations/**/media*", async route => { bridgeCalls++; await route.fulfill({ status: options.status ?? 200, contentType: options.type === "audio" ? "audio/ogg" : options.type === "video" ? "video/mp4" : options.type === "document" ? "application/pdf" : "image/png", body: options.status ? "" : "synthetic" }); });
  await page.route("**/api/trpc/**", async route => {
    const names = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^.*\/api\/trpc\//, "").split(",");
    const message = { id: "msg-visual", type: options.type, text: "Legenda sintética", fileName: options.type === "document" ? "arquivo-teste.pdf" : "midia-teste.png", timestamp: new Date().toISOString(), ...(options.legacy ? { mediaData: "data:image/png;base64,c3ludGhldGlj" } : { mediaReference: { storage: "normalized", messageId: "msg-visual" } }) };
    const result = (name: string) => name.includes("refreshSession") ? { ok: true, session } : name.includes("getConversations") ? [conversation] : name.includes("getConversationMessages") ? [message] : name.includes("evolution.getStatus") ? { status: "connected" } : null;
    const body = names.map(name => ({ result: { data: { json: result(name) } } }));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(new URL(route.request().url()).searchParams.get("batch") === "1" ? body : body[0]) });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Conversa Visual" }).click();
  return () => bridgeCalls;
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));

test.describe("ponte de mídia", () => {
  test("referências futuras renderizam tipos e usam somente API canônica", async ({ page }) => {
    for (const type of ["image", "audio", "video", "document", "sticker"] as const) {
      const calls = await pageWithMedia(page, { type });
      if (type === "audio") await expect(page.locator("audio[controls]")).toBeVisible();
      else if (type === "video") await expect(page.locator("video[controls]")).toBeVisible();
      else if (type === "document") await expect(page.getByRole("link", { name: "arquivo-teste.pdf" })).toHaveAttribute("download", "arquivo-teste.pdf");
      else await expect(page.getByRole("img", { name: "midia-teste.png" })).toBeVisible();
      expect(calls()).toBeGreaterThan(0); expect(calls()).toBeLessThanOrEqual(2); await expect(page).not.toHaveURL(/megadesk\.online/);
      await page.reload();
    }
  });
  test("legado não chama bridge e falha usa fallback sem vazar URL", async ({ page }) => {
    const legacy = await pageWithMedia(page, { type: "image", legacy: true }); await expect(page.getByRole("img", { name: "midia-teste.png" })).toBeVisible(); expect(legacy()).toBe(0);
    const failed = await pageWithMedia(page, { type: "video", status: 404 }); await expect(page.locator("video")).toHaveCount(0); expect(failed()).toBeGreaterThan(0); expect(failed()).toBeLessThanOrEqual(2); await expect(page.getByTestId("conversation-chat-panel")).toBeVisible();
  });
  for (const viewport of [{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}]) test(`${viewport.width}px sem overflow`, async ({ page }) => { await page.setViewportSize(viewport); await pageWithMedia(page,{type:"document"}); await expect(page.getByRole("link",{name:"arquivo-teste.pdf"})).toBeVisible(); await noOverflow(page); });
});
