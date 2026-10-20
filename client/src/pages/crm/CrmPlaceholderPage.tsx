import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface CrmPlaceholderPageProps {
  title: string;
  stageBadge: string;
  description: string;
  highlights: string[];
  icon: LucideIcon;
  onBackToSummary: () => void;
  actionButtonLabel?: string;
  onAction?: () => void;
}

export function CrmPlaceholderPage({
  title,
  stageBadge,
  description,
  highlights,
  icon: Icon,
  onBackToSummary,
  actionButtonLabel,
  onAction,
}: CrmPlaceholderPageProps) {
  return (
    <div className="space-y-6" data-testid={`crm-placeholder-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                <Clock className="h-3 w-3" />
                {stageBadge}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>
          </div>
        </div>

        <Button
          variant="outline"
          onClick={onBackToSummary}
          className="self-start border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 sm:self-auto"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar ao Resumo
        </Button>
      </div>

      {/* Cartão de Funcionalidades em Preparação */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span>Funcionalidades planejadas no roteiro arquitetural:</span>
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((highlight, index) => (
            <li
              key={index}
              className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 text-sm text-slate-700 dark:border-slate-800/80 dark:bg-slate-950/50 dark:text-slate-300"
            >
              <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500" />
              <span>{highlight}</span>
            </li>
          ))}
        </ul>

        {actionButtonLabel && onAction && (
          <div className="mt-6 flex justify-end">
            <Button onClick={onAction} className="bg-purple-600 text-white hover:bg-purple-700">
              {actionButtonLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
