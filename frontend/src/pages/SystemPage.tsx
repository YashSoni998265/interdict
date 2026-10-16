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

function entryName(entry: NamedEntry): { name: string; description?: string } {
  if (typeof entry === 'string') return { name: entry };
  return { name: entry.name ?? entry.op ?? 'unnamed', ...(entry.description ? { description: entry.description } : {}) };
}

function Card({ title, children, subtitle }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface" aria-label={title}>
      <header className="border-b border-line px-4 py-2.5">
        <h2 className="text-ui font-semibold text-fg">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-2xs text-fg-muted">{subtitle}</p> : null}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-1.5 text-ui sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

/** Measured latency per query template: one series, direct labels, the table is its own text twin. */
function Latencies({ rows }: { rows: { template: string; latency: number; rowsReturned?: number }[] }) {
  const max = Math.max(...rows.map((r) => r.latency), 1);
  return (
    <table className="w-full text-left text-2xs">
      <caption className="sr-only">Measured latency per query template, in milliseconds</caption>
      <thead className="text-fg-subtle">
        <tr>
          <th scope="col" className="pb-1.5 pr-3 font-medium">Template</th>
          {rows.some((r) => r.rowsReturned !== undefined) ? (
            <th scope="col" className="pb-1.5 pr-3 text-right font-medium">Rows</th>
          ) : null}
          <th scope="col" className="w-1/2 pb-1.5 font-medium">Latency</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.template} className="border-t border-line/70">
            <th scope="row" className="py-1.5 pr-3 font-mono font-normal text-fg">
              {row.template}
            </th>
            {row.rowsReturned !== undefined ? (
              <td className="py-1.5 pr-3 text-right text-fg-muted">
                <Num metric="tierRows" value={row.rowsReturned} plain />
              </td>
            ) : null}
            <td className="py-1.5">
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1" aria-hidden>
                  <div
                    className="h-2 rounded-r-[4px] bg-fg-muted/70"
                    style={{ width: `${Math.max((row.latency / max) * 100, 0.75)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-fg">
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
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <LoadingState title="Loading system facts" detail="GET /api/system" />
      </div>
    );
  }
  if (system.error) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
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
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-fg">System</h1>
          <p className="mt-1 text-ui text-fg-muted">What runs this deployment and how fast it measured, so the numbers can be checked.</p>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Deployment">
            <dl>
              <Fact label="FalkorDB">
                <span className="font-mono">{s.falkordb_version}</span>
              </Fact>
              <Fact label="Build SHA">
                <span className="font-mono">{s.build_sha}</span>
              </Fact>
              <Fact label="API">{client.mode === 'mock' ? 'Recorded fixtures (mock mode, in the browser)' : 'Live API'}</Fact>
              <Fact label="Execution">
                <span className="inline-flex items-center gap-1.5">
                  <FlaskConical className="size-3.5 text-fg-muted" aria-hidden />
                  {s.live_mode ? 'LIVE enabled' : 'LIVE disabled: simulation only, no infrastructure is changed'}
                </span>
              </Fact>
              <Fact label="Agent">
                {client.mode === 'mock' ? (
                  'Not available offline: recorded deterministic runs only'
                ) : s.agent_available ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Bot className="size-3.5 text-fg-muted" aria-hidden />
                    Claude ({s.agent_model ?? 'model not reported'})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <PlugZap className="size-3.5 text-fg-muted" aria-hidden />
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
                <span className="font-mono">{s.seed}</span>
              </Fact>
              <Fact label="Generator version">
                <span className="font-mono">{s.generator_version}</span>
              </Fact>
              {s.storm_id ?? storm.data?.storm_id ? (
                <Fact label="Storm">
                  <span className="font-mono">{s.storm_id ?? storm.data?.storm_id}</span>
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
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: 'Pods', node: <Num metric="graphPods" value={stats.pods} /> },
                { label: 'Crown jewels', node: <Num metric="crownJewels" value={stats.crown_jewels.length} /> },
                { label: 'Observed flows', node: <Num metric="graphFlows" value={stats.observed_flows} /> },
                { label: 'Vulnerability findings', node: <Num metric="graphFindings" value={stats.vulnerability_findings} /> },
                ...(storm.data?.attack_steps
                  ? [{ label: 'ATTACK_STEP edges', node: <Num metric="attackSteps" value={storm.data.attack_steps.total} /> }]
                  : []),
              ].map((item) => (
                <div key={item.label} className="rounded-md border border-line bg-canvas px-3 py-2">
                  <dt className="text-2xs text-fg-subtle">{item.label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-fg">{item.node}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-2xs text-fg-muted">
              Crown jewels:{' '}
              {stats.crown_jewels.map((j) => (
                <Tag key={j} mono className="mr-1">
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

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="MCP tools" subtitle="The only actions the agent can take: typed, parameterised, never model-written Cypher">
            {s.tools && s.tools.length > 0 ? (
              <ul className="space-y-1.5">
                {s.tools.map((entry) => {
                  const tool = entryName(entry);
                  return (
                    <li key={tool.name} className="text-2xs">
                      <span className="font-mono text-[12px] text-fg">{tool.name}</span>
                      {tool.description ? <span className="text-fg-muted"> · {tool.description}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-2xs text-fg-subtle">Not reported by this API.</p>
            )}
          </Card>
          <Card title="Sandbox operations" subtitle="Typed changes a visitor can make to their own sandbox; never callable by the agent">
            {s.sandbox_operations && s.sandbox_operations.length > 0 ? (
              <ul className="space-y-1.5">
                {s.sandbox_operations.map((entry) => {
                  const op = entryName(entry);
                  return (
                    <li key={op.name} className="font-mono text-[12px] text-fg">
                      {op.name}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-2xs text-fg-subtle">Not reported by this API.</p>
            )}
          </Card>
        </div>
      </div>
      <Footer />
    </div>
  );
}
