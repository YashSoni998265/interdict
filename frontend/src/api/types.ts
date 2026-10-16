/**
 * Wire types for the Interdict API. They mirror backend/src/interdict/views.py and events.py
 * exactly (the JSON views shared by the API, the MCP tools and the UI fixtures). The UI only
 * displays these values; it never derives a verdict from them (solution.md §11.2, "web").
 */

// ---------------------------------------------------------------------------------------------
// Canonical status registry (solution.md §10.2, backend engine/statuses.py)
// ---------------------------------------------------------------------------------------------

export type CollectionStatus =
  | 'COLLECTED_COMPLETE'
  | 'COLLECTED_EMPTY'
  | 'QUERY_FAILED'
  | 'STALE_EXPIRED'
  | 'UNCOLLECTED';

export type InvestigationStatus = 'QUALIFYING_MODELED_CHAIN' | 'NOT_QUALIFIED' | 'INCONCLUSIVE';

export type InconclusiveReason =
  | 'QUERY_FAILED'
  | 'STALE_EVIDENCE'
  | 'UNCOLLECTED_EVIDENCE'
  | 'UNVERIFIED_EVIDENCE'
  | 'CONTRADICTORY_EVIDENCE'
  | 'INVENTORY_INCOMPLETE'
  | 'METHOD_DISAGREEMENT'
  | 'REVISION_CHANGED';

export type AlertTriageClass =
  | 'ON_ATTACK_PATH'
  | 'NOT_ON_ATTACK_PATH'
  | 'NOT_ACTIONABLE'
  | 'TRIAGE_INCONCLUSIVE';

export type AttackPathRole = 'ENTRY' | 'LATERAL' | 'FINAL_HOP';

export type PlanStatus = 'PLAN_FOUND' | 'NO_FEASIBLE_PLAN_WITHIN_K' | 'PLANNING_INCONCLUSIVE';
export type NoPlanReason = 'K_EXCEEDED' | 'UNKNOWN_IMPACT_EXCLUDED' | 'NO_ELIGIBLE_ACTION';
export type PlanningInconclusiveReason =
  | 'SCOPE_INCOMPLETE'
  | 'CATALOGUE_TOO_LARGE'
  | 'CHAIN_ENUMERATION_TRUNCATED';
export type PlanOptimality = 'EXACT_WITHIN_K' | 'NOT_EXACT';
export type ImpactStatus = 'KNOWN_ZERO_DISRUPTION' | 'KNOWN_DISRUPTION' | 'IMPACT_PARTIALLY_UNKNOWN';
export type DependencyManifest = 'COMPLETE' | 'PARTIAL' | 'NONE';

export type SimulationStatus =
  | 'SIMULATED_CONTAINMENT'
  | 'SIMULATED_RESIDUAL_EXPOSURE'
  | 'SIMULATION_REJECTED'
  | 'SIMULATION_INCONCLUSIVE';

/** A hunt ends in a simulation status, or in the planner's status when re-planning fails. */
export type HuntStatus = SimulationStatus | Exclude<PlanStatus, 'PLAN_FOUND'>;

export type CertificateStatus = 'VALID' | 'EXPIRED' | 'SUPERSEDED' | 'REVERIFICATION_FAILED';

export type SandboxOpResult =
  | 'APPLIED'
  | 'REJECTED_VALIDATION'
  | 'REJECTED_UNAUTHORIZED'
  | 'REJECTED_LIMIT'
  | 'REJECTED_CONTRADICTS_POLICY';

export type GatewayRejection =
  | 'UNAUTHORIZED_ACTION'
  | 'STALE_REVISION_REJECTED'
  | 'MISSING_CERTIFICATE'
  | 'LIVE_MODE_DISABLED';

export type LifecycleState =
  | 'INGESTED'
  | 'TRIAGING'
  | 'ANALYZING'
  | 'EVALUATING'
  | 'PLANNING'
  | 'HUNTING'
  | 'SIMULATING'
  | 'CANDIDATE_EVALUATED'
  | 'AWAITING_APPROVAL'
  | 'EXECUTING'
  | 'VERIFYING';

export type ActionVariant = 'EGRESS_DECLARED' | 'EGRESS_STRICT' | 'EGRESS_DENY_ALL';
export type AttackStepKind = 'ENTRY' | 'LATERAL' | 'GOAL';

/** Free text that came from the graph. Render as plain text only, never as markup (§10.8). */
export interface UntrustedText {
  untrusted_text: string;
}

