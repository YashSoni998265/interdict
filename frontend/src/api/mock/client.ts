import type { ApiClient, StreamHandlers, StreamOptions, Unsubscribe } from '../client';
import { ApiError } from '../errors';
import type {
  AuditEvent,
  AuditPage,
  CertificateStatus,
  CertificateView,
  HuntReportView,
  HuntRequest,
  InvestigationEvent,
  InvestigationRequest,
  InvestigationStart,
  InvestigationView,
  PlanReportView,
  PlanRequest,
  SandboxOperation,
  SandboxOpResponse,
  SandboxResetResponse,
  SessionResponse,
  StormView,
  SubgraphView,
  SystemView,
  WorkloadEvidenceView,
} from '../types';
import { fixtureNames, fixtures } from './fixtures';
import { canonicalJson, sha256Hex } from './sha256';

/**
 * When the fixtures were recorded (storm.evaluated_at). The mock's clock starts here and runs
 * at real speed, so recorded certificates expire on the recording's schedule, not today's.
 */
export const RECORDED_AT = '2026-10-17T10:00:00Z';
/** The recorded scenario that plans for every crown jewel at once (NO_FEASIBLE_PLAN_WITHIN_K). */
export const ALL_CROWN_JEWELS = 'all-crown-jewels';

const ID_PATTERN = /^[a-z0-9-]{1,64}$/;
/** The MCP tools the recorded runs call, in order (fixtures/investigations). */
const RECORDED_TOOLS = [
  'triage_alert_storm',
  'find_evidence_by_workload',
  'find_attack_paths_to_asset',
  'plan_remediation',
  'hunt_residual_paths',
  'submit_remediation_execution',
] as const;
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const MAX_OPERATIONS = 20;

export interface MockApiOptions {
  /** Multiplier for simulated request latency: 1 is realistic, 0 is instant (tests). */
  latencyScale?: number;
  /** Gap between streamed investigation events in ms, [min, max]. */
  streamGapMs?: readonly [number, number];
}

interface MockRun {
  clusterId: string;
  events: InvestigationEvent[];
  emitted: InvestigationEvent[];
  listeners: Set<(event: InvestigationEvent) => void>;
  timer: ReturnType<typeof setTimeout> | undefined;
}

type RecordedHunt = HuntReportView & { certificate: CertificateView | null };

/**
 * Serves the real engine's recorded output (seed 20261018) with small realistic delays. It
 * cannot recompute: after a sandbox operation it keeps serving the revision-1 recording, which
 * the UI flags as computed at an older revision. Nothing here decides a verdict; statuses are
 * the recorded ones, except certificate validity, which follows the engine's own rule
 * (certificate.py: SUPERSEDED when the revision changed, EXPIRED after expires_at).
 */
export class MockApiClient implements ApiClient {
  readonly mode = 'mock' as const;

  private readonly latencyScale: number;
  private readonly gap: readonly [number, number];
  private readonly startedAt = Date.now();
  private revision = 1;
  private sessionCreated = false;
  private operations = 0;
  private runCounter = 0;
  private readonly runs = new Map<string, MockRun>();
  /** Certificates this session has been shown, with the revision they were issued for. */
  private readonly issued = new Map<string, number>();
  private readonly audit: AuditEvent[] = [];
  private readonly triagedRevisions = new Set<number>();
  private huntIndex: Promise<Map<string, string>> | null = null;
  private inventory: Promise<{ pods: Set<string>; evidence: Set<string> }> | null = null;

  constructor(options: MockApiOptions = {}) {
    this.latencyScale = options.latencyScale ?? 1;
    this.gap = options.streamGapMs ?? [250, 400];
  }

  now(): Date {
    return new Date(Date.parse(RECORDED_AT) + (Date.now() - this.startedAt));
  }

  async createSession(): Promise<SessionResponse> {
    await this.delay(80, 160);
    const storm = await fixtures.storm();
    if (!this.sessionCreated) {
      this.sessionCreated = true;
      this.log('SESSION_CREATED', { mode: 'mock' });
      this.log('SANDBOX_CREATED', { template: storm.storm_id, revision: this.revision });
    }
    return {
      session: {
        revision: this.revision,
        storm_id: storm.storm_id,
        seed: 20261018,
        alert_count: storm.total_alerts,
        created: true,
      },
      csrf_token: 'mock-session',
    };
  }

  async getStorm(): Promise<StormView> {
    await this.delay(180, 320);
    const storm = await fixtures.storm();
    if (!this.triagedRevisions.has(this.revision)) {
      this.triagedRevisions.add(this.revision);
      this.log('STORM_TRIAGED', {
        storm_id: storm.storm_id,
        computed_at_revision: storm.revision,
        alerts: storm.total_alerts,
      });
    }
    return storm;
  }

