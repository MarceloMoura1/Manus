import { expect, test, type Page } from "@playwright/test";
type Role = "admin" | "manager" | "viewer" | "agent";
const ids = {
    doc: "91111111-1111-4111-8111-111111111111",
    product: "92222222-2222-4222-8222-222222222222",
    source: "93333333-3333-4333-8333-333333333333",
  },
  session = {
    clientId: "fiscal-e2e",
    company: "Fiscal E2E",
    permissions: ["erp"],
    userName: "Gestor",
    userEmail: "fiscal@example.invalid",
    userRole: "manager",
    plan: "test",
    modules: ["erp"],
    expiresAt: Date.now() + 3600000,
  };
const result = (json: unknown) => ({ result: { data: { json } } });
type State = {
  settings: any;
  products: any[];
  documents: any[];
  failList: number;
  calls: string[];
};
const initial = (): State => ({
  settings: null,
  products: [
    {
      productPublicId: ids.product,
      name: "Produto controlado",
      sku: "FIS-1",
      barcode: null,
      publicId: null,
      ncm: null,
      cest: null,
      defaultOutboundCfop: null,
      defaultInboundCfop: null,
      goodsOrigin: null,
      fiscalUnit: "unit",
      gtin: null,
      serviceCode: null,
      operationNature: null,
      internalNotes: null,
      completeness: "incomplete",
    },
  ],
  documents: [
    {
      publicId: ids.doc,
      internalNumber: "FIS-2026-000001",
      type: "manual",
      status: "draft",
      internalIssueDate: "2026-08-24",
      sourcePublicId: null,
      partyName: "Parte controlada",
      partyDocument: null,
      totalCents: 500,
      internalNotes: null,
      cancellationReason: null,
      items: [
        {
          publicId: "94444444-4444-4444-8444-444444444444",
          name: "Item",
          quantityMillis: 1000,
          lineTotalCents: 500,
        },
      ],
      history: [{ toStatus: "draft", createdAt: "2026-08-24" }],
    },
  ],
  failList: 0,
  calls: [],
});
function inputOf(request: { postData(): string | null; url(): string }) {
  const raw = request.postData();
  if (raw) {
    const b = JSON.parse(raw);
    return b?.json ?? b?.[0]?.json ?? b?.[0] ?? b;
  }
  const encoded = new URL(request.url()).searchParams.get("input");
  if (!encoded) return {};
  const p = JSON.parse(encoded);
  return p?.json ?? p?.["0"]?.json ?? p?.["0"] ?? p;
}
async function prepare(
  page: Page,
  { role = "manager" as Role, state = initial() } = {}
) {
  await page.addInitScript(
    v => {
      localStorage.setItem("megadesk_session_v1", JSON.stringify(v));
      localStorage.setItem("megadesk_active_page_v1", "erp-fiscal");
    },
    { ...session, userRole: role }
  );
  await page.route("**/api/trpc/**", async route => {
    const names = decodeURIComponent(new URL(route.request().url()).pathname)
        .replace(/^.*\/api\/trpc\//, "")
        .split(","),
      input = inputOf(route.request()),
      canWrite = role === "admin" || role === "manager";
    state.calls.push(...names);
    const one = (name: string) => {
      if (name.includes("refreshSession"))
        return result({ ok: true, session: { ...session, userRole: role } });
      if (name.includes("erp.fiscal.summary"))
        return result({
          documents: state.documents.length,
          drafts: state.documents.filter(x => x.status === "draft").length,
          ready: state.documents.filter(
            x => x.status === "ready_for_integration"
          ).length,
          cancelled: state.documents.filter(x => x.status === "cancelled")
            .length,
          products: state.products.length,
          incompleteProducts: state.products.filter(
            x => x.completeness === "incomplete"
          ).length,
          settings: state.settings,
          electronicIssuanceConfigured: false,
          canWrite,
        });
      if (name.includes("erp.fiscal.settings.get"))
        return result(state.settings ? { ...state.settings, canWrite } : null);
      if (name.includes("erp.fiscal.settings.save")) {
        state.settings = {
          publicId: crypto.randomUUID(),
          ...input,
          status:
            input.mainCnae && input.ibgeCityCode
              ? "ready_for_integration"
              : "incomplete",
        };
        return result({ ...state.settings, operation: "created" });
      }
      if (name.includes("erp.fiscal.products.list"))
        return result({
          items: state.products,
          total: state.products.length,
          totalPages: 1,
          page: 1,
          pageSize: 20,
          canWrite,
        });
      if (name.includes("erp.fiscal.products.save")) {
        state.products[0] = {
          ...state.products[0],
          ...input,
          completeness:
            input.ncm && input.defaultOutboundCfop && input.defaultInboundCfop
              ? "complete"
              : "incomplete",
        };
        return result(state.products[0]);
      }
      if (name.includes("erp.fiscal.documents.detail"))
        return result({
          ...state.documents.find(x => x.publicId === input.publicId),
          canWrite,
        });
      if (name.includes("erp.fiscal.documents.createSource")) {
        const d = {
          ...state.documents[0],
          publicId: crypto.randomUUID(),
          internalNumber: `FIS-2026-${String(state.documents.length + 1).padStart(6, "0")}`,
          type: input.type,
          sourcePublicId: input.sourcePublicId,
          partyName:
            input.type === "sale" ? "Cliente da venda" : "Fornecedor da compra",
          totalCents: input.type === "sale" ? 9100 : 7300,
        };
        state.documents.push(d);
        return result({ ...d, replay: false });
      }
      if (name.includes("erp.fiscal.documents.createManual")) {
        const d = {
          ...state.documents[0],
          publicId: crypto.randomUUID(),
          internalNumber: `FIS-2026-${String(state.documents.length + 1).padStart(6, "0")}`,
          partyName: input.partyName,
          totalCents: input.items[0].unitAmountCents,
        };
        state.documents.push(d);
        return result({ ...d, replay: false });
      }
      if (name.includes("erp.fiscal.documents.ready")) {
        const d = state.documents.find(x => x.publicId === input.publicId);
        d.status = "ready_for_integration";
        return result({ ...d, replay: false });
      }
      if (name.includes("erp.fiscal.documents.cancel")) {
        const d = state.documents.find(x => x.publicId === input.publicId);
        d.status = "cancelled";
        d.cancellationReason = input.reason;
        return result(d);
      }
      if (name.includes("erp.fiscal.documents.list")) {
        if (state.failList-- > 0)
          return {
            error: {
              json: {
                message: "Falha controlada",
                code: -32603,
                data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
              },
            },
          };
        let docs = state.documents.filter(
          x =>
            (!input.type || x.type === input.type) &&
            (!input.status || x.status === input.status) &&
            (!input.source ||
              (input.source === "manual"
                ? x.sourcePublicId === null
                : x.sourcePublicId !== null)) &&
            (!input.from || x.internalIssueDate >= input.from) &&
            (!input.to || x.internalIssueDate <= input.to) &&
            (!input.search ||
              x.internalNumber.includes(input.search) ||
              x.partyName.includes(input.search))
        );
        const total = docs.length,
          page = input.page ?? 1;
        docs = docs.slice((page - 1) * 20, page * 20);
        return result({
          items: docs,
          total,
          totalPages: Math.max(1, Math.ceil(total / 20)),
          page,
          pageSize: 20,
          canWrite,
        });
      }
      return result(null);
    };
    const payload = names.map(one),
      failed = payload.some((x: any) => x.error);
    await route.fulfill({
      status: failed ? 500 : 200,
      contentType: "application/json",
      body: JSON.stringify(names.length > 1 ? payload : payload[0]),
    });
  });
  await page.goto("/erp/fiscal");
  return state;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => ({
      body: document.documentElement.scrollWidth <= innerWidth,
      main:
        (document.querySelector("main")?.getBoundingClientRect().right ?? 0) <=
        innerWidth + 1,
    }))
  ).toEqual({ body: true, main: true });
}
test("01 configuração fiscal comunica limites e salva cadastro", async ({
  page,
}) => {
  await prepare(page);
  await expect(
    page.getByText("Emissão fiscal eletrônica ainda não configurada.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Configuração fiscal" }).click();
  await page.getByRole("button", { name: "Configurar" }).click();
  await page.getByLabel("CNAE principal").fill("1234567");
  await page.getByLabel("Município IBGE").fill("3550308");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByText(/Status: ready_for_integration/)).toBeVisible();
});
test("02 perfil fiscal de produto calcula completude sem tributos", async ({
  page,
}) => {
  const state = await prepare(page);
  await page.getByRole("button", { name: "Produtos incompletos" }).click();
  await page.getByRole("button", { name: "Editar perfil fiscal" }).click();
  await page.getByLabel("NCM").fill("12345678");
  await page.getByLabel("CFOP saída").fill("5102");
  await page.getByLabel("CFOP entrada").fill("1102");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect.poll(() => state.products[0].completeness).toBe("complete");
});
test("03 cria documentos internos por Compra e Venda", async ({ page }) => {
  const state = await prepare(page);
  await page.getByRole("button", { name: "Documentos internos" }).click();
  for (const [index, type] of ["sale", "purchase"].entries()) {
    await page.getByRole("button", { name: "Da origem" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Documento interno por origem",
    });
    await dialog.locator("select").selectOption(type);
    await dialog
      .getByRole("textbox", { name: "ID público da origem" })
      .fill(ids.source);
    await dialog
      .getByRole("button", { name: "Criar documento interno" })
      .click();
    await expect.poll(() => state.documents.length).toBe(index + 2);
  }
  expect(state.documents.map(x => x.type)).toEqual(
    expect.arrayContaining(["sale", "purchase"])
  );
});
test("04 prepara e cancela documentos internos sem sugerir autorização", async ({
  page,
}) => {
  const state = await prepare(page);
  await page.getByRole("button", { name: "Documentos internos" }).click();
  await page.getByRole("cell", { name: "FIS-2026-000001" }).click();
  await page.getByRole("button", { name: "Preparar para integração" }).click();
  await expect
    .poll(() => state.documents[0].status)
    .toBe("ready_for_integration");
  state.documents[0].status = "draft";
  await page.reload();
  await page.getByRole("button", { name: "Documentos internos" }).click();
  await page.getByRole("cell", { name: "FIS-2026-000001" }).click();
  page.once("dialog", d => d.accept("Motivo interno"));
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect.poll(() => state.documents[0].status).toBe("cancelled");
});
test("05 viewer é read-only", async ({ page }) => {
  await prepare(page, { role: "viewer", state: initial() });
  await page.getByRole("button", { name: "Documentos internos" }).click();
  await expect(page.getByRole("button", { name: "Da origem" })).toHaveCount(0);
  await page.getByRole("button", { name: "Configuração fiscal" }).click();
  await expect(
    page.getByRole("button", { name: /Configurar|Editar configuração/ })
  ).toHaveCount(0);
});
test("06 agent não acessa o módulo", async ({ page }) => {
  await prepare(page, { role: "agent", state: initial() });
  await expect(page.getByTestId("erp-fiscal-page")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Acesso indisponível");
});
test("07 erro de listagem oferece retry funcional", async ({ page }) => {
  const state = initial();
  state.failList = 1;
  await prepare(page, { role: "manager", state });
  await page.getByRole("button", { name: "Documentos internos" }).click();
  await expect(page.getByText("Erro ao carregar documentos.")).toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByRole("cell", { name: "FIS-2026-000001" })
  ).toBeVisible();
});
test("08 filtros paginação e quatro viewports não geram overflow", async ({
  page,
}) => {
  const state = initial();
  for (let i = 2; i <= 22; i++)
    state.documents.push({
      ...state.documents[0],
      publicId: crypto.randomUUID(),
      internalNumber: `FIS-2026-${String(i).padStart(6, "0")}`,
      type: i % 2 ? "sale" : "purchase",
      sourcePublicId: ids.source,
    });
  await prepare(page, { role: "manager", state });
  await page.getByRole("button", { name: "Documentos internos" }).click();
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await page.getByRole("button", { name: "Próxima" }).click();
  await expect(
    page.getByRole("cell", { name: "FIS-2026-000021" })
  ).toBeVisible();
  await page.getByLabel("Tipo").selectOption("sale");
  await expect(
    page.getByRole("cell", { name: "FIS-2026-000003" })
  ).toBeVisible();
  await page.getByLabel("Origem").selectOption("manual");
  await expect(
    page.getByText("Nenhum documento corresponde aos filtros.")
  ).toBeVisible();
  await page.getByLabel("Origem").selectOption("");
  await page.getByLabel("Data inicial").fill("2026-08-24");
  await page.getByLabel("Data final").fill("2026-08-24");
  await page.getByLabel("Ordenar por").selectOption("number");
  await page.getByLabel("Direção").selectOption("asc");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await noOverflow(page);
  }
});
