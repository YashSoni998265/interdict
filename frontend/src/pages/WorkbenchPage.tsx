import { ArrowLeft, ListChecks, Network, Telescope, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useStorm, useSubgraph } from '@/api/queries';
import type { ClusterView, StormView } from '@/api/types';
import { useClusterAnalysis } from '@/app/hooks';
import { useRun } from '@/app/services';
import { OutcomeBadge } from '@/components/OutcomeBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Select } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tag } from '@/components/ui/tag';
import { AuditStrip } from '@/components/workbench/AuditStrip';
import { EvidencePane } from '@/components/workbench/EvidencePane';
import { InvestigationPane } from '@/components/workbench/InvestigationPane';
import { VerificationPane } from '@/components/workbench/VerificationPane';
import { clusterTitle } from '@/lib/format';
import { defaultOverlay, deriveOverlays } from '@/lib/graphState';
import { huntPlanHandle } from '@/lib/plan';
import { lifecycleLabel } from '@/lib/status';
import { useMediaQuery } from '@/lib/useMediaQuery';

type TabId = 'evidence' | 'investigation' | 'verification';

function RunStatus({ clusterId }: { clusterId: string }) {
  const run = useRun(clusterId);
  const analysis = useClusterAnalysis(clusterId);
  const derived = analysis.derived;
  let content;
  if (run?.phase === 'starting' || run?.phase === 'streaming') {
    content = (
      <span className="inline-flex items-center gap-1.5 text-fg">
        <span className="size-1.5 animate-pulse-soft rounded-full bg-accent" aria-hidden />
        {derived?.currentState ? `${derived.currentState} · ${lifecycleLabel(derived.currentState)}` : 'Starting'}
      </span>
    );
  } else if (analysis.hunt) {
    content = <OutcomeBadge hunt={analysis.hunt} size="sm" />;
  } else if (derived?.done) {
    content = <StatusBadge status={derived.done.status} hasCertificate={false} size="sm" />;
  } else {
    content = <span className="text-fg-subtle">not investigated yet</span>;
  }
  return (
    <div className="flex items-center gap-1.5 text-2xs text-fg-muted" aria-live="polite">
      <span>Status</span>
      {content}
    </div>
  );
}

