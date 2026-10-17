import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import './Pane.css';

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
    <section aria-labelledby={id} className={cn('pane', className)}>
      <header className="pane__header">
        <div className="pane__block">
          <h2 id={id} className="pane__title">
            {title}
          </h2>
          {subtitle ? <p className="pane__text">{subtitle}</p> : null}
        </div>
        {actions ? <div className="pane__row">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
