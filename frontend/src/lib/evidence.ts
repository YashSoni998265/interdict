import type { EvidenceTierName, ProvenanceView, WorkloadEvidenceView } from '@/api/types';

export interface EvidenceEntry {
  id: string;
  pod: string;
  tier: EvidenceTierName;
  /** What the evidence says, e.g. "ing-auth → svc-auth" or "prod-payments-db:5432/TCP". */
  label: string;
  provenance: ProvenanceView[];
}

/**
 * Index every evidence id a workload view mentions (edge ids, vulnerability ids, permission
 * ids), so an ATTACK_STEP's backing_evidence_ids can be shown with their provenance.
 */
export function buildEvidenceIndex(views: readonly (WorkloadEvidenceView | undefined)[]): Map<string, EvidenceEntry> {
  const index = new Map<string, EvidenceEntry>();
  const add = (entry: EvidenceEntry) => {
    if (!index.has(entry.id)) index.set(entry.id, entry);
  };
  for (const view of views) {
    if (!view) continue;
    const pod = view.pod.id;
    for (const record of view.tiers.exposure.records) {
      const label = `${record.ingress} → ${record.service} → ${pod}`;
      for (const p of record.evidence) add({ id: p.edge_id, pod, tier: 'exposure', label, provenance: [p] });
    }
    for (const record of view.tiers.vulnerability.records) {
      const label = `${record.cve_id} on ${pod} (${record.status}, ${record.attack_vector ?? 'no vector: treated as NETWORK'})`;
      add({ id: record.vuln_id, pod, tier: 'vulnerability', label, provenance: record.evidence });
      for (const p of record.evidence) add({ id: p.edge_id, pod, tier: 'vulnerability', label, provenance: [p] });
    }
    for (const record of view.tiers.reachability.records) {
      const label = `${pod} → ${record.dst}:${record.port}/${record.protocol}`;
      add({ id: record.edge_id, pod, tier: 'reachability', label, provenance: record.evidence });
    }
    for (const record of view.tiers.authorization.records) {
      const label = `${record.effect} on ${record.db} via ${record.role_arn.split('/').pop() ?? record.role_arn}`;
      add({ id: record.permission_id, pod, tier: 'authorization', label, provenance: record.evidence });
      for (const p of record.evidence) add({ id: p.edge_id, pod, tier: 'authorization', label, provenance: [p] });
    }
  }
  return index;
}

/** What makes each kind of attack step exist under ITM-1 (§6.2), in plain words. */
export const STEP_CONDITION: Record<string, { formula: string; words: string }> = {
  ENTRY: {
    formula: 'Exposed(p) ∧ NetVuln(p)',
    words: 'The workload is reachable from the Internet through an ingress and runs an active, network-exploitable vulnerability.',
  },
  LATERAL: {
    formula: 'EffReach(a, b) ∧ NetVuln(b)',
    words: 'An observed flow from a to b is allowed by the egress policies, and b runs an active, network-exploitable vulnerability.',
  },
  GOAL: {
    formula: 'EffReach(a, t) ∧ Authorized(a, t)',
    words: 'An allowed observed flow from a reaches the crown jewel, and a holds an Allow grant on it.',
  },
};
