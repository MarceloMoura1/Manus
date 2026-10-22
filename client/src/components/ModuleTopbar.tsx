import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ModuleTopbarItem = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  badge?: ReactNode;
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
    <header className="w-full shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/90 backdrop-blur-md text-slate-800 dark:text-slate-200 transition-colors">
      <div className="flex min-h-14 w-full min-w-0 items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex shrink-0 items-center justify-start min-w-10">
          {leading ? leading : null}
        </div>
        {visibleItems.length > 0 ? (
          <nav
            aria-label={ariaLabel}
            className="flex-1 flex items-center justify-center min-w-0 overflow-x-auto scrollbar-hide no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-1"
          >
            <div className="flex items-center mx-auto shrink-0 min-w-max">
              {visibleItems.map((item, index) => {
                const isActive = item.id === activeItemId;
                const unavailableLabel = item.unavailableReason
                  ? `${item.label}: ${item.unavailableReason}`
                  : item.label;
                const Icon = item.icon;
                const isLast = index === visibleItems.length - 1;

                return (
                  <div key={item.id} className="flex items-center">
                    <button
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      aria-disabled={item.disabled || undefined}
                      disabled={item.disabled}
                      title={item.disabled ? unavailableLabel : undefined}
                      onClick={item.onSelect}
                      className={cn(
                        "group relative inline-flex items-center gap-2 whitespace-nowrap text-xs md:text-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1",
                        isActive
                          ? "my-1 mx-1.5 rounded-lg px-3.5 py-1.5 font-semibold text-white bg-slate-900 border border-slate-800 shadow-sm dark:border-purple-500/40 dark:shadow-[0_0_14px_rgba(168,85,247,0.25)] dark:ring-1 dark:ring-purple-500/20"
                          : "px-4 py-2 font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/60 dark:hover:bg-slate-900/40 rounded-md",
                        item.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-slate-400 dark:hover:bg-transparent dark:hover:text-slate-500"
                      )}
                    >
                      {Icon ? (
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0 transition-colors",
                            isActive
                              ? "text-purple-300 dark:text-purple-400"
                              : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"
                          )}
                        />
                      ) : null}
                      <span>{item.label}</span>
                      {item.badge ? item.badge : null}
                      {item.disabled ? <span className="sr-only"> — {item.unavailableReason ?? "Indisponível"}</span> : null}
                    </button>
                    {!isLast && (
                      <span
                        className="h-4 w-px bg-slate-200 dark:bg-slate-800/80 mx-0.5 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </nav>
        ) : <div className="min-w-0 flex-1" />}
        <div className="flex shrink-0 items-center justify-end min-w-10 gap-1">
          {complementaryContent ? <div className="hidden shrink-0 md:block">{complementaryContent}</div> : null}
          {actions ? actions : null}
        </div>
      </div>
    </header>
  );
}
