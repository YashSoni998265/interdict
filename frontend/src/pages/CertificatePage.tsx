import { ArrowLeft, BadgeCheck, Clock, Download, FlaskConical, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useCertificate } from '@/api/queries';
import type { CertificateView } from '@/api/types';
import { useNow, useSandboxState, useWorkbenchState } from '@/app/services';
import { Footer } from '@/components/layout/Footer';
import { Num } from '@/components/Num';
import { StatusBadge } from '@/components/StatusBadge';
import { Banner, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/misc';
import { Tag } from '@/components/ui/tag';
import { cn } from '@/lib/cn';
import { formatRelative, formatUtc, shortHash } from '@/lib/format';
import { describeCollection, VARIANT } from '@/lib/status';

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-line bg-surface">
      <h2 id={id} className="border-b border-line px-4 py-2.5 text-ui font-semibold text-fg">
        {title}
      </h2>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-1.5 text-ui sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

function Hash({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-fg-subtle">not recorded</span>;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <span className="truncate font-mono text-[12px]" title={value}>
        {shortHash(value, 16, 12)}
      </span>
      <CopyButton value={value} label="Copy" />
    </span>
  );
}

const LIFECYCLE = ['VALID', 'EXPIRED', 'SUPERSEDED', 'REVERIFICATION_FAILED'] as const;

function Lifecycle({ status }: { status: string }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Certificate lifecycle">
      {LIFECYCLE.map((state, index) => (
        <li key={state} className="flex items-center gap-1.5">
          {index === 1 ? <span className="text-2xs text-fg-subtle">→</span> : index > 1 ? <span className="text-2xs text-fg-subtle">or</span> : null}
          <span
            aria-current={state === status ? 'true' : undefined}
            className={cn(
              'rounded border px-1.5 py-px font-mono text-[11px]',
              state === status ? 'border-fg/50 bg-elevated text-fg' : 'border-line text-fg-subtle',
            )}
          >
            {state}
          </span>
        </li>
      ))}
    </ol>
  );
}

