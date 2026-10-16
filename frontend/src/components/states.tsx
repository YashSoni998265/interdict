import { CircleHelp, Inbox, RotateCcw, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { toApiError } from '@/api/errors';
import { cn } from '@/lib/cn';
import { TONE_CLASS, type Tone } from '@/lib/status';

import { Button } from './ui/button';
import { ProgressRail } from './ui/misc';

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
      className={cn('flex flex-col gap-2', compact ? 'py-3' : 'py-8', className)}
    >
      <ProgressRail className="w-40" />
      <div className="text-ui text-fg">{title}</div>
      {detail ? <div className="text-2xs text-fg-muted">{detail}</div> : null}
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
        'rounded-lg border border-red-500/30 bg-red-500/[0.06]',
        compact ? 'px-3 py-2.5' : 'px-4 py-4',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-ui font-medium text-fg">{title}</div>
          <div className="text-ui text-fg-muted">{typed.message}</div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <code className="rounded border border-line bg-canvas px-1.5 py-px text-2xs text-fg-muted">
              {typed.code}
              {typed.status ? ` · HTTP ${typed.status}` : ''}
            </code>
            <span className="text-2xs text-fg-subtle">No result is shown, so nothing is concluded from this.</span>
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
    <div className={cn('flex flex-col items-start gap-2 rounded-lg border border-dashed border-line px-4 py-5', className)}>
      <Icon className="size-4 text-fg-subtle" aria-hidden />
      <div className="text-ui font-medium text-fg">{title}</div>
      {children ? <div className="max-w-prose text-ui text-fg-muted">{children}</div> : null}
      {action ? <div className="pt-1">{action}</div> : null}
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
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5',
        tone === 'neutral' ? 'border-line bg-surface' : [t.bg, t.border],
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'neutral' ? 'text-fg-muted' : t.text)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={cn('text-ui font-medium', tone === 'neutral' ? 'text-fg' : t.text)}>{title}</div>
        {children ? <div className="mt-0.5 text-ui text-fg-muted">{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
