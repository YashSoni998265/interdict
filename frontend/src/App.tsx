import { lazy, useState } from 'react';
import { createBrowserRouter, createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { RouteError } from './pages/RouteError';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const StormPage = lazy(() => import('./pages/StormPage'));
const WorkbenchPage = lazy(() => import('./pages/WorkbenchPage'));
const CertificatePage = lazy(() => import('./pages/CertificatePage'));
const SandboxPage = lazy(() => import('./pages/SandboxPage'));
const SystemPage = lazy(() => import('./pages/SystemPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'storm', element: <StormPage /> },
      { path: 'clusters/:clusterId', element: <WorkbenchPage /> },
      { path: 'certificates/:certificateId', element: <CertificatePage /> },
      { path: 'sandbox', element: <SandboxPage /> },
      { path: 'system', element: <SystemPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

const future = { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true };

export function App() {
  const [router] = useState(() => createBrowserRouter(routes, { future }));
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}

/** The same routes in memory, for tests. */
export function MemoryApp({ initialEntries }: { initialEntries: string[] }) {
  const [router] = useState(() => createMemoryRouter(routes, { initialEntries, future }));
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}
