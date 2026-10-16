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

function PlanLine({ cluster }: { cluster: ClusterView }) {
  const plan = usePlanPreview(cluster.id);
  if (plan.isPending) {
    return (
      <div className="flex items-center gap-2 text-2xs text-fg-subtle" role="status">
        <Skeleton className="h-4 w-20" />
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
      <p className="text-2xs leading-4 text-fg-muted">
        <span className="font-medium text-fg">No chain within the planner’s 3-hop bound.</span> The path is longer, so
        the Path Hunter (no hop limit) finds it and the planner closes it.
      </p>
    );
  }
  if (report.status === 'PLAN_FOUND' && report.plan) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status="PLAN_FOUND" size="sm" />
        <span className="text-2xs text-fg-muted">
          <Num metric="planActions" value={report.plan.actions.length} className="text-fg" />{' '}
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-2xs text-fg-subtle">This session:</span>
      <OutcomeBadge hunt={hunt} size="sm" />
    </div>
  );
}

export function ClusterCard({ cluster, storm }: { cluster: ClusterView; storm: StormView }) {
  const hops = Math.max(cluster.witness_path.length - 3, 0);
  return (
    <article
      className={cn(
        'flex flex-col rounded-lg border bg-surface transition-colors hover:border-line-strong',
        cluster.beyond_bound ? 'border-dashed border-line-strong' : 'border-line',
      )}
      aria-labelledby={`cluster-${cluster.id}`}
    >
      <div className="space-y-3 px-4 pt-4">
        <div className="flex items-start gap-2">
          <Database className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <h3 id={`cluster-${cluster.id}`} className="truncate font-mono text-ui font-medium text-fg">
              {cluster.target}
            </h3>
            <div className="text-2xs text-fg-muted">
              crown jewel · via <span className="font-mono text-fg">{cluster.entry_ingress}</span>
            </div>
          </div>
          {cluster.beyond_bound ? (
            <Tip
              content={
                <div className="space-y-1">
                  <div className="font-mono text-2xs text-fg-muted">CALCULATED_GRAPH</div>
                  <div>
                    {hops} LATERAL steps on the witness path, more than the planner enumerates (3). Triage still finds it
                    by reachability, and the Path Hunter verifies it without a hop limit.
                  </div>
                </div>
              }
            >
              <button type="button" className="cursor-help rounded">
                <Tag tone="orange">
                  <Telescope className="size-3" aria-hidden />
                  Deep: {hops} lateral hops
                </Tag>
              </button>
            </Tip>
          ) : null}
        </div>

        <PathChips path={cluster.witness_path} tone="red" size="xs" />

        <dl className="grid grid-cols-2 gap-2 text-2xs">
          <div className="rounded-md border border-line bg-canvas px-2.5 py-1.5">
            <dt className="text-fg-subtle">Chains ≤ 3 hops</dt>
            <dd className="mt-0.5 text-ui font-semibold text-fg">
              <Num
                metric="clusterChains"
                value={cluster.chain_ids.length}
                truncated={storm.chain_enumeration_truncated}
              />
            </dd>
          </div>
          <div className="rounded-md border border-line bg-canvas px-2.5 py-1.5">
            <dt className="text-fg-subtle">Workloads</dt>
            <dd className="mt-0.5 text-ui font-semibold text-fg">
              <Num metric="clusterWorkloads" value={cluster.workloads.length} />
            </dd>
          </div>
        </dl>

        <ul className="space-y-1" aria-label="Workload roles">
          {cluster.workloads.map((pod) => (
            <li key={pod} className="flex flex-wrap items-center gap-1 text-2xs">
              <span className="font-mono text-fg-muted">{pod}</span>
              {(storm.roles[pod] ?? []).map((role) => (
                <Tag key={role} title={ROLE[role].description}>
                  {ROLE[role].label}
                </Tag>
              ))}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 space-y-2 border-t border-line px-4 py-3">
        <PlanLine cluster={cluster} />
        <Outcome clusterId={cluster.id} />
      </div>
      <div className="mt-auto px-4 pb-4">
        <Button asChild variant="primary" size="sm" className="w-full">
          <Link to={`/clusters/${cluster.id}`}>
            Investigate
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </article>
  );
}
