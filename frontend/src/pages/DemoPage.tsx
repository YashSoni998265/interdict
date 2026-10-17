import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Download,
  FileCheck2,
  Hourglass,
  Loader2,
  Play,
  RotateCcw,
  Route,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useStorm, useSubgraph } from '@/api/queries';
import type { ClusterView, HuntReportView, StormView } from '@/api/types';
import { useBreakIt } from '@/app/breakIt';
import { useClusterAnalysis, useHuntOutcome } from '@/app/hooks';
import { useApi, useRun, useSandboxState, useServices } from '@/app/services';
import { AttackGraph } from '@/components/graph/AttackGraph';
import { EDGE_STYLE } from '@/components/graph/graphTheme';
import { CountUp } from '@/components/motion/CountUp';
import { staticMotion } from '@/components/motion/staticMotion';
import { OutcomeBadge } from '@/components/OutcomeBadge';
import { ImpactSentence } from '@/components/plan/PlanReport';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { formatUtc, nodeLabel, plural } from '@/lib/format';
import { defaultOverlay, deriveOverlays } from '@/lib/graphState';
import type { DerivedInvestigation } from '@/lib/investigation';
import { ranModeText, toolTitle, TYPICAL_RUN } from '@/lib/investigation';
import { huntPlanHandle, mergeFlows } from '@/lib/plan';
import { policyYaml } from '@/lib/policyYaml';
import { describeSandboxResult, VARIANT } from '@/lib/status';
import { restraintExample } from '@/lib/storm';

import './DemoPage.css';

const STEPS = ['The alerts', 'The agent', 'The hunt', 'The action', 'Break it'] as const;
const LAST = STEPS.length;

/** The cluster the demo follows: the one holding the restraint example's on-path workload. */
function demoCluster(storm: StormView): ClusterView | undefined {
  const restraint = restraintExample(storm.alerts);
  return (
    storm.clusters.find((c) => restraint?.onPath.some((pod) => c.workloads.includes(pod))) ??
    storm.clusters.find((c) => !c.beyond_bound) ??
    storm.clusters[0]
  );
}

