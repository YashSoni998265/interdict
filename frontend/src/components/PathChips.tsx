import { ArrowRight, Database, Globe } from 'lucide-react';

import { cn } from '@/lib/cn';
import { INTERNET_ID, nodeLabel } from '@/lib/format';
import { TONE_CLASS, type Tone } from '@/lib/status';

/** A path as chips: Internet → pods → crown jewel. */
export function PathChips({
  path,
  tone,
  className,
  size = 'sm',
}: {
  path: readonly string[];
  tone?: Tone;
  className?: string;
  size?: 'xs' | 'sm';
}) {
  const t = tone ? TONE_CLASS[tone] : null;
  const startsAtInternet = path[0] === INTERNET_ID;
  return (
    <ol
      className={cn('flex flex-wrap items-center gap-1', className)}
      aria-label={`Path: ${path.map(nodeLabel).join(', then ')}`}
    >
      {path.map((node, index) => {
        const first = index === 0 && startsAtInternet;
        const last = index === path.length - 1 && startsAtInternet;
        return (
          <li key={`${node}-${index}`} className="flex items-center gap-1">
            {index > 0 ? <ArrowRight className="size-3 shrink-0 text-fg-subtle" aria-hidden /> : null}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded border font-mono',
                size === 'xs' ? 'px-1 py-0 text-[10.5px]' : 'px-1.5 py-px text-[11.5px]',
                t ? [t.border, t.text, 'bg-canvas'] : 'border-line bg-canvas text-fg',
                last && 'font-medium',
              )}
            >
              {first ? <Globe className="size-3" aria-hidden /> : null}
              {last ? <Database className="size-3" aria-hidden /> : null}
              {nodeLabel(node)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