  /**
   * Like the API: without a plan handle, only the cluster's own paths and no cuts; with one,
   * the recorded view, which includes the hunt's residual paths and the verified plan's cuts.
   */
  async getSubgraph(clusterId: string, planId?: string | null): Promise<SubgraphView> {
    await this.delay(120, 240);
    const view = await fixtures.subgraph(this.checkId(clusterId, 'cluster'));
    if (!view) throw notFound(`No recorded subgraph for cluster ${clusterId}.`);
    if (planId) {
      this.checkId(planId, 'plan');
      return view;
    }
    const storm = await fixtures.storm();
    const cluster = storm.clusters.find((c) => c.id === clusterId);
    if (!cluster) return { ...view, edges: view.edges.map((e) => ({ ...e, cut_by: [] })) };
    const paths = storm.chains.filter((c) => cluster.chain_ids.includes(c.id)).map((c) => c.path);
    if (cluster.beyond_bound) paths.push(cluster.witness_path);
    const keep = new Set(paths.flatMap((path) => path.slice(1).map((node, i) => `${path[i]}->${node}`)));
    const edges = view.edges.filter((e) => keep.has(e.id)).map((e) => ({ ...e, cut_by: [] }));
    const nodes = new Set(edges.flatMap((e) => [e.source, e.target]));
    return { ...view, nodes: view.nodes.filter((n) => nodes.has(n.id)), edges };
  }

  async getWorkloadEvidence(podId: string): Promise<WorkloadEvidenceView> {
    await this.delay(90, 200);
    const view = await fixtures.evidence(this.checkId(podId, 'pod'));
    if (!view) {
      throw notFound(
        `No recorded evidence for ${podId}. The fixtures record evidence for workloads on attack paths only.`,
      );
    }
    return view;
  }

  async createPlan(request: PlanRequest): Promise<PlanReportView> {
    await this.delay(260, 480);
    const clusterId = this.checkId(request.cluster_id, 'cluster');
    if (request.require_known_impact) {
      throw new ApiError(
        'NOT_FOUND',
        'The recorded fixtures contain the default plan only; strict mode needs the live API.',
        404,
      );
    }
    const report = await fixtures.plan(clusterId);
    if (!report) throw notFound(`No recorded plan for cluster ${clusterId}.`);
    const storm = await fixtures.storm();
    const target = storm.clusters.find((c) => c.id === clusterId)?.target;
    // The recording has no API handle; the mock uses the engine's plan id as the handle.
    const handle = report.status === 'PLAN_FOUND' ? (report.plan?.id ?? null) : null;
    this.log('PLAN_COMPUTED', { cluster_id: clusterId, plan_id: handle, status: report.status });
    return { plan_id: handle, t_scope: target ? [target] : [], cluster_id: clusterId, ...report };
  }

  async createHunt(request: HuntRequest): Promise<HuntReportView> {
    await this.delay(650, 1000);
    const planId = this.checkId(request.plan_id, 'plan');
    const name = (await this.huntsByFirstPlan()).get(planId);
    const hunt = name ? await fixtures.hunt(name) : undefined;
    if (!hunt) throw notFound(`No recorded hunt starts from plan ${planId}.`);
    this.recordHunt(hunt, undefined);
    return { plan_id: planId, ...this.withCurrentCertificateStatus(hunt) };
  }

  /** Mock-only: a recorded engine run that has no REST route in this API version. */
  async getRecordedScenario(name: typeof ALL_CROWN_JEWELS): Promise<HuntReportView> {
    await this.delay(200, 400);
    const hunt = await fixtures.hunt(name);
    if (!hunt) throw notFound(`No recorded scenario ${name}.`);
    return hunt;
  }

  async startInvestigation(request: InvestigationRequest): Promise<InvestigationStart> {
    await this.delay(120, 240);
    const clusterId = this.checkId(request.cluster_id, 'cluster');
    const running = [...this.runs.values()].find((r) => r.emitted.length < r.events.length);
    if (running) {
      throw new ApiError(
        'BUSY',
        `An investigation is already running in this session (${running.clusterId}). Wait for it to finish.`,
        409,
      );
    }
    const recording = await fixtures.investigation(clusterId);
    if (!recording) throw notFound(`No recorded investigation for cluster ${clusterId}.`);

    this.runCounter += 1;
    const id = `inv-mock-${this.runCounter}-${clusterId.replace(/^cluster-/, '')}`.slice(0, 64);
    const run: MockRun = {
      clusterId,
      events: recording.events,
      emitted: [],
      listeners: new Set(),
      timer: undefined,
    };
    this.runs.set(id, run);
    this.log('INVESTIGATION_STARTED', {
      investigation_id: id,
      trace_id: id,
      cluster_id: clusterId,
      mode_requested: request.mode,
      recording: recording.investigation_id,
    });
    this.scheduleNext(id, run);
    return {
      investigation_id: id,
      mode: 'deterministic',
      notes:
        request.mode === 'agent'
          ? [
              'Mock API: agent mode is not available offline, so this replays the recorded deterministic run (no AI narrator).',
            ]
          : [],
    };
  }

