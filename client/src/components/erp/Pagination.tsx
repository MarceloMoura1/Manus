import React from "react";
import { Button } from "@/components/ui/button";


type PaginationProps = {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
};

/**
 * Paginação padrão ERP — extraída de ERPWorkspace.tsx.
 * Preserva comportamento exato: só renderiza se totalPages > 1.
 */
export function Pagination({ page, totalPages, onPage }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </Button>
      <span className="text-sm text-slate-600">
        Página {page} de {totalPages}
      </span>
      <Button variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Próxima
      </Button>
    </nav>
  );
}