function Progress({ step, onGo }: { step: number; onGo: (step: number) => void }) {
  return (
    <nav aria-label="Demo steps" className="demo-progress">
      <ol className="demo-progress__list">
        {STEPS.map((label, index) => {
          const n = index + 1;
          return (
            <li key={label} className="demo-progress__entry">
              <button
                type="button"
                onClick={() => onGo(n)}
                aria-current={n === step ? 'step' : undefined}
                className={cn(
                  'demo-progress__item',
                  n === step && 'demo-progress__item--current',
                  n < step && 'demo-progress__item--done',
                )}
              >
                <span className="demo-progress__dot">{n < step ? <Check aria-hidden /> : n}</span>
                <span className="demo-progress__label">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepShell({
  step,
  title,
  lede,
  actions,
  visual,
}: {
  step: number;
  title: ReactNode;
  lede: ReactNode;
  actions?: ReactNode;
  visual: ReactNode;
}) {
  return (
    <section className="demo-step" aria-labelledby="demo-title">
      <div className="demo-step__copy">
        <p className="demo-step__eyebrow">
          Step {step} of {LAST}
        </p>
        <h1 id="demo-title" className="demo-step__title">
          {title}
        </h1>
        <div className="demo-step__lede">{lede}</div>
        {actions ? <div className="demo-step__actions">{actions}</div> : null}
      </div>
      <div className="demo-step__visual">{visual}</div>
    </section>
  );
}

function NeedsRun({ cluster, onBack }: { cluster: ClusterView; onBack: () => void }) {
  const { workbench } = useServices();
  const run = useRun(cluster.id);
  const running = run?.phase === 'starting' || run?.phase === 'streaming';
  return (
    <div className="demo-card demo-card--centered">
      <Hourglass className="demo-card__icon" aria-hidden />
      <p className="demo-card__title">This step needs the agent’s results</p>
      <p className="demo-card__text">Run the agent on {cluster.target} first. It takes about three seconds.</p>
      <div className="demo-card__actions">
        <Button variant="primary" onClick={() => void workbench.start(cluster.id, 'deterministic')} disabled={running}>
          {running ? <Loader2 className="demo-spin" aria-hidden /> : <Play aria-hidden />}
          {running ? 'Investigating…' : 'Run the agent'}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Go to step 2
        </Button>
      </div>
    </div>
  );
}

/* Step 1: the storm */

function StepAlerts({ storm }: { storm: StormView }) {
  const restraint = restraintExample(storm.alerts);
  const onPath = storm.counts.ON_ATTACK_PATH;
  return (
    <StepShell
      step={1}
      title={
        <>
          {storm.total_alerts.toLocaleString('en-US')} alerts.
          <br />
          Only {onPath} matter.
        </>
      }
      lede={
        <>
          <p>
            Interdict checks every alert against the graph: can an attacker get from the Internet, through this workload,
            all the way to a crown-jewel database? Only alerts on such a path are worth fixing.
          </p>
          <p>
            Another {storm.counts.NOT_ON_ATTACK_PATH} alerts are real vulnerabilities, but no attack path runs through them,
            so they need no fix.
          </p>
        </>
      }
      visual={
        <div className="demo-alerts">
          <div className="demo-funnel">
            <div className="demo-funnel__tile">
              <CountUp value={storm.total_alerts} className="demo-funnel__value" />
              <span className="demo-funnel__label">alerts in the storm</span>
            </div>
            <ArrowRight className="demo-funnel__arrow" aria-hidden />
            <div className="demo-funnel__tile demo-funnel__tile--red">
              <CountUp value={onPath} from={storm.total_alerts} className="demo-funnel__value" />
              <span className="demo-funnel__label">on a real attack path</span>
            </div>
            <ArrowRight className="demo-funnel__arrow" aria-hidden />
            <div className="demo-funnel__tile">
              <CountUp value={storm.clusters.length} className="demo-funnel__value" />
              <span className="demo-funnel__label">places to fix</span>
            </div>
          </div>
          {restraint ? (
            <div className="demo-card">
              <p className="demo-card__kicker">Same vulnerability, different verdicts</p>
              <p className="demo-card__text">
                <span className="demo-mono">{restraint.cve}</span> is reported on several workloads. The graph, not the
                CVE score, decides which one matters.
              </p>
              <div className="demo-verdicts">
                {restraint.onPath.map((pod) => (
                  <div key={pod} className="demo-verdict demo-verdict--red">
                    <Route aria-hidden />
                    <span className="demo-mono">{pod}</span>
                    <span>On a real attack path</span>
                  </div>
                ))}
                {restraint.notOnPath.map((pod) => (
                  <div key={pod} className="demo-verdict">
                    <ShieldCheck aria-hidden />
                    <span className="demo-mono">{pod}</span>
                    <span>On no path: no fix needed</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      }
    />
  );
}

/* Step 2: the agent */

function AgentTimeline({ derived }: { derived: DerivedInvestigation | null }) {
  const steps = derived?.steps ?? [];
  const rows =
    steps.length > 0
      ? steps.map((s) => ({
          key: s.callId,
          tool: s.tool,
          title: toolTitle(s.tool, s.call?.input),
          why: s.call?.why ?? null,
          summary: s.result?.summary ?? null,
          ms: s.result?.latency_ms ?? null,
          state: s.state,
        }))
      : TYPICAL_RUN.map((tool) => ({
          key: tool,
          tool,
          title: toolTitle(tool, undefined),
          why: null,
          summary: null,
          ms: null,
          state: 'idle' as const,
        }));
  return (
    <ol className="demo-timeline" aria-live="polite" aria-label="The agent’s tool calls">
      {rows.map((row, index) => (
        <li key={row.key} className={cn('demo-timeline__item', `demo-timeline__item--${row.state}`)}>
          <span className="demo-timeline__marker">
            {row.state === 'ok' ? (
              <Check aria-hidden />
            ) : row.state === 'running' ? (
              <Loader2 className="demo-spin" aria-hidden />
            ) : row.state === 'failed' ? (
              <CircleAlert aria-hidden />
            ) : (
              index + 1
            )}
          </span>
          <div className="demo-timeline__body">
            <div className="demo-timeline__head">
              <span className="demo-timeline__title">{row.title}</span>
              <span className="demo-timeline__tool">
                {row.tool}
                {row.ms != null ? ` · ${Math.max(1, Math.round(row.ms))} ms` : ''}
              </span>
            </div>
            {row.why ? <p className="demo-timeline__why">{row.why}</p> : null}
            {row.summary ? <p className="demo-timeline__summary">{row.summary}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function GraphStage({
  cluster,
  hunt,
  overlayId,
  height = 'md',
}: {
  cluster: ClusterView;
  hunt: HuntReportView | undefined;
  overlayId?: string | null;
  height?: 'sm' | 'md';
}) {
  const analysis = useClusterAnalysis(cluster.id);
  const handle = hunt ? huntPlanHandle(hunt, analysis.plan) : null;
  const subgraph = useSubgraph(cluster.id, handle);
  const overlays = useMemo(
    () => (subgraph.data ? deriveOverlays({ subgraph: subgraph.data, initialPlan: analysis.plan?.plan, hunt }) : []),
    [subgraph.data, analysis.plan, hunt],
  );
  const overlay = overlays.find((o) => o.id === overlayId) ?? (overlays.length > 0 ? defaultOverlay(overlays) : null);
  return (
    <div className={cn('demo-graph', `demo-graph--${height}`)}>
      {subgraph.isPending ? (
        <LoadingState title="Loading the attack graph" detail={`GET /api/clusters/${cluster.id}/subgraph`} />
      ) : subgraph.error ? (
        <ErrorState error={subgraph.error} title="The attack graph could not be loaded" onRetry={() => void subgraph.refetch()} />
      ) : overlay ? (
        <AttackGraph
          subgraph={subgraph.data}
          overlay={overlay}
          tScope={[cluster.target]}
          selectedNodeId={null}
          highlightedEdgeId={null}
          onSelectNode={() => undefined}
          onOpenEdge={() => undefined}
        />
      ) : null}
    </div>
  );
}

function StepAgent({ cluster }: { cluster: ClusterView }) {
  const { workbench } = useServices();
  const run = useRun(cluster.id);
  const analysis = useClusterAnalysis(cluster.id);
  const derived = analysis.derived;
  const running = run?.phase === 'starting' || run?.phase === 'streaming';
  const finished = run?.phase === 'done';
  const elapsed =
    derived?.firstAt && derived.done ? (Date.parse(derived.done.at) - Date.parse(derived.firstAt)) / 1000 : null;
  return (
    <StepShell
      step={2}
      title="The agent investigates."
      lede={
        <>
          <p>
            It takes the attack path into <strong>{cluster.target}</strong> via <strong>{cluster.entry_ingress}</strong>{' '}
            and calls Interdict’s graph tools over MCP, one after another. Every verdict comes from FalkorDB; the agent
            decides what to call next and why.
          </p>
          <p className="demo-note">
            {derived?.ranMode
              ? ranModeText(derived.ranMode)
              : 'Deterministic mode: no LLM and no API key; the same tools, in a fixed order.'}
          </p>
        </>
      }
      actions={
        <Button
          variant="primary"
          size="lg"
          onClick={() => void workbench.start(cluster.id, 'deterministic')}
          disabled={running}
        >
          {running ? (
            <Loader2 className="demo-spin" aria-hidden />
          ) : finished ? (
            <RotateCcw aria-hidden />
          ) : (
            <Play aria-hidden />
          )}
          {running ? 'Investigating…' : finished ? 'Run it again' : 'Run the agent'}
        </Button>
      }
      visual={
        <div className="demo-agent">
          <GraphStage cluster={cluster} hunt={undefined} overlayId="baseline" height="sm" />
          <AgentTimeline derived={derived} />
          {finished && analysis.hunt ? (
            <div className="demo-agent__outcome">
              <OutcomeBadge hunt={analysis.hunt} />
              {elapsed !== null ? <span className="demo-agent__time">Finished in {elapsed.toFixed(1)} s</span> : null}
            </div>
          ) : null}
          {run?.phase === 'failed' && run.error ? (
            <ErrorState
              error={run.error}
              title="The investigation could not start"
              onRetry={() => void workbench.start(cluster.id, 'deterministic')}
            />
          ) : null}
        </div>
      }
    />
  );
}

/* Step 3: the hunt */

function StepHunt({ cluster, onBack }: { cluster: ClusterView; onBack: () => void }) {
  const analysis = useClusterAnalysis(cluster.id);
  const hunt = analysis.hunt;
  const handle = hunt ? huntPlanHandle(hunt, analysis.plan) : null;
  const subgraph = useSubgraph(cluster.id, handle);
  const overlays = useMemo(
    () => (subgraph.data ? deriveOverlays({ subgraph: subgraph.data, initialPlan: analysis.plan?.plan, hunt }) : []),
    [subgraph.data, analysis.plan, hunt],
  );
  const rounds = overlays.filter((o) => o.kind === 'round');
  const [manual, setManual] = useState<string | null>(null);
  const [played, setPlayed] = useState(false);

  // Play the story once: the first round's surviving paths, then the verified last round.
  useEffect(() => {
    if (manual !== null || played || rounds.length < 2) return;
    const timer = window.setTimeout(() => setPlayed(true), staticMotion() ? 0 : 2800);
    return () => window.clearTimeout(timer);
  }, [manual, played, rounds.length]);

  if (!hunt) {
    return (
      <StepShell
        step={3}
        title="The Path Hunter checks the fix."
        lede={<p>Once the agent has a plan, the Path Hunter tries to break it on a copy of the graph.</p>}
        visual={<NeedsRun cluster={cluster} onBack={onBack} />}
      />
    );
  }

  const first = hunt.rounds[0];
  const survivors = (first?.residuals ?? [])
    .map((id) => hunt.chains.find((c) => c.id === id)?.path)
    .filter((path): path is string[] => Array.isArray(path));
  const autoOverlay = rounds.length >= 2 ? (played ? rounds[rounds.length - 1] : rounds[0]) : undefined;
  const shown = overlays.find((o) => o.id === manual) ?? autoOverlay ?? (overlays.length > 0 ? defaultOverlay(overlays) : null);
  const widened = survivors.length > 0;
  const contained = hunt.status === 'SIMULATED_CONTAINMENT';

  return (
    <StepShell
      step={3}
      title={widened ? 'The first fix wasn’t enough.' : 'The Path Hunter checks the fix.'}
      lede={
        <>
          {widened ? (
            <p>
              The first plan cut this cluster’s own path. The Path Hunter applied it to a copy of the graph and searched
              again, with no hop limit: {survivors.length} more {plural(survivors.length, 'path')} still reached{' '}
              {hunt.t_scope.join(', ')}. So the plan was widened and checked again.
            </p>
          ) : (
            <p>
              The Path Hunter applied the plan to a copy of the graph and searched again, with no hop limit, using three
              independent methods.
            </p>
          )}
          <p>
            {contained
              ? `After ${hunt.rounds.length} ${plural(hunt.rounds.length, 'round')}, path search, max-flow and an independent search agree: no modelled path survives.`
              : hunt.detail}
          </p>
        </>
      }
      visual={
        <div className="demo-hunt">
          <div className="demo-hunt__bar">
            {overlays.length > 1 && shown ? (
              <Segmented
                size="sm"
                label="Show the graph"
                value={shown.id}
                onValueChange={setManual}
                options={overlays.map((o) => ({ value: o.id, label: o.label, ariaLabel: `${o.label}: ${o.hint}` }))}
              />
            ) : null}
            {shown ? (
              <span className={cn('demo-hunt__hint', shown.verified && 'demo-hunt__hint--verified')}>{shown.hint}</span>
            ) : null}
          </div>
          <GraphStage cluster={cluster} hunt={hunt} overlayId={shown?.id ?? null} />
          <ul className="demo-legend" aria-label="Legend">
            {(['active', 'residual', 'cut'] as const).map((state) => (
              <li key={state} className="demo-legend__item">
                <span
                  className="demo-legend__swatch"
                  style={{
                    borderTopColor: EDGE_STYLE[state].stroke,
                    borderTopStyle: EDGE_STYLE[state].dash ? 'dashed' : 'solid',
                  }}
                  aria-hidden
                />
                {EDGE_STYLE[state].label}
              </li>
            ))}
          </ul>
          {widened ? (
            <div className="demo-card">
              <p className="demo-card__kicker">Paths the first plan missed</p>
              <ul className="demo-paths">
                {survivors.map((path) => (
                  <li key={path.join('>')} className="demo-paths__item">
                    {path.map((node, i) => (
                      <span key={`${node}-${i}`} className="demo-paths__node">
                        {i > 0 ? <ArrowRight aria-hidden /> : null}
                        <span className="demo-mono">{nodeLabel(node)}</span>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      }
    />
  );
}

/* Step 4: the action */

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function StepAct({ cluster, onBack }: { cluster: ClusterView; onBack: () => void }) {
  const analysis = useClusterAnalysis(cluster.id);
  const hunt = analysis.hunt;
  const outcome = useHuntOutcome(hunt);
  const plan = hunt?.plan?.plan ?? null;
  const flows = useMemo(() => mergeFlows(analysis.plan, hunt?.plan), [analysis.plan, hunt?.plan]);
  const receipt = analysis.derived?.receipt;
  const certificate = outcome.certificate;

  if (!hunt || !plan) {
    return (
      <StepShell
        step={4}
        title="It acts, with proof."
        lede={<p>With a verified plan and a valid certificate, the agent records the fix.</p>}
        visual={
          hunt ? <EmptyState title="No verified plan to act on">{hunt.detail}</EmptyState> : <NeedsRun cluster={cluster} onBack={onBack} />
        }
      />
    );
  }

  const exportYaml = () =>
    download(
      `interdict-policies-${plan.id}.yaml`,
      policyYaml(
        plan.actions.map((a) => a.policy_spec),
        { planId: plan.id, certificateId: certificate?.certificate_id, revision: hunt.revision },
      ),
    );

  return (
    <StepShell
      step={4}
      title="It acts, with proof."
      lede={
        <>
          <p>
            The fix is {plan.actions.length} egress {plural(plan.actions.length, 'policy', 'policies')}, one per workload:
            each may reach only the destinations listed. It is the cheapest safe plan among every combination of up to 3
            changes.
          </p>
          <p>
            Only with a valid certificate does the agent submit it, through the Action Gateway. In this build the action is
            a simulation: nothing outside a copy of the synthetic graph changes.
          </p>
        </>
      }
      actions={
        <Button variant="secondary" size="lg" onClick={exportYaml}>
          <Download aria-hidden />
          Download the policies (YAML)
        </Button>
      }
      visual={
        <div className="demo-act">
          <div className="demo-card">
            <p className="demo-card__kicker">The fix</p>
            <div className="demo-card__text">
              <ImpactSentence
                plan={plan}
                flows={flows}
                targets={hunt.t_scope}
                verified={hunt.status === 'SIMULATED_CONTAINMENT'}
                chainCount={hunt.plan?.chains.length ?? 0}
              />
            </div>
            <ul className="demo-changes">
              {plan.actions.map((action) => (
                <li key={action.id} className="demo-change">
                  <div className="demo-change__head">
                    <span className="demo-mono demo-change__pod">{action.pods.join(', ')}</span>
                    <span className="demo-change__variant">{VARIANT[action.variant].label}</span>
                  </div>
                  <div className="demo-change__allow">
                    {action.allow.length > 0 ? (
                      <>
                        May only reach{' '}
                        {action.allow.map((rule, i) => (
                          <span key={`${rule.dst}-${rule.port}-${rule.protocol}`}>
                            {i > 0 ? ', ' : ''}
                            <span className="demo-mono">
                              {nodeLabel(rule.dst)}:{rule.port}/{rule.protocol}
                            </span>
                          </span>
                        ))}
                      </>
                    ) : (
                      'May reach nothing'
                    )}
                    {action.blocked.length > 0 ? ` · blocks ${action.blocked.length} ${plural(action.blocked.length, 'flow')}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className={cn('demo-card', outcome.certificateCurrent ? 'demo-card--valid' : 'demo-card--muted')}>
            <p className="demo-card__kicker">The proof</p>
            {certificate ? (
              <>
                <p className="demo-proof">
                  {outcome.certificateCurrent ? <FileCheck2 aria-hidden /> : <ShieldX aria-hidden />}
                  {outcome.certificateCurrent ? 'Model-verified containment (simulation)' : 'Certificate no longer current'}
                </p>
                <p className="demo-card__text">
                  On this snapshot of the graph, after these {plan.actions.length}{' '}
                  {plural(plan.actions.length, 'change')}, no modelled attack chain reaches {hunt.t_scope.join(', ')}. Three
                  independent methods agreed. This is not evidence of real-world containment.
                </p>
                <p className="demo-card__meta">Valid until {formatUtc(certificate.expires_at, { seconds: false })}</p>
                <Button asChild variant="link">
                  <Link to={`/certificates/${certificate.certificate_id}`}>
                    Open the certificate
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </>
            ) : (
              <p className="demo-card__text">{hunt.detail}</p>
            )}
          </div>
          {receipt ? (
            <div className="demo-card">
              <p className="demo-card__kicker">The action</p>
              <p className="demo-card__text">
                Recorded through the Action Gateway as a{' '}
                {receipt.execution_mode === 'SIMULATION' ? 'simulation' : receipt.execution_mode}:{' '}
                <span className="demo-mono">{receipt.receipt_id}</span>. No infrastructure was changed.
              </p>
            </div>
          ) : null}
        </div>
      }
    />
  );
}

/* Step 5: break it */

function StepBreak({ cluster, storm }: { cluster: ClusterView; storm: StormView }) {
  const client = useApi();
  const { workbench } = useServices();
  const breakIt = useBreakIt(cluster.witness_path[1] ?? cluster.workloads[0] ?? null);
  const revision = useSandboxState((s) => s.revision);
  const analysis = useClusterAnalysis(cluster.id);
  const outcome = useHuntOutcome(analysis.hunt);
  const run = useRun(cluster.id);
  const running = run?.phase === 'starting' || run?.phase === 'streaming';
  const [before, setBefore] = useState<number | null>(null);
  const changed = revision !== null && revision > 1;
  const current = storm.revision === revision;
  const responses = breakIt.last?.responses ?? [];
  const applied = responses.filter((r) => r.result === 'APPLIED').length;
  const lastLabel =
    applied === responses.length
      ? `${applied} ${plural(applied, 'change')} applied`
      : responses.map((r) => `${describeSandboxResult(r.result).label}: ${r.detail}`).join(' · ');
  // Show a re-run's outcome only once it was computed on the graph as it is now.
  const rerunCurrent = run?.phase === 'done' && run.revisionAtStart === revision;

  return (
    <StepShell
      step={5}
      title="Now try to break it."
      lede={
        <>
          <p>
            You have a private copy of the graph. Change it, and the proof must react: the certificate stops being current,
            and the next run plans again from the changed graph.
          </p>
          {client.mode === 'mock' ? (
            <p className="demo-note">
              This is the replay build: changes are checked and recorded, but nothing is recomputed. On the live app every
              verdict is recomputed.
            </p>
          ) : null}
        </>
      }
      visual={
        <div className="demo-break">
          <div className="demo-card">
            <p className="demo-card__kicker">1 · Open a new attack path</p>
            <p className="demo-card__text">
              Expose <span className="demo-mono">batch-1</span> to the Internet (it has the same DEMO-CVE-001 as auth-1) and
              let it reach <span className="demo-mono">checkout-1</span> on port 8080: a new chain to prod-payments-db.
            </p>
            <div className="demo-card__actions">
              <Button
                variant="primary"
                onClick={() => {
                  setBefore(storm.counts.ON_ATTACK_PATH);
                  void breakIt.openPath();
                }}
                disabled={!breakIt.canOpenPath || breakIt.busy}
              >
                <Route aria-hidden />
                Open a new attack path
              </Button>
            </div>
            {breakIt.last?.scenario === 'open-path' ? (
              <ul className="demo-results">
                <li>
                  Sandbox revision <strong>{breakIt.last.revision}</strong>: {lastLabel}
                </li>
                <li>
                  Certificate:{' '}
                  <strong>{outcome.certificateCurrent ? 'still current' : 'no longer current'}</strong>
                </li>
                {before !== null && client.mode !== 'mock' ? (
                  <li>
                    Alerts on a real attack path:{' '}
                    <strong>
                      {before} → {current ? storm.counts.ON_ATTACK_PATH : '…'}
                    </strong>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>

          <div className="demo-card">
            <p className="demo-card__kicker">2 · Run the agent on the changed graph</p>
            <p className="demo-card__text">It plans and hunts again from scratch, and issues a new certificate if the fix still holds.</p>
            <div className="demo-card__actions">
              <Button
                variant="secondary"
                onClick={() => void workbench.start(cluster.id, 'deterministic')}
                disabled={!changed || running}
              >
                {running ? <Loader2 className="demo-spin" aria-hidden /> : <Play aria-hidden />}
                {running ? 'Investigating…' : 'Run the agent again'}
              </Button>
              {analysis.hunt && rerunCurrent && changed ? <OutcomeBadge hunt={analysis.hunt} /> : null}
            </div>
          </div>

          <div className="demo-card">
            <p className="demo-card__kicker">3 · Make the evidence stale</p>
            <p className="demo-card__text">
              Expire one piece of evidence. Interdict must then say it cannot be sure: verdicts that depend on it become
              inconclusive, never “safe”.
            </p>
            <div className="demo-card__actions">
              <Button variant="secondary" onClick={() => void breakIt.makeStale()} disabled={!breakIt.canMakeStale || breakIt.busy}>
                <Hourglass aria-hidden />
                Make evidence stale
              </Button>
            </div>
            {breakIt.last?.scenario === 'stale' ? (
              <ul className="demo-results">
                <li>
                  Sandbox revision <strong>{breakIt.last.revision}</strong>: {lastLabel}
                </li>
                {client.mode !== 'mock' && current ? (
                  <li>
                    {storm.complete ? 'Evidence still complete' : 'Evidence incomplete'}:{' '}
                    <strong>
                      {storm.counts.TRIAGE_INCONCLUSIVE} {plural(storm.counts.TRIAGE_INCONCLUSIVE, 'alert')} inconclusive
                    </strong>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>

          {breakIt.error ? <ErrorState error={breakIt.error} title="The sandbox change failed" /> : null}

          <div className="demo-break__reset">
            <Button variant="ghost" onClick={() => void breakIt.reset()} disabled={breakIt.busy || !changed}>
              <RotateCcw aria-hidden />
              Reset my sandbox
            </Button>
            {breakIt.last?.scenario === 'reset' ? (
              <span className="demo-card__meta">Reset: now at revision {breakIt.last.revision}.</span>
            ) : null}
          </div>
        </div>
      }
    />
  );
}

export default function DemoPage() {
  const storm = useStorm();
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get('step') ?? '1');
  const step = Number.isInteger(requested) ? Math.min(LAST, Math.max(1, requested)) : 1;
  const go = (next: number) => setParams({ step: String(next) });
  const s = storm.data;
  const cluster = s ? demoCluster(s) : undefined;

  let body: ReactNode;
  if (storm.isPending) {
    body = <LoadingState title="Triaging the alert storm" detail="GET /api/storm" />;
  } else if (storm.error) {
    body = <ErrorState error={storm.error} title="The storm report could not be loaded" onRetry={() => void storm.refetch()} />;
  } else if (!s || !cluster) {
    body = <EmptyState title="No attack path reaches a crown jewel">There is nothing to fix in this storm.</EmptyState>;
  } else {
    body = (
      <div key={step} className="demo-stage">
        {step === 1 ? <StepAlerts storm={s} /> : null}
        {step === 2 ? <StepAgent cluster={cluster} /> : null}
        {step === 3 ? <StepHunt cluster={cluster} onBack={() => go(2)} /> : null}
        {step === 4 ? <StepAct cluster={cluster} onBack={() => go(2)} /> : null}
        {step === 5 ? <StepBreak cluster={cluster} storm={s} /> : null}
      </div>
    );
  }

  return (
    <div className="demo">
      <Progress step={step} onGo={go} />
      {body}
      <div className="demo-nav">
        {step > 1 ? (
          <Button variant="ghost" size="lg" onClick={() => go(step - 1)}>
            <ArrowLeft aria-hidden />
            Back
          </Button>
        ) : (
          <span />
        )}
        {step < LAST ? (
          <Button variant="primary" size="lg" onClick={() => go(step + 1)}>
            Next: {STEPS[step]}
            <ArrowRight aria-hidden />
          </Button>
        ) : (
          <Button asChild variant="primary" size="lg">
            <Link to="/storm">
              Explore on your own
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
