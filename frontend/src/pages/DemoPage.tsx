import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Check,
  CircleAlert,
  Download,
  FileCheck2,
  Globe,
  Hourglass,
  KeyRound,
  Loader2,
  Play,
  RotateCcw,
  Route,
  ShieldCheck,
  ShieldX,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useSandboxReset, useStorm, useSubgraph } from '@/api/queries';
import type { ClusterView, HuntReportView, PlanView, StormView } from '@/api/types';
import { useBreakIt } from '@/app/breakIt';
import { useClusterAnalysis, useHuntOutcome } from '@/app/hooks';
import { useApi, useRun, useSandboxState, useServices } from '@/app/services';
import { AttackGraph } from '@/components/graph/AttackGraph';
import { EDGE_STYLE } from '@/components/graph/graphTheme';
import { CountUp } from '@/components/motion/CountUp';
import { staticMotion } from '@/components/motion/staticMotion';
import { Num } from '@/components/Num';
import { OutcomeBadge } from '@/components/OutcomeBadge';
import { ImpactSentence } from '@/components/plan/PlanReport';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { formatUtc, nodeLabel, plural } from '@/lib/format';
import { defaultOverlay, deriveOverlays } from '@/lib/graphState';
import type { DerivedInvestigation } from '@/lib/investigation';
import { toolTitle, TYPICAL_RUN } from '@/lib/investigation';
import { huntPlanHandle, mergeFlows } from '@/lib/plan';
import { policyYaml } from '@/lib/policyYaml';
import { describeSandboxResult, VARIANT } from '@/lib/status';
import { restraintExample, SEVERITY_ORDER } from '@/lib/storm';
import { MAX_SANDBOX_OPERATIONS } from '@/state/sandbox';

import './DemoPage.css';

const STEPS = ['The alerts', 'The agent', 'The hunt', 'The action', 'Break it'] as const;
const LAST = STEPS.length;

/**
 * The cluster the demo follows, kept for the page session: stale evidence empties the storm's
 * clusters, and the story (with its reset) must survive leaving the demo and coming back.
 */
let rememberedCluster: ClusterView | null = null;

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
  aside,
  visual,
}: {
  step: number;
  title: ReactNode;
  lede: ReactNode;
  actions?: ReactNode;
  /** Supporting detail under the actions (checklists, the graph behind a number). */
  aside?: ReactNode;
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
        {aside ? <div className="demo-step__aside">{aside}</div> : null}
      </div>
      <div className="demo-step__visual">{visual}</div>
    </section>
  );
}

/**
 * Steps 3 and 4 show the agent's results. When there is no run yet (the visitor skipped step 2,
 * or reloaded), start one and show it working instead of an empty step.
 */
function WaitForRun({ cluster }: { cluster: ClusterView }) {
  const { workbench } = useServices();
  const run = useRun(cluster.id);
  const analysis = useClusterAnalysis(cluster.id);
  useEffect(() => {
    if (!run) void workbench.start(cluster.id, 'agent');
  }, [run, cluster.id, workbench]);
  const retry = () => void workbench.start(cluster.id, 'agent');
  if ((run?.phase === 'failed' || run?.phase === 'interrupted') && run.error) {
    return <ErrorState error={run.error} title="The investigation did not finish" onRetry={retry} />;
  }
  if (run?.phase === 'done' && !analysis.hunt) {
    return (
      <EmptyState title="The agent finished without a Path Hunter result">
        {analysis.derived?.done ? `It ended with ${analysis.derived.done.status}.` : null}
      </EmptyState>
    );
  }
  return (
    <div className="demo-wait">
      <div className="demo-wait__head">
        <Loader2 className="demo-spin" aria-hidden />
        <div>
          <p className="demo-card__title">Running the agent first</p>
          <p className="demo-card__text">This step shows its results. It takes about three seconds.</p>
        </div>
      </div>
      <AgentTimeline derived={analysis.derived} />
    </div>
  );
}

