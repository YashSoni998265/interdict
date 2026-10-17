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
import './WorkbenchPage.css';

type TabId = 'evidence' | 'investigation' | 'verification';

function RunStatus({ clusterId }: { clusterId: string }) {
  const run = useRun(clusterId);
  const analysis = useClusterAnalysis(clusterId);
  const derived = analysis.derived;
  let content;
  if (run?.phase === 'starting' || run?.phase === 'streaming') {
    content = (
      <span className="run-status">
        <span className="run-status__dot" aria-hidden />
        {derived?.currentState ? `${derived.currentState} · ${lifecycleLabel(derived.currentState)}` : 'Starting'}
      </span>
    );
  } else if (analysis.hunt) {
    content = <OutcomeBadge hunt={analysis.hunt} size="sm" />;
  } else if (derived?.done) {
    content = <StatusBadge status={derived.done.status} hasCertificate={false} size="sm" />;
  } else {
    content = <span className="run-status-2">not investigated yet</span>;
  }
  return (
    <div className="run-status-3" aria-live="polite">
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
    <div className="workbench">
      <div className="workbench__row">
        <Link to="/storm" className="workbench__link">
          <ArrowLeft className="workbench__icon" aria-hidden />
          Explore
        </Link>
        <div className="workbench__block">
          <h1 className="workbench__heading">
            <span className="workbench__label">{cluster.target}</span>
            <span className="workbench__label-2"> via </span>
            <span className="workbench__label">{cluster.entry_ingress}</span>
          </h1>
        </div>
        {cluster.beyond_bound ? (
          <Tag tone="orange">
            <Telescope className="workbench__icon-2" aria-hidden />
            Beyond the planner’s 3-hop bound
          </Tag>
        ) : null}
        <span className="workbench__label-3">
          Protects
          <Tag mono>{cluster.target}</Tag>
        </span>
        <div className="workbench__row-2">
          <RunStatus clusterId={cluster.id} />
          <label htmlFor="cluster-switch" className="sr-only">
            Switch cluster
          </label>
          <Select
            id="cluster-switch"
            value={cluster.id}
            onChange={(e) => navigate(`/clusters/${e.target.value}`)}
            className="workbench__select"
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
        <div className="workbench__grid">
          {evidence}
          {investigation}
          {verification}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="workbench__tabs">
          <TabsList aria-label="Workbench panes" className="workbench__tabs-list">
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
          <TabsContent value="evidence" className="workbench__tabs-content">
            {evidence}
          </TabsContent>
          <TabsContent value="investigation" className="workbench__tabs-content">
            {investigation}
          </TabsContent>
          <TabsContent value="verification" className="workbench__tabs-content">
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
      <div className="workbench-page">
        <LoadingState title="Loading the cluster" detail="GET /api/storm: clusters, chains and roles" />
      </div>
    );
  }
  if (storm.error) {
    return (
      <div className="workbench-page-2">
        <ErrorState error={storm.error} title="The storm report could not be loaded" onRetry={() => void storm.refetch()} />
      </div>
    );
  }
  const cluster = storm.data.clusters.find((c) => c.id === clusterId);
  if (!cluster) {
    return (
      <div className="workbench-page-3">
        <EmptyState title={`No cluster “${clusterId}” in this storm`}>
          <p>The clusters in {storm.data.storm_id} are:</p>
          <ul className="workbench-page__list">
            {storm.data.clusters.map((c) => (
              <li key={c.id}>
                <Link to={`/clusters/${c.id}`} className="workbench-page__link">
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
