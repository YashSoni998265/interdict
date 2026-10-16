import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatCount, formatMs } from '@/lib/format';
import { CATEGORY_TEXT, METRICS, type MetricId } from '@/lib/numberSources';

import { Tip } from './ui/tooltip';

export interface NumProps {
  metric: MetricId;
  value: number;
  format?: 'count' | 'ms' | 'decimal' | 'usd';
  /** A lower bound (truncated enumeration): rendered with "≥". */
  truncated?: boolean;
  /** Extra context for the tooltip, e.g. which query or revision. */
  detail?: ReactNode;
  /** Hide the dotted underline (large stat figures); the tooltip stays. */
  plain?: boolean;
  suffix?: ReactNode;
  className?: string;
}

function formatValue(value: number, format: NumProps['format']): string {
  switch (format) {
    case 'ms':
      return formatMs(value);
    case 'decimal':
      return value.toFixed(1);
    case 'usd':
      return `$${value.toFixed(value < 1 ? 3 : 2)}`;
    case 'count':
    case undefined:
      return formatCount(value);
  }
}

/**
 * Every number on screen goes through here, so each one says where it came from (§13.5): the
 * source category and formula appear on hover and on keyboard focus.
 */
export function Num({ metric, value, format = 'count', truncated = false, detail, plain = false, suffix, className }: NumProps) {
  const source = METRICS[metric];
  const text = `${truncated ? '≥ ' : ''}${formatValue(value, format)}`;
  return (
    <Tip
      content={
        <div className="space-y-1" data-testid="num-source">
          <div className="font-mono text-2xs tracking-tight text-fg-muted">
            {source.category}
            {'qualifier' in source && source.qualifier ? ` · ${source.qualifier}` : ''}
          </div>
          <div className="text-2xs text-fg-subtle">{CATEGORY_TEXT[source.category]}</div>
          <div>{source.formula}</div>
          {truncated ? <div className="text-yellow-300">Truncated: the true count is at least this.</div> : null}
          {detail ? <div className="border-t border-line pt-1 text-fg-muted">{detail}</div> : null}
        </div>
      }
    >
      <button
        type="button"
        data-metric={metric}
        className={cn(
          'tabular inline cursor-help rounded-sm text-inherit',
          !plain && 'underline decoration-fg-subtle/45 decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-fg-muted',
          className,
        )}
      >
        {text}
        {suffix}
      </button>
    </Tip>
  );
}
