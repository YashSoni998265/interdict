import { Scissors } from 'lucide-react';

import type { ActionView, FlowRef } from '@/api/types';
import { cn } from '@/lib/cn';
import { describeFlow } from '@/lib/format';
import { VARIANT } from '@/lib/status';

import { Disclosure } from '../ui/disclosure';
import { JsonView } from '../ui/misc';
import { Tag } from '../ui/tag';
import './ActionCard.css';

function FlowList({ ids, flows, empty, tone }: { ids: string[]; flows: Record<string, FlowRef>; empty: string; tone?: 'yellow' | 'neutral' }) {
  if (ids.length === 0) return <span className="flow-list">{empty}</span>;
  return (
    <ul className="flow-list-2">
      {ids.map((id) => (
        <li key={id} className={cn('flow-list-3', tone === 'yellow' ? 'flow-list--yellow' : 'flow-list--not-yellow')} title={id}>
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
      className="action-card"
      aria-label={`Proposed policy change ${action.id}`}
    >
      <div className="action-card__row">
        <Scissors className="action-card__icon" aria-hidden />
        <div className="action-card__block">
          <div className="action-card__block-2">{action.id}</div>
          <div className="action-card__row-2">
            <span className="action-card__label">{variant.label}</span>
            <span>
              · selector{' '}
              <span className="action-card__label-2">
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

      <dl className="action-card__details">
        <dt className="action-card__term">Egress allowlist</dt>
        <dd>
          {action.allow.length === 0 ? (
            <span className="action-card__label-3">nothing (all egress blocked, DNS included)</span>
          ) : (
            <span className="action-card__label-4">
              {action.allow.map((rule) => (
                <Tag key={`${rule.dst}-${rule.port}-${rule.protocol}`} mono>
                  {rule.dst}:{rule.port}/{rule.protocol}
                </Tag>
              ))}
            </span>
          )}
        </dd>
        <dt className="action-card__term">Blocks</dt>
        <dd>
          <FlowList ids={action.blocked} flows={flows} empty="no observed flow" />
        </dd>
        {!compact ? (
          <>
            <dt className="action-card__term">Cuts steps</dt>
            <dd className="action-card__value">
              {action.removed_steps.length === 0 ? (
                <span className="action-card__label-5">none</span>
              ) : (
                action.removed_steps.map(([src, dst]) => (
                  <div key={`${src}->${dst}`}>
                    <span className="action-card__label-6">
                      {src} → {dst}
                    </span>
                  </div>
                ))
              )}
            </dd>
          </>
        ) : null}
        <dt className="action-card__term">Breaks</dt>
        <dd>
          <FlowList ids={action.known_broken} flows={flows} empty="no declared dependency" />
        </dd>
        <dt className="action-card__term">Unknown impact</dt>
        <dd>
          <FlowList ids={action.unknown} flows={flows} empty="none" tone="yellow" />
        </dd>
      </dl>

      {!compact ? (
        <Disclosure summary="Policy spec (Kubernetes-style)" className="action-card__disclosure">
          <JsonView value={action.policy_spec} maxHeight="action-card__policy-json" />
        </Disclosure>
      ) : null}
    </article>
  );
}
