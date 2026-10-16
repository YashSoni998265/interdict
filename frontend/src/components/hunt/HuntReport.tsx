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

function Method({ letter, title, subtitle, children }: { letter: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-canvas px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded border border-line-strong bg-elevated font-mono text-2xs font-semibold text-fg">
          {letter}
        </span>
        <span className="truncate text-2xs font-medium text-fg">{title}</span>
      </div>
      <div className="mt-0.5 text-[10.5px] leading-[14px] text-fg-subtle">{subtitle}</div>
      <div className="mt-1.5 space-y-0.5 text-2xs text-fg-muted">{children}</div>
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
        'rounded-lg border bg-surface',
        verified ? 'border-emerald-500/30' : round.residuals.length > 0 ? 'border-orange-500/30' : 'border-line',
        selected && 'ring-1 ring-accent/60',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-ui font-semibold text-fg">Round {round.round}</span>
        <span className="font-mono text-2xs text-fg-subtle">{round.plan_id}</span>
        <span className="text-2xs text-fg-muted">
          · <Num metric="planActions" value={round.action_ids.length} /> {plural(round.action_ids.length, 'action')}
        </span>
        {onSelect ? (
          <Button size="xs" variant={selected ? 'secondary' : 'ghost'} className="ml-auto" onClick={onSelect} aria-pressed={selected}>
            <Eye aria-hidden />
            {selected ? 'Shown in graph' : 'Show in graph'}
          </Button>
        ) : null}
      </div>

      <div className="space-y-2.5 px-3 py-2.5">
        <div className="grid gap-x-3 gap-y-1 text-2xs sm:grid-cols-[6.5rem_1fr]">
          <div className="text-fg-subtle">Policies applied</div>
          <div className="space-y-px font-mono text-[11px] text-violet-300">
            {round.action_ids.length === 0 ? <span className="font-sans text-fg-muted">none (empty plan)</span> : null}
            {round.action_ids.map((id) => (
              <div key={id} className="break-all">
                {id}
              </div>
            ))}
          </div>
          <div className="text-fg-subtle">Pruned flows</div>
          <div className="space-y-px">
            {round.pruned.length === 0 ? <span className="text-fg-muted">none</span> : null}
            {round.pruned.map((id) => (
              <div key={id} className="font-mono text-[11px] text-fg" title={id}>
                <span className="line-through decoration-violet-400/70">{describeFlow(id, flows)}</span>
              </div>
            ))}
          </div>
          <div className="text-fg-subtle">Candidate graph</div>
          <div className="text-fg-muted">
            <Num metric="attackSteps" value={round.attack_steps} className="text-fg" /> ATTACK_STEP edges after the
            policies
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Method letter="E" title="Bounded enumerator" subtitle="Cypher over base evidence, ≤ 3 hops">
            <div>
              <Num metric="eChains" value={round.e_chains.length} className="text-fg" /> chains to T_scope
            </div>
            <div>
              <Num metric="methodLatency" value={round.latency_ms.E} format="ms" />
            </div>
          </Method>
          <Method letter="F" title="FalkorDB max-flow" subtitle="algo.maxFlow per crown jewel">
            {Object.entries(round.f_values)
              .sort(([a], [b]) => Number(scope.has(b)) - Number(scope.has(a)) || a.localeCompare(b))
              .map(([target, value]) => (
                <div key={target} className={cn('flex items-baseline justify-between gap-2', !scope.has(target) && 'opacity-70')}>
                  <span className="truncate font-mono text-[11px]" title={target}>
                    {target}
                  </span>
                  <span className="shrink-0">
                    <Num metric="maxFlow" value={value} className={scope.has(target) ? 'font-semibold text-fg' : ''} />
                    {!scope.has(target) ? <span className="ml-1 text-[10px] text-fg-subtle">out of scope</span> : null}
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
                <span className="text-orange-300">reaches {inScopeReached.join(', ')}</span>
              )}
            </div>
            {round.o_reachable.filter((t) => !scope.has(t)).length > 0 ? (
              <div className="opacity-70">
                also {round.o_reachable.filter((t) => !scope.has(t)).join(', ')} (out of scope)
              </div>
            ) : null}
            <div>
              <Num metric="methodLatency" value={round.latency_ms.O} format="ms" />
            </div>
          </Method>
        </div>

        {round.residuals.length > 0 ? (
          <div className="space-y-1.5 rounded-md border border-orange-500/30 bg-orange-500/[0.06] px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-2xs font-medium text-orange-300">
              <Split className="size-3.5" aria-hidden />
              <Num metric="residuals" value={round.residuals.length} className="text-orange-200" /> surviving{' '}
              {plural(round.residuals.length, 'path')}: added to the constraint set{last ? '' : ', then re-planned'}
            </div>
            <ul className="space-y-1.5">
              {round.residuals.map((id) => {
                const chain = chains.find((c) => c.id === id);
                return (
                  <li key={id}>
                    {chain ? <PathChips path={chain.path} tone="orange" size="xs" /> : null}
                    <div className="mt-0.5 break-all font-mono text-[10.5px] text-fg-subtle">{id}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : verified ? (
          <p className="text-2xs text-emerald-300">
            No path reaches {hunt.t_scope.join(', ')}: E found 0 chains, F is 0 and O reaches nothing in scope. The three
            methods agree.
          </p>
        ) : null}

        {round.out_of_scope.length > 0 ? (
          <div className="space-y-1 text-2xs text-fg-muted">
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

        <div className="text-2xs text-fg-subtle">
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={hunt.status} reason={hunt.reason} hasCertificate={Boolean(hunt.certificate)} tooltip />
        <span className="text-2xs text-fg-muted">
          T_scope{' '}
          {hunt.t_scope.map((t) => (
            <Tag key={t} mono className="ml-0.5">
              {t}
            </Tag>
          ))}
        </span>
        <span className="ml-auto text-2xs text-fg-muted">
          <Num metric="huntRoundsRun" value={rounds.length} className="text-fg" />{' '}
          of at most <Num metric="maxHuntRounds" value={5} /> rounds
        </span>
      </div>

      {hunt.status === 'SIMULATION_INCONCLUSIVE' ? (
        <Banner tone="yellow" title="Not enough fresh evidence to verify" role="alert">
          <span className="font-mono text-2xs">{hunt.reason}</span>: {reasonText(hunt.reason)}.
          {hunt.detail ? <span className="mt-1 block font-mono text-2xs text-fg">{hunt.detail}</span> : null}
          <span className="mt-1 block">Never treated as safe: no certificate is issued.</span>
        </Banner>
      ) : null}
      {hunt.status === 'SIMULATED_RESIDUAL_EXPOSURE' ? (
        <Banner tone="orange" icon={Split} title="Partly fixed: paths remain">
          After the last allowed round these paths still reach the target. No certificate is issued.
          <div className="mt-2 space-y-1.5">
            {hunt.residual_paths.map((path) => (
              <PathChips key={path.join('>')} path={path} tone="orange" size="xs" />
            ))}
          </div>
        </Banner>
      ) : null}
      {hunt.status === 'NO_FEASIBLE_PLAN_WITHIN_K' || hunt.status === 'PLANNING_INCONCLUSIVE' ? (
        <p className="text-2xs text-fg-muted">
          {rounds.length > 0
            ? `After round ${rounds.length - 1}, re-planning with the surviving paths found no acceptable plan, so the hunt stops without a certificate.`
            : 'The planner found no acceptable plan, so there was nothing to verify.'}
        </p>
      ) : null}

      {replanned > 0 ? (
        <p className="text-2xs leading-4 text-fg-muted">
          Round 0 tested the plan for the cluster’s own chains. Searching with no hop limit, the Hunter found{' '}
          <Num metric="residuals" value={replanned} className="text-fg" /> surviving{' '}
          {plural(replanned, 'path')}, added {replanned === 1 ? 'it' : 'them'} to the constraint set and re-planned.
        </p>
      ) : null}

      <ol className="space-y-2" aria-label="Path Hunter rounds">
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
        <p className="text-2xs text-fg-subtle">
          Out-of-scope residuals reported with this hunt: {hunt.out_of_scope_residuals.join(', ')}.
        </p>
      ) : null}

      <Disclosure summary="Show graph proof: every query in this hunt">
        <QueryList queries={hunt.queries} />
      </Disclosure>
    </div>
  );
}
