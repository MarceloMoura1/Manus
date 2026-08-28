import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ModuleTopbarItem = {
  id: string;
  label: string;
  hidden?: boolean;
  disabled?: boolean;
  unavailableReason?: string;
  onSelect?: () => void;
};

type ModuleTopbarProps = {
  ariaLabel?: string;
  activeItemId?: string;
  items?: ModuleTopbarItem[];
  leading?: ReactNode;
  actions?: ReactNode;
  complementaryContent?: ReactNode;
};

export function ModuleTopbar({
  ariaLabel = "Navegação do módulo",
  activeItemId,
  items = [],
  leading,
  actions,
  complementaryContent,
}: ModuleTopbarProps) {
  const visibleItems = items.filter(item => !item.hidden);

  return (
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <div className="flex min-h-14 min-w-0 items-center gap-2 px-4 sm:px-8">
        {leading ? <div className="shrink-0">{leading}</div> : null}
        {visibleItems.length > 0 ? (
          <nav aria-label={ariaLabel} className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
            <div className="flex min-w-max items-center gap-1 py-2">
              {visibleItems.map(item => {
                const isActive = item.id === activeItemId;
                const unavailableLabel = item.unavailableReason
                  ? `${item.label}: ${item.unavailableReason}`
                  : item.label;

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    aria-disabled={item.disabled || undefined}
                    disabled={item.disabled}
                    title={item.disabled ? unavailableLabel : undefined}
                    onClick={item.onSelect}
                    className={cn(
                      "relative min-h-10 rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1",
                      isActive
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 active:bg-slate-200",
                      item.disabled && "cursor-not-allowed text-slate-400 opacity-70 hover:bg-transparent hover:text-slate-400",
                    )}
                  >
                    {item.label}
                    {item.disabled ? <span className="sr-only"> — {item.unavailableReason ?? "Indisponível"}</span> : null}
                  </button>
                );
              })}
            </div>
          </nav>
        ) : <div className="min-w-0 flex-1" />}
        {complementaryContent ? <div className="hidden shrink-0 md:block">{complementaryContent}</div> : null}
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
    </header>
  );
}