// ---------------------------------------------------------------------------------------------
// Storm (GET /api/storm)
// ---------------------------------------------------------------------------------------------

export interface QueryRecord {
  id: string;
  template: string;
  rows: number;
  latency_ms: number;
  error: string | null;
}

export interface ScopeIssue {
  reason: InconclusiveReason;
  detail: string;
  evidence_ids: string[];
}

export type FunnelStageName =
  | 'alerts'
  | 'actionable'
  | 'on_attack_path'
  | 'workloads_on_path'
  | 'chains_within_bound'
  | 'clusters';

export interface FunnelStage {
  stage: FunnelStageName;
  count: number;
  truncated?: boolean;
}

export interface ChainView {
  id: string;
  pods: string[];
  target: string;
  lateral_hops: number;
  /** Internet id, the pods in order, then the crown jewel. */
  path: string[];
}

export interface ClusterView {
  id: string;
  target: string;
  entry_ingress: string;
  chain_ids: string[];
  workloads: string[];
  /** True when the path is longer than the planner's 3-hop bound (found by reachability). */
  beyond_bound: boolean;
  witness_path: string[];
}

export interface TierSummary {
  status: CollectionStatus;
  rows: number;
  stale: number;
  unverified: number;
  error: string | null;
}

export interface GraphStats {
  pods: number;
  crown_jewels: string[];
  observed_flows: number;
  vulnerability_findings: number;
}

export interface AttackStepCounts {
  entry: number;
  lateral: number;
  goal: number;
  total: number;
}

export interface AlertView {
  alert_id: string;
  pod: string;
  vuln_id: string;
  cve_id: string;
  severity: string;
  triage_class: AlertTriageClass;
  roles: AttackPathRole[];
  reason: string;
  title: UntrustedText | null;
  scanner: string | null;
  created_at: string | null;
}

export interface StormView {
  storm_id: string;
  revision: number;
  evaluated_at: string;
  complete: boolean;
  issues: ScopeIssue[];
  total_alerts: number;
  counts: Record<AlertTriageClass, number>;
  funnel: FunnelStage[];
  workloads_on_path: string[];
  roles: Record<string, AttackPathRole[]>;
  chains: ChainView[];
  clusters: ClusterView[];
  chain_enumeration_truncated: boolean;
  missing_attack_vector: number;
  attack_steps: AttackStepCounts | null;
  tiers: Record<string, TierSummary>;
  graph_stats: GraphStats;
  queries: QueryRecord[];
  /** Present on GET /api/storm; omitted inside tool results. */
  alerts?: AlertView[];
}

// ---------------------------------------------------------------------------------------------
// Focused attack subgraph (GET /api/clusters/{id}/subgraph)
// ---------------------------------------------------------------------------------------------

export interface InternetNodeView {
  id: string;
  kind: 'Internet';
  label: string;
}

export interface PodNodeView {
  id: string;
  kind: 'Pod';
  label: string;
  namespace: string;
  app: string;
  roles: AttackPathRole[];
  alerts: number;
  network_cves: string[];
  exposed_via: string[];
}

export interface DatabaseNodeView {
  id: string;
  kind: 'Database';
  label: string;
  crown_jewel: boolean;
}

export type SubgraphNodeView = InternetNodeView | PodNodeView | DatabaseNodeView;

export interface SubgraphEdgeView {
  id: string;
  source: string;
  target: string;
  kind: AttackStepKind | null;
  ports: number[];
  technique_id: string | null;
  technique: string | null;
  backing_evidence_ids: string[];
  /** Action ids of the verified plan that remove this step. */
  cut_by: string[];
}

export interface SubgraphView {
  revision: number;
  nodes: SubgraphNodeView[];
  edges: SubgraphEdgeView[];
}

// ---------------------------------------------------------------------------------------------
// Workload evidence (GET /api/workloads/{pod_id}/evidence)
// ---------------------------------------------------------------------------------------------

export type Freshness = 'fresh' | 'stale' | 'unverified';

export interface ProvenanceView {
  edge_id: string;
  verified: boolean | null;
  observed_at: string | null;
  valid_until: string | null;
  evidence_source: string | null;
  freshness: Freshness;
}

export interface ExposureRecord {
  ingress: string;
  service: string;
  evidence: ProvenanceView[];
}

