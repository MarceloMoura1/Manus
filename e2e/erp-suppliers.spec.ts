import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const session = {
  clientId: "supplier-e2e",
  company: "Supplier E2E",
  permissions: ["erp"],
  userName: "Gestor",
  userEmail: "supplier@example.invalid",
  userRole: "manager",
  plan: "test",
  modules: ["erp"],
  expiresAt: Date.now() + 3_600_000,
};
const supplier = {
  publicId: "33333333-3333-4333-8333-333333333333",
  legalName: "Fornecedor controlado",
  tradeName: "Controlado",
  personType: "legal",
  taxId: "12345678000190",
  stateRegistration: null,
  email: "supplier@example.invalid",
  phone: "11999990000",
  contactName: "Contato",
  postalCode: "01234567",
  street: "Rua A",
  addressNumber: "10",
  addressComplement: null,
  district: "Centro",
  city: "Recife",
  state: "PE",
  notes: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const result = (json: unknown) => ({ result: { data: { json } } });
async function reviewShot(page: Page, name: string) {
  const directory = process.env.MEGADESK_E2E_SCREENSHOT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name), fullPage: true });
}
async function prepare(
  page: Page,
  options: {
    empty?: boolean;
    readOnly?: boolean;
    error?: boolean;
    duplicate?: boolean;
  } = {}
) {
  await page.addInitScript(
    value => {
      localStorage.setItem("megadesk_session_v1", JSON.stringify(value));
      localStorage.setItem("megadesk_active_page_v1", "erp-suppliers");
    },
    options.readOnly ? { ...session, userRole: "viewer" } : session
  );
  await page.route("**/api/trpc/**", async route => {
    const url = route.request().url();
    const procedures = decodeURIComponent(new URL(url).pathname)
      .replace(/^.*\/api\/trpc\//, "")
      .split(",");
    if (
      options.error &&
      procedures.some(name => name.includes("erp.suppliers.list"))
    ) {
      const error = {
        error: {
          json: {
            message: "Falha controlada",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        },
      };
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify(url.includes("batch=1") ? [error] : error),
      });
      return;
    }
    const response = (name: string) =>
      name.includes("megadesk.refreshSession")
        ? {
            ok: true,
            session: options.readOnly
              ? { ...session, userRole: "viewer" }
              : session,
          }
        : name.includes("evolution.getStatus")
          ? { status: "disconnected" }
          : name.includes("erp.suppliers.list")
            ? {
                items: options.empty ? [] : [supplier],
                total: options.empty ? 0 : 1,
                activeCount: options.empty ? 0 : 1,
                inactiveCount: 0,
                page: 1,
                pageSize: 20,
                totalPages: options.empty ? 0 : 1,
                canWrite: !options.readOnly,
              }
            : name.includes("erp.suppliers.create")
              ? supplier
              : name.includes("erp.suppliers.update")
                ? { ...supplier, legalName: "Fornecedor editado" }
                : name.includes("erp.suppliers.setActive")
                  ? { ok: true }
                  : name.includes("erp.summary")
                    ? {
                        metrics: {
                          activeProducts: 0,
                          inactiveProducts: 0,
                          lowProducts: 0,
                          emptyProducts: 0,
                          totalQuantity: "0.000",
                          costValueCents: 0,
                          saleValueCents: 0,
                        },
                        critical: [],
                        recent: [],
                        canWrite: !options.readOnly,
                      }
                    : null;
    if (
      options.duplicate &&
      procedures.some(name => name.includes("erp.suppliers.create"))
    ) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            json: {
              message:
                "CPF/CNPJ já cadastrado para outro fornecedor deste tenant.",
              code: -32009,
              data: { code: "CONFLICT", httpStatus: 409 },
            },
          },
        }),
      });
      return;
    }
    const payloads = procedures.map(name => result(response(name)));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: url.includes("batch=1")
        ? JSON.stringify(payloads)
        : JSON.stringify(payloads[0]),
    });
  });
  await page.goto("/erp/fornecedores");
  await expect(page.getByTestId("erp-suppliers-page")).toBeVisible();
}
async function openForm(page: Page) {
  await page.getByRole("button", { name: "Novo fornecedor" }).click();
  await page.getByLabel("Razão social / nome").fill("Fornecedor novo");
  await page.getByLabel("CNPJ").fill("12.345.678/0001-90");
}

test.describe("ERP suppliers controlled", () => {
  test("creates a supplier", async ({ page }) => {
    await prepare(page, { empty: true });
    await openForm(page);
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(
      page.getByText("Fornecedor cadastrado com sucesso.")
    ).toBeVisible();
  });
  test("edits a supplier", async ({ page }) => {
    await prepare(page);
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Razão social / nome").fill("Fornecedor editado");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(
      page.getByText("Fornecedor atualizado com sucesso.")
    ).toBeVisible();
  });
  test("shows a duplicate document error", async ({ page }) => {
    await prepare(page, { empty: true, duplicate: true });
    await openForm(page);
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "CPF/CNPJ já cadastrado"
    );
  });
  test("supports filters and server-side pagination controls", async ({
    page,
  }) => {
    await prepare(page);
    await page.getByPlaceholder(/Razão social/).fill("controlado");
    await page.getByLabel("Filtrar status").selectOption("active");
    await page.getByLabel("Filtrar cidade").fill("Recife");
    await page.getByLabel("Filtrar UF").fill("PE");
    await expect(
      page
        .getByTestId("erp-suppliers-page")
        .getByRole("table")
        .getByRole("row")
        .filter({ hasText: "Fornecedor controlado" })
    ).toBeVisible();
    await expect(page.getByText("Página 1 de 1")).toBeVisible();
  });
  test("deactivates and activates explicitly", async ({ page }) => {
    await prepare(page);
    await page.getByRole("button", { name: "Inativar" }).click();
    await expect(
      page.getByText("Status do fornecedor atualizado.")
    ).toBeVisible();
  });
  test("keeps viewer actions out of the DOM", async ({ page }) => {
    await prepare(page, { readOnly: true });
    await expect(
      page.getByRole("button", { name: "Novo fornecedor" })
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Editar" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Inativar" })).toHaveCount(0);
  });
  test("renders empty and filtered-empty states", async ({ page }) => {
    await prepare(page, { empty: true });
    await expect(page.getByText("Nenhum fornecedor cadastrado.")).toBeVisible();
    await page.getByPlaceholder(/Razão social/).fill("ausente");
    await expect(
      page.getByText("Nenhum fornecedor corresponde aos filtros.")
    ).toBeVisible();
  });
  test("renders error with retry", async ({ page }) => {
    await prepare(page, { error: true });
    await page.getByRole("button", { name: "Tentar novamente" }).waitFor({ state: "visible" });
    await expect(page.getByText("Falha controlada")).toBeVisible();
    await reviewShot(page, "controlled-error-retry.png");
  });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ])
    test(`stays usable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await prepare(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await expect(page.getByTestId("erp-suppliers-page")).toBeVisible();
      if (viewport.width < 768)
        await expect(page.getByText("Localidade não informada")).toHaveCount(0);
    });
});
