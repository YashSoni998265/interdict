/**
 * Left-to-right layered layout (Internet → workloads → crown jewel) with elkjs. ELK is ~1.4 MB,
 * so it is imported on first use and shared afterwards.
 */
import type { ELK, ElkNode } from 'elkjs/lib/elk-api';

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export type Positions = Record<string, { x: number; y: number }>;

export interface LayoutOptions {
  /** Size of the view the graph must fit; enables row wrapping for long chains. */
  viewWidth?: number;
  viewHeight?: number;
}

/** Below this zoom node text stops being comfortably readable, so long chains wrap instead. */
const MIN_READABLE_ZOOM = 0.72;

let elk: Promise<ELK> | null = null;

function getElk(): Promise<ELK> {
  elk ??= import('elkjs/lib/elk.bundled.js').then(({ default: Elk }) => new Elk());
  return elk;
}

const BASE_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '52',
  'elk.spacing.nodeNode': '28',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.padding': '[top=12,left=12,bottom=12,right=12]',
};

function run(engine: ELK, nodes: LayoutNode[], edges: LayoutEdge[], extra: Record<string, string>) {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: { ...BASE_OPTIONS, ...extra },
    children: nodes.map((node) => ({ id: node.id, width: node.width, height: node.height })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
  return engine.layout(graph);
}

export async function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): Promise<Positions> {
  const engine = await getElk();
  let result = await run(engine, nodes, edges, {});
  const { viewWidth, viewHeight } = options;
  // A long chain (such as the 4-hop path beyond the planner's bound) would shrink to an
  // unreadable strip in a narrow pane: wrap it into rows that still read left to right.
  if (viewWidth && viewWidth > 0 && (result.width ?? 0) * MIN_READABLE_ZOOM > viewWidth) {
    const ratio = Math.max(2.5, viewHeight ? viewWidth / viewHeight : 2.5);
    result = await run(engine, nodes, edges, {
      'elk.layered.wrapping.strategy': 'SINGLE_EDGE',
      'elk.aspectRatio': ratio.toFixed(2),
    });
  }
  const positions: Positions = {};
  for (const child of result.children ?? []) {
    positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }
  return positions;
}
