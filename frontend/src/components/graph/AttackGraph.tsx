import {
  Background,
  MarkerType,
  Panel,
  ReactFlow,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SubgraphView } from '@/api/types';
import { edgeState, type Overlay } from '@/lib/graphState';
import { layoutGraph, type Positions } from '@/lib/layout';
import { useColorTheme } from '@/lib/theme';

import { ErrorState, LoadingState } from '../states';
import { Button } from '../ui/button';

import { AttackEdgeComponent, type AttackEdge } from './edges';
import { EDGE_STYLE, NODE_SIZE } from './graphTheme';
import {
  DatabaseNodeComponent,
  InternetNodeComponent,
  PodNodeComponent,
  type GraphNode,
} from './nodes';
import './AttackGraph.css';

const NODE_TYPES = {
  internet: InternetNodeComponent,
  pod: PodNodeComponent,
  database: DatabaseNodeComponent,
};
const EDGE_TYPES = { attack: AttackEdgeComponent };

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

function ZoomBar() {
  const flow = useReactFlow();
  const duration = reducedMotion() ? 0 : 200;
  return (
    <Panel position="bottom-left" className="zoom-bar">
      <div className="zoom-bar__row" role="group" aria-label="Zoom">
        <Button size="icon" variant="ghost" onClick={() => void flow.zoomIn({ duration })} aria-label="Zoom in">
          <Plus aria-hidden />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => void flow.zoomOut({ duration })} aria-label="Zoom out">
          <Minus aria-hidden />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => void flow.fitView({ duration, padding: 0.08, maxZoom: 1.15 })} aria-label="Fit the graph to the view">
          <Maximize2 aria-hidden />
        </Button>
      </div>
    </Panel>
  );
}

export interface AttackGraphProps {
  subgraph: SubgraphView;
  overlay: Overlay;
  tScope: string[];
  selectedNodeId: string | null;
  highlightedEdgeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onOpenEdge: (edgeId: string) => void;
}

/** The focused attack subgraph, laid out left to right: Internet → workloads → crown jewel. */
export function AttackGraph({
  subgraph,
  overlay,
  tScope,
  selectedNodeId,
  highlightedEdgeId,
  onSelectNode,
  onOpenEdge,
}: AttackGraphProps) {
  const colorTheme = useColorTheme();
  const structure = useMemo(
    () => `${subgraph.nodes.map((n) => n.id).join('|')}#${subgraph.edges.map((e) => e.id).join('|')}`,
    [subgraph],
  );
  const [layout, setLayout] = useState<{ key: string; positions: Positions } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ width: number; height: number } | null>(null);

  // The view size decides whether a long chain wraps into rows; measured in 40 px steps so a
  // small resize does not lay the graph out again.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const width = Math.round(element.clientWidth / 40) * 40;
      const height = Math.round(element.clientHeight / 40) * 40;
      setView((previous) => (previous?.width === width && previous.height === height ? previous : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    setError(null);
    layoutGraph(
      subgraph.nodes.map((node) => ({ id: node.id, ...NODE_SIZE[node.kind] })),
      subgraph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
      { viewWidth: view.width, viewHeight: view.height },
    )
      .then((positions) => {
        if (!cancelled) setLayout({ key: `${structure}@${view.width}x${view.height}`, positions });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason);
      });
    return () => {
      cancelled = true;
    };
    // React Query keeps unchanged arrays referentially stable, so a refetch of the same graph
    // does not lay it out again.
  }, [subgraph.nodes, subgraph.edges, structure, attempt, view]);

  const scope = useMemo(() => new Set(tScope), [tScope]);
  const positions = layout?.positions;

  const nodes = useMemo<GraphNode[]>(() => {
    if (!positions) return [];
    return subgraph.nodes.map((view) => {
      const position = positions[view.id] ?? { x: 0, y: 0 };
      const selected = view.id === selectedNodeId;
      switch (view.kind) {
        case 'Internet':
          return { id: view.id, type: 'internet', position, selected, data: { view }, ariaLabel: 'Internet (untrusted source)' };
        case 'Database':
          return {
            id: view.id,
            type: 'database',
            position,
            selected,
            data: { view, inScope: scope.has(view.id) },
            ariaLabel: `Crown jewel ${view.id}${scope.has(view.id) ? ', in T_scope' : ''}`,
          };
        case 'Pod':
          return {
            id: view.id,
            type: 'pod',
            position,
            selected,
            data: { view, dimmed: overlay.verified },
            ariaLabel: `Workload ${view.id}, roles ${view.roles.join(', ') || 'none'}, ${view.alerts} alerts. Press Enter to show its evidence tiers.`,
          };
      }
    });
  }, [positions, subgraph.nodes, selectedNodeId, scope, overlay.verified]);

  const edges = useMemo<AttackEdge[]>(
    () =>
      subgraph.edges.map((view) => {
        const state = edgeState(view, overlay);
        const style = EDGE_STYLE[state];
        return {
          id: view.id,
          source: view.source,
          target: view.target,
          type: 'attack',
          focusable: false,
          zIndex: state === 'residual' ? 3 : state === 'active' ? 2 : state === 'cut' ? 1 : 0,
          markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
          data: { view, state, highlighted: view.id === highlightedEdgeId, onOpen: onOpenEdge },
        };
      }),
    [subgraph.edges, overlay, highlightedEdgeId, onOpenEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<GraphNode>[]) => {
      for (const change of changes) {
        if (change.type === 'select' && change.selected) onSelectNode(change.id);
      }
    },
    [onSelectNode],
  );

  if (error) {
    return (
      <div className="attack-graph">
        <ErrorState error={error} title="The graph could not be laid out" onRetry={() => setAttempt((n) => n + 1)} compact />
        <p className="attack-graph__text">The table view shows the same steps and evidence.</p>
      </div>
    );
  }
  return (
    <div ref={box} className="attack-graph-2">
      {!layout ? (
        <div className="attack-graph__block">
          <LoadingState compact title="Laying out the attack subgraph" detail="ELK layered layout, left to right" />
        </div>
      ) : (
        <ReactFlow
          key={layout.key}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgeClick={(_, edge) => onOpenEdge(edge.id)}
          fitView
          fitViewOptions={{ padding: 0.08, maxZoom: 1.15 }}
          minZoom={0.3}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          zoomOnDoubleClick={false}
          colorMode={colorTheme}
          proOptions={{ hideAttribution: true }}
          aria-label={`Attack subgraph with ${subgraph.nodes.length} nodes and ${subgraph.edges.length} attack steps. The table view is the text alternative.`}
        >
          <Background gap={22} size={1} color="rgb(var(--line-strong))" />
          <ZoomBar />
        </ReactFlow>
      )}
    </div>
  );
}
