import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getShellWorkspaceLayout, ShellTopbarBoundary } from "./Home";

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
  });

  it("removes the shared topbar structurally from Chamados without changing other workspaces", () => {
    expect(getShellWorkspaceLayout("tickets")).toEqual({
      moduleTopbar: "none",
      mainContentClassName: "overflow-auto p-4 sm:px-8 sm:pb-8 sm:pt-6",
      settingsPageLayout: "standalone",
    });
  });

  it("does not mount the topbar wrapper or its Sparkles action for Chamados", () => {
    const topbar = React.createElement(
      "header",
      { className: "border-b bg-white" },
      React.createElement("button", { "aria-label": "Abrir assistente IA" }, "Sparkles"),
    );

    const ticketsMarkup = renderToStaticMarkup(
      React.createElement(ShellTopbarBoundary, { active: "tickets", mode: "standard" }, topbar),
    );
    const homeMarkup = renderToStaticMarkup(
      React.createElement(ShellTopbarBoundary, { active: "home", mode: "standard" }, topbar),
    );

    expect(ticketsMarkup).toBe("");
    expect(ticketsMarkup).not.toContain("Sparkles");
    expect(ticketsMarkup).not.toContain("module-topbar-shell");
    expect(homeMarkup).toContain('data-testid="module-topbar-shell"');
    expect(homeMarkup).toContain("Sparkles");
  });

  it("preserves the specialized conversation workspace", () => {
    expect(getShellWorkspaceLayout("conversations")).toEqual({
      moduleTopbar: "none",
      mainContentClassName: "overflow-hidden",
      settingsPageLayout: "standalone",
    });
  });
});
