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
      <div className="rounded-lg border border-dashed border-line px-3.5 py-3">
        <div className="flex items-center gap-2 text-ui font-medium text-fg">
          <FileX2 className="size-4 text-fg-subtle" aria-hidden />
          No certificate
        </div>
        <p className="mt-1 text-2xs text-fg-muted">
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
        'rounded-lg border px-3.5 py-3 transition-colors',
        current ? 'border-emerald-500/35 bg-emerald-500/[0.06]' : 'border-zinc-500/30 bg-zinc-500/[0.06]',
      )}
      aria-label="Certificate status"
    >
      <div className="flex flex-wrap items-start gap-2">
        {current ? (
          <BadgeCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden />
        ) : (
          <Clock className="mt-0.5 size-5 shrink-0 text-zinc-400" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className={cn('text-sm font-semibold', current ? 'text-emerald-300' : 'text-zinc-300')}>
            {current ? 'Model-verified containment (simulation)' : 'Certificate no longer current'}
          </div>
          <div className={cn('mt-0.5 text-2xs', current ? 'text-fg-muted' : 'text-fg-subtle line-through decoration-zinc-500/60')}>
            {current
              ? `Under ${certificate.threat_model.id}, on the hashed snapshot, no modelled chain reaches ${certificate.threat_model.t_scope.join(', ')} after the plan. Not real-world containment.`
              : `Was: model-verified containment (simulation) for ${certificate.threat_model.t_scope.join(', ')}.`}
          </div>
        </div>
        <StatusBadge status={status} size="sm" />
      </div>

      {!current ? (
        <p className="mt-2 text-2xs text-fg-muted">
          {status === 'SUPERSEDED'
            ? `Superseded: issued at sandbox revision ${certificate.snapshot.sandbox_revision}; the sandbox is now at revision ${currentRevision ?? '?'}.`
            : status === 'EXPIRED'
              ? `Expired at ${formatUtc(certificate.expires_at)}: its evidence is no longer fresh.`
              : describeStatus(status).description}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-2xs">
        <dt className="text-fg-subtle">Scope</dt>
        <dd className="flex flex-wrap gap-1">
          {certificate.threat_model.t_scope.map((t) => (
            <Tag key={t} mono>
              {t}
            </Tag>
          ))}
        </dd>
        <dt className="text-fg-subtle">Issued</dt>
        <dd className="text-fg-muted">
          {formatUtc(certificate.issued_at)} · revision {certificate.snapshot.sandbox_revision}
        </dd>
        <dt className="text-fg-subtle">Expires</dt>
        <dd className="text-fg-muted">
          {formatUtc(certificate.expires_at)}{' '}
          <span className="text-fg-subtle">({formatRelative(certificate.expires_at, now)})</span>
        </dd>
        <dt className="text-fg-subtle">Digest</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-[11px] text-fg" title={certificate.digest}>
            {shortHash(certificate.digest, 10, 8)}
          </span>
          <CopyButton value={certificate.digest} label="Copy certificate digest" />
        </dd>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
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
        {query.isFetching ? <span className="text-2xs text-fg-subtle">Checking status…</span> : null}
        {query.error ? <span className="text-2xs text-yellow-300">Status check failed; showing the issued copy.</span> : null}
      </div>
    </div>
  );
}
