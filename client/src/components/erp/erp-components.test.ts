import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErpStatusBadge } from "./ErpStatusBadge";
import { ErpEmptyState } from "./ErpEmptyState";
import { ErpDataTable, type ErpColumn } from "./ErpDataTable";
import { Pagination } from "./Pagination";

// ---------------------------------------------------------------------------
// ErpStatusBadge
// ---------------------------------------------------------------------------
describe("ErpStatusBadge", () => {
  it("renderiza label passado", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpStatusBadge, { variant: "active", label: "Ativo" })
    );
    expect(markup).toContain("Ativo");
  });

  it("aplica classe verde para active", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpStatusBadge, { variant: "active", label: "Ativo" })
    );
    expect(markup).toContain("emerald");
  });

  it("aplica classe vermelha para cancelled", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpStatusBadge, { variant: "cancelled", label: "Cancelado" })
    );
    expect(markup).toContain("red");
  });

  it("aplica classe slate para inactive", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpStatusBadge, { variant: "inactive", label: "Inativo" })
    );
    expect(markup).toContain("slate");
  });

  it("aplica classe amber para open", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpStatusBadge, { variant: "open", label: "Aberto" })
    );
    expect(markup).toContain("amber");
  });

  it("renderiza como span", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpStatusBadge, { variant: "draft", label: "Rascunho" })
    );
    expect(markup).toMatch(/^<span/);
  });
});

// ---------------------------------------------------------------------------
// ErpEmptyState
// ---------------------------------------------------------------------------
describe("ErpEmptyState", () => {
  it("renderiza título obrigatório", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpEmptyState, { title: "Nenhum registro encontrado" })
    );
    expect(markup).toContain("Nenhum registro encontrado");
  });

  it("não renderiza descrição quando ausente", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpEmptyState, { title: "Vazio" })
    );
    // Somente o título deve aparecer, sem tag extra de descrição
    const pTags = (markup.match(/<p /g) ?? []).length;
    expect(pTags).toBe(1);
  });

  it("renderiza descrição quando fornecida", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpEmptyState, {
        title: "Vazio",
        description: "Cadastre o primeiro item",
      })
    );
    expect(markup).toContain("Cadastre o primeiro item");
  });

  it("renderiza botão de ação quando fornecido", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpEmptyState, {
        title: "Sem dados",
        action: { label: "Tentar novamente", onClick: () => {} },
      })
    );
    expect(markup).toContain("Tentar novamente");
    expect(markup).toContain("button");
  });

  it("não renderiza botão quando action ausente", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpEmptyState, { title: "Sem dados" })
    );
    expect(markup).not.toContain("button");
  });

  it("tem role=status para leitores de tela", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpEmptyState, { title: "Sem dados" })
    );
    expect(markup).toContain('role="status"');
  });
});

// ---------------------------------------------------------------------------
// ErpDataTable
// ---------------------------------------------------------------------------
type SimpleRow = { id: string; name: string; value: string };
const simpleColumns: ErpColumn<SimpleRow>[] = [
  { key: "name", header: "Nome", render: (r) => r.name },
  { key: "value", header: "Valor", render: (r) => r.value },
];
const simpleRows: SimpleRow[] = [
  { id: "a", name: "Alpha", value: "R$ 1,00" },
  { id: "b", name: "Beta", value: "R$ 2,00" },
];

describe("ErpDataTable", () => {
  it("renderiza headers das colunas", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpDataTable<SimpleRow>, {
        columns: simpleColumns,
        rows: simpleRows,
        rowKey: (r) => r.id,
      })
    );
    expect(markup).toContain("Nome");
    expect(markup).toContain("Valor");
  });

  it("renderiza conteúdo de cada linha", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpDataTable<SimpleRow>, {
        columns: simpleColumns,
        rows: simpleRows,
        rowKey: (r) => r.id,
      })
    );
    expect(markup).toContain("Alpha");
    expect(markup).toContain("Beta");
    expect(markup).toContain("R$ 1,00");
    expect(markup).toContain("R$ 2,00");
  });

  it("exibe mensagem de carregamento quando loading=true", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpDataTable<SimpleRow>, {
        columns: simpleColumns,
        rows: [],
        rowKey: (r) => r.id,
        loading: true,
      })
    );
    expect(markup).toContain("Carregando");
    expect(markup).not.toContain("Alpha");
  });

  it("não renderiza linhas quando rows está vazio e loading=false", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpDataTable<SimpleRow>, {
        columns: simpleColumns,
        rows: [],
        rowKey: (r) => r.id,
      })
    );
    expect(markup).not.toContain("Alpha");
  });

  it("renderiza emptyState quando rows vazio e emptyState fornecido", () => {
    const emptyNode = React.createElement("p", null, "Lista vazia");
    const markup = renderToStaticMarkup(
      React.createElement(ErpDataTable<SimpleRow>, {
        columns: simpleColumns,
        rows: [],
        rowKey: (r) => r.id,
        emptyState: emptyNode,
      })
    );
    expect(markup).toContain("Lista vazia");
  });

  it("renderiza uma <table>", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ErpDataTable<SimpleRow>, {
        columns: simpleColumns,
        rows: simpleRows,
        rowKey: (r) => r.id,
      })
    );
    expect(markup).toContain("<table");
    expect(markup).toContain("<thead");
    expect(markup).toContain("<tbody");
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
describe("Pagination", () => {
  it("não renderiza quando totalPages <= 1", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Pagination, { page: 1, totalPages: 1, onPage: () => {} })
    );
    expect(markup).toBe("");
  });

  it("não renderiza quando totalPages = 0", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Pagination, { page: 1, totalPages: 0, onPage: () => {} })
    );
    expect(markup).toBe("");
  });

  it("renderiza quando totalPages > 1", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Pagination, { page: 2, totalPages: 5, onPage: () => {} })
    );
    expect(markup).toContain("Página 2 de 5");
    expect(markup).toContain("Anterior");
    expect(markup).toContain("Próxima");
  });

  it("botão Anterior é disabled na página 1", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Pagination, { page: 1, totalPages: 3, onPage: () => {} })
    );
    // O botão Anterior precisa ter disabled
    const anteriorIdx = markup.indexOf("Anterior");
    const buttonBefore = markup.lastIndexOf("<button", anteriorIdx);
    const buttonFragment = markup.slice(buttonBefore, anteriorIdx);
    expect(buttonFragment).toContain("disabled");
  });

  it("botão Próxima é disabled na última página", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Pagination, { page: 5, totalPages: 5, onPage: () => {} })
    );
    const proximaIdx = markup.indexOf("Próxima");
    const buttonBefore = markup.lastIndexOf("<button", proximaIdx);
    const buttonFragment = markup.slice(buttonBefore, proximaIdx);
    expect(buttonFragment).toContain("disabled");
  });

  it("nenhum botão é disabled em página intermediária", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Pagination, { page: 3, totalPages: 5, onPage: () => {} })
    );
    // Conta botões disabled — deve ser zero
    const disabledCount = (markup.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBe(0);
  });

  it("tem aria-label de navegação", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Pagination, { page: 1, totalPages: 2, onPage: () => {} })
    );
    expect(markup).toContain('aria-label="Paginação"');
  });
});
