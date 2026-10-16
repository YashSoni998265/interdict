import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function Pane({
  id,
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn('flex min-h-0 min-w-0 flex-col bg-pane', className)}>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-ui font-semibold text-fg">
            {title}
          </h2>
          {subtitle ? <p className="text-2xs text-fg-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
