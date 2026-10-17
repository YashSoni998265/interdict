import { Check } from 'lucide-react';

import { cn } from '@/lib/cn';
import { railStates, type DerivedInvestigation } from '@/lib/investigation';
import { lifecycleLabel } from '@/lib/status';

import { StatusBadge } from '../StatusBadge';
import './LifecycleRail.css';

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
    <ol className="lifecycle-rail" aria-label="Investigation progress">
      {railStates(seen).map((state, index) => {
        const isCurrent = state === current;
        const done = seen.includes(state) && !isCurrent;
        const skipped = finished && !seen.includes(state);
        return (
          <li key={state} className="lifecycle-rail-2" aria-current={isCurrent ? 'step' : undefined}>
            {index > 0 ? <span className="lifecycle-rail__label" aria-hidden /> : null}
            <span
              className={cn(
                'lifecycle-rail__chip',
                isCurrent && 'lifecycle-rail__chip--current',
                done && 'lifecycle-rail__chip--done',
                !done && !isCurrent && !skipped && 'lifecycle-rail__chip--not-done',
                skipped && 'lifecycle-rail__chip--skipped',
              )}
            >
              {isCurrent ? <span className="lifecycle-rail__dot" aria-hidden /> : null}
              {done ? <Check className="lifecycle-rail__icon" aria-hidden /> : null}
              {lifecycleLabel(state)}
              {skipped ? <span className="sr-only"> (skipped)</span> : null}
              {isCurrent ? <span className="sr-only"> (in progress)</span> : null}
            </span>
          </li>
        );
      })}
      {derived?.done && terminal ? (
        <li className="lifecycle-rail__item">
          <span className="lifecycle-rail__label" aria-hidden />
          <StatusBadge status={terminal.status} hasCertificate={terminal.hasCertificate} size="sm" />
        </li>
      ) : null}
    </ol>
  );
}
