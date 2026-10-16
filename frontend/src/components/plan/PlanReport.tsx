import { ListOrdered, OctagonX } from 'lucide-react';

import type { ChainView, FlowRef, PlanReportView, PlanView } from '@/api/types';
import { cn } from '@/lib/cn';
import { describeFlow, plural } from '@/lib/format';
import { flowSources } from '@/lib/plan';
import { describeStatus, reasonText, TONE_CLASS } from '@/lib/status';

import { Num } from '../Num';
import { PathChips } from '../PathChips';
import { StatusBadge, StatusIcon } from '../StatusBadge';
import { Banner } from '../states';
import { Disclosure } from '../ui/disclosure';
import { Tag } from '../ui/tag';
import { Tip } from '../ui/tooltip';

import { ActionCard } from './ActionCard';

function targetsOf(report: PlanReportView, chains: readonly ChainView[]): string[] {
  if (report.t_scope && report.t_scope.length > 0) return report.t_scope;
  return [...new Set(chains.filter((c) => report.chains.includes(c.id)).map((c) => c.target))].sort();
}

/**
 * The plan's impact in one sentence, in the wording of solution.md §4.3. Built from the
 * engine's sets; nothing is estimated.
 */
export function ImpactSentence({
  plan,
  flows,
  targets,
  verified,
  chainCount,
}: {
  plan: PlanView;
  flows: Record<string, FlowRef>;
  targets: string[];
  verified: boolean;
  chainCount: number;
}) {
  const broken = plan.known_broken;
  const unknownPods = flowSources(plan.unknown, flows);
  const scope = targets.length > 0 ? ` to ${targets.join(', ')}` : '';
  return (
    <p className="text-ui leading-5 text-fg">
      {verified ? (
        `Closes all modelled paths${scope}`
      ) : (
        <>
          Cuts all <Num metric="constraintChains" value={chainCount} /> {plural(chainCount, 'chain')} in its constraint
          set{scope}
        </>
      )}
      ;{' '}
      {broken.length === 0 ? (
        'breaks no declared dependency'
      ) : (
        <>
          breaks <Num metric="declaredBroken" value={broken.length} /> declared{' '}
          {plural(broken.length, 'dependency', 'dependencies')} ({broken.map((id) => describeFlow(id, flows)).join('; ')})
        </>
      )}
      {plan.unknown.length > 0 ? (
        <>
          ;{' '}
          <span className="text-yellow-300">
            <Num metric="unknownImpact" value={plan.unknown.length} /> blocked {plural(plan.unknown.length, 'flow')}{' '}
            {plan.unknown.length === 1 ? 'has' : 'have'} unknown impact
          </span>
          {unknownPods.length > 0 ? ` (${unknownPods.join(', ')})` : ''}
        </>
      ) : null}
      .
    </p>
  );
}

function PlanMetrics({ plan, total }: { plan: PlanView; total: number }) {
  const cells = [
    { label: 'Declared deps broken', node: <Num metric="declaredBroken" value={plan.known_broken.length} /> },
    { label: 'Unknown-impact flows', node: <Num metric="unknownImpact" value={plan.unknown.length} /> },
    { label: 'Flows blocked', node: <Num metric="flowsBlocked" value={plan.blocked.length} /> },
    {
      label: 'Paths severed',
      node: <Num metric="pathsSevered" value={plan.covered.length} suffix={` / ${total}`} detail={`|C| = ${total} chains in the constraint set.`} />,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-md border border-line bg-canvas px-2.5 py-2">
          <dt className="text-2xs text-fg-subtle">{cell.label}</dt>
          <dd className="mt-0.5 text-sm font-semibold text-fg">{cell.node}</dd>
        </div>
      ))}
    </dl>
  );
}

