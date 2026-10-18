import { describe, expect, it } from 'vitest';

import { fixtureNames, fixtures } from '@/api/mock/fixtures';

import { buildEvidenceIndex, tierOfEdge } from './evidence';

// One recorded edge id per prefix, all from auth-1's evidence (src/mocks/fixtures/evidence/auth-1.json).
const EDGES: [string, string][] = [
  ['ev-exposes-ing-auth', 'exposure'],
  ['ev-routes-ing-auth-svc-auth', 'exposure'],
  ['ev-targets-svc-auth-auth-1', 'exposure'],
  ['ev-runs-auth-1', 'vulnerability'],
  ['ev-hasvuln-vuln-img-shop-auth-DEMO-CVE-001', 'vulnerability'],
  ['ev-reach-auth-1-prod-payments-db-5432-tcp', 'reachability'],
  ['ev-assumes-auth-1', 'authorization'],
  ['ev-grants-perm-auth-role-prod-payments-db', 'authorization'],
  ['ev-applies-perm-auth-role-prod-payments-db', 'authorization'],
];

describe('tierOfEdge', () => {
  it.each(EDGES)('puts %s in the %s tier', (edgeId, tier) => {
    expect(tierOfEdge(edgeId)).toBe(tier);
  });

  it('falls back to "evidence" for vulnerability and permission ids, which are not edges', () => {
    expect(tierOfEdge('vuln-img-shop-auth-DEMO-CVE-001')).toBe('evidence');
    expect(tierOfEdge('perm-auth-role-prod-payments-db')).toBe('evidence');
  });

  it('falls back to "evidence" unless a known prefix, hyphen included, starts the id', () => {
    expect(tierOfEdge('ev-mounts-auth-1')).toBe('evidence');
    expect(tierOfEdge('ev-reach')).toBe('evidence');
    // A pod named dev-routes-1 puts 'ev-routes-' inside an id, so only the start of the id counts.
    for (const id of EDGES.map(([edgeId]) => `x-${edgeId}`)) expect(tierOfEdge(id), id).toBe('evidence');
    expect(tierOfEdge('')).toBe('evidence');
  });

  it('agrees with the evidence index on the tier of every recorded edge', async () => {
    // The index files an id under the tier of the record it sits in; tierOfEdge reads only the id.
    const views = await Promise.all(fixtureNames('evidence').map((pod) => fixtures.evidence(pod)));
    const edges = [...buildEvidenceIndex(views).values()].filter((entry) => entry.id.startsWith('ev-'));
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) expect(tierOfEdge(edge.id), edge.id).toBe(edge.tier);
  });
});
