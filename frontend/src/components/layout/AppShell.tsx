import { Clock, FlaskConical, History, RotateCcw, Wrench } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { useSandboxReset, useStorm } from '@/api/queries';
import type { SandboxOperation } from '@/api/types';
import { useApi, useSandboxState } from '@/app/services';
import { ShellContext, type ShellActions } from '@/app/shell';
import { cn } from '@/lib/cn';
import { formatUtc, plural } from '@/lib/format';

import { Num } from '../Num';
import { SandboxDrawer } from '../sandbox/SandboxDrawer';
import { Banner, LoadingState } from '../states';
import { Button } from '../ui/button';
import { Tip } from '../ui/tooltip';

import { Wordmark } from './Logo';
import { SimulationBadge } from './SimulationBadge';
import './AppShell.css';

function NavItem({ to, children, end = false, match }: { to: string; children: string; end?: boolean; match?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'nav-item__part',
          isActive || match ? 'nav-item__part--active' : 'nav-item__part--not-active',
        )
      }
    >
      {children}
    </NavLink>
  );
}

function Header({ onOpenSandbox }: { onOpenSandbox: () => void }) {
  const revision = useSandboxState((s) => s.revision);
  const location = useLocation();
  const exploring = location.pathname.startsWith('/clusters/') || location.pathname.startsWith('/certificates/');
  const nav = (
    <>
      <NavItem to="/demo">Demo</NavItem>
      <NavItem to="/storm" match={exploring}>
        Explore
      </NavItem>
      <NavItem to="/system">Under the hood</NavItem>
    </>
  );

  return (
    <header className="header">
      <div className="header__row">
        <Link to="/" className="header__home" aria-label="Interdict home">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="header__nav">
          {nav}
        </nav>
        <div className="header__actions">
          {revision !== null && revision > 1 ? (
            <Tip
              content="Your private copy of the graph has changed. Every change raises its revision, and certificates issued at an earlier revision are no longer current."
              side="bottom"
            >
              <button type="button" className="header__revision">
                Sandbox revision <Num metric="revision" value={revision} plain />
              </button>
            </Tip>
          ) : null}
          <SimulationBadge compact />
          <Button size="sm" variant="secondary" onClick={onOpenSandbox} aria-label="Open the sandbox: break it yourself">
            <Wrench aria-hidden />
            <span className="header__wide-label">Break it yourself</span>
            <span className="header__narrow-label">Break it</span>
          </Button>
        </div>
      </div>
      <nav aria-label="Main (compact)" className="header__nav-compact">
        {nav}
      </nav>
    </header>
  );
}

function GlobalBanners({ onOpenSandbox }: { onOpenSandbox: () => void }) {
  const client = useApi();
  const storm = useStorm();
  const history = useSandboxState((s) => s.history);
  const superseded = useSandboxState((s) => s.superseded);
  const expired = useSandboxState((s) => s.expired);
  const revision = useSandboxState((s) => s.revision);
  const reset = useSandboxReset();

  const changedSinceReset = useMemo(() => {
    const lastReset = history.map((e) => e.kind).lastIndexOf('reset');
    return history.slice(lastReset + 1).filter((e) => e.response?.result === 'APPLIED');
  }, [history]);
  const supersededCount = Object.keys(superseded).length;

  return (
    <div className="global-banners">
      {client.mode === 'mock' ? (
        <div role="status" className="global-banners__replay">
          <History className="global-banners__icon" aria-hidden />
          <span className="global-banners__label">
            Replay of recorded engine output
            {storm.data ? ` from ${formatUtc(storm.data.evaluated_at, { seconds: false })}` : ''}, not live
          </span>
          <span className="global-banners__label-2">
            The real engine’s results (FalkorDB, seed 20261018), played back in your browser; it cannot recompute after a
            sandbox change.
          </span>
        </div>
      ) : null}
      {changedSinceReset.length > 0 ? (
        <Banner
          tone="grey"
          icon={Clock}
          title={`Sandbox changed: now at revision ${revision ?? '?'}`}
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={onOpenSandbox}>
                <FlaskConical aria-hidden />
                View changes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
                <RotateCcw aria-hidden />
                Reset sandbox
              </Button>
            </>
          }
        >
          {changedSinceReset.length} {plural(changedSinceReset.length, 'operation')} applied.{' '}
          {supersededCount > 0
            ? `${supersededCount} ${plural(supersededCount, 'certificate')} superseded: certificate no longer current. `
            : ''}
          Results computed at an earlier revision are marked; re-run an investigation to recompute.
        </Banner>
      ) : null}
      {expired.length > 0 ? (
        <Banner tone="yellow" title="Not enough fresh evidence: evidence was expired in this sandbox" role="alert">
          {expired.map((e) => (
            <span key={`${e.edgeRef}-${e.revision}`} className="global-banners-2">
              <code className="global-banners__code">{e.edgeRef}</code> (valid_until set in the past at revision{' '}
              {e.revision})
            </span>
          ))}
          Verdicts that depend on it are inconclusive until the sandbox is reset, and no certificate can be issued.
        </Banner>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [preset, setPreset] = useState<SandboxOperation | undefined>(undefined);
  const openSandbox = useCallback((next?: SandboxOperation) => {
    setPreset(next);
    setSandboxOpen(true);
  }, []);
  const actions = useMemo<ShellActions>(() => ({ openSandbox }), [openSandbox]);

  // <main> is the scroll container; start each screen at the top.
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <ShellContext.Provider value={actions}>
      <a
        href="#main"
        className="sr-only app-shell__link"
      >
        Skip to content
      </a>
      <div className="app-shell__stack">
        <Header onOpenSandbox={() => openSandbox()} />
        <GlobalBanners onOpenSandbox={() => openSandbox()} />
        <main id="main" ref={main} className="app-shell__main" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="app-shell__block">
                <LoadingState title="Loading this screen" detail="Fetching the page code" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
      <SandboxDrawer open={sandboxOpen} onOpenChange={setSandboxOpen} preset={preset} />
    </ShellContext.Provider>
  );
}
