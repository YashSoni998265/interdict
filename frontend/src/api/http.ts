import type { ApiClient, StreamHandlers, StreamOptions, Unsubscribe } from './client';
import { ApiError, errorFromResponse, toApiError } from './errors';
import {
  INVESTIGATION_EVENT_TYPES,
  type AuditPage,
  type CertificateView,
  type HuntReportView,
  type HuntRequest,
  type InvestigationEvent,
  type InvestigationRequest,
  type InvestigationStart,
  type InvestigationView,
  type PlanReportView,
  type PlanRequest,
  type SandboxOperation,
  type SandboxOpResponse,
  type SandboxResetResponse,
  type SessionResponse,
  type StormView,
  type SubgraphView,
  type SystemView,
  type WorkloadEvidenceView,
} from './types';

type EventSourceFactory = (url: string, init: EventSourceInit) => EventSource;

export interface HttpApiClientOptions {
  /** API origin; '' means same origin. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  eventSourceFactory?: EventSourceFactory;
  /** Per-request timeout. Hunts run several FalkorDB rounds, so this is generous. */
  timeoutMs?: number;
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);
/** EventSource.CLOSED; spelled out so this module also loads where EventSource is undefined. */
const EVENT_SOURCE_CLOSED = 2;

/**
 * Client for the real API (solution.md §11.3). The session is an HttpOnly cookie, so every
 * request uses `credentials: "include"`; state-changing requests carry the CSRF token returned
 * by POST /api/sessions in the `X-CSRF-Token` header.
 */
export class HttpApiClient implements ApiClient {
  readonly mode = 'http' as const;

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly eventSourceFactory: EventSourceFactory;
  private readonly timeoutMs: number;
  private csrfToken: string | null = null;
  private sessionPromise: Promise<SessionResponse> | null = null;

  constructor(options: HttpApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.eventSourceFactory =
      options.eventSourceFactory ?? ((url, init) => new EventSource(url, init));
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  now(): Date {
    return new Date();
  }

  createSession(): Promise<SessionResponse> {
    // Concurrent callers share one session request.
    this.sessionPromise ??= this.send<SessionResponse>('POST', '/api/sessions', {})
      .then((response) => {
        this.csrfToken = response.csrf_token;
        return response;
      })
      .finally(() => {
        this.sessionPromise = null;
      });
    return this.sessionPromise;
  }

  getStorm(): Promise<StormView> {
    return this.request('GET', '/api/storm');
  }

  getSubgraph(clusterId: string, planId?: string | null): Promise<SubgraphView> {
    const query = planId ? `?plan_id=${encodeURIComponent(planId)}` : '';
    return this.request('GET', `/api/clusters/${encodeURIComponent(clusterId)}/subgraph${query}`);
  }

  getWorkloadEvidence(podId: string): Promise<WorkloadEvidenceView> {
    return this.request('GET', `/api/workloads/${encodeURIComponent(podId)}/evidence`);
  }

  createPlan(request: PlanRequest): Promise<PlanReportView> {
    return this.request('POST', '/api/plans', request);
  }

  createHunt(request: HuntRequest): Promise<HuntReportView> {
    return this.request('POST', '/api/hunts', request);
  }

  startInvestigation(request: InvestigationRequest): Promise<InvestigationStart> {
    return this.request('POST', '/api/investigations', request);
  }

  getInvestigation(investigationId: string): Promise<InvestigationView> {
    return this.request('GET', `/api/investigations/${encodeURIComponent(investigationId)}`);
  }

  getCertificate(certificateId: string): Promise<CertificateView> {
    return this.request('GET', `/api/certificates/${encodeURIComponent(certificateId)}`);
  }

  applySandboxOperation(operation: SandboxOperation): Promise<SandboxOpResponse> {
    return this.request('POST', '/api/sandbox/operations', operation);
  }

  resetSandbox(): Promise<SandboxResetResponse> {
    return this.request('POST', '/api/sandbox/reset', {});
  }

  getAudit(after?: number): Promise<AuditPage> {
    const query = after === undefined ? '' : `?after=${encodeURIComponent(String(after))}`;
    return this.request('GET', `/api/audit${query}`);
  }

  getSystem(): Promise<SystemView> {
    return this.request('GET', '/api/system');
  }

  /**
   * Server-sent events: event name = event type, data = event JSON, id = seq. The browser
   * reconnects on its own and sends Last-Event-ID; events already seen are dropped by seq, so a
   * resumed stream never duplicates a step. The stream closes itself after `done`.
   */
  streamInvestigation(
    investigationId: string,
    handlers: StreamHandlers,
    options: StreamOptions = {},
  ): Unsubscribe {
    const url = this.url(`/api/investigations/${encodeURIComponent(investigationId)}/events`);
    const source = this.eventSourceFactory(url, { withCredentials: true });
    let lastSeq = options.lastEventId ?? 0;
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      source.close();
    };

    const onMessage = (message: MessageEvent<string>) => {
      if (closed) return;
      let event: InvestigationEvent;
      try {
        event = JSON.parse(message.data) as InvestigationEvent;
      } catch {
        handlers.onError(new ApiError('BAD_RESPONSE', 'The investigation stream sent malformed data.'));
        return;
      }
      if (typeof event.seq !== 'number' || event.seq <= lastSeq) return;
      lastSeq = event.seq;
      handlers.onEvent(event);
      if (event.type === 'done') close();
    };

    for (const type of INVESTIGATION_EVENT_TYPES) {
      source.addEventListener(type, onMessage as EventListener);
    }
    source.addEventListener('message', onMessage as EventListener);
    source.addEventListener('open', () => handlers.onOpen?.());
    source.addEventListener('error', () => {
      // CONNECTING means the browser is already retrying with Last-Event-ID; only a closed
      // source needs the caller to resume.
      if (!closed && source.readyState === EVENT_SOURCE_CLOSED) {
        closed = true;
        handlers.onError(
          new ApiError('STREAM_CLOSED', 'The investigation stream was interrupted.'),
        );
      }
    });

    return close;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * A request that re-establishes the session once before giving up: a missing or expired
   * cookie (401 NO_SESSION) or a CSRF token lost on reload (CSRF) both need a fresh token.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await this.send<T>(method, path, body);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'CSRF')) {
        await this.createSession();
        return this.send<T>(method, path, body);
      }
      throw error;
    }
  }

  private async send<T>(method: string, path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (!SAFE_METHODS.has(method) && this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
        signal: controller.signal,
      });
    } catch (error) {
      throw toApiError(error);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new ApiError('BAD_RESPONSE', `Expected JSON from ${path}.`, response.status);
        }
      }
    }
    if (!response.ok) throw errorFromResponse(response.status, parsed);
    return parsed as T;
  }
}
