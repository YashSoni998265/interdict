import type { SubgraphEdgeView } from '@/api/types';
import type { EdgeState } from '@/lib/graphState';

/** Stroke colours per edge state (§13.7 visual deltas). Text labels always accompany them. */
export const EDGE_STYLE: Record<EdgeState, { stroke: string; width: number; dash?: string; label: string }> = {
  active: { stroke: '#e11d48', width: 1.75, label: 'Real attack path (modelled)' },
  cut: { stroke: '#7c3aed', width: 1.75, dash: '6 5', label: 'Proposed policy change: step cut' },
  residual: { stroke: '#ea580c', width: 2.6, label: 'Partly fixed: path remains' },
  cleared: { stroke: '#a1a1aa', width: 1.25, label: 'No reported path uses this step' },
};

/** Compact enough that a four-layer graph reads at ~0.85 zoom in a 560 px pane. */
export const NODE_SIZE = {
  Internet: { width: 96, height: 44 },
  Pod: { width: 148, height: 76 },
  Database: { width: 164, height: 52 },
} as const;

/** Short on-edge caption: the port(s); ENTRY steps have none. The kind is in the drawer and table. */
export function edgeCaption(view: SubgraphEdgeView): string {
  if (view.ports.length > 0) return `:${view.ports.join(',')}`;
  return view.kind === 'ENTRY' ? 'entry' : (view.kind?.toLowerCase() ?? 'step');
}

export function edgeDescription(view: SubgraphEdgeView, state: EdgeState): string {
  const ports = view.ports.length > 0 ? `, port ${view.ports.join(', ')}` : '';
  const cut = state === 'cut' && view.cut_by.length > 0 ? `, cut by ${view.cut_by.join(', ')}` : '';
  return `${view.kind ?? 'Attack'} step ${view.source} to ${view.target}${ports}. ${EDGE_STYLE[state].label}${cut}. Open evidence.`;
}
