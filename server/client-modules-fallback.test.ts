import { describe, expect, it } from "vitest";
import { CONFIGURABLE_MODULES } from "@shared/const";
import { resolveLoadedClientModules } from "./db";

describe("fallback de módulos para tenants ativos", () => {
  it("restaura o catálogo canônico quando modules_json está vazio", () => {
    expect(resolveLoadedClientModules("active", "[]")).toEqual([...CONFIGURABLE_MODULES]);
    expect(resolveLoadedClientModules("active", null)).toEqual([...CONFIGURABLE_MODULES]);
  });

  it("preserva uma configuração explícita e não amplia tenants inativos", () => {
    expect(resolveLoadedClientModules("active", '["tickets"]')).toEqual(["tickets"]);
    expect(resolveLoadedClientModules("paused", "[]")).toEqual([]);
  });
});
