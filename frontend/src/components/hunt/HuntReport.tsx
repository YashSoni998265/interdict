import { Eye, Split } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ChainView, FlowRef, HuntReportView, HuntRoundView } from '@/api/types';
import { cn } from '@/lib/cn';
import { describeFlow, plural } from '@/lib/format';
import { reasonText } from '@/lib/status';

import { Num } from '../Num';
import { PathChips } from '../PathChips';
import { QueryList } from '../QueryList';
import { StatusBadge } from '../StatusBadge';
import { Banner } from '../states';
import { Button } from '../ui/button';
import { Disclosure } from '../ui/disclosure';
import { Tag } from '../ui/tag';
import './HuntReport.css';

function Method({ letter, title, subtitle, children }: { letter: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="method">
      <div className="method__row">
        <span className="method__chip">
          {letter}
        </span>
        <span className="method__label">{title}</span>
      </div>
      <div className="method__block">{subtitle}</div>
      <div className="method__block-2">{children}</div>
    </div>
  );
}

function RoundCard({
  round,
  hunt,
  flows,
  last,
  selected,
  onSelect,
}: {
  round: HuntRoundView;
  hunt: HuntReportView;
  flows: Record<string, FlowRef>;
  last: boolean;
  selected: boolean;
  onSelect?: (() => void) | undefined;
}) {
  const scope = new Set(hunt.t_scope);
  const verified = last && hunt.status === 'SIMULATED_CONTAINMENT' && hunt.certificate !== null;
  const inScopeReached = round.o_reachable.filter((t) => scope.has(t));
  const chains: ChainView[] = hunt.chains;

  return (
    <li
      className={cn(
        'round-card',
        verified ? 'round-card--verified' : round.residuals.length > 0 ? 'round-card--length' : 'round-card--not-length',
        selected && 'round-card--selected',
      )}
    >
      <div className="round-card__row">
        <span className="round-card__label">Round {round.round}</span>
        <span className="round-card__label-2">{round.plan_id}</span>
        <span className="round-card__label-3">
          · <Num metric="planActions" value={round.action_ids.length} /> {plural(round.action_ids.length, 'action')}
        </span>
        {onSelect ? (
          <Button size="xs" variant={selected ? 'secondary' : 'ghost'} className="round-card__button" onClick={onSelect} aria-pressed={selected}>
            <Eye aria-hidden />
            {selected ? 'Shown in graph' : 'Show in graph'}
          </Button>
        ) : null}
      </div>

      <div className="round-card__block">
        <div className="round-card__grid">
          <div className="round-card__block-2">Policies applied</div>
          <div className="round-card__block-3">
            {round.action_ids.length === 0 ? <span className="round-card__label-4">none (empty plan)</span> : null}
            {round.action_ids.map((id) => (
              <div key={id} className="round-card-2">
                {id}
              </div>
            ))}
          </div>
          <div className="round-card__block-2">Pruned flows</div>
          <div className="round-card__block-4">
            {round.pruned.length === 0 ? <span className="round-card__label-5">none</span> : null}
            {round.pruned.map((id) => (
              <div key={id} className="round-card-3" title={id}>
                <span className="round-card__label-6">{describeFlow(id, flows)}</span>
              </div>
            ))}
          </div>
          <div className="round-card__block-2">Candidate graph</div>
          <div className="round-card__block-5">
            <Num metric="attackSteps" value={round.attack_steps} className="round-card__num" /> ATTACK_STEP edges after the
            policies
          </div>
        </div>

        <div className="round-card__grid-2">
          <Method letter="E" title="Bounded enumerator" subtitle="Cypher over base evidence, ≤ 3 hops">
            <div>
              <Num metric="eChains" value={round.e_chains.length} className="round-card__num" /> chains to T_scope
            </div>
            <div>
              <Num metric="methodLatency" value={round.latency_ms.E} format="ms" />
            </div>
          </Method>
          <Method letter="F" title="FalkorDB max-flow" subtitle="algo.maxFlow per crown jewel">
            {Object.entries(round.f_values)
              .sort(([a], [b]) => Number(scope.has(b)) - Number(scope.has(a)) || a.localeCompare(b))
              .map(([target, value]) => (
                <div key={target} className={cn('round-card-4', !scope.has(target) && 'round-card--not-has')}>
                  <span className="round-card__label-7" title={target}>
                    {target}
                  </span>
                  <span className="round-card__label-8">
                    <Num metric="maxFlow" value={value} className={scope.has(target) ? 'round-card__num--has' : ''} />
                    {!scope.has(target) ? <span className="round-card__label-9">out of scope</span> : null}
                  </span>
                </div>
              ))}
            <div>
              <Num metric="methodLatency" value={round.latency_ms.F} format="ms" />
            </div>
          </Method>
          <Method letter="O" title="Oracle search" subtitle="Separate BFS over exported edges">
            <div>
              {inScopeReached.length === 0 ? (
                <span>reaches nothing in T_scope</span>
              ) : (
                <span className="round-card__label-10">reaches {inScopeReached.join(', ')}</span>
              )}
            </div>
            {round.o_reachable.filter((t) => !scope.has(t)).length > 0 ? (
              <div className="round-card__block-6">
                also {round.o_reachable.filter((t) => !scope.has(t)).join(', ')} (out of scope)
              </div>
            ) : null}
            <div>
              <Num metric="methodLatency" value={round.latency_ms.O} format="ms" />
            </div>
          </Method>
        </div>

        {round.residuals.length > 0 ? (
          <div className="round-card__box">
            <div className="round-card__row-2">
              <Split className="round-card__icon" aria-hidden />
              <Num metric="residuals" value={round.residuals.length} className="round-card__num-2" /> surviving{' '}
              {plural(round.residuals.length, 'path')}: added to the constraint set{last ? '' : ', then re-planned'}
            </div>
            <ul className="round-card__list">
              {round.residuals.map((id) => {
                const chain = chains.find((c) => c.id === id);
                return (
                  <li key={id}>
                    {chain ? <PathChips path={chain.path} tone="orange" size="xs" /> : null}
                    <div className="round-card__block-7">{id}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : verified ? (
          <p className="round-card__text">
            No path reaches {hunt.t_scope.join(', ')}: E found 0 chains, F is 0 and O reaches nothing in scope. The three
            methods agree.
          </p>
        ) : null}

        {round.out_of_scope.length > 0 ? (
          <div className="round-card__block-8">
            <div>
              Out of scope, reported only (does not block a certificate for {hunt.t_scope.join(', ')}):
            </div>
            {round.out_of_scope.map((target) =>
              round.witnesses[target] ? (
                <PathChips key={target} path={round.witnesses[target]} tone="grey" size="xs" />
              ) : (
                <Tag key={target} mono>
                  {target}
                </Tag>
              ),
            )}
          </div>
        ) : null}

        <div className="round-card__block-9">
          Round time <Num metric="roundLatency" value={round.latency_ms.round} format="ms" /> (copy, apply, rebuild, E/F/O)
        </div>
      </div>
    </li>
  );
}

export function HuntReport({
  hunt,
  flows,
  selectedRound,
  onSelectRound,
}: {
  hunt: HuntReportView;
  flows: Record<string, FlowRef>;
  selectedRound?: number | null;
  onSelectRound?: (round: number) => void;
}) {
  const rounds = hunt.rounds;
  const first = rounds[0];
  const replanned = rounds.length > 1 && first ? first.residuals.length : 0;

  return (
    <div className="hunt-report">
      <div className="hunt-report__row">
        <StatusBadge status={hunt.status} reason={hunt.reason} hasCertificate={Boolean(hunt.certificate)} tooltip />
        <span className="hunt-report__label">
          T_scope{' '}
          {hunt.t_scope.map((t) => (
            <Tag key={t} mono className="hunt-report-2">
              {t}
            </Tag>
          ))}
        </span>
        <span className="hunt-report__label-2">
          <Num metric="huntRoundsRun" value={rounds.length} className="hunt-report__num" />{' '}
          of at most <Num metric="maxHuntRounds" value={5} /> rounds
        </span>
      </div>

      {hunt.status === 'SIMULATION_INCONCLUSIVE' ? (
        <Banner tone="yellow" title="Not enough fresh evidence to verify" role="alert">
          <span className="hunt-report__label-3">{hunt.reason}</span>: {reasonText(hunt.reason)}.
          {hunt.detail ? <span className="hunt-report__label-4">{hunt.detail}</span> : null}
          <span className="hunt-report__label-5">Never treated as safe: no certificate is issued.</span>
        </Banner>
      ) : null}
      {hunt.status === 'SIMULATED_RESIDUAL_EXPOSURE' ? (
        <Banner tone="orange" icon={Split} title="Partly fixed: paths remain">
          After the last allowed round these paths still reach the target. No certificate is issued.
          <div className="hunt-report__block">
            {hunt.residual_paths.map((path) => (
              <PathChips key={path.join('>')} path={path} tone="orange" size="xs" />
            ))}
          </div>
        </Banner>
      ) : null}
      {hunt.status === 'NO_FEASIBLE_PLAN_WITHIN_K' || hunt.status === 'PLANNING_INCONCLUSIVE' ? (
        <p className="hunt-report__text">
          {rounds.length > 0
            ? `After round ${rounds.length - 1}, re-planning with the surviving paths found no acceptable plan, so the hunt stops without a certificate.`
            : 'The planner found no acceptable plan, so there was nothing to verify.'}
        </p>
      ) : null}

      {replanned > 0 ? (
        <p className="hunt-report__text-2">
          Round 0 tested the plan for the cluster’s own chains. Searching with no hop limit, the Hunter found{' '}
          <Num metric="residuals" value={replanned} className="hunt-report__num" /> surviving{' '}
          {plural(replanned, 'path')}, added {replanned === 1 ? 'it' : 'them'} to the constraint set and re-planned.
        </p>
      ) : null}

      <ol className="hunt-report__list" aria-label="Path Hunter rounds">
        {rounds.map((round, index) => (
          <RoundCard
            key={round.round}
            round={round}
            hunt={hunt}
            flows={flows}
            last={index === rounds.length - 1}
            selected={selectedRound === round.round}
            onSelect={onSelectRound ? () => onSelectRound(round.round) : undefined}
          />
        ))}
      </ol>

      {hunt.out_of_scope_residuals.length > 0 ? (
        <p className="hunt-report__text-3">
          Out-of-scope residuals reported with this hunt: {hunt.out_of_scope_residuals.join(', ')}.
        </p>
      ) : null}

      <Disclosure summary="Show graph proof: every query in this hunt">
        <QueryList queries={hunt.queries} />
      </Disclosure>
    </div>
  );
}
