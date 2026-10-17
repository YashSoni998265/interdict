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
import './PlanReport.css';

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
    <p className="impact-sentence">
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
          <span className="impact-sentence__label">
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
    <dl className="plan-metrics">
      {cells.map((cell) => (
        <div key={cell.label} className="plan-metrics-2">
          <dt className="plan-metrics__term">{cell.label}</dt>
          <dd className="plan-metrics__value">{cell.node}</dd>
        </div>
      ))}
    </dl>
  );
}

function NamedFlows({ title, ids, flows, tone }: { title: string; ids: string[]; flows: Record<string, FlowRef>; tone?: 'yellow' }) {
  if (ids.length === 0) return null;
  return (
    <div>
      <div className="section-label named-flows__block">{title}</div>
      <ul className="named-flows__list">
        {ids.map((id) => (
          <li key={id} className="named-flows">
            <span className={cn('named-flows__label', tone === 'yellow' ? 'named-flows__label--yellow' : 'named-flows__label--not-yellow')}>
              {describeFlow(id, flows)}
            </span>
            <span className="named-flows__label-2">{id}</span>
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
      <button type="button" className="optimality__button">
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
    <div className="comparison">
      <div className="comparison__row">
        <ListOrdered className="comparison__icon" aria-hidden />
        <div className="section-label">Compared plans</div>
      </div>
      <div className="comparison__box">
        <table className="comparison__table">
          <caption className="sr-only">
            Plans ranked by declared dependencies broken, then unknown-impact flows, then actions, then flows blocked.
          </caption>
          <thead className="comparison__head">
            <tr>
              <th scope="col" className="comparison__heading-cell">Plan</th>
              <th scope="col" className="comparison__heading-cell-2">Broken</th>
              <th scope="col" className="comparison__heading-cell-2">Unknown</th>
              <th scope="col" className="comparison__heading-cell-2">Actions</th>
              <th scope="col" className="comparison__heading-cell-2">Blocked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ plan, label, best: isBest }) => (
              <tr key={`${label}-${plan.id}`} className={cn('comparison-2', isBest && 'comparison--best')}>
                <td className="comparison__cell">
                  <div className="comparison__row-2">
                    <span className={cn('comparison__label', isBest ? 'comparison__label--best' : 'comparison__label--not-best')}>{label}</span>
                    {plan.id === hard?.id && label !== 'Hard isolation' ? <Tag>hard isolation</Tag> : null}
                  </div>
                  <div className="comparison__block">
                    {plan.action_ids.map((id) => (
                      <div key={id} className="comparison-3">
                        {id}
                      </div>
                    ))}
                  </div>
                  {plan.known_broken.length > 0 ? (
                    <div className="comparison__block-2">
                      breaks {plan.known_broken.map((id) => describeFlow(id, flows)).join('; ')}
                    </div>
                  ) : null}
                </td>
                <td className="comparison__cell-2">
                  <Num metric="declaredBroken" value={plan.objective.known_broken} plain />
                </td>
                <td className="comparison__cell-2">
                  <Num metric="unknownImpact" value={plan.objective.unknown} plain />
                </td>
                <td className="comparison__cell-2">
                  <Num metric="planActions" value={plan.objective.actions} plain />
                </td>
                <td className="comparison__cell-2">
                  <Num metric="flowsBlocked" value={plan.objective.blocked} plain />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="comparison__text">
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
    <div className={cn('no-plan', tone.border, tone.bg)}>
      <div className="no-plan__row">
        <OctagonX className={cn('no-plan__icon', tone.text)} aria-hidden />
        <div>
          <div className={cn('no-plan__block', tone.text)}>No safe plan within 3 changes</div>
          <p className="no-plan__text">
            No plan of ≤ <Num metric="maxPlanActions" value={report.k} /> allowed policy changes closes every modelled
            path. Best partial plan closes <Num metric="chainsCovered" value={covered} /> of{' '}
            <Num metric="constraintChains" value={total} />.
          </p>
          {report.no_plan_reason ? (
            <p className="no-plan__text-2">
              <span className="no-plan__label">{report.no_plan_reason}</span>: {reasonText(report.no_plan_reason)}
            </p>
          ) : null}
        </div>
      </div>
      <p className="no-plan__text-3">No certificate is issued for this result, and nothing is called contained.</p>
      {partial ? (
        <div className="no-plan__block-2">
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
    <div className="chain-group">
      <div className="section-label">
        {title} (<Num metric="constraintChains" value={ids.length} plain />)
      </div>
      <ul className="chain-group__list">
        {ids.map((id) => {
          const chain = chains.find((c) => c.id === id);
          return (
            <li key={id}>
              {chain ? <PathChips path={chain.path} tone={tone} size="xs" /> : null}
              <div className="chain-group__block">{id}</div>
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
      <div className="plan-report">
        <Banner tone="yellow" title="Not enough fresh evidence to plan" role="alert">
          <span className="plan-report__label">{report.inconclusive_reason}</span>: {reasonText(report.inconclusive_reason)}.
          Planning fails closed: no plan is offered as optimal and no certificate can follow.
        </Banner>
        {report.plan ? (
          <div className="plan-report__block">
            <div className="plan-report__row">
              <Tag mono>NOT_EXACT</Tag>
              <span className="plan-report__label-2">Heuristic plan shown for the Hunter to verify; never optimal.</span>
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
    return <p className="plan-report-2">The planner returned no plan.</p>;
  }

  if (plan.actions.length === 0) {
    return (
      <div className="plan-report-3">
        <div className="plan-report__row">
          <StatusBadge status="PLAN_FOUND" size="sm" />
          <Tag mono>{plan.id}</Tag>
        </div>
        <p className="plan-report__text">No chain within the planner’s 3-hop bound, so there is nothing for it to cut.</p>
        <p className="plan-report__text-2">
          The empty plan is not a verdict. The Path Hunter searches without the hop limit and decides whether anything
          reaches {targets.join(', ') || 'the target'}.
        </p>
      </div>
    );
  }

  return (
    <div className="plan-report-4">
      <div className="plan-report__row-2">
        <StatusBadge status={report.status} size="sm" />
        <Optimality value={report.optimality} />
        <StatusBadge status={plan.impact_status} knownBroken={plan.known_broken.length} size="sm" tooltip />
        <span className="plan-report__label-3">{plan.id}</span>
      </div>
      <ImpactSentence plan={plan} flows={flows} targets={targets} verified={verified} chainCount={report.chains.length} />
      <PlanMetrics plan={plan} total={report.chains.length} />
      <div className="plan-report__block">
        <div className="plan-report__row-3">
          <StatusIcon name="scissors" className="plan-report__status-icon" />
          <div className="section-label">
            <Num metric="planActions" value={plan.actions.length} plain /> proposed {plural(plan.actions.length, 'change')}
          </div>
        </div>
        {plan.actions.map((action) => (
          <ActionCard key={action.id} action={action} flows={flows} />
        ))}
      </div>
      <div className="plan-report__block-2">
        <NamedFlows title="Declared dependencies broken (synthetic fixture)" ids={plan.known_broken} flows={flows} />
        <NamedFlows title="Blocked flows with unknown impact" ids={plan.unknown} flows={flows} tone="yellow" />
        <Disclosure summary="Every blocked flow">
          <NamedFlows title="Flows blocked" ids={plan.blocked} flows={flows} />
        </Disclosure>
      </div>
      <Comparison report={report} flows={flows} />
      {report.ineligible.length > 0 ? (
        <div className="plan-report__block-3">
          <div className="section-label">Ineligible selectors</div>
          <ul className="plan-report__list">
            {report.ineligible.map((item) => (
              <li key={`${item.namespace}/${item.app}`}>
                <span className="plan-report__label-4">
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
        <ul className="plan-report__list-2">
          {report.catalogue.map((action) => (
            <li key={action.id} className="plan-report-5">
              <div className="plan-report__block-4">{action.id}</div>
              <div className="plan-report__block-5">
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
