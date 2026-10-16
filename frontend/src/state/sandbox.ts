import type { ApiError } from '@/api/errors';
import type { SandboxOperation, SandboxOpResponse } from '@/api/types';
import { createStore, type Store } from '@/lib/store';

export interface SandboxEntry {
  id: number;
  kind: 'operation' | 'reset';
  operation?: SandboxOperation;
  response?: SandboxOpResponse;
  error?: ApiError;
  fromRevision: number | null;
  toRevision: number | null;
  at: string;
}

export interface SandboxState {
  /** Current sandbox revision (Meta.revision), as last reported by the API. */
  revision: number | null;
  history: SandboxEntry[];
  /** Certificate id → the revision that superseded it, from operation responses. */
  superseded: Record<string, number>;
  /** Evidence expired with EXPIRE_EVIDENCE since the last reset. */
  expired: { edgeRef: string; revision: number }[];
}

export const initialSandboxState: SandboxState = {
  revision: null,
  history: [],
  superseded: {},
  expired: [],
};

export type SandboxStore = Store<SandboxState>;

export function createSandboxStore(): SandboxStore {
  return createStore<SandboxState>(initialSandboxState);
}

let entryIds = 0;

export function recordOperation(
  store: SandboxStore,
  operation: SandboxOperation,
  response: SandboxOpResponse,
  at: Date,
): void {
  store.set((state) => {
    const applied = response.result === 'APPLIED';
    const superseded = { ...state.superseded };
    for (const id of response.superseded_certificates) superseded[id] ??= response.revision;
    return {
      revision: response.revision,
      history: [
        ...state.history,
        {
          id: ++entryIds,
          kind: 'operation',
          operation,
          response,
          fromRevision: state.revision,
          toRevision: response.revision,
          at: at.toISOString(),
        },
      ],
      superseded,
      expired:
        applied && operation.op === 'EXPIRE_EVIDENCE'
          ? [...state.expired, { edgeRef: operation.args.edge_ref, revision: response.revision }]
          : state.expired,
    };
  });
}

export function recordFailedOperation(
  store: SandboxStore,
  operation: SandboxOperation,
  error: ApiError,
  at: Date,
): void {
  store.set((state) => ({
    ...state,
    history: [
      ...state.history,
      {
        id: ++entryIds,
        kind: 'operation',
        operation,
        error,
        fromRevision: state.revision,
        toRevision: state.revision,
        at: at.toISOString(),
      },
    ],
  }));
}

/**
 * After a reset the banners start over. Certificate status itself is always re-read from the
 * API (GET /api/certificates/{id}), which stays the source of truth.
 */
export function recordReset(store: SandboxStore, revision: number, at: Date): void {
  store.set((state) => ({
    ...state,
    revision,
    expired: [],
    superseded: {},
    history: [
      ...state.history,
      { id: ++entryIds, kind: 'reset', fromRevision: state.revision, toRevision: revision, at: at.toISOString() },
    ],
  }));
}

export function setRevision(store: SandboxStore, revision: number): void {
  store.set((state) => (state.revision === revision ? state : { ...state, revision }));
}
