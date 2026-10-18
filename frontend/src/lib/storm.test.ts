import { describe, expect, it } from 'vitest';

import { fixtures } from '@/api/mock/fixtures';
import type { AlertTriageClass, AlertView } from '@/api/types';

import { clusterOfPod, restraintExample } from './storm';

// restraintExample reads only the CVE, the pod and the triage class; the other fields just fill the type.
function makeAlert(cve: string, pod: string, triageClass: AlertTriageClass): AlertView {
  return {
    alert_id: 'alt-test',
    pod,
    vuln_id: 'vuln-test',
    cve_id: cve,
    severity: 'HIGH',
    triage_class: triageClass,
    roles: [],
    reason: '',
    title: null,
    scanner: null,
    created_at: null,
  };
}

describe('restraintExample', () => {
  it('returns null when there are no alerts', () => {
    expect(restraintExample(undefined)).toBeNull();
    expect(restraintExample([])).toBeNull();
  });

  it('returns null when no CVE has both an on-path and an off-path pod', async () => {
    const storm = await fixtures.storm();
    const withoutOffPath = storm.alerts!.filter((a) => a.triage_class !== 'NOT_ON_ATTACK_PATH');
    expect(restraintExample(withoutOffPath)).toBeNull();
    // Not-actionable and inconclusive alerts are on neither side, so neither CVE has a pair.
    expect(
      restraintExample([
        makeAlert('CVE-A', 'a-1', 'ON_ATTACK_PATH'),
        makeAlert('CVE-A', 'b-1', 'NOT_ACTIONABLE'),
        makeAlert('CVE-B', 'c-1', 'NOT_ON_ATTACK_PATH'),
        makeAlert('CVE-B', 'd-1', 'TRIAGE_INCONCLUSIVE'),
      ]),
    ).toBeNull();
  });

  it('when several CVEs have both, picks the one with the most alerts, counting alerts of every class', () => {
    // Without CVE-B's not-actionable alert this would be a tie, which CVE-A would win.
    expect(
      restraintExample([
        makeAlert('CVE-A', 'a-1', 'ON_ATTACK_PATH'),
        makeAlert('CVE-A', 'b-1', 'NOT_ON_ATTACK_PATH'),
        makeAlert('CVE-B', 'c-1', 'ON_ATTACK_PATH'),
        makeAlert('CVE-B', 'd-1', 'NOT_ON_ATTACK_PATH'),
        makeAlert('CVE-B', 'e-1', 'NOT_ACTIONABLE'),
      ]),
    ).toEqual({ cve: 'CVE-B', onPath: ['c-1'], notOnPath: ['d-1'] });
  });

  it('breaks a tie in alert count with the alphabetically first CVE id', () => {
    // CVE-B comes first, so input order alone would pick it.
    expect(
      restraintExample([
        makeAlert('CVE-B', 'c-1', 'ON_ATTACK_PATH'),
        makeAlert('CVE-B', 'd-1', 'NOT_ON_ATTACK_PATH'),
        makeAlert('CVE-A', 'a-1', 'ON_ATTACK_PATH'),
        makeAlert('CVE-A', 'b-1', 'NOT_ON_ATTACK_PATH'),
      ]),
    ).toEqual({ cve: 'CVE-A', onPath: ['a-1'], notOnPath: ['b-1'] });
  });

  it('lists each side’s pods once, in sorted order', () => {
    expect(
      restraintExample([
        makeAlert('CVE-A', 'web-1', 'ON_ATTACK_PATH'),
        makeAlert('CVE-A', 'api-1', 'ON_ATTACK_PATH'),
        makeAlert('CVE-A', 'web-1', 'ON_ATTACK_PATH'),
        makeAlert('CVE-A', 'worker-1', 'NOT_ON_ATTACK_PATH'),
        makeAlert('CVE-A', 'cron-1', 'NOT_ON_ATTACK_PATH'),
        makeAlert('CVE-A', 'worker-1', 'NOT_ON_ATTACK_PATH'),
      ]),
    ).toEqual({ cve: 'CVE-A', onPath: ['api-1', 'web-1'], notOnPath: ['cron-1', 'worker-1'] });
  });
});

describe('clusterOfPod', () => {
  it('finds the cluster that a workload on an attack path belongs to', async () => {
    const storm = await fixtures.storm();
    expect(clusterOfPod(storm, 'auth-1')?.id).toBe('cluster-prod-payments-db-ing-auth');
    // The shop cluster has two workloads, and each of them finds it.
    expect(clusterOfPod(storm, 'checkout-1')?.id).toBe('cluster-prod-payments-db-ing-shop');
    expect(clusterOfPod(storm, 'frontend-1')?.id).toBe('cluster-prod-payments-db-ing-shop');
  });

  it('returns undefined for a workload on no attack path, and when there is no storm', async () => {
    const storm = await fixtures.storm();
    // batch-1 has alerts, but the engine put it on no attack path.
    expect(clusterOfPod(storm, 'batch-1')).toBeUndefined();
    expect(clusterOfPod(undefined, 'auth-1')).toBeUndefined();
  });
});
