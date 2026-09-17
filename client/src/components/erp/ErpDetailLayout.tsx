import React, { type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

type ErpDetailLayoutProps = {
  /** Título principal da ficha */
  title: string;
  /** Subtítulo / eyebrow opcional */
  eyebrow?: string;
  /** Callback de "Voltar" — se ausente, o botão não é exibido */
  onBack?: () => void;
  /** Label do botão de voltar — padrão: "Voltar" */
  backLabel?: string;
  /** Ações no header (botões de salvar, editar, etc.) */
  headerActions?: ReactNode;
  /** Navegação por abas acima do conteúdo — ex: <TabsList> */
  tabs?: ReactNode;
  /** Conteúdo principal da ficha */
  children: ReactNode;
};

/**
 * Layout de ficha de detalhe inline para o ERP (P0 — fundação).
 *
 * Fornece a estrutura de:
 * - botão de voltar;
 * - header com título/subtítulo e ações;
 * - área de tabs;
 * - área de conteúdo.
 *
 * Não possui consumidor de produção nesta fase.
 * Será utilizado pela ficha de Produto a partir de P2 (D5=A: painel inline).
 */
export function ErpDetailLayout({
  title,
  eyebrow,
  onBack,
  backLabel = "Voltar",
  headerActions,
  tabs,
  children,
}: ErpDetailLayoutProps) {
  return (
    <div className="space-y-4">
      {/* Botão de voltar */}
      {onBack && (
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 text-slate-600">
            <ChevronLeft className="mr-1 h-4 w-4" />
            {backLabel}
          </Button>
        </div>
      )}

      {/* Header */}
      <header className="flex min-h-14 flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          {eyebrow && (
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
        </div>
        {headerActions && (
          <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
        )}
      </header>

      {/* Tabs */}
      {tabs && <div>{tabs}</div>}

      {/* Conteúdo */}
      <div>{children}</div>
    </div>
  );
}
