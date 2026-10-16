import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';

import { Button } from '@/components/ui/button';

/** Last-resort error screen: says what failed, never shows a blank page. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-3 px-4" role="alert">
      <h1 className="text-lg font-semibold text-fg">This screen failed to render</h1>
      <p className="text-ui text-fg-muted">
        Nothing was concluded from it. The error was: <code className="font-mono text-2xs text-fg">{message}</code>
      </p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button asChild variant="secondary">
          <Link to="/">Back to the start</Link>
        </Button>
      </div>
    </div>
  );
}
