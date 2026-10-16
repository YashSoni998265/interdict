import { ChevronRight, CornerDownRight, ScanSearch } from 'lucide-react';
import type { ReactNode } from 'react';

import type { FunnelStageName, StormView } from '@/api/types';
import { cn } from '@/lib/cn';
import type { MetricId } from '@/lib/numberSources';
import { describeStatus, reasonText, TONE_CLASS, type Tone } from '@/lib/status';

import { Num } from '../Num';
import { QueryList } from '../QueryList';
import { StatusIcon } from '../StatusBadge';
import { Popover } from '../ui/popover';

interface StageInfo {
  label: string;
  unit: string;
  metric: MetricId;
  templates: string[];
  how: string;
  tone?: Tone;
}

const STAGES: Record<FunnelStageName, StageInfo> = {
  alerts: {
    label: 'Alerts',
    unit: 'in the storm',
    metric: 'alertsTotal',
    templates: ['evidence-alerts'],
    how: 'Every alert in the storm, one per (workload, finding) plus duplicate-scanner alerts.',
  },
  actionable: {
    label: 'Actionable',
    unit: 'alerts',
    metric: 'alertsActionable',
    templates: ['evidence-vulnerability'],
    how: 'The referenced vulnerability is ACTIVE and network-exploitable (NETWORK or ADJACENT vector).',
  },
  on_attack_path: {
    label: 'On an attack path',
    unit: 'alerts',
    metric: 'alertsPerClass',
    templates: ['attack-build', 'attack-export', 'attack-forward-bfs'],
    how: 'The alert’s workload is reachable from the Internet and can reach a crown jewel over ATTACK_STEP edges (exact and unbounded).',
    tone: 'red',
  },
  workloads_on_path: {
    label: 'Workloads',
    unit: 'on attack paths',
    metric: 'workloadsOnPath',
    templates: ['attack-forward-bfs', 'attack-export'],
    how: 'Distinct workloads in Forward(Internet) ∩ Backward(crown jewels).',
  },
  chains_within_bound: {
    label: 'Chains',
    unit: 'at most 3 lateral hops',
    metric: 'chainsBounded',
    templates: ['chains-enumerate'],
    how: 'Bounded chains enumerated over base evidence (method E, Q-E1); the planner works on these.',
  },
  clusters: {
    label: 'Clusters',
    unit: 'target × entry ingress',
    metric: 'clusters',
    templates: [],
    how: 'Workloads on paths grouped by (crown jewel, entry ingress). A cluster can lie beyond the planner’s 3-hop bound; the Path Hunter covers it.',
  },
};

function Proof({ storm, info, label }: { storm: StormView; info: StageInfo; label: string }) {
  const queries = storm.queries.filter((q) => info.templates.includes(q.template));
  return (
    <Popover
      label={`How "${label}" is computed`}
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded text-2xs font-medium text-fg-muted transition-colors hover:text-fg"
        >
          <ScanSearch className="size-3" aria-hidden />
          Graph proof
        </button>
      }
    >
      <div className="space-y-2.5">
        <div className="text-ui font-medium text-fg">{label}</div>
        <p className="text-2xs leading-4 text-fg-muted">{info.how}</p>
        <QueryList
          queries={queries}
          empty="Derived from the chains and reachability above; no separate query."
        />
        <p className="text-2xs text-fg-subtle">
          Storm {storm.storm_id} · revision {storm.revision} · parameterised templates only, never LLM-written Cypher.
        </p>
      </div>
    </Popover>
  );
}

function Branch({
  status,
  count,
  children,
}: {
  status: string;
  count: number;
  children?: ReactNode;
}) {
  const descriptor = describeStatus(status);
  const tone = TONE_CLASS[descriptor.tone];
  // A branch with no alerts stays visible but quiet; only a non-empty branch is tinted.
  const quiet = count === 0;
  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-2.5 py-2', quiet ? 'border-line bg-surface' : [tone.border, tone.bg])}>
      <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      <div className="min-w-0">
        <div className={cn('flex items-center gap-1.5 text-ui font-medium', tone.text)}>
          <StatusIcon name={descriptor.icon} />
          <Num metric="alertsPerClass" value={count} className="text-fg" />
          <span className="text-2xs font-normal text-fg-muted">alerts</span>
        </div>
        <div className="mt-0.5 text-2xs leading-4 text-fg-muted">{descriptor.label}</div>
        {children}
      </div>
    </div>
  );
}

/** Alerts → actionable → on a path → workloads → chains → clusters, with every branch visible. */
export function Funnel({ storm }: { storm: StormView }) {
  const total = storm.total_alerts;
  const beyondBound = storm.clusters.filter((c) => c.beyond_bound).length;
  const inconclusive = storm.counts.TRIAGE_INCONCLUSIVE;

  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Triage funnel">
        {storm.funnel.map((stage, index) => {
          const info = STAGES[stage.stage];
          const alertUnit = index < 3;
          const tone = info.tone ? TONE_CLASS[info.tone] : null;
          return (
            <li
              key={stage.stage}
              className={cn(
                'relative flex flex-col rounded-lg border bg-surface px-3 py-3',
                tone ? tone.border : 'border-line',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn('text-2xs font-medium uppercase tracking-[0.06em]', tone ? tone.text : 'text-fg-muted')}>
                  {info.label}
                </span>
                {tone ? <StatusIcon name="alert" className={tone.text} /> : null}
              </div>
              <div className="mt-1.5 text-[1.65rem] font-semibold leading-none tracking-tight text-fg">
                <Num metric={info.metric} value={stage.count} truncated={Boolean(stage.truncated)} plain />
              </div>
              <div className="mt-1 text-2xs text-fg-subtle">{info.unit}</div>
              {alertUnit && total > 0 ? (
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-elevated" aria-hidden>
                  <div
                    className={cn('h-full rounded-full', tone ? tone.solid : 'bg-fg-muted')}
                    style={{ width: `${Math.max((stage.count / total) * 100, stage.count > 0 ? 1.5 : 0)}%` }}
                  />
                </div>
              ) : (
                <div className="mt-2.5 h-1" aria-hidden />
              )}
              {stage.stage === 'clusters' && beyondBound > 0 ? (
                <div className="mt-2 text-2xs text-fg-muted">
                  incl. {beyondBound} beyond the 3-hop bound
                </div>
              ) : null}
              <div className="mt-auto pt-2.5">
                <Proof storm={storm} info={info} label={info.label} />
              </div>
              {index < storm.funnel.length - 1 ? (
                <ChevronRight
                  className="absolute -right-[11px] top-7 z-10 hidden size-3.5 rounded-full bg-canvas text-fg-subtle xl:block"
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="grid gap-2 sm:grid-cols-3" aria-label="Branches that leave the funnel">
        <Branch status="NOT_ACTIONABLE" count={storm.counts.NOT_ACTIONABLE} />
        <Branch status="TRIAGE_INCONCLUSIVE" count={inconclusive}>
          <div className="mt-1 text-2xs text-fg-subtle">
            {inconclusive === 0 && storm.complete
              ? 'None: every evidence tier was collected, fresh and verified.'
              : storm.issues.map((issue) => reasonText(issue.reason)).join('; ') || 'See the evidence issues above.'}
          </div>
        </Branch>
        <Branch status="NOT_ON_ATTACK_PATH" count={storm.counts.NOT_ON_ATTACK_PATH} />
      </div>
    </div>
  );
}
