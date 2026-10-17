import { ChevronUp, Link2, ShieldCheck, ShieldX } from 'lucide-react';
import { useState } from 'react';

import { useAuditLog } from '@/api/queries';
import { useApi } from '@/app/services';
import { cn } from '@/lib/cn';
import { formatClock, shortHash } from '@/lib/format';

import { Tip } from '../ui/tooltip';
import './AuditStrip.css';

function ChainStatus({ valid }: { valid: boolean | null }) {
  if (valid === null) {
    return <span className="chain-status">chain status not reported</span>;
  }
  return valid ? (
    <Tip content="The API re-verified every link: Hash_N = SHA256(Payload_N ‖ Hash_{N−1}). Tamper-evident, not tamper-proof.">
      <button type="button" className="chain-status__button">
        <ShieldCheck className="chain-status__icon" aria-hidden />
        Hash chain verified
      </button>
    </Tip>
  ) : (
    <span className="chain-status-2" role="alert">
      <ShieldX className="chain-status__icon" aria-hidden />
      Hash chain broken
    </span>
  );
}

/** The append-only audit stream (§12.5), newest first, at the bottom of the workbench. */
export function AuditStrip() {
  const client = useApi();
  const audit = useAuditLog();
  const [open, setOpen] = useState(false);
  const events = audit.data?.events ?? [];
  const latest = events.slice(-4).reverse();

  return (
    <div className="audit-strip">
      <div className="audit-strip__row">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="audit-log"
          className="audit-strip__button"
        >
          <ChevronUp className={cn('audit-strip__icon', !open && 'audit-strip__icon--not-open')} aria-hidden />
          Audit
        </button>
        <ChainStatus valid={audit.data?.chainValid ?? null} />
        <ol className="audit-strip__list" aria-label="Latest audit events">
          {latest.map((event) => (
            <li key={event.seq} className="audit-strip-2">
              <span className="audit-strip__label">#{event.seq}</span>
              <span className="audit-strip__label-2">{event.event_type}</span>
              <span className="audit-strip__label-3">rev {event.graph_revision}</span>
              <span className="audit-strip__label-4">{shortHash(event.hash, 8, 0)}</span>
            </li>
          ))}
          {events.length === 0 ? (
            <li className="audit-strip__item">{audit.isPending ? 'Loading the audit stream…' : audit.error ? 'Audit stream unavailable' : 'No events yet'}</li>
          ) : null}
        </ol>
        {client.mode === 'mock' ? <span className="audit-strip__label-5">mock log, chained in this browser</span> : null}
      </div>
      {open ? (
        <div id="audit-log" className="audit-strip__block">
          <table className="audit-strip__table">
            <caption className="sr-only">Audit events, newest first</caption>
            <thead className="audit-strip__head">
              <tr>
                <th scope="col" className="audit-strip__heading-cell">#</th>
                <th scope="col" className="audit-strip__heading-cell">Time (UTC)</th>
                <th scope="col" className="audit-strip__heading-cell">Event</th>
                <th scope="col" className="audit-strip__heading-cell">Revision</th>
                <th scope="col" className="audit-strip__heading-cell">Trace</th>
                <th scope="col" className="audit-strip__heading-cell">
                  <span className="audit-strip__label-6">
                    <Link2 className="audit-strip__icon-2" aria-hidden />
                    prev_hash → hash
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="audit-strip__body">
              {[...events].reverse().map((event) => (
                <tr key={event.seq} className="audit-strip-3">
                  <td className="audit-strip__cell">{event.seq}</td>
                  <td className="audit-strip__cell-2">{formatClock(event.timestamp)}</td>
                  <td className="audit-strip__cell-3">{event.event_type}</td>
                  <td className="audit-strip__cell-2">{event.graph_revision}</td>
                  <td className="audit-strip__cell">{event.trace_id ?? event.investigation_id ?? '–'}</td>
                  <td className="audit-strip__cell">
                    <span title={event.prev_hash}>{shortHash(event.prev_hash, 6, 4)}</span>
                    {' → '}
                    <span className="audit-strip__label-7" title={event.hash}>
                      {shortHash(event.hash, 6, 4)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
