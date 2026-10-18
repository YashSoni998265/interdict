/**
 * Every number the UI displays has a defined source (solution.md §13.5). Components render
 * numbers through <Num metric=...>, which shows the category and formula in a tooltip, so no
 * figure appears without saying where it came from. There are no percentages, risk scores or
 * centrality values anywhere in the app.
 */

export type SourceCategory =
  | 'CALCULATED_GRAPH'
  | 'MEASURED_ALGO'
  | 'MEASURED_RUNTIME'
  /** Fixed by the threat model or the API contract, not computed per run. */
  | 'CONSTANT'
  /** A field recorded in the synthetic input data, shown as recorded. */
  | 'SYNTHETIC_INPUT';

export interface MetricSource {
  category: SourceCategory;
  /** Extra qualifier shown after the category, e.g. "over DECLARED_FIXTURE". */
  qualifier?: string;
  formula: string;
}

export const CATEGORY_TEXT: Record<SourceCategory, string> = {
  CALCULATED_GRAPH: 'Calculated from the graph',
  MEASURED_ALGO: 'Output of a graph algorithm',
  MEASURED_RUNTIME: 'Measured at runtime',
  CONSTANT: 'Fixed constant',
  SYNTHETIC_INPUT: 'Synthetic input data',
};

const graph = (formula: string, qualifier?: string): MetricSource => ({
  category: 'CALCULATED_GRAPH',
  formula,
  ...(qualifier ? { qualifier } : {}),
});

export const METRICS = {
  alertsTotal: graph('Alert nodes in the storm (evidence-alerts query).'),
  alertsPerClass: graph('§6.8 partition count: alerts given this triage class. Classes sum to the total.'),
  alertsActionable: graph('Alerts on an attack path + alerts not on any path (active, network-exploitable vulnerability).'),
  workloadsOnPath: graph('|Forward(Internet) ∩ Backward(crown jewels)| over ATTACK_STEP edges.'),
  chainsBounded: graph('Q-E1 result count after Python filtering (at most 3 lateral hops); "≥" if truncated.'),
  clusters: graph('Distinct (target, entry ingress) pairs among workloads on attack paths.'),
  clusterChains: graph('Bounded chains (at most 3 lateral hops) in this cluster.'),
  clusterWorkloads: graph('Workloads on this cluster’s attack paths.'),
  lateralHops: graph('LATERAL steps between the entry workload and the final hop.'),
  podAlerts: graph('Alerts that reference this workload (ON_WORKLOAD).'),
  attackSteps: graph('ATTACK_STEP edges built from fresh evidence (ENTRY + LATERAL + GOAL).'),
  tierRows: graph('Rows returned by the evidence tier query.'),
  evidenceRecords: graph('Records returned for this workload by the tier query.'),
  staleItems: graph('Evidence items in this tier past their valid_until at evaluation time.'),
  unverifiedItems: graph('Evidence items in this tier with verified = false or missing provenance.'),
  graphPods: graph('Pod nodes in the sandbox inventory.'),
  graphFlows: graph('Fresh observed CAN_REACH flows in the sandbox.'),
  graphFindings: graph('Vulnerability findings (image → vulnerability) in the sandbox.'),
  crownJewels: graph('Database nodes marked is_crown_jewel.'),
  missingVector: graph('Vulnerabilities with no attack_vector, treated as NETWORK (attacker-favourable).'),
  declaredBroken: graph(
    '|KnownBroken(S)|: declared DEPENDS_ON flows of the selected pods that the allowlists do not allow.',
    'over DECLARED_FIXTURE',
  ),
  unknownImpact: graph(
    '|Unknown(S)|: blocked flows from pods with a PARTIAL or NONE manifest that are not declared dependencies.',
  ),
  flowsBlocked: graph('|Blocked(S)|: fresh observed CAN_REACH flows that the allowlists do not allow.'),
  pathsSevered: graph('Chains hit by the plan / |C|, the chains in the constraint set.'),
  constraintChains: graph('|C|: chains in the constraint set (the cluster’s bounded chains plus any the Path Hunter added).'),
  stepsRemoved: graph('StepRemoved(a): LATERAL/GOAL steps from the selected pods whose every observed port is blocked.'),
  planActions: graph('|S|: actions in the plan (at most one per workload selector, at most 3).'),
  chainsCovered: graph('Chains in the constraint set that the plan cuts.'),
  eChains: graph('Method E: bounded chains (at most 3 lateral hops) to T_scope in the candidate graph (Q-E1).'),
  oReachable: graph('Method O: crown jewels reached by breadth-first search over the exported ATTACK_STEP edges.'),
  backingEvidence: graph('Evidence ids stored on the ATTACK_STEP edge (backing_evidence_ids) when the step was built.'),
  prunedFlows: graph('Observed flows FalkorDB removed in the candidate graph after applying the policies.'),
  residuals: graph('Surviving chains added to the constraint set: E’s chains plus the max-flow decomposition.'),
  revision: graph('Meta.revision of the sandbox graph; every sandbox change increments it in the same query.'),
  maxFlow: {
    category: 'MEASURED_ALGO',
    formula: 'algo.maxFlow from Internet to the crown jewel over ATTACK_STEP, capacity 1 per edge (Q-F1).',
  },
  huntRoundsRun: {
    category: 'MEASURED_ALGO',
    formula: 'Rounds the Path Hunter ran; each applies the plan to a fresh candidate graph and runs E, F and O.',
  },
  subsetsEvaluated: {
    category: 'MEASURED_ALGO',
    formula: 'Action subsets of size ≤ 3 that the exact search evaluated.',
  },
  feasiblePlans: {
    category: 'MEASURED_ALGO',
    formula: 'Evaluated subsets that cut every chain and satisfy every feasibility rule.',
  },
  queryLatency: {
    category: 'MEASURED_RUNTIME',
    formula: 'time.perf_counter() around the query template.',
  },
  toolLatency: {
    category: 'MEASURED_RUNTIME',
    formula: 'Wall-clock time of the tool call, as reported in the tool result.',
  },
  methodLatency: {
    category: 'MEASURED_RUNTIME',
    formula: 'time.perf_counter() around this verification method in the round.',
  },
  roundLatency: {
    category: 'MEASURED_RUNTIME',
    formula: 'time.perf_counter() around the whole round: copy, apply, rebuild and E/F/O.',
  },
  maxPlanActions: { category: 'CONSTANT', formula: 'k = 3: the planner considers plans of at most 3 actions (ITM-1).' },
  maxLateralHops: { category: 'CONSTANT', formula: 'The planner enumerates chains of at most 3 lateral hops (ITM-1).' },
  maxHuntRounds: { category: 'CONSTANT', formula: 'The Path Hunter stops after at most 5 rounds (R = 5).' },
  maxOperations: { category: 'CONSTANT', formula: 'Sandbox operations allowed per session (§10.7).' },
  sessionOperations: {
    category: 'CALCULATED_GRAPH',
    formula: 'Sandbox operations the API reported as APPLIED in this browser session (each one bumped Meta.revision).',
  },
  cvss: {
    category: 'SYNTHETIC_INPUT',
    formula: 'CVSS base score recorded in the synthetic vulnerability record; not computed by Interdict.',
  },
} satisfies Record<string, MetricSource>;

export type MetricId = keyof typeof METRICS;
