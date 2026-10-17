import { CircleHelp, Inbox, RotateCcw, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { toApiError } from '@/api/errors';
import { cn } from '@/lib/cn';
import { TONE_CLASS, type Tone } from '@/lib/status';

import { Button } from './ui/button';
import { ProgressRail } from './ui/misc';
import './states.css';

/** Live progress with what is being loaded, never a blank spinner (§13.6). */
export function LoadingState({
  title,
  detail,
  className,
  compact = false,
}: {
  title: string;
  detail?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('loading-state', compact ? 'loading-state--compact' : 'loading-state--not-compact', className)}
    >
      <ProgressRail className="loading-state__progress-rail" />
      <div className="loading-state__block">{title}</div>
      {detail ? <div className="loading-state__block-2">{detail}</div> : null}
    </div>
  );
}

/**
 * A typed error with a retry. Errors are never rendered as an empty result ("0 paths"): the
 * code and message say that nothing could be concluded.
 */
export function ErrorState({
  error,
  title,
  onRetry,
  className,
  compact = false,
}: {
  error: unknown;
  title: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const typed = toApiError(error);
  return (
    <div
      role="alert"
      className={cn(
        'error-state',
        compact ? 'error-state--compact' : 'error-state--not-compact',
        className,
      )}
    >
      <div className="error-state__row">
        <TriangleAlert className="error-state__icon" aria-hidden />
        <div className="error-state__block">
          <div className="error-state__block-2">{title}</div>
          <div className="error-state__block-3">{typed.message}</div>
          <div className="error-state__row-2">
            <code className="error-state__code">
              {typed.code}
              {typed.status ? ` · HTTP ${typed.status}` : ''}
            </code>
            <span className="error-state__label">No result is shown, so nothing is concluded from this.</span>
          </div>
        </div>
        {onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon: Icon = Inbox,
  className,
  action,
}: {
  title: string;
  children?: ReactNode;
  icon?: LucideIcon;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn('empty-state', className)}>
      <Icon className="empty-state__icon" aria-hidden />
      <div className="empty-state__block">{title}</div>
      {children ? <div className="empty-state__block-2">{children}</div> : null}
      {action ? <div className="empty-state__block-3">{action}</div> : null}
    </div>
  );
}

export function Banner({
  tone,
  icon: Icon = CircleHelp,
  title,
  children,
  actions,
  className,
  role = 'status',
}: {
  tone: Tone;
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  role?: 'status' | 'alert' | 'note';
}) {
  const t = TONE_CLASS[tone];
  return (
    <div
      role={role}
      className={cn(
        'banner',
        tone === 'neutral' ? 'banner--neutral' : [t.bg, t.border],
        className,
      )}
    >
      <Icon className={cn('banner__icon', tone === 'neutral' ? 'banner__icon--neutral' : t.text)} aria-hidden />
      <div className="banner__block">
        <div className={cn('banner__block-2', tone === 'neutral' ? 'banner__block--neutral' : t.text)}>{title}</div>
        {children ? <div className="banner__block-3">{children}</div> : null}
      </div>
      {actions ? <div className="banner__row">{actions}</div> : null}
    </div>
  );
}
