/**
 * The one status language (solution.md §13.4): every engine status maps to the
 * same colour, icon and words in the graph, timeline, cards and certificate. Colour is never
 * the only signal; every descriptor carries an icon and a text label.
 *
 * The UI never decides a status. It only translates the engine's status strings.
 */
import type {
  ActionVariant,
  AttackPathRole,
  CollectionStatus,
  SandboxOpResult,
} from '@/api/types';

export type Tone =
  | 'red'
  | 'amber'
  | 'grey'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'violet'
  | 'neutral';

/** Icon names, mapped to glyphs in components/StatusIcon.tsx. */
export type StatusIconName =
  | 'alert'
  | 'shield'
  | 'dash'
  | 'split'
  | 'stop'
  | 'question'
  | 'check'
  | 'clock'
  | 'scissors'
  | 'dependency'
  | 'unlink'
  | 'plan'
  | 'ban'
  | 'x';

export interface StatusDescriptor {
  tone: Tone;
  icon: StatusIconName;
  label: string;
  /** One sentence for tooltips and screen readers. */
  description: string;
}

const REAL_PATH: StatusDescriptor = {
  tone: 'red',
  icon: 'alert',
  label: 'Real attack path (modelled)',
  description:
    'A modelled chain from the Internet reaches a crown jewel through this workload (threat model ITM-1).',
};

const NOT_ON_PATH: StatusDescriptor = {
  tone: 'amber',
  icon: 'shield',
  label: 'Vulnerable but not on any attack path',
  description:
    'The vulnerability is active and network-exploitable, but no Internet-to-crown-jewel path runs through this workload.',
};

const INCONCLUSIVE: StatusDescriptor = {
  tone: 'yellow',
  icon: 'question',
  label: 'Not enough fresh evidence',
  description:
    'Some evidence in scope was missing, stale, unverified or failed to load, so no verdict is given. Never treated as safe.',
};

const NO_LONGER_CURRENT: StatusDescriptor = {
  tone: 'grey',
  icon: 'clock',
  label: 'Certificate no longer current',
  description: 'The sandbox changed or the evidence expired after this certificate was issued.',
};

