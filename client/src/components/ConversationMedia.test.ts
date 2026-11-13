import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationMedia } from "./ConversationMedia";

describe("ConversationMedia documents", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a clickable document link from a direct PDF URL", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationMedia, {
        conversationId: "conv-1",
        message: {
          type: "document",
          fileName: "Orcamento.pdf",
          mediaReference: { url: "/api/erp/sales/sale-1/pdf", messageId: "msg-1" },
        },
        fallback: createElement("span", null, "Documento indisponível"),
      })
    );

    expect(html).toContain('href="/api/erp/sales/sale-1/pdf"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Orcamento.pdf");
    expect(html).not.toContain("Documento indisponível");
  });

  it("resolves quote PDF url automatically when fileName matches orcamento-*.pdf", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationMedia, {
        conversationId: "conv-1",
        message: {
          type: "document",
          fileName: "orcamento-O-21.pdf",
        },
        fallback: createElement("span", null, "Documento indisponível"),
      })
    );

    expect(html).toContain('href="/api/crm/quotes/O-21/pdf"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("orcamento-O-21.pdf");
    expect(html).not.toContain("Documento indisponível");
  });

  it("extracts quote code O-22 from message caption when fileName is customized without the code", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationMedia, {
        conversationId: "conv-1",
        message: {
          type: "document",
          fileName: "Orcamento - FaYers Company - 21-04-2026.pdf",
          text: "Olá, FaYers Company! Segue em anexo o orçamento comercial O-22 no valor de R$ 2.500,00.",
          mediaReference: { storage: "private", messageId: "msg-22" },
        },
        fallback: createElement("span", null, "Documento indisponível"),
      })
    );

    expect(html).toContain('href="/api/crm/quotes/O-22/pdf"');
    expect(html).toContain("Orcamento - FaYers Company - 21-04-2026.pdf");
    expect(html).not.toContain("Documento indisponível");
  });

  it("falls back when no media source exists", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationMedia, {
        conversationId: "conv-1",
        message: { type: "document" },
        fallback: createElement("span", null, "Documento indisponível"),
      })
    );

    expect(html).toContain("Documento indisponível");
  });
});
