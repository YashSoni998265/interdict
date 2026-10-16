import type { HuntReportView } from '@/api/types';
import { useHuntOutcome } from '@/app/hooks';

import { StatusBadge, type StatusBadgeProps } from './StatusBadge';

/**
 * A hunt's outcome in the status language. Containment is shown only with a certificate that
 * is still current; once the sandbox changes it reads "Certificate no longer current".
 */
export function OutcomeBadge({
  hunt,
  size = 'md',
  tooltip = false,
  className,
}: {
  hunt: HuntReportView;
  size?: StatusBadgeProps['size'];
  tooltip?: boolean;
  className?: string;
}) {
  const outcome = useHuntOutcome(hunt);
  if (hunt.status === 'SIMULATED_CONTAINMENT' && hunt.certificate) {
    return outcome.certificateCurrent ? (
      <StatusBadge status="SIMULATED_CONTAINMENT" hasCertificate size={size} tooltip={tooltip} className={className} />
    ) : (
      <StatusBadge status={outcome.certificateStatus ?? 'SUPERSEDED'} size={size} tooltip={tooltip} className={className} />
    );
  }
  return (
    <StatusBadge
      status={hunt.status}
      reason={hunt.reason}
      hasCertificate={false}
      size={size}
      tooltip={tooltip}
      className={className}
    />
  );
}
