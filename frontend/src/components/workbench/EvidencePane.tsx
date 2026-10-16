import type { UseQueryResult } from '@tanstack/react-query';
import { Crown, Globe, Maximize2, Network, Table2 } from 'lucide-react';
import { useState } from 'react';

import type { ClusterView, SubgraphView } from '@/api/types';
import { useApi, useSandboxState } from '@/app/services';
import { cn } from '@/lib/cn';
import { nodeLabel } from '@/lib/format';
import { edgeState, type Overlay } from '@/lib/graphState';

import { EdgeEvidenceDrawer } from '../evidence/EdgeEvidenceDrawer';
import { TierChecklist } from '../evidence/TierChecklist';
import { AttackGraph } from '../graph/AttackGraph';
import { EDGE_STYLE } from '../graph/graphTheme';
import { GraphLegend, GraphTable } from '../graph/GraphTable';
import { EmptyState, ErrorState, LoadingState } from '../states';
import { Button } from '../ui/button';
import { Segmented } from '../ui/segmented';
import { Modal } from '../ui/sheet';

import { Pane } from './Pane';

function OverlayPicker({
  overlays,
  value,
  onChange,
  computedAt,
}: {
  overlays: Overlay[];
  value: Overlay;
  onChange: (id: string) => void;
  /** Set when the shown results predate the current sandbox revision. */
  computedAt: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      {overlays.length > 1 ? (
        <Segmented
          size="xs"
          label="Graph overlay"
          value={value.id}
          onValueChange={onChange}
          options={overlays.map((o) => ({ value: o.id, label: o.label, ariaLabel: `${o.label}: ${o.hint}` }))}
        />
      ) : (
        <span className="text-2xs font-medium text-fg">{value.label}</span>
      )}
      <span className={cn('text-2xs', value.verified && computedAt === null ? 'text-emerald-300' : 'text-fg-muted')}>
        {value.hint}
        {computedAt !== null && value.kind !== 'baseline' ? ` (at revision ${computedAt}, not current)` : ''}
      </span>
    </div>
  );
}

