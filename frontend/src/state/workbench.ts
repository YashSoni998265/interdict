import type { ApiClient, Unsubscribe } from '@/api/client';
import { type ApiError, toApiError } from '@/api/errors';
import type {
  HuntReportView,
  InvestigationEvent,
  InvestigationMode,
  PlanReportView,
  RanMode,
} from '@/api/types';
import { toNotes } from '@/lib/investigation';
import { createStore, type Store } from '@/lib/store';

import type { SandboxStore } from './sandbox';

export type RunPhase = 'starting' | 'streaming' | 'done' | 'interrupted' | 'failed';

export interface RunState {
  clusterId: string;
  requestedMode: InvestigationMode;
  /** The mode the API said will run (it may fall back from "agent"). */
  startMode: RanMode | null;
  /** Notes returned when the run started, e.g. why agent mode fell back. */
  startNotes: string[];
  investigationId: string | null;
  phase: RunPhase;
  events: InvestigationEvent[];
  error: ApiError | null;
  /** Sandbox revision when the run started, to flag runs that an operation made outdated. */
  revisionAtStart: number | null;
  startedAt: number;
}

export interface AsyncResult<T> {
  status: 'loading' | 'success' | 'error';
  data?: T;
  error?: ApiError;
  revision: number | null;
}

/** Plan and hunt requested directly over REST (no timeline), per cluster. */
export interface DirectResults {
  plan?: AsyncResult<PlanReportView>;
  hunt?: AsyncResult<HuntReportView>;
}

export interface WorkbenchState {
  runs: Record<string, RunState>;
  direct: Record<string, DirectResults>;
  /** Certificate id → cluster id, so a certificate page can link back to its workbench. */
  certificateClusters: Record<string, string>;
}

const initialState: WorkbenchState = { runs: {}, direct: {}, certificateClusters: {} };

export interface Workbench {
  store: Store<WorkbenchState>;
  start(clusterId: string, mode: InvestigationMode): Promise<void>;
  resume(clusterId: string): Promise<void>;
  computePlan(clusterId: string): Promise<void>;
  /** POST /api/hunts with the plan *handle* (see planHandle), not the engine's plan.id. */
  runHunt(clusterId: string, planHandle: string): Promise<void>;
  dispose(): void;
}

