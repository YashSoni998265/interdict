import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Crown, Database, Globe, Server } from 'lucide-react';

import type { DatabaseNodeView, InternetNodeView, PodNodeView } from '@/api/types';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/format';
import { ROLE } from '@/lib/status';

import { Num } from '../Num';

import { NODE_SIZE } from './graphTheme';
import './nodes.css';

export type InternetNode = Node<{ view: InternetNodeView }, 'internet'>;
export type PodNode = Node<{ view: PodNodeView; dimmed: boolean }, 'pod'>;
export type DatabaseNode = Node<{ view: DatabaseNodeView; inScope: boolean }, 'database'>;
export type GraphNode = InternetNode | PodNode | DatabaseNode;

const handle = 'graph-node__handle';

export function InternetNodeComponent({ data, selected }: NodeProps<InternetNode>) {
  return (
    <div
      className={cn(
        'internet-node',
        selected ? 'internet-node--selected' : 'internet-node--not-selected',
      )}
      style={NODE_SIZE.Internet}
    >
      <Globe className="internet-node__icon" aria-hidden />
      <div className="internet-node__block">
        <div className="internet-node__block-2">{data.view.label}</div>
        <div className="internet-node__block-3">untrusted</div>
      </div>
      <Handle type="source" position={Position.Right} className={handle} isConnectable={false} />
    </div>
  );
}

export function PodNodeComponent({ data, selected }: NodeProps<PodNode>) {
  const view = data.view;
  return (
    <div
      className={cn(
        'pod-node',
        selected ? 'pod-node--selected' : 'pod-node--not-selected',
        data.dimmed && !selected && 'pod-node--dimmed',
      )}
      style={NODE_SIZE.Pod}
    >
      <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
      <div className="pod-node__row" title={`${view.namespace}/app=${view.app}${view.exposed_via.length > 0 ? ` via ${view.exposed_via.join(', ')}` : ''}`}>
        <Server className="pod-node__icon" aria-hidden />
        <div className="pod-node__block">{view.label}</div>
      </div>
      <div className="pod-node__row-2">
        {view.roles.map((role) => (
          <span key={role} className="pod-node-2">
            {ROLE[role].label}
          </span>
        ))}
      </div>
      <div className="pod-node__row-3">
        <span className="pod-node__label">{view.network_cves.join(', ')}</span>
        <span className="pod-node__label-2">
          <Num metric="podAlerts" value={view.alerts} plain /> {plural(view.alerts, 'alert')}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className={handle} isConnectable={false} />
    </div>
  );
}

export function DatabaseNodeComponent({ data, selected }: NodeProps<DatabaseNode>) {
  return (
    <div
      className={cn(
        'database-node',
        selected ? 'database-node--selected' : data.inScope ? 'database-node--in-scope' : 'database-node--not-in-scope',
      )}
      style={NODE_SIZE.Database}
    >
      <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
      <Database className="database-node__icon" aria-hidden />
      <div className="database-node__block">
        <div className="database-node__block-2" title={data.view.label}>
          {data.view.label}
        </div>
        <div className="database-node__row">
          {data.view.crown_jewel ? (
            <>
              <Crown className="database-node__icon-2" aria-hidden />
              crown jewel{data.inScope ? ' · in T_scope' : ''}
            </>
          ) : (
            'database'
          )}
        </div>
      </div>
    </div>
  );
}
