import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InvestigationEvent } from '../types';

import { MockApiClient } from './client';
import { fixtures } from './fixtures';

const CLUSTER = 'cluster-prod-payments-db-ing-auth';

/** Let pending promise chains (fixture loads) settle while timers are faked. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('mock investigation event stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams the recorded events in order, 250 to 400 ms apart, ending with done', async () => {
    const recording = await fixtures.investigation(CLUSTER);
    const client = new MockApiClient({ latencyScale: 0 });
    await client.createSession();
    const { investigation_id, mode } = await client.startInvestigation({ cluster_id: CLUSTER, mode: 'deterministic' });
    expect(mode).toBe('deterministic');

    const received: { event: InvestigationEvent; at: number }[] = [];
    const errors: unknown[] = [];
    client.streamInvestigation(investigation_id, {
      onEvent: (event) => received.push({ event, at: Date.now() }),
      onError: (error) => errors.push(error),
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(received).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(20_000);
    await flush();
    expect(errors).toEqual([]);
    expect(received.map((r) => r.event.seq)).toEqual(recording!.events.map((e) => e.seq));
    expect(received.at(-1)?.event.type).toBe('done');

    for (let i = 1; i < received.length; i++) {
      const gap = received[i]!.at - received[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(250);
      expect(gap).toBeLessThanOrEqual(400);
    }
  });

  it('resumes after the last event seen without repeating any', async () => {
    const client = new MockApiClient({ latencyScale: 0 });
    const { investigation_id } = await client.startInvestigation({ cluster_id: CLUSTER, mode: 'agent' });

    const first: number[] = [];
    const unsubscribe = client.streamInvestigation(investigation_id, {
      onEvent: (event) => first.push(event.seq),
      onError: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    unsubscribe();
    const seenUpTo = first.at(-1) ?? 0;
    expect(seenUpTo).toBeGreaterThan(0);

    const resumed: number[] = [];
    client.streamInvestigation(
      investigation_id,
      { onEvent: (event) => resumed.push(event.seq), onError: () => undefined },
      { lastEventId: seenUpTo },
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(resumed[0]).toBe(seenUpTo + 1);
    expect(new Set([...first, ...resumed]).size).toBe(first.length + resumed.length);
    expect(first.length).toBeLessThan(first.length + resumed.length);
  });

  it('keeps running after an unsubscribe, like a server-side run, and reports its state', async () => {
    const client = new MockApiClient({ latencyScale: 0 });
    const { investigation_id } = await client.startInvestigation({ cluster_id: CLUSTER, mode: 'deterministic' });
    const stop = client.streamInvestigation(investigation_id, { onEvent: () => undefined, onError: () => undefined });
    stop();
    expect((await client.getInvestigation(investigation_id)).status).toBe('RUNNING');
    await vi.advanceTimersByTimeAsync(20_000);
    const view = await client.getInvestigation(investigation_id);
    expect(view.status).toBe('SIMULATED_CONTAINMENT');
    expect(view.report?.certificate_id).toMatch(/^cert-/);
  });

  it('notes the fallback when agent mode is requested, and refuses a second run while one is busy', async () => {
    const client = new MockApiClient({ latencyScale: 0 });
    const started = await client.startInvestigation({ cluster_id: CLUSTER, mode: 'agent' });
    expect(started.mode).toBe('deterministic');
    expect(String(started.notes)).toMatch(/no AI narrator/);
    await expect(client.startInvestigation({ cluster_id: CLUSTER, mode: 'deterministic' })).rejects.toMatchObject({
      code: 'BUSY',
      status: 409,
    });
  });

  it('reports an unknown investigation as a typed error, never as an empty stream', async () => {
    const client = new MockApiClient({ latencyScale: 0 });
    const errors: { code?: string }[] = [];
    client.streamInvestigation('inv-missing', {
      onEvent: () => undefined,
      onError: (error) => errors.push(error),
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(errors[0]?.code).toBe('NOT_FOUND');
  });
});

describe('mock sandbox', () => {
  it('increments the revision and supersedes the certificates issued so far', async () => {
    vi.useFakeTimers();
    const client = new MockApiClient({ latencyScale: 0, streamGapMs: [1, 1] });
    const { investigation_id } = await client.startInvestigation({ cluster_id: CLUSTER, mode: 'deterministic' });
    client.streamInvestigation(investigation_id, { onEvent: () => undefined, onError: () => undefined });
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    const report = (await client.getInvestigation(investigation_id)).report;
    const certificateId = report?.certificate_id ?? '';
    expect((await client.getCertificate(certificateId)).status).toBe('VALID');

    const applied = await client.applySandboxOperation({ op: 'EXPOSE_WORKLOAD', args: { pod_id: 'batch-1' } });
    expect(applied).toMatchObject({ op: 'EXPOSE_WORKLOAD', result: 'APPLIED', revision: 2 });
    expect(applied.superseded_certificates).toEqual([certificateId]);
    const certificate = await client.getCertificate(certificateId);
    expect(certificate.status).toBe('SUPERSEDED');
    expect(certificate.current_revision).toBe(2);

    const rejected = await client.applySandboxOperation({
      op: 'ADD_LATERAL_REACH',
      args: { src_pod_id: 'batch-1', dst_pod_id: 'batch-1', port: 8080 },
    });
    expect(rejected).toMatchObject({ result: 'REJECTED_VALIDATION', revision: 2 });

    // A reset is a new revision too: revisions only increase, the certificate stays superseded.
    expect((await client.resetSandbox()).revision).toBe(3);
    expect((await client.getCertificate(certificateId)).status).toBe('SUPERSEDED');

    const audit = await client.getAudit();
    expect(audit.chain_valid).toBe(true);
    expect(audit.events.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['CERTIFICATE_ISSUED', 'SANDBOX_OPERATION_APPLIED', 'CERTIFICATE_SUPERSEDED', 'SANDBOX_OPERATION_REJECTED']),
    );
  });
});
