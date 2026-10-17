import { Bot, Clock, Cpu, Play, PlugZap, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useSystem } from '@/api/queries';
import type { ClusterView, InvestigationMode } from '@/api/types';
import { useHuntOutcome } from '@/app/hooks';
import { useApi, useRun, useSandboxState, useServices } from '@/app/services';
import { cn } from '@/lib/cn';
import { ranModeText, toolTitle, TYPICAL_RUN, type DerivedInvestigation } from '@/lib/investigation';

import { Banner, ErrorState, LoadingState } from '../states';
import { DoneItem, ErrorItem, LifecycleDivider, NarrationItem, ReportCard, StepCard } from '../timeline/TimelineItems';
import { LifecycleRail } from '../timeline/LifecycleRail';
import { Button } from '../ui/button';

import { Pane } from './Pane';
import './InvestigationPane.css';

function AgentLine() {
  const client = useApi();
  const system = useSystem();
  if (client.mode === 'mock') {
    return (
      <span className="agent-line">
        <Cpu className="agent-line__icon" aria-hidden />
        Replay of the recorded deterministic run
      </span>
    );
  }
  if (!system.data) return null;
  return system.data.agent_available ? (
    <span className="agent-line">
      <Bot className="agent-line__icon" aria-hidden />
      Agent: Claude ({system.data.agent_model ?? 'model not reported'})
    </span>
  ) : (
    <span className="agent-line">
      <PlugZap className="agent-line__icon" aria-hidden />
      Deterministic mode: graph tools over MCP, no LLM
    </span>
  );
}

function EmptyTimeline({ onStart, disabled }: { onStart: () => void; disabled: boolean }) {
  return (
    <div className="empty-timeline">
      <div className="empty-timeline__block">
        <h3 className="empty-timeline__title">What the investigation does</h3>
        <p className="empty-timeline__text">
          The agent calls Interdict’s own MCP tools in order, within a budget of at most 12 calls. Every verdict comes
          from the engine; the agent only chooses the next tool and narrates.
        </p>
      </div>
      <ol className="empty-timeline__list">
        {TYPICAL_RUN.map((tool, index) => (
          <li key={tool} className="empty-timeline-2">
            <span className="empty-timeline__label">{index + 1}</span>
            <span className="empty-timeline__label-2">{toolTitle(tool, undefined)}</span>
            <span className="empty-timeline__label-3">{tool}</span>
          </li>
        ))}
      </ol>
      <Button variant="primary" onClick={onStart} disabled={disabled}>
        <Play aria-hidden />
        Run the agent
      </Button>
    </div>
  );
}

