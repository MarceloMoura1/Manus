import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";

const session = {
  clientId: "erp-e2e",
  company: "ERP E2E",
  permissions: ["erp"],
  userName: "Gestor ERP",
  userEmail: "gestor@example.invalid",
  userRole: "manager",
  plan: "test",
  modules: ["erp"],
  expiresAt: Date.now() + 3_600_000,
};
const product = {
  publicId: "11111111-1111-4111-8111-111111111111",
  name: "Produto controlado",
  sku: "PROD-001",
  barcode: null,
  description: null,
  category: "Teste",
  unit: "unit",
  costPriceCents: 1000,
  salePriceCents: 1500,
  minimumStock: "2.000",
  active: true,
  quantity: "5.000",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  hasImage: false,
};
const movement = {
  publicId: "22222222-2222-4222-8222-222222222222",
  productPublicId: product.publicId,
  productName: product.name,
  sku: product.sku,
  type: "manual_in",
  direction: "in",
  quantity: "5.000",
  previousBalance: "0.000",
  resultingBalance: "5.000",
  reason: "Entrada controlada",
  referenceType: "manual",
  referenceId: null,
  createdBy: "erp-user",
  createdAt: "2026-01-01T00:00:00.000Z",
  reversed: false,
};
const supplier = {
  publicId: "33333333-3333-4333-8333-333333333333",
  legalName: "Fornecedor controlado",
  tradeName: null,
  personType: "legal",
  taxId: "12345678000190",
  stateRegistration: null,
  email: "supplier@example.invalid",
  phone: null,
  contactName: null,
  postalCode: null,
  street: null,
  addressNumber: null,
  addressComplement: null,
  district: null,
  city: "Recife",
  state: "PE",
  notes: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function result(json: unknown) {
  return { result: { data: { json } } };
}
function erpModules(page: Page) {
  return page.getByRole("navigation", { name: "Módulos do ERP", exact: true });
}
async function prepareClosedMobileDrawer(page: Page) {
  const drawer = page.getByLabel("Menu principal",{exact:true});
  const overlay = page.getByRole("button", { name: "Fechar menu lateral" });
  const trigger = page.locator("header").getByTitle("Abrir menu");
  await expect(
    drawer,
    "setup mobile deve deixar o drawer aberto"
  ).toBeVisible();
  await expect(
    overlay,
    "setup mobile deve deixar o overlay aberto"
  ).toBeVisible();
  const closeButton = drawer.getByTitle("Fechar menu");
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(drawer).toBeHidden();
  await expect(overlay).toHaveCount(0);
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  return { drawer, overlay, trigger };
}
async function clickExposedDrawerOverlay(overlay: Locator, drawer: Locator) {
  const overlayBox = await overlay.boundingBox();
  const drawerBox = await drawer.boundingBox();
  expect(overlayBox).not.toBeNull();
  expect(drawerBox).not.toBeNull();
  const exposedLeft = Math.max(overlayBox!.x, drawerBox!.x + drawerBox!.width);
  const exposedRight = overlayBox!.x + overlayBox!.width;
  expect(exposedRight).toBeGreaterThan(exposedLeft);
  const absoluteX = exposedLeft + (exposedRight - exposedLeft) / 2;
  const absoluteY = overlayBox!.y + overlayBox!.height / 2;
  expect(absoluteX).toBeGreaterThanOrEqual(overlayBox!.x);
  expect(absoluteX).toBeLessThan(overlayBox!.x + overlayBox!.width);
  expect(absoluteY).toBeGreaterThanOrEqual(overlayBox!.y);
  expect(absoluteY).toBeLessThan(overlayBox!.y + overlayBox!.height);
  expect(absoluteX).toBeGreaterThan(drawerBox!.x + drawerBox!.width);
  await overlay.click({
    position: { x: absoluteX - overlayBox!.x, y: absoluteY - overlayBox!.y },
  });
}
async function prepare(
  page: Page,
  options: { empty?: boolean; readOnly?: boolean; hasImage?: boolean } = {}
) {
  page.on("pageerror", error =>
    console.log(`ERP_PAGE_ERROR: ${error.message}`)
  );
  page.on("console", message => {
    if (message.type() === "error")
      console.log(`ERP_CONSOLE_ERROR: ${message.text()}`);
  });
  await page.addInitScript(value => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(value));
    localStorage.setItem("megadesk_active_page_v1", "erp-summary");
  }, session);
  await page.route("**/api/trpc/**", async route => {
    const url = route.request().url();
    const responseFor = (procedure: string): unknown => {
      if (procedure.includes("megadesk.refreshSession"))
        return { ok: true, session };
      if (procedure.includes("evolution.getStatus"))
        return { status: "disconnected" };
      if (procedure.includes("erp.summary"))
        return {
          metrics: {
            activeProducts: options.empty ? 0 : 1,
            inactiveProducts: 0,
            lowProducts: 0,
            emptyProducts: 0,
            totalQuantity: options.empty ? "0.000" : "5.000",
            costValueCents: options.empty ? 0 : 5000,
            saleValueCents: options.empty ? 0 : 7500,
          },
          critical: [],
          recent: options.empty ? [] : [movement],
          canWrite: !options.readOnly,
        };
      if (procedure.includes("erp.products.list"))
        return {
          items: options.empty ? [] : [{...product,hasImage:options.hasImage===true}],
          total: options.empty ? 0 : 1,
          page: 1,
          pageSize: 20,
          totalPages: options.empty ? 0 : 1,
          canWrite: !options.readOnly,
        };
      if (procedure.includes("erp.stock.list"))
        return {
          items: options.empty ? [] : [movement],
          total: options.empty ? 0 : 1,
          page: 1,
          pageSize: 20,
          totalPages: options.empty ? 0 : 1,
          canWrite: !options.readOnly,
        };
      if (procedure.includes("erp.suppliers.list"))
        return {
          items: options.empty ? [] : [supplier],
          total: options.empty ? 0 : 1,
          activeCount: options.empty ? 0 : 1,
          inactiveCount: 0,
          page: 1,
          pageSize: 20,
          totalPages: options.empty ? 0 : 1,
          canWrite: !options.readOnly,
        };
      if (procedure.includes("erp.products.create")) return product;
      if (procedure.includes("erp.products.update"))
        return { ...product, name: "Produto editado" };
      if (procedure.includes("erp.products.setActive")) return { ok: true };
      if (procedure.includes("erp.stock.move")) return movement;
      return null;
    };
    const procedures = decodeURIComponent(new URL(url).pathname)
      .replace(/^.*\/api\/trpc\//, "")
      .split(",");
    const payloads = procedures.map(procedure =>
      result(responseFor(procedure))
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: url.includes("batch=1")
        ? JSON.stringify(payloads)
        : JSON.stringify(payloads[0]),
    });
  });
  await page.goto("/erp");
  if (
    await page
      .getByRole("heading", { name: "Erro ao carregar esta seção" })
      .isVisible()
  )
    console.log(
      `ERP_ERROR_BOUNDARY: ${await page.locator("main").innerText()}`
    );
  await expect(page.getByTestId("erp-summary-page")).toBeVisible();
  const erpButton = page.getByRole("button", { name: "ERP", exact: true });
  if (!(await erpButton.isVisible())) {
    const trigger = page.locator("header").getByTitle("Abrir menu");
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toBeVisible();
    await trigger.click();
  }
  await expect(page.getByTestId("erp-workspace")).toBeVisible();
}

