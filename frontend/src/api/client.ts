import type { ApiError } from './errors';
import type {
  AuditPage,
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
} from './types';

export type ApiMode = 'mock' | 'http';

export interface StreamHandlers {
  onEvent: (event: InvestigationEvent) => void;
  /** Called when the stream cannot continue on its own; the caller may resume later. */
  onError: (error: ApiError) => void;
  onOpen?: () => void;
}

export interface StreamOptions {
  /** Resume after this sequence number (events with seq <= lastEventId are skipped). */
  lastEventId?: number;
}

export type Unsubscribe = () => void;

/**
 * One interface, two implementations: `mock` serves the recorded engine fixtures in the
 * browser, `http` calls the real API. Screens depend only on this interface.
 */
export interface ApiClient {
  readonly mode: ApiMode;
  /** The clock results are judged against: real time over HTTP, the recording's clock in mock mode. */
  now(): Date;

  createSession(): Promise<SessionResponse>;
  getStorm(): Promise<StormView>;
  /**
   * The focused attack subgraph. With a plan handle, the API marks `cut_by` from that plan and
   * adds the hunt's residual paths; without one, no edge is cut.
   */
  getSubgraph(clusterId: string, planId?: string | null): Promise<SubgraphView>;
  getWorkloadEvidence(podId: string): Promise<WorkloadEvidenceView>;
  createPlan(request: PlanRequest): Promise<PlanReportView>;
  createHunt(request: HuntRequest): Promise<HuntReportView>;
  /** Starts a run. A 409 BUSY error means one is already running for this session. */
  startInvestigation(request: InvestigationRequest): Promise<InvestigationStart>;
  streamInvestigation(
    investigationId: string,
    handlers: StreamHandlers,
    options?: StreamOptions,
  ): Unsubscribe;
  getInvestigation(investigationId: string): Promise<InvestigationView>;
  getCertificate(certificateId: string): Promise<CertificateView>;
  applySandboxOperation(operation: SandboxOperation): Promise<SandboxOpResponse>;
  resetSandbox(): Promise<SandboxResetResponse>;
  getAudit(after?: number): Promise<AuditPage>;
  getSystem(): Promise<SystemView>;
  /**
   * A recorded engine run with no REST route in this API version: planning for every crown
   * jewel at once. Only the mock client provides it; screens hide it otherwise.
   */
  getRecordedScenario?(name: 'all-crown-jewels'): Promise<HuntReportView>;
}

export function resolveApiMode(value: string | undefined): ApiMode {
  return value === 'http' ? 'http' : 'mock';
}

/** Build the client selected by VITE_API_MODE (mock by default). */
export async function createApiClient(): Promise<ApiClient> {
  const mode = resolveApiMode(import.meta.env.VITE_API_MODE);
  if (mode === 'http') {
    const { HttpApiClient } = await import('./http');
    return new HttpApiClient({ baseUrl: import.meta.env.VITE_API_BASE ?? '' });
  }
  const { MockApiClient } = await import('./mock/client');
  return new MockApiClient();
}
