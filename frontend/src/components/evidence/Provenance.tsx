import { CircleCheck, CircleHelp, Clock } from 'lucide-react';

import type { ProvenanceView } from '@/api/types';
import { cn } from '@/lib/cn';
import { formatUtc } from '@/lib/format';
import './Provenance.css';

const FRESHNESS = {
  fresh: { icon: CircleCheck, label: 'fresh', className: 'provenance__freshness--fresh' },
  stale: { icon: Clock, label: 'stale', className: 'provenance__freshness--stale' },
  unverified: { icon: CircleHelp, label: 'unverified', className: 'provenance__freshness--unverified' },
} as const;

/** evidence_source, observed_at, valid_until and verified for each evidence edge (§6.4). */
export function ProvenanceList({ items }: { items: readonly ProvenanceView[] }) {
  return (
    <ul className="provenance-list">
      {items.map((p) => {
        const freshness = FRESHNESS[p.freshness] ?? FRESHNESS.unverified;
        const Icon = freshness.icon;
        return (
          <li key={p.edge_id} className="provenance-list-2">
            <div className="provenance-list__row">
              <Icon className={cn('provenance-list__icon', freshness.className)} aria-hidden />
              <span className="provenance-list__label">{p.edge_id}</span>
              <span className={cn('provenance-list__label-2', freshness.className)}>{freshness.label}</span>
            </div>
            <dl className="provenance-list__details">
              <dt className="provenance-list__term">source</dt>
              <dd className="provenance-list__value">{p.evidence_source ?? 'missing'}</dd>
              <dt className="provenance-list__term">observed</dt>
              <dd>{formatUtc(p.observed_at)}</dd>
              <dt className="provenance-list__term">valid until</dt>
              <dd className={cn(p.freshness === 'stale' && 'provenance-list__value--stale')}>{formatUtc(p.valid_until)}</dd>
              <dt className="provenance-list__term">verified</dt>
              <dd>{p.verified === true ? 'yes' : p.verified === false ? 'no' : 'not recorded'}</dd>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