function NodeInfo({ subgraph, nodeId, overlay }: { subgraph: SubgraphView; nodeId: string; overlay: Overlay }) {
  const node = subgraph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const incoming = subgraph.edges.filter((e) => e.target === nodeId);
  const outgoing = subgraph.edges.filter((e) => e.source === nodeId);
  const Icon = node.kind === 'Internet' ? Globe : Crown;
  const steps = node.kind === 'Internet' ? outgoing : incoming;
  return (
    <div className="space-y-2 text-ui">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-fg-muted" aria-hidden />
        <span className="font-mono font-medium text-fg">{nodeLabel(node.id)}</span>
      </div>
      <p className="text-2xs text-fg-muted">
        {node.kind === 'Internet'
          ? 'The untrusted source. Every chain starts here with an ENTRY step into an exposed, vulnerable workload.'
          : 'A crown jewel. Chains end here with a GOAL step from a workload that reaches it and holds an Allow grant.'}
      </p>
      <ul className="space-y-1 text-2xs">
        {steps.map((edge) => (
          <li key={edge.id} className="font-mono text-fg-muted">
            {nodeLabel(edge.source)} → {nodeLabel(edge.target)} · {edge.kind} · {EDGE_STYLE[edgeState(edge, overlay)].label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EvidencePane({
  cluster,
  subgraph,
  overlays,
  overlay,
  onOverlayChange,
  selectedNodeId,
  onSelectNode,
}: {
  cluster: ClusterView;
  subgraph: UseQueryResult<SubgraphView>;
  overlays: Overlay[];
  overlay: Overlay;
  onOverlayChange: (id: string) => void;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
}) {
  const client = useApi();
  const revision = useSandboxState((s) => s.revision);
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [expanded, setExpanded] = useState(false);
  const [openEdge, setOpenEdge] = useState<string | null>(null);
  const data = subgraph.data;
  const edge = data?.edges.find((e) => e.id === openEdge) ?? null;
  const selectedKind = data?.nodes.find((n) => n.id === selectedNodeId)?.kind;
  const computedAt = data && revision !== null && data.revision < revision ? data.revision : null;

  return (
    <Pane
      id="pane-evidence"
      title="Evidence graph"
      subtitle="Focused attack subgraph and the four evidence tiers"
      actions={
        <>
          <Segmented
            size="xs"
            label="Graph or table view"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'graph', label: <><Network aria-hidden />Graph</>, ariaLabel: 'Graph view' },
              { value: 'table', label: <><Table2 aria-hidden />Table</>, ariaLabel: 'Table view (text alternative)' },
            ]}
          />
          <Button size="icon" variant="ghost" onClick={() => setExpanded(true)} disabled={!data} aria-label="Expand the graph">
            <Maximize2 aria-hidden />
          </Button>
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {subgraph.isPending ? (
          <div className="px-3">
            <LoadingState
              title="Loading the focused attack subgraph"
              detail={`GET /api/clusters/${cluster.id}/subgraph: the cluster’s chains as ATTACK_STEP edges`}
            />
          </div>
        ) : subgraph.error ? (
          <div className="p-3">
            <ErrorState error={subgraph.error} title="The attack subgraph could not be loaded" onRetry={() => void subgraph.refetch()} />
          </div>
        ) : data?.edges.length === 0 ? (
          <div className="p-3">
            <EmptyState title="No chains reach this target">
              The subgraph for {cluster.target} has no attack steps at this revision, so there is nothing to cut.
            </EmptyState>
          </div>
        ) : data ? (
          <>
            <OverlayPicker overlays={overlays} value={overlay} onChange={onOverlayChange} computedAt={computedAt} />
            {subgraph.isPlaceholderData || (subgraph.isFetching && !subgraph.isPending) ? (
              <p className="px-3 pb-1 text-2xs text-fg-subtle" role="status">
                Updating the graph with the Path Hunter’s paths…
              </p>
            ) : null}
            {revision !== null && data.revision < revision ? (
              <p className="px-3 pb-1 text-2xs text-fg-subtle">
                Computed at revision {data.revision}; the sandbox is at revision {revision}.
                {client.mode === 'mock' ? ' The mock API cannot recompute it.' : ''}
              </p>
            ) : null}
            {view === 'graph' ? (
              <div className="h-[clamp(300px,46vh,520px)] border-y border-line bg-canvas">
                <AttackGraph
                  subgraph={data}
                  overlay={overlay}
                  tScope={[cluster.target]}
                  selectedNodeId={selectedNodeId}
                  highlightedEdgeId={openEdge}
                  onSelectNode={onSelectNode}
                  onOpenEdge={setOpenEdge}
                />
              </div>
            ) : (
              <div className="border-y border-line bg-canvas">
                <GraphTable
                  subgraph={data}
                  overlay={overlay}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                  onOpenEdge={setOpenEdge}
                />
              </div>
            )}
            <div className="px-3 py-2">
              <GraphLegend />
              <p className="mt-1 text-[10.5px] text-fg-subtle">
                Select a workload for its evidence tiers; select a step label for its evidence.
              </p>
            </div>
            <section className="border-t border-line px-3 py-3" aria-label="Evidence tiers">
              <div className="section-label mb-2">Evidence tiers</div>
              {selectedKind === 'Pod' ? (
                <TierChecklist podId={selectedNodeId} />
              ) : (
                <NodeInfo subgraph={data} nodeId={selectedNodeId} overlay={overlay} />
              )}
            </section>
            <Modal
              open={expanded}
              onOpenChange={setExpanded}
              size="xl"
              title={`Attack subgraph: ${cluster.target} via ${cluster.entry_ingress}`}
              description={`${overlay.label}: ${overlay.hint}`}
            >
              <div className="space-y-3">
                <OverlayPicker overlays={overlays} value={overlay} onChange={onOverlayChange} computedAt={computedAt} />
                <div className="h-[68vh] rounded-lg border border-line bg-canvas">
                  <AttackGraph
                    subgraph={data}
                    overlay={overlay}
                    tScope={[cluster.target]}
                    selectedNodeId={selectedNodeId}
                    highlightedEdgeId={openEdge}
                    onSelectNode={onSelectNode}
                    onOpenEdge={(id) => {
                      setExpanded(false);
                      setOpenEdge(id);
                    }}
                  />
                </div>
                <GraphLegend />
              </div>
            </Modal>
            <EdgeEvidenceDrawer
              edge={edge}
              state={edge ? edgeState(edge, overlay) : 'active'}
              subgraph={data}
              overlayLabel={overlay.label}
              onOpenChange={(open) => {
                if (!open) setOpenEdge(null);
              }}
            />
          </>
        ) : null}
      </div>
    </Pane>
  );
}
