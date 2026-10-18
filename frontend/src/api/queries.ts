import {
  keepPreviousData,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient as QueryClientType,
} from '@tanstack/react-query';

import { useApi, useServices } from '@/app/services';
import { recordFailedOperation, recordOperation, recordReset } from '@/state/sandbox';

import { toApiError } from './errors';
import type { AuditEvent, SandboxOperation } from './types';

export const keys = {
  session: ['session'] as const,
  storm: ['storm'] as const,
  subgraphs: ['subgraph'] as const,
  subgraph: (clusterId: string, planId: string | null) => ['subgraph', clusterId, planId] as const,
  evidenceAll: ['evidence'] as const,
  evidence: (podId: string) => ['evidence', podId] as const,
  planPreviews: ['plan-preview'] as const,
  planPreview: (clusterId: string) => ['plan-preview', clusterId] as const,
  certificates: ['certificate'] as const,
  certificate: (id: string) => ['certificate', id] as const,
  system: ['system'] as const,
  audit: ['audit'] as const,
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Only transport and server failures are retried; 404s and validation errors are final.
        retry: (count, error) => toApiError(error).retryable && count < 2,
        retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4000),
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}

export function useSession() {
  const client = useApi();
  return useQuery({
    queryKey: keys.session,
    queryFn: () => client.createSession(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

function useReady(): boolean {
  return useSession().isSuccess;
}

export function useStorm() {
  const client = useApi();
  return useQuery({ queryKey: keys.storm, queryFn: () => client.getStorm(), enabled: useReady(), staleTime: 60_000 });
}

export function useSubgraph(clusterId: string, planId: string | null) {
  const client = useApi();
  return useQuery({
    queryKey: keys.subgraph(clusterId, planId),
    queryFn: () => client.getSubgraph(clusterId, planId),
    enabled: useReady(),
    // Keep the drawn graph while the plan-marked version loads.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useWorkloadEvidence(podId: string | null) {
  const client = useApi();
  return useQuery({
    queryKey: keys.evidence(podId ?? ''),
    queryFn: () => client.getWorkloadEvidence(podId ?? ''),
    enabled: useReady() && Boolean(podId),
    staleTime: 60_000,
  });
}

/** The cluster's initial plan, for the plan status on cluster cards (deterministic). */
export function usePlanPreview(clusterId: string, enabled = true) {
  const client = useApi();
  return useQuery({
    queryKey: keys.planPreview(clusterId),
    queryFn: () => client.createPlan({ cluster_id: clusterId, require_known_impact: false }),
    enabled: useReady() && enabled,
    staleTime: 5 * 60_000,
  });
}

/** Certificate status is recomputed by the API on every read (VALID / SUPERSEDED / EXPIRED). */
export function useCertificate(certificateId: string | null) {
  const client = useApi();
  return useQuery({
    queryKey: keys.certificate(certificateId ?? ''),
    queryFn: () => client.getCertificate(certificateId ?? ''),
    enabled: useReady() && Boolean(certificateId),
    refetchInterval: 60_000,
    staleTime: 10_000,
  });
}

export function useSystem() {
  const client = useApi();
  return useQuery({ queryKey: keys.system, queryFn: () => client.getSystem(), enabled: useReady(), staleTime: 5 * 60_000 });
}

export interface AuditLog {
  events: AuditEvent[];
  chainValid: boolean | null;
}

/** The audit stream, fetched incrementally (`after=` the last seq) and kept in order. */
export function useAuditLog(enabled = true) {
  const client = useApi();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: keys.audit,
    queryFn: async (): Promise<AuditLog> => {
      const previous = queryClient.getQueryData<AuditLog>(keys.audit);
      const after = previous?.events.at(-1)?.seq ?? 0;
      const page = await client.getAudit(after);
      const bySeq = new Map<number, AuditEvent>();
      for (const event of [...(previous?.events ?? []), ...page.events]) bySeq.set(event.seq, event);
      return {
        events: [...bySeq.values()].sort((a, b) => a.seq - b.seq),
        chainValid: page.chain_valid ?? previous?.chainValid ?? null,
      };
    },
    enabled: useReady() && enabled,
    refetchInterval: 4000,
    staleTime: 0,
  });
}

/** After a sandbox change, every computed view may be outdated: refetch them. */
function invalidateComputed(queryClient: QueryClientType): void {
  for (const queryKey of [keys.storm, keys.subgraphs, keys.evidenceAll, keys.planPreviews, keys.certificates, keys.audit]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

export function useSandboxOperation() {
  const { client, sandbox } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (operation: SandboxOperation) => client.applySandboxOperation(operation),
    onSuccess: (response, operation) => {
      recordOperation(sandbox, operation, response, client.now());
      if (response.result === 'APPLIED') invalidateComputed(queryClient);
      else void queryClient.invalidateQueries({ queryKey: keys.audit });
    },
    onError: (error, operation) => recordFailedOperation(sandbox, operation, toApiError(error), client.now()),
  });
}

export function useSandboxReset() {
  const { client, sandbox } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.resetSandbox(),
    onSuccess: (response) => {
      recordReset(sandbox, response.revision, client.now());
      invalidateComputed(queryClient);
    },
  });
}
