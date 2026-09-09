import { describe, expect, it } from "vitest";
import { getShellWorkspaceLayout } from "./Home";

describe("authenticated shell workspace variants", () => {
  it("gives Settings a desktop topbar-free workspace without duplicating the main padding", () => {
    expect(getShellWorkspaceLayout("settings")).toEqual({
      moduleTopbar: "mobile-only",
      mainContentClassName: "overflow-auto p-0",
      settingsPageLayout: "workspace",
    });
  });

  it("keeps normal routes on the standard topbar and padded workspace", () => {
    expect(getShellWorkspaceLayout("home")).toEqual({
      moduleTopbar: "standard",
      mainContentClassName: "overflow-auto p-4 sm:p-8",
      settingsPageLayout: "standalone",
    });
    expect(getShellWorkspaceLayout("erp-summary").moduleTopbar).toBe("standard");
    expect(getShellWorkspaceLayout("tickets").moduleTopbar).toBe("standard");
  });

  it("preserves the specialized conversation workspace", () => {
    expect(getShellWorkspaceLayout("conversations")).toEqual({
      moduleTopbar: "none",
      mainContentClassName: "overflow-hidden",
      settingsPageLayout: "standalone",
    });
  });
});
