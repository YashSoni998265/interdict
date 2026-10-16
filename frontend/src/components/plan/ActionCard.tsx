import { Scissors } from 'lucide-react';

import type { ActionView, FlowRef } from '@/api/types';
import { cn } from '@/lib/cn';
import { describeFlow } from '@/lib/format';
import { VARIANT } from '@/lib/status';

import { Disclosure } from '../ui/disclosure';
import { JsonView } from '../ui/misc';
import { Tag } from '../ui/tag';

function FlowList({ ids, flows, empty, tone }: { ids: string[]; flows: Record<string, FlowRef>; empty: string; tone?: 'yellow' | 'neutral' }) {
  if (ids.length === 0) return <span className="text-fg-subtle">{empty}</span>;
  return (
    <ul className="space-y-0.5">
      {ids.map((id) => (
        <li key={id} className={cn('font-mono text-[11.5px]', tone === 'yellow' ? 'text-yellow-300' : 'text-fg')} title={id}>
          {describeFlow(id, flows)}
        </li>
      ))}
    </ul>
  );
}

/** One candidate egress allowlist: a proposed policy change (violet, dashed, scissors). */
export function ActionCard({
  action,
  flows,
  compact = false,
}: {
  action: ActionView;
  flows: Record<string, FlowRef>;
  compact?: boolean;
}) {
  const variant = VARIANT[action.variant];
  return (
    <article
      className="rounded-md border border-dashed border-violet-500/40 bg-violet-500/[0.04] px-3 py-2.5"
      aria-label={`Proposed policy change ${action.id}`}
    >
      <div className="flex items-start gap-2">
        <Scissors className="mt-0.5 size-3.5 shrink-0 text-violet-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="break-words font-mono text-[12px] font-medium text-fg">{action.id}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-fg-muted">
            <span className="text-violet-300">{variant.label}</span>
            <span>
              · selector{' '}
              <span className="font-mono">
                {action.namespace}/app={action.app}
              </span>{' '}
              · {action.pods.join(', ')}
            </span>
            <Tag tone="violet" dashed>
              Proposed policy change
            </Tag>
          </div>
        </div>
      </div>

      <dl className="mt-2.5 grid gap-x-4 gap-y-2 text-2xs sm:grid-cols-[7.5rem_1fr]">
        <dt className="text-fg-subtle">Egress allowlist</dt>
        <dd>
          {action.allow.length === 0 ? (
            <span className="text-fg">nothing (all egress blocked, DNS included)</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {action.allow.map((rule) => (
                <Tag key={`${rule.dst}-${rule.port}-${rule.protocol}`} mono>
                  {rule.dst}:{rule.port}/{rule.protocol}
                </Tag>
              ))}
            </span>
          )}
        </dd>
        <dt className="text-fg-subtle">Blocks</dt>
        <dd>
          <FlowList ids={action.blocked} flows={flows} empty="no observed flow" />
        </dd>
        {!compact ? (
          <>
            <dt className="text-fg-subtle">Cuts steps</dt>
            <dd className="font-mono text-[11.5px] text-fg">
              {action.removed_steps.length === 0 ? (
                <span className="font-sans text-fg-subtle">none</span>
              ) : (
                action.removed_steps.map(([src, dst]) => (
                  <div key={`${src}->${dst}`}>
                    <span className="text-violet-300 line-through decoration-violet-400/70">
                      {src} → {dst}
                    </span>
                  </div>
                ))
              )}
            </dd>
          </>
        ) : null}
        <dt className="text-fg-subtle">Breaks</dt>
        <dd>
          <FlowList ids={action.known_broken} flows={flows} empty="no declared dependency" />
        </dd>
        <dt className="text-fg-subtle">Unknown impact</dt>
        <dd>
          <FlowList ids={action.unknown} flows={flows} empty="none" tone="yellow" />
        </dd>
      </dl>

      {!compact ? (
        <Disclosure summary="Policy spec (Kubernetes-style)" className="mt-2.5">
          <JsonView value={action.policy_spec} maxHeight="max-h-60" />
        </Disclosure>
      ) : null}
    </article>
  );
}
