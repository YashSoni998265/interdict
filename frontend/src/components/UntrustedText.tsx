import { Quote } from 'lucide-react';

import type { UntrustedText as UntrustedTextValue } from '@/api/types';
import { cn } from '@/lib/cn';
import './UntrustedText.css';

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
  if (text === null) return <span className="untrusted-text">no title recorded</span>;
  return (
    <span className={cn('untrusted-text-2', className)} data-untrusted="true">
      <span
        className="untrusted-text__chip"
        aria-hidden
      >
        <Quote className="untrusted-text__icon" />
      </span>
      <span className="sr-only">Untrusted scanner text: </span>
      <span className={cn('untrusted-text__label', truncate && 'untrusted-text__label--truncate')} title={truncate ? text : undefined}>
        {text}
      </span>
    </span>
  );
}
