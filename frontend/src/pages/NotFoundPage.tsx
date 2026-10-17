import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import './NotFoundPage.css';

export default function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="not-found-page">
      <p className="section-label">404</p>
      <h1 className="not-found-page__heading">There is no screen at this address</h1>
      <p className="not-found-page__text">
        <code className="not-found-page__code">{location.pathname}</code> is not part of Interdict.
      </p>
      <div className="not-found-page__row">
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
