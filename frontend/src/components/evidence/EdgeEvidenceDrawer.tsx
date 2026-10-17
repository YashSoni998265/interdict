import { useQueries } from '@tanstack/react-query';
import { Scissors } from 'lucide-react';
import { useMemo } from 'react';

import { keys } from '@/api/queries';
import type { SubgraphEdgeView, SubgraphView } from '@/api/types';
import { useApi } from '@/app/services';
import { cn } from '@/lib/cn';
import { buildEvidenceIndex, STEP_CONDITION } from '@/lib/evidence';
import { nodeLabel } from '@/lib/format';
import type { EdgeState } from '@/lib/graphState';

import { EDGE_STYLE } from '../graph/graphTheme';
import { Num } from '../Num';
import { LoadingState } from '../states';
import { Disclosure } from '../ui/disclosure';
import { JsonView } from '../ui/misc';
import { SectionLabel } from '../ui/panel';
import { Sheet } from '../ui/sheet';
import { Tag } from '../ui/tag';

import { ProvenanceList } from './Provenance';
import './EdgeEvidenceDrawer.css';

const STATE_TONE: Record<EdgeState, string> = {
  active: 'edge-evidence-drawer__state--active',
  cut: 'edge-evidence-drawer__state--cut',
  residual: 'edge-evidence-drawer__state--residual',
  cleared: 'edge-evidence-drawer__state--cleared',
};

/** Evidence drill-down for one ATTACK_STEP: why it exists and the provenance behind it (§13.7). */
export function EdgeEvidenceDrawer({
  edge,
  state,
  subgraph,
  overlayLabel,
  onOpenChange,
}: {
  edge: SubgraphEdgeView | null;
  state: EdgeState;
  subgraph: SubgraphView;
  overlayLabel: string;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useApi();
  const pods = useMemo(() => {
    if (!edge) return [];
    const kinds = new Map(subgraph.nodes.map((n) => [n.id, n.kind]));
    return [edge.source, edge.target].filter((id) => kinds.get(id) === 'Pod');
  }, [edge, subgraph.nodes]);

  const views = useQueries({
    queries: pods.map((pod) => ({
      queryKey: keys.evidence(pod),
      queryFn: () => client.getWorkloadEvidence(pod),
      staleTime: 60_000,
    })),
  });
  const loading = views.some((v) => v.isPending);
  const index = useMemo(
    () => buildEvidenceIndex(views.map((v) => v.data)),
    [views],
  );

  const condition = edge?.kind ? STEP_CONDITION[edge.kind] : undefined;

  return (
    <Sheet
      open={edge !== null}
      onOpenChange={onOpenChange}
      title={edge ? `${edge.kind ?? 'Attack'} step: ${nodeLabel(edge.source)} → ${nodeLabel(edge.target)}` : 'Attack step'}
      description="Why this step exists under threat model ITM-1, and the evidence behind it."
    >
      {edge ? (
        <div className="edge-evidence-drawer__block">
          <div className="edge-evidence-drawer__row">
            <span className={cn('edge-evidence-drawer__chip', STATE_TONE[state])}>
              {state === 'cut' ? <Scissors className="edge-evidence-drawer__icon" aria-hidden /> : null}
              {EDGE_STYLE[state].label}
            </span>
            <span className="edge-evidence-drawer__label">in “{overlayLabel}”</span>
          </div>

          {condition ? (
            <section className="edge-evidence-drawer__section">
              <SectionLabel>Condition (ITM-1)</SectionLabel>
              <code className="edge-evidence-drawer__code">
                {condition.formula}
              </code>
              <p className="edge-evidence-drawer__text">{condition.words}</p>
            </section>
          ) : null}

          <section className="edge-evidence-drawer__section">
            <SectionLabel>Step</SectionLabel>
            <dl className="edge-evidence-drawer__details">
              <dt className="edge-evidence-drawer__term">Kind</dt>
              <dd className="edge-evidence-drawer__value">{edge.kind ?? 'not an attack step'}</dd>
              <dt className="edge-evidence-drawer__term">Ports</dt>
              <dd className="edge-evidence-drawer__value">{edge.ports.length > 0 ? edge.ports.join(', ') : 'none (exposure)'}</dd>
              <dt className="edge-evidence-drawer__term">Technique</dt>
              <dd className="edge-evidence-drawer__value-2">
                {edge.technique_id ? <span className="edge-evidence-drawer__label-2">{edge.technique_id}</span> : null} {edge.technique}
                <div className="edge-evidence-drawer__block-2">MITRE ATT&CK® label, for display only</div>
              </dd>
              <dt className="edge-evidence-drawer__term">Cut by</dt>
              <dd>
                {edge.cut_by.length > 0 ? (
                  <div className="edge-evidence-drawer__row-2">
                    {edge.cut_by.map((id) => (
                      <Tag key={id} tone="violet" dashed mono>
                        {id}
                      </Tag>
                    ))}
                  </div>
                ) : (
                  <span className="edge-evidence-drawer__label-3">
                    {edge.kind === 'ENTRY' ? 'not cuttable by egress policies (ingress is not modelled)' : 'no action of the shown plan'}
                  </span>
                )}
              </dd>
            </dl>
          </section>

          <section className="edge-evidence-drawer__section-2">
            <SectionLabel>
              Backing evidence (<Num metric="backingEvidence" value={edge.backing_evidence_ids.length} plain />)
            </SectionLabel>
            {loading ? <LoadingState compact title="Loading provenance" detail={`Evidence tiers for ${pods.join(' and ')}`} /> : null}
            <ul className="edge-evidence-drawer__list">
              {edge.backing_evidence_ids.map((id) => {
                const entry = index.get(id);
                return (
                  <li key={id} className="edge-evidence-drawer">
                    <div className="edge-evidence-drawer__row-3">
                      <span className="edge-evidence-drawer__label-4">{id}</span>
                      {entry ? <Tag>{entry.tier}</Tag> : null}
                    </div>
                    {entry ? (
                      <>
                        <div className="edge-evidence-drawer__block-3">{entry.label}</div>
                        <ProvenanceList items={entry.provenance} />
                      </>
                    ) : !loading ? (
                      <p className="edge-evidence-drawer__text-2">
                        Provenance not available in the workload views loaded here.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <Disclosure summary="Show graph proof: raw step JSON">
            <JsonView value={edge} />
          </Disclosure>
        </div>
      ) : null}
    </Sheet>
  );
}
