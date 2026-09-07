import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { browserBrandForHostname, MEGADESK_FAVICON_HREF } from "./browser-branding";

describe("browser branding", () => {
  it("uses MegaDesk on the operational hostname", () => {
    expect(browserBrandForHostname("app.megadesk.online").title).toBe("MegaDesk");
  });

  it("uses MegaAdmin on the administrative hostname", () => {
    expect(browserBrandForHostname("admin.megadesk.online").title).toBe("MegaAdmin");
  });

  it("references the versioned official favicon asset", () => {
    expect(MEGADESK_FAVICON_HREF).toBe("/megadesk-favicon.png?v=1");
    expect(existsSync(resolve(import.meta.dirname, "..", "..", "public", "megadesk-favicon.png"))).toBe(true);
  });
});
