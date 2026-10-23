import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"), "utf8");
const home = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");

describe("Produtos: contratos visuais do workspace", () => {
  it("restaura o banner e o seletor branco com contagem real", () => {
    const banner = workspace.slice(workspace.indexOf('<section aria-label="Visão do catálogo"'), workspace.indexOf("{message &&"));
    expect(banner).toContain("Fotos, preço e disponibilidade reunidos para uma leitura rápida.");
    expect(banner).toContain("border-slate-700/80 rounded-2xl bg-slate-900/90 px-6 py-4");
    expect(banner).toContain('!bg-white !text-slate-900 shadow-sm');
    expect(banner).toContain('backgroundColor: "#ffffff", color: "#0f172a"');
    expect(banner.match(/fontSize: "0.75rem"/g)).toHaveLength(2);
    expect(banner).not.toContain("bg-blue-600");
    expect(banner).toContain("query.data?.total ?? 0");
  });

  it("destaca imagem e nome e mantém o SKU fora do subtítulo da tabela", () => {
    const table = workspace.slice(workspace.indexOf("/* 4. Visualização em Lista"), workspace.indexOf('<div className="grid gap-3 md:hidden">'));
    expect(table).toContain("w-16 h-16 min-w-[64px] min-h-[64px] rounded-xl object-cover border border-slate-700 shadow-md shrink-0");
    expect(table).toContain("text-lg font-bold text-slate-100 block mb-0.5 tracking-tight");
    expect(table).toContain('{product.category || "Sem categoria"}');
    expect(table.match(/product\.sku/g)).toHaveLength(1);
  });

  it("mantém glow superior e workspace sem rolagem vertical própria", () => {
    expect(workspace).toContain("border-t-white/40 border-x border-b border-white/10");
    expect(workspace).toContain("0_-8px_30px_rgba(255,255,255,0.18)");
    expect(workspace).toContain('className="pt-4 pb-6"');
    const root = workspace.match(/return <div className="([^"]+)" data-testid="erp-workspace"/);
    expect(root?.[1]).toContain("min-h-screen bg-slate-950 dark:bg-slate-950");
    expect(root?.[1]).not.toMatch(/(?:^|\s)(?:h-screen|max-h-screen|overflow-y-auto)(?:\s|$)/);
    expect(home).toContain('shellLayout.mainContentClassName, active.startsWith("erp-") && "bg-slate-950 dark:bg-slate-950 text-slate-100"');
  });
});
