import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"), "utf8");
const home = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");

describe("Produtos: contratos visuais do workspace", () => {
  it("mantém o banner de catálogo e o seletor alinhados à referência", () => {
    const banner = workspace.slice(workspace.indexOf('<section aria-label="Visão do catálogo"'), workspace.indexOf("{message &&"));
    expect(banner).toContain("Fotos, preço e disponibilidade reunidos para uma leitura rápida.");
    expect(banner).toContain("mb-6 flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/60 px-6 py-4 backdrop-blur-md");
    expect(banner).toContain("CATÁLOGO VISUAL");
    expect(banner).toContain("mb-0.5 block text-[11px] font-bold tracking-[0.16em] text-blue-400");
    expect(banner).toContain("flex items-center gap-1 rounded-xl border border-slate-700/60 bg-slate-800/90 p-1");
    expect(banner).toContain('"bg-white text-slate-900 font-semibold shadow-sm"');
    expect(banner).toContain('"text-slate-400 hover:text-white"');
    expect(banner).toContain("text-xl font-bold leading-none text-white");
    expect(banner).toContain("ml-1 text-xs font-normal text-slate-400");
    expect(banner).not.toContain("bg-blue-600");
    expect(workspace).toContain("const totalProducts = query.data?.total ?? 0;");
    expect(banner).toContain("{totalProducts}");
  });

  it("destaca imagem e nome e mantém o SKU fora do subtítulo da tabela", () => {
    const table = workspace.slice(workspace.indexOf("/* 4. Visualização em Lista"), workspace.indexOf('<div className="grid gap-3 md:hidden">'));
    expect(table).toContain("min-w-[320px] px-4 py-3");
    expect(table).toContain("w-16 h-16 min-w-[64px] min-h-[64px] max-w-[64px] max-h-[64px] rounded-xl overflow-hidden border border-border shadow-sm flex-shrink-0 bg-muted");
    expect(table).toContain('style={{ width: "64px", height: "64px", minWidth: "64px", minHeight: "64px" }}');
    expect(table).toContain('imageStyle={{ width: "64px", height: "64px" }}');
    expect(workspace).toContain('className="w-full h-full object-cover block"');
    expect(table).toContain("min-w-0 flex flex-col justify-center");
    expect(table).toContain("font-bold text-base text-foreground leading-snug line-clamp-2");
    expect(table).toContain("text-xs text-muted-foreground mt-0.5 block");
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
