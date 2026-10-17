import { ArrowRight, BadgeCheck, Clock, FileX2, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useCertificate } from '@/api/queries';
import type { HuntReportView } from '@/api/types';
import { useHuntOutcome } from '@/app/hooks';
import { useNow, useSandboxState } from '@/app/services';
import { cn } from '@/lib/cn';
import { formatRelative, formatUtc, shortHash } from '@/lib/format';
import { describeStatus, reasonText } from '@/lib/status';

import { StatusBadge } from '../StatusBadge';
import { Button } from '../ui/button';
import { CopyButton } from '../ui/misc';
import { Tag } from '../ui/tag';
import './CertificateCard.css';

export function CertificateCard({
  hunt,
  onRerun,
  rerunDisabled,
}: {
  hunt: HuntReportView;
  onRerun?: () => void;
  rerunDisabled?: boolean;
}) {
  const now = useNow();
  const sandboxRevision = useSandboxState((s) => s.revision);
  const query = useCertificate(hunt.certificate?.certificate_id ?? null);
  const { certificate, certificateStatus, certificateCurrent } = useHuntOutcome(hunt);

  if (!certificate) {
    const descriptor = describeStatus(hunt.status);
    return (
      <div className="certificate-card">
        <div className="certificate-card__row">
          <FileX2 className="certificate-card__icon" aria-hidden />
          No certificate
        </div>
        <p className="certificate-card__text">
          {descriptor.label}
          {hunt.reason ? `: ${reasonText(hunt.reason)}` : ''}. A certificate is issued only when the evidence is
          complete and fresh and E, F and O all agree that no path reaches the target.
        </p>
      </div>
    );
  }

  const current = certificateCurrent;
  const status = certificateStatus ?? certificate.status;
  const currentRevision = sandboxRevision ?? certificate.current_revision;
  return (
    <div
      className={cn(
        'certificate-card-2',
        current ? 'certificate-card--current' : 'certificate-card--not-current',
      )}
      aria-label="Certificate status"
    >
      <div className="certificate-card__row-2">
        {current ? (
          <BadgeCheck className="certificate-card__icon-2" aria-hidden />
        ) : (
          <Clock className="certificate-card__icon-3" aria-hidden />
        )}
        <div className="certificate-card__block">
          <div className={cn('certificate-card__block-2', current ? 'certificate-card__block--current' : 'certificate-card__block--not-current')}>
            {current ? 'Model-verified containment (simulation)' : 'Certificate no longer current'}
          </div>
          <div className={cn('certificate-card__block-3', current ? 'certificate-card__block--current-2' : 'certificate-card__block--not-current-2')}>
            {current
              ? `Under ${certificate.threat_model.id}, on the hashed snapshot, no modelled chain reaches ${certificate.threat_model.t_scope.join(', ')} after the plan. Not real-world containment.`
              : `Was: model-verified containment (simulation) for ${certificate.threat_model.t_scope.join(', ')}.`}
          </div>
        </div>
        <StatusBadge status={status} size="sm" />
      </div>

      {!current ? (
        <p className="certificate-card__text-2">
          {status === 'SUPERSEDED'
            ? `Superseded: issued at sandbox revision ${certificate.snapshot.sandbox_revision}; the sandbox is now at revision ${currentRevision ?? '?'}.`
            : status === 'EXPIRED'
              ? `Expired at ${formatUtc(certificate.expires_at)}: its evidence is no longer fresh.`
              : describeStatus(status).description}
        </p>
      ) : null}

      <dl className="certificate-card__details">
        <dt className="certificate-card__term">Scope</dt>
        <dd className="certificate-card__value">
          {certificate.threat_model.t_scope.map((t) => (
            <Tag key={t} mono>
              {t}
            </Tag>
          ))}
        </dd>
        <dt className="certificate-card__term">Issued</dt>
        <dd className="certificate-card__value-2">
          {formatUtc(certificate.issued_at)} · revision {certificate.snapshot.sandbox_revision}
        </dd>
        <dt className="certificate-card__term">Expires</dt>
        <dd className="certificate-card__value-2">
          {formatUtc(certificate.expires_at)}{' '}
          <span className="certificate-card__label">({formatRelative(certificate.expires_at, now)})</span>
        </dd>
        <dt className="certificate-card__term">Digest</dt>
        <dd className="certificate-card__value-3">
          <span className="certificate-card__label-2" title={certificate.digest}>
            {shortHash(certificate.digest, 10, 8)}
          </span>
          <CopyButton value={certificate.digest} label="Copy certificate digest" />
        </dd>
      </dl>

      <div className="certificate-card__row-3">
        <Button asChild size="sm" variant={current ? 'primary' : 'secondary'}>
          <Link to={`/certificates/${certificate.certificate_id}`}>
            Open certificate
            <ArrowRight aria-hidden />
          </Link>
        </Button>
        {!current && onRerun ? (
          <Button size="sm" variant="secondary" onClick={onRerun} disabled={rerunDisabled}>
            <RotateCcw aria-hidden />
            Re-run
          </Button>
        ) : null}
        {query.isFetching ? <span className="certificate-card__label-3">Checking status…</span> : null}
        {query.error ? <span className="certificate-card__label-4">Status check failed; showing the issued copy.</span> : null}
      </div>
    </div>
  );
}
