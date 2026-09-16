import React, { type ReactNode } from "react";

/**
 * Coluna de cabeçalho da ErpDataTable.
 */
export type ErpColumn<T> = {
  /** Chave única da coluna */
  key: string;
  /** Texto do cabeçalho */
  header: string;
  /** Renderizador da célula */
  render: (row: T) => ReactNode;
  /** Classe CSS extra para o <th> e <td> — opcional */
  className?: string;
};

type ErpDataTableProps<T> = {
  /** Colunas a exibir */
  columns: ErpColumn<T>[];
  /** Dados da tabela */
  rows: T[];
  /** Chave única de cada linha */
  rowKey: (row: T) => string;
  /** Estado de carregamento — exibe esqueleto de linha */
  loading?: boolean;
  /** Conteúdo exibido quando rows está vazio e loading=false */
  emptyState?: ReactNode;
  /** Classe CSS extra para o container externo */
  className?: string;
};

/**
 * Tabela de dados padrão ERP com responsividade desktop.
 *
 * Suporta exatamente as capacidades comprovadas pelas páginas atuais:
 * - headers / rows / loading state / empty state
 * - responsiva via hidden overflow-x-auto md:block
 *
 * Não é um framework de tabelas — é um extrato do padrão repetido nas páginas ERP.
 */
export function ErpDataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyState,
  className = "",
}: ErpDataTableProps<T>) {
  return (
    <div className={`hidden overflow-x-auto rounded-2xl border bg-white md:block ${className}`}>
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`p-3 ${col.className ?? ""}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="p-6 text-center text-sm text-slate-500">
                Carregando…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            emptyState ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {emptyState}
                </td>
              </tr>
            ) : null
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-t">
                {columns.map((col) => (
                  <td key={col.key} className={`p-3 ${col.className ?? ""}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
