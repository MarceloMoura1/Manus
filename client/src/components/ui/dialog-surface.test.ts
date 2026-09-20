import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared dialog surface theme", () => {
  it("maps bg-background to an opaque light/dark application surface", () => {
    const css = readFileSync("client/src/index.css", "utf8");
    const dialog = readFileSync("client/src/components/ui/dialog.tsx", "utf8");

    expect(dialog).toContain("bg-background");
    expect(css).toContain("--color-background: var(--bg-secondary)");
    expect(css).toMatch(/:root[\s\S]*--bg-secondary:\s*#ffffff/);
    expect(css).toMatch(/html\.dark[\s\S]*--bg-secondary:\s*#1e293b/);
  });
});
