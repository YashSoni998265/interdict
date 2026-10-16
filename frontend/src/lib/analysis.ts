import type { HuntReportView, PlanReportView } from '@/api/types';
import type { DirectResults, RunState } from '@/state/workbench';

import { deriveInvestigation, type DerivedInvestigation } from './investigation';

export interface ClusterAnalysis {
  derived: DerivedInvestigation | null;
  /** The cluster's initial plan (its own chains), from the run or a direct request. */
  plan: PlanReportView | undefined;
  hunt: HuntReportView | undefined;
  source: 'investigation' | 'direct' | null;
  /** Sandbox revision the results were computed for. */
  revision: number | null;
}

/**
 * The newest engine results for a cluster: a direct plan/hunt request replaces the run's,
 * and starting a run clears direct results (state/workbench.ts).
 */
export function clusterAnalysis(run: RunState | undefined, direct: DirectResults | undefined): ClusterAnalysis {
  const derived = run ? deriveInvestigation(run.events) : null;
  const directPlan = direct?.plan?.status === 'success' ? direct.plan.data : undefined;
  const directHunt = direct?.hunt?.status === 'success' ? direct.hunt.data : undefined;
  if (directPlan || directHunt) {
    return {
      derived,
      plan: directPlan,
      hunt: directHunt,
      source: 'direct',
      revision: direct?.hunt?.revision ?? direct?.plan?.revision ?? null,
    };
  }
  return {
    derived,
    plan: derived?.plan,
    hunt: derived?.hunt,
    source: derived?.plan || derived?.hunt ? 'investigation' : null,
    revision: run?.revisionAtStart ?? null,
  };
}
