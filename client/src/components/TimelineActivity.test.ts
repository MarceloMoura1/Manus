import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getActivityAccentClass,
  getActivityAuthorName,
  getActivitySummary,
  getActivityTintClass,
  shouldRenderActivityNarrative,
  TimelineActivity,
} from "./TimelineActivity";

describe("TimelineActivity", () => {
  it("shows the real author below a note without a redundant narrative", () => {
    const markup = renderToStaticMarkup(React.createElement(TimelineActivity, {
      activities: [{
        id: "activity-note",
        date: Date.UTC(2026, 8, 13, 12, 0, 0),
        description: "Nota de acompanhamento",
        attendant: "Marcelo Moura",
        actionType: "note",
      }],
    }));

    expect(shouldRenderActivityNarrative("note")).toBe(false);
    expect(markup).toContain("Nota de acompanhamento");
    expect(markup).toContain("Marcelo Moura");
    expect(markup).not.toContain("registrou uma nota.");
    expect(markup).not.toContain(">Atendente<");
  });

  it("uses a neutral fallback for legacy generic snapshots without guessing an author", () => {
    expect(getActivityAuthorName("")).toBe("Autor não identificado");
    expect(getActivityAuthorName("Atendente")).toBe("Autor não identificado");
    expect(getActivityAuthorName("Ana do Tenant")).toBe("Ana do Tenant");
  });

  it("keeps useful descriptions for system and structural activities", () => {
    expect(shouldRenderActivityNarrative("close")).toBe(true);
    expect(shouldRenderActivityNarrative("forward")).toBe(true);
    expect(getActivitySummary({ attendant: "Sistema", actionType: "close" }))
      .toBe("Sistema encerrou o chamado.");

    const markup = renderToStaticMarkup(React.createElement(TimelineActivity, {
      activities: [{
        id: "activity-forward",
        date: Date.UTC(2026, 8, 13, 12, 0, 0),
        description: "Pedro Ferrari foi adicionado como participante.",
        attendant: "Marcelo Moura",
        actionType: "forward",
      }],
    }));

    expect(markup).toContain("Marcelo Moura encaminhou o chamado.");
    expect(markup).toContain("Pedro Ferrari foi adicionado como participante.");
  });

  it("uses discreet semantic accents and pastel tints per event type", () => {
    expect(getActivityAccentClass("note")).toBe("border-l-blue-400");
    expect(getActivityAccentClass("edit")).toBe("border-l-violet-400");
    expect(getActivityAccentClass("forward")).toBe("border-l-violet-400");
    expect(getActivityAccentClass("close")).toBe("border-l-emerald-400");
    expect(getActivityTintClass("note")).toBe("bg-blue-50/45");
    expect(getActivityTintClass("forward")).toBe("bg-violet-50/45");
    expect(getActivityTintClass("close")).toBe("bg-emerald-50/50");

    const markup = renderToStaticMarkup(React.createElement(TimelineActivity, {
      activities: [{
        id: "activity-1",
        date: Date.UTC(2026, 8, 13, 12, 0, 0),
        description: "Nota de acompanhamento",
        attendant: "Marcelo Moura",
        actionType: "note",
      }],
    }));

    expect(markup).toContain("border-l-blue-400");
    expect(markup).toContain("bg-blue-50/45");
  });
});