test.describe("ERP products and stock", () => {
  test("navigates the ERP group and keeps future modules unavailable", async ({
    page,
  }) => {
    await prepare(page);
    await expect(
      erpModules(page).getByRole("button", { name: "Fornecedores", exact: true })
    ).toBeEnabled();
    await expect(
      erpModules(page).getByRole("button", { name: "Compras", exact: true })
    ).toBeEnabled();
    await erpModules(page).getByRole("button", { name: "Produtos", exact: true }).click();
    await expect(page).toHaveURL(/\/erp\/produtos$/);
    await expect(page.getByTestId("erp-products-page")).toBeVisible();
    await erpModules(page).getByRole("button", { name: "Estoque", exact: true }).click();
    await expect(page).toHaveURL(/\/erp\/estoque$/);
    await expect(page.getByTestId("erp-stock-page")).toBeVisible();
  });
  test("uses the controlled product create flow without a real database", async ({
    page,
  }) => {
    await prepare(page, { empty: true });
    await erpModules(page).getByRole("button", { name: "Produtos", exact: true }).click();
    await page.getByRole("button", { name: "Novo produto" }).click();
    await page.getByLabel("Nome").fill("Produto novo");
    await page.getByLabel("SKU").fill("novo-1");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(
      page.getByText("Produto cadastrado com sucesso.")
    ).toBeVisible();
  });
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}])test(`renders private product thumbnails safely at ${viewport.width}px`,async({browser})=>{
    const context=await browser.newContext({viewport});const page=await context.newPage();let imageRequests=0;
    await page.route("**/api/products/*/image?variant=thumbnail*",async route=>{imageRequests++;await route.fulfill({status:200,contentType:"image/webp",body:Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA","base64")});});
    await prepare(page,{hasImage:true});if(viewport.width<1024)await prepareClosedMobileDrawer(page);await erpModules(page).getByRole("button",{name:"Produtos",exact:true}).click();
    const image=page.getByRole("img",{name:`Foto de ${product.name}`});await expect(image).toBeVisible();await expect(image).toHaveAttribute("loading","lazy");await expect.poll(()=>imageRequests).toBeGreaterThan(0);
    expect(await image.evaluate(element=>getComputedStyle(element).objectFit)).toBe("cover");expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(viewport.width);
    await context.close();
  });
  test("uses a stable placeholder and performs no image fetch without a reference",async({page})=>{
    let imageRequests=0;await page.route("**/api/products/*/image**",route=>{imageRequests++;return route.abort();});await prepare(page);await erpModules(page).getByRole("button",{name:"Produtos",exact:true}).click();
    await expect(page.getByTestId("product-image-placeholder").first()).toBeVisible();expect(imageRequests).toBe(0);
  });
  test("uploads, reloads, replaces and removes a private product image",async({page})=>{
    const state:{hasImage?:boolean}={hasImage:false};let puts=0;let gets=0;let deletes=0;
    await page.route("**/api/products/*/image**",async route=>{
      const method=route.request().method();
      if(method==="PUT"){puts++;state.hasImage=true;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({mediaId:"synthetic-media"})});return;}
      if(method==="DELETE"){deletes++;state.hasImage=false;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true})});return;}
      gets++;await route.fulfill({status:200,contentType:"image/webp",body:Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA","base64")});
    });
    await prepare(page,state);await erpModules(page).getByRole("button",{name:"Produtos",exact:true}).click();
    await expect(page.getByTestId("product-image-placeholder").first()).toBeVisible();
    await page.getByRole("button",{name:"Editar"}).click();let dialog=page.getByRole("dialog");let input=dialog.locator('input[type="file"]');
    await input.setInputFiles({name:"first.png",mimeType:"image/png",buffer:Buffer.from("first")});await dialog.getByRole("button",{name:"Salvar",exact:true}).click();
    await expect.poll(()=>puts).toBe(1);let image=page.getByRole("img",{name:`Foto de ${product.name}`});await expect(image).toBeVisible();await expect.poll(()=>gets).toBeGreaterThan(0);
    await page.reload();await expect(page.getByTestId("erp-products-page")).toBeVisible();image=page.getByRole("img",{name:`Foto de ${product.name}`});await expect(image).toBeVisible();
    const beforeReplace=await image.getAttribute("src");await page.getByRole("button",{name:"Editar"}).click();dialog=page.getByRole("dialog");input=dialog.locator('input[type="file"]');
    await input.setInputFiles({name:"second.png",mimeType:"image/png",buffer:Buffer.from("second")});await dialog.getByRole("button",{name:"Salvar",exact:true}).click();
    await expect.poll(()=>puts).toBe(2);image=page.getByRole("img",{name:`Foto de ${product.name}`});await expect(image).toBeVisible();await expect.poll(()=>image.getAttribute("src")).not.toBe(beforeReplace);
    await page.getByRole("button",{name:"Editar"}).click();dialog=page.getByRole("dialog");page.once("dialog",confirmation=>void confirmation.accept());await dialog.getByRole("button",{name:"Remover"}).click();await dialog.getByRole("button",{name:"Salvar",exact:true}).click();
    await expect.poll(()=>deletes).toBe(1);await expect(page.getByTestId("product-image-placeholder").first()).toBeVisible();await expect(page.getByRole("img",{name:`Foto de ${product.name}`})).toHaveCount(0);
  });
  test("revokes ObjectURLs on replacement and dialog teardown while preserving fields on upload failure",async({page})=>{
    await page.addInitScript(()=>{const created:string[]=[];const revoked:string[]=[];let index=0;URL.createObjectURL=()=>{const value=`blob:synthetic-${++index}`;created.push(value);return value};URL.revokeObjectURL=value=>revoked.push(String(value));Object.assign(window,{__mediaUrls:{created,revoked}});});
    await page.route("**/api/products/*/image",route=>route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error:"Imagem inválida."})}));
    await prepare(page,{hasImage:true});await erpModules(page).getByRole("button",{name:"Produtos",exact:true}).click();await page.getByRole("button",{name:"Editar"}).click();const dialog=page.getByRole("dialog");
    const input=dialog.locator('input[type="file"]');await input.setInputFiles({name:"one.png",mimeType:"image/png",buffer:Buffer.from("one")});await input.setInputFiles({name:"two.png",mimeType:"image/png",buffer:Buffer.from("two")});
    expect(await page.evaluate(()=>(window as any).__mediaUrls.revoked.length)).toBeGreaterThanOrEqual(1);await dialog.getByRole("button",{name:"Salvar",exact:true}).click();await expect(page.getByText("Imagem inválida.")).toBeVisible();await expect(dialog.getByLabel("Nome")).toHaveValue(product.name);
    await page.keyboard.press("Escape");await expect(dialog).toBeHidden();expect(await page.evaluate(()=>(window as any).__mediaUrls.revoked.length)).toBeGreaterThanOrEqual(2);
  });
  test("registers a controlled stock movement with explicit confirmation", async ({
    page,
  }) => {
    await prepare(page);
    await erpModules(page).getByRole("button", { name: "Estoque", exact: true }).click();
    await page.getByRole("button", { name: "Nova movimentação" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Produto")
      .selectOption(product.publicId);
    await page.getByLabel("Quantidade").fill("2");
    await page.getByLabel("Motivo").fill("Entrada controlada");
    await page.getByRole("button", { name: "Confirmar movimentação" }).click();
    await expect(
      page.getByText("Movimentação registrada com sucesso.")
    ).toBeVisible();
  });
  test("is responsive at 390x844 and removes read-only actions from the DOM", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page, { readOnly: true });
    await prepareClosedMobileDrawer(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await erpModules(page).getByRole("button", { name: "Produtos", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Novo produto" })
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Editar" })).toHaveCount(0);
    await erpModules(page).getByRole("button", { name: "Estoque", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Nova movimentação" })
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
  ])
    test(`drawer restores focus through button, Escape, overlay and navigation at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await prepare(page);
      const { drawer, overlay, trigger } =
        await prepareClosedMobileDrawer(page);
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(drawer).toBeVisible();
      await expect(overlay).toBeVisible();
      const closeButton = drawer.getByTitle("Fechar menu");
      await expect(closeButton).toBeFocused();
      await closeButton.click();
      await expect(drawer).toBeHidden();
      await expect(overlay).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(overlay).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(drawer).toBeVisible();
      await expect(overlay).toBeVisible();
      await clickExposedDrawerOverlay(overlay, drawer);
      await expect(drawer).toBeHidden();
      await expect(overlay).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(drawer).toBeVisible();
      const erp = drawer.getByRole("button", { name: "ERP", exact: true });
      await expect(erp).toBeVisible();
      await erp.click();
      await expect(drawer).toBeHidden();
      await expect(overlay).toHaveCount(0);
      await expect(page.locator("main")).toBeFocused();
      await erpModules(page).getByRole("button", { name: "Produtos", exact: true }).click();
      await expect(page).toHaveURL(/\/erp\/produtos$/);
      await expect(page.getByTestId("erp-products-page")).toBeVisible();
    });
});
