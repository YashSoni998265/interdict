import { ArrowRight, Database, Globe } from 'lucide-react';

import { cn } from '@/lib/cn';
import { INTERNET_ID, nodeLabel } from '@/lib/format';
import { TONE_CLASS, type Tone } from '@/lib/status';
import './PathChips.css';

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
      className={cn('path-chips', className)}
      aria-label={`Path: ${path.map(nodeLabel).join(', then ')}`}
    >
      {path.map((node, index) => {
        const first = index === 0 && startsAtInternet;
        const last = index === path.length - 1 && startsAtInternet;
        return (
          <li key={`${node}-${index}`} className="path-chips-2">
            {index > 0 ? <ArrowRight className="path-chips__icon" aria-hidden /> : null}
            <span
              className={cn(
                'path-chips__chip',
                size === 'xs' ? 'path-chips__chip--xs' : 'path-chips__chip--not-xs',
                t ? [t.border, t.text, 'path-chips__chip--t'] : 'path-chips__chip--not-t',
                last && 'path-chips__chip--last',
              )}
            >
              {first ? <Globe className="path-chips__icon-2" aria-hidden /> : null}
              {last ? <Database className="path-chips__icon-2" aria-hidden /> : null}
              {nodeLabel(node)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