export function createWorkbench(client: ApiClient, sandbox: SandboxStore): Workbench {
  const store = createStore<WorkbenchState>(initialState);
  const streams = new Map<string, Unsubscribe>();
  const generations = new Map<string, number>();

  const stop = (clusterId: string) => {
    streams.get(clusterId)?.();
    streams.delete(clusterId);
  };

  const patchRun = (clusterId: string, patch: (run: RunState) => Partial<RunState>) => {
    store.set((state) => {
      const run = state.runs[clusterId];
      if (!run) return state;
      const changes = patch(run);
      if (Object.keys(changes).length === 0) return state;
      return { ...state, runs: { ...state.runs, [clusterId]: { ...run, ...changes } } };
    });
  };

  const patchDirect = (clusterId: string, changes: Partial<DirectResults>) => {
    store.set((state) => ({
      ...state,
      direct: { ...state.direct, [clusterId]: { ...state.direct[clusterId], ...changes } },
    }));
  };

  const indexCertificate = (clusterId: string, hunt: HuntReportView | undefined) => {
    const id = hunt?.certificate?.certificate_id;
    if (!id) return;
    store.set((state) =>
      state.certificateClusters[id] === clusterId
        ? state
        : { ...state, certificateClusters: { ...state.certificateClusters, [id]: clusterId } },
    );
  };

  const append = (clusterId: string, investigationId: string, event: InvestigationEvent) => {
    store.set((state) => {
      const run = state.runs[clusterId];
      if (run?.investigationId !== investigationId) return state;
      if (run.events.some((e) => e.seq === event.seq)) return state;
      const events = [...run.events, event].sort((a, b) => a.seq - b.seq);
      return {
        ...state,
        runs: {
          ...state.runs,
          [clusterId]: {
            ...run,
            events,
            phase: event.type === 'done' ? 'done' : run.phase,
            error: event.type === 'done' ? null : run.error,
          },
        },
      };
    });
    if (event.type === 'tool_result' && event.ok && event.tool === 'hunt_residual_paths') {
      indexCertificate(clusterId, event.data as HuntReportView);
    }
    if (event.type === 'done') stop(clusterId);
  };

  const subscribe = (clusterId: string, investigationId: string, lastEventId: number) => {
    stop(clusterId);
    const unsubscribe = client.streamInvestigation(
      investigationId,
      {
        onEvent: (event) => append(clusterId, investigationId, event),
        onError: (error) =>
          patchRun(clusterId, (run) =>
            run.investigationId === investigationId && run.phase !== 'done'
              ? { phase: 'interrupted', error }
              : {},
          ),
      },
      { lastEventId },
    );
    streams.set(clusterId, unsubscribe);
  };

  return {
    store,

    async start(clusterId, mode) {
      stop(clusterId);
      const generation = (generations.get(clusterId) ?? 0) + 1;
      generations.set(clusterId, generation);
      store.set((state) => {
        const direct = { ...state.direct };
        delete direct[clusterId];
        return {
          ...state,
          direct,
          runs: {
            ...state.runs,
            [clusterId]: {
              clusterId,
              requestedMode: mode,
              startMode: null,
              startNotes: [],
              investigationId: null,
              phase: 'starting',
              events: [],
              error: null,
              revisionAtStart: sandbox.get().revision,
              startedAt: Date.now(),
            },
          },
        };
      });
      try {
        const started = await client.startInvestigation({ cluster_id: clusterId, mode });
        if (generations.get(clusterId) !== generation) return;
        patchRun(clusterId, () => ({
          investigationId: started.investigation_id,
          phase: 'streaming',
          startMode: started.mode ?? null,
          startNotes: toNotes(started.notes),
        }));
        subscribe(clusterId, started.investigation_id, 0);
      } catch (error) {
        if (generations.get(clusterId) !== generation) return;
        patchRun(clusterId, () => ({ phase: 'failed', error: toApiError(error) }));
      }
    },

    async resume(clusterId) {
      const run = store.get().runs[clusterId];
      const investigationId = run?.investigationId;
      if (!investigationId) return;
      patchRun(clusterId, () => ({ phase: 'streaming', error: null }));
      try {
        // Fill any gap from the server's copy first, then follow the live stream.
        const snapshot = await client.getInvestigation(investigationId);
        for (const event of snapshot.events) append(clusterId, investigationId, event);
        const latest = store.get().runs[clusterId];
        if (latest?.investigationId === investigationId && latest.phase !== 'done') {
          subscribe(clusterId, investigationId, latest.events.at(-1)?.seq ?? 0);
        }
      } catch (error) {
        patchRun(clusterId, () => ({ phase: 'interrupted', error: toApiError(error) }));
      }
    },

    async computePlan(clusterId) {
      const revision = sandbox.get().revision;
      patchDirect(clusterId, { plan: { status: 'loading', revision }, hunt: undefined });
      try {
        const data = await client.createPlan({ cluster_id: clusterId, require_known_impact: false });
        patchDirect(clusterId, { plan: { status: 'success', data, revision } });
      } catch (error) {
        patchDirect(clusterId, { plan: { status: 'error', error: toApiError(error), revision } });
      }
    },

    async runHunt(clusterId, planHandle) {
      const revision = sandbox.get().revision;
      patchDirect(clusterId, { hunt: { status: 'loading', revision } });
      try {
        const data = await client.createHunt({ plan_id: planHandle });
        patchDirect(clusterId, { hunt: { status: 'success', data, revision } });
        indexCertificate(clusterId, data);
      } catch (error) {
        patchDirect(clusterId, { hunt: { status: 'error', error: toApiError(error), revision } });
      }
    },

    dispose() {
      for (const unsubscribe of streams.values()) unsubscribe();
      streams.clear();
    },
  };
}
