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

function EvidenceStatus({ storm }: { storm: StormView }) {
  const tiers = Object.entries(storm.tiers);
  return (
    <Popover
      label="Evidence tiers behind this storm report"
      trigger={
        <button
          type="button"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-2xs font-medium transition-colors',
            storm.complete ? 'border-line text-fg-muted hover:text-fg' : 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300',
          )}
        >
          {storm.complete ? <CircleCheck className="size-3.5" aria-hidden /> : <StatusIcon name="question" />}
          {storm.complete ? 'Evidence complete: every tier fresh and verified' : 'Evidence incomplete'}
        </button>
      }
    >
      <div className="space-y-2">
        <div className="text-ui font-medium text-fg">Scope completeness (§6.6)</div>
        <table className="w-full text-left text-2xs">
          <thead className="text-fg-subtle">
            <tr>
              <th scope="col" className="pb-1 font-medium">Tier</th>
              <th scope="col" className="pb-1 font-medium">Status</th>
              <th scope="col" className="pb-1 text-right font-medium">Rows</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map(([name, tier]) => {
              const mark = describeCollection(tier.status);
              return (
                <tr key={name} className="border-t border-line/70">
                  <td className="py-1 text-fg">{name}</td>
                  <td className={cn('py-1 font-mono', mark.tone === 'yellow' ? 'text-yellow-300' : 'text-fg-muted')}>
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
                  <td className="py-1 text-right text-fg-muted">
                    <Num metric="tierRows" value={tier.rows} plain />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-2xs text-fg-subtle">
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
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-2xs text-fg-muted">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt>{item.label}</dt>
          <dd className="font-medium text-fg">{item.node}</dd>
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
    <section className="rounded-lg border border-line bg-surface p-4" aria-labelledby="restraint">
      <div className="flex items-start gap-2">
        <Scale className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="restraint" className="text-ui font-semibold text-fg">
            Same vulnerability, different verdicts
          </h2>
          <p className="mt-0.5 text-2xs text-fg-muted">
            <span className="font-mono text-fg">{example.cve}</span> is reported on several workloads. The graph, not the
            CVE, decides what matters.
          </p>
        </div>
        <Button size="xs" variant="ghost" onClick={() => onShow(example.cve)}>
          Show these alerts
        </Button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {example.onPath.map((pod) => (
          <li key={pod} className="rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2">
            <div className="font-mono text-ui text-fg">{pod}</div>
            <StatusBadge status="ON_ATTACK_PATH" size="sm" className="mt-1" />
            <p className="mt-1 text-2xs text-fg-muted">{reasonFor(pod)}</p>
          </li>
        ))}
        {example.notOnPath.map((pod) => (
          <li key={pod} className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2">
            <div className="font-mono text-ui text-fg">{pod}</div>
            <StatusBadge status="NOT_ON_ATTACK_PATH" size="sm" className="mt-1" />
            <p className="mt-1 text-2xs text-fg-muted">{reasonFor(pod)}: no fix is proposed for it.</p>
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
      <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
        <LoadingState
          title="Triaging the alert storm"
          detail="GET /api/storm: evidence tiers, ATTACK_STEP build, reachability, bounded chains and clusters"
        />
      </div>
    );
  }
  if (storm.error) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
        <ErrorState error={storm.error} title="The storm report could not be loaded" onRetry={() => void storm.refetch()} />
      </div>
    );
  }

  const data = storm.data;
  const outdated = revision !== null && data.revision < revision;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-fg">Alert storm</h1>
            <p className="mt-1 text-ui text-fg-muted">
              <span className="font-mono text-fg">{data.storm_id}</span> · evaluated {formatUtc(data.evaluated_at)} ·
              revision <Num metric="revision" value={data.revision} className="text-fg" />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EvidenceStatus storm={data} />
          </div>
          <div className="w-full">
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
            <ul className="mt-1 space-y-1">
              {data.issues.map((issue, index) => (
                <li key={`${issue.reason}-${index}`}>
                  <span className="font-mono text-2xs text-fg">{issue.reason}</span>: {reasonText(issue.reason)}.{' '}
                  {issue.detail}
                  {issue.evidence_ids.length > 0 ? (
                    <span className="block font-mono text-2xs text-fg-subtle">{issue.evidence_ids.join(', ')}</span>
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
            <section aria-labelledby="funnel" className="space-y-3">
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

            <section aria-labelledby="clusters" className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 id="clusters" className="section-label">
                  Clusters: one per crown jewel and entry ingress
                </h2>
                <span className="text-2xs text-fg-subtle">Each cluster is investigated and fixed on its own.</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ScenarioCard />
              </div>
            </section>

            <section id="alerts" aria-labelledby="alerts-title" className="scroll-mt-20 space-y-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 id="alerts-title" className="section-label">
                  Every alert
                </h2>
                <span className="inline-flex items-center gap-1 text-2xs text-fg-subtle">
                  <Quote className="size-3" aria-hidden />
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