export interface VulnerabilityRecord {
  vuln_id: string;
  cve_id: string;
  status: string;
  attack_vector: string | null;
  severity: string;
  cvss: number | null;
  network_exploitable: boolean;
  evidence: ProvenanceView[];
}

export interface ReachabilityRecord {
  edge_id: string;
  dst: string;
  dst_kind: string;
  port: number;
  protocol: string;
  evidence: ProvenanceView[];
}

export interface AuthorizationRecord {
  db: string;
  role_arn: string;
  permission_id: string;
  effect: string;
  evidence: ProvenanceView[];
}

export interface TierRecords<T> {
  status: CollectionStatus;
  records: T[];
}

export type EvidenceTierName = 'exposure' | 'vulnerability' | 'reachability' | 'authorization';

export interface WorkloadEvidenceView {
  pod: {
    id: string;
    namespace: string;
    app: string;
    dependency_manifest: DependencyManifest;
    reach_status: string;
  };
  revision: number;
  evaluated_at: string;
  tiers: {
    exposure: TierRecords<ExposureRecord>;
    vulnerability: TierRecords<VulnerabilityRecord>;
    reachability: TierRecords<ReachabilityRecord>;
    authorization: TierRecords<AuthorizationRecord>;
  };
  egress_policies: string[];
  egress_isolated: boolean;
  declared_dependencies: { id: string | null; dst: string; port: number; protocol: string }[];
}

// ---------------------------------------------------------------------------------------------
// Plans (POST /api/plans)
// ---------------------------------------------------------------------------------------------

export interface AllowRule {
  dst: string;
  port: number;
  protocol: string;
}

export interface CandidatePolicySpec {
  candidate_action_id: string;
  action_type: string;
  policy_spec: {
    name: string;
    namespace: string;
    pod_selector: string;
    policy_types: string[];
    allows_egress: { destination_id: string; port: number; protocol: string }[];
  };
}

export interface ActionView {
  id: string;
  namespace: string;
  app: string;
  variant: ActionVariant;
  pods: string[];
  allow: AllowRule[];
  /** Observed flow ids (CAN_REACH) this action blocks. */
  blocked: string[];
  /** [source, destination] pairs of attack steps this action removes. */
  removed_steps: [string, string][];
  /** Declared dependency ids (DEPENDS_ON) this action breaks. */
  known_broken: string[];
  /** Blocked flow ids with unknown impact (PARTIAL/NONE manifests). */
  unknown: string[];
  policy_spec: CandidatePolicySpec;
}

export interface PlanObjective {
  known_broken: number;
  unknown: number;
  actions: number;
  blocked: number;
}

export interface PlanView {
  id: string;
  action_ids: string[];
  actions: ActionView[];
  covered: string[];
  known_broken: string[];
  unknown: string[];
  blocked: string[];
  impact_status: ImpactStatus;
  objective: PlanObjective;
}

export interface FlowRef {
  src: string;
  dst: string;
  port: number;
  protocol: string;
}

export interface IneligibleSelector {
  namespace: string;
  app: string;
  reason: string;
  policies: string[];
}

export interface PlanReportView {
  /**
   * Handle to pass to POST /api/hunts (the API's id for this stored plan report). Null unless
   * status is PLAN_FOUND. Not the engine's `plan.id`; the recorded fixtures lack it, so callers
   * fall back to `plan.id` (see planHandle in lib/plan.ts).
   */
  plan_id?: string | null;
  t_scope?: string[];
  cluster_id?: string;
  status: PlanStatus;
  revision: number;
  k: number;
  strict: boolean;
  /** Chain ids in the constraint set C. */
  chains: string[];
  inconclusive_reason: PlanningInconclusiveReason | null;
  plan: PlanView | null;
  optimality: PlanOptimality | null;
  alternatives: PlanView[];
  hard_isolation: PlanView | null;
  best_partial: PlanView | null;
  uncovered: string[];
  no_plan_reason: NoPlanReason | null;
  feasible_plans: number;
  subsets_evaluated: number;
  catalogue: ActionView[];
  ineligible: IneligibleSelector[];
  /** Names every flow and dependency id mentioned above. */
  flows: Record<string, FlowRef>;
}

export interface PlanRequest {
  cluster_id: string;
  require_known_impact: boolean;
}

// ---------------------------------------------------------------------------------------------
// Path Hunter (POST /api/hunts)
// ---------------------------------------------------------------------------------------------

