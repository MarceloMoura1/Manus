import type { ReactNode } from "react";

type ErpPageHeaderProps = {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
};

export function ErpPageHeader({ title, eyebrow, actions }: ErpPageHeaderProps) {
  return (
    <header className="flex min-h-14 flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        {eyebrow && (
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
