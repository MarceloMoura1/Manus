import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getActivityAccentClass,
  getActivityAuthorName,
  getActivityBadge,
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
    expect(getActivityAccentClass("edit")).toBe("border-l-amber-400");
    expect(getActivityAccentClass("forward")).toBe("border-l-indigo-400");
    expect(getActivityAccentClass("close")).toBe("border-l-emerald-400");
    expect(getActivityAccentClass("register")).toBe("border-l-orange-400");
    expect(getActivityTintClass("note")).toBe("bg-blue-50");
    expect(getActivityTintClass("forward")).toBe("bg-indigo-50");
    expect(getActivityTintClass("close")).toBe("bg-emerald-50");
    expect(getActivityTintClass("register")).toBe("bg-orange-50");
    expect(getActivityBadge("note").label).toBe("Nota");
    expect(getActivityBadge("forward").label).toBe("Sistema");
    expect(getActivityBadge("close").label).toBe("Sistema");
    expect(getActivityBadge("register").label).toBe("Criação");

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
    expect(markup).toContain("bg-blue-50");
  });

  it("links a structured attachment event only through the existing private ticket route", () => {
    const chamadoId = "11111111-1111-4111-8111-111111111111";
    const attachmentId = "22222222-2222-4222-8222-222222222222";
    const markup = renderToStaticMarkup(React.createElement(TimelineActivity, {
      chamadoId,
      activities: [{
        id: "activity-attachment",
        date: Date.UTC(2026, 8, 13, 12, 0, 0),
        description: "Ana adicionou evidence.txt.",
        attendant: "Ana",
        actionType: "attachment_added",
        metadata: { eventType: "attachment_added", attachmentId, fileName: "evidence.txt", mimeType: "text/plain", size: 17, sha256: "a".repeat(64) },
      }],
    }));

    expect(markup).toContain("Visualizar arquivo");
    expect(markup).toContain(`/api/chamados/${chamadoId}/attachments/${attachmentId}/file`);
    expect(markup).toContain('rel="noreferrer"');
  });
});
