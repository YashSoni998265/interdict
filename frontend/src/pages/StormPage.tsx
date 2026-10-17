import { CircleCheck, Clock, Quote, RefreshCw, Scale } from 'lucide-react';
import { useState } from 'react';

import { useStorm } from '@/api/queries';
import type { StormView } from '@/api/types';
import { useApi, useSandboxState } from '@/app/services';
import { Footer } from '@/components/layout/Footer';
import { Num } from '@/components/Num';
import { StatusBadge, StatusIcon } from '@/components/StatusBadge';
import { AlertTable } from '@/components/storm/AlertTable';
import { ClusterCard } from '@/components/storm/ClusterCard';
import { Funnel } from '@/components/storm/Funnel';
import { ScenarioCard } from '@/components/storm/ScenarioCard';
import { Banner, EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { formatUtc } from '@/lib/format';
import { describeCollection, reasonText } from '@/lib/status';
import { restraintExample } from '@/lib/storm';
import './StormPage.css';

function EvidenceStatus({ storm }: { storm: StormView }) {
  const tiers = Object.entries(storm.tiers);
  return (
    <Popover
      label="Evidence tiers behind this storm report"
      trigger={
        <button
          type="button"
          className={cn(
            'evidence-status__button',
            storm.complete ? 'evidence-status__button--complete' : 'evidence-status__button--not-complete',
          )}
        >
          {storm.complete ? <CircleCheck className="evidence-status__icon" aria-hidden /> : <StatusIcon name="question" />}
          {storm.complete ? 'Evidence complete: every tier fresh and verified' : 'Evidence incomplete'}
        </button>
      }
    >
      <div className="evidence-status__block">
        <div className="evidence-status__block-2">Scope completeness (§6.6)</div>
        <table className="evidence-status__table">
          <thead className="evidence-status__head">
            <tr>
              <th scope="col" className="evidence-status__heading-cell">Tier</th>
              <th scope="col" className="evidence-status__heading-cell">Status</th>
              <th scope="col" className="evidence-status__heading-cell-2">Rows</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map(([name, tier]) => {
              const mark = describeCollection(tier.status);
              return (
                <tr key={name} className="evidence-status">
                  <td className="evidence-status__cell">{name}</td>
                  <td className={cn('evidence-status__cell-2', mark.tone === 'yellow' ? 'evidence-status__cell--yellow' : 'evidence-status__cell--not-yellow')}>
                    {tier.status}
                    {tier.stale ? (
                      <>
                        {' · '}
                        <Num metric="staleItems" value={tier.stale} plain /> stale
                      </>
                    ) : null}
                    {tier.unverified ? (
                      <>
                        {' · '}
                        <Num metric="unverifiedItems" value={tier.unverified} plain /> unverified
                      </>
                    ) : null}
                  </td>
                  <td className="evidence-status__cell-3">
                    <Num metric="tierRows" value={tier.rows} plain />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="evidence-status__text">
          COLLECTED_EMPTY is a verified absence (for example no identity rows), not missing data.
        </p>
      </div>
    </Popover>
  );
}

function GraphStats({ storm }: { storm: StormView }) {
  const stats = storm.graph_stats;
  const steps = storm.attack_steps;
  const items = [
    { label: 'Pods', node: <Num metric="graphPods" value={stats.pods} /> },
    { label: 'Crown jewels', node: <Num metric="crownJewels" value={stats.crown_jewels.length} /> },
    { label: 'Observed flows', node: <Num metric="graphFlows" value={stats.observed_flows} /> },
    { label: 'Vulnerability findings', node: <Num metric="graphFindings" value={stats.vulnerability_findings} /> },
    ...(steps
      ? [
          {
            label: 'ATTACK_STEP edges',
            node: (
              <Num
                metric="attackSteps"
                value={steps.total}
                detail={`${steps.entry} ENTRY · ${steps.lateral} LATERAL · ${steps.goal} GOAL`}
              />
            ),
          },
        ]
      : []),
  ];
  return (
    <dl className="graph-stats">
      {items.map((item) => (
        <div key={item.label} className="graph-stats-2">
          <dt>{item.label}</dt>
          <dd className="graph-stats__value">{item.node}</dd>
        </div>
      ))}
    </dl>
  );
}

function Restraint({ storm, onShow }: { storm: StormView; onShow: (cve: string) => void }) {
  const example = restraintExample(storm.alerts);
  if (!example) return null;
  const reasonFor = (pod: string) => storm.alerts?.find((a) => a.pod === pod && a.cve_id === example.cve)?.reason;
  return (
    <section className="restraint" aria-labelledby="restraint">
      <div className="restraint__row">
        <Scale className="restraint__icon" aria-hidden />
        <div className="restraint__block">
          <h2 id="restraint" className="restraint__title">
            Same vulnerability, different verdicts
          </h2>
          <p className="restraint__text">
            <span className="restraint__label">{example.cve}</span> is reported on several workloads. The graph, not the
            CVE, decides what matters.
          </p>
        </div>
        <Button size="xs" variant="ghost" onClick={() => onShow(example.cve)}>
          Show these alerts
        </Button>
      </div>
      <ul className="restraint__list">
        {example.onPath.map((pod) => (
          <li key={pod} className="restraint-2">
            <div className="restraint__block-2">{pod}</div>
            <StatusBadge status="ON_ATTACK_PATH" size="sm" className="restraint__status-badge" />
            <p className="restraint__text-2">{reasonFor(pod)}</p>
          </li>
        ))}
        {example.notOnPath.map((pod) => (
          <li key={pod} className="restraint-3">
            <div className="restraint__block-2">{pod}</div>
            <StatusBadge status="NOT_ON_ATTACK_PATH" size="sm" className="restraint__status-badge" />
            <p className="restraint__text-2">{reasonFor(pod)}: no fix is proposed for it.</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function StormPage() {
  const client = useApi();
  const storm = useStorm();
  const revision = useSandboxState((s) => s.revision);
  const [search, setSearch] = useState('');

  if (storm.isPending) {
    return (
      <div className="storm-page">
        <LoadingState
          title="Triaging the alert storm"
          detail="GET /api/storm: evidence tiers, ATTACK_STEP build, reachability, bounded chains and clusters"
        />
      </div>
    );
  }
  if (storm.error) {
    return (
      <div className="storm-page">
        <ErrorState error={storm.error} title="The storm report could not be loaded" onRetry={() => void storm.refetch()} />
      </div>
    );
  }

  const data = storm.data;
  const outdated = revision !== null && data.revision < revision;

  return (
    <div className="storm-page-2">
      <div className="storm-page__block">
        <header className="storm-page__header">
          <div className="storm-page__block-2">
            <h1 className="storm-page__heading">Alert storm</h1>
            <p className="storm-page__text">
              <span className="storm-page__label">{data.storm_id}</span> · evaluated {formatUtc(data.evaluated_at)} ·
              revision <Num metric="revision" value={data.revision} className="storm-page__num" />
            </p>
          </div>
          <div className="storm-page__row">
            <EvidenceStatus storm={data} />
          </div>
          <div className="storm-page__block-3">
            <GraphStats storm={data} />
          </div>
        </header>

        {outdated ? (
          <Banner
            tone="grey"
            icon={Clock}
            title={`Computed at revision ${data.revision}; the sandbox is now at revision ${revision}`}
            actions={
              <Button size="sm" variant="secondary" onClick={() => void storm.refetch()} disabled={storm.isFetching}>
                <RefreshCw aria-hidden />
                {storm.isFetching ? 'Refreshing…' : 'Refresh'}
              </Button>
            }
          >
            {client.mode === 'mock'
              ? 'The mock API replays the recording and cannot recompute, so this view stays at the recorded revision.'
              : 'Refresh to triage the changed sandbox.'}
          </Banner>
        ) : null}

        {!data.complete ? (
          <Banner tone="yellow" title="Not enough fresh evidence: the scope is incomplete" role="alert">
            <ul className="storm-page__list">
              {data.issues.map((issue, index) => (
                <li key={`${issue.reason}-${index}`}>
                  <span className="storm-page__label-2">{issue.reason}</span>: {reasonText(issue.reason)}.{' '}
                  {issue.detail}
                  {issue.evidence_ids.length > 0 ? (
                    <span className="storm-page__label-3">{issue.evidence_ids.join(', ')}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            Every alert that depends on this evidence is shown as inconclusive, never as safe.
          </Banner>
        ) : null}

        {data.total_alerts === 0 ? (
          <EmptyState title="No alerts in this storm">
            Every evidence tier was queried and returned no alert, so there is nothing to triage.
          </EmptyState>
        ) : (
          <>
            <section aria-labelledby="funnel" className="storm-page__section">
              <h2 id="funnel" className="section-label">
                From alerts to attack paths
              </h2>
              <Funnel storm={data} />
            </section>

            <Restraint
              storm={data}
              onShow={(cve) => {
                setSearch(cve);
                document.getElementById('alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />

            <section aria-labelledby="clusters" className="storm-page__section">
              <div className="storm-page__row-2">
                <h2 id="clusters" className="section-label">
                  Clusters: one per crown jewel and entry ingress
                </h2>
                <span className="storm-page__label-4">Each cluster is investigated and fixed on its own.</span>
              </div>
              <div className="storm-page__grid">
                {data.clusters.map((cluster) => (
                  <ClusterCard key={cluster.id} cluster={cluster} storm={data} />
                ))}
              </div>
              {data.clusters.length === 0 ? (
                <EmptyState title="No chains reach a crown jewel">
                  Reachability over the ATTACK_STEP edges found no Internet-to-crown-jewel path, so there is nothing to
                  fix.
                </EmptyState>
              ) : null}
              <div className="storm-page__grid">
                <ScenarioCard />
              </div>
            </section>

            <section id="alerts" aria-labelledby="alerts-title" className="storm-page__section-2">
              <div className="storm-page__row-2">
                <h2 id="alerts-title" className="section-label">
                  Every alert
                </h2>
                <span className="storm-page__label-5">
                  <Quote className="storm-page__icon" aria-hidden />
                  Titles are untrusted scanner text, shown inert. Try searching for “IGNORE”.
                </span>
              </div>
              <AlertTable storm={data} initialQuery={search} />
            </section>
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
