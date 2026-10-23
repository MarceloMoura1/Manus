import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"), "utf8");
const home = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");

describe("Produtos: contratos visuais do workspace", () => {
  it("restaura o banner e o seletor branco com contagem real", () => {
    const banner = workspace.slice(workspace.indexOf('<section aria-label="Visão do catálogo"'), workspace.indexOf("{message &&"));
    expect(banner).toContain("Fotos, preço e disponibilidade reunidos para uma leitura rápida.");
    expect(banner).toContain("rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md px-6 py-4");
    expect(banner).toContain('!bg-white !text-slate-900 shadow-sm');
    expect(banner).toContain('backgroundColor: "#ffffff", color: "#0f172a"');
    expect(banner.match(/fontSize: "0.75rem"/g)).toHaveLength(2);
    expect(banner).not.toContain("bg-blue-600");
    expect(banner).toContain("query.data?.total ?? 0");
  });

  it("destaca imagem e nome e mantém o SKU fora do subtítulo da tabela", () => {
    const table = workspace.slice(workspace.indexOf("/* 4. Visualização em Lista"), workspace.indexOf('<div className="grid gap-3 md:hidden">'));
    expect(table).toContain("w-16 h-16 min-w-[64px] min-h-[64px] rounded-xl object-cover border border-slate-700/50 shadow-sm shrink-0");
    expect(table).toContain("text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight block mb-1");
    expect(table).toContain('{product.category || "Sem categoria"}');
    expect(table.match(/product\.sku/g)).toHaveLength(1);
  });

  it("mantém glow superior e workspace sem rolagem vertical própria", () => {
    expect(workspace).toContain("border border-white/10 border-t-white/20");
    expect(workspace).toContain("inset_0_1px_1px_rgba(255,255,255,0.15)");
    expect(workspace).not.toContain("0_-8px_30px_rgba(255,255,255");
    const root = workspace.match(/return <div className="([^"]+)" data-testid="erp-workspace"/);
    expect(root?.[1]).toContain("min-h-full bg-slate-50 dark:bg-slate-950");
    expect(root?.[1]).not.toMatch(/(?:^|\s)(?:h-screen|max-h-screen|overflow-y-auto)(?:\s|$)/);
    expect(home).toContain('shellLayout.mainContentClassName, active.startsWith("erp-") && "bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"');
  });
});