export interface HuntRoundView {
  round: number;
  plan_id: string;
  action_ids: string[];
  /** Observed flows the candidate policies pruned in FalkorDB. */
  pruned: string[];
  attack_steps: number;
  /** Method E: bounded chains to T_scope in the candidate graph. */
  e_chains: string[];
  /** Method F: max-flow value per crown jewel. */
  f_values: Record<string, number>;
  /** Method O: crown jewels the oracle reaches. */
  o_reachable: string[];
  witnesses: Record<string, string[]>;
  residuals: string[];
  out_of_scope: string[];
  latency_ms: { E: number; F: number; O: number; round: number };
}

export interface HuntReportView {
  /** The plan handle the hunt started from (present on the API, absent in fixtures). */
  plan_id?: string | null;
  status: HuntStatus;
  reason: string | null;
  detail: string;
  t_scope: string[];
  revision: number;
  evaluated_at: string;
  rounds: HuntRoundView[];
  /** The final plan report (after re-planning). */
  plan: PlanReportView | null;
  chains: ChainView[];
  residual_paths: string[][];
  out_of_scope_residuals: string[];
  certificate: CertificateView | null;
  queries: QueryRecord[];
}

export interface HuntRequest {
  plan_id: string;
}

// ---------------------------------------------------------------------------------------------
// Certificate (GET /api/certificates/{id}; solution.md §9.2)
// ---------------------------------------------------------------------------------------------

export interface CertificateView {
  certificate_id: string;
  claim: 'MODEL_VERIFIED_CONTAINMENT';
  status: CertificateStatus;
  issued_at: string;
  expires_at: string;
  evaluation_time: string;
  snapshot: {
    sandbox_graph_key: string;
    sandbox_revision: number;
    baseline_snapshot_hash: string;
    candidate_graph_key: string;
    candidate_snapshot_hash: string;
  };
  threat_model: {
    id: string;
    constants: {
      max_lateral_hops_planner: number;
      max_plan_actions: number;
      max_hunt_rounds: number;
    };
    relationship_types: string[];
    t_scope: string[];
    over_approximations: {
      missing_attack_vector_count: number;
      ingress_policies_ignored: boolean;
    };
  };
  evidence: {
    completeness: Record<string, string | boolean | null>;
    freshness: {
      earliest_valid_until: string;
      stale_items: number;
      unverified_items: number;
    };
  };
  plan: {
    plan_id: string;
    actions: CandidatePolicySpec[];
    optimality: PlanOptimality | (string & {});
    impact_status: ImpactStatus;
    known_broken: string[];
    unknown_impact: string[];
  };
  verification: {
    enumerator_E: { chains_found: number; template: string; latency_ms: number };
    maxflow_F: {
      value_t_scope: number;
      value_all_crown_jewels: number;
      per_target?: Record<string, number>;
      template: string;
      latency_ms: number;
    };
    oracle_O: {
      reachable_targets: string[];
      method?: string;
      version: string;
      latency_ms?: number;
    };
    agreement: boolean;
    rounds: { round: number; plan_id: string; residual_chain_ids: string[] }[];
    out_of_scope_residuals: string[];
  };
  provenance: {
    engine_git_sha?: string;
    falkordb_version?: string;
    oracle_version?: string;
    audit_event_hash?: string | null;
  };
  exclusions: string;
  digest: string;
  /** The sandbox's revision when the status was recomputed (GET /api/certificates/{id}). */
  current_revision?: number;
}

// ---------------------------------------------------------------------------------------------
// Investigations (POST /api/investigations, SSE /events, GET /api/investigations/{id})
// ---------------------------------------------------------------------------------------------

export type InvestigationMode = 'agent' | 'deterministic';

interface EventBase {
  seq: number;
  at: string;
}

export interface LifecycleEvent extends EventBase {
  type: 'lifecycle';
  state: LifecycleState | (string & {});
}

export interface ToolCallEvent extends EventBase {
  type: 'tool_call';
  call_id: string;
  tool: string;
  input: Record<string, unknown>;
  why: string;
}

export interface ToolResultEvent extends EventBase {
  type: 'tool_result';
  call_id: string;
  tool: string;
  ok: boolean;
  summary: string;
  latency_ms: number;
  evidence_ids: string[];
  data: unknown;
}

export interface NarrationEvent extends EventBase {
  type: 'narration';
  text: string;
  /** "agent-thinking" is the model's summarised reasoning, shown de-emphasised. */
  source: 'agent' | 'deterministic' | 'agent-thinking' | (string & {});
}

