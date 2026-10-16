import { cn } from '@/lib/cn';

/** Two nodes and a severed edge: the cut between the Internet and the crown jewel. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('size-6', className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="rgb(var(--elevated))" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" stroke="rgb(var(--line-strong))" />
      <circle cx="8.5" cy="16" r="3.25" stroke="currentColor" strokeWidth="2" />
      <circle cx="23.5" cy="16" r="3.75" fill="currentColor" />
      <path d="M11.75 16h2.5M17.75 16h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14.25 21.25 17.75 10.75" stroke="#a78bfa" strokeWidth="2.25" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-fg', className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">Interdict</span>
    </span>
  );
}
