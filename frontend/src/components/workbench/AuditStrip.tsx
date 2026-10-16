import { ChevronUp, Link2, ShieldCheck, ShieldX } from 'lucide-react';
import { useState } from 'react';

import { useAuditLog } from '@/api/queries';
import { useApi } from '@/app/services';
import { cn } from '@/lib/cn';
import { formatClock, shortHash } from '@/lib/format';

import { Tip } from '../ui/tooltip';

function ChainStatus({ valid }: { valid: boolean | null }) {
  if (valid === null) {
    return <span className="inline-flex items-center gap-1 text-fg-subtle">chain status not reported</span>;
  }
  return valid ? (
    <Tip content="The API re-verified every link: Hash_N = SHA256(Payload_N ‖ Hash_{N−1}). Tamper-evident, not tamper-proof.">
      <button type="button" className="inline-flex cursor-help items-center gap-1 text-fg-muted">
        <ShieldCheck className="size-3.5" aria-hidden />
        Hash chain verified
      </button>
    </Tip>
  ) : (
    <span className="inline-flex items-center gap-1 text-red-400" role="alert">
      <ShieldX className="size-3.5" aria-hidden />
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
    <div className="shrink-0 border-t border-line bg-canvas">
      <div className="flex h-9 items-center gap-3 px-3 text-2xs">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="audit-log"
          className="inline-flex items-center gap-1.5 rounded font-semibold uppercase tracking-[0.08em] text-fg-muted hover:text-fg"
        >
          <ChevronUp className={cn('size-3.5 transition-transform', !open && 'rotate-180')} aria-hidden />
          Audit
        </button>
        <ChainStatus valid={audit.data?.chainValid ?? null} />
        <ol className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden" aria-label="Latest audit events">
          {latest.map((event) => (
            <li key={event.seq} className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-fg-muted">
              <span className="text-fg-subtle">#{event.seq}</span>
              <span className="text-fg">{event.event_type}</span>
              <span className="hidden text-fg-subtle xl:inline">rev {event.graph_revision}</span>
              <span className="hidden text-fg-subtle 2xl:inline">{shortHash(event.hash, 8, 0)}</span>
            </li>
          ))}
          {events.length === 0 ? (
            <li className="text-fg-subtle">{audit.isPending ? 'Loading the audit stream…' : audit.error ? 'Audit stream unavailable' : 'No events yet'}</li>
          ) : null}
        </ol>
        {client.mode === 'mock' ? <span className="hidden shrink-0 text-fg-subtle lg:inline">mock log, chained in this browser</span> : null}
      </div>
      {open ? (
        <div id="audit-log" className="max-h-[38vh] overflow-auto border-t border-line">
          <table className="w-full min-w-[56rem] text-left text-2xs">
            <caption className="sr-only">Audit events, newest first</caption>
            <thead className="sticky top-0 bg-surface text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">#</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Time (UTC)</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Event</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Revision</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Trace</th>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  <span className="inline-flex items-center gap-1">
                    <Link2 className="size-3" aria-hidden />
                    prev_hash → hash
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="font-mono text-[11px]">
              {[...events].reverse().map((event) => (
                <tr key={event.seq} className="border-t border-line/70">
                  <td className="px-3 py-1 text-fg-subtle">{event.seq}</td>
                  <td className="px-3 py-1 text-fg-muted">{formatClock(event.timestamp)}</td>
                  <td className="px-3 py-1 text-fg">{event.event_type}</td>
                  <td className="px-3 py-1 text-fg-muted">{event.graph_revision}</td>
                  <td className="px-3 py-1 text-fg-subtle">{event.trace_id ?? event.investigation_id ?? '–'}</td>
                  <td className="px-3 py-1 text-fg-subtle">
                    <span title={event.prev_hash}>{shortHash(event.prev_hash, 6, 4)}</span>
                    {' → '}
                    <span className="text-fg-muted" title={event.hash}>
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
