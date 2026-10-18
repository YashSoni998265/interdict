import type { AlertView, ClusterView, StormView } from '@/api/types';

export function clusterOfPod(storm: StormView | undefined, pod: string): ClusterView | undefined {
  return storm?.clusters.find((c) => c.workloads.includes(pod));
}

export interface RestraintExample {
  cve: string;
  onPath: string[];
  notOnPath: string[];
}

/**
 * A vulnerability the engine judged differently on different workloads: on an attack path on
 * one, on no path on another (the "restraint" moment). Pure grouping of the engine's classes.
 */
export function restraintExample(alerts: readonly AlertView[] | undefined): RestraintExample | null {
  if (!alerts) return null;
  const byCve = new Map<string, { onPath: Set<string>; notOnPath: Set<string>; count: number }>();
  for (const alert of alerts) {
    let entry = byCve.get(alert.cve_id);
    if (!entry) {
      entry = { onPath: new Set(), notOnPath: new Set(), count: 0 };
      byCve.set(alert.cve_id, entry);
    }
    entry.count += 1;
    if (alert.triage_class === 'ON_ATTACK_PATH') entry.onPath.add(alert.pod);
    if (alert.triage_class === 'NOT_ON_ATTACK_PATH') entry.notOnPath.add(alert.pod);
  }
  const candidates = [...byCve.entries()]
    .filter(([, e]) => e.onPath.size > 0 && e.notOnPath.size > 0)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  const best = candidates[0];
  if (!best) return null;
  return { cve: best[0], onPath: [...best[1].onPath].sort(), notOnPath: [...best[1].notOnPath].sort() };
}

export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
