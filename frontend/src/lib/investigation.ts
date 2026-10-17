/**
 * Turns the investigation event stream into timeline items. This is bookkeeping only: it pairs
 * tool calls with their results and picks out the engine reports they carry. It never infers a
 * verdict; statuses come from the events themselves.
 */
import type {
  DoneEvent,
  ErrorEvent,
  GatewayReceipt,
  HuntReportView,
  InvestigationEvent,
  InvestigationReport,
  LifecycleEvent,
  NarrationEvent,
  PlanReportView,
  RanMode,
  ReportEvent,
  StormView,
  ToolCallEvent,
  ToolResultEvent,
  WorkloadEvidenceView,
  ChainView,
} from '@/api/types';

export interface ToolStep {
  callId: string;
  tool: string;
  call: ToolCallEvent | undefined;
  result: ToolResultEvent | undefined;
  state: 'running' | 'ok' | 'failed';
}

export type TimelineItem =
  | { kind: 'lifecycle'; seq: number; event: LifecycleEvent }
  | { kind: 'step'; seq: number; step: ToolStep }
  | { kind: 'narration'; seq: number; event: NarrationEvent }
  | { kind: 'report'; seq: number; event: ReportEvent }
  | { kind: 'error'; seq: number; event: ErrorEvent }
  | { kind: 'done'; seq: number; event: DoneEvent };

export interface DerivedInvestigation {
  items: TimelineItem[];
  lifecycle: LifecycleEvent[];
  currentState: string | null;
  steps: ToolStep[];
  report: InvestigationReport | null;
  done: DoneEvent | null;
  errors: ErrorEvent[];
  /** Which mode ran: from the report, or from the agent's narration while running. */
  ranMode: RanMode | null;
  /** Warnings attached to the final report. */
  notes: string[];
  firstAt: string | null;
  lastSeq: number;
  storm: StormView | undefined;
  evidence: WorkloadEvidenceView | undefined;
  chains: { target_db_id: string; chains: ChainView[]; truncated: boolean } | undefined;
  plan: PlanReportView | undefined;
  hunt: HuntReportView | undefined;
  receipt: GatewayReceipt | undefined;
}

