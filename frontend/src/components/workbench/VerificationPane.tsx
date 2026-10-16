import { ListChecks, Play, Radar } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ChainView, ClusterView } from '@/api/types';
import { useRun, useSandboxState, useServices, useWorkbenchState } from '@/app/services';
import type { ClusterAnalysis } from '@/lib/analysis';
import { mergeFlows, planHandle } from '@/lib/plan';

import { CertificateCard } from '../certificate/CertificateCard';
import { HuntReport } from '../hunt/HuntReport';
import { OutcomeBadge } from '../OutcomeBadge';
import { PlanReport } from '../plan/PlanReport';
import { EmptyState, ErrorState, LoadingState } from '../states';
import { Button } from '../ui/button';
import { Disclosure } from '../ui/disclosure';

import { Pane } from './Pane';

function Section({ title, icon, children, aside }: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2.5" aria-label={title}>
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="section-label">{title}</h3>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function VerificationPane({
  cluster,
  analysis,
  stormChains,
  selectedRound,
  onSelectRound,
}: {
  cluster: ClusterView;
  analysis: ClusterAnalysis;
  stormChains: ChainView[];
  selectedRound: number | null;
  onSelectRound: (round: number) => void;
}) {
  const { workbench } = useServices();
  const run = useRun(cluster.id);
  const direct = useWorkbenchState((s) => s.direct[cluster.id]);
  const revision = useSandboxState((s) => s.revision);
  const { plan, hunt, derived } = analysis;
  const flows = mergeFlows(plan, hunt?.plan);
  const chains = hunt?.chains ?? stormChains;
  const running = run?.phase === 'starting' || run?.phase === 'streaming';
  const handle = planHandle(plan);
  const huntLoading = direct?.hunt?.status === 'loading';
  const planLoading = direct?.plan?.status === 'loading';
  const hunting = running && derived?.currentState === 'HUNTING' && !hunt;

  const computePlan = () => void workbench.computePlan(cluster.id);
  const runHunt = () => {
    if (handle) void workbench.runHunt(cluster.id, handle);
  };
  const rerun = () => void workbench.start(cluster.id, run?.requestedMode ?? 'deterministic');

  const finalPlan = hunt?.plan ?? null;
  const verified = hunt?.status === 'SIMULATED_CONTAINMENT' && Boolean(hunt.certificate);

  return (
    <Pane
      id="pane-verification"
      title="Plan and verification"
      subtitle="Cheapest safe fix, Path Hunter rounds, certificate"
      actions={
        !running && !plan && !hunt ? (
          <Button size="sm" variant="secondary" onClick={computePlan} disabled={planLoading}>
            <ListChecks aria-hidden />
            Compute plan
          </Button>
        ) : !running && plan && !hunt && handle ? (
          <Button size="sm" variant="secondary" onClick={runHunt} disabled={huntLoading}>
            <Radar aria-hidden />
            Run Path Hunter
          </Button>
        ) : null
      }
    >
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-3">
        {hunt ? (
          <div className="space-y-1.5 rounded-lg border border-line bg-surface px-3.5 py-3">
            <div className="section-label">Outcome for {hunt.t_scope.join(', ')}</div>
            <OutcomeBadge hunt={hunt} size="lg" tooltip />
            {revision !== null && hunt.revision < revision ? (
              <p className="text-2xs text-fg-muted">
                Computed at revision {hunt.revision}; the sandbox is now at revision {revision}. Re-run to recompute.
              </p>
            ) : null}
            {analysis.source === 'direct' ? (
              <p className="text-2xs text-fg-subtle">Computed directly over REST (POST /api/plans, POST /api/hunts), without the timeline.</p>
            ) : null}
          </div>
        ) : null}

        {!plan && !hunt && !running && !planLoading && direct?.plan?.status !== 'error' ? (
          <EmptyState
            title="No plan yet"
            icon={ListChecks}
            action={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => void workbench.start(cluster.id, 'deterministic')}>
                  <Play aria-hidden />
                  Investigate
                </Button>
                <Button size="sm" variant="secondary" onClick={computePlan}>
                  Compute plan only
                </Button>
              </div>
            }
          >
            Run the investigation to plan and verify the fix step by step, or call the planner and the Path Hunter
            directly. Both use the same engine.
          </EmptyState>
        ) : null}

        {planLoading ? <LoadingState title="Computing the cheapest safe fix" detail="POST /api/plans · exact search over ≤ 3 actions" /> : null}
        {direct?.plan?.status === 'error' ? (
          <ErrorState error={direct.plan.error} title="The plan could not be computed" onRetry={computePlan} />
        ) : null}
        {running && !plan && !hunt ? (
          <LoadingState
            title="Waiting for the planner"
            detail="plan_remediation runs after triage and the evidence checks"
          />
        ) : null}

        {finalPlan ? (
          <Section
            title={
              verified
                ? revision !== null && hunt && hunt.revision < revision
                  ? `Verified plan (at revision ${hunt.revision}, not current)`
                  : 'Verified plan'
                : 'Final plan'
            }
            icon={<ListChecks className="size-3.5 text-fg-subtle" aria-hidden />}
          >
            <PlanReport report={finalPlan} flows={flows} chains={chains} verified={verified} />
            {plan?.plan && finalPlan.plan && plan.plan.id !== finalPlan.plan.id ? (
              <Disclosure summary="Initial plan (the cluster’s own chains only)" className="pt-1">
                <p className="mb-2 text-2xs text-fg-muted">
                  This was the cheapest plan before the Path Hunter ran. It cut the cluster’s own chains, but the Hunter
                  found other paths to the same target, so the plan was widened.
                </p>
                <PlanReport report={plan} flows={flows} chains={chains} verified={false} />
              </Disclosure>
            ) : null}
          </Section>
        ) : plan ? (
          <Section title="Proposed plan (not yet verified)" icon={<ListChecks className="size-3.5 text-fg-subtle" aria-hidden />}>
            <PlanReport report={plan} flows={flows} chains={chains} verified={false} />
          </Section>
        ) : null}

        {hunt || hunting || huntLoading || direct?.hunt?.status === 'error' ? (
          <Section title="Path Hunter" icon={<Radar className="size-3.5 text-fg-subtle" aria-hidden />}>
            {hunt ? (
              <HuntReport hunt={hunt} flows={flows} selectedRound={selectedRound} onSelectRound={onSelectRound} />
            ) : hunting || huntLoading ? (
              <LoadingState
                title="Hunting for paths that survive the plan"
                detail="Copy the sandbox, apply the policies, rebuild ATTACK_STEP, then run E, F and O"
              />
            ) : direct?.hunt?.status === 'error' ? (
              <ErrorState error={direct.hunt.error} title="The Path Hunter could not run" onRetry={runHunt} />
            ) : null}
          </Section>
        ) : plan && !running ? (
          <Section title="Path Hunter">
            <p className="text-2xs text-fg-muted">
              Not run yet. The plan is only trusted after the Hunter re-checks it on a copy of the graph, with no hop
              limit and over every crown jewel.
            </p>
            {handle ? (
              <Button size="sm" variant="secondary" onClick={runHunt}>
                <Radar aria-hidden />
                Run Path Hunter
              </Button>
            ) : null}
          </Section>
        ) : null}

        {hunt ? (
          <Section title="Certificate">
            <CertificateCard hunt={hunt} onRerun={rerun} rerunDisabled={running} />
          </Section>
        ) : null}
      </div>
    </Pane>
  );
}
