import type { FlowRef, HuntReportView, PlanReportView, PlanView } from '@/api/types';

/**
 * The handle POST /api/hunts expects. The API returns it as the top-level `plan_id`; the
 * recorded fixtures predate it, so fall back to the engine's `plan.id` there.
 */
export function planHandle(report: PlanReportView | undefined | null): string | null {
  if (report?.status !== 'PLAN_FOUND') return null;
  return report.plan_id ?? report.plan?.id ?? null;
}

/** The plan handle a subgraph should be drawn for once a hunt has run. */
export function huntPlanHandle(
  hunt: HuntReportView | undefined,
  initial: PlanReportView | undefined,
): string | null {
  return hunt?.plan_id ?? planHandle(initial) ?? hunt?.rounds[0]?.plan_id ?? null;
}

/** Every flow id named by any plan report at hand (initial and final), for display names. */
export function mergeFlows(...reports: (PlanReportView | null | undefined)[]): Record<string, FlowRef> {
  return Object.assign({}, ...reports.map((r) => r?.flows ?? {})) as Record<string, FlowRef>;
}

/** Workloads named by a set of flow ids, e.g. "analytics-1" for its unknown-impact flows. */
export function flowSources(ids: readonly string[], flows: Record<string, FlowRef>): string[] {
  return [...new Set(ids.map((id) => flows[id]?.src).filter((s): s is string => Boolean(s)))].sort();
}

export function isEmptyPlan(plan: PlanView | null | undefined): boolean {
  return !plan || plan.actions.length === 0;
}
