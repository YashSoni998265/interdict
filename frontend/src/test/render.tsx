import { render } from '@testing-library/react';

import { MockApiClient } from '@/api/mock/client';
import { fixtures } from '@/api/mock/fixtures';
import { createQueryClient } from '@/api/queries';
import { MemoryApp } from '@/App';
import { AppProviders } from '@/app/AppProviders';

/** A mock client with no artificial latency and a fast event stream. */
export function fastMockClient(): MockApiClient {
  return new MockApiClient({ latencyScale: 0, streamGapMs: [1, 1] });
}

/** The certificate id of a recorded run (ids change whenever the fixtures are re-recorded). */
export async function recordedCertificateId(clusterId = 'cluster-prod-payments-db-ing-auth'): Promise<string> {
  const hunt = (await fixtures.hunt(clusterId)) as { certificate?: { certificate_id: string } | null } | undefined;
  const id = hunt?.certificate?.certificate_id;
  if (!id) throw new Error(`No recorded certificate for ${clusterId}`);
  return id;
}

/** Render the whole app at a route, with real providers and the fixture-backed mock API. */
export function renderApp(path: string, client = fastMockClient()) {
  const queryClient = createQueryClient();
  const result = render(
    <AppProviders client={client} queryClient={queryClient}>
      <MemoryApp initialEntries={[path]} />
    </AppProviders>,
  );
  return { ...result, client, queryClient };
}

/** Pretend the viewport is at least this wide (drives the three-pane workbench layout). */
export function setViewportWidth(width: number): void {
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)?.[1];
    return {
      matches: min !== undefined ? width >= Number(min) : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}