/* Supporting content: what the steps rest on */

const MATTERS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Globe, title: 'Exposed', body: 'Reachable from the Internet through an ingress.' },
  { icon: Bug, title: 'Exploitable', body: 'Runs an active, network-exploitable vulnerability.' },
  { icon: Waypoints, title: 'Connected', body: 'Observed flows lead on to a crown-jewel database.' },
  { icon: KeyRound, title: 'Authorised', body: 'The last hop holds an IAM grant to the database.' },
];

function WhatMatters() {
  return (
    <div className="demo-aside">
      <p className="demo-aside__title">An alert matters only if the graph shows all four</p>
      <ol className="demo-conditions">
        {MATTERS.map((item) => (
          <li key={item.title} className="demo-condition">
            <span className="demo-condition__icon">
              <item.icon aria-hidden />
            </span>
            <div>
              <p className="demo-condition__title">{item.title}</p>
              <p className="demo-condition__body">{item.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function OtherAlerts({ storm }: { storm: StormView }) {
  const rest = storm.total_alerts - storm.counts.ON_ATTACK_PATH;
  const rows = [
    { key: 'not-actionable', value: storm.counts.NOT_ACTIONABLE, label: 'not actionable' },
    { key: 'no-path', value: storm.counts.NOT_ON_ATTACK_PATH, label: 'vulnerable, but on no path' },
    {
      key: 'inconclusive',
      value: storm.counts.TRIAGE_INCONCLUSIVE,
      label: storm.complete ? 'inconclusive' : 'inconclusive: stale evidence',
    },
  ];
  return (
    <div className="demo-card">
      <p className="demo-card__kicker">Where the other {rest.toLocaleString('en-US')} alerts went</p>
      <ul className="demo-others">
        {rows.map((row) => (
          <li key={row.key} className="demo-other">
            <span className="demo-other__value">{row.value.toLocaleString('en-US')}</span>
            <span className="demo-other__label">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HunterChecks({ hunt }: { hunt: HuntReportView | undefined }) {
  const last = hunt?.rounds[hunt.rounds.length - 1];
  const scope = hunt?.t_scope ?? [];
  const reached = last ? last.o_reachable.filter((target) => scope.includes(target)) : [];
  const ms = (value: number | undefined) => (value === undefined ? null : `${value < 1 ? value.toFixed(2) : Math.round(value)} ms`);
  const checks = [
    {
      letter: 'E',
      title: 'Path search',
      detail: 'Lists every attack chain of up to 3 lateral hops.',
      result: last ? `${last.e_chains.length} ${plural(last.e_chains.length, 'chain')} left` : null,
      time: ms(last?.latency_ms.E),
    },
    {
      letter: 'F',
      title: 'Max-flow in FalkorDB',
      detail: 'Max-flow from the Internet to each crown jewel, at any depth; 0 means no path.',
      result: last ? scope.map((target) => `${target}: ${last.f_values[target] ?? '?'}`).join(', ') : null,
      time: ms(last?.latency_ms.F),
    },
    {
      letter: 'O',
      title: 'Independent search',
      detail: 'A separate breadth-first search over the exported attack steps, at any depth.',
      result: last ? (reached.length > 0 ? `reaches ${reached.join(', ')}` : 'reaches nothing in scope') : null,
      time: ms(last?.latency_ms.O),
    },
  ];
  return (
    <div className="demo-card demo-fill demo-spread">
      <p className="demo-card__kicker">Three independent checks, on a copy of the graph</p>
      <ul className="demo-spread__rows">
        {checks.map((check) => (
          <li key={check.letter} className="demo-method">
            <span className="demo-method__letter">{check.letter}</span>
            <span className="demo-method__title">{check.title}</span>
            {check.result ? <span className="demo-method__result">{check.result}</span> : null}
            {check.time ? <span className="demo-method__time">{check.time}</span> : null}
            <span className="demo-method__detail">{check.detail}</span>
          </li>
        ))}
      </ul>
      <p className="demo-now__note">A certificate is issued only when all three find no path to the crown jewel.</p>
    </div>
  );
}

function RoundsCard({ hunt }: { hunt: HuntReportView }) {
  const scope = new Set(hunt.t_scope);
  return (
    <div className="demo-card">
      <p className="demo-card__kicker">Round by round</p>
      <ol className="demo-rounds">
        {hunt.rounds.map((round) => {
          const clear =
            round.residuals.length === 0 &&
            !round.o_reachable.some((target) => scope.has(target)) &&
            hunt.t_scope.every((target) => (round.f_values[target] ?? 0) === 0);
          const paths = round.residuals
            .map((id) => hunt.chains.find((chain) => chain.id === id)?.path)
            .filter((path): path is string[] => Array.isArray(path));
          return (
            <li key={round.round} className={cn('demo-round', clear && 'demo-round--clear')}>
              <div className="demo-round__row">
                <span className="demo-round__badge">Round {round.round}</span>
                <span className="demo-round__plan">
                  {round.action_ids.length} {plural(round.action_ids.length, 'change')}
                </span>
                <span className="demo-round__result">
                  {clear
                    ? 'no modelled path survives'
                    : `${round.residuals.length} ${plural(round.residuals.length, 'path')} survived`}
                </span>
                <span className="demo-round__time">{Math.max(1, Math.round(round.latency_ms.round))} ms</span>
              </div>
              {paths.map((path) => (
                <p key={path.join('>')} className="demo-round__path">
                  {path.map((node) => nodeLabel(node)).join(' → ')}
                </p>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const GATEWAY_RULES = [
  'An allowlisted action type: egress network policies only',
  'SIMULATION mode: LIVE execution is disabled',
  'A VALID certificate at the current sandbox revision',
  'An idempotency key, so a retry never acts twice',
];

function GatewayChecks() {
  return (
    <div className="demo-aside">
      <p className="demo-aside__title">Before it may act, the Action Gateway requires</p>
      <ul className="demo-rules">
        {GATEWAY_RULES.map((rule) => (
          <li key={rule} className="demo-rule">
            <span className="demo-rule__icon">
              <Check aria-hidden />
            </span>
            {rule}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Desktop layouts fit each step above the navigation line; on phones the step scrolls instead. */
const DESKTOP = '(min-width: 1024px)';
/** Shorter windows start at a tighter fit level, so the type does not change from step to step. */
const START_LEVEL: [query: string, level: number][] = [
  ['(max-height: 740px)', 2],
  ['(max-height: 820px)', 1],
];
/** The data-fit value of each level: the levels add up, so level 2 also applies level 1's rules. */
const FIT_LEVELS = ['', '1', '1 2', '1 2 3'];

/**
 * Tighten a step until it ends above the navigation line (DemoPage.css, "Fit levels"). Measured, so
 * it also adapts to the sandbox banners above the demo and to results that arrive later. If even the
 * last level cannot fit, the step scrolls inside its frame; the navigation never moves.
 */
function useFitToStage() {
  const stop = useRef<(() => void) | null>(null);
  return useCallback((stage: HTMLDivElement | null) => {
    stop.current?.();
    stop.current = null;
    if (!stage) return;
    let frame = 0;
    let live = true;
    const media = (query: string) => window.matchMedia?.(query).matches ?? false;
    // Too tall: the step scrolls, or a card that fills the leftover space is smaller than its content.
    const tooTall = () =>
      stage.scrollHeight > stage.clientHeight ||
      Array.from(stage.querySelectorAll<HTMLElement>('.demo-fill')).some((el) => el.scrollHeight > el.clientHeight + 1);
    const fit = () => {
      frame = 0;
      if (!live) return;
      let level = media(DESKTOP) ? (START_LEVEL.find(([query]) => media(query))?.[1] ?? 0) : 0;
      stage.dataset.fit = FIT_LEVELS[level];
      while (media(DESKTOP) && level < FIT_LEVELS.length - 1 && tooTall()) {
        level += 1;
        stage.dataset.fit = FIT_LEVELS[level];
      }
    };
    const schedule = () => {
      if (live && !frame) frame = requestAnimationFrame(fit);
    };
    fit();
    const resize = new ResizeObserver(schedule);
    resize.observe(stage);
    const changes = new MutationObserver(schedule);
    changes.observe(stage, { childList: true, subtree: true });
    void document.fonts?.ready.then(schedule);
    stop.current = () => {
      live = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
    };
  }, []);
}

/** How many fixed-height rows fit in a box that the layout sizes (lists that fill to the line, never scroll). */
function useRowsThatFit(rowHeight: number, fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (height > 0) setRows(Math.max(1, Math.floor(height / rowHeight)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [rowHeight]);
  return [ref, rows] as const;
}

/** Step 1: what the CVE score alone would have said. Hidden while evidence is stale: with alerts
 * inconclusive, no count of alerts off a path could be called final. */
function SeverityCard({ storm }: { storm: StormView }) {
  const alerts = storm.alerts ?? [];
  if (alerts.length === 0 || !storm.complete) return null;
  const rows = SEVERITY_ORDER.map((severity) => {
    const all = alerts.filter((a) => a.severity === severity);
    return { severity, total: all.length, onPath: all.filter((a) => a.triage_class === 'ON_ATTACK_PATH').length };
  });
  const max = Math.max(1, ...rows.map((r) => r.total));
  const critical = rows[0];
  return (
    <div className="demo-card demo-fill demo-severity">
      <p className="demo-card__kicker">Severity is not the answer</p>
      {critical && critical.total > 0 ? (
        <p className="demo-severity__lead">
          Of {critical.total} critical alerts, only <strong>{critical.onPath}</strong> sit on a real attack path.
        </p>
      ) : null}
      <ul className="demo-severity__rows">
        {rows.map((row) => (
          <li key={row.severity} className="demo-severity__row">
            <span className="demo-severity__label">{row.severity.toLowerCase()}</span>
            <span className="demo-severity__bar" aria-hidden>
              <span className="demo-severity__all" style={{ width: `${(row.total / max) * 100}%` }} />
              <span className="demo-severity__on" style={{ width: `${(row.onPath / max) * 100}%` }} />
            </span>
            <span className="demo-severity__count">
              <strong>{row.onPath}</strong> of {row.total}
            </span>
          </li>
        ))}
      </ul>
      <p className="demo-severity__legend">
        <span className="demo-severity__key demo-severity__key--on" aria-hidden /> on a real attack path
        <span className="demo-severity__key" aria-hidden /> all alerts at that severity
      </p>
    </div>
  );
}

/** Step 1: real alerts behind the 69, as many as fit. */
function AlertsThatMatter({ storm }: { storm: StormView }) {
  const [box, rows] = useRowsThatFit(38, 4);
  const order: readonly string[] = SEVERITY_ORDER;
  const onPath = (storm.alerts ?? [])
    .filter((a) => a.triage_class === 'ON_ATTACK_PATH')
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.alert_id.localeCompare(b.alert_id));
  if (onPath.length === 0) return null;
  // One alert per workload first, so the rows show where the alerts that matter come from.
  const byPod = new Map<string, typeof onPath>();
  for (const alert of onPath) byPod.set(alert.pod, [...(byPod.get(alert.pod) ?? []), alert]);
  const mixed: typeof onPath = [];
  for (let i = 0; mixed.length < onPath.length; i += 1) {
    for (const group of byPod.values()) {
      const alert = group[i];
      if (alert) mixed.push(alert);
    }
  }
  return (
    <div className="demo-card demo-fill demo-list">
      <p className="demo-card__kicker">
        A few of the {storm.counts.ON_ATTACK_PATH} alerts that matter
      </p>
      <div ref={box} className="demo-list__box">
        <ul className="demo-list__rows">
          {mixed.slice(0, rows).map((alert) => (
            <li key={alert.alert_id} className="demo-list__row">
              <span className="demo-mono demo-list__id">{alert.alert_id}</span>
              <span className="demo-mono demo-list__pod">{alert.pod}</span>
              <span className="demo-mono demo-list__cve">{alert.cve_id}</span>
              <span className={cn('demo-list__sev', `demo-list__sev--${alert.severity.toLowerCase()}`)}>
                {alert.severity.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const AGENT_RULES = [
  'Uses only seven typed MCP tools; there is no query tool',
  'Never writes Cypher: every query is a fixed, parameterised template',
  'At most 12 tool calls per investigation',
  'It cannot change your sandbox: sandbox operations are not tools',
  'No AI model: every decision is a written rule over tool results',
];

/** Step 2: the guard rails around the agent. */
function AgentRules() {
  return (
    <div className="demo-card demo-fill demo-spread">
      <p className="demo-card__kicker">What the agent can and cannot do</p>
      <ul className="demo-spread__rows">
        {AGENT_RULES.map((rule) => (
          <li key={rule} className="demo-rule">
            <span className="demo-rule__icon">
              <Check aria-hidden />
            </span>
            {rule}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Step 4: the policy file, as many lines as fit. */
function PolicyPreview({ text }: { text: string }) {
  const [box, rows] = useRowsThatFit(18, 12);
  const lines = text.trimEnd().split('\n');
  const shown = lines.length > rows ? [...lines.slice(0, Math.max(1, rows - 1)), '# … download for the full file'] : lines;
  return (
    <div className="demo-card demo-fill demo-yaml">
      <p className="demo-card__kicker">Preview of the policy file</p>
      <div ref={box} className="demo-yaml__box">
        <pre className="demo-yaml__code">
          {shown.map((line, index) => (
            <span key={index} className="demo-yaml__line">
              {line}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}

/** Step 4: what the fix costs in legitimate traffic. */
function ImpactTiles({ plan, total }: { plan: PlanView; total: number }) {
  const tiles = [
    { key: 'broken', node: <Num metric="declaredBroken" value={plan.known_broken.length} />, label: plural(plan.known_broken.length, 'declared dependency broken', 'declared dependencies broken') },
    { key: 'unknown', node: <Num metric="unknownImpact" value={plan.unknown.length} />, label: plural(plan.unknown.length, 'flow with unknown impact', 'flows with unknown impact') },
    { key: 'blocked', node: <Num metric="flowsBlocked" value={plan.blocked.length} />, label: plural(plan.blocked.length, 'flow blocked', 'flows blocked') },
    { key: 'cut', node: <Num metric="pathsSevered" value={plan.covered.length} suffix={` / ${total}`} detail={`|C| = ${total} chains in the constraint set.`} />, label: 'attack paths cut' },
  ];
  return (
    <ul className="demo-impact demo-fill" aria-label="Impact of the fix">
      {tiles.map((tile) => (
        <li key={tile.key} className="demo-impact__tile">
          <span className="demo-impact__value">{tile.node}</span>
          <span className="demo-impact__label">{tile.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Step 5: the visitor's sandbox, live. */
function SandboxNow() {
  const revision = useSandboxState((s) => s.revision);
  const history = useSandboxState((s) => s.history);
  const superseded = useSandboxState((s) => s.superseded);
  const expired = useSandboxState((s) => s.expired);
  const applied = history.filter((e) => e.response?.result === 'APPLIED').length;
  const rows: { key: string; label: string; value: ReactNode }[] = [
    { key: 'revision', label: 'Revision of your graph', value: revision ?? '…' },
    { key: 'applied', label: 'Changes applied', value: <Num metric="sessionOperations" value={applied} /> },
    { key: 'superseded', label: 'Certificates no longer current', value: Object.keys(superseded).length },
    { key: 'expired', label: 'Evidence expired', value: expired.length },
  ];
  return (
    <div className="demo-card demo-fill demo-spread">
      <p className="demo-card__kicker">Your sandbox right now</p>
      <dl className="demo-spread__rows">
        {rows.map((row) => (
          <div key={row.key} className="demo-now__row">
            <dt>{row.label}</dt>
            <dd className="demo-now__value">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="demo-now__note">
        Every change raises the revision, and a certificate from an earlier revision stops being current. Up to{' '}
        {MAX_SANDBOX_OPERATIONS} changes per session; a reset starts over.
      </p>
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
      aside={
        <>
          <WhatMatters />
          <SeverityCard storm={storm} />
        </>
      }
      title={
        <>
          {storm.total_alerts.toLocaleString('en-US')} alerts.
          <br />
          {storm.complete ? `Only ${onPath} matter.` : 'The triage is inconclusive.'}
        </>
      }
      lede={
        <>
          <p>
            Interdict checks every alert against the graph: can an attacker get from the Internet, through this workload,
            all the way to a crown-jewel database? Only alerts on such a path are worth fixing.
          </p>
          {storm.complete ? null : (
            <p className="demo-note">
              Evidence in your sandbox is stale, so {storm.counts.TRIAGE_INCONCLUSIVE} alerts cannot be classified. Interdict
              will not call them safe. Reset the sandbox in step 5 to restore the evidence.
            </p>
          )}
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
          <OtherAlerts storm={storm} />
          {restraint ? (
            <div className="demo-card">
              <p className="demo-card__kicker">
                Same vulnerability, different verdicts: <span className="demo-mono">{restraint.cve}</span>
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
          <AlertsThatMatter storm={storm} />
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
          ms: s.result?.latency_ms ?? null,
          state: s.state,
        }))
      : TYPICAL_RUN.map((tool) => ({
          key: tool,
          tool,
          title: toolTitle(tool, undefined),
          why: null,
          ms: null,
          state: 'idle' as const,
        }));
  return (
    <ol className="demo-timeline" aria-live="polite" aria-label="The agent’s tool calls">
      {rows.map((row, index) => (
        <li
          key={row.key}
          className={cn('demo-timeline__item', `demo-timeline__item--${row.state}`)}
          title={row.why ? `Why: ${row.why}` : undefined}
        >
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
          <span className="demo-timeline__text">
            <span className="demo-timeline__title">{row.title}</span>
            {row.why ? <span className="demo-timeline__why">{row.why}</span> : null}
          </span>
          <span className="demo-timeline__tool">
            {row.tool}
            {row.ms != null ? ` · ${Math.max(1, Math.round(row.ms))} ms` : ''}
          </span>
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
  fill = false,
}: {
  cluster: ClusterView;
  hunt: HuntReportView | undefined;
  overlayId?: string | null;
  height?: 'sm' | 'md';
  /** Grow into the column's leftover height (desktop layout). */
  fill?: boolean;
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
    <div className={cn('demo-graph', `demo-graph--${height}`, fill && 'demo-fill')}>
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
  // When the agent stops before a hunt (stale evidence, no cluster), its last decision says why.
  const lastDecision =
    derived?.items.reduce<string | null>((text, item) => (item.kind === 'narration' ? item.event.text : text), null) ??
    null;
  return (
    <StepShell
      step={2}
      aside={<AgentRules />}
      title="The agent investigates."
      lede={
        <>
          <p>
            It follows the attack path into <strong>{cluster.target}</strong> via{' '}
            <strong>{cluster.entry_ingress}</strong>, calling Interdict’s graph tools over MCP. After each answer it
            decides the next step, shown under each tool; FalkorDB gives every verdict.
          </p>
          <p className="demo-note">
            No AI model and no API key: every decision is a written rule over the graph’s answers, so runs are free
            and repeatable.
          </p>
        </>
      }
      actions={
        <Button
          variant="primary"
          size="lg"
          onClick={() => void workbench.start(cluster.id, 'agent')}
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
          <GraphStage cluster={cluster} hunt={undefined} overlayId="baseline" height="sm" fill />
          <AgentTimeline derived={derived} />
          {finished && analysis.hunt ? (
            <div className="demo-agent__outcome">
              <OutcomeBadge hunt={analysis.hunt} />
              {elapsed !== null ? <span className="demo-agent__time">Finished in {elapsed.toFixed(1)} s</span> : null}
            </div>
          ) : finished && derived?.report ? (
            <p className="demo-agent__stop">
              <strong>{derived.report.headline}.</strong> {lastDecision}
            </p>
          ) : null}
          {run?.phase === 'failed' && run.error ? (
            <ErrorState
              error={run.error}
              title="The investigation could not start"
              onRetry={() => void workbench.start(cluster.id, 'agent')}
            />
          ) : null}
        </div>
      }
    />
  );
}

/* Step 3: the hunt */

function StepHunt({ cluster }: { cluster: ClusterView }) {
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
        aside={<HunterChecks hunt={undefined} />}
        visual={<WaitForRun cluster={cluster} />}
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
      aside={<HunterChecks hunt={hunt} />}
      title={widened ? 'The first fix wasn’t enough.' : 'The Path Hunter checks the fix.'}
      lede={
        <>
          <p>
            {widened
              ? `The first plan cut this cluster’s own path. On a copy of the graph, with no hop limit, the Path Hunter still found ${survivors.length} more ${plural(survivors.length, 'path')} into ${hunt.t_scope.join(', ')}, so the plan was widened.`
              : 'The Path Hunter applied the plan to a copy of the graph and searched again, with no hop limit.'}{' '}
            {contained
              ? `After ${hunt.rounds.length} ${plural(hunt.rounds.length, 'round')}, all three checks agree: no modelled path survives.`
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
          <GraphStage cluster={cluster} hunt={hunt} overlayId={shown?.id ?? null} fill />
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
          <RoundsCard hunt={hunt} />
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

function StepAct({ cluster }: { cluster: ClusterView }) {
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
        aside={<GatewayChecks />}
        visual={
          hunt ? <EmptyState title="No verified plan to act on">{hunt.detail}</EmptyState> : <WaitForRun cluster={cluster} />
        }
      />
    );
  }

  const yaml = policyYaml(
    plan.actions.map((a) => a.policy_spec),
    { planId: plan.id, certificateId: certificate?.certificate_id, revision: hunt.revision },
  );
  const exportYaml = () => download(`interdict-policies-${plan.id}.yaml`, yaml);

  return (
    <StepShell
      step={4}
      title="It acts, with proof."
      aside={
        <>
          <GatewayChecks />
          <PolicyPreview text={yaml} />
        </>
      }
      lede={
        <>
          <p>
            The fix is {plan.actions.length} egress {plural(plan.actions.length, 'policy', 'policies')}, one per workload:
            the cheapest safe plan within 3 changes. With a valid certificate, the agent submits it through the Action
            Gateway; in this build, as a simulation.
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
                  <span className="demo-mono demo-change__pod">{action.pods.join(', ')}</span>
                  <span className="demo-change__variant">{VARIANT[action.variant].label}</span>
                  <span className="demo-mono demo-change__allow">
                    {action.allow.length > 0
                      ? `→ ${action.allow.map((rule) => `${nodeLabel(rule.dst)}:${rule.port}/${rule.protocol}`).join(', ')}`
                      : '→ nothing'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <ImpactTiles plan={plan} total={hunt.plan?.chains.length ?? 0} />
          <div className={cn('demo-card', outcome.certificateCurrent ? 'demo-card--valid' : 'demo-card--muted')}>
            <p className="demo-card__kicker">The proof and the action</p>
            {certificate ? (
              <>
                <p className="demo-proof">
                  {outcome.certificateCurrent ? <FileCheck2 aria-hidden /> : <ShieldX aria-hidden />}
                  {outcome.certificateCurrent ? 'Model-verified containment (simulation)' : 'Certificate no longer current'}
                </p>
                <p className="demo-card__text">
                  After these {plan.actions.length} {plural(plan.actions.length, 'change')}, no modelled attack chain reaches{' '}
                  {hunt.t_scope.join(', ')} on this snapshot; three independent methods agreed. This is not evidence of
                  real-world containment.
                </p>
                <p className="demo-card__meta">
                  Valid until {formatUtc(certificate.expires_at, { seconds: false })}
                  {receipt
                    ? ` · recorded through the Action Gateway as a ${receipt.execution_mode === 'SIMULATION' ? 'simulation' : receipt.execution_mode} (${receipt.receipt_id}); no infrastructure was changed`
                    : ''}
                </p>
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
      aside={<SandboxNow />}
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
              Expose <span className="demo-mono">batch-1</span> (same DEMO-CVE-001 as auth-1) and let it reach{' '}
              <span className="demo-mono">checkout-1</span> on port 8080.
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
                  Revision <strong>{breakIt.last.revision}</strong> · {lastLabel}
                </li>
                <li>
                  Certificate{' '}
                  <strong>{outcome.certificateCurrent ? 'still current' : 'no longer current'}</strong>
                </li>
                {before !== null && client.mode !== 'mock' ? (
                  <li>
                    On a real attack path{' '}
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
            <p className="demo-card__text">It plans and hunts again, and issues a new certificate if the fix still holds.</p>
            <div className="demo-card__actions">
              <Button
                variant="secondary"
                onClick={() => void workbench.start(cluster.id, 'agent')}
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
              Expire one piece of evidence: the verdicts that depend on it turn inconclusive, never “safe”.
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
                  Revision <strong>{breakIt.last.revision}</strong> · {lastLabel}
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
  const [pinned, setPinned] = useState<ClusterView | null>(() => rememberedCluster);
  const reset = useSandboxReset();
  const fitStage = useFitToStage();
  // Keep following the same cluster: stale evidence makes the triage inconclusive and empties the
  // storm's clusters, but the demo must still show what happened to it (and offer a reset).
  useEffect(() => {
    if (!s) return;
    const next = pinned ? (s.clusters.find((c) => c.id === pinned.id) ?? pinned) : (demoCluster(s) ?? null);
    if (next !== pinned) {
      rememberedCluster = next;
      setPinned(next);
    }
  }, [s, pinned]);
  const cluster = pinned ?? (s ? demoCluster(s) : undefined);

  let body: ReactNode;
  if (storm.isPending) {
    body = <LoadingState title="Triaging the alert storm" detail="GET /api/storm" />;
  } else if (storm.error) {
    body = <ErrorState error={storm.error} title="The storm report could not be loaded" onRetry={() => void storm.refetch()} />;
  } else if (!s || !cluster) {
    body =
      s && !s.complete ? (
        <EmptyState
          title="Not enough fresh evidence"
          action={
            <Button variant="primary" onClick={() => reset.mutate()} disabled={reset.isPending}>
              <RotateCcw aria-hidden />
              Reset my sandbox
            </Button>
          }
        >
          The triage is inconclusive, so no attack path can be shown. Reset the sandbox to restore the evidence.
        </EmptyState>
      ) : (
        <EmptyState title="No attack path reaches a crown jewel">There is nothing to fix in this storm.</EmptyState>
      );
  } else {
    body = (
      <div key={step} ref={fitStage} className="demo-stage">
        {step === 1 ? <StepAlerts storm={s} /> : null}
        {step === 2 ? <StepAgent cluster={cluster} /> : null}
        {step === 3 ? <StepHunt cluster={cluster} /> : null}
        {step === 4 ? <StepAct cluster={cluster} /> : null}
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