  streamInvestigation(
    investigationId: string,
    handlers: StreamHandlers,
    options: StreamOptions = {},
  ): Unsubscribe {
    let active = true;
    let lastSeq = options.lastEventId ?? 0;
    const run = this.runs.get(investigationId);

    const listener = (event: InvestigationEvent) => {
      if (!active || event.seq <= lastSeq) return;
      lastSeq = event.seq;
      handlers.onEvent(event);
    };

    // Deliver asynchronously, like a network stream, then replay the backlog (resume).
    const opener = setTimeout(() => {
      if (!active) return;
      if (!run) {
        handlers.onError(notFound(`Investigation ${investigationId} does not exist.`));
        return;
      }
      handlers.onOpen?.();
      for (const event of run.emitted) listener(event);
      run.listeners.add(listener);
    }, 0);

    return () => {
      active = false;
      clearTimeout(opener);
      run?.listeners.delete(listener);
    };
  }

  async getInvestigation(investigationId: string): Promise<InvestigationView> {
    await this.delay(60, 140);
    const run = this.runs.get(investigationId);
    if (!run) throw notFound(`Investigation ${investigationId} does not exist.`);
    const done = run.emitted.find((e) => e.type === 'done');
    const report = run.emitted.find((e) => e.type === 'report');
    return {
      investigation_id: investigationId,
      status: done?.type === 'done' ? done.status : 'RUNNING',
      cluster_id: run.clusterId,
      mode: report?.type === 'report' ? report.report.mode : 'deterministic',
      events: [...run.emitted],
      report: report?.type === 'report' ? report.report : null,
    };
  }

  async getCertificate(certificateId: string): Promise<CertificateView> {
    await this.delay(100, 220);
    const certificate = await fixtures.certificate(this.checkId(certificateId, 'certificate'));
    if (!certificate) throw notFound(`Certificate ${certificateId} does not exist.`);
    return this.recomputeStatus(certificate);
  }

  async applySandboxOperation(operation: SandboxOperation): Promise<SandboxOpResponse> {
    await this.delay(220, 420);
    const rejection = await this.validate(operation);
    if (rejection) {
      this.log('SANDBOX_OPERATION_REJECTED', {
        op: operation.op,
        args: operation.args,
        result: rejection.result,
      });
      return { op: operation.op, ...rejection, revision: this.revision, superseded_certificates: [] };
    }

    const before = this.revision;
    this.revision += 1;
    this.operations += 1;
    const superseded = [...this.issued]
      .filter(([, revision]) => revision === before)
      .map(([id]) => id)
      .sort();
    this.log('SANDBOX_OPERATION_APPLIED', {
      op: operation.op,
      args: operation.args,
      from_revision: before,
      to_revision: this.revision,
    });
    for (const id of superseded) {
      this.log('CERTIFICATE_SUPERSEDED', { certificate_id: id, superseded_by_revision: this.revision });
    }
    return {
      op: operation.op,
      result: 'APPLIED',
      revision: this.revision,
      detail: `${describe(operation)} Revision ${before} → ${this.revision}. The mock API checks IDs and limits only; it replays the revision-1 recording and cannot recompute verdicts.`,
      superseded_certificates: superseded,
    };
  }

  /** Like the API, a reset is a new revision too: revisions only ever increase. */
  async resetSandbox(): Promise<SandboxResetResponse> {
    await this.delay(200, 380);
    const before = this.revision;
    this.revision += 1;
    this.operations = 0;
    this.log('SANDBOX_CREATED', { reason: 'reset', from_revision: before, to_revision: this.revision });
    return { revision: this.revision };
  }

  async getAudit(after = 0): Promise<AuditPage> {
    await this.delay(40, 90);
    return {
      events: this.audit.filter((e) => e.seq > after).map((e) => ({ ...e })),
      chain_valid: this.chainValid(),
    };
  }