function download(certificate: CertificateView) {
  const blob = new Blob([JSON.stringify(certificate, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${certificate.certificate_id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function Document({ c }: { c: CertificateView }) {
  const now = useNow();
  const v = c.verification;
  const scope = c.threat_model.t_scope;
  return (
    <div className="space-y-4">
      <Section id="scope" title="Scope, expiry and lifecycle">
        <dl>
          <Row label="T_scope (crown jewels)">
            <span className="flex flex-wrap gap-1">
              {scope.map((t) => (
                <Tag key={t} mono>
                  {t}
                </Tag>
              ))}
            </span>
          </Row>
          <Row label="Issued">{formatUtc(c.issued_at)}</Row>
          <Row label="Evaluation time">{formatUtc(c.evaluation_time)}</Row>
          <Row label="Expires">
            {formatUtc(c.expires_at)} <span className="text-fg-muted">({formatRelative(c.expires_at, now)})</span>
            <div className="text-2xs text-fg-subtle">min(earliest valid_until in scope, issued + 24 h)</div>
          </Row>
          <Row label="Status">
            <Lifecycle status={c.status} />
          </Row>
        </dl>
      </Section>

      <Section id="snapshot" title="Snapshot">
        <dl>
          <Row label="Sandbox graph">
            <span className="font-mono text-[12px]">{c.snapshot.sandbox_graph_key}</span>
          </Row>
          <Row label="Sandbox revision">
            <Num metric="revision" value={c.snapshot.sandbox_revision} />
            {c.current_revision !== undefined ? (
              <span className="text-fg-muted">
                {' '}
                (sandbox now at <Num metric="revision" value={c.current_revision} />)
              </span>
            ) : null}
          </Row>
          <Row label="Baseline snapshot hash">
            <Hash value={c.snapshot.baseline_snapshot_hash} />
          </Row>
          <Row label="Candidate graph">
            <span className="break-all font-mono text-[12px]">{c.snapshot.candidate_graph_key}</span>
          </Row>
          <Row label="Candidate snapshot hash">
            <Hash value={c.snapshot.candidate_snapshot_hash} />
          </Row>
        </dl>
        <p className="mt-2 text-2xs text-fg-subtle">
          SHA-256 over the canonical export: nodes by id, edges by (source, type, target), keys sorted, derived ATTACK_STEP
          edges excluded (§9.3).
        </p>
      </Section>

      <Section id="threat-model" title="Threat model and assumptions">
        <dl>
          <Row label="Threat model">
            <span className="font-mono">{c.threat_model.id}</span>
            <span className="text-fg-muted"> · ENTRY, LATERAL and GOAL transitions</span>
          </Row>
          <Row label="Planner lateral hops">
            ≤ <Num metric="maxLateralHops" value={c.threat_model.constants.max_lateral_hops_planner} />
          </Row>
          <Row label="Plan actions">
            ≤ <Num metric="maxPlanActions" value={c.threat_model.constants.max_plan_actions} />
          </Row>
          <Row label="Hunter rounds">
            ≤ <Num metric="maxHuntRounds" value={c.threat_model.constants.max_hunt_rounds} />
          </Row>
          <Row label="Relationship types">
            <span className="flex flex-wrap gap-1">
              {c.threat_model.relationship_types.map((t) => (
                <Tag key={t} mono>
                  {t}
                </Tag>
              ))}
            </span>
          </Row>
          <Row label="Over-approximations">
            <Num metric="missingVector" value={c.threat_model.over_approximations.missing_attack_vector_count} />{' '}
            vulnerabilities with no attack vector treated as NETWORK · ingress policies{' '}
            {c.threat_model.over_approximations.ingress_policies_ignored ? 'ignored (attacker-favourable)' : 'modelled'}
          </Row>
        </dl>
      </Section>

      <Section id="evidence" title="Evidence">
        <dl>
          <Row label="Completeness">
            <span className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {Object.entries(c.evidence.completeness).map(([tier, value]) => (
                <span key={tier} className="flex items-baseline justify-between gap-2 text-2xs">
                  <span className="text-fg-muted">{tier}</span>
                  <span
                    className={cn(
                      'font-mono',
                      typeof value === 'string' && describeCollection(value).tone === 'yellow' ? 'text-yellow-300' : 'text-fg',
                    )}
                  >
                    {String(value)}
                  </span>
                </span>
              ))}
            </span>
          </Row>
          <Row label="Earliest valid until">{formatUtc(c.evidence.freshness.earliest_valid_until)}</Row>
          <Row label="Stale / unverified">
            <Num metric="staleItems" value={c.evidence.freshness.stale_items} /> /{' '}
            <Num metric="unverifiedItems" value={c.evidence.freshness.unverified_items} />
          </Row>
        </dl>
      </Section>

      <Section id="methods" title="Methods and results">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-line bg-canvas px-3 py-2.5 text-2xs">
            <div className="font-medium text-fg">E · bounded enumerator</div>
            <div className="mt-1 text-fg-muted">
              <Num metric="eChains" value={v.enumerator_E.chains_found} className="text-sm font-semibold text-fg" /> chains
              found
            </div>
            <div className="mt-1 text-fg-subtle">
              {v.enumerator_E.template} · <Num metric="methodLatency" value={v.enumerator_E.latency_ms} format="ms" />
            </div>
          </div>
          <div className="rounded-md border border-line bg-canvas px-3 py-2.5 text-2xs">
            <div className="font-medium text-fg">F · FalkorDB max-flow</div>
            <div className="mt-1 text-fg-muted">
              <Num metric="maxFlow" value={v.maxflow_F.value_t_scope} className="text-sm font-semibold text-fg" /> for T_scope ·{' '}
              <Num metric="maxFlow" value={v.maxflow_F.value_all_crown_jewels} /> over all crown jewels
            </div>
            {v.maxflow_F.per_target ? (
              <ul className="mt-1 space-y-px">
                {Object.entries(v.maxflow_F.per_target).map(([target, value]) => (
                  <li key={target} className={cn('flex justify-between gap-2', !scope.includes(target) && 'opacity-70')}>
                    <span className="truncate font-mono">{target}</span>
                    <Num metric="maxFlow" value={value} />
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-1 text-fg-subtle">
              {v.maxflow_F.template} · <Num metric="methodLatency" value={v.maxflow_F.latency_ms} format="ms" />
            </div>
          </div>
          <div className="rounded-md border border-line bg-canvas px-3 py-2.5 text-2xs">
            <div className="font-medium text-fg">O · oracle search</div>
            <div className="mt-1 text-fg-muted">
              {v.oracle_O.reachable_targets.length === 0
                ? 'reaches nothing in T_scope'
                : `reaches ${v.oracle_O.reachable_targets.join(', ')}`}
            </div>
            <div className="mt-1 text-fg-subtle">
              {v.oracle_O.method ?? 'oracle'} {v.oracle_O.version}
              {v.oracle_O.latency_ms !== undefined ? (
                <>
                  {' · '}
                  <Num metric="methodLatency" value={v.oracle_O.latency_ms} format="ms" />
                </>
              ) : null}
            </div>
          </div>
        </div>
        <p className={cn('mt-3 text-ui', v.agreement ? 'text-fg' : 'text-red-300')}>
          {v.agreement ? 'The three methods agree: no path reaches T_scope.' : 'The methods disagree.'}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-left text-2xs">
            <caption className="pb-1 text-left text-fg-subtle">Path Hunter rounds</caption>
            <thead className="text-fg-subtle">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">Round</th>
                <th scope="col" className="py-1 pr-3 font-medium">Plan</th>
                <th scope="col" className="py-1 font-medium">Residual chains added</th>
              </tr>
            </thead>
            <tbody>
              {v.rounds.map((round) => (
                <tr key={round.round} className="border-t border-line align-top">
                  <td className="py-1 pr-3 text-fg">{round.round}</td>
                  <td className="py-1 pr-3 font-mono text-fg-muted">{round.plan_id}</td>
                  <td className="py-1 font-mono text-fg-muted">
                    {round.residual_chain_ids.length === 0 ? 'none' : round.residual_chain_ids.map((id) => <div key={id} className="break-all">{id}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v.out_of_scope_residuals.length > 0 ? (
          <p className="mt-2 text-2xs text-fg-muted">
            Out-of-scope residuals (reported; they do not block a T_scope certificate):{' '}
            <span className="break-all font-mono">{v.out_of_scope_residuals.join(', ')}</span>
          </p>
        ) : null}
      </Section>

      <Section id="plan" title="Plan and impact">
        <dl>
          <Row label="Plan">
            <span className="font-mono text-[12px]">{c.plan.plan_id}</span> <Tag mono>{c.plan.optimality}</Tag>
          </Row>
          <Row label="Impact">
            <StatusBadge status={c.plan.impact_status} knownBroken={c.plan.known_broken.length} size="sm" />
          </Row>
          <Row label="Declared dependencies broken">
            {c.plan.known_broken.length === 0 ? 'none' : <span className="font-mono text-[12px]">{c.plan.known_broken.join(', ')}</span>}
          </Row>
          <Row label="Unknown-impact flows">
            {c.plan.unknown_impact.length === 0 ? (
              'none'
            ) : (
              <span className="font-mono text-[12px] text-yellow-300">{c.plan.unknown_impact.join(', ')}</span>
            )}
          </Row>
        </dl>
        <ul className="mt-3 space-y-2">
          {c.plan.actions.map((action) => {
            const variant = action.candidate_action_id.split(':').pop() as keyof typeof VARIANT | undefined;
            return (
              <li key={action.candidate_action_id} className="rounded-md border border-dashed border-violet-500/40 bg-violet-500/[0.04] px-3 py-2 text-2xs">
                <div className="break-all font-mono text-[12px] text-fg">{action.candidate_action_id}</div>
                <div className="mt-0.5 text-fg-muted">
                  {variant && variant in VARIANT ? `${VARIANT[variant].label} · ` : ''}
                  {action.action_type} · <span className="font-mono">{action.policy_spec.name}</span> ·{' '}
                  {action.policy_spec.namespace}/{action.policy_spec.pod_selector}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {action.policy_spec.allows_egress.length === 0 ? (
                    <span className="text-fg">allows nothing (all egress blocked)</span>
                  ) : (
                    action.policy_spec.allows_egress.map((rule) => (
                      <Tag key={`${rule.destination_id}-${rule.port}-${rule.protocol}`} mono>
                        {rule.destination_id}:{rule.port}/{rule.protocol}
                      </Tag>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="provenance" title="Provenance">
        <dl>
          <Row label="Engine git SHA">
            <span className="font-mono text-[12px]">{c.provenance.engine_git_sha ?? 'not recorded'}</span>
          </Row>
          <Row label="FalkorDB">
            <span className="font-mono text-[12px]">{c.provenance.falkordb_version ?? 'not recorded'}</span>
          </Row>
          <Row label="Oracle">
            <span className="font-mono text-[12px]">{c.provenance.oracle_version ?? 'not recorded'}</span>
          </Row>
          <Row label="Audit event hash">
            <Hash value={c.provenance.audit_event_hash} />
          </Row>
        </dl>
      </Section>

      <Section id="exclusions" title="Exclusions (verbatim)">
        <blockquote className="whitespace-pre-line border-l-2 border-line-strong pl-3 text-ui leading-6 text-fg-muted">
          {c.exclusions}
        </blockquote>
      </Section>
    </div>
  );
}

export default function CertificatePage() {
  const { certificateId = '' } = useParams();
  const certificate = useCertificate(certificateId);
  const sandboxRevision = useSandboxState((s) => s.revision);
  const clusterId = useWorkbenchState((s) => s.certificateClusters[certificateId]);

  if (certificate.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <LoadingState title="Loading the certificate" detail={`GET /api/certificates/${certificateId}: status recomputed on read`} />
      </div>
    );
  }
  if (certificate.error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <ErrorState error={certificate.error} title="The certificate could not be loaded" onRetry={() => void certificate.refetch()} />
      </div>
    );
  }

  const c = certificate.data;
  const current = c.status === 'VALID';
  const rerun = clusterId ? `/clusters/${clusterId}` : '/storm';
  const nowRevision = c.current_revision ?? sandboxRevision;

  return (
    <div className="flex flex-1 flex-col">
      <article className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6" aria-labelledby="claim">
        <Link to={clusterId ? `/clusters/${clusterId}` : '/storm'} className="inline-flex items-center gap-1 text-2xs text-fg-muted hover:text-fg">
          <ArrowLeft className="size-3.5" aria-hidden />
          {clusterId ? 'Back to the workbench' : 'Alert storm'}
        </Link>

        <header
          className={cn(
            'space-y-3 rounded-xl border px-5 py-5',
            current ? 'border-emerald-500/35 bg-emerald-500/[0.06]' : 'border-zinc-500/30 bg-zinc-500/[0.05]',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="section-label">Certificate</span>
            <span className="break-all font-mono text-[12px] text-fg-muted">{c.certificate_id}</span>
            <CopyButton value={c.certificate_id} label="Copy certificate id" />
            <span className="ml-auto inline-flex items-center gap-1 text-2xs text-fg-muted">
              <FlaskConical className="size-3.5" aria-hidden />
              Simulation only
            </span>
          </div>
          <div className="flex items-start gap-3">
            {current ? (
              <BadgeCheck className="mt-0.5 size-7 shrink-0 text-emerald-400" aria-hidden />
            ) : (
              <Clock className="mt-0.5 size-7 shrink-0 text-zinc-400" aria-hidden />
            )}
            <div className="min-w-0">
              <h1 id="claim" className={cn('text-xl font-semibold tracking-tight', current ? 'text-emerald-300' : 'text-zinc-300')}>
                {current ? 'Model-verified containment (simulation)' : 'Certificate no longer current'}
              </h1>
              <p className={cn('mt-1.5 text-ui leading-6', current ? 'text-fg' : 'text-fg-muted')}>
                {current ? '' : 'It stated: '}Under threat model {c.threat_model.id}, on the hashed snapshot below, after the{' '}
                <Num metric="planActions" value={c.plan.actions.length} /> listed policy changes, no modelled attack chain
                reaches {c.threat_model.t_scope.join(', ')}. Three independent methods agreed. This is not evidence of
                real-world containment.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} tooltip />
            <span className="text-2xs text-fg-muted">claim {c.claim}</span>
          </div>
        </header>

        {c.status === 'SUPERSEDED' ? (
          <Banner
            tone="grey"
            icon={Clock}
            title={`Superseded: issued at revision ${c.snapshot.sandbox_revision}, the sandbox is now at revision ${nowRevision ?? '?'}`}
            actions={
              <Button asChild size="sm" variant="secondary">
                <Link to={rerun}>
                  <RotateCcw aria-hidden />
                  Re-run
                </Link>
              </Button>
            }
          >
            A sandbox change can create or remove attack paths, so this result no longer applies. Re-run the
            investigation to get a current certificate.
          </Banner>
        ) : null}
        {c.status === 'EXPIRED' ? (
          <Banner tone="grey" icon={Clock} title={`Expired at ${formatUtc(c.expires_at)}`}>
            The evidence it rests on is no longer fresh. Re-run the investigation on fresh evidence.
          </Banner>
        ) : null}

        <div className={cn(!current && 'opacity-80 saturate-0')}>
          <Document c={c} />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-4 py-3">
          <span className="text-2xs text-fg-muted">Digest</span>
          <Hash value={c.digest} />
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => download(c)}>
              <Download aria-hidden />
              Download JSON
            </Button>
            <Button size="sm" variant="ghost" disabled aria-describedby="reproduce-note">
              Reproduce
            </Button>
          </div>
          <p id="reproduce-note" className="w-full text-2xs text-fg-subtle">
            Reproduction (verify_certificate re-runs E, F and O on the retained snapshot) is specified but not built in
            this version (solution.md §3.5). The downloaded JSON and the digest let a reviewer compare records.
          </p>
        </div>
      </article>
      <Footer />
    </div>
  );
}
