import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { renderApp, setViewportWidth } from '@/test/render';

const AUTH = '/clusters/cluster-prod-payments-db-ing-auth';

describe('Workbench', () => {
  beforeEach(() => {
    setViewportWidth(1440);
  });

  it('renders the three panes, the simulation badge and the audit strip', async () => {
    renderApp(AUTH);
    expect(await screen.findByRole('heading', { name: 'Evidence graph' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Investigation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plan and verification' })).toBeInTheDocument();
    expect(screen.getAllByText('Simulation only: no infrastructure is changed').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Audit' })).toBeInTheDocument();
    // The entry workload's evidence tiers load with the graph.
    expect(await screen.findByRole('list', { name: 'Evidence tiers for auth-1' })).toBeInTheDocument();
  });

  it('offers a table view of the subgraph as the text alternative', async () => {
    const user = userEvent.setup();
    renderApp(AUTH);
    await user.click(await screen.findByRole('radio', { name: 'Table view (text alternative)' }));
    const steps = await screen.findByRole('table', { name: /Attack steps/ });
    expect(within(steps).getByText(/auth-1 → prod-payments-db/)).toBeInTheDocument();
    expect(within(steps).getByText(/Internet → auth-1/)).toBeInTheDocument();
  });

  it('streams an investigation to a model-verified certificate', async () => {
    const user = userEvent.setup();
    renderApp(AUTH);
    const pane = await screen.findByRole('region', { name: 'Investigation' });
    await user.click(within(pane).getAllByRole('button', { name: /Investigate/ })[0]!);

    const report = await screen.findByRole('article', { name: 'Final report' }, { timeout: 10_000 });
    expect(within(report).getByText('Model-verified containment (simulation)')).toBeInTheDocument();
    expect(within(report).getByText(/generated without the AI narrator/)).toBeInTheDocument();

    // Every tool step shows why it was chosen and what it returned.
    const timeline = within(pane).getByRole('list', { name: 'Investigation timeline' });
    expect(within(timeline).getByText('Triage the alert storm')).toBeInTheDocument();
    expect(within(timeline).getByText('Hunt for paths that survive the plan')).toBeInTheDocument();
    expect(within(timeline).getAllByText(/Why this tool:/).length).toBe(6);

    // The right pane shows the verified plan, both Hunter rounds and a current certificate.
    const verification = screen.getByRole('region', { name: 'Plan and verification' });
    await waitFor(() => expect(within(verification).getByText('Verified plan')).toBeInTheDocument());
    // The impact sentence of solution.md §4.3, built from the engine's sets.
    expect(verification).toHaveTextContent(
      'Closes all modelled paths to prod-payments-db; breaks 1 declared dependency (checkout-1 → prod-payments-db :5432/TCP); 2 blocked flows have unknown impact (analytics-1).',
    );
    expect(within(verification).getByText('Round 0')).toBeInTheDocument();
    expect(within(verification).getByText('Round 1')).toBeInTheDocument();
    const certificate = within(verification).getByLabelText('Certificate status');
    await waitFor(() => expect(within(certificate).getByText('Certificate valid')).toBeInTheDocument());
    expect(within(certificate).getByRole('link', { name: /Open certificate/ })).toHaveAttribute(
      'href',
      '/certificates/cert-4c538538b3304721938d53692dd578ce',
    );
  });

  it('says which cluster is missing instead of rendering an empty workbench', async () => {
    renderApp('/clusters/cluster-does-not-exist');
    expect(await screen.findByText(/No cluster “cluster-does-not-exist” in this storm/)).toBeInTheDocument();
  });
});
