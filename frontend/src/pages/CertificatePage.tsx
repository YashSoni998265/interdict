import { ArrowLeft, BadgeCheck, ChevronDown, Clock, Download, FlaskConical, RotateCcw } from 'lucide-react';
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
import './CertificatePage.css';

function Section({
  title,
  children,
  id,
  collapsed = false,
}: {
  title: string;
  children: ReactNode;
  id: string;
  /** Technical detail starts folded so the claim, methods and exclusions stay in view. */
  collapsed?: boolean;
}) {
  const heading = (
    <h2 id={id} className="certificate-page-section__title">
      {title}
    </h2>
  );
  if (collapsed) {
    return (
      <section aria-labelledby={id} className="certificate-page-section">
        <details className="certificate-page-section__details">
          <summary className="certificate-page-section__summary">
            {heading}
            <ChevronDown className="certificate-page-section__chevron" aria-hidden />
          </summary>
          <div className="certificate-page-section__block">{children}</div>
        </details>
      </section>
    );
  }
  return (
    <section aria-labelledby={id} className="certificate-page-section">
      {heading}
      <div className="certificate-page-section__block">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <dt className="row__term">{label}</dt>
      <dd className="row__value">{children}</dd>
    </div>
  );
}

function Hash({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="hash">not recorded</span>;
  return (
    <span className="hash-2">
      <span className="hash__label" title={value}>
        {shortHash(value, 16, 12)}
      </span>
      <CopyButton value={value} label="Copy" />
    </span>
  );
}

const LIFECYCLE = ['VALID', 'EXPIRED', 'SUPERSEDED'] as const;

function Lifecycle({ status }: { status: string }) {
  return (
    <ol className="lifecycle" aria-label="Certificate lifecycle">
      {LIFECYCLE.map((state, index) => (
        <li key={state} className="lifecycle-2">
          {index === 1 ? <span className="lifecycle__label">→</span> : index > 1 ? <span className="lifecycle__label">or</span> : null}
          <span
            aria-current={state === status ? 'true' : undefined}
            className={cn(
              'lifecycle__chip',
              state === status ? 'lifecycle__chip--alt' : 'lifecycle__chip--not-alt',
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
    <div className="document">
      <Section id="scope" title="Scope, expiry and lifecycle">
        <dl>
          <Row label="T_scope (crown jewels)">
            <span className="document__label">
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
            {formatUtc(c.expires_at)} <span className="document__label-2">({formatRelative(c.expires_at, now)})</span>
            <div className="document__block">min(earliest valid_until in scope, issued + 24 h)</div>
          </Row>
          <Row label="Status">
            <Lifecycle status={c.status} />
          </Row>
        </dl>
      </Section>

      <Section id="snapshot" title="Snapshot" collapsed>
        <dl>
          <Row label="Sandbox graph">
            <span className="document__label-3">{c.snapshot.sandbox_graph_key}</span>
          </Row>
          <Row label="Sandbox revision">
            <Num metric="revision" value={c.snapshot.sandbox_revision} />
            {c.current_revision !== undefined ? (
              <span className="document__label-2">
                {' '}
                (sandbox now at <Num metric="revision" value={c.current_revision} />)
              </span>
            ) : null}
          </Row>
          <Row label="Baseline snapshot hash">
            <Hash value={c.snapshot.baseline_snapshot_hash} />
          </Row>
          <Row label="Candidate graph">
            <span className="document__label-4">{c.snapshot.candidate_graph_key}</span>
          </Row>
          <Row label="Candidate snapshot hash">
            <Hash value={c.snapshot.candidate_snapshot_hash} />
          </Row>
        </dl>
        <p className="document__text">
          SHA-256 over the canonical export: nodes by id, edges by (source, type, target), keys sorted, derived ATTACK_STEP
          edges excluded (§9.3).
        </p>
      </Section>

      <Section id="threat-model" title="Threat model and assumptions" collapsed>
        <dl>
          <Row label="Threat model">
            <span className="document__label-5">{c.threat_model.id}</span>
            <span className="document__label-2"> · ENTRY, LATERAL and GOAL transitions</span>
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
            <span className="document__label">
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

      <Section id="evidence" title="Evidence" collapsed>
        <dl>
          <Row label="Completeness">
            <span className="document__label-6">
              {Object.entries(c.evidence.completeness).map(([tier, value]) => (
                <span key={tier} className="document-2">
                  <span className="document__label-2">{tier}</span>
                  <span
                    className={cn(
                      'document__label-5',
                      typeof value === 'string' && describeCollection(value).tone === 'yellow' ? 'document__label--string' : 'document__label--not-string',
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
        <div className="document__grid">
          <div className="document__box">
            <div className="document__block-2">E · bounded enumerator</div>
            <div className="document__block-3">
              <Num metric="eChains" value={v.enumerator_E.chains_found} className="document__num" /> chains
              found
            </div>
            <div className="document__block-4">
              {v.enumerator_E.template} · <Num metric="methodLatency" value={v.enumerator_E.latency_ms} format="ms" />
            </div>
          </div>
          <div className="document__box">
            <div className="document__block-2">F · FalkorDB max-flow</div>
            <div className="document__block-3">
              <Num metric="maxFlow" value={v.maxflow_F.value_t_scope} className="document__num" /> for T_scope ·{' '}
              <Num metric="maxFlow" value={v.maxflow_F.value_all_crown_jewels} /> over all crown jewels
            </div>
            {v.maxflow_F.per_target ? (
              <ul className="document__list">
                {Object.entries(v.maxflow_F.per_target).map(([target, value]) => (
                  <li key={target} className={cn('document-3', !scope.includes(target) && 'document--not-includes')}>
                    <span className="document__label-7">{target}</span>
                    <Num metric="maxFlow" value={value} />
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="document__block-4">
              {v.maxflow_F.template} · <Num metric="methodLatency" value={v.maxflow_F.latency_ms} format="ms" />
            </div>
          </div>
          <div className="document__box">
            <div className="document__block-2">O · oracle search</div>
            <div className="document__block-3">
              {v.oracle_O.reachable_targets.length === 0
                ? 'reaches nothing in T_scope'
                : `reaches ${v.oracle_O.reachable_targets.join(', ')}`}
            </div>
            <div className="document__block-4">
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
        <p className={cn('document__text-2', v.agreement ? 'document__text--agreement' : 'document__text--not-agreement')}>
          {v.agreement ? 'The three methods agree: no path reaches T_scope.' : 'The methods disagree.'}
        </p>
        <div className="document__block-5">
          <table className="document__table">
            <caption className="document__caption">Path Hunter rounds</caption>
            <thead className="document__head">
              <tr>
                <th scope="col" className="document__heading-cell">Round</th>
                <th scope="col" className="document__heading-cell">Plan</th>
                <th scope="col" className="document__heading-cell-2">Residual chains added</th>
              </tr>
            </thead>
            <tbody>
              {v.rounds.map((round) => (
                <tr key={round.round} className="document-4">
                  <td className="document__cell">{round.round}</td>
                  <td className="document__cell-2">{round.plan_id}</td>
                  <td className="document__cell-3">
                    {round.residual_chain_ids.length === 0 ? 'none' : round.residual_chain_ids.map((id) => <div key={id} className="document-5">{id}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v.out_of_scope_residuals.length > 0 ? (
          <p className="document__text-3">
            Out-of-scope residuals (reported; they do not block a T_scope certificate):{' '}
            <span className="document__label-8">{v.out_of_scope_residuals.join(', ')}</span>
          </p>
        ) : null}
      </Section>

      <Section id="plan" title="Plan and impact">
        <dl>
          <Row label="Plan">
            <span className="document__label-3">{c.plan.plan_id}</span> <Tag mono>{c.plan.optimality}</Tag>
          </Row>
          <Row label="Impact">
            <StatusBadge status={c.plan.impact_status} knownBroken={c.plan.known_broken.length} size="sm" />
          </Row>
          <Row label="Declared dependencies broken">
            {c.plan.known_broken.length === 0 ? 'none' : <span className="document__label-3">{c.plan.known_broken.join(', ')}</span>}
          </Row>
          <Row label="Unknown-impact flows">
            {c.plan.unknown_impact.length === 0 ? (
              'none'
            ) : (
              <span className="document__label-9">{c.plan.unknown_impact.join(', ')}</span>
            )}
          </Row>
        </dl>
        <ul className="document__list-2">
          {c.plan.actions.map((action) => {
            const variant = action.candidate_action_id.split(':').pop() as keyof typeof VARIANT | undefined;
            return (
              <li key={action.candidate_action_id} className="document-6">
                <div className="document__block-6">{action.candidate_action_id}</div>
                <div className="document__block-7">
                  {variant && variant in VARIANT ? `${VARIANT[variant].label} · ` : ''}
                  {action.action_type} · <span className="document__label-5">{action.policy_spec.name}</span> ·{' '}
                  {action.policy_spec.namespace}/{action.policy_spec.pod_selector}
                </div>
                <div className="document__row">
                  {action.policy_spec.allows_egress.length === 0 ? (
                    <span className="document__label-10">allows nothing (all egress blocked)</span>
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

      <Section id="provenance" title="Provenance" collapsed>
        <dl>
          <Row label="Engine git SHA">
            <span className="document__label-3">{c.provenance.engine_git_sha ?? 'not recorded'}</span>
          </Row>
          <Row label="FalkorDB">
            <span className="document__label-3">{c.provenance.falkordb_version ?? 'not recorded'}</span>
          </Row>
          <Row label="Oracle">
            <span className="document__label-3">{c.provenance.oracle_version ?? 'not recorded'}</span>
          </Row>
          <Row label="Audit event hash">
            <Hash value={c.provenance.audit_event_hash} />
          </Row>
        </dl>
      </Section>

      <Section id="exclusions" title="Exclusions (verbatim)">
        <blockquote className="document__quote">
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
      <div className="certificate-page">
        <LoadingState title="Loading the certificate" detail={`GET /api/certificates/${certificateId}: status recomputed on read`} />
      </div>
    );
  }
  if (certificate.error) {
    return (
      <div className="certificate-page">
        <ErrorState error={certificate.error} title="The certificate could not be loaded" onRetry={() => void certificate.refetch()} />
      </div>
    );
  }

  const c = certificate.data;
  const current = c.status === 'VALID';
  const rerun = clusterId ? `/clusters/${clusterId}` : '/storm';
  const nowRevision = c.current_revision ?? sandboxRevision;

  return (
    <div className="certificate-page-2">
      <article className="certificate-page__article" aria-labelledby="claim">
        <Link to={clusterId ? `/clusters/${clusterId}` : '/storm'} className="certificate-page__link">
          <ArrowLeft className="certificate-page__icon" aria-hidden />
          {clusterId ? 'Back to the workbench' : 'Alert storm'}
        </Link>

        <header
          className={cn(
            'certificate-page__header',
            current ? 'certificate-page__header--current' : 'certificate-page__header--not-current',
          )}
        >
          <div className="certificate-page__row">
            <span className="section-label">Certificate</span>
            <span className="certificate-page__label">{c.certificate_id}</span>
            <CopyButton value={c.certificate_id} label="Copy certificate id" />
            <span className="certificate-page__label-2">
              <FlaskConical className="certificate-page__icon" aria-hidden />
              Simulation only
            </span>
          </div>
          <div className="certificate-page__row-2">
            {current ? (
              <BadgeCheck className="certificate-page__icon-2" aria-hidden />
            ) : (
              <Clock className="certificate-page__icon-3" aria-hidden />
            )}
            <div className="certificate-page__block">
              <h1 id="claim" className={cn('certificate-page__heading', current ? 'certificate-page__heading--current' : 'certificate-page__heading--not-current')}>
                {current ? 'Model-verified containment (simulation)' : 'Certificate no longer current'}
              </h1>
              <p className={cn('certificate-page__text', current ? 'certificate-page__text--current' : 'certificate-page__text--not-current')}>
                {current ? '' : 'It stated: '}Under threat model {c.threat_model.id}, on the hashed snapshot below, after the{' '}
                <Num metric="planActions" value={c.plan.actions.length} /> listed policy changes, no modelled attack chain
                reaches {c.threat_model.t_scope.join(', ')}. Three independent methods agreed. This is not evidence of
                real-world containment.
              </p>
            </div>
          </div>
          <div className="certificate-page__row">
            <StatusBadge status={c.status} tooltip />
            <span className="certificate-page__label-3">claim {c.claim}</span>
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

        <div className={cn(!current && 'certificate-page__block--not-current')}>
          <Document c={c} />
        </div>

        <div className="certificate-page__row-3">
          <span className="certificate-page__label-3">Digest</span>
          <Hash value={c.digest} />
          <div className="certificate-page__row-4">
            <Button size="sm" variant="secondary" onClick={() => download(c)}>
              <Download aria-hidden />
              Download JSON
            </Button>
          </div>
          <p className="certificate-page__text-2">The downloaded JSON and its digest let a reviewer compare records.</p>
        </div>
      </article>
      <Footer />
    </div>
  );
}
