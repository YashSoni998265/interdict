import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-3 px-4 py-16">
      <p className="section-label">404</p>
      <h1 className="text-lg font-semibold text-fg">There is no screen at this address</h1>
      <p className="text-ui text-fg-muted">
        <code className="font-mono text-2xs text-fg">{location.pathname}</code> is not part of Interdict.
      </p>
      <div className="flex gap-2">
        <Button asChild variant="primary">
          <Link to="/storm">Open the alert storm</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/">Start page</Link>
        </Button>
      </div>
    </div>
  );
}