const STATUS: Record<string, StatusDescriptor> = {
  QUALIFYING_MODELED_CHAIN: REAL_PATH,
  ON_ATTACK_PATH: REAL_PATH,
  NOT_QUALIFIED: NOT_ON_PATH,
  NOT_ON_ATTACK_PATH: NOT_ON_PATH,
  NOT_ACTIONABLE: {
    tone: 'grey',
    icon: 'dash',
    label: 'Not actionable (inactive or not network-exploitable)',
    description:
      'The referenced vulnerability is fixed or inactive, or its attack vector is not NETWORK/ADJACENT.',
  },
  SIMULATED_RESIDUAL_EXPOSURE: {
    tone: 'orange',
    icon: 'split',
    label: 'Partly fixed: paths remain',
    description:
      'After the last allowed Hunter round, modelled paths to the target still survive the plan.',
  },
  NO_FEASIBLE_PLAN_WITHIN_K: {
    tone: 'orange',
    icon: 'stop',
    label: 'No safe plan within 3 changes',
    description:
      'No plan of at most 3 allowed policy changes closes every modelled path. No certificate is issued.',
  },
  INCONCLUSIVE,
  TRIAGE_INCONCLUSIVE: INCONCLUSIVE,
  PLANNING_INCONCLUSIVE: INCONCLUSIVE,
  SIMULATION_INCONCLUSIVE: INCONCLUSIVE,
  VERIFICATION_INCONCLUSIVE: INCONCLUSIVE,
  IMPACT_PARTIALLY_UNKNOWN: {
    tone: 'yellow',
    icon: 'question',
    label: 'Impact partly unknown',
    description:
      'Some blocked flows come from workloads whose dependency manifest is PARTIAL or NONE, so their impact is unknown (never counted as zero).',
  },
  KNOWN_ZERO_DISRUPTION: {
    tone: 'neutral',
    icon: 'dependency',
    label: 'Zero disruption of declared dependencies (synthetic fixture)',
    description:
      'No declared dependency is broken and no blocked flow has unknown impact. Declared dependencies are a synthetic model input, not production traffic.',
  },
  SIMULATED_CONTAINMENT: {
    tone: 'green',
    icon: 'check',
    label: 'Model-verified containment (simulation)',
    description:
      'Under ITM-1, on a hashed snapshot, no modelled chain reaches the target after the plan, and methods E, F and O agreed. Not real-world containment.',
  },
  VALID: {
    tone: 'green',
    icon: 'check',
    label: 'Certificate valid',
    description:
      'Issued at the current sandbox revision and before its expiry. It certifies a model result only.',
  },
  SUPERSEDED: { ...NO_LONGER_CURRENT, description: 'The sandbox changed after this certificate was issued.' },
  EXPIRED: { ...NO_LONGER_CURRENT, description: 'The evidence it rests on has passed its valid_until, or 24 hours passed.' },
  REVERIFICATION_FAILED: {
    ...NO_LONGER_CURRENT,
    description: 'Re-running the verification on the retained snapshot did not reproduce the certificate.',
  },
  CANDIDATE_CHANGE: {
    tone: 'violet',
    icon: 'scissors',
    label: 'Proposed policy change',
    description: 'A candidate egress allowlist, applied only to a copy of the graph. Nothing real is changed.',
  },
  PLAN_FOUND: {
    tone: 'neutral',
    icon: 'plan',
    label: 'Plan found',
    description: 'The exact search found a plan of at most 3 actions that cuts every chain in its constraint set.',
  },
  SIMULATION_REJECTED: {
    tone: 'red',
    icon: 'ban',
    label: 'Simulation rejected',
    description: 'The candidate policy parameters were unsupported or malformed.',
  },
  FAILED: {
    tone: 'red',
    icon: 'x',
    label: 'Run failed',
    description: 'The run stopped with an error before reaching a verdict. Nothing is concluded from it.',
  },
  BUDGET_EXHAUSTED: {
    tone: 'yellow',
    icon: 'question',
    label: 'Tool budget exhausted: partial findings',
    description: 'The investigation hit its tool-call or time cap before finishing.',
  },
  BLOCKED: {
    tone: 'grey',
    icon: 'ban',
    label: 'Blocked by the Action Gateway',
    description: 'The gateway refused the action (simulation only, certificate and revision checks).',
  },
  STALE_REVISION_REJECTED: {
    tone: 'grey',
    icon: 'clock',
    label: 'Rejected: the sandbox changed',
    description: 'The certificate was issued for an older sandbox revision.',
  },
};

/** Statuses whose label is followed by a reason (the inconclusive family and no-plan). */
export const INCONCLUSIVE_FAMILY = new Set([
  'INCONCLUSIVE',
  'TRIAGE_INCONCLUSIVE',
  'PLANNING_INCONCLUSIVE',
  'SIMULATION_INCONCLUSIVE',
  'VERIFICATION_INCONCLUSIVE',
]);

const UNKNOWN: StatusDescriptor = {
  tone: 'grey',
  icon: 'question',
  label: 'Unrecognised status',
  description: 'The API returned a status this version of the UI does not know.',
};

/**
 * The descriptor for an engine status string. `SIMULATED_CONTAINMENT` is only ever shown with a
 * certificate: without one the claim is withheld rather than displayed (§10.2).
 */
