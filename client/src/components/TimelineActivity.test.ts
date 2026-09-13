import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getActivityAccentClass,
  getActivityAuthorName,
  getActivitySummary,
  TimelineActivity,
} from "./TimelineActivity";

describe("TimelineActivity", () => {
  it("renders the real author exactly once in a new activity summary", () => {
    const summary = getActivitySummary({ attendant: "Marcelo Moura", actionType: "note" });

    expect(summary).toBe("Marcelo Moura registrou uma nota.");
    expect(summary).not.toContain("Atendente Atendente");
  });

  it("keeps a safe legacy fallback without duplicating its generic snapshot", () => {
    expect(getActivityAuthorName("")).toBe("Atendente");
    expect(getActivitySummary({ attendant: "Atendente", actionType: "register" }))
      .toBe("Atendente registrou um apontamento.");
  });

  it("keeps system-generated activities explicitly identified as Sistema", () => {
    expect(getActivitySummary({ attendant: "Sistema", actionType: "close" }))
      .toBe("Sistema encerrou o chamado.");
  });

  it("uses a discrete semantic accent per event type", () => {
    expect(getActivityAccentClass("note")).toBe("border-l-blue-400");
    expect(getActivityAccentClass("edit")).toBe("border-l-violet-400");
    expect(getActivityAccentClass("forward")).toBe("border-l-violet-400");
    expect(getActivityAccentClass("close")).toBe("border-l-emerald-400");

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
    expect(markup).toContain("Marcelo Moura registrou uma nota.");
  });
});
