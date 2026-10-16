import { ArrowRight, Brain, CircleCheck, CircleX, Cpu, FileCheck2, Sparkles, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  DoneEvent,
  ErrorEvent,
  InvestigationReport,
  LifecycleEvent,
  NarrationEvent,
  QueryRecord,
} from '@/api/types';
import { cn } from '@/lib/cn';
import { formatOffset } from '@/lib/format';
import { ranModeText, toNotes, toolTitle, type ToolStep } from '@/lib/investigation';
import { lifecycleLabel } from '@/lib/status';

import { Num } from '../Num';
import { QueryList } from '../QueryList';
import { StatusBadge } from '../StatusBadge';
import { Button } from '../ui/button';
import { Disclosure } from '../ui/disclosure';
import { JsonView, ProgressRail } from '../ui/misc';
import { Tag } from '../ui/tag';
import { Tip } from '../ui/tooltip';

function queriesOf(data: unknown): QueryRecord[] {
  if (data && typeof data === 'object' && Array.isArray((data as { queries?: unknown }).queries)) {
    return (data as { queries: QueryRecord[] }).queries;
  }
  return [];
}

function InputList({ input }: { input: Record<string, unknown> | undefined }) {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px]">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 gap-1">
          <dt className="text-fg-subtle">{key}:</dt>
          <dd className="min-w-0 break-all text-fg-muted">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One tool step: plain title, why this tool, result, latency, and the graph proof. */
export function StepCard({ step, index, firstAt }: { step: ToolStep; index: number; firstAt: string | null }) {
  const call = step.call;
  const result = step.result;
  const at = result?.at ?? call?.at;
  const queries = queriesOf(result?.data);
  const cited = result && result.evidence_ids.length > 0 ? queries.filter((q) => result.evidence_ids.includes(q.id)) : queries;

  return (
    <article
      className={cn(
        'rounded-lg border bg-surface',
        step.state === 'failed' ? 'border-red-500/35' : 'border-line',
        step.state === 'running' && 'border-accent/40',
      )}
      aria-label={toolTitle(step.tool, call?.input)}
    >
      <div className="flex items-start gap-2.5 px-3 pt-2.5">
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-elevated font-mono text-[10px] text-fg-muted">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-ui font-semibold text-fg">{toolTitle(step.tool, call?.input)}</h3>
            <Tip content="A typed tool on Interdict's own MCP server: parameterised graph queries only, never model-written Cypher.">
              <button type="button" className="cursor-help font-mono text-[11px] text-fg-subtle">
                {step.tool}
              </button>
            </Tip>
          </div>
          <InputList input={call?.input} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-2xs">
          {step.state === 'running' ? (
            <span className="text-accent">Running…</span>
          ) : step.state === 'ok' ? (
            <span className="inline-flex items-center gap-1 text-fg-muted">
              <CircleCheck className="size-3.5" aria-hidden />
              {result ? <Num metric="toolLatency" value={result.latency_ms} format="ms" /> : null}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-red-400">
              <CircleX className="size-3.5" aria-hidden />
              Failed
            </span>
          )}
          {at && firstAt ? <span className="font-mono text-[10px] text-fg-subtle">{formatOffset(at, firstAt)}</span> : null}
        </div>
      </div>

      <div className="space-y-2 px-3 pb-2.5 pl-[2.6rem] pt-1.5">
        {call?.why ? (
          <p className="text-2xs leading-4 text-fg-muted">
            <span className="font-medium text-fg-subtle">Why this tool: </span>
            {call.why}
          </p>
        ) : null}
        {step.state === 'running' ? <ProgressRail className="w-32" /> : null}
        {result ? (
          <p className={cn('text-ui leading-5', result.ok ? 'text-fg' : 'text-red-300')}>
            <span className="sr-only">Result: </span>
            {result.summary}
          </p>
        ) : null}
        {result ? (
          <Disclosure summary="Show graph proof">
            <div className="space-y-2.5">
              {result.evidence_ids.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  <span className="text-2xs text-fg-subtle">Evidence ids</span>
                  {result.evidence_ids.map((id) => (
                    <Tag key={id} mono>
                      {id}
                    </Tag>
                  ))}
                </div>
              ) : null}
              {cited.length > 0 ? <QueryList queries={cited} /> : null}
              <div>
                <div className="mb-1 text-2xs text-fg-subtle">Raw tool result (the engine’s JSON view)</div>
                <JsonView value={result.data} />
              </div>
            </div>
          </Disclosure>
        ) : null}
      </div>
    </article>
  );
}

