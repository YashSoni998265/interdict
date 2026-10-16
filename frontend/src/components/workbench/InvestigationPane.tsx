import { Bot, Clock, Cpu, Play, PlugZap, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
import { Segmented } from '../ui/segmented';

import { Pane } from './Pane';

function AgentLine() {
  const client = useApi();
  const system = useSystem();
  if (client.mode === 'mock') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Cpu className="size-3.5" aria-hidden />
        Mock API: replays the recorded deterministic run for either mode
      </span>
    );
  }
  if (!system.data) return null;
  return system.data.agent_available ? (
    <span className="inline-flex items-center gap-1.5">
      <Bot className="size-3.5" aria-hidden />
      Agent: Claude ({system.data.agent_model ?? 'model not reported'})
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5">
      <PlugZap className="size-3.5" aria-hidden />
      Agent: deterministic only (no API key)
    </span>
  );
}

function EmptyTimeline({ onStart, disabled }: { onStart: () => void; disabled: boolean }) {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <h3 className="text-ui font-semibold text-fg">What the investigation does</h3>
        <p className="text-ui leading-5 text-fg-muted">
          The agent calls Interdict’s own MCP tools in order, within a budget of at most 12 calls. Every verdict comes
          from the engine; the agent only chooses the next tool and narrates.
        </p>
      </div>
      <ol className="space-y-1.5">
        {TYPICAL_RUN.map((tool, index) => (
          <li key={tool} className="flex items-baseline gap-2.5 text-ui">
            <span className="font-mono text-2xs text-fg-subtle">{index + 1}</span>
            <span className="text-fg">{toolTitle(tool, undefined)}</span>
            <span className="font-mono text-[11px] text-fg-subtle">{tool}</span>
          </li>
        ))}
      </ol>
      <Button variant="primary" onClick={onStart} disabled={disabled}>
        <Play aria-hidden />
        Investigate
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
  // Default to the agent when the API has one; the user's choice wins once made.
  const [chosen, setMode] = useState<InvestigationMode | null>(run?.requestedMode ?? null);
  const mode: InvestigationMode = chosen ?? (agentAvailable ? 'agent' : 'deterministic');
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
        <>
          <Segmented
            size="xs"
            label="Investigation mode"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'agent', label: 'Agent', ariaLabel: agentAvailable ? 'Agent (Claude)' : 'Agent (falls back to deterministic)' },
              { value: 'deterministic', label: 'Deterministic', ariaLabel: 'Deterministic, no AI narrator' },
            ]}
          />
          <Button size="sm" variant="primary" onClick={start} disabled={busy}>
            {run ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
            {busy ? 'Running…' : run ? 'Re-run' : 'Investigate'}
          </Button>
        </>
      }
    >
      <div className="shrink-0 space-y-2 border-b border-line px-3 py-2.5">
        <LifecycleRail derived={derived} active={busy} terminal={derived?.done ? display(derived.done.status) : null} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
          <span>
            <span className="text-fg-subtle">Ran: </span>
            <span className={cn(ran ? 'text-fg' : 'text-fg-subtle')}>{ran ? ranModeText(ran) : run ? `requested ${run.requestedMode}` : 'not run yet'}</span>
          </span>
          {run?.investigationId ? <span className="font-mono text-fg-subtle">{run.investigationId}</span> : null}
        </div>
        {notes.length > 0 ? (
          <ul className="space-y-0.5">
            {notes.map((note) => (
              <li key={note} className="flex gap-1.5 text-2xs text-yellow-300">
                <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
                {note}
              </li>
            ))}
          </ul>
        ) : null}
        {outdated ? (
          <Banner
            tone="grey"
            icon={Clock}
            className="py-2"
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

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">

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

        <ol className="space-y-2" aria-label="Investigation timeline">
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
