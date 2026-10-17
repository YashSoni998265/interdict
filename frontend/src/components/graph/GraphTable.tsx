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
import './GraphTable.css';

const STATE_TEXT: Record<string, string> = {
  active: 'graph-table__state--active',
  cut: 'graph-table__state--cut',
  residual: 'graph-table__state--residual',
  cleared: 'graph-table__state--cleared',
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
    <div className="graph-table">
      <div className="graph-table__box">
        <table className="graph-table__table">
          <caption className="graph-table__caption">
            Attack steps ({overlay.label})
          </caption>
          <thead className="graph-table__head">
            <tr>
              <th scope="col" className="graph-table__heading-cell">Step</th>
              <th scope="col" className="graph-table__heading-cell">Kind</th>
              <th scope="col" className="graph-table__heading-cell">Technique</th>
              <th scope="col" className="graph-table__heading-cell">State</th>
              <th scope="col" className="graph-table__heading-cell">
                <span className="sr-only">Evidence</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {subgraph.edges.map((edge) => {
              const state = edgeState(edge, overlay);
              return (
                <tr key={edge.id} className="graph-table-2">
                  <th scope="row" className="graph-table__heading-cell-2">
                    {nodeLabel(edge.source)} → {nodeLabel(edge.target)}
                    {edge.ports.length > 0 ? <span className="graph-table__label"> :{edge.ports.join(',')}</span> : null}
                  </th>
                  <td className="graph-table__cell">{edge.kind ?? '–'}</td>
                  <td className="graph-table__cell-2">
                    {edge.technique_id ? <span className="graph-table__label-2">{edge.technique_id}</span> : null} {edge.technique}
                  </td>
                  <td className={cn('graph-table__cell-3', STATE_TEXT[state])}>
                    {EDGE_STYLE[state].label}
                    {state === 'cut' && edge.cut_by.length > 0 ? (
                      <div className="graph-table__block">{edge.cut_by.join(', ')}</div>
                    ) : null}
                  </td>
                  <td className="graph-table__cell-4">
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

      <div className="graph-table__box">
        <table className="graph-table__table">
          <caption className="graph-table__caption">Nodes</caption>
          <thead className="graph-table__head">
            <tr>
              <th scope="col" className="graph-table__heading-cell">Node</th>
              <th scope="col" className="graph-table__heading-cell">Kind</th>
              <th scope="col" className="graph-table__heading-cell">Roles and CVEs</th>
              <th scope="col" className="graph-table__heading-cell-3">Alerts</th>
              <th scope="col" className="graph-table__heading-cell">
                <span className="sr-only">Select</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {subgraph.nodes.map((node) => (
              <tr key={node.id} className={cn('graph-table-2', node.id === selectedNodeId && 'graph-table--alt')}>
                <th scope="row" className="graph-table__heading-cell-2">
                  {nodeLabel(node.id)}
                </th>
                <td className="graph-table__cell-2">
                  {node.kind === 'Database' && node.crown_jewel ? 'Crown jewel' : node.kind}
                </td>
                <td className="graph-table__cell-3">
                  {node.kind === 'Pod' ? (
                    <div className="graph-table__row">
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
                    <span className="graph-table__label">–</span>
                  )}
                </td>
                <td className="graph-table__cell-5">
                  {node.kind === 'Pod' ? <Num metric="podAlerts" value={node.alerts} /> : '–'}
                </td>
                <td className="graph-table__cell-4">
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
    <ul className="graph-legend" aria-label="Legend">
      {(Object.keys(EDGE_STYLE) as (keyof typeof EDGE_STYLE)[]).map((state) => {
        const style = EDGE_STYLE[state];
        return (
          <li key={state} className="graph-legend-2">
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
