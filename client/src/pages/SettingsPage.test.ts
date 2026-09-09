import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/SettingsPage.tsx"), "utf8");

describe("SettingsPage access and layout", () => {
  it("keeps Personalização visible to both administrators and operational users", () => {
    expect(source).toContain("{ value: 'personalization', label: 'Personalização', adminOnly: false }");
    expect(source).toContain("const tabs = allTabs.filter(tab => isAdmin || !tab.adminOnly)");
  });

  it("does not grant administrative settings to normal users", () => {
    expect(source).toContain("{ value: 'whatsapp', label: 'WhatsApp', adminOnly: true }");
    expect(source).toContain("{ value: 'backup', label: '💾 Backup', adminOnly: true }");
  });

  it("uses the wider responsive settings shell", () => {
    expect(source).toContain("max-w-[1440px]");
    expect(source).toContain("lg:grid-cols-[17rem_minmax(0,1fr)]");
  });
});
