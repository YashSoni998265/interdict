import { FlaskConical } from 'lucide-react';

import { cn } from '@/lib/cn';

import { Tip } from '../ui/tooltip';

/** Persistent LIVE-disabled badge (§13.6): shown on every screen. */
export function SimulationBadge({ className }: { className?: string }) {
  return (
    <Tip
      content="Interdict only simulates. Policies are applied to copies of a synthetic graph; LIVE execution is disabled, so no real infrastructure is ever changed."
      side="bottom"
    >
      <button
        type="button"
        className={cn(
          'inline-flex h-7 cursor-help items-center gap-1.5 rounded-md border border-line-strong bg-elevated px-2 text-2xs font-medium text-fg',
          className,
        )}
      >
        <FlaskConical className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Simulation only: no infrastructure is changed</span>
        <span className="sm:hidden" aria-hidden>
          Simulation only
        </span>
        <span className="sr-only sm:hidden">: no infrastructure is changed</span>
      </button>
    </Tip>
  );
}
