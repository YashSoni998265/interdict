import { Layers, OctagonX } from 'lucide-react';
import { useState } from 'react';

import { useRecordedScenario } from '@/api/queries';
import { mergeFlows } from '@/lib/plan';

import { HuntReport } from '../hunt/HuntReport';
import { PlanReport } from '../plan/PlanReport';
import { ErrorState, LoadingState } from '../states';
import { Button } from '../ui/button';
import { Modal } from '../ui/sheet';
import './ScenarioCard.css';

/**
 * "What if one plan had to protect every crown jewel?" The engine's recorded answer: no plan of
 * at most 3 changes closes every path (K_EXCEEDED). Mock mode only; the REST API plans per
 * cluster, which is why the storm is split into clusters.
 */
export function ScenarioCard() {
  const [open, setOpen] = useState(false);
  const { available, query } = useRecordedScenario(open);
  if (!available) return null;
  const hunt = query.data;
  const flows = mergeFlows(hunt?.plan);

  return (
    <article className="scenario-card">
      <div className="scenario-card__row">
        <Layers className="scenario-card__icon" aria-hidden />
        <div>
          <h3 className="scenario-card__title">Every crown jewel at once?</h3>
          <p className="scenario-card__text">
            One plan for all targets must cut every chain to both databases with at most 3 changes. The engine’s recorded
            answer is honest: it cannot.
          </p>
        </div>
      </div>
      <div className="scenario-card__row-2">
        <OctagonX className="scenario-card__icon-2" aria-hidden />
        No safe plan within 3 changes
      </div>
      <div className="scenario-card__block">
        <Button size="sm" variant="secondary" className="scenario-card__button" onClick={() => setOpen(true)}>
          Show the recorded result
        </Button>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Recorded engine run: all crown jewels in scope"
        description="Same synthetic environment and engine, with T_scope set to every crown jewel. Recorded output, not live."
      >
        {query.isPending ? <LoadingState title="Loading the recorded run" detail="hunts/all-crown-jewels" /> : null}
        {query.error ? <ErrorState error={query.error} title="The recorded run could not be loaded" onRetry={() => void query.refetch()} /> : null}
        {hunt ? (
          <div className="scenario-card__block-2">
            {hunt.plan ? <PlanReport report={hunt.plan} flows={flows} chains={hunt.chains} verified={false} /> : null}
            <section aria-label="Path Hunter rounds" className="scenario-card__section">
              <div className="section-label">Path Hunter</div>
              <HuntReport hunt={hunt} flows={flows} />
            </section>
          </div>
        ) : null}
      </Modal>
    </article>
  );
}
