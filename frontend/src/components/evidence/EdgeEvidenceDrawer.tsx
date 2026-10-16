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

const STATE_TONE: Record<EdgeState, string> = {
  active: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  cut: 'border-dashed border-violet-400/50 bg-violet-500/10 text-violet-200',
  residual: 'border-orange-400/50 bg-orange-500/10 text-orange-200',
  cleared: 'border-line bg-elevated text-fg-muted',
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
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-ui font-medium', STATE_TONE[state])}>
              {state === 'cut' ? <Scissors className="size-3.5" aria-hidden /> : null}
              {EDGE_STYLE[state].label}
            </span>
            <span className="text-2xs text-fg-subtle">in “{overlayLabel}”</span>
          </div>

          {condition ? (
            <section className="space-y-1.5">
              <SectionLabel>Condition (ITM-1)</SectionLabel>
              <code className="block rounded-md border border-line bg-canvas px-2.5 py-1.5 font-mono text-[12px] text-fg">
                {condition.formula}
              </code>
              <p className="text-ui text-fg-muted">{condition.words}</p>
            </section>
          ) : null}

          <section className="space-y-1.5">
            <SectionLabel>Step</SectionLabel>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-ui">
              <dt className="text-fg-muted">Kind</dt>
              <dd className="font-mono text-fg">{edge.kind ?? 'not an attack step'}</dd>
              <dt className="text-fg-muted">Ports</dt>
              <dd className="font-mono text-fg">{edge.ports.length > 0 ? edge.ports.join(', ') : 'none (exposure)'}</dd>
              <dt className="text-fg-muted">Technique</dt>
              <dd className="text-fg">
                {edge.technique_id ? <span className="font-mono">{edge.technique_id}</span> : null} {edge.technique}
                <div className="text-2xs text-fg-subtle">MITRE ATT&CK® label, for display only</div>
              </dd>
              <dt className="text-fg-muted">Cut by</dt>
              <dd>
                {edge.cut_by.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {edge.cut_by.map((id) => (
                      <Tag key={id} tone="violet" dashed mono>
                        {id}
                      </Tag>
                    ))}
                  </div>
                ) : (
                  <span className="text-fg-subtle">
                    {edge.kind === 'ENTRY' ? 'not cuttable by egress policies (ingress is not modelled)' : 'no action of the shown plan'}
                  </span>
                )}
              </dd>
            </dl>
          </section>

          <section className="space-y-2">
            <SectionLabel>
              Backing evidence (<Num metric="backingEvidence" value={edge.backing_evidence_ids.length} plain />)
            </SectionLabel>
            {loading ? <LoadingState compact title="Loading provenance" detail={`Evidence tiers for ${pods.join(' and ')}`} /> : null}
            <ul className="space-y-3">
              {edge.backing_evidence_ids.map((id) => {
                const entry = index.get(id);
                return (
                  <li key={id} className="space-y-1.5">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="break-all font-mono text-[12px] text-fg">{id}</span>
                      {entry ? <Tag>{entry.tier}</Tag> : null}
                    </div>
                    {entry ? (
                      <>
                        <div className="text-2xs text-fg-muted">{entry.label}</div>
                        <ProvenanceList items={entry.provenance} />
                      </>
                    ) : !loading ? (
                      <p className="text-2xs text-fg-subtle">
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
