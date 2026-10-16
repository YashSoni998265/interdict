import { Quote } from 'lucide-react';

import type { UntrustedText as UntrustedTextValue } from '@/api/types';
import { cn } from '@/lib/cn';

export interface UntrustedTextProps {
  value: UntrustedTextValue | string | null | undefined;
  className?: string;
  /** Clamp to one line (full text stays available to screen readers and on hover). */
  truncate?: boolean;
}

function textOf(value: UntrustedTextProps['value']): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  const raw: unknown = value.untrusted_text;
  if (raw === null || raw === undefined) return null;
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

/**
 * Text that came from the graph (alert titles, scanner output). It is shown as inert plain
 * text with an "untrusted" marker and is never parsed as markup or as an instruction (§10.8).
 * React escapes it; nothing in this app renders raw HTML (enforced by an ESLint rule).
 */
export function UntrustedText({ value, className, truncate = false }: UntrustedTextProps) {
  const text = textOf(value);
  if (text === null) return <span className="text-fg-subtle">no title recorded</span>;
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-start gap-1.5', className)} data-untrusted="true">
      <span
        className="mt-[3px] inline-flex shrink-0 items-center rounded-sm border border-dashed border-line-strong px-0.5 text-fg-subtle"
        aria-hidden
      >
        <Quote className="size-2.5" />
      </span>
      <span className="sr-only">Untrusted scanner text: </span>
      <span className={cn('min-w-0 break-words font-mono text-[12px] text-fg-muted', truncate && 'truncate')} title={truncate ? text : undefined}>
        {text}
      </span>
    </span>
  );
}
