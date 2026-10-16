import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { TONE_CLASS, type Tone } from '@/lib/status';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  mono?: boolean;
  /** Violet dashed outline: marks a proposed (candidate) change. */
  dashed?: boolean;
}

/** A small label chip. Tone colours only ever repeat a meaning the text already states. */
export function Tag({ tone = 'neutral', mono = false, dashed = false, className, ...props }: TagProps) {
  const t = TONE_CLASS[tone];
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-px text-2xs font-medium leading-4',
        tone === 'neutral' ? 'border-line bg-elevated text-fg-muted' : [t.text, t.bg, t.border],
        dashed && 'border-dashed',
        mono && 'font-mono font-normal tracking-tight',
        className,
      )}
      {...props}
    />
  );
}