export function LifecycleDivider({ event, firstAt }: { event: LifecycleEvent; firstAt: string | null }) {
  return (
    <div className="flex items-center gap-2 px-1 text-2xs text-fg-subtle">
      <ArrowRight className="size-3" aria-hidden />
      <span className="font-medium text-fg-muted">{lifecycleLabel(event.state)}</span>
      <span className="font-mono">{event.state}</span>
      <span className="h-px flex-1 bg-line" aria-hidden />
      {firstAt ? <span className="font-mono text-[10px]">{formatOffset(event.at, firstAt)}</span> : null}
    </div>
  );
}

export function NarrationItem({ event }: { event: NarrationEvent }) {
  if (event.source === 'agent-thinking') {
    return (
      <div className="flex gap-2 px-1 text-2xs italic leading-4 text-fg-subtle">
        <Brain className="mt-px size-3.5 shrink-0" aria-hidden />
        <p>
          <span className="not-italic">Reasoning (summarised): </span>
          {event.text}
        </p>
      </div>
    );
  }
  const agent = event.source === 'agent';
  const Icon = agent ? Sparkles : Cpu;
  return (
    <div className="flex gap-2 rounded-lg border border-line bg-canvas px-3 py-2">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', agent ? 'text-fg' : 'text-fg-muted')} aria-hidden />
      <div className="min-w-0">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-subtle">
          {agent ? 'Claude' : 'Engine'}
        </div>
        <p className="whitespace-pre-line text-ui leading-5 text-fg">{event.text}</p>
      </div>
    </div>
  );
}

export interface DisplayStatus {
  status: string;
  hasCertificate: boolean;
}

export function ReportCard({ report, display }: { report: InvestigationReport; display: DisplayStatus }) {
  const notes = toNotes(report.notes);
  const usage = report.llm?.usage;
  const tokens = usage ? Object.entries(usage).filter(([, v]) => typeof v === 'number') : [];
  return (
    <article className="space-y-2.5 rounded-lg border border-line-strong bg-elevated px-3.5 py-3" aria-label="Final report">
      <div className="flex flex-wrap items-center gap-2">
        <FileCheck2 className="size-4 text-fg-muted" aria-hidden />
        <span className="text-ui font-semibold text-fg">Final report</span>
        <StatusBadge status={display.status} hasCertificate={display.hasCertificate} />
      </div>
      <p className="text-2xs text-fg-muted">{ranModeText(report.mode)}</p>
      {notes.length > 0 ? (
        <ul className="space-y-1">
          {notes.map((note) => (
            <li key={note} className="flex gap-1.5 text-2xs text-yellow-300">
              <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      {report.llm ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-muted">
          {report.llm.tool_calls !== undefined ? (
            <div className="flex gap-1">
              <dt>Tool calls</dt>
              <dd className="text-fg">
                <Num metric="llmToolCalls" value={report.llm.tool_calls} />
              </dd>
            </div>
          ) : null}
          {tokens.map(([name, value]) => (
            <div key={name} className="flex gap-1">
              <dt>{name.replace(/_/g, ' ')}</dt>
              <dd className="text-fg">
                <Num metric="llmTokens" value={value} />
              </dd>
            </div>
          ))}
          {report.llm.estimated_cost_usd !== undefined ? (
            <div className="flex gap-1">
              <dt>Estimated cost</dt>
              <dd className="text-fg">
                <Num metric="llmCost" value={report.llm.estimated_cost_usd} format="usd" />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {report.certificate_id ? (
          <Button asChild size="sm" variant="primary">
            <Link to={`/certificates/${report.certificate_id}`}>
              Open certificate
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null}
        {report.plan_id ? <span className="font-mono text-2xs text-fg-subtle">plan {report.plan_id}</span> : null}
      </div>
    </article>
  );
}

export function ErrorItem({ event }: { event: ErrorEvent }) {
  return (
    <div role="alert" className="flex gap-2 rounded-lg border border-red-500/35 bg-red-500/[0.06] px-3 py-2">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-red-400" aria-hidden />
      <div className="min-w-0 text-ui">
        <div className="font-medium text-fg">The run reported an error</div>
        <div className="text-fg-muted">{event.message}</div>
        <code className="mt-1 inline-block rounded border border-line bg-canvas px-1.5 text-2xs text-fg-muted">{event.code}</code>
      </div>
    </div>
  );
}

export function DoneItem({ event, firstAt, display }: { event: DoneEvent; firstAt: string | null; display: DisplayStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 text-2xs text-fg-muted">
      <span className="font-medium text-fg">Finished</span>
      <StatusBadge status={display.status} hasCertificate={display.hasCertificate} size="sm" />
      {firstAt ? <span className="ml-auto font-mono text-[10px] text-fg-subtle">{formatOffset(event.at, firstAt)}</span> : null}
    </div>
  );
}
