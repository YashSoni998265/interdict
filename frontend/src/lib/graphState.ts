/**
 * Graph overlays: how each attack step is drawn before the fix, under the initial plan, and in
 * each Path Hunter round. Every mark comes from engine output (the plan's removed steps, the
 * edge's cut_by, the round's residual chain ids); nothing here searches the graph.
 */
import type { ChainView, HuntReportView, PlanView, SubgraphEdgeView, SubgraphView } from '@/api/types';

/**
 * active   – a modelled attack step (crimson)
 * cut      – removed by the overlay's plan (violet, dashed, scissors)
 * residual – on a chain the Hunter reported as surviving (orange)
 * cleared  – not cut, but on no reported surviving path (muted)
 */
export type EdgeState = 'active' | 'cut' | 'residual' | 'cleared';

export interface Overlay {
  id: string;
  label: string;
  /** Short description for the overlay picker. */
  hint: string;
  kind: 'baseline' | 'plan' | 'round';
  round?: number;
  planId?: string;
  /** Edge ids removed by this overlay's plan. */
  cut: ReadonlySet<string>;
  /** Edge ids on surviving chains in this overlay. */
  residual: ReadonlySet<string>;
  /** True when the Hunter reported no surviving path (E, F and O agree on zero). */
  verified: boolean;
  /** Whether unmarked edges are known to lie on no reported surviving path. */
  residualsKnown: boolean;
}

export const edgeKey = (source: string, target: string) => `${source}->${target}`;

function pathEdges(path: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < path.length; i++) out.push(edgeKey(path[i]!, path[i + 1]!));
  return out;
}

/** Edge ids a plan removes: its actions' removed steps that appear in the subgraph. */
export function planCuts(subgraph: SubgraphView, plan: PlanView | null | undefined): Set<string> {
  const ids = new Set(subgraph.edges.map((e) => e.id));
  const cut = new Set<string>();
  for (const action of plan?.actions ?? []) {
    for (const [src, dst] of action.removed_steps) {
      const id = edgeKey(src, dst);
      if (ids.has(id)) cut.add(id);
    }
  }
  return cut;
}

/** Fallback when a round's plan view is not at hand: the verified plan's cut_by marks. */
function cutsByActionIds(subgraph: SubgraphView, actionIds: readonly string[]): Set<string> {
  const wanted = new Set(actionIds);
  return new Set(subgraph.edges.filter((e) => e.cut_by.some((a) => wanted.has(a))).map((e) => e.id));
}

function residualEdges(subgraph: SubgraphView, chainIds: readonly string[], chains: readonly ChainView[]): Set<string> {
  const ids = new Set(subgraph.edges.map((e) => e.id));
  const out = new Set<string>();
  for (const chainId of chainIds) {
    const chain = chains.find((c) => c.id === chainId);
    if (!chain) continue;
    for (const id of pathEdges(chain.path)) if (ids.has(id)) out.add(id);
  }
  return out;
}

const BASELINE: Overlay = {
  id: 'baseline',
  label: 'Before the fix',
  hint: 'Every modelled attack step',
  kind: 'baseline',
  cut: new Set(),
  residual: new Set(),
  verified: false,
  residualsKnown: false,
};

export interface OverlayInputs {
  subgraph: SubgraphView;
  /** The initial plan for the cluster's own chains (plan_remediation). */
  initialPlan?: PlanView | null | undefined;
  hunt?: HuntReportView | undefined;
}

export function deriveOverlays({ subgraph, initialPlan, hunt }: OverlayInputs): Overlay[] {
  const overlays: Overlay[] = [BASELINE];
  const knownPlans = new Map<string, PlanView>();
  for (const plan of [initialPlan, hunt?.plan?.plan, ...(hunt?.plan?.alternatives ?? [])]) {
    if (plan) knownPlans.set(plan.id, plan);
  }

  if (!hunt || hunt.rounds.length === 0) {
    if (initialPlan && initialPlan.actions.length > 0) {
      overlays.push({
        id: `plan:${initialPlan.id}`,
        label: 'Proposed plan',
        hint: 'Not yet verified by the Path Hunter',
        kind: 'plan',
        planId: initialPlan.id,
        cut: planCuts(subgraph, initialPlan),
        residual: new Set(),
        verified: false,
        residualsKnown: false,
      });
    }
    return overlays;
  }

  const last = hunt.rounds.length - 1;
  hunt.rounds.forEach((round, index) => {
    const plan = knownPlans.get(round.plan_id);
    const cut = plan ? planCuts(subgraph, plan) : cutsByActionIds(subgraph, round.action_ids);
    const verified =
      index === last && hunt.status === 'SIMULATED_CONTAINMENT' && hunt.certificate !== null;
    overlays.push({
      id: `round:${round.round}`,
      label: `Round ${round.round}`,
      hint: verified
        ? 'Verified: no modelled path survives'
        : round.residuals.length > 0
          ? `${round.residuals.length} surviving ${round.residuals.length === 1 ? 'path' : 'paths'}`
          : 'Hunter round',
      kind: 'round',
      round: round.round,
      planId: round.plan_id,
      cut,
      residual: residualEdges(subgraph, round.residuals, hunt.chains),
      verified,
      residualsKnown: true,
    });
  });
  return overlays;
}

export function edgeState(edge: SubgraphEdgeView, overlay: Overlay): EdgeState {
  if (overlay.kind === 'baseline') return 'active';
  if (overlay.cut.has(edge.id)) return 'cut';
  if (overlay.residual.has(edge.id)) return 'residual';
  return overlay.residualsKnown ? 'cleared' : 'active';
}

/** The overlay to show by default: the latest round once the Hunter has run. */
export function defaultOverlay(overlays: readonly Overlay[]): Overlay {
  return overlays.at(-1) ?? BASELINE;
}
