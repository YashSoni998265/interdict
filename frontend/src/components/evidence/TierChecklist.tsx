import { Check, CircleHelp, Clock, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { useWorkloadEvidence } from '@/api/queries';
import type { CollectionStatus, ProvenanceView, WorkloadEvidenceView } from '@/api/types';
import { cn } from '@/lib/cn';
import { formatUtc, plural } from '@/lib/format';
import { describeCollection } from '@/lib/status';

import { Num } from '../Num';
import { ErrorState, LoadingState } from '../states';
import { Disclosure } from '../ui/disclosure';
import { Tag } from '../ui/tag';

import { ProvenanceList } from './Provenance';
import './TierChecklist.css';

const MARK_ICON = { check: Check, cross: X, stale: Clock, unknown: CircleHelp } as const;

function Mark({ status }: { status: CollectionStatus }) {
  const descriptor = describeCollection(status);
  const Icon = MARK_ICON[descriptor.mark];
  return (
    <span
      className={cn(
        'mark',
        descriptor.mark === 'check' && 'mark--check',
        descriptor.mark === 'cross' && 'mark--cross',
        (descriptor.mark === 'stale' || descriptor.mark === 'unknown') && 'mark--stale',
      )}
    >
      <Icon className="mark__icon" aria-hidden strokeWidth={2.5} />
    </span>
  );
}

function TierRow({
  name,
  status,
  count,
  summary,
  provenance,
}: {
  name: string;
  status: CollectionStatus;
  count: number;
  summary: ReactNode;
  provenance: ProvenanceView[];
}) {
  const descriptor = describeCollection(status);
  return (
    <li className="tier-row">
      <Mark status={status} />
      <div className="tier-row__block">
        <div className="tier-row__row">
          <span className="tier-row__label">{name}</span>
          <span className={cn('tier-row__label-2', descriptor.tone === 'yellow' ? 'tier-row__label--yellow' : 'tier-row__label--not-yellow')}>
            {descriptor.label}
          </span>
          <span className="tier-row__label-3">
            <Num metric="evidenceRecords" value={count} plain /> {plural(count, 'record')}
          </span>
        </div>
        <div className="tier-row__block-2">{summary}</div>
        {provenance.length > 0 ? (
          <Disclosure summary="Provenance" className="tier-row__disclosure">
            <ProvenanceList items={provenance} />
          </Disclosure>
        ) : null}
      </div>
    </li>
  );
}

function Tiers({ view }: { view: WorkloadEvidenceView }) {
  const { exposure, vulnerability, reachability, authorization } = view.tiers;
  const flat = (records: { evidence: ProvenanceView[] }[]) => records.flatMap((r) => r.evidence);
  return (
    <ul className="tiers" aria-label={`Evidence tiers for ${view.pod.id}`}>
      <TierRow
        name="Exposure"
        status={exposure.status}
        count={exposure.records.length}
        provenance={flat(exposure.records)}
        summary={
          exposure.records.length > 0
            ? exposure.records.map((r) => `Internet → ${r.ingress} → ${r.service}`).join('; ')
            : 'No ingress routes to this workload.'
        }
      />
      <TierRow
        name="Vulnerability"
        status={vulnerability.status}
        count={vulnerability.records.length}
        provenance={flat(vulnerability.records)}
        summary={
          vulnerability.records.length > 0 ? (
            <ul className="tiers__list">
              {vulnerability.records.map((r) => (
                <li key={r.vuln_id} className="tiers-2">
                  <span className="tiers__label">{r.cve_id}</span>
                  <span>
                    {r.status.toLowerCase()} · {r.attack_vector ?? 'no vector (treated as NETWORK)'} ·{' '}
                    {r.severity.toLowerCase()}
                  </span>
                  {r.cvss !== null ? (
                    <span>
                      · CVSS <Num metric="cvss" value={r.cvss} format="decimal" />
                    </span>
                  ) : null}
                  <Tag tone={r.network_exploitable ? 'red' : 'grey'}>
                    {r.network_exploitable ? 'network-exploitable' : 'not network-exploitable'}
                  </Tag>
                </li>
              ))}
            </ul>
          ) : (
            'No active vulnerability recorded on its image.'
          )
        }
      />
      <TierRow
        name="Reachability"
        status={reachability.status}
        count={reachability.records.length}
        provenance={flat(reachability.records)}
        summary={
          reachability.records.length > 0 ? (
            <span className="tiers__label-2">
              {reachability.records.map((r) => `${r.dst}:${r.port}/${r.protocol}`).join(' · ')}
            </span>
          ) : (
            'No observed outbound flow.'
          )
        }
      />
      <TierRow
        name="Authorization"
        status={authorization.status}
        count={authorization.records.length}
        provenance={flat(authorization.records)}
        summary={
          authorization.records.length > 0
            ? authorization.records
                .map((r) => `${r.effect} on ${r.db} via ${r.role_arn.split('/').pop() ?? r.role_arn}`)
                .join('; ')
            : 'No IAM grant on a crown jewel.'
        }
      />
    </ul>
  );
}

const MANIFEST_TEXT = {
  COMPLETE: 'all legitimate egress is declared, so an undeclared blocked flow is a known non-dependency',
  PARTIAL: 'some egress is declared; blocked undeclared flows have unknown impact',
  NONE: 'nothing is declared; every blocked flow has unknown impact',
} as const;

/** The four evidence tiers for one workload, with ✓ present, ✗ verified absent, or stale. */
export function TierChecklist({ podId }: { podId: string }) {
  const evidence = useWorkloadEvidence(podId);
  if (evidence.isPending) {
    return (
      <LoadingState
        compact
        title={`Querying the four evidence tiers for ${podId}`}
        detail="Exposure, vulnerability, reachability and authorization, with provenance"
      />
    );
  }
  if (evidence.error) {
    return <ErrorState compact error={evidence.error} title={`Evidence for ${podId} is unavailable`} onRetry={() => void evidence.refetch()} />;
  }
  const view = evidence.data;
  return (
    <div className="tier-checklist">
      <div className="tier-checklist__row">
        <span className="tier-checklist__label">{view.pod.id}</span>
        <span className="tier-checklist__label-2">
          {view.pod.namespace}/app={view.pod.app}
        </span>
        <span className="tier-checklist__label-3">evaluated {formatUtc(view.evaluated_at)}</span>
      </div>
      <Tiers view={view} />
      <div className="tier-checklist__block">
        <div>
          <span className="tier-checklist__label-4">Dependency manifest </span>
          <Tag mono>{view.pod.dependency_manifest}</Tag>{' '}
          {MANIFEST_TEXT[view.pod.dependency_manifest] ?? ''}
        </div>
        <div>
          <span className="tier-checklist__label-4">Egress </span>
          {view.egress_isolated
            ? `isolated by ${view.egress_policies.join(', ')}`
            : 'not isolated: no egress policy selects it, so all outbound flows are allowed'}
        </div>
        {view.declared_dependencies.length > 0 ? (
          <div>
            <span className="tier-checklist__label-4">Declared dependencies (synthetic fixture) </span>
            <span className="tier-checklist__label-5">
              {view.declared_dependencies.map((d) => `${d.dst}:${d.port}/${d.protocol}`).join(' · ')}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
