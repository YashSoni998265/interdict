import { describe, expect, it } from 'vitest';

import { policyYaml } from './policyYaml';

describe('policyYaml', () => {
  it('writes each candidate policy field for field, with the simulation caveat', () => {
    const yaml = policyYaml(
      [
        {
          candidate_action_id: 'act:shop:auth:EGRESS_DECLARED',
          action_type: 'EGRESS_ALLOWLIST',
          policy_spec: {
            name: 'idt-candidate-auth-egress',
            namespace: 'shop',
            pod_selector: 'app=auth',
            policy_types: ['Egress'],
            allows_egress: [{ destination_id: 'billing-1', port: 8080, protocol: 'TCP' }],
          },
        },
      ],
      { planId: 'plan-1', certificateId: 'cert-1', revision: 3 },
    );
    expect(yaml).toContain('simulation only, never applied to a real cluster');
    expect(yaml).toContain('# Plan plan-1, certificate cert-1, sandbox revision 3.');
    expect(yaml).toContain('  - candidate_action_id: "act:shop:auth:EGRESS_DECLARED"');
    expect(yaml).toContain('    pod_selector: "app=auth"');
    expect(yaml).toContain('      - destination_id: "billing-1"\n        port: 8080\n        protocol: "TCP"');
  });

  it('marks a deny-all policy and an empty plan explicitly', () => {
    const denyAll = policyYaml(
      [
        {
          candidate_action_id: 'a',
          action_type: 't',
          policy_spec: { name: 'n', namespace: 's', pod_selector: 'app=x', policy_types: ['Egress'], allows_egress: [] },
        },
      ],
      { planId: 'p' },
    );
    expect(denyAll).toContain('    allows_egress: []');
    expect(policyYaml([], { planId: 'p' })).toContain('policies:\n  []');
  });
});
