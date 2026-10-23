import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve(process.cwd(), "client/src/pages/erp/ERPWorkspace.tsx"), "utf8");
const home = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");
const theme = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

describe("Produtos: contratos visuais do workspace", () => {
  it("mantém o banner de catálogo e o seletor alinhados à referência", () => {
    const banner = workspace.slice(workspace.indexOf('<section aria-label="Visão do catálogo"'), workspace.indexOf("{message &&"));
    expect(banner).toContain("Fotos, preço e disponibilidade reunidos para uma leitura rápida.");
    expect(banner).toContain("relative mb-6 flex flex-col justify-between gap-4 overflow-hidden rounded-2xl p-5 md:flex-row md:items-center\" style={deepNavySurfaceStyle}");
    expect(banner).toContain("CATÁLOGO VISUAL");
    expect(banner).toContain("block text-[11px] font-bold tracking-widest uppercase text-sky-400");
    expect(banner).toContain("mt-0.5 text-xs text-slate-400");
    expect(banner).toContain("flex items-center gap-1 rounded-xl border border-slate-700/60 bg-slate-800/90 p-1");
    expect(banner).toContain('"bg-white text-slate-900 font-semibold shadow-sm"');
    expect(banner).toContain('"text-slate-400 hover:text-white"');
    expect(banner).toContain("text-xl font-bold leading-none text-white");
    expect(banner).toContain("ml-1 text-xs font-normal text-slate-400");
    expect(banner).not.toContain("bg-blue-600");
    expect(workspace).toContain("const totalProducts = query.data?.total ?? 0;");
    expect(banner).toContain("{totalProducts}");
  });

  it("destaca foto e nome, mantendo SKU e categoria apenas nas colunas dedicadas", () => {
    const table = workspace.slice(workspace.indexOf("/* 4. Visualização em Lista"), workspace.indexOf('<div className="grid gap-3 md:hidden">'));
    expect(table).toContain("cursor-pointer border-b border-slate-800/50 transition-colors hover:bg-slate-900/30");
    expect(table).toContain("min-w-[320px] align-middle px-4 py-3.5");
    expect(table).toContain("flex items-center gap-4 py-3.5");
    expect(table).toContain("h-[76px] w-[76px] min-h-[76px] min-w-[76px]");
    expect(table).toContain('style={{ width: "76px", height: "76px", minWidth: "76px", minHeight: "76px" }}');
    expect(table).toContain('imageStyle={{ width: "76px", height: "76px" }}');
    expect(workspace).toContain('className="w-full h-full object-cover block"');
    expect(table).toContain("min-w-0 flex flex-col justify-center");
    expect(table).toContain("text-base font-semibold tracking-tight leading-snug text-slate-100 transition-colors hover:text-sky-400");
    expect(table).not.toContain("SKU: {product.sku ||");
    expect(table).toContain("rounded-md border border-slate-800 bg-slate-900/80 px-2.5 py-1 font-mono text-xs tracking-wider text-slate-300");
    expect(table).toContain("rounded-full border border-slate-700/50 bg-slate-800/40 px-3 py-0.5 text-xs font-medium text-slate-300");
    expect(table.match(/product\.sku/g)).toHaveLength(1);
  });

  it("mantém iluminação interna contida e delega a rolagem do ERP ao main", () => {
    expect(workspace).toContain("const deepNavySurfaceStyle: React.CSSProperties");
    expect(workspace).toContain('background: "radial-gradient(100% 140% at 50% 40%, #0d1e38 0%, #081324 45%, #040812 100%)"');
    expect(workspace).toContain('border: "1px solid rgba(255, 255, 255, 0.18)"');
    expect(workspace).toContain('boxShadow: "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), inset 0 0 30px rgba(14, 116, 144, 0.04)"');
    expect(workspace.match(/style=\{deepNavySurfaceStyle\}/g)).toHaveLength(2);
    expect(workspace).not.toContain("0_-8px_30px_rgba(255,255,255");
    const root = workspace.match(/return <div className="([^"]+)" data-testid="erp-workspace"/);
    expect(root?.[1]).toContain("w-full min-h-full bg-background text-foreground flex flex-col");
    expect(root?.[1]).not.toMatch(/(?:^|\s)(?:h-screen|max-h-screen|overflow-y-auto)(?:\s|$)/);
    expect(home).toMatch(/active\.startsWith\("erp-"\)\s*\?\s*"overflow-y-auto bg-background p-4 text-foreground sm:p-8"\s*:\s*shellLayout\.mainContentClassName/);
    expect(theme).toMatch(/html,\r?\nbody,\r?\n#root \{\r?\n  height: 100%;\r?\n  overflow: hidden;/);
  });
});
