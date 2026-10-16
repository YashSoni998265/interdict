import { createContext, useContext, useEffect, useState } from 'react';

import type { ApiClient } from '@/api/client';
import { useStore } from '@/lib/store';
import type { SandboxState, SandboxStore } from '@/state/sandbox';
import type { RunState, Workbench, WorkbenchState } from '@/state/workbench';

export interface AppServices {
  client: ApiClient;
  sandbox: SandboxStore;
  workbench: Workbench;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <AppProviders>.');
  return services;
}

export function useApi(): ApiClient {
  return useServices().client;
}

export function useSandboxState<S>(selector: (state: SandboxState) => S): S {
  return useStore(useServices().sandbox, selector);
}

export function useWorkbenchState<S>(selector: (state: WorkbenchState) => S): S {
  return useStore(useServices().workbench.store, selector);
}

export function useRun(clusterId: string): RunState | undefined {
  return useWorkbenchState((state) => state.runs[clusterId]);
}

/**
 * The app's clock: real time over HTTP, the recording's clock in mock mode. Re-renders every
 * `intervalMs` so relative times ("in 11 h") stay current.
 */
export function useNow(intervalMs = 30_000): Date {
  const client = useApi();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((tick) => tick + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return client.now();
}