  async getSystem(): Promise<SystemView> {
    await this.delay(80, 160);
    const [system, storm] = await Promise.all([fixtures.system(), fixtures.storm()]);
    return {
      ...system,
      alert_count: storm.total_alerts,
      storm_id: storm.storm_id,
      agent_model: null,
      agent_available: false,
      tools: [...RECORDED_TOOLS],
      sandbox_operations: ['EXPOSE_WORKLOAD', 'ADD_LATERAL_REACH', 'EXPIRE_EVIDENCE'],
    };
  }

  // ---------------------------------------------------------------------------------------

  private scheduleNext(id: string, run: MockRun): void {
    const next = run.events[run.emitted.length];
    if (!next) {
      run.timer = undefined;
      return;
    }
    const [min, max] = this.gap;
    // Deterministic spacing in [min, max], so a replay always feels the same.
    const wait = min + ((next.seq * 97) % (max - min + 1));
    run.timer = setTimeout(() => {
      run.emitted.push(next);
      this.onEmitted(id, next);
      for (const listener of [...run.listeners]) listener(next);
      this.scheduleNext(id, run);
    }, wait);
  }

  private onEmitted(id: string, event: InvestigationEvent): void {
    switch (event.type) {
      case 'tool_call':
        this.log('TOOL_CALLED', { investigation_id: id, trace_id: id, tool: event.tool, call_id: event.call_id });
        break;
      case 'tool_result':
        if (event.tool === 'plan_remediation') {
          const plan = event.data as PlanReportView;
          this.log('PLAN_COMPUTED', { investigation_id: id, trace_id: id, plan_id: plan.plan?.id ?? null, status: plan.status });
        } else if (event.tool === 'hunt_residual_paths') {
          this.recordHunt(event.data as RecordedHunt, id);
        } else if (event.tool === 'submit_remediation_execution') {
          const receipt = event.data as { receipt_id?: string };
          this.log('GATEWAY_RECEIPT', {
            investigation_id: id,
            trace_id: id,
            receipt_id: receipt.receipt_id ?? null,
            execution_mode: 'SIMULATION',
          });
        }
        break;
      case 'done':
        this.log('INVESTIGATION_FINISHED', { investigation_id: id, trace_id: id, status: event.status });
        break;
      case 'lifecycle':
      case 'narration':
      case 'report':
      case 'error':
        break;
    }
  }

  private recordHunt(hunt: RecordedHunt, investigationId: string | undefined): void {
    const trace = investigationId ? { investigation_id: investigationId, trace_id: investigationId } : {};
    for (const round of hunt.rounds) {
      this.log('HUNT_ROUND', {
        ...trace,
        round: round.round,
        plan_id: round.plan_id,
        residual_chain_ids: round.residuals,
      });
    }
    if (hunt.certificate) {
      this.issued.set(hunt.certificate.certificate_id, hunt.certificate.snapshot.sandbox_revision);
      this.log('CERTIFICATE_ISSUED', {
        ...trace,
        certificate_id: hunt.certificate.certificate_id,
        digest: hunt.certificate.digest,
        computed_at_revision: hunt.certificate.snapshot.sandbox_revision,
      });
    }
  }

  private withCurrentCertificateStatus(hunt: RecordedHunt): HuntReportView {
    return hunt.certificate ? { ...hunt, certificate: this.recomputeStatus(hunt.certificate) } : hunt;
  }

  /** The engine's rule (certificate.py `certificate_status`), applied on the recording's clock. */
  private recomputeStatus(certificate: CertificateView): CertificateView {
    let status: CertificateStatus = 'VALID';
    if (certificate.snapshot.sandbox_revision !== this.revision) status = 'SUPERSEDED';
    else if (this.now().getTime() >= Date.parse(certificate.expires_at)) status = 'EXPIRED';
    return { ...certificate, status, current_revision: this.revision };
  }

