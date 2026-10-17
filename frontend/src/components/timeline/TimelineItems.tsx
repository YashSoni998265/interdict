import { ArrowRight, CircleCheck, CircleX, Cpu, FileCheck2, Signpost, TriangleAlert } from 'lucide-react';
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
import './TimelineItems.css';

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
    <dl className="input-list">
      {entries.map(([key, value]) => (
        <div key={key} className="input-list-2">
          <dt className="input-list__term">{key}:</dt>
          <dd className="input-list__value">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
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
        'step-card',
        step.state === 'failed' ? 'step-card--failed' : 'step-card--not-failed',
        step.state === 'running' && 'step-card--running',
      )}
      aria-label={toolTitle(step.tool, call?.input)}
    >
      <div className="step-card__row">
        <span className="step-card__dot">
          {index}
        </span>
        <div className="step-card__block">
          <div className="step-card__row-2">
            <h3 className="step-card__title">{toolTitle(step.tool, call?.input)}</h3>
            <Tip content="A typed tool on Interdict's own MCP server: parameterised graph queries only, never model-written Cypher.">
              <button type="button" className="step-card__button">
                {step.tool}
              </button>
            </Tip>
          </div>
        </div>
        <div className="step-card__stack">
          {step.state === 'running' ? (
            <span className="step-card__label">Running…</span>
          ) : step.state === 'ok' ? (
            <span className="step-card__label-2">
              <CircleCheck className="step-card__icon" aria-hidden />
              {result ? <Num metric="toolLatency" value={result.latency_ms} format="ms" /> : null}
            </span>
          ) : (
            <span className="step-card__label-3">
              <CircleX className="step-card__icon" aria-hidden />
              Failed
            </span>
          )}
          {at && firstAt ? <span className="step-card__label-4">{formatOffset(at, firstAt)}</span> : null}
        </div>
      </div>

      <div className="step-card__block-2">
        {call?.why ? (
          <p className="step-card__text">
            <span className="step-card__label-5">Why this tool: </span>
            {call.why}
          </p>
        ) : null}
        {step.state === 'running' ? <ProgressRail className="step-card__progress-rail" /> : null}
        {result ? (
          <p className={cn('step-card__text-2', result.ok ? 'step-card__text--ok' : 'step-card__text--not-ok')}>
            <span className="sr-only">Result: </span>
            {result.summary}
          </p>
        ) : null}
        {result ? (
          <Disclosure summary="Show inputs and graph proof">
            <div className="step-card__block-3">
              <div>
                <div className="step-card__block-4">Tool inputs</div>
                <InputList input={call?.input} />
              </div>
              {result.evidence_ids.length > 0 ? (
                <div className="step-card__row-3">
                  <span className="step-card__label-6">Evidence ids</span>
                  {result.evidence_ids.map((id) => (
                    <Tag key={id} mono>
                      {id}
                    </Tag>
                  ))}
                </div>
              ) : null}
              {cited.length > 0 ? <QueryList queries={cited} /> : null}
              <div>
                <div className="step-card__block-4">Raw tool result (the engine’s JSON view)</div>
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
    <div className="lifecycle-divider">
      <ArrowRight className="lifecycle-divider__icon" aria-hidden />
      <span className="lifecycle-divider__label">{lifecycleLabel(event.state)}</span>
      <span className="lifecycle-divider__label-2">{event.state}</span>
      <span className="lifecycle-divider__label-3" aria-hidden />
      {firstAt ? <span className="lifecycle-divider__label-4">{formatOffset(event.at, firstAt)}</span> : null}
    </div>
  );
}

export function NarrationItem({ event }: { event: NarrationEvent }) {
  const agent = event.source === 'agent';
  const Icon = agent ? Signpost : Cpu;
  return (
    <div className="narration-item-2">
      <Icon className={cn('narration-item__icon-2', agent ? 'narration-item__icon--agent' : 'narration-item__icon--not-agent')} aria-hidden />
      <div className="narration-item__block">
        <div className="narration-item__block-2">
          {agent ? 'Agent decision' : 'Engine'}
        </div>
        <p className="narration-item__text">{event.text}</p>
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
  return (
    <article className="report-card" aria-label="Final report">
      <div className="report-card__row">
        <FileCheck2 className="report-card__icon" aria-hidden />
        <span className="report-card__label">Final report</span>
        <StatusBadge status={display.status} hasCertificate={display.hasCertificate} />
      </div>
      <p className="report-card__text">{ranModeText(report.mode)}</p>
      {notes.length > 0 ? (
        <ul className="report-card__list">
          {notes.map((note) => (
            <li key={note} className="report-card-2">
              <TriangleAlert className="report-card__icon-2" aria-hidden />
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="report-card__row">
        {report.certificate_id ? (
          <Button asChild size="sm" variant="primary">
            <Link to={`/certificates/${report.certificate_id}`}>
              Open certificate
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null}
        {report.plan_id ? <span className="report-card__label-2">plan {report.plan_id}</span> : null}
      </div>
    </article>
  );
}

export function ErrorItem({ event }: { event: ErrorEvent }) {
  return (
    <div role="alert" className="error-item">
      <TriangleAlert className="error-item__icon" aria-hidden />
      <div className="error-item__block">
        <div className="error-item__block-2">The run reported an error</div>
        <div className="error-item__block-3">{event.message}</div>
        <code className="error-item__code">{event.code}</code>
      </div>
    </div>
  );
}

export function DoneItem({ event, firstAt, display }: { event: DoneEvent; firstAt: string | null; display: DisplayStatus }) {
  return (
    <div className="done-item">
      <span className="done-item__label">Finished</span>
      <StatusBadge status={display.status} hasCertificate={display.hasCertificate} size="sm" />
      {firstAt ? <span className="done-item__label-2">{formatOffset(event.at, firstAt)}</span> : null}
    </div>
  );
}
