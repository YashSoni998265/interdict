import { ArrowRight, Database, Telescope } from 'lucide-react';
import { Link } from 'react-router-dom';

import { usePlanPreview } from '@/api/queries';
import type { ClusterView, StormView } from '@/api/types';
import { useClusterAnalysis } from '@/app/hooks';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/format';
import { isEmptyPlan } from '@/lib/plan';
import { ROLE } from '@/lib/status';

import { Num } from '../Num';
import { OutcomeBadge } from '../OutcomeBadge';
import { PathChips } from '../PathChips';
import { StatusBadge } from '../StatusBadge';
import { ErrorState } from '../states';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/misc';
import { Tag } from '../ui/tag';
import { Tip } from '../ui/tooltip';
import './ClusterCard.css';

function PlanLine({ cluster }: { cluster: ClusterView }) {
  const plan = usePlanPreview(cluster.id);
  if (plan.isPending) {
    return (
      <div className="plan-line" role="status">
        <Skeleton className="plan-line__skeleton" />
        Computing the initial plan…
      </div>
    );
  }
  if (plan.error) {
    return <ErrorState compact error={plan.error} title="Plan status unavailable" onRetry={() => void plan.refetch()} />;
  }
  const report = plan.data;
  if (report.status === 'PLAN_FOUND' && isEmptyPlan(report.plan) && report.chains.length === 0) {
    return (
      <p className="plan-line-2">
        <span className="plan-line__label">No chain within the planner’s 3-hop bound.</span> The path is longer, so
        the Path Hunter (no hop limit) finds it and the planner closes it.
      </p>
    );
  }
  if (report.status === 'PLAN_FOUND' && report.plan) {
    return (
      <div className="plan-line-3">
        <StatusBadge status="PLAN_FOUND" size="sm" />
        <span className="plan-line__label-2">
          <Num metric="planActions" value={report.plan.actions.length} className="plan-line__num" />{' '}
          {plural(report.plan.actions.length, 'action')}
        </span>
        <StatusBadge status={report.plan.impact_status} knownBroken={report.plan.known_broken.length} size="sm" />
      </div>
    );
  }
  return (
    <StatusBadge
      status={report.status}
      reason={report.no_plan_reason ?? report.inconclusive_reason}
      size="sm"
    />
  );
}

function Outcome({ clusterId }: { clusterId: string }) {
  const analysis = useClusterAnalysis(clusterId);
  const hunt = analysis.hunt;
  if (!hunt) return null;
  return (
    <div className="outcome">
      <span className="outcome__label">This session:</span>
      <OutcomeBadge hunt={hunt} size="sm" />
    </div>
  );
}

export function ClusterCard({ cluster, storm }: { cluster: ClusterView; storm: StormView }) {
  const hops = Math.max(cluster.witness_path.length - 3, 0);
  return (
    <article
      className={cn(
        'cluster-card',
        cluster.beyond_bound ? 'cluster-card--beyond-bound' : 'cluster-card--not-beyond-bound',
      )}
      aria-labelledby={`cluster-${cluster.id}`}
    >
      <div className="cluster-card__block">
        <div className="cluster-card__row">
          <Database className="cluster-card__icon" aria-hidden />
          <div className="cluster-card__block-2">
            <h3 id={`cluster-${cluster.id}`} className="cluster-card__title">
              {cluster.target}
            </h3>
            <div className="cluster-card__block-3">
              crown jewel · via <span className="cluster-card__label">{cluster.entry_ingress}</span>
            </div>
          </div>
          {cluster.beyond_bound ? (
            <Tip
              content={
                <div className="cluster-card__block-4">
                  <div className="cluster-card__block-5">CALCULATED_GRAPH</div>
                  <div>
                    {hops} LATERAL steps on the witness path, more than the planner enumerates (3). Triage still finds it
                    by reachability, and the Path Hunter verifies it without a hop limit.
                  </div>
                </div>
              }
            >
              <button type="button" className="cluster-card__button">
                <Tag tone="orange">
                  <Telescope className="cluster-card__icon-2" aria-hidden />
                  Deep: {hops} lateral hops
                </Tag>
              </button>
            </Tip>
          ) : null}
        </div>

        <PathChips path={cluster.witness_path} tone="red" size="xs" />

        <dl className="cluster-card__details">
          <div className="cluster-card__box">
            <dt className="cluster-card__term">Chains ≤ 3 hops</dt>
            <dd className="cluster-card__value">
              <Num
                metric="clusterChains"
                value={cluster.chain_ids.length}
                truncated={storm.chain_enumeration_truncated}
              />
            </dd>
          </div>
          <div className="cluster-card__box">
            <dt className="cluster-card__term">Workloads</dt>
            <dd className="cluster-card__value">
              <Num metric="clusterWorkloads" value={cluster.workloads.length} />
            </dd>
          </div>
        </dl>

        <ul className="cluster-card__list" aria-label="Workload roles">
          {cluster.workloads.map((pod) => (
            <li key={pod} className="cluster-card-2">
              <span className="cluster-card__label-2">{pod}</span>
              {(storm.roles[pod] ?? []).map((role) => (
                <Tag key={role} title={ROLE[role].description}>
                  {ROLE[role].label}
                </Tag>
              ))}
            </li>
          ))}
        </ul>
      </div>

      <div className="cluster-card__block-6">
        <PlanLine cluster={cluster} />
        <Outcome clusterId={cluster.id} />
      </div>
      <div className="cluster-card__block-7">
        <Button asChild variant="primary" size="sm" className="cluster-card__button-2">
          <Link to={`/clusters/${cluster.id}`}>
            Investigate
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </article>
  );
}