  private async validate(
    operation: SandboxOperation,
  ): Promise<Pick<SandboxOpResponse, 'result' | 'detail'> | null> {
    if (this.operations >= MAX_OPERATIONS) {
      return {
        result: 'REJECTED_LIMIT',
        detail: `This session has used its ${MAX_OPERATIONS} sandbox operations. Reset the sandbox to start again.`,
      };
    }
    const { pods, evidence } = await this.knownInventory();
    const unknownPod = (id: string) =>
      !ID_PATTERN.test(id) || !pods.has(id) ? `Unknown workload "${id}".` : null;

    switch (operation.op) {
      case 'EXPOSE_WORKLOAD': {
        const problem = unknownPod(operation.args.pod_id);
        return problem ? { result: 'REJECTED_VALIDATION', detail: problem } : null;
      }
      case 'ADD_LATERAL_REACH': {
        const { src_pod_id: src, dst_pod_id: dst, port } = operation.args;
        const problem =
          unknownPod(src) ??
          unknownPod(dst) ??
          (src === dst ? 'Source and destination must be different workloads.' : null) ??
          (!Number.isInteger(port) || port < 1 || port > 65535
            ? 'Port must be a whole number from 1 to 65535.'
            : null);
        return problem ? { result: 'REJECTED_VALIDATION', detail: problem } : null;
      }
      case 'EXPIRE_EVIDENCE': {
        const ref = operation.args.edge_ref;
        if (ref.includes('->')) {
          return {
            result: 'REJECTED_VALIDATION',
            detail: 'ATTACK_STEP edges are derived and cannot be expired; expire the evidence behind them instead.',
          };
        }
        if (!ID_PATTERN.test(ref) || !evidence.has(ref)) {
          return { result: 'REJECTED_VALIDATION', detail: `Unknown evidence edge "${ref}".` };
        }
        return null;
      }
    }
  }

  private knownInventory(): Promise<{ pods: Set<string>; evidence: Set<string> }> {
    this.inventory ??= (async () => {
      const storm = await fixtures.storm();
      const pods = new Set<string>([
        ...(storm.alerts ?? []).map((a) => a.pod),
        ...storm.workloads_on_path,
      ]);
      const evidence = new Set<string>();
      for (const name of fixtureNames('subgraphs')) {
        const view = await fixtures.subgraph(name);
        for (const edge of view?.edges ?? []) edge.backing_evidence_ids.forEach((id) => evidence.add(id));
      }
      for (const name of fixtureNames('evidence')) {
        const view = await fixtures.evidence(name);
        if (!view) continue;
        const tiers = Object.values(view.tiers) as { records: { evidence: { edge_id: string }[] }[] }[];
        for (const tier of tiers) {
          for (const record of tier.records) record.evidence.forEach((p) => evidence.add(p.edge_id));
        }
      }
      return { pods, evidence };
    })();
    return this.inventory;
  }

  private huntsByFirstPlan(): Promise<Map<string, string>> {
    this.huntIndex ??= (async () => {
      const index = new Map<string, string>();
      for (const name of fixtureNames('hunts')) {
        if (name === ALL_CROWN_JEWELS) continue;
        const first = (await fixtures.hunt(name))?.rounds[0];
        if (first) index.set(first.plan_id, name);
      }
      return index;
    })();
    return this.huntIndex;
  }

  private checkId(value: string, what: string): string {
    if (!ID_PATTERN.test(value)) {
      throw new ApiError('VALIDATION_ERROR', `"${value}" is not a valid ${what} id.`, 422);
    }
    return value;
  }

  /** Recompute every link, as the API does before reporting chain_valid. */
  private chainValid(): boolean {
    let prev = ZERO_HASH;
    for (const event of this.audit) {
      const { payload_hash: _payload, prev_hash: prevHash, hash, ...body } = event;
      const canonical = canonicalJson(body);
      if (prevHash !== prev || hash !== `sha256:${sha256Hex(canonical + prev)}`) return false;
      prev = hash;
    }
    return true;
  }

  private log(eventType: string, payload: Record<string, unknown>): void {
    const prevHash = this.audit.at(-1)?.hash ?? ZERO_HASH;
    const body = {
      seq: this.audit.length + 1,
      timestamp: this.now().toISOString(),
      event_type: eventType,
      graph_revision: this.revision,
      session: 'mock',
      ...payload,
    };
    const canonical = canonicalJson(body);
    this.audit.push({
      ...body,
      payload_hash: `sha256:${sha256Hex(canonical)}`,
      prev_hash: prevHash,
      // Hash_N = SHA256(Payload_N ‖ Hash_{N-1}) (solution.md §12.5)
      hash: `sha256:${sha256Hex(canonical + prevHash)}`,
    });
  }

  private delay(min: number, max: number): Promise<void> {
    const ms = Math.round((min + Math.random() * (max - min)) * this.latencyScale);
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function notFound(message: string): ApiError {
  return new ApiError('NOT_FOUND', message, 404);
}

function describe(operation: SandboxOperation): string {
  switch (operation.op) {
    case 'EXPOSE_WORKLOAD':
      return `Exposed ${operation.args.pod_id} to the Internet through the default ingress.`;
    case 'ADD_LATERAL_REACH':
      return `Added an observed flow ${operation.args.src_pod_id} → ${operation.args.dst_pod_id}:${operation.args.port}.`;
    case 'EXPIRE_EVIDENCE':
      return `Expired evidence ${operation.args.edge_ref} (valid_until set in the past).`;
  }
}
