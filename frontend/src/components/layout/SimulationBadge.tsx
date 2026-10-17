import { FlaskConical } from 'lucide-react';

import { cn } from '@/lib/cn';

import { Tip } from '../ui/tooltip';
import './SimulationBadge.css';

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
          'simulation-badge__button',
          className,
        )}
      >
        <FlaskConical className="simulation-badge__icon" aria-hidden />
        <span className="simulation-badge__label">Simulation only: no infrastructure is changed</span>
        <span className="simulation-badge__label-2" aria-hidden>
          Simulation only
        </span>
        <span className="sr-only simulation-badge__label-2">: no infrastructure is changed</span>
      </button>
    </Tip>
  );
}
