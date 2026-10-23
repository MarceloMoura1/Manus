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
    expect(banner).toContain("relative mb-6 flex flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl border border-white/20 bg-[#060d1a] px-6 py-4 backdrop-blur-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_0_15px_rgba(255,255,255,0.03)]");
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

  it("destaca imagem, nome, SKU e categoria sem comprimir a miniatura", () => {
    const table = workspace.slice(workspace.indexOf("/* 4. Visualização em Lista"), workspace.indexOf('<div className="grid gap-3 md:hidden">'));
    expect(table).toContain("min-w-[320px] px-4 py-3");
    expect(table).toContain("w-16 h-16 min-w-[64px] min-h-[64px] max-w-[64px] max-h-[64px] rounded-xl overflow-hidden !border !border-slate-800 !bg-slate-900 shadow-sm flex-shrink-0");
    expect(table).toContain('style={{ width: "64px", height: "64px", minWidth: "64px", minHeight: "64px" }}');
    expect(table).toContain('imageStyle={{ width: "64px", height: "64px" }}');
    expect(workspace).toContain('className="w-full h-full object-cover block"');
    expect(table).toContain("min-w-0 flex flex-col justify-center");
    expect(table).toContain("truncate text-sm font-medium leading-snug text-slate-900 dark:text-slate-100 md:text-base");
    expect(table).toContain("mt-0.5 flex items-center gap-2 truncate text-xs text-slate-500 dark:text-slate-400");
    expect(table).toContain("SKU: {product.sku ||");
    expect(table).toContain('{product.category || "Sem categoria"}');
    expect(table.match(/product\.sku/g)).toHaveLength(2);
  });

  it("mantém iluminação interna contida e delega a rolagem do ERP ao main", () => {
    expect(workspace).toContain("relative mt-4 flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl border border-white/20 bg-[#060d1a] px-6 py-3.5 backdrop-blur-md shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.25)]");
    expect(workspace).not.toContain("0_-8px_30px_rgba(255,255,255");
    const root = workspace.match(/return <div className="([^"]+)" data-testid="erp-workspace"/);
    expect(root?.[1]).toContain("w-full min-h-full bg-background text-foreground flex flex-col");
    expect(root?.[1]).not.toMatch(/(?:^|\s)(?:h-screen|max-h-screen|overflow-y-auto)(?:\s|$)/);
    expect(home).toMatch(/active\.startsWith\("erp-"\)\s*\?\s*"overflow-y-auto bg-background p-4 text-foreground sm:p-8"\s*:\s*shellLayout\.mainContentClassName/);
    expect(theme).toMatch(/html,\r?\nbody,\r?\n#root \{\r?\n  height: 100%;\r?\n  overflow: hidden;/);
  });
});
