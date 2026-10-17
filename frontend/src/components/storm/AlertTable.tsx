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
import './AlertTable.css';

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
    <div className="alert-table">
      <div className="alert-table__row">
        <div role="radiogroup" aria-label="Filter by triage class" className="alert-table__row-2">
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
                  'alert-table-2',
                  active ? 'alert-table--active' : 'alert-table--not-active',
                )}
              >
                {tab.label}
                <span className="tabular alert-table__label">{formatCount(count)}</span>
              </button>
            );
          })}
        </div>
        <div className="alert-table__row-3">
          <label htmlFor={`${id}-severity`} className="sr-only">
            Severity
          </label>
          <Select
            id={`${id}-severity`}
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="alert-table__select"
          >
            <option value="ALL">All severities</option>
            {SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
          <div className="alert-table__block">
            <Search className="alert-table__icon" aria-hidden />
            <label htmlFor={`${id}-search`} className="sr-only">
              Search alerts by id, workload, CVE or title
            </label>
            <Input
              id={`${id}-search`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Alert, workload, CVE or title"
              className="alert-table__input"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="alert-table__button"
              >
                <X className="alert-table__icon-2" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="alert-table__box">
        <table className="alert-table__table">
          <caption className="sr-only">
            Alerts in storm {storm.storm_id}, filtered: showing {first} to {last} of {filtered.length}.
          </caption>
          <thead className="alert-table__head">
            <tr className="alert-table__row-4">
              <th scope="col" className="alert-table__heading-cell">Alert</th>
              <th scope="col" className="alert-table__heading-cell">Workload</th>
              <th scope="col" className="alert-table__heading-cell">Vulnerability</th>
              <th scope="col" className="alert-table__heading-cell">Triage class</th>
              <th scope="col" className="alert-table__heading-cell">Reason</th>
              <th scope="col" className="alert-table__heading-cell">
                <Tip content="Titles are untrusted scanner text: shown as inert plain text and never used as instructions or queries.">
                  <button type="button" className="alert-table__button-2">
                    Title (untrusted)
                  </button>
                </Tip>
              </th>
              <th scope="col" className="alert-table__heading-cell">Scanner</th>
              <th scope="col" className="alert-table__heading-cell">Seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((alert) => {
              const cluster = clusterOfPod(storm, alert.pod);
              return (
                <tr key={alert.alert_id} className="alert-table-3">
                  <td className="alert-table__cell">{alert.alert_id}</td>
                  <td className="alert-table__cell-2">
                    <span className="alert-table__label-2">
                      {cluster && alert.triage_class === 'ON_ATTACK_PATH' ? (
                        <Link
                          to={`/clusters/${cluster.id}?pod=${encodeURIComponent(alert.pod)}`}
                          className="alert-table__link"
                        >
                          {alert.pod}
                        </Link>
                      ) : (
                        <span className="alert-table__label-3">{alert.pod}</span>
                      )}
                      {alert.roles.map((role) => (
                        <Tag key={role}>{ROLE[role].label}</Tag>
                      ))}
                    </span>
                  </td>
                  <td className="alert-table__cell-2">
                    <span className="alert-table__label-3">{alert.cve_id}</span>
                    <span className="alert-table__label-4">{alert.severity.toLowerCase()}</span>
                  </td>
                  <td className="alert-table__cell-2">
                    <StatusBadge status={alert.triage_class} size="sm" />
                  </td>
                  <td className="alert-table__cell-3" title={alert.reason}>
                    {alert.reason}
                  </td>
                  <td className="alert-table__cell-4">
                    <UntrustedText value={alert.title} truncate />
                  </td>
                  <td className="alert-table__cell-5">
                    {alert.scanner?.replace(/^synthetic-/, '') ?? '–'}
                  </td>
                  <td className="alert-table__cell-6">
                    {formatUtc(alert.created_at, { seconds: false })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="alert-table__block-2">No alerts match these filters.</div>
        ) : null}
      </div>

      <div className="alert-table__row-5">
        <span aria-live="polite">
          Showing <span className="tabular alert-table__label-5">{formatCount(first)}</span>–
          <span className="tabular alert-table__label-5">{formatCount(last)}</span> of{' '}
          <span className="tabular alert-table__label-5">{formatCount(filtered.length)}</span> matching alerts
        </span>
        <div className="alert-table__row-6">
          <label htmlFor={`${id}-size`}>Rows</label>
          <Select
            id={`${id}-size`}
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="alert-table__select"
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
