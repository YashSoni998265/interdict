import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { TONE_CLASS, type Tone } from '@/lib/status';
import './tag.css';

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
        'tag',
        tone === 'neutral' ? 'tag--neutral' : [t.text, t.bg, t.border],
        dashed && 'tag--dashed',
        mono && 'tag--mono',
        className,
      )}
      {...props}
    />
  );
}
