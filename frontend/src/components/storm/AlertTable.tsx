import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { AlertTriageClass, AlertView, StormView } from '@/api/types';
import { cn } from '@/lib/cn';
import { formatCount, formatUtc } from '@/lib/format';
import { ROLE } from '@/lib/status';
import { clusterOfPod, SEVERITY_ORDER } from '@/lib/storm';

import { StatusBadge } from '../StatusBadge';
import { EmptyState } from '../states';
import { UntrustedText } from '../UntrustedText';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/form';
import { Tag } from '../ui/tag';
import { Tip } from '../ui/tooltip';

type ClassFilter = 'ALL' | AlertTriageClass;

const CLASS_TABS: { value: ClassFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ON_ATTACK_PATH', label: 'On a path' },
  { value: 'NOT_ON_ATTACK_PATH', label: 'Not on a path' },
  { value: 'NOT_ACTIONABLE', label: 'Not actionable' },
  { value: 'TRIAGE_INCONCLUSIVE', label: 'Inconclusive' },
];

const PAGE_SIZES = [25, 50, 100];

function matches(alert: AlertView, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    alert.alert_id.includes(q) ||
    alert.pod.toLowerCase().includes(q) ||
    alert.cve_id.toLowerCase().includes(q) ||
    (alert.title?.untrusted_text.toLowerCase().includes(q) ?? false)
  );
}

export function AlertTable({ storm, initialQuery = '' }: { storm: StormView; initialQuery?: string }) {
  const alerts = useMemo(() => storm.alerts ?? [], [storm.alerts]);
  const id = useId();
  const [klass, setKlass] = useState<ClassFilter>('ALL');
  const [severity, setSeverity] = useState<string>('ALL');
  const [query, setQuery] = useState(initialQuery);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => setPage(0), [klass, severity, deferredQuery, pageSize]);

  const filtered = useMemo(
    () =>
      alerts.filter(
        (a) =>
          (klass === 'ALL' || a.triage_class === klass) &&
          (severity === 'ALL' || a.severity === severity) &&
          matches(a, deferredQuery),
      ),
    [alerts, klass, severity, deferredQuery],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * pageSize, current * pageSize + pageSize);
  const first = filtered.length === 0 ? 0 : current * pageSize + 1;
  const last = Math.min(filtered.length, (current + 1) * pageSize);

  if (alerts.length === 0) {
    return (
      <EmptyState title="No alerts in this storm">
        The storm report lists {formatCount(storm.total_alerts)} alerts but the API returned none in this view.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Filter by triage class" className="flex flex-wrap items-center gap-1">
          {CLASS_TABS.map((tab) => {
            const count = tab.value === 'ALL' ? storm.total_alerts : storm.counts[tab.value];
            const active = klass === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKlass(tab.value)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-ui transition-colors',
                  active ? 'border-line-strong bg-elevated text-fg' : 'border-line text-fg-muted hover:text-fg',
                )}
              >
                {tab.label}
                <span className="tabular text-2xs text-fg-subtle">{formatCount(count)}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-severity`} className="sr-only">
            Severity
          </label>
          <Select
            id={`${id}-severity`}
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="h-7 w-auto font-sans text-ui"
          >
            <option value="ALL">All severities</option>
            {SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <label htmlFor={`${id}-search`} className="sr-only">
              Search alerts by id, workload, CVE or title
            </label>
            <Input
              id={`${id}-search`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Alert, workload, CVE or title"
              className="h-7 w-60 pl-7 pr-7"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[960px] border-collapse text-left text-ui">
          <caption className="sr-only">
            Alerts in storm {storm.storm_id}, filtered: showing {first} to {last} of {filtered.length}.
          </caption>
          <thead className="sticky top-0 z-10 bg-surface text-2xs uppercase tracking-[0.05em] text-fg-subtle">
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-2 font-medium">Alert</th>
              <th scope="col" className="px-3 py-2 font-medium">Workload</th>
              <th scope="col" className="px-3 py-2 font-medium">Vulnerability</th>
              <th scope="col" className="px-3 py-2 font-medium">Triage class</th>
              <th scope="col" className="px-3 py-2 font-medium">Reason</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Tip content="Titles are untrusted scanner text: shown as inert plain text and never used as instructions or queries.">
                  <button type="button" className="cursor-help uppercase underline decoration-dotted underline-offset-2">
                    Title (untrusted)
                  </button>
                </Tip>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">Scanner</th>
              <th scope="col" className="px-3 py-2 font-medium">Seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((alert) => {
              const cluster = clusterOfPod(storm, alert.pod);
              return (
                <tr key={alert.alert_id} className="border-b border-line/70 last:border-0 hover:bg-hover/40">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-fg-muted">{alert.alert_id}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      {cluster && alert.triage_class === 'ON_ATTACK_PATH' ? (
                        <Link
                          to={`/clusters/${cluster.id}?pod=${encodeURIComponent(alert.pod)}`}
                          className="font-mono text-[12px] text-accent hover:underline"
                        >
                          {alert.pod}
                        </Link>
                      ) : (
                        <span className="font-mono text-[12px] text-fg">{alert.pod}</span>
                      )}
                      {alert.roles.map((role) => (
                        <Tag key={role}>{ROLE[role].label}</Tag>
                      ))}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="font-mono text-[12px] text-fg">{alert.cve_id}</span>
                    <span className="ml-1.5 text-2xs text-fg-subtle">{alert.severity.toLowerCase()}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <StatusBadge status={alert.triage_class} size="sm" />
                  </td>
                  <td className="max-w-[15rem] truncate px-3 py-1.5 text-2xs text-fg-muted" title={alert.reason}>
                    {alert.reason}
                  </td>
                  <td className="max-w-[20rem] px-3 py-1.5">
                    <UntrustedText value={alert.title} truncate />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-fg-subtle">
                    {alert.scanner?.replace(/^synthetic-/, '') ?? '–'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-2xs text-fg-subtle">
                    {formatUtc(alert.created_at, { seconds: false })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-ui text-fg-muted">No alerts match these filters.</div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-2xs text-fg-muted">
        <span aria-live="polite">
          Showing <span className="tabular text-fg">{formatCount(first)}</span>–
          <span className="tabular text-fg">{formatCount(last)}</span> of{' '}
          <span className="tabular text-fg">{formatCount(filtered.length)}</span> matching alerts
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor={`${id}-size`}>Rows</label>
          <Select
            id={`${id}-size`}
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-7 w-auto font-sans text-ui"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
          <Button size="icon" variant="ghost" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">
            <ChevronLeft aria-hidden />
          </Button>
          <span className="tabular">
            Page {current + 1} of {pages}
          </span>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setPage(current + 1)}
            disabled={current >= pages - 1}
            aria-label="Next page"
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
