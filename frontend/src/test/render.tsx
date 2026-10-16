import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { MockApiClient } from '@/api/mock/client';
import { createQueryClient } from '@/api/queries';
import { MemoryApp } from '@/App';
import { AppProviders } from '@/app/AppProviders';

/** A mock client with no artificial latency and a fast event stream. */
export function fastMockClient(): MockApiClient {
  return new MockApiClient({ latencyScale: 0, streamGapMs: [1, 1] });
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

/** Render one component inside the app providers (no router). */
export function renderWithProviders(ui: ReactElement, client = fastMockClient()) {
  return render(
    <AppProviders client={client} queryClient={createQueryClient()}>
      {ui}
    </AppProviders>,
  );
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
