import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from '@/components/StatusBadge';

import { describeStatus, reasonText } from './status';

// solution.md §13.4: state → colour, icon, label. Colour is never the only signal.
const TABLE: [string, string, string, string][] = [
  ['QUALIFYING_MODELED_CHAIN', 'red', 'alert', 'Real attack path (modelled)'],
  ['ON_ATTACK_PATH', 'red', 'alert', 'Real attack path (modelled)'],
  ['NOT_QUALIFIED', 'amber', 'shield', 'Vulnerable but not on any attack path'],
  ['NOT_ON_ATTACK_PATH', 'amber', 'shield', 'Vulnerable but not on any attack path'],
  ['NOT_ACTIONABLE', 'grey', 'dash', 'Not actionable (inactive or not network-exploitable)'],
  ['SIMULATED_RESIDUAL_EXPOSURE', 'orange', 'split', 'Partly fixed: paths remain'],
  ['NO_FEASIBLE_PLAN_WITHIN_K', 'orange', 'stop', 'No safe plan within 3 changes'],
  ['INCONCLUSIVE', 'yellow', 'question', 'Not enough fresh evidence'],
  ['TRIAGE_INCONCLUSIVE', 'yellow', 'question', 'Not enough fresh evidence'],
  ['PLANNING_INCONCLUSIVE', 'yellow', 'question', 'Not enough fresh evidence'],
  ['SIMULATION_INCONCLUSIVE', 'yellow', 'question', 'Not enough fresh evidence'],
  ['IMPACT_PARTIALLY_UNKNOWN', 'yellow', 'question', 'Impact partly unknown'],
  ['SIMULATED_CONTAINMENT', 'green', 'check', 'Model-verified containment (simulation)'],
  ['SUPERSEDED', 'grey', 'clock', 'Certificate no longer current'],
  ['EXPIRED', 'grey', 'clock', 'Certificate no longer current'],
  ['CANDIDATE_CHANGE', 'violet', 'scissors', 'Proposed policy change'],
];

describe('status language (solution.md §13.4)', () => {
  it.each(TABLE)('%s → %s %s "%s"', (status, tone, icon, label) => {
    const descriptor = describeStatus(status, { hasCertificate: true });
    expect(descriptor.tone).toBe(tone);
    expect(descriptor.icon).toBe(icon);
    expect(descriptor.label).toBe(label);
    expect(descriptor.description.length).toBeGreaterThan(20);
  });

  it('names the number of broken dependencies for KNOWN_DISRUPTION', () => {
    expect(describeStatus('KNOWN_DISRUPTION', { knownBroken: 1 }).label).toBe(
      'Closes all modelled paths; breaks 1 declared dependency',
    );
    expect(describeStatus('KNOWN_DISRUPTION', { knownBroken: 2 }).label).toBe(
      'Closes all modelled paths; breaks 2 declared dependencies',
    );
  });

  it('qualifies "zero disruption" as declared dependencies of a synthetic fixture (§7.4)', () => {
    expect(describeStatus('KNOWN_ZERO_DISRUPTION').label).toBe(
      'Zero disruption of declared dependencies (synthetic fixture)',
    );
  });

  it('never says "Contained" on its own', () => {
    const statuses = [...TABLE.map(([s]) => s), 'VALID', 'PLAN_FOUND', 'KNOWN_ZERO_DISRUPTION', 'FAILED'];
    for (const status of statuses) {
      const { label } = describeStatus(status, { hasCertificate: true });
      expect(label.trim().toLowerCase()).not.toBe('contained');
      if (/contain/i.test(label)) expect(label).toBe('Model-verified containment (simulation)');
    }
  });

  it('withholds the containment claim when there is no certificate (§10.2)', () => {
    const descriptor = describeStatus('SIMULATED_CONTAINMENT', { hasCertificate: false });
    expect(descriptor.label).not.toMatch(/model-verified containment/i);
    expect(descriptor.tone).not.toBe('green');
  });

  it('shows unknown statuses as unrecognised, not as a verdict', () => {
    const descriptor = describeStatus('SOMETHING_NEW');
    expect(descriptor.tone).toBe('grey');
    expect(descriptor.label).toBe('SOMETHING_NEW');
  });

  it('translates reason codes into words', () => {
    expect(reasonText('K_EXCEEDED')).toBe('No plan of at most 3 allowed policy changes closes every modelled path');
    expect(reasonText('METHOD_DISAGREEMENT')).toMatch(/disagreed/);
    expect(reasonText(null)).toBeNull();
  });
});

describe('<StatusBadge>', () => {
  it('always renders an icon and the text label, not colour alone', () => {
    const { container } = render(<StatusBadge status="NOT_ON_ATTACK_PATH" />);
    expect(screen.getByText('Vulnerable but not on any attack path')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-tone="amber"]')).not.toBeNull();
  });

  it('adds the reason after an inconclusive label', () => {
    render(<StatusBadge status="SIMULATION_INCONCLUSIVE" reason="REVISION_CHANGED" />);
    expect(screen.getByText(/Not enough fresh evidence/)).toBeInTheDocument();
    expect(screen.getByText(/The sandbox changed during the run/)).toBeInTheDocument();
  });

  it('shows containment only with a certificate', () => {
    const { rerender } = render(<StatusBadge status="SIMULATED_CONTAINMENT" hasCertificate />);
    expect(screen.getByText('Model-verified containment (simulation)')).toBeInTheDocument();
    rerender(<StatusBadge status="SIMULATED_CONTAINMENT" hasCertificate={false} />);
    expect(screen.queryByText('Model-verified containment (simulation)')).not.toBeInTheDocument();
  });
});
