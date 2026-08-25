import { expect, test, type Page } from "@playwright/test";
const ids = {
  entry: "81111111-1111-4111-8111-111111111111",
  account: "82222222-2222-4222-8222-222222222222",
  category: "83333333-3333-4333-8333-333333333333",
  purchase: "84444444-4444-4444-8444-444444444444",
  sale: "85555555-5555-4555-8555-555555555555",
};
const baseSession = {
  clientId: "finance-e2e",
  company: "Financeiro E2E",
  permissions: ["erp"],
  userName: "Gestor",
  userEmail: "finance@example.invalid",
  userRole: "manager",
  plan: "test",
  modules: ["erp"],
  expiresAt: Date.now() + 3_600_000,
};
const result = (json: unknown) => ({ result: { data: { json } } });
type Role = "admin" | "manager" | "viewer" | "agent";
type State = {
  accounts: any[];
  categories: any[];
  entries: any[];
  ledger: any[];
  listFailures: number;
  listRequests: number;
  calls: string[];
};
const initialState = (): State => ({
  accounts: [
    {
      publicId: ids.account,
      name: "Banco controlado",
      type: "bank",
      currentBalanceCents: 10000,
      allowNegative: false,
      active: true,
    },
  ],
  categories: [
    {
      publicId: ids.category,
      name: "Operacional",
      direction: "both",
      active: true,
    },
  ],
  entries: [
    {
      publicId: ids.entry,
      documentNumber: "FIN-001",
      direction: "payable",
      status: "open",
      description: "Título controlado",
      amountCents: 2500,
      dueDate: "2026-09-10",
      issueDate: "2026-08-24",
      category: { publicId: ids.category, name: "Operacional" },
      financialAccount: { publicId: ids.account, name: "Banco controlado" },
      supplierPublicId: null,
      crmClientId: null,
      sourceType: "manual",
      sourcePublicId: null,
      partyName: "Parte controlada",
      notes: null,
      settledAt: null,
      cancelledAt: null,
      cancellationReason: null,
      overdue: false,
      createdAt: "2026-08-24T12:00:00.000Z",
      updatedAt: "2026-08-24T12:00:00.000Z",
    },
  ],
  ledger: [
    {
      publicId: "86666666-6666-4666-8666-666666666666",
      type: "opening_balance",
      amountCents: 10000,
      previousBalanceCents: 0,
      resultingBalanceCents: 10000,
      occurredAt: "2026-08-24T10:00:00.000Z",
    },
  ],
  listFailures: 0,
  listRequests: 0,
  calls: [],
});
function inputOf(request: { postData(): string | null; url(): string }) {
  const raw = request.postData();
  if (raw) {
    const body = JSON.parse(raw);
    return body?.json ?? body?.[0]?.json ?? body?.[0] ?? body;
  }
  const encoded = new URL(request.url()).searchParams.get("input");
  if (!encoded) return {};
  const parsed = JSON.parse(encoded);
  return parsed?.json ?? parsed?.["0"]?.json ?? parsed?.["0"] ?? parsed;
}
async function prepare(
  page: Page,
  {
    role = "manager",
    state = initialState(),
  }: { role?: Role; state?: State } = {}
) {
  const session = { ...baseSession, userRole: role };
  await page.addInitScript(v => {
    localStorage.setItem("megadesk_session_v1", JSON.stringify(v));
    localStorage.setItem("megadesk_active_page_v1", "erp-finance");
  }, session);
  await page.route("**/api/trpc/**", async route => {
    const names = decodeURIComponent(new URL(route.request().url()).pathname)
        .replace(/^.*\/api\/trpc\//, "")
        .split(","),
      input = inputOf(route.request()),
      canWrite = role === "admin" || role === "manager";
    state.calls.push(...names);
    if (
      state.listFailures > 0 &&
      names.some(n => n.includes("erp.finance.list"))
    ) {
      state.listFailures--;
      state.listRequests++;
      const failure = {
        error: {
          json: {
            message: "Falha controlada",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        },
      };
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify(
          names.length > 1 ? names.map(() => failure) : failure
        ),
      });
    }
    const response = (name: string) => {
      if (name.includes("refreshSession")) return { ok: true, session };
      if (name.includes("evolution.getStatus"))
        return { status: "disconnected" };
      if (name.includes("erp.summary"))
        return {
          metrics: {
            activeProducts: 0,
            inactiveProducts: 0,
            lowProducts: 0,
            emptyProducts: 0,
            costValueCents: 0,
            saleValueCents: 0,
          },
          critical: [],
          recent: [],
          canWrite,
        };
      if (name.includes("erp.finance.options"))
        return {
          accounts: state.accounts,
          categories: state.categories,
          suppliers: [],
          customers: [],
          canWrite,
        };
      if (name.includes("erp.finance.summary")) {
        const open = (d: string) =>
          state.entries
            .filter(e => e.direction === d && e.status === "open")
            .reduce((n, e) => n + e.amountCents, 0);
        return {
          openPayable: open("payable"),
          openReceivable: open("receivable"),
          overduePayable: 0,
          overdueReceivable: 0,
          settledPayable: state.entries
            .filter(e => e.direction === "payable" && e.status === "settled")
            .reduce((n, e) => n + e.amountCents, 0),
          settledReceivable: 0,
          realizedNetCents: 0,
          accounts: state.accounts,
        };
      }
      if (name.includes("erp.finance.list")) {
        state.listRequests++;
        const filtered = state.entries.filter(
          e =>
            !String(input?.search ?? "").includes("inexistente") &&
            (!input?.direction || e.direction === input.direction) &&
            (!input?.status || e.status === input.status)
        );
        return {
          items: filtered,
          total: filtered.length,
          page: 1,
          pageSize: 20,
          totalPages: filtered.length ? 2 : 0,
          canWrite,
        };
      }
      if (name.includes("erp.finance.accounts.ledger")) return state.ledger;
      if (name.includes("erp.finance.accounts.create")) {
        state.accounts.push({
          publicId: "87777777-7777-4777-8777-777777777777",
          name: "Caixa novo",
          type: "cash",
          currentBalanceCents: 5000,
          allowNegative: false,
          active: true,
        });
        return { publicId: state.accounts.at(-1).publicId };
      }
      if (name.includes("erp.finance.categories.create")) {
        state.categories.push({
          publicId: "88888888-8888-4888-8888-888888888888",
          name: "Nova categoria",
          direction: "both",
          active: true,
        });
        return { publicId: state.categories.at(-1).publicId };
      }
      if (name.includes("erp.finance.createManual")) {
        state.entries.push({
          ...state.entries[0],
          publicId: "89999999-9999-4999-8999-999999999999",
          documentNumber: "MAN-002",
          description: "Título manual novo",
        });
        return state.entries.at(-1);
      }
      if (name.includes("erp.finance.fromPurchase")) {
        state.entries.push({
          ...state.entries[0],
          publicId: "8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          documentNumber: "PO-2026-1",
          sourceType: "purchase_order",
          sourcePublicId: ids.purchase,
          amountCents: 7300,
          partyName: "Fornecedor autoritativo",
        });
        return { ...state.entries.at(-1), replay: false };
      }
      if (name.includes("erp.finance.fromSale")) {
        state.entries.push({
          ...state.entries[0],
          publicId: "8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          documentNumber: "SO-2026-1",
          direction: "receivable",
          sourceType: "sales_order",
          sourcePublicId: ids.sale,
          amountCents: 9100,
          partyName: "Cliente autoritativo",
        });
        return { ...state.entries.at(-1), replay: false };
      }
      if (name.includes("erp.finance.settle")) {
        const entry = state.entries[0];
        entry.status = "settled";
        entry.settledAt = "2026-08-24T13:00:00.000Z";
        state.accounts[0].currentBalanceCents -= entry.amountCents;
        state.ledger.push({
          publicId: "8ccccccc-cccc-4ccc-8ccc-cccccccccccc",
          type: "payable_settlement",
          amountCents: -entry.amountCents,
          previousBalanceCents: 10000,
          resultingBalanceCents: state.accounts[0].currentBalanceCents,
          occurredAt: entry.settledAt,
        });
        return { ...entry, replay: false };
      }
      if (name.includes("erp.finance.cancel")) {
        state.entries[0].status = "cancelled";
        state.entries[0].cancelledAt = "2026-08-24T13:00:00.000Z";
        return state.entries[0];
      }
      return {};
    };
    const body = names.map(n => result(response(n)));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(names.length > 1 ? body : body[0]),
    });
  });
  await page.goto("/erp/financeiro");
  return state;
}
test("1 admin cria conta, categoria e título manual", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await prepare(page, { role: "admin" });
  await expect(page).toHaveURL(/\/erp\/financeiro$/);
  await page.getByRole("button", { name: "Nova conta" }).click();
  const account = page.getByRole("dialog", { name: "Nova conta" });
  await account.getByLabel("Nome").fill("Caixa novo");
  await account.getByLabel("Saldo inicial").fill("50,00");
  await account.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => state.accounts.length).toBe(2);
  await page.getByRole("button", { name: "Nova categoria" }).click();
  const category = page.getByRole("dialog", { name: "Nova categoria" });
  await category.getByLabel("Nome").fill("Nova categoria");
  await category.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => state.categories.length).toBe(2);
  await page.getByRole("button", { name: "Novo título" }).click();
  const entry = page.getByRole("dialog", { name: "Novo título manual" });
  await entry.getByLabel("Número").fill("MAN-002");
  await entry.getByLabel("Descrição").fill("Título manual novo");
  await entry.getByLabel("Valor").fill("25,00");
  await entry.getByLabel("Categoria").selectOption(ids.category);
  await entry.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => state.entries.length).toBe(2);
});
test("2 manager gera payable de Compra e receivable de Venda com valores autoritativos", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const state = await prepare(page);
  for (const [index, [type, id]] of [
    ["purchase_order", ids.purchase],
    ["sales_order", ids.sale],
  ].entries()) {
    if (index > 0) {
      await page.reload();
      await expect(page.getByTestId("erp-finance-page")).toBeVisible();
    }
    await page.getByRole("button", { name: "Gerar de pedido" }).click();
    const dialog = page.getByRole("dialog", { name: "Gerar título de pedido" });
    await dialog.getByLabel("Origem").selectOption(type);
    await expect(dialog.getByLabel("Origem")).toHaveValue(type);
    await dialog.getByLabel("ID público do pedido").fill(id);
    await dialog.getByLabel("Categoria").selectOption(ids.category);
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => state.entries.length).toBe(index + 2);
  }
  expect(state.calls).toContain("erp.finance.fromPurchase");
  expect(state.calls).toContain("erp.finance.fromSale");
  expect(
    state.entries.find(e => e.sourceType === "purchase_order")
  ).toMatchObject({
    amountCents: 7300,
    partyName: "Fornecedor autoritativo",
  });
  expect(state.entries.find(e => e.sourceType === "sales_order")).toMatchObject(
    {
      amountCents: 9100,
      partyName: "Cliente autoritativo",
    }
  );
});
test("3 liquidação atualiza título, conta e ledger", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const state = await prepare(page);
  await page.getByRole("cell", { name: "FIN-001", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "FIN-001" });
  await dialog.getByLabel("Conta para liquidação").selectOption(ids.account);
  page.once("dialog", d => d.accept());
  await dialog.getByRole("button", { name: "Liquidar integralmente" }).click();
  await expect.poll(() => state.entries[0].status).toBe("settled");
  expect(state.accounts[0].currentBalanceCents).toBe(7500);
  expect(state.ledger).toHaveLength(2);
});
test("4 cancelamento preserva saldo e ledger", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await prepare(page),
    balance = state.accounts[0].currentBalanceCents,
    ledger = state.ledger.length;
  await page.getByRole("cell", { name: "FIN-001", exact: true }).click();
  let dialogs = 0;
  page.on("dialog", async d => {
    dialogs++;
    await d.accept(dialogs === 1 ? "Motivo controlado" : undefined);
  });
  await page
    .getByRole("dialog", { name: "FIN-001" })
    .getByRole("button", { name: "Cancelar título" })
    .click();
  await expect.poll(() => state.entries[0].status).toBe("cancelled");
  expect(state.accounts[0].currentBalanceCents).toBe(balance);
  expect(state.ledger).toHaveLength(ledger);
});
test("5 viewer é read-only e agent não visualiza Financeiro", async ({
  page,
}) => {
  await prepare(page, { role: "viewer" });
  await expect(page.getByText("Acesso somente leitura.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo título" })).toHaveCount(
    0
  );
  await page.evaluate(() => localStorage.clear());
  await prepare(page, { role: "agent" });
  await expect(page.getByRole("button", { name: "Financeiro" })).toHaveCount(0);
  await expect(
    page.getByRole("alert").getByText("Acesso indisponível")
  ).toBeVisible();
});
test("6 erro/retry, vazio, filtros, paginação, foco e responsividade", async ({
  page,
}) => {
  const state = initialState();
  state.listFailures = 4;
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, { state });
  await expect.poll(() => state.listRequests, { timeout: 10_000 }).toBe(4);
  await expect(
    page.getByText("Não foi possível carregar o Financeiro.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByTestId("erp-finance-page")).toBeVisible();
  await page.getByLabel("Buscar título").fill("inexistente");
  await expect(page.getByText("Nenhum título encontrado.")).toBeVisible();
  await page.getByLabel("Buscar título").fill("");
  await page.getByLabel("Direção").selectOption("payable");
  await expect(
    page.getByRole("navigation", { name: "Paginação" })
  ).toBeVisible();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Nova conta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova conta" });
  await expect(dialog.getByLabel("Nome")).toBeFocused();
  expect(
    await dialog.evaluate(
      el =>
        el.getBoundingClientRect().right <= innerWidth &&
        el.getBoundingClientRect().bottom <= innerHeight
    )
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