export function InvestigationPane({
  cluster,
  derived,
}: {
  cluster: ClusterView;
  derived: DerivedInvestigation | null;
}) {
  const { workbench } = useServices();
  const system = useSystem();
  const run = useRun(cluster.id);
  const revision = useSandboxState((s) => s.revision);
  const agentAvailable = system.data?.agent_available ?? false;
  // The agent when the API has one, otherwise the deterministic pipeline (the same MCP tools).
  const mode: InvestigationMode = agentAvailable ? 'agent' : 'deterministic';
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const items = derived?.items ?? [];
  const busy = run?.phase === 'starting' || run?.phase === 'streaming';
  const start = () => void workbench.start(cluster.id, mode);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [items.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  };

  const outcome = useHuntOutcome(derived?.hunt);
  const display = (status: string) =>
    status === 'SIMULATED_CONTAINMENT'
      ? outcome.certificateCurrent
        ? { status, hasCertificate: true }
        : { status: outcome.certificateStatus ?? 'SUPERSEDED', hasCertificate: false }
      : { status, hasCertificate: false };
  const ran = derived?.ranMode ?? run?.startMode ?? null;
  const notes = [...(run?.startNotes ?? []), ...(derived?.notes ?? [])].filter((n, i, all) => all.indexOf(n) === i);
  const outdated = run?.revisionAtStart !== null && run?.revisionAtStart !== undefined && revision !== null && run.revisionAtStart < revision;
  const lastStep = [...items].reverse().find((i) => i.kind === 'step');

  return (
    <Pane
      id="pane-investigation"
      title="Investigation"
      subtitle={<AgentLine />}
      actions={
        <Button size="sm" variant="primary" onClick={start} disabled={busy}>
          {run ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
          {busy ? 'Running…' : run ? 'Re-run' : 'Run the agent'}
        </Button>
      }
    >
      <div className="investigation-pane__block">
        <LifecycleRail derived={derived} active={busy} terminal={derived?.done ? display(derived.done.status) : null} />
        <div className="investigation-pane__row">
          <span>
            <span className="investigation-pane__label">Ran: </span>
            <span className={cn(ran ? 'investigation-pane__label--ran' : 'investigation-pane__label--not-ran')}>{ran ? ranModeText(ran) : run ? `requested ${run.requestedMode}` : 'not run yet'}</span>
          </span>
        </div>
        {notes.length > 0 ? (
          <ul className="investigation-pane__list">
            {notes.map((note) => (
              <li key={note} className="investigation-pane">
                <TriangleAlert className="investigation-pane__icon" aria-hidden />
                {note}
              </li>
            ))}
          </ul>
        ) : null}
        {outdated ? (
          <Banner
            tone="grey"
            icon={Clock}
            className="investigation-pane__banner"
            title={`Computed at revision ${run.revisionAtStart}; the sandbox is now at revision ${revision}`}
            actions={
              <Button size="xs" variant="secondary" onClick={start} disabled={busy}>
                <RotateCcw aria-hidden />
                Re-run
              </Button>
            }
          />
        ) : null}
      </div>

      <div ref={scroller} onScroll={onScroll} className="investigation-pane__block-2">

        {!run ? <EmptyTimeline onStart={start} disabled={busy} /> : null}
        {run?.phase === 'starting' ? (
          <LoadingState title="Starting the investigation" detail={`POST /api/investigations · ${cluster.id} · ${run.requestedMode}`} />
        ) : null}
        {run?.phase === 'streaming' && items.length === 0 ? (
          <LoadingState title="Connected: waiting for the first event" detail={`SSE /api/investigations/${run.investigationId ?? ''}/events`} />
        ) : null}
        {run?.phase === 'failed' && run.error ? (
          run.error.code === 'BUSY' ? (
            <Banner tone="neutral" title="Another investigation is already running in this session" role="alert" actions={<Button size="sm" onClick={start}>Try again</Button>}>
              {run.error.message} One run at a time keeps the sandbox revision stable while the Hunter verifies.
            </Banner>
          ) : (
            <ErrorState error={run.error} title="The investigation could not start" onRetry={start} />
          )
        ) : null}

        <ol className="investigation-pane__list-2" aria-label="Investigation timeline">
          {items.map((item) => {
            const key = `${item.kind}-${item.seq}`;
            switch (item.kind) {
              case 'lifecycle':
                return (
                  <li key={key}>
                    <LifecycleDivider event={item.event} firstAt={derived?.firstAt ?? null} />
                  </li>
                );
              case 'step':
                return (
                  <li key={key}>
                    <StepCard
                      step={item.step}
                      index={(derived?.steps.indexOf(item.step) ?? 0) + 1}
                      firstAt={derived?.firstAt ?? null}
                    />
                  </li>
                );
              case 'narration':
                return (
                  <li key={key}>
                    <NarrationItem event={item.event} />
                  </li>
                );
              case 'report':
                return (
                  <li key={key}>
                    <ReportCard report={item.event.report} display={display(item.event.report.status)} />
                  </li>
                );
              case 'error':
                return (
                  <li key={key}>
                    <ErrorItem event={item.event} />
                  </li>
                );
              case 'done':
                return (
                  <li key={key}>
                    <DoneItem event={item.event} firstAt={derived?.firstAt ?? null} display={display(item.event.status)} />
                  </li>
                );
            }
          })}
        </ol>

        {run?.phase === 'interrupted' ? (
          <Banner
            tone="yellow"
            title="The event stream was interrupted"
            role="alert"
            actions={
              <Button size="sm" variant="secondary" onClick={() => void workbench.resume(cluster.id)}>
                <RotateCcw aria-hidden />
                Resume
              </Button>
            }
          >
            {run.error?.message ?? 'The connection closed before the run finished.'} Resuming fetches the events so far
            and continues after the last one; nothing is repeated.
          </Banner>
        ) : null}
      </div>

      <div className="sr-only" aria-live="polite">
        {lastStep?.kind === 'step' && lastStep.step.result
          ? `${toolTitle(lastStep.step.tool, lastStep.step.call?.input)}: ${lastStep.step.result.summary}`
          : derived?.currentState
            ? `Now ${derived.currentState.toLowerCase()}`
            : ''}
      </div>
    </Pane>
  );
}
