import {
  Ban,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  Link2,
  ListChecks,
  Minus,
  OctagonX,
  Scissors,
  Shield,
  Split,
  TriangleAlert,
  Unlink,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import {
  describeStatus,
  INCONCLUSIVE_FAMILY,
  reasonText,
  TONE_CLASS,
  type StatusDescriptor,
  type StatusIconName,
} from '@/lib/status';

import { Tip } from './ui/tooltip';

const STATUS_ICONS: Record<StatusIconName, LucideIcon> = {
  alert: TriangleAlert,
  shield: Shield,
  dash: Minus,
  split: Split,
  stop: OctagonX,
  question: CircleHelp,
  check: CircleCheck,
  clock: Clock,
  scissors: Scissors,
  dependency: Link2,
  unlink: Unlink,
  plan: ListChecks,
  ban: Ban,
  x: CircleX,
};

export function StatusIcon({ name, className }: { name: StatusIconName; className?: string }) {
  const Icon = STATUS_ICONS[name];
  return <Icon className={cn('size-3.5 shrink-0', className)} aria-hidden strokeWidth={2} />;
}

export interface StatusBadgeProps {
  status: string;
  /** Reason code shown after the label (inconclusive family, no plan). */
  reason?: string | null;
  /** Required for SIMULATED_CONTAINMENT: without a certificate the claim is withheld. */
  hasCertificate?: boolean;
  knownBroken?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Show the one-sentence description in a tooltip (the badge becomes focusable). */
  tooltip?: boolean;
  className?: string;
}

const SIZE = {
  sm: 'gap-1 px-1.5 py-px text-2xs [&_svg]:size-3',
  md: 'gap-1.5 px-2 py-0.5 text-ui [&_svg]:size-3.5',
  lg: 'gap-2 px-3 py-1.5 text-sm font-semibold [&_svg]:size-4',
};

/** The single rendering of an engine status: tone + icon + words, never colour alone. */
export function StatusBadge({
  status,
  reason,
  hasCertificate,
  knownBroken,
  size = 'md',
  tooltip = false,
  className,
}: StatusBadgeProps) {
  const descriptor: StatusDescriptor = describeStatus(status, { hasCertificate, knownBroken });
  const tone = TONE_CLASS[descriptor.tone];
  const why = reason && (INCONCLUSIVE_FAMILY.has(status) || status === 'NO_FEASIBLE_PLAN_WITHIN_K' || status === 'SUPERSEDED' || status === 'EXPIRED')
    ? reasonText(reason)
    : null;

  const badge = (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-md border font-medium leading-5',
        descriptor.tone === 'neutral' ? 'border-line bg-elevated text-fg' : [tone.text, tone.bg, tone.border],
        descriptor.tone === 'violet' && 'border-dashed',
        SIZE[size],
        className,
      )}
      data-status={status}
      data-tone={descriptor.tone}
    >
      <StatusIcon name={descriptor.icon} />
      <span className="min-w-0">
        {descriptor.label}
        {why ? <span className="font-normal opacity-85"> · {why}</span> : null}
      </span>
    </span>
  );

  return tooltip ? (
    <Tip content={descriptor.description}>
      <button type="button" className="inline-flex max-w-full cursor-help rounded-md text-left">
        {badge}
      </button>
    </Tip>
  ) : (
    badge
  );
}
