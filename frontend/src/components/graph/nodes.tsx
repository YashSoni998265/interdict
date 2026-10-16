import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Crown, Database, Globe, Server } from 'lucide-react';

import type { DatabaseNodeView, InternetNodeView, PodNodeView } from '@/api/types';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/format';
import { ROLE } from '@/lib/status';

import { Num } from '../Num';

import { NODE_SIZE } from './graphTheme';

export type InternetNode = Node<{ view: InternetNodeView }, 'internet'>;
export type PodNode = Node<{ view: PodNodeView; dimmed: boolean }, 'pod'>;
export type DatabaseNode = Node<{ view: DatabaseNodeView; inScope: boolean }, 'database'>;
export type GraphNode = InternetNode | PodNode | DatabaseNode;

const handle = '!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-line-strong';

export function InternetNodeComponent({ data, selected }: NodeProps<InternetNode>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[10px] border bg-elevated px-3 shadow-elevated transition-shadow',
        selected ? 'border-accent' : 'border-line-strong',
      )}
      style={NODE_SIZE.Internet}
    >
      <Globe className="size-4 shrink-0 text-fg-muted" aria-hidden />
      <div className="min-w-0">
        <div className="text-ui font-semibold text-fg">{data.view.label}</div>
        <div className="text-[10px] text-fg-subtle">untrusted</div>
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
        'flex flex-col justify-between rounded-[10px] border bg-surface px-3 py-2 shadow-elevated transition-[box-shadow,opacity]',
        selected ? 'border-accent' : 'border-red-500/45',
        data.dimmed && !selected && 'opacity-80',
      )}
      style={NODE_SIZE.Pod}
    >
      <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
      <div className="flex items-center gap-1.5" title={`${view.namespace}/app=${view.app}${view.exposed_via.length > 0 ? ` via ${view.exposed_via.join(', ')}` : ''}`}>
        <Server className="size-3.5 shrink-0 text-red-400" aria-hidden />
        <div className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium leading-4 text-fg">{view.label}</div>
      </div>
      <div className="flex flex-wrap gap-1">
        {view.roles.map((role) => (
          <span key={role} className="rounded border border-red-500/30 bg-red-500/10 px-1 text-[10px] font-medium leading-4 text-red-300">
            {ROLE[role].label}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-mono text-[10px] leading-4 text-fg-muted">{view.network_cves.join(', ')}</span>
        <span className="shrink-0 font-mono text-[10px] leading-4 text-fg-subtle">
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
        'flex items-center gap-2.5 rounded-[10px] border bg-elevated px-3 shadow-elevated',
        selected ? 'border-accent' : data.inScope ? 'border-red-500/55' : 'border-line-strong',
      )}
      style={NODE_SIZE.Database}
    >
      <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
      <Database className="size-4 shrink-0 text-red-400" aria-hidden />
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px] font-medium text-fg" title={data.view.label}>
          {data.view.label}
        </div>
        <div className="flex items-center gap-1 text-[10.5px] text-fg-subtle">
          {data.view.crown_jewel ? (
            <>
              <Crown className="size-3 text-amber-300" aria-hidden />
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
