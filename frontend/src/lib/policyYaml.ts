import type { CandidatePolicySpec } from '@/api/types';

const q = (value: string) => JSON.stringify(value);

/**
 * The certified plan's candidate egress policies as YAML: the engine's own Kubernetes-style specs,
 * written out field for field. It is a record of what was verified in simulation, not a manifest
 * to apply as it is: destinations are workload ids in the synthetic graph, not label selectors.
 */
export function policyYaml(
  specs: readonly CandidatePolicySpec[],
  context: { planId: string; certificateId?: string | null; revision?: number | null },
): string {
  const header = [
    '# Interdict candidate egress policies: simulation only, never applied to a real cluster.',
    `# Plan ${context.planId}${context.certificateId ? `, certificate ${context.certificateId}` : ''}${
      context.revision != null ? `, sandbox revision ${context.revision}` : ''
    }.`,
    '# allows_egress lists the only destinations each workload may reach (workload ids in the synthetic graph).',
  ];
  const body = specs.flatMap((spec) => {
    const p = spec.policy_spec;
    return [
      `  - candidate_action_id: ${q(spec.candidate_action_id)}`,
      `    action_type: ${q(spec.action_type)}`,
      `    name: ${q(p.name)}`,
      `    namespace: ${q(p.namespace)}`,
      `    pod_selector: ${q(p.pod_selector)}`,
      `    policy_types: [${p.policy_types.map(q).join(', ')}]`,
      ...(p.allows_egress.length === 0
        ? ['    allows_egress: []']
        : [
            '    allows_egress:',
            ...p.allows_egress.flatMap((rule) => [
              `      - destination_id: ${q(rule.destination_id)}`,
              `        port: ${rule.port}`,
              `        protocol: ${q(rule.protocol)}`,
            ]),
          ]),
    ];
  });
  return [...header, 'policies:', ...(body.length > 0 ? body : ['  []']), ''].join('\n');
}