export function describeStatus(
  status: string,
  options: { hasCertificate?: boolean; knownBroken?: number } = {},
): StatusDescriptor {
  if (status === 'SIMULATED_CONTAINMENT' && options.hasCertificate === false) {
    return {
      tone: 'grey',
      icon: 'question',
      label: 'Containment claim withheld: no certificate',
      description: 'The engine reported containment without a certificate, so the claim is not shown.',
    };
  }
  if (status === 'KNOWN_DISRUPTION') {
    const n = options.knownBroken;
    const count = n === undefined ? 'N' : String(n);
    return {
      tone: 'neutral',
      icon: 'unlink',
      label: `Closes all modelled paths; breaks ${count} declared ${n === 1 ? 'dependency' : 'dependencies'}`,
      description:
        'Every modelled path is cut, at the cost of declared dependencies (synthetic fixture) listed below.',
    };
  }
  return STATUS[status] ?? { ...UNKNOWN, label: status };
}

/** Plain words for reason codes (InconclusiveReason, PlanningInconclusiveReason, NoPlanReason). */
export const REASON_TEXT: Record<string, string> = {
  QUERY_FAILED: 'A graph query failed, timed out or reached its row cap',
  STALE_EVIDENCE: 'Some evidence in scope is past its valid_until',
  UNCOLLECTED_EVIDENCE: 'Reachability was not collected for some workloads',
  UNVERIFIED_EVIDENCE: 'Some evidence in scope is unverified',
  CONTRADICTORY_EVIDENCE: 'An observed flow contradicts the egress policies in force',
  INVENTORY_INCOMPLETE: 'The workload inventory is incomplete',
  METHOD_DISAGREEMENT: 'The verification methods disagreed (logged as a defect)',
  REVISION_CHANGED: 'The sandbox changed during the run',
  SCOPE_INCOMPLETE: 'The evidence scope is incomplete',
  CATALOGUE_TOO_LARGE: 'More than 30 candidate actions; exact search was not attempted',
  CHAIN_ENUMERATION_TRUNCATED: 'Chain enumeration reached its cap; counts are lower bounds',
  K_EXCEEDED: 'No plan of at most 3 allowed policy changes closes every modelled path',
  UNKNOWN_IMPACT_EXCLUDED: 'Strict mode excluded every plan with unknown impact',
  NO_ELIGIBLE_ACTION: 'Some chain has no step that an eligible action can remove',
  INELIGIBLE_EXISTING_EGRESS_POLICY:
    'Already selected by an egress policy; a new allowlist cannot narrow it (union semantics)',
};

export function reasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  return REASON_TEXT[code] ?? code;
}

export interface CollectionDescriptor {
  mark: 'check' | 'cross' | 'stale' | 'unknown';
  tone: Tone;
  label: string;
}

/** Evidence tier marks for the checklist: ✓ present, ✗ verified absent, stale, unknown. */
export const COLLECTION_STATUS: Record<CollectionStatus, CollectionDescriptor> = {
  COLLECTED_COMPLETE: { mark: 'check', tone: 'neutral', label: 'Present: fresh and verified' },
  COLLECTED_EMPTY: { mark: 'cross', tone: 'neutral', label: 'Verified absent' },
  QUERY_FAILED: { mark: 'unknown', tone: 'yellow', label: 'Query failed: not enough fresh evidence' },
  STALE_EXPIRED: { mark: 'stale', tone: 'yellow', label: 'Stale: past valid_until' },
  UNCOLLECTED: { mark: 'unknown', tone: 'yellow', label: 'Not collected' },
};

export function describeCollection(status: string): CollectionDescriptor {
  return (
    COLLECTION_STATUS[status as CollectionStatus] ?? {
      mark: 'unknown',
      tone: 'yellow',
      label: status,
    }
  );
}

export const ROLE: Record<AttackPathRole, { label: string; description: string }> = {
  ENTRY: { label: 'Entry', description: 'Reached directly from the Internet and exploitable over the network.' },
  LATERAL: { label: 'Lateral', description: 'Taken over from another compromised workload.' },
  FINAL_HOP: {
    label: 'Final hop',
    description: 'Reaches the crown jewel over the network and holds an Allow grant on it.',
  },
};

