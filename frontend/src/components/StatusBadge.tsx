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
import './StatusBadge.css';

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
  return <Icon className={cn('status-icon', className)} aria-hidden strokeWidth={2} />;
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
  sm: 'status-badge--sm',
  md: 'status-badge--md',
  lg: 'status-badge--lg',
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
        'status-badge',
        descriptor.tone === 'neutral' ? 'status-badge--neutral' : [tone.text, tone.bg, tone.border],
        descriptor.tone === 'violet' && 'status-badge--violet',
        SIZE[size],
        className,
      )}
      data-status={status}
      data-tone={descriptor.tone}
    >
      <StatusIcon name={descriptor.icon} />
      <span className="status-badge__label">
        {descriptor.label}
        {why ? <span className="status-badge__label-2"> · {why}</span> : null}
      </span>
    </span>
  );

  return tooltip ? (
    <Tip content={descriptor.description}>
      <button type="button" className="status-badge__button">
        {badge}
      </button>
    </Tip>
  ) : (
    badge
  );
}
