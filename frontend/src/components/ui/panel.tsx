import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import './panel.css';

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
    <Component className={cn('panel', className)} {...props}>
      {title || actions ? (
        <header className="panel__header">
          <div className="panel__block">
            {title ? <Heading className="panel__heading">{title}</Heading> : null}
            {subtitle ? <div className="panel__block-2">{subtitle}</div> : null}
          </div>
          {actions ? <div className="panel__row">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn('panel__block-3', bodyClassName)}>{children}</div>
    </Component>
  );
}

/** Label + value rows ("dl"), used for certificate and system facts. */
export function Facts({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('facts', className)}>
      {items.map((item, index) => (
        <div key={index} className="facts-2">
          <dt className="facts__term">{item.label}</dt>
          <dd className="facts__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('section-label', className)}>{children}</div>;
}
