import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

import { Tip } from './tooltip';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse-soft rounded-md bg-elevated', className)} aria-hidden {...props} />;
}

/** An indeterminate progress rail: motion is decorative, the adjacent text says what is loading. */
export function ProgressRail({ className }: { className?: string }) {
  return (
    <div className={cn('relative h-0.5 overflow-hidden rounded-full bg-elevated', className)} aria-hidden>
      <div className="absolute inset-y-0 w-1/3 animate-indeterminate rounded-full bg-accent/70" />
    </div>
  );
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Tip content={copied ? 'Copied' : label}>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? 'Copied' : label}
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg',
          className,
        )}
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
    </Tip>
  );
}

/** Raw JSON, pretty-printed as text (never interpreted). */
export function JsonView({ value, maxHeight = 'max-h-80', className }: { value: unknown; maxHeight?: string; className?: string }) {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  return (
    <div className={cn('relative rounded-md border border-line bg-canvas', className)}>
      <div className="absolute right-1.5 top-1.5">
        <CopyButton value={text} label="Copy JSON" />
      </div>
      <pre
        className={cn('overflow-auto px-3 py-2.5 pr-9 text-[11.5px] leading-[1.55] text-fg-muted', maxHeight)}
        // A scrollable region must be reachable by keyboard (WCAG 2.1.1, axe scrollable-region-focusable).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        aria-label="Raw JSON"
      >
        {text}
      </pre>
    </div>
  );
}

/** A monospace identifier that truncates, with the full value on hover and for copying. */
export function MonoId({ value, className, copy = false }: { value: string; className?: string; copy?: boolean }) {
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-0.5', className)}>
      <span className="mono-id truncate text-fg" title={value}>
        {value}
      </span>
      {copy ? <CopyButton value={value} label={`Copy ${value}`} /> : null}
    </span>
  );
}

export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-line bg-elevated px-1 py-px font-mono text-2xs text-fg-muted">{children}</kbd>
  );
}
