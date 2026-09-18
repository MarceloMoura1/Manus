import type { ReactNode } from "react";

type ErpPageHeaderProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
};

export function ErpPageHeader({ title, eyebrow, description, actions }: ErpPageHeaderProps) {
  return (
    <header className="flex min-h-14 flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
