import React from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";


type ErpEmptyStateProps = {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};

/**
 * Estado vazio/erro padrão ERP — evolução do StateMessage inline de ERPWorkspace.tsx.
 * Adiciona `description` opcional e `action` primária opcional sem quebrar o uso atual.
 */
export function ErpEmptyState({ title, description, action }: ErpEmptyStateProps) {
  return (
    <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <AlertCircle className="mx-auto mb-3 h-7 w-7 text-slate-400" />
      <p className="font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      {action && (
        <Button className="mt-4" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
