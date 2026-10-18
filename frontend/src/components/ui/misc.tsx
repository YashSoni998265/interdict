import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

import { Tip } from './tooltip';
import './misc.css';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton', className)} aria-hidden {...props} />;
}

/** An indeterminate progress rail: motion is decorative, the adjacent text says what is loading. */
export function ProgressRail({ className }: { className?: string }) {
  return (
    <div className={cn('progress-rail', className)} aria-hidden>
      <div className="progress-rail__overlay" />
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
          'copy-button__button',
          className,
        )}
      >
        {copied ? <Check className="copy-button__icon" aria-hidden /> : <Copy className="copy-button__icon" aria-hidden />}
      </button>
    </Tip>
  );
}

/** Raw JSON, pretty-printed as text (never interpreted). */
export function JsonView({ value, maxHeight = 'json-view__scroll', className }: { value: unknown; maxHeight?: string; className?: string }) {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  return (
    <div className={cn('json-view', className)}>
      <div className="json-view__overlay">
        <CopyButton value={text} label="Copy JSON" />
      </div>
      <pre
        className={cn('json-view__pre', maxHeight)}
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
