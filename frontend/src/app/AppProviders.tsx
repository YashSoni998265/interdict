import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import type { ApiClient } from '@/api/client';
import { createQueryClient, useSession } from '@/api/queries';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createSandboxStore, setRevision } from '@/state/sandbox';
import { createWorkbench } from '@/state/workbench';

import { ServicesContext, useServices, type AppServices } from './services';

/** Copies the session's sandbox revision into the sandbox store once it is known. */
function SessionSync() {
  const session = useSession();
  const { sandbox } = useServices();
  useEffect(() => {
    if (session.data && sandbox.get().revision === null) {
      setRevision(sandbox, session.data.session.revision);
    }
  }, [session.data, sandbox]);
  return null;
}

export function AppProviders({
  client,
  queryClient,
  children,
}: {
  client: ApiClient;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [services] = useState<AppServices>(() => {
    const sandbox = createSandboxStore();
    return { client, sandbox, workbench: createWorkbench(client, sandbox) };
  });
  const [queries] = useState(() => queryClient ?? createQueryClient());

  useEffect(() => () => services.workbench.dispose(), [services]);

  return (
    <QueryClientProvider client={queries}>
      <ServicesContext.Provider value={services}>
        <TooltipProvider delayDuration={250} skipDelayDuration={150}>
          <SessionSync />
          {children}
        </TooltipProvider>
      </ServicesContext.Provider>
    </QueryClientProvider>
  );
}
