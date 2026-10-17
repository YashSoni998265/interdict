import { FlaskConical } from 'lucide-react';

import { useSession } from '@/api/queries';
import { cn } from '@/lib/cn';

import { Tip } from '../ui/tooltip';
import './SimulationBadge.css';

/** Persistent LIVE-disabled badge (§13.6): shown on every screen. */
export function SimulationBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  const session = useSession();
  const seed = session.data?.session.seed;
  return (
    <Tip
      content={
        <div className="simulation-badge__tip">
          <p>
            Interdict only simulates. Policies are applied to copies of a synthetic graph; LIVE execution is disabled, so
            no real infrastructure is ever changed.
          </p>
          <p className="simulation-badge__tip-muted">
            Synthetic data{seed ? `, seed ${seed}` : ''}: shaped on Google’s Online Boutique (Apache-2.0), with fake
            vulnerability IDs (DEMO-CVE-…).
          </p>
        </div>
      }
      side="bottom"
    >
      <button type="button" className={cn('simulation-badge', className)}>
        <FlaskConical className="simulation-badge__icon" aria-hidden />
        {compact ? (
          <>
            <span aria-hidden>Simulation only</span>
            <span className="sr-only">Simulation only: no infrastructure is changed</span>
          </>
        ) : (
          <span>Simulation only: no infrastructure is changed</span>
        )}
      </button>
    </Tip>
  );
}
