import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import './RouteError.css';

/** Last-resort error screen: says what failed, never shows a blank page. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return (
    <div className="route-error" role="alert">
      <h1 className="route-error__heading">This screen failed to render</h1>
      <p className="route-error__text">
        Nothing was concluded from it. The error was: <code className="route-error__code">{message}</code>
      </p>
      <div className="route-error__row">
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
