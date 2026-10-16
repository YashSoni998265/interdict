import { CircleCheck, CircleHelp, Clock } from 'lucide-react';

import type { ProvenanceView } from '@/api/types';
import { cn } from '@/lib/cn';
import { formatUtc } from '@/lib/format';

const FRESHNESS = {
  fresh: { icon: CircleCheck, label: 'fresh', className: 'text-fg-muted' },
  stale: { icon: Clock, label: 'stale', className: 'text-yellow-300' },
  unverified: { icon: CircleHelp, label: 'unverified', className: 'text-yellow-300' },
} as const;

/** evidence_source, observed_at, valid_until and verified for each evidence edge (§6.4). */
export function ProvenanceList({ items }: { items: readonly ProvenanceView[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((p) => {
        const freshness = FRESHNESS[p.freshness] ?? FRESHNESS.unverified;
        const Icon = freshness.icon;
        return (
          <li key={p.edge_id} className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-2xs">
            <div className="flex items-start gap-1.5">
              <Icon className={cn('mt-px size-3 shrink-0', freshness.className)} aria-hidden />
              <span className="min-w-0 break-all font-mono text-[11px] text-fg">{p.edge_id}</span>
              <span className={cn('ml-auto shrink-0 font-medium', freshness.className)}>{freshness.label}</span>
            </div>
            <dl className="mt-1 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-px text-fg-muted">
              <dt className="text-fg-subtle">source</dt>
              <dd className="font-mono text-[10.5px]">{p.evidence_source ?? 'missing'}</dd>
              <dt className="text-fg-subtle">observed</dt>
              <dd>{formatUtc(p.observed_at)}</dd>
              <dt className="text-fg-subtle">valid until</dt>
              <dd className={cn(p.freshness === 'stale' && 'text-yellow-300')}>{formatUtc(p.valid_until)}</dd>
              <dt className="text-fg-subtle">verified</dt>
              <dd>{p.verified === true ? 'yes' : p.verified === false ? 'no' : 'not recorded'}</dd>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
