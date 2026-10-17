import { useMemo, useState } from 'react';

import { toApiError, type ApiError } from '@/api/errors';
import { useSandboxOperation, useSandboxReset, useStorm, useWorkloadEvidence } from '@/api/queries';
import type { SandboxOperation, SandboxOpResponse } from '@/api/types';
import { tierOfEdge } from '@/lib/evidence';

/** "Open a new attack path": expose batch-1 (vulnerable, on no path), then let it reach checkout-1. */
export const OPEN_PATH: readonly SandboxOperation[] = [
  { op: 'EXPOSE_WORKLOAD', args: { pod_id: 'batch-1' } },
  { op: 'ADD_LATERAL_REACH', args: { src_pod_id: 'batch-1', dst_pod_id: 'checkout-1', port: 8080 } },
];

export type BreakItScenario = 'open-path' | 'stale' | 'reset';

export interface BreakItResult {
  scenario: BreakItScenario;
  responses: SandboxOpResponse[];
  revision: number;
}

/**
 * The one-click scenarios of "Break it yourself", shared by the guided demo and the sandbox page.
 * Each is a typed, allowlisted sandbox operation; nothing outside the visitor's sandbox changes.
 */
export function useBreakIt(stalePod: string | null) {
  const storm = useStorm();
  const operate = useSandboxOperation();
  const reset = useSandboxReset();
  const evidence = useWorkloadEvidence(stalePod);
  const [last, setLast] = useState<BreakItResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const pods = useMemo(() => {
    const data = storm.data;
    return new Set([...(data?.workloads_on_path ?? []), ...(data?.alerts ?? []).map((a) => a.pod)]);
  }, [storm.data]);

  // An evidence edge of a workload on an attack path; reachability evidence first.
  const staleEdge = useMemo(() => {
    const ids: string[] = [];
    for (const tier of Object.values(evidence.data?.tiers ?? {})) {
      for (const record of tier.records as { evidence: { edge_id: string }[] }[]) {
        for (const provenance of record.evidence) ids.push(provenance.edge_id);
      }
    }
    return ids.find((id) => tierOfEdge(id) === 'reachability') ?? ids[0] ?? null;
  }, [evidence.data]);

  const run = async (scenario: BreakItScenario, steps: () => Promise<SandboxOpResponse[] | number>) => {
    setError(null);
    try {
      const out = await steps();
      const responses = typeof out === 'number' ? [] : out;
      const revision = typeof out === 'number' ? out : (responses[responses.length - 1]?.revision ?? 0);
      setLast({ scenario, responses, revision });
    } catch (caught) {
      setError(toApiError(caught));
    }
  };

  return {
    canOpenPath: OPEN_PATH.every((operation) =>
      operation.op === 'ADD_LATERAL_REACH'
        ? pods.has(operation.args.src_pod_id) && pods.has(operation.args.dst_pod_id)
        : operation.op === 'EXPOSE_WORKLOAD'
          ? pods.has(operation.args.pod_id)
          : true,
    ),
    canMakeStale: staleEdge !== null,
    staleEdge,
    busy: operate.isPending || reset.isPending,
    last,
    error,
    openPath: () =>
      run('open-path', async () => {
        const responses: SandboxOpResponse[] = [];
        for (const operation of OPEN_PATH) responses.push(await operate.mutateAsync(operation));
        return responses;
      }),
    makeStale: () =>
      run('stale', async () =>
        staleEdge ? [await operate.mutateAsync({ op: 'EXPIRE_EVIDENCE', args: { edge_ref: staleEdge } })] : [],
      ),
    reset: () => run('reset', async () => (await reset.mutateAsync()).revision),
  };
}