export const VARIANT: Record<ActionVariant, { label: string; description: string }> = {
  EGRESS_DECLARED: {
    label: 'Allow declared dependencies',
    description: 'Allowlist = declared dependencies + DNS. Blocks every undeclared flow.',
  },
  EGRESS_STRICT: {
    label: 'Declared dependencies minus attack flows',
    description:
      'Allowlist = declared dependencies + DNS, minus attack destinations. Breaks the overlapping declared dependencies.',
  },
  EGRESS_DENY_ALL: {
    label: 'Hard isolation (deny all egress)',
    description: 'Empty allowlist: blocks all egress, DNS included. Breaks every declared dependency.',
  },
};

export const LIFECYCLE_LABEL: Record<string, string> = {
  INGESTED: 'Ingested',
  TRIAGING: 'Triaging the storm',
  ANALYZING: 'Analysing evidence',
  EVALUATING: 'Evaluating',
  PLANNING: 'Planning the fix',
  HUNTING: 'Hunting surviving paths',
  SIMULATING: 'Simulating',
  CANDIDATE_EVALUATED: 'Candidate evaluated',
  AWAITING_APPROVAL: 'Awaiting approval',
  EXECUTING: 'Recording (simulation only)',
  VERIFYING: 'Verifying',
};

export function lifecycleLabel(state: string): string {
  return LIFECYCLE_LABEL[state] ?? state;
}

export const SANDBOX_RESULT: Record<SandboxOpResult, { tone: Tone; icon: StatusIconName; label: string }> = {
  APPLIED: { tone: 'neutral', icon: 'check', label: 'Applied' },
  REJECTED_VALIDATION: { tone: 'grey', icon: 'ban', label: 'Rejected: invalid input' },
  REJECTED_UNAUTHORIZED: { tone: 'grey', icon: 'ban', label: 'Rejected: not allowed for this session' },
  REJECTED_LIMIT: { tone: 'grey', icon: 'ban', label: 'Rejected: operation limit reached' },
  REJECTED_CONTRADICTS_POLICY: {
    tone: 'grey',
    icon: 'ban',
    label: 'Rejected: contradicts the egress policies in force',
  },
};

export function describeSandboxResult(result: string): { tone: Tone; icon: StatusIconName; label: string } {
  return SANDBOX_RESULT[result as SandboxOpResult] ?? { tone: 'grey', icon: 'question', label: result };
}

/** CSS classes per tone, defined in styles/tones.css. */
export const TONE_CLASS: Record<Tone, { text: string; bg: string; border: string; dot: string; solid: string }> = {
  red: { text: 'tone-red-text', bg: 'tone-red-bg', border: 'tone-red-border', dot: 'tone-red-dot', solid: 'tone-red-solid' },
  amber: { text: 'tone-amber-text', bg: 'tone-amber-bg', border: 'tone-amber-border', dot: 'tone-amber-dot', solid: 'tone-amber-solid' },
  grey: { text: 'tone-grey-text', bg: 'tone-grey-bg', border: 'tone-grey-border', dot: 'tone-grey-dot', solid: 'tone-grey-solid' },
  orange: { text: 'tone-orange-text', bg: 'tone-orange-bg', border: 'tone-orange-border', dot: 'tone-orange-dot', solid: 'tone-orange-solid' },
  yellow: { text: 'tone-yellow-text', bg: 'tone-yellow-bg', border: 'tone-yellow-border', dot: 'tone-yellow-dot', solid: 'tone-yellow-solid' },
  green: { text: 'tone-green-text', bg: 'tone-green-bg', border: 'tone-green-border', dot: 'tone-green-dot', solid: 'tone-green-solid' },
  violet: { text: 'tone-violet-text', bg: 'tone-violet-bg', border: 'tone-violet-border', dot: 'tone-violet-dot', solid: 'tone-violet-solid' },
  neutral: { text: 'tone-neutral-text', bg: 'tone-neutral-bg', border: 'tone-neutral-border', dot: 'tone-neutral-dot', solid: 'tone-neutral-solid' },
};
