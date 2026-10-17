import { ArrowRight, CircleCheck, Clock, Quote, RefreshCw, Scale } from 'lucide-react';
import { useState } from 'react';

import { useStorm } from '@/api/queries';
import type { StormView } from '@/api/types';
import { useApi, useSandboxState } from '@/app/services';
import { Footer } from '@/components/layout/Footer';
import { CountUp } from '@/components/motion/CountUp';
import { Num } from '@/components/Num';
import { StatusBadge, StatusIcon } from '@/components/StatusBadge';
import { AlertTable } from '@/components/storm/AlertTable';
import { ClusterCard } from '@/components/storm/ClusterCard';
import { Funnel } from '@/components/storm/Funnel';
import { Banner, EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
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
  const [showAlerts, setShowAlerts] = useState(false);

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
              <h2 id="funnel" className="sr-only">
                From alerts to attack paths
              </h2>
              <div className="storm-headline">
                <div className="storm-headline__tile">
                  <CountUp value={data.total_alerts} className="storm-headline__value" />
                  <span className="storm-headline__label">alerts in the storm</span>
                </div>
                <ArrowRight className="storm-headline__arrow" aria-hidden />
                {data.complete ? (
                  <>
                    <div className="storm-headline__tile storm-headline__tile--red">
                      <CountUp value={data.counts.ON_ATTACK_PATH} from={data.total_alerts} className="storm-headline__value" />
                      <span className="storm-headline__label">on a real attack path</span>
                    </div>
                    <ArrowRight className="storm-headline__arrow" aria-hidden />
                    <div className="storm-headline__tile">
                      <CountUp value={data.clusters.length} className="storm-headline__value" />
                      <span className="storm-headline__label">places to fix</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="storm-headline__tile storm-headline__tile--yellow">
                      <CountUp value={data.counts.TRIAGE_INCONCLUSIVE} className="storm-headline__value" />
                      <span className="storm-headline__label">inconclusive: evidence is stale</span>
                    </div>
                    <ArrowRight className="storm-headline__arrow" aria-hidden />
                    <div className="storm-headline__tile">
                      <span className="storm-headline__value">?</span>
                      <span className="storm-headline__label">places to fix: unknown until the evidence is fresh</span>
                    </div>
                  </>
                )}
              </div>
              <Disclosure summary="How we got here: every step of the triage, with its graph proof" className="storm-page__how">
                <Funnel storm={data} />
              </Disclosure>
            </section>
            <Restraint
              storm={data}
              onShow={(cve) => {
                setSearch(cve);
                setShowAlerts(true);
                window.setTimeout(
                  () => document.getElementById('alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                  50,
                );
              }}
            />
            <section aria-labelledby="clusters" className="storm-page__section">
              <div className="storm-page__heading-row">
                <h2 id="clusters" className="storm-page__section-title">
                  Where to act
                </h2>
                <span className="storm-page__section-hint">
                  One cluster per crown jewel and way in. Each is investigated and fixed on its own.
                </span>
              </div>
              <div className="storm-page__grid">
                {data.clusters.map((cluster) => (
                  <ClusterCard key={cluster.id} cluster={cluster} />
                ))}
              </div>
              {data.clusters.length === 0 && !data.complete ? (
                <EmptyState title="Not enough fresh evidence">
                  Clusters cannot be computed while evidence is stale, and Interdict does not call the alerts safe. Reset the
                  sandbox to restore the evidence.
                </EmptyState>
              ) : null}
              {data.clusters.length === 0 && data.complete ? (
                <EmptyState title="No chains reach a crown jewel">
                  Reachability over the ATTACK_STEP edges found no Internet-to-crown-jewel path, so there is nothing to
                  fix.
                </EmptyState>
              ) : null}
            </section>
            <section id="alerts" aria-labelledby="alerts-title" className="storm-page__section">
              <div className="storm-page__heading-row">
                <h2 id="alerts-title" className="storm-page__section-title">
                  Every alert
                </h2>
                <span className="storm-page__section-hint">
                  <Quote className="storm-page__icon" aria-hidden />
                  Titles are untrusted scanner text, shown inert. Try searching for “IGNORE”.
                </span>
              </div>
              {showAlerts ? (
                <AlertTable storm={data} initialQuery={search} />
              ) : (
                <Button variant="secondary" onClick={() => setShowAlerts(true)}>
                  Show all {data.total_alerts.toLocaleString('en-US')} alerts
                </Button>
              )}
            </section>
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
