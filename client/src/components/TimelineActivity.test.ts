import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
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
  it("binds dark utilities to MegaDesk's explicit theme and keeps the light surface neutral", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    const markup = renderToStaticMarkup(React.createElement(TimelineActivity, {
      activities: [{ id: "theme", date: Date.UTC(2026, 8, 13), description: "Tema", attendant: "Ana", actionType: "note" }],
    }));

    expect(css).toContain("@custom-variant dark (&:where(.dark, .dark *));");
    expect(markup).toContain("border-slate-200 bg-white");
    expect(markup).toContain("dark:bg-slate-900");
    expect(markup).toContain("bg-blue-50");
    expect(markup).toContain("dark:bg-blue-950/40");
  });

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
    expect(getActivityAccentClass("note")).toContain("border-l-blue-400");
    expect(getActivityAccentClass("edit")).toContain("border-l-amber-400");
    expect(getActivityAccentClass("forward")).toContain("border-l-indigo-400");
    expect(getActivityAccentClass("close")).toContain("border-l-sky-400");
    expect(getActivityAccentClass("register")).toContain("border-l-blue-400");
    expect(getActivityAccentClass("attachment_removed")).toContain("border-l-rose-400");
    expect(getActivityTintClass("note")).toContain("bg-blue-50");
    expect(getActivityTintClass("forward")).toContain("bg-indigo-50");
    expect(getActivityTintClass("close")).toContain("bg-sky-50");
    expect(getActivityTintClass("register")).toContain("bg-blue-50");
    expect(getActivityBadge("note").label).toBe("Nota");
    expect(getActivityBadge("forward").label).toBe("Encaminhamento");
    expect(getActivityBadge("close").label).toBe("Status");
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

  it("renders an audited logical removal without exposing a file link", () => {
    const markup = renderToStaticMarkup(React.createElement(TimelineActivity, {
      activities: [{
        id: "activity-removed", date: Date.UTC(2026, 8, 13, 12, 0, 0), description: "Ana removeu logicamente evidence.txt.", attendant: "Ana",
        actionType: "attachment_removed",
        metadata: { eventType: "attachment_removed", attachmentId: "22222222-2222-4222-8222-222222222222", fileName: "evidence.txt", mimeType: "text/plain", size: 17, sha256: "a".repeat(64) },
      }],
    }));
    expect(markup).toContain("removeu o anexo evidence.txt.");
    expect(markup).toContain("Removido logicamente");
    expect(markup).not.toContain("Visualizar arquivo");
  });

  it("renders structured audit details with human labels and compact observations", () => {
    const markup = renderToStaticMarkup(React.createElement(TimelineActivity, {
      activities: [
        { id: "created", date: Date.UTC(2026, 8, 13), description: "legacy description", attendant: "Marcelo", actionType: "ticket_created", metadata: { eventType: "ticket_created" } },
        { id: "status", date: Date.UTC(2026, 8, 13), description: "legacy description", attendant: "Marcelo", actionType: "status_changed", metadata: { eventType: "status_changed", fromStatus: "open", toStatus: "in_progress" } },
        { id: "edit", date: Date.UTC(2026, 8, 13), description: "legacy description", attendant: "Marcelo", actionType: "ticket_edited", metadata: { eventType: "ticket_edited", changes: [{ field: "priority", from: "media", to: "alta" }, { field: "customer", from: "Empresa A", to: "Empresa B" }, { field: "observations", from: "a".repeat(140), to: "b".repeat(140) }] } },
        { id: "collaborator", date: Date.UTC(2026, 8, 13), description: "legacy description", attendant: "Marcelo", actionType: "collaborator_added", metadata: { eventType: "collaborator_added", collaboratorId: "user-1", collaboratorName: "João Silva" } },
        { id: "forward", date: Date.UTC(2026, 8, 13), description: "legacy description", attendant: "Marcelo", actionType: "ticket_forwarded", metadata: { eventType: "ticket_forwarded", fromAssigneeId: "support", fromAssigneeName: "Suporte", toAssigneeId: "finance", toAssigneeName: "Financeiro" } },
        { id: "manual", date: Date.UTC(2026, 8, 13), description: "Contato confirmado", attendant: "Marcelo", actionType: "manual_activity", metadata: { eventType: "manual_activity" } },
      ],
    }));

    expect(markup).toContain("Marcelo criou o chamado.");
    expect(markup).toContain("Marcelo alterou o status.");
    expect(markup).toContain("Aberto");
    expect(markup).toContain("Em andamento");
    expect(markup).toContain("Média");
    expect(markup).toContain("Alta");
    expect(markup).toContain("Empresa A");
    expect(markup).toContain("Empresa B");
    expect(markup).toContain("Alterada");
    expect(markup).not.toContain("a".repeat(140));
    expect(markup).toContain("Marcelo adicionou João Silva como colaborador.");
    expect(markup).toContain("Suporte");
    expect(markup).toContain("Financeiro");
    expect(markup).toContain("Marcelo registrou uma atividade.");
    expect(markup).toContain("Contato confirmado");
  });

  it("keeps a safe legacy description when structured metadata is invalid", () => {
    const markup = renderToStaticMarkup(React.createElement(TimelineActivity, {
      activities: [{ id: "legacy", date: Date.UTC(2026, 8, 13), description: "Chamado editado anteriormente", attendant: "", actionType: "ticket_edited", metadata: { eventType: "ticket_edited", changes: [] } }],
    }));

    expect(markup).toContain("Autor não identificado");
    expect(markup).toContain("Chamado editado anteriormente");
    expect(markup).not.toContain("[object Object]");
  });
});
