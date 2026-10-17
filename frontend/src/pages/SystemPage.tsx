import { Bot, FlaskConical, PlugZap } from 'lucide-react';
import type { ReactNode } from 'react';

import { useStorm, useSystem } from '@/api/queries';
import type { NamedEntry, QueryRecord } from '@/api/types';
import { useApi } from '@/app/services';
import { Footer } from '@/components/layout/Footer';
import { Num } from '@/components/Num';
import { ErrorState, LoadingState } from '@/components/states';
import { Tag } from '@/components/ui/tag';
import { formatUtc } from '@/lib/format';
import './SystemPage.css';

function entryName(entry: NamedEntry): { name: string; description?: string } {
  if (typeof entry === 'string') return { name: entry };
  return { name: entry.name ?? entry.op ?? 'unnamed', ...(entry.description ? { description: entry.description } : {}) };
}

function Card({ title, children, subtitle }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <header className="card__header">
        <h2 className="card__title">{title}</h2>
        {subtitle ? <p className="card__text">{subtitle}</p> : null}
      </header>
      <div className="card__block">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt className="fact__term">{label}</dt>
      <dd className="fact__value">{children}</dd>
    </div>
  );
}

/** Measured latency per query template: one series, direct labels, the table is its own text twin. */
function Latencies({ rows }: { rows: { template: string; latency: number; rowsReturned?: number }[] }) {
  const max = Math.max(...rows.map((r) => r.latency), 1);
  return (
    <table className="latencies">
      <caption className="sr-only">Measured latency per query template, in milliseconds</caption>
      <thead className="latencies__head">
        <tr>
          <th scope="col" className="latencies__heading-cell">Template</th>
          {rows.some((r) => r.rowsReturned !== undefined) ? (
            <th scope="col" className="latencies__heading-cell-2">Rows</th>
          ) : null}
          <th scope="col" className="latencies__heading-cell-3">Latency</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.template} className="latencies-2">
            <th scope="row" className="latencies__heading-cell-4">
              {row.template}
            </th>
            {row.rowsReturned !== undefined ? (
              <td className="latencies__cell">
                <Num metric="tierRows" value={row.rowsReturned} plain />
              </td>
            ) : null}
            <td className="latencies__cell-2">
              <div className="latencies__row">
                <div className="latencies__block" aria-hidden>
                  <div
                    className="latencies__block-2"
                    style={{ width: `${Math.max((row.latency / max) * 100, 0.75)}%` }}
                  />
                </div>
                <span className="latencies__label">
                  <Num metric="queryLatency" value={row.latency} format="ms" />
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SystemPage() {
  const client = useApi();
  const system = useSystem();
  const storm = useStorm();

  if (system.isPending) {
    return (
      <div className="system-page">
        <LoadingState title="Loading system facts" detail="GET /api/system" />
      </div>
    );
  }
  if (system.error) {
    return (
      <div className="system-page">
        <ErrorState error={system.error} title="System facts could not be loaded" onRetry={() => void system.refetch()} />
      </div>
    );
  }

  const s = system.data;
  const stats = s.graph_stats ?? storm.data?.graph_stats;
  const queries: QueryRecord[] = storm.data?.queries ?? [];
  const latencyRows = s.latencies_ms
    ? Object.entries(s.latencies_ms).map(([template, latency]) => ({
        template,
        latency,
        ...(queries.find((q) => q.template === template) ? { rowsReturned: queries.find((q) => q.template === template)?.rows } : {}),
      }))
    : queries.map((q) => ({ template: q.template, latency: q.latency_ms, rowsReturned: q.rows }));

  return (
    <div className="system-page-2">
      <div className="system-page__block">
        <header>
          <h1 className="system-page__heading">Under the hood</h1>
          <p className="system-page__text">
            The tools the agent uses, the graph it reasons over, and how fast each query ran, so every number can be
            checked.
          </p>
        </header>

        <div className="system-page__grid">
          <Card title="The agent’s MCP tools" subtitle="The only actions the agent can take: typed, parameterised, never model-written Cypher">
            {s.tools && s.tools.length > 0 ? (
              <ul className="system-page__list">
                {s.tools.map((entry) => {
                  const tool = entryName(entry);
                  return (
                    <li key={tool.name} className="system-page-5">
                      <span className="system-page__label-3">{tool.name}</span>
                      {tool.description ? <span className="system-page__label-4"> · {tool.description}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="system-page__text-3">Not reported by this API.</p>
            )}
          </Card>
          <Card title="Sandbox operations" subtitle="Typed changes a visitor can make to their own sandbox; never callable by the agent">
            {s.sandbox_operations && s.sandbox_operations.length > 0 ? (
              <ul className="system-page__list">
                {s.sandbox_operations.map((entry) => {
                  const op = entryName(entry);
                  return (
                    <li key={op.name} className="system-page-6">
                      {op.name}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="system-page__text-3">Not reported by this API.</p>
            )}
          </Card>
        </div>

        <div className="system-page__grid">
          <Card title="Deployment">
            <dl>
              <Fact label="FalkorDB">
                <span className="system-page__label">{s.falkordb_version}</span>
              </Fact>
              <Fact label="Build SHA">
                <span className="system-page__label">{s.build_sha}</span>
              </Fact>
              <Fact label="API">{client.mode === 'mock' ? 'Recorded fixtures (mock mode, in the browser)' : 'Live API'}</Fact>
              <Fact label="Execution">
                <span className="system-page__label-2">
                  <FlaskConical className="system-page__icon" aria-hidden />
                  {s.live_mode ? 'LIVE enabled' : 'LIVE disabled: simulation only, no infrastructure is changed'}
                </span>
              </Fact>
              <Fact label="Agent">
                {client.mode === 'mock' ? (
                  'Not available offline: recorded deterministic runs only'
                ) : s.agent_available ? (
                  <span className="system-page__label-2">
                    <Bot className="system-page__icon" aria-hidden />
                    Claude ({s.agent_model ?? 'model not reported'})
                  </span>
                ) : (
                  <span className="system-page__label-2">
                    <PlugZap className="system-page__icon" aria-hidden />
                    Deterministic only (no API key)
                  </span>
                )}
              </Fact>
              <Fact label="Gate fallbacks">
                {s.active_fallbacks && s.active_fallbacks.length > 0 ? s.active_fallbacks.join(', ') : 'None reported'}
              </Fact>
            </dl>
          </Card>

          <Card title="Dataset">
            <dl>
              <Fact label="Data">{s.dataset}</Fact>
              <Fact label="Seed">
                <span className="system-page__label">{s.seed}</span>
              </Fact>
              <Fact label="Generator version">
                <span className="system-page__label">{s.generator_version}</span>
              </Fact>
              {s.storm_id ?? storm.data?.storm_id ? (
                <Fact label="Storm">
                  <span className="system-page__label">{s.storm_id ?? storm.data?.storm_id}</span>
                </Fact>
              ) : null}
              {s.alert_count !== undefined ? (
                <Fact label="Alerts">
                  <Num metric="alertsTotal" value={s.alert_count} />
                </Fact>
              ) : null}
            </dl>
          </Card>
        </div>

        {stats ? (
          <Card title="Graph" subtitle={s.graph_stats ? 'Reported by GET /api/system' : 'From the latest storm triage (GET /api/storm)'}>
            <dl className="system-page__details">
              {[
                { label: 'Pods', node: <Num metric="graphPods" value={stats.pods} /> },
                { label: 'Crown jewels', node: <Num metric="crownJewels" value={stats.crown_jewels.length} /> },
                { label: 'Observed flows', node: <Num metric="graphFlows" value={stats.observed_flows} /> },
                { label: 'Vulnerability findings', node: <Num metric="graphFindings" value={stats.vulnerability_findings} /> },
                ...(storm.data?.attack_steps
                  ? [{ label: 'ATTACK_STEP edges', node: <Num metric="attackSteps" value={storm.data.attack_steps.total} /> }]
                  : []),
              ].map((item) => (
                <div key={item.label} className="system-page-3">
                  <dt className="system-page__term">{item.label}</dt>
                  <dd className="system-page__value">{item.node}</dd>
                </div>
              ))}
            </dl>
            <p className="system-page__text-2">
              Crown jewels:{' '}
              {stats.crown_jewels.map((j) => (
                <Tag key={j} mono className="system-page-4">
                  {j}
                </Tag>
              ))}
            </p>
          </Card>
        ) : null}

        {latencyRows.length > 0 ? (
          <Card
            title="Measured query latency"
            subtitle={
              storm.data
                ? `MEASURED_RUNTIME: time.perf_counter() around each template, in the triage of ${storm.data.storm_id} at revision ${storm.data.revision} (${formatUtc(storm.data.evaluated_at)}).`
                : 'MEASURED_RUNTIME: time.perf_counter() around each template.'
            }
          >
            <Latencies rows={latencyRows} />
          </Card>
        ) : null}

      </div>
      <Footer />
    </div>
  );
}
