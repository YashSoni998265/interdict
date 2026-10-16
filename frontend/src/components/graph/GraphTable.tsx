import { FileSearch } from 'lucide-react';

import type { SubgraphView } from '@/api/types';
import { cn } from '@/lib/cn';
import { nodeLabel } from '@/lib/format';
import { edgeState, type Overlay } from '@/lib/graphState';
import { ROLE } from '@/lib/status';

import { Num } from '../Num';
import { Button } from '../ui/button';
import { Tag } from '../ui/tag';

import { EDGE_STYLE } from './graphTheme';

const STATE_TEXT: Record<string, string> = {
  active: 'text-rose-300',
  cut: 'text-violet-300',
  residual: 'text-orange-300',
  cleared: 'text-fg-subtle',
};

/** The text alternative to the graph: every attack step and workload, keyboard reachable. */
export function GraphTable({
  subgraph,
  overlay,
  selectedNodeId,
  onSelectNode,
  onOpenEdge,
}: {
  subgraph: SubgraphView;
  overlay: Overlay;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onOpenEdge: (id: string) => void;
}) {
  return (
    <div className="space-y-4 p-3">
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[34rem] text-left text-2xs">
          <caption className="px-2.5 py-2 text-left text-ui font-medium text-fg">
            Attack steps ({overlay.label})
          </caption>
          <thead className="bg-surface text-fg-subtle">
            <tr>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Step</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Kind</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Technique</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">State</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">
                <span className="sr-only">Evidence</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {subgraph.edges.map((edge) => {
              const state = edgeState(edge, overlay);
              return (
                <tr key={edge.id} className="border-t border-line align-top">
                  <th scope="row" className="px-2.5 py-1.5 font-mono font-normal text-fg">
                    {nodeLabel(edge.source)} → {nodeLabel(edge.target)}
                    {edge.ports.length > 0 ? <span className="text-fg-subtle"> :{edge.ports.join(',')}</span> : null}
                  </th>
                  <td className="px-2.5 py-1.5 font-mono text-fg-muted">{edge.kind ?? '–'}</td>
                  <td className="px-2.5 py-1.5 text-fg-muted">
                    {edge.technique_id ? <span className="font-mono">{edge.technique_id}</span> : null} {edge.technique}
                  </td>
                  <td className={cn('px-2.5 py-1.5', STATE_TEXT[state])}>
                    {EDGE_STYLE[state].label}
                    {state === 'cut' && edge.cut_by.length > 0 ? (
                      <div className="mt-0.5 break-all font-mono text-[10.5px] text-fg-subtle">{edge.cut_by.join(', ')}</div>
                    ) : null}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <Button size="xs" variant="ghost" onClick={() => onOpenEdge(edge.id)} aria-label={`Open evidence for ${edge.source} to ${edge.target}`}>
                      <FileSearch aria-hidden />
                      Evidence
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[34rem] text-left text-2xs">
          <caption className="px-2.5 py-2 text-left text-ui font-medium text-fg">Nodes</caption>
          <thead className="bg-surface text-fg-subtle">
            <tr>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Node</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Kind</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Roles and CVEs</th>
              <th scope="col" className="px-2.5 py-1.5 text-right font-medium">Alerts</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">
                <span className="sr-only">Select</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {subgraph.nodes.map((node) => (
              <tr key={node.id} className={cn('border-t border-line align-top', node.id === selectedNodeId && 'bg-elevated/60')}>
                <th scope="row" className="px-2.5 py-1.5 font-mono font-normal text-fg">
                  {nodeLabel(node.id)}
                </th>
                <td className="px-2.5 py-1.5 text-fg-muted">
                  {node.kind === 'Database' && node.crown_jewel ? 'Crown jewel' : node.kind}
                </td>
                <td className="px-2.5 py-1.5">
                  {node.kind === 'Pod' ? (
                    <div className="flex flex-wrap gap-1">
                      {node.roles.map((role) => (
                        <Tag key={role}>{ROLE[role].label}</Tag>
                      ))}
                      {node.network_cves.map((cve) => (
                        <Tag key={cve} mono>
                          {cve}
                        </Tag>
                      ))}
                      {node.exposed_via.map((ingress) => (
                        <Tag key={ingress} mono>
                          via {ingress}
                        </Tag>
                      ))}
                    </div>
                  ) : (
                    <span className="text-fg-subtle">–</span>
                  )}
                </td>
                <td className="px-2.5 py-1.5 text-right text-fg">
                  {node.kind === 'Pod' ? <Num metric="podAlerts" value={node.alerts} /> : '–'}
                </td>
                <td className="px-2.5 py-1.5 text-right">
                  {node.kind === 'Pod' ? (
                    <Button
                      size="xs"
                      variant={node.id === selectedNodeId ? 'secondary' : 'ghost'}
                      onClick={() => onSelectNode(node.id)}
                      aria-pressed={node.id === selectedNodeId}
                    >
                      Evidence tiers
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function GraphLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10.5px] text-fg-muted" aria-label="Legend">
      {(Object.keys(EDGE_STYLE) as (keyof typeof EDGE_STYLE)[]).map((state) => {
        const style = EDGE_STYLE[state];
        return (
          <li key={state} className="flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden>
              <line x1="1" y1="4" x2="21" y2="4" stroke={style.stroke} strokeWidth={style.width + 0.25} strokeDasharray={style.dash} />
            </svg>
            {style.label}
          </li>
        );
      })}
    </ul>
  );
}
