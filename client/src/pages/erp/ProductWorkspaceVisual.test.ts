import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"), "utf8");
const home = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");

describe("Produtos: contratos visuais do workspace", () => {
  it("restaura o banner e o seletor branco com contagem real", () => {
    const banner = workspace.slice(workspace.indexOf('<section aria-label="Visão do catálogo"'), workspace.indexOf("{message &&"));
    expect(banner).toContain("Fotos, preço e disponibilidade reunidos para uma leitura rápida.");
    expect(banner).toContain("mb-6 flex flex-col gap-4 rounded-2xl border border-border bg-card/80 px-6 py-4 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-900/60");
    expect(banner).toContain('!bg-white !text-slate-900 shadow-sm');
    expect(banner).toContain('backgroundColor: "#ffffff", color: "#0f172a"');
    expect(banner).toContain("text-muted-foreground hover:text-foreground");
    expect(banner).not.toContain("bg-blue-600");
    expect(workspace).toContain("const totalProducts = query.data?.total ?? 0;");
    expect(banner).toContain("{totalProducts}");
  });

  it("destaca imagem e nome e mantém o SKU fora do subtítulo da tabela", () => {
    const table = workspace.slice(workspace.indexOf("/* 4. Visualização em Lista"), workspace.indexOf('<div className="grid gap-3 md:hidden">'));
    expect(table).toContain("min-w-[280px] px-4 py-3");
    expect(table).toContain("h-16 w-16 min-h-[64px] min-w-[64px] shrink-0 rounded-xl border border-border shadow-sm");
    expect(workspace).toContain('className="w-full h-full object-cover"');
    expect(table).toContain("mb-1 block text-sm font-semibold leading-tight text-foreground");
    expect(table).toContain('{product.category || "Sem categoria"}');
    expect(table.match(/product\.sku/g)).toHaveLength(1);
  });

  it("mantém glow superior e workspace sem rolagem vertical própria", () => {
    expect(workspace).toContain("mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card/90 px-6 py-3.5 text-card-foreground shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-900/80");
    expect(workspace).not.toContain("0_-8px_30px_rgba(255,255,255");
    const root = workspace.match(/return <div className="([^"]+)" data-testid="erp-workspace"/);
    expect(root?.[1]).toContain("min-h-full bg-background text-foreground");
    expect(root?.[1]).not.toMatch(/(?:^|\s)(?:h-screen|max-h-screen|overflow-y-auto)(?:\s|$)/);
    expect(home).toContain('shellLayout.mainContentClassName, active.startsWith("erp-") && "min-h-full overflow-y-auto bg-background text-foreground"');
  });
});
