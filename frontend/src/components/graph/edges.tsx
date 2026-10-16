import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { Scissors } from 'lucide-react';

import type { SubgraphEdgeView } from '@/api/types';
import { cn } from '@/lib/cn';
import type { EdgeState } from '@/lib/graphState';

import { EDGE_STYLE, edgeCaption, edgeDescription } from './graphTheme';

export type AttackEdge = Edge<
  { view: SubgraphEdgeView; state: EdgeState; highlighted: boolean; onOpen: (edgeId: string) => void },
  'attack'
>;

const LABEL_TONE: Record<EdgeState, string> = {
  active: 'border-rose-500/45 text-rose-200',
  cut: 'border-dashed border-violet-400/60 text-violet-200',
  residual: 'border-orange-400/60 text-orange-200',
  cleared: 'border-line text-fg-subtle',
};

export function AttackEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<AttackEdge>) {
  // Edges that wrap to the next row run backwards; route them orthogonally so they stay inside
  // the graph instead of looping out of view.
  const backward = targetX < sourceX;
  const [path, labelX, labelY] = backward
    ? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10, offset: 14 })
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  if (!data) return null;
  const style = EDGE_STYLE[data.state];
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: style.stroke,
          strokeWidth: data.highlighted ? style.width + 1.25 : style.width,
          strokeDasharray: style.dash,
          opacity: data.state === 'cleared' ? 0.75 : 1,
          transition: 'stroke 200ms ease, stroke-width 150ms ease',
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={cn(
            'nodrag nopan absolute flex items-center gap-1 rounded border bg-canvas/95 px-1.5 py-px font-mono text-[10px] leading-4 transition-colors hover:bg-elevated',
            LABEL_TONE[data.state],
            data.highlighted && 'ring-1 ring-accent',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
          onClick={() => data.onOpen(data.view.id)}
          aria-label={edgeDescription(data.view, data.state)}
        >
          {data.state === 'cut' ? <Scissors className="size-3" aria-hidden /> : null}
          <span className={cn(data.state === 'cut' && 'line-through decoration-violet-300/80')}>{edgeCaption(data.view)}</span>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