function Workbench({ cluster, storm, initialPod }: { cluster: ClusterView; storm: StormView; initialPod: string | null }) {
  const navigate = useNavigate();
  const analysis = useClusterAnalysis(cluster.id);
  const run = useRun(cluster.id);
  const handle = analysis.hunt ? huntPlanHandle(analysis.hunt, analysis.plan) : null;
  const subgraph = useSubgraph(cluster.id, handle);
  const wide = useMediaQuery('(min-width: 1280px)');
  const [tab, setTab] = useState<TabId>('evidence');
  const [overlayChoice, setOverlayChoice] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string>(
    initialPod ?? cluster.witness_path[1] ?? cluster.workloads[0] ?? cluster.target,
  );

  // A new run starts from the automatic overlay again.
  useEffect(() => setOverlayChoice(null), [run?.startedAt]);

  const overlays = useMemo(
    () =>
      subgraph.data
        ? deriveOverlays({ subgraph: subgraph.data, initialPlan: analysis.plan?.plan, hunt: analysis.hunt })
        : [],
    [subgraph.data, analysis.plan, analysis.hunt],
  );
  const overlay = overlays.find((o) => o.id === overlayChoice) ?? defaultOverlay(overlays);
  const stormChains = useMemo(
    () => storm.chains.filter((c) => cluster.chain_ids.includes(c.id)),
    [storm.chains, cluster.chain_ids],
  );

  const showRound = (round: number) => {
    setOverlayChoice(`round:${round}`);
    if (!wide) setTab('evidence');
  };

  const evidence = (
    <EvidencePane
      cluster={cluster}
      subgraph={subgraph}
      overlays={overlays}
      overlay={overlay}
      onOverlayChange={setOverlayChoice}
      selectedNodeId={selectedNode}
      onSelectNode={setSelectedNode}
    />
  );
  const investigation = <InvestigationPane cluster={cluster} derived={analysis.derived} />;
  const verification = (
    <VerificationPane
      cluster={cluster}
      analysis={analysis}
      stormChains={stormChains}
      selectedRound={overlay.kind === 'round' ? (overlay.round ?? null) : null}
      onSelectRound={showRound}
    />
  );

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2">
        <Link to="/storm" className="inline-flex items-center gap-1 rounded text-2xs text-fg-muted hover:text-fg">
          <ArrowLeft className="size-3.5" aria-hidden />
          Storm
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-fg">
            <span className="font-mono">{cluster.target}</span>
            <span className="font-normal text-fg-muted"> via </span>
            <span className="font-mono">{cluster.entry_ingress}</span>
          </h1>
          <div className="font-mono text-[11px] text-fg-subtle">{cluster.id}</div>
        </div>
        {cluster.beyond_bound ? (
          <Tag tone="orange">
            <Telescope className="size-3" aria-hidden />
            Beyond the planner’s 3-hop bound
          </Tag>
        ) : null}
        <span className="inline-flex items-center gap-1 text-2xs text-fg-muted">
          T_scope
          <Tag mono>{cluster.target}</Tag>
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <RunStatus clusterId={cluster.id} />
          <label htmlFor="cluster-switch" className="sr-only">
            Switch cluster
          </label>
          <Select
            id="cluster-switch"
            value={cluster.id}
            onChange={(e) => navigate(`/clusters/${e.target.value}`)}
            className="h-7 w-auto max-w-[16rem] font-sans text-ui"
          >
            {storm.clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {clusterTitle(c)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {wide ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.05fr)] divide-x divide-line">
          {evidence}
          {investigation}
          {verification}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex min-h-0 flex-1 flex-col">
          <TabsList aria-label="Workbench panes" className="shrink-0 bg-pane">
            <TabsTrigger value="evidence">
              <Network aria-hidden />
              Evidence graph
            </TabsTrigger>
            <TabsTrigger value="investigation">
              <Workflow aria-hidden />
              Investigation
            </TabsTrigger>
            <TabsTrigger value="verification">
              <ListChecks aria-hidden />
              Plan and verification
            </TabsTrigger>
          </TabsList>
          <TabsContent value="evidence" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            {evidence}
          </TabsContent>
          <TabsContent value="investigation" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            {investigation}
          </TabsContent>
          <TabsContent value="verification" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            {verification}
          </TabsContent>
        </Tabs>
      )}

      <AuditStrip />
    </div>
  );
}

export default function WorkbenchPage() {
  const { clusterId = '' } = useParams();
  const [params] = useSearchParams();
  const storm = useStorm();

  if (storm.isPending) {
    return (
      <div className="px-4">
        <LoadingState title="Loading the cluster" detail="GET /api/storm: clusters, chains and roles" />
      </div>
    );
  }
  if (storm.error) {
    return (
      <div className="p-4">
        <ErrorState error={storm.error} title="The storm report could not be loaded" onRetry={() => void storm.refetch()} />
      </div>
    );
  }
  const cluster = storm.data.clusters.find((c) => c.id === clusterId);
  if (!cluster) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4">
        <EmptyState title={`No cluster “${clusterId}” in this storm`}>
          <p>The clusters in {storm.data.storm_id} are:</p>
          <ul className="mt-2 space-y-1">
            {storm.data.clusters.map((c) => (
              <li key={c.id}>
                <Link to={`/clusters/${c.id}`} className="text-accent hover:underline">
                  {clusterTitle(c)}
                </Link>
              </li>
            ))}
          </ul>
        </EmptyState>
      </div>
    );
  }
  return <Workbench key={cluster.id} cluster={cluster} storm={storm.data} initialPod={params.get('pod')} />;
}
