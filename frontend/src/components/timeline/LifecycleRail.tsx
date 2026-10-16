import { Check } from 'lucide-react';

import { cn } from '@/lib/cn';
import { railStates, type DerivedInvestigation } from '@/lib/investigation';
import { lifecycleLabel } from '@/lib/status';

import { StatusBadge } from '../StatusBadge';

/** Live lifecycle progress: what the run is doing now, never a blank spinner (§13.6). */
export function LifecycleRail({
  derived,
  active,
  terminal,
}: {
  derived: DerivedInvestigation | null;
  active: boolean;
  /** How to show the run's final status now (containment only while the certificate is current). */
  terminal: { status: string; hasCertificate: boolean } | null;
}) {
  const seen = derived?.lifecycle.map((e) => e.state) ?? [];
  const finished = Boolean(derived?.done);
  const current = active && !finished ? (derived?.currentState ?? null) : null;

  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5" aria-label="Investigation progress">
      {railStates(seen).map((state, index) => {
        const isCurrent = state === current;
        const done = seen.includes(state) && !isCurrent;
        const skipped = finished && !seen.includes(state);
        return (
          <li key={state} className="flex items-center gap-1" aria-current={isCurrent ? 'step' : undefined}>
            {index > 0 ? <span className="h-px w-3 bg-line" aria-hidden /> : null}
            <span
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10.5px] font-medium',
                isCurrent && 'border-accent/60 bg-accent/10 text-fg',
                done && 'border-line-strong bg-elevated text-fg',
                !done && !isCurrent && !skipped && 'border-line text-fg-subtle',
                skipped && 'border-dashed border-line text-fg-subtle line-through decoration-fg-subtle/60',
              )}
            >
              {isCurrent ? <span className="size-1.5 animate-pulse-soft rounded-full bg-accent" aria-hidden /> : null}
              {done ? <Check className="size-3" aria-hidden /> : null}
              {lifecycleLabel(state)}
              {skipped ? <span className="sr-only"> (skipped)</span> : null}
              {isCurrent ? <span className="sr-only"> (in progress)</span> : null}
            </span>
          </li>
        );
      })}
      {derived?.done && terminal ? (
        <li className="flex items-center gap-1">
          <span className="h-px w-3 bg-line" aria-hidden />
          <StatusBadge status={terminal.status} hasCertificate={terminal.hasCertificate} size="sm" />
        </li>
      ) : null}
    </ol>
  );
}
