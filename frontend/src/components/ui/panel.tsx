import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  /** Right side of the header. */
  actions?: ReactNode;
  /** Small text under the title. */
  subtitle?: ReactNode;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'article';
  headingLevel?: 2 | 3;
}

/** A bordered card with an optional header. */
export function Panel({
  title,
  actions,
  subtitle,
  className,
  bodyClassName,
  children,
  as: Component = 'section',
  headingLevel = 2,
  ...props
}: PanelProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Component className={cn('rounded-lg border border-line bg-surface', className)} {...props}>
      {title || actions ? (
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            {title ? <Heading className="text-ui font-semibold text-fg">{title}</Heading> : null}
            {subtitle ? <div className="mt-0.5 text-2xs text-fg-muted">{subtitle}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn('px-4 py-3', bodyClassName)}>{children}</div>
    </Component>
  );
}

/** Label + value rows ("dl"), used for certificate and system facts. */
export function Facts({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-ui', className)}>
      {items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="text-fg-muted">{item.label}</dt>
          <dd className="min-w-0 break-words text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('section-label', className)}>{children}</div>;
}
