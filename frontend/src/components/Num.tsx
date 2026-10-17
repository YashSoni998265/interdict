import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatCount, formatMs } from '@/lib/format';
import { CATEGORY_TEXT, METRICS, type MetricId } from '@/lib/numberSources';

import { Tip } from './ui/tooltip';
import './Num.css';

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
        <div className="num__block" data-testid="num-source">
          <div className="num__block-2">
            {source.category}
            {'qualifier' in source && source.qualifier ? ` · ${source.qualifier}` : ''}
          </div>
          <div className="num__block-3">{CATEGORY_TEXT[source.category]}</div>
          <div>{source.formula}</div>
          {truncated ? <div className="num__block-4">Truncated: the true count is at least this.</div> : null}
          {detail ? <div className="num__block-5">{detail}</div> : null}
        </div>
      }
    >
      <button
        type="button"
        data-metric={metric}
        className={cn(
          'tabular num__button',
          !plain && 'num__button--not-plain',
          className,
        )}
      >
        {text}
        {suffix}
      </button>
    </Tip>
  );
}