/** Which mode actually ran: "agent", "deterministic" or "deterministic (agent fallback)". */
export type RanMode = 'agent' | 'deterministic' | 'deterministic (agent fallback)' | (string & {});

export interface LlmUsage {
  tool_calls?: number;
  usage?: Record<string, number>;
  estimated_cost_usd?: number;
}

export interface InvestigationReport {
  status: string;
  mode: RanMode;
  cluster_id: string;
  t_scope: string[];
  plan_id: string | null;
  certificate_id: string | null;
  headline: string;
  /** Warnings from the run, e.g. why agent mode fell back. */
  notes?: string[] | string;
  llm?: LlmUsage;
}

export interface ReportEvent extends EventBase {
  type: 'report';
  report: InvestigationReport;
}

export interface ErrorEvent extends EventBase {
  type: 'error';
  code: string;
  message: string;
}

export interface DoneEvent extends EventBase {
  type: 'done';
  status: string;
}

export type InvestigationEvent =
  | LifecycleEvent
  | ToolCallEvent
  | ToolResultEvent
  | NarrationEvent
  | ReportEvent
  | ErrorEvent
  | DoneEvent;

export type InvestigationEventType = InvestigationEvent['type'];

export const INVESTIGATION_EVENT_TYPES: readonly InvestigationEventType[] = [
  'lifecycle',
  'tool_call',
  'tool_result',
  'narration',
  'report',
  'error',
  'done',
];

export interface InvestigationRequest {
  cluster_id: string;
  mode: InvestigationMode;
}

/** POST /api/investigations; `mode` is what will run, which may differ from the request. */
export interface InvestigationStart {
  investigation_id: string;
  mode?: RanMode;
  notes?: string[] | string;
}

export interface InvestigationView {
  investigation_id: string;
  status: string;
  cluster_id: string;
  mode: RanMode;
  events: InvestigationEvent[];
  report: InvestigationReport | null;
}

/** Receipt returned by submit_remediation_execution through the Action Gateway. */
export interface GatewayReceipt {
  status: string;
  receipt_id: string;
  execution_mode: 'SIMULATION' | (string & {});
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// Sandbox, audit, session and system
// ---------------------------------------------------------------------------------------------

export type SandboxOperation =
  | { op: 'EXPOSE_WORKLOAD'; args: { pod_id: string } }
  | { op: 'ADD_LATERAL_REACH'; args: { src_pod_id: string; dst_pod_id: string; port: number } }
  | { op: 'EXPIRE_EVIDENCE'; args: { edge_ref: string } };

export type SandboxOpName = SandboxOperation['op'];

export interface SandboxOpResponse {
  op?: SandboxOpName;
  result: SandboxOpResult | (string & {});
  revision: number;
  detail: string;
  superseded_certificates: string[];
}

export interface SandboxResetResponse {
  revision: number;
}

export interface AuditEvent {
  seq: number;
  timestamp: string;
  event_type: string;
  graph_revision: number;
  payload_hash: string;
  prev_hash: string;
  hash: string;
  trace_id?: string;
  investigation_id?: string;
  certificate_id?: string;
  [key: string]: unknown;
}

export interface AuditPage {
  events: AuditEvent[];
  /** The server re-verified the whole hash chain for this page. */
  chain_valid?: boolean;
}

export interface SessionInfo {
  revision: number;
  storm_id: string;
  seed: number;
  alert_count?: number;
  created?: boolean | string;
}

export interface SessionResponse {
  session: SessionInfo;
  csrf_token: string;
}

export type NamedEntry = string | { name?: string; op?: string; description?: string };

export interface SystemView {
  falkordb_version: string;
  build_sha: string;
  seed: number;
  generator_version: string;
  dataset: string;
  live_mode: boolean;
  alert_count?: number;
  storm_id?: string;
  /** Model the agent uses, when one is configured. */
  agent_model?: string | null;
  /** False when no Claude API key is configured: runs are deterministic only. */
  agent_available?: boolean;
  /** MCP tools the agent may call. */
  tools?: NamedEntry[];
  sandbox_operations?: NamedEntry[];
  /** Present in the recorded fixture; the live API reports these through GET /api/storm. */
  graph_stats?: GraphStats;
  latencies_ms?: Record<string, number>;
  /** Day-1 gate fallbacks in force, when the API reports them (solution.md §17). */
  active_fallbacks?: string[];
}