function NamedFlows({ title, ids, flows, tone }: { title: string; ids: string[]; flows: Record<string, FlowRef>; tone?: 'yellow' }) {
  if (ids.length === 0) return null;
  return (
    <div>
      <div className="section-label mb-1">{title}</div>
      <ul className="space-y-0.5">
        {ids.map((id) => (
          <li key={id} className="flex flex-wrap items-baseline gap-x-2 text-2xs">
            <span className={cn('font-mono text-[11.5px]', tone === 'yellow' ? 'text-yellow-300' : 'text-fg')}>
              {describeFlow(id, flows)}
            </span>
            <span className="font-mono text-fg-subtle">{id}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Optimality({ value }: { value: string | null }) {
  if (!value) return null;
  const exact = value === 'EXACT_WITHIN_K';
  return (
    <Tip
      content={
        exact
          ? 'Optimal among plans of at most 3 actions drawn from this catalogue, for this constraint set. Not globally optimal over every possible policy (§7.10).'
          : 'Found without the exact search (for example a capped catalogue). Never described as optimal.'
      }
    >
      <button type="button" className="cursor-help rounded">
        <Tag mono>{value}</Tag>
      </button>
    </Tip>
  );
}

/** Best plan vs alternatives vs hard isolation, ranked by the lexicographic objective. */
function Comparison({ report, flows }: { report: PlanReportView; flows: Record<string, FlowRef> }) {
  const best = report.plan;
  if (!best) return null;
  const rows: { plan: PlanView; label: string; best?: boolean }[] = [{ plan: best, label: 'Best plan', best: true }];
  report.alternatives.forEach((plan, index) => rows.push({ plan, label: `Alternative ${index + 1}` }));
  const hard = report.hard_isolation;
  const hardListed = hard && rows.some((r) => r.plan.id === hard.id);
  if (hard && !hardListed) rows.push({ plan: hard, label: 'Hard isolation' });
  if (rows.length === 1) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ListOrdered className="size-3.5 text-fg-subtle" aria-hidden />
        <div className="section-label">Compared plans</div>
      </div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[30rem] text-left text-2xs">
          <caption className="sr-only">
            Plans ranked by declared dependencies broken, then unknown-impact flows, then actions, then flows blocked.
          </caption>
          <thead className="bg-surface text-fg-subtle">
            <tr>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Plan</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Broken</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Unknown</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Actions</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Blocked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ plan, label, best: isBest }) => (
              <tr key={`${label}-${plan.id}`} className={cn('border-t border-line align-top', isBest && 'bg-elevated/60')}>
                <td className="px-2.5 py-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('font-medium', isBest ? 'text-fg' : 'text-fg-muted')}>{label}</span>
                    {plan.id === hard?.id && label !== 'Hard isolation' ? <Tag>hard isolation</Tag> : null}
                  </div>
                  <div className="mt-0.5 space-y-px font-mono text-[11px] text-fg-subtle">
                    {plan.action_ids.map((id) => (
                      <div key={id} className="break-all">
                        {id}
                      </div>
                    ))}
                  </div>
                  {plan.known_broken.length > 0 ? (
                    <div className="mt-0.5 text-[11px] text-fg-muted">
                      breaks {plan.known_broken.map((id) => describeFlow(id, flows)).join('; ')}
                    </div>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right text-fg">
                  <Num metric="declaredBroken" value={plan.objective.known_broken} plain />
                </td>
                <td className="px-2 py-1.5 text-right text-fg">
                  <Num metric="unknownImpact" value={plan.objective.unknown} plain />
                </td>
                <td className="px-2 py-1.5 text-right text-fg">
                  <Num metric="planActions" value={plan.objective.actions} plain />
                </td>
                <td className="px-2 py-1.5 text-right text-fg">
                  <Num metric="flowsBlocked" value={plan.objective.blocked} plain />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-fg-subtle">
        Ranked by (1) declared dependencies broken, (2) unknown-impact flows, (3) actions, (4) flows blocked, (5) action
        ids. Exact search evaluated{' '}
        <Num metric="subsetsEvaluated" value={report.subsets_evaluated} /> subsets;{' '}
        <Num metric="feasiblePlans" value={report.feasible_plans} /> feasible.
      </p>
    </div>
  );
}

function NoPlan({ report, flows, chains }: { report: PlanReportView; flows: Record<string, FlowRef>; chains: readonly ChainView[] }) {
  const partial = report.best_partial;
  const total = report.chains.length;
  const covered = partial?.covered.length ?? 0;
  const tone = TONE_CLASS[describeStatus('NO_FEASIBLE_PLAN_WITHIN_K').tone];
  return (
    <div className={cn('space-y-3 rounded-lg border px-3.5 py-3', tone.border, tone.bg)}>
      <div className="flex items-start gap-2">
        <OctagonX className={cn('mt-0.5 size-4 shrink-0', tone.text)} aria-hidden />
        <div>
          <div className={cn('text-ui font-semibold', tone.text)}>No safe plan within 3 changes</div>
          <p className="mt-0.5 text-ui text-fg-muted">
            No plan of ≤ <Num metric="maxPlanActions" value={report.k} /> allowed policy changes closes every modelled
            path. Best partial plan closes <Num metric="chainsCovered" value={covered} /> of{' '}
            <Num metric="constraintChains" value={total} />.
          </p>
          {report.no_plan_reason ? (
            <p className="mt-1 text-2xs text-fg-subtle">
              <span className="font-mono">{report.no_plan_reason}</span>: {reasonText(report.no_plan_reason)}
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-2xs text-fg-muted">No certificate is issued for this result, and nothing is called contained.</p>
      {partial ? (
        <div className="space-y-2">
          <div className="section-label">Best partial plan</div>
          {partial.actions.map((action) => (
            <ActionCard key={action.id} action={action} flows={flows} compact />
          ))}
          <ChainGroup title="Covered" ids={partial.covered} chains={chains} tone="violet" />
        </div>
      ) : null}
      <ChainGroup title="Still uncovered" ids={report.uncovered} chains={chains} tone="orange" />
    </div>
  );
}

export function ChainGroup({
  title,
  ids,
  chains,
  tone,
}: {
  title: string;
  ids: string[];
  chains: readonly ChainView[];
  tone: 'red' | 'orange' | 'violet' | 'grey';
}) {
  if (ids.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="section-label">
        {title} (<Num metric="constraintChains" value={ids.length} plain />)
      </div>
      <ul className="space-y-1.5">
        {ids.map((id) => {
          const chain = chains.find((c) => c.id === id);
          return (
            <li key={id}>
              {chain ? <PathChips path={chain.path} tone={tone} size="xs" /> : null}
              <div className="mt-0.5 break-all font-mono text-[10.5px] text-fg-subtle">{id}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface PlanReportProps {
  report: PlanReportView;
  flows: Record<string, FlowRef>;
  chains: readonly ChainView[];
  /** True for the Hunter-verified final plan; the initial plan is only claimed to cut its chains. */
  verified: boolean;
}

/** A plan report (§7.7): best plan, impact, actions, alternatives, or the honest no-plan cases. */
export function PlanReport({ report, flows, chains, verified }: PlanReportProps) {
  const targets = targetsOf(report, chains);

  if (report.status === 'NO_FEASIBLE_PLAN_WITHIN_K') {
    return <NoPlan report={report} flows={flows} chains={chains} />;
  }

  if (report.status === 'PLANNING_INCONCLUSIVE') {
    return (
      <div className="space-y-3">
        <Banner tone="yellow" title="Not enough fresh evidence to plan" role="alert">
          <span className="font-mono text-2xs">{report.inconclusive_reason}</span>: {reasonText(report.inconclusive_reason)}.
          Planning fails closed: no plan is offered as optimal and no certificate can follow.
        </Banner>
        {report.plan ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Tag mono>NOT_EXACT</Tag>
              <span className="text-2xs text-fg-muted">Heuristic plan shown for the Hunter to verify; never optimal.</span>
            </div>
            {report.plan.actions.map((action) => (
              <ActionCard key={action.id} action={action} flows={flows} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const plan = report.plan;
  if (!plan) {
    return <p className="text-ui text-fg-muted">The planner returned no plan.</p>;
  }

  if (plan.actions.length === 0) {
    return (
      <div className="space-y-2 rounded-lg border border-line bg-canvas px-3.5 py-3">
        <div className="flex items-center gap-2">
          <StatusBadge status="PLAN_FOUND" size="sm" />
          <Tag mono>{plan.id}</Tag>
        </div>
        <p className="text-ui text-fg">No chain within the planner’s 3-hop bound, so there is nothing for it to cut.</p>
        <p className="text-2xs text-fg-muted">
          The empty plan is not a verdict. The Path Hunter searches without the hop limit and decides whether anything
          reaches {targets.join(', ') || 'the target'}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={report.status} size="sm" />
        <Optimality value={report.optimality} />
        <StatusBadge status={plan.impact_status} knownBroken={plan.known_broken.length} size="sm" tooltip />
        <span className="ml-auto font-mono text-2xs text-fg-subtle">{plan.id}</span>
      </div>
      <ImpactSentence plan={plan} flows={flows} targets={targets} verified={verified} chainCount={report.chains.length} />
      <PlanMetrics plan={plan} total={report.chains.length} />
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <StatusIcon name="scissors" className="text-violet-400" />
          <div className="section-label">
            <Num metric="planActions" value={plan.actions.length} plain /> proposed {plural(plan.actions.length, 'change')}
          </div>
        </div>
        {plan.actions.map((action) => (
          <ActionCard key={action.id} action={action} flows={flows} />
        ))}
      </div>
      <div className="space-y-2.5">
        <NamedFlows title="Declared dependencies broken (synthetic fixture)" ids={plan.known_broken} flows={flows} />
        <NamedFlows title="Blocked flows with unknown impact" ids={plan.unknown} flows={flows} tone="yellow" />
        <Disclosure summary="Every blocked flow">
          <NamedFlows title="Flows blocked" ids={plan.blocked} flows={flows} />
        </Disclosure>
      </div>
      <Comparison report={report} flows={flows} />
      {report.ineligible.length > 0 ? (
        <div className="space-y-1">
          <div className="section-label">Ineligible selectors</div>
          <ul className="space-y-1 text-2xs text-fg-muted">
            {report.ineligible.map((item) => (
              <li key={`${item.namespace}/${item.app}`}>
                <span className="font-mono text-fg">
                  {item.namespace}/app={item.app}
                </span>
                : {reasonText(item.reason)}
                {item.policies.length > 0 ? ` (${item.policies.join(', ')})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Disclosure summary="Action catalogue (every candidate action)">
        <ul className="space-y-1.5">
          {report.catalogue.map((action) => (
            <li key={action.id} className="rounded border border-line bg-canvas px-2.5 py-1.5 text-2xs">
              <div className="break-all font-mono text-[11.5px] text-fg">{action.id}</div>
              <div className="text-fg-muted">
                blocks <Num metric="flowsBlocked" value={action.blocked.length} plain /> · cuts{' '}
                <Num metric="stepsRemoved" value={action.removed_steps.length} plain /> · breaks{' '}
                <Num metric="declaredBroken" value={action.known_broken.length} plain /> · unknown{' '}
                <Num metric="unknownImpact" value={action.unknown.length} plain />
              </div>
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}
