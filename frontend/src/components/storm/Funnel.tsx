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
import './Funnel.css';

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
          className="proof__button"
        >
          <ScanSearch className="proof__icon" aria-hidden />
          Graph proof
        </button>
      }
    >
      <div className="proof__block">
        <div className="proof__block-2">{label}</div>
        <p className="proof__text">{info.how}</p>
        <QueryList
          queries={queries}
          empty="Derived from the chains and reachability above; no separate query."
        />
        <p className="proof__text-2">
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
    <div className={cn('branch', quiet ? 'branch--quiet' : [tone.border, tone.bg])}>
      <CornerDownRight className="branch__icon" aria-hidden />
      <div className="branch__block">
        <div className={cn('branch__row', tone.text)}>
          <StatusIcon name={descriptor.icon} />
          <Num metric="alertsPerClass" value={count} className="branch__num" />
          <span className="branch__label">alerts</span>
        </div>
        <div className="branch__block-2">{descriptor.label}</div>
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
    <div className="funnel">
      <ol className="funnel__list" aria-label="Triage funnel">
        {storm.funnel.map((stage, index) => {
          const info = STAGES[stage.stage];
          const alertUnit = index < 3;
          const tone = info.tone ? TONE_CLASS[info.tone] : null;
          return (
            <li
              key={stage.stage}
              className={cn(
                'funnel-2',
                tone ? tone.border : 'funnel--not-tone',
              )}
            >
              <div className="funnel__row">
                <span className={cn('funnel__label', tone ? tone.text : 'funnel__label--not-tone')}>
                  {info.label}
                </span>
                {tone ? <StatusIcon name="alert" className={tone.text} /> : null}
              </div>
              <div className="funnel__block">
                <Num metric={info.metric} value={stage.count} truncated={Boolean(stage.truncated)} plain />
              </div>
              <div className="funnel__block-2">{info.unit}</div>
              {alertUnit && total > 0 ? (
                <div className="funnel__block-3" aria-hidden>
                  <div
                    className={cn('funnel__block-4', tone ? tone.solid : 'funnel__block--not-tone')}
                    style={{ width: `${Math.max((stage.count / total) * 100, stage.count > 0 ? 1.5 : 0)}%` }}
                  />
                </div>
              ) : (
                <div className="funnel__block-5" aria-hidden />
              )}
              {stage.stage === 'clusters' && beyondBound > 0 ? (
                <div className="funnel__block-6">
                  incl. {beyondBound} beyond the 3-hop bound
                </div>
              ) : null}
              <div className="funnel__block-7">
                <Proof storm={storm} info={info} label={info.label} />
              </div>
              {index < storm.funnel.length - 1 ? (
                <ChevronRight
                  className="funnel__icon"
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="funnel__grid" aria-label="Branches that leave the funnel">
        <Branch status="NOT_ACTIONABLE" count={storm.counts.NOT_ACTIONABLE} />
        <Branch status="TRIAGE_INCONCLUSIVE" count={inconclusive}>
          <div className="funnel__block-2">
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
