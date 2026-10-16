import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './errors';
import { HttpApiClient } from './http';
import type { InvestigationEvent } from './types';

interface Call {
  url: string;
  init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init: init ?? {} };
    calls.push(call);
    return Promise.resolve(handler(call));
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const SESSION = { session: { revision: 1, storm_id: 'storm-20261018', seed: 20261018, alert_count: 1000, created: true }, csrf_token: 'csrf-test' };

describe('HttpApiClient', () => {
  it('sends cookies, and the CSRF token on POST only', async () => {
    const { calls, fetchImpl } = fakeFetch(({ url }) =>
      url.endsWith('/api/sessions') ? jsonResponse(200, SESSION) : jsonResponse(200, { ok: true }),
    );
    const client = new HttpApiClient({ baseUrl: 'https://api.example/', fetchImpl });
    await client.createSession();
    await client.getStorm();
    await client.createPlan({ cluster_id: 'cluster-a', require_known_impact: false });

    expect(calls.map((c) => c.url)).toEqual([
      'https://api.example/api/sessions',
      'https://api.example/api/storm',
      'https://api.example/api/plans',
    ]);
    for (const call of calls) expect(call.init.credentials).toBe('include');
    const headers = (call: Call) => call.init.headers as Record<string, string>;
    expect(headers(calls[1]!)['X-CSRF-Token']).toBeUndefined();
    expect(headers(calls[2]!)['X-CSRF-Token']).toBe('csrf-test');
    expect(JSON.parse(calls[2]!.init.body as string)).toEqual({ cluster_id: 'cluster-a', require_known_impact: false });
  });

  it('passes the plan handle to the subgraph and encodes path parameters', async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, {}));
    const client = new HttpApiClient({ baseUrl: '', fetchImpl });
    await client.getSubgraph('cluster-a', 'plan-02431a41871eef51');
    await client.getWorkloadEvidence('auth-1');
    await client.getAudit(14);
    expect(calls.map((c) => c.url)).toEqual([
      '/api/clusters/cluster-a/subgraph?plan_id=plan-02431a41871eef51',
      '/api/workloads/auth-1/evidence',
      '/api/audit?after=14',
    ]);
  });

  it('turns {detail: {code, message}} into a typed error', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(409, { detail: { code: 'BUSY', message: 'An investigation is already running.' } }),
    );
    const client = new HttpApiClient({ baseUrl: '', fetchImpl });
    const error = await client.startInvestigation({ cluster_id: 'cluster-a', mode: 'agent' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'BUSY', status: 409, message: 'An investigation is already running.' });
  });

  it('re-establishes an expired session once (401 NO_SESSION) and retries', async () => {
    let storms = 0;
    const { calls, fetchImpl } = fakeFetch(({ url }) => {
      if (url.endsWith('/api/sessions')) return jsonResponse(200, SESSION);
      storms += 1;
      return storms === 1
        ? jsonResponse(401, { detail: { code: 'NO_SESSION', message: 'No session.' } })
        : jsonResponse(200, { storm_id: 'storm-20261018' });
    });
    const client = new HttpApiClient({ baseUrl: '', fetchImpl });
    await expect(client.getStorm()).resolves.toEqual({ storm_id: 'storm-20261018' });
    expect(calls.map((c) => c.url)).toEqual(['/api/storm', '/api/sessions', '/api/storm']);
  });

  it('reports a network failure as NETWORK_ERROR, never as an empty result', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    const client = new HttpApiClient({ baseUrl: '', fetchImpl });
    await expect(client.getStorm()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('streams named SSE events, drops repeats by seq and closes after done', () => {
    const listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
    const source = {
      readyState: 1,
      close: vi.fn(),
      addEventListener: (type: string, fn: (event: MessageEvent<string>) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
    };
    const factory = vi.fn(() => source as unknown as EventSource);
    const client = new HttpApiClient({ baseUrl: '', eventSourceFactory: factory });
    const received: InvestigationEvent[] = [];
    client.streamInvestigation('inv-1', { onEvent: (e) => received.push(e), onError: () => undefined }, { lastEventId: 1 });

    expect(factory).toHaveBeenCalledWith('/api/investigations/inv-1/events', { withCredentials: true });
    const emit = (type: string, event: object) =>
      listeners.get(type)?.forEach((fn) => fn(new MessageEvent(type, { data: JSON.stringify(event) })));
    emit('lifecycle', { seq: 1, at: 't', type: 'lifecycle', state: 'TRIAGING' }); // already seen
    emit('lifecycle', { seq: 2, at: 't', type: 'lifecycle', state: 'ANALYZING' });
    emit('lifecycle', { seq: 2, at: 't', type: 'lifecycle', state: 'ANALYZING' }); // repeat after reconnect
    emit('done', { seq: 3, at: 't', type: 'done', status: 'SIMULATED_CONTAINMENT' });

    expect(received.map((e) => e.seq)).toEqual([2, 3]);
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