/** Sort by seq and drop duplicates (a resumed stream may repeat events). */
export function normaliseEvents(events: readonly InvestigationEvent[]): InvestigationEvent[] {
  const bySeq = new Map<number, InvestigationEvent>();
  for (const event of events) if (!bySeq.has(event.seq)) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function deriveInvestigation(input: readonly InvestigationEvent[]): DerivedInvestigation {
  const events = normaliseEvents(input);
  const items: TimelineItem[] = [];
  const steps = new Map<string, ToolStep>();
  const lifecycle: LifecycleEvent[] = [];
  const errors: ErrorEvent[] = [];
  let report: InvestigationReport | null = null;
  let done: DoneEvent | null = null;
  let agentNarration = false;
  const derived: Pick<DerivedInvestigation, 'storm' | 'evidence' | 'chains' | 'plan' | 'hunt' | 'receipt'> = {
    storm: undefined,
    evidence: undefined,
    chains: undefined,
    plan: undefined,
    hunt: undefined,
    receipt: undefined,
  };

  for (const event of events) {
    switch (event.type) {
      case 'lifecycle':
        lifecycle.push(event);
        items.push({ kind: 'lifecycle', seq: event.seq, event });
        break;
      case 'tool_call': {
        const step: ToolStep = { callId: event.call_id, tool: event.tool, call: event, result: undefined, state: 'running' };
        steps.set(event.call_id, step);
        items.push({ kind: 'step', seq: event.seq, step });
        break;
      }
      case 'tool_result': {
        let step = steps.get(event.call_id);
        if (!step) {
          // A result without its call (for example after a partial resume): still show it.
          step = { callId: event.call_id, tool: event.tool, call: undefined, result: undefined, state: 'running' };
          steps.set(event.call_id, step);
          items.push({ kind: 'step', seq: event.seq, step });
        }
        step.result = event;
        step.state = event.ok ? 'ok' : 'failed';
        if (event.ok) collect(event, derived);
        break;
      }
      case 'narration':
        if (event.source === 'agent') agentNarration = true;
        items.push({ kind: 'narration', seq: event.seq, event });
        break;
      case 'report':
        report = event.report;
        items.push({ kind: 'report', seq: event.seq, event });
        break;
      case 'error':
        errors.push(event);
        items.push({ kind: 'error', seq: event.seq, event });
        break;
      case 'done':
        done = event;
        items.push({ kind: 'done', seq: event.seq, event });
        break;
    }
  }

  return {
    items,
    lifecycle,
    currentState: lifecycle.at(-1)?.state ?? null,
    steps: [...steps.values()],
    report,
    done,
    errors,
    ranMode: report?.mode ?? (agentNarration ? 'agent' : null),
    notes: toNotes(report?.notes),
    firstAt: events[0]?.at ?? null,
    lastSeq: events.at(-1)?.seq ?? 0,
    ...derived,
  };
}

/** Notes may arrive as a list or a single string. */
export function toNotes(notes: string[] | string | null | undefined): string[] {
  if (!notes) return [];
  return (Array.isArray(notes) ? notes : [notes]).filter((n) => n.trim().length > 0);
}

function collect(
  event: ToolResultEvent,
  into: Pick<DerivedInvestigation, 'storm' | 'evidence' | 'chains' | 'plan' | 'hunt' | 'receipt'>,
): void {
  switch (event.tool) {
    case 'triage_alert_storm':
      into.storm = event.data as StormView;
      break;
    case 'find_evidence_by_workload':
      into.evidence = event.data as WorkloadEvidenceView;
      break;
    case 'find_attack_paths_to_asset':
      into.chains = event.data as DerivedInvestigation['chains'];
      break;
    case 'plan_remediation':
      into.plan = event.data as PlanReportView;
      break;
    case 'hunt_residual_paths':
      into.hunt = event.data as HuntReportView;
      break;
    case 'submit_remediation_execution':
      into.receipt = event.data as GatewayReceipt;
      break;
    default:
      break;
  }
}

/** Plain-language step titles (§13.1: plain title, why this tool, result, proof). */
export function toolTitle(tool: string, input: Record<string, unknown> | undefined): string {
  const arg = (key: string) => {
    const value = input?.[key];
    return typeof value === 'string' ? value : undefined;
  };
  switch (tool) {
    case 'triage_alert_storm':
      return 'Triage the alert storm';
    case 'find_evidence_by_workload':
      return `Check the four evidence tiers for ${arg('pod_id') ?? 'the workload'}`;
    case 'find_attack_paths_to_asset':
      return `List attack chains to ${arg('target_db_id') ?? 'the crown jewel'}`;
    case 'plan_remediation':
      return input?.require_known_impact === true ? 'Plan a fix with fully known impact' : 'Plan the cheapest safe fix';
    case 'hunt_residual_paths':
      return 'Hunt for paths that survive the plan';
    case 'submit_remediation_execution':
      return 'Record the verified fix (simulation only)';
    case 'recall_incident_memory':
      return 'Recall earlier findings for these assets';
    case 'get_alert_context':
      return `Read alert ${arg('alert_id') ?? ''}`.trim();
    case 'verify_certificate':
      return 'Re-verify the certificate';
    default:
      return tool;
  }
}

/** The tool sequence a typical run uses (§10.5), shown before the first run. */
export const TYPICAL_RUN = [
  'triage_alert_storm',
  'recall_incident_memory',
  'find_evidence_by_workload',
  'find_attack_paths_to_asset',
  'plan_remediation',
  'hunt_residual_paths',
  'submit_remediation_execution',
] as const;

/** Lifecycle states a typical run passes through, used to draw the progress rail. */
export const TYPICAL_LIFECYCLE = ['TRIAGING', 'ANALYZING', 'PLANNING', 'HUNTING', 'EXECUTING'] as const;

/**
 * States for the progress rail: the states seen so far, in the order they happened, with the
 * typical states not yet seen slotted in at their usual position.
 */
export function railStates(seen: readonly string[]): string[] {
  const result = seen.filter((state, index) => seen.indexOf(state) === index);
  TYPICAL_LIFECYCLE.forEach((state, index) => {
    if (result.includes(state)) return;
    const next = TYPICAL_LIFECYCLE.slice(index + 1).find((s) => result.includes(s));
    if (next) result.splice(result.indexOf(next), 0, state);
    else result.push(state);
  });
  return result;
}

/** Which mode ran, in words (the report or the start response says). */
export function ranModeText(mode: string | null | undefined): string {
  if (!mode) return 'Not run yet';
  if (mode === 'agent') return 'Decision agent: each step decided by written rules from the graph’s answers, no AI model';
  return mode;
}
